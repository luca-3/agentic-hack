import {
  LotseEventSchema,
  ObservationSnapshotSchema,
  ScreenshotFrameSchema,
  UIStateInferenceSchema,
  type LotseEvent,
  type ObservationContext,
  type ObservationSnapshot,
  type ObservedWorkflow,
  type ScreenshotFrame,
  type StuckSignal,
  type UIStateInference,
} from "@lotse/shared";

export const OBSERVATION_LIMITS = {
  maxAgeMs: 180_000,
  maxEvents: 180,
  maxSnapshots: 40,
  maxScreenshots: 36,
  maxScreenshotBytes: 6 * 1024 * 1024,
  workflowIdleMs: 30_000,
};

type BufferOptions = typeof OBSERVATION_LIMITS;
type WorkflowMetadata = Omit<ObservedWorkflow, "events">;
type BufferedEvent = LotseEvent & { workflowId: string };
export type SerializedObservationBuffer = {
  version: 1;
  workflow: WorkflowMetadata | null;
  events: BufferedEvent[];
  snapshots: ObservationSnapshot[];
  screenshots: ScreenshotFrame[];
  states: UIStateInference[];
};

const userActions = new Set<LotseEvent["type"]>(["click", "route", "search", "focus", "submit"]);

/** A local rolling buffer. No network, user identity or application cookies are accessed here. */
export class ObservationBuffer {
  readonly options: BufferOptions;
  events: BufferedEvent[] = [];
  snapshots: ObservationSnapshot[] = [];
  screenshots: ScreenshotFrame[] = [];
  states: UIStateInference[] = [];
  workflow: WorkflowMetadata | null = null;

  constructor(options: Partial<BufferOptions> = {}) {
    this.options = { ...OBSERVATION_LIMITS, ...options };
  }

  clear() {
    this.events = [];
    this.snapshots = [];
    this.screenshots = [];
    this.states = [];
    this.workflow = null;
  }

  record({ event, snapshot }: { event?: LotseEvent; snapshot?: ObservationSnapshot } = {}) {
    if (event) {
      const parsed = LotseEventSchema.safeParse(event);
      if (parsed.success) this.addEvent(parsed.data);
    }
    if (snapshot) {
      const parsed = ObservationSnapshotSchema.safeParse(snapshot);
      if (parsed.success) {
        this.snapshots = this.snapshots.filter((item) => item.id !== parsed.data.id);
        this.snapshots.push(structuredClone(parsed.data));
      }
    }
    this.prune();
  }

  private addEvent(event: LotseEvent) {
    if (event.id && this.events.some((item) => item.id === event.id)) return;
    const activity = userActions.has(event.type);
    if (!this.workflow || (activity && event.ts - this.workflow.lastActivityAt > this.options.workflowIdleMs)) {
      this.workflow = {
        id: crypto.randomUUID(),
        startedAt: event.ts,
        lastActivityAt: event.ts,
        routeSequence: [],
      };
    }
    if (activity) this.workflow.lastActivityAt = Math.max(this.workflow.lastActivityAt, event.ts);
    if (event.route && this.workflow.routeSequence.at(-1) !== event.route) {
      this.workflow.routeSequence = [...this.workflow.routeSequence, event.route].slice(-40);
    }
    this.events.push({ ...structuredClone(event), id: event.id ?? crypto.randomUUID(), workflowId: this.workflow.id });
  }

  addScreenshot(frame: ScreenshotFrame) {
    const parsed = ScreenshotFrameSchema.safeParse(frame);
    if (!parsed.success || !this.snapshots.some((snapshot) => snapshot.id === frame.snapshotId)) return;
    this.screenshots.push(structuredClone(parsed.data));
    this.prune();
  }

  addState(state: UIStateInference) {
    const parsed = UIStateInferenceSchema.safeParse(state);
    if (!parsed.success || !this.snapshots.some((snapshot) => snapshot.id === state.snapshotId)) return;
    this.states = this.states.filter((item) => item.snapshotId !== state.snapshotId || item.capturedAt !== state.capturedAt);
    this.states.push(parsed.data);
    this.states.sort((a, b) => a.capturedAt - b.capturedAt);
    this.prune();
  }

  prune(now = Date.now()) {
    const oldest = now - this.options.maxAgeMs;
    this.events = this.events.filter((item) => item.ts >= oldest && item.ts <= now + 5_000).slice(-this.options.maxEvents);
    this.snapshots = this.snapshots
      .filter((item) => item.capturedAt >= oldest && item.capturedAt <= now + 5_000)
      .slice(-this.options.maxSnapshots);
    const snapshotIds = new Set(this.snapshots.map((item) => item.id));
    this.states = this.states.filter((item) => item.capturedAt >= oldest && item.capturedAt <= now + 5_000 && snapshotIds.has(item.snapshotId)).slice(-40);
    this.screenshots = this.screenshots
      .filter((item) => item.capturedAt >= oldest && item.capturedAt <= now + 5_000 && snapshotIds.has(item.snapshotId))
      .slice(-this.options.maxScreenshots);
    // The budget counts the stored base64 strings, which conservatively includes their encoding overhead.
    let bytes = this.screenshots.reduce((total, item) => total + item.dataUrl.length, 0);
    while (bytes > this.options.maxScreenshotBytes && this.screenshots.length) {
      bytes -= this.screenshots.shift()!.dataUrl.length;
    }
    if (this.workflow && this.workflow.lastActivityAt < oldest && !this.events.length) this.workflow = null;
  }

  getContext({ includeScreenshots = true, maxScreenshots = 4, maxHistory = 12 } = {}): ObservationContext | null {
    this.prune();
    const snapshot = this.snapshots.at(-1);
    if (!snapshot) return null;
    if (!this.workflow) {
      this.workflow = {
        id: crypto.randomUUID(),
        startedAt: snapshot.capturedAt,
        lastActivityAt: snapshot.capturedAt,
        routeSequence: [new URL(snapshot.url).pathname],
      };
    }
    const events = this.events.filter((event) => event.workflowId === this.workflow!.id).map((item) => {
      const { workflowId, ...event } = item;
      void workflowId;
      return event;
    });
    const historyCount = Math.min(12, Math.max(0, maxHistory));
    const history = historyCount > 0 ? this.snapshots.filter((item) => item.id !== snapshot.id).slice(-historyCount) : [];
    const stateIds = new Set([snapshot.id, ...history.map((item) => item.id)]);
    const frames: ScreenshotFrame[] = [];
    for (const frame of this.screenshots) {
      // The same semantic DOM state can have different pixels, e.g. another search term.
      // Keep those frames; only consecutive byte-identical captures are redundant.
      if (stateIds.has(frame.snapshotId) && frames.at(-1)?.dataUrl !== frame.dataUrl) frames.push(frame);
    }
    frames.sort((a, b) => a.capturedAt - b.capturedAt);
    const count = Math.min(4, Math.max(0, maxScreenshots));
    const currentFrames = frames.filter((frame) => frame.capturedAt >= this.workflow!.startedAt);
    const priorFrame = frames.filter((frame) => frame.capturedAt < this.workflow!.startedAt).at(-1);
    const relevantFrames = priorFrame ? [priorFrame, ...currentFrames] : currentFrames;
    const screenshots = !includeScreenshots || count === 0 ? [] : relevantFrames.length <= count ? relevantFrames :
      count === 1 ? relevantFrames.slice(-1) : Array.from({ length: count }, (_, index) =>
        relevantFrames[Math.round(index * (relevantFrames.length - 1) / (count - 1))])
        .filter((frame): frame is ScreenshotFrame => frame !== undefined);
    const currentStates = this.states.filter((item) => item.capturedAt >= this.workflow!.startedAt);
    const baseline = this.states.filter((item) => item.capturedAt < this.workflow!.startedAt).at(-1);
    const states = (baseline ? [baseline, ...currentStates] : currentStates).slice(-40);
    return structuredClone({ workflow: { ...this.workflow, events }, snapshot, history, screenshots, states });
  }

  serialize(): SerializedObservationBuffer {
    this.prune();
    return structuredClone({ version: 1, workflow: this.workflow, events: this.events, snapshots: this.snapshots, screenshots: this.screenshots, states: this.states });
  }

  restore(value: unknown) {
    this.clear();
    if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1) return;
    const stored = value as Partial<SerializedObservationBuffer>;
    const workflow = stored.workflow;
    if (workflow && typeof workflow.id === "string" && Number.isFinite(workflow.startedAt) && Number.isFinite(workflow.lastActivityAt)) {
      this.workflow = {
        id: workflow.id,
        startedAt: workflow.startedAt,
        lastActivityAt: workflow.lastActivityAt,
        routeSequence: Array.isArray(workflow.routeSequence) ? workflow.routeSequence.filter((route) => typeof route === "string").slice(-40) : [],
      };
    }
    for (const item of Array.isArray(stored.events) ? stored.events.slice(-this.options.maxEvents) : []) {
      const parsed = LotseEventSchema.safeParse(item);
      if (parsed.success && typeof item.workflowId === "string") this.events.push({ ...parsed.data, workflowId: item.workflowId });
    }
    for (const item of Array.isArray(stored.snapshots) ? stored.snapshots.slice(-this.options.maxSnapshots) : []) {
      const parsed = ObservationSnapshotSchema.safeParse(item);
      if (parsed.success) this.snapshots.push(parsed.data);
    }
    for (const item of Array.isArray(stored.screenshots) ? stored.screenshots.slice(-this.options.maxScreenshots) : []) {
      const parsed = ScreenshotFrameSchema.safeParse(item);
      if (parsed.success) this.screenshots.push(parsed.data);
    }
    for (const item of Array.isArray(stored.states) ? stored.states.slice(-40) : []) {
      const parsed = UIStateInferenceSchema.safeParse(item);
      if (parsed.success) this.states.push(parsed.data);
    }
    this.prune();
  }
}

/** Cheap candidates only. The Gemini endpoint makes the actual intervention decision. */
export function findStuckSignal(context: ObservationContext | null): StuckSignal | null {
  if (!context) return null;
  const recent = context.workflow.events.filter((event) => event.ts >= Date.now() - 60_000);
  // D-30 explicit trigger (highest priority): ≥ 5 presses on the same spot, detected in the content script.
  const pressed = recent.filter((event) => event.type === "repeated_click" && event.ts >= Date.now() - 30_000).pop();
  if (pressed) {
    const label = pressed.elementLabel ? `"${pressed.elementLabel}"` : "the same spot";
    return pressed.detail?.includes("disabled=true")
      ? { type: "repeated_click", reason: `Clicked the disabled element ${label} at least 5 times.` }
      : { type: "repeated_click", reason: `Clicked ${label} at least 5 times.` };
  }
  const errors = recent.filter((event) => event.type === "error");
  if (errors.some((event) => event.elementLabel && errors.filter((other) => other.elementLabel === event.elementLabel && other.route === event.route).length >= 2)) {
    return { type: "repeated_error", reason: "The same visible error occurred at least twice." };
  }
  const searches = recent.filter((event) => event.type === "search");
  const emptyResults = recent.filter((event) => event.type === "empty_results");
  const failedAttempts = searches.filter((search, index) => {
    const until = searches[index + 1]?.ts ?? Date.now();
    return emptyResults.some((result) => result.route === search.route && result.ts >= search.ts && result.ts <= until);
  });
  if (failedAttempts.length >= 3) return { type: "unsuccessful_searches", reason: "At least three search attempts showed empty results." };
  const routes = context.workflow.routeSequence.slice(-5);
  if (routes.length === 5 && routes[0] !== routes[1] && routes.every((route, index) => route === routes[index % 2])) {
    return { type: "route_ping_pong", reason: "Repeatedly switched between the same two routes." };
  }
  if (recent.some((event) => event.type === "idle" && event.elementLabel === "Form idle")) {
    return { type: "form_idle", reason: "No action in a focused form for 30 seconds." };
  }
  return null;
}
