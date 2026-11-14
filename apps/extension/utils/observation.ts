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

const userActions = new Set<LotseEvent["type"]>(["click", "route", "search", "focus", "submit", "repeated_click", "rage_click"]);
const BACKTRACK_LABEL = /^(?:zurück|zurueck|back|abbrechen|cancel|schließen|schliessen|dialog schließen)$/i;

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
    const screenshots = !includeScreenshots || count === 0 ? [] : selectEventMatchedFrames(relevantFrames, events, snapshot.id, count);
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

/** Prioritizes screenshots captured at key workflow events/state transitions (errors, blocked clicks, searches, routes) plus the latest UI state. */
function selectEventMatchedFrames(frames: ScreenshotFrame[], events: LotseEvent[], currentSnapshotId: string, maxCount: number): ScreenshotFrame[] {
  if (frames.length <= maxCount) return frames;
  if (maxCount === 1) return frames.slice(-1);

  const priorityBySnapshot = new Map<string, number>();
  for (const ev of events) {
    if (!ev.snapshotId) continue;
    const weight =
      ev.type === "repeated_click" || ev.type === "rage_click" || ev.type === "error" || ev.type === "empty_results"
        ? 3
        : ev.type === "submit" || ev.type === "search"
          ? 2
          : ev.type === "route" || ev.type === "click"
            ? 1
            : 0;
    priorityBySnapshot.set(ev.snapshotId, Math.max(priorityBySnapshot.get(ev.snapshotId) ?? 0, weight));
  }

  const latest = frames.at(-1)!;
  const chosen = new Set<ScreenshotFrame>([latest]);
  const currentStateFrame = [...frames].reverse().find((f) => f.snapshotId === currentSnapshotId);
  if (currentStateFrame && chosen.size < maxCount) chosen.add(currentStateFrame);

  // Pick highest-signal earlier transition frames with distinct snapshotIds first, newest wins on ties.
  const usedStates = new Set([...chosen].map((f) => f.snapshotId));
  const candidates = frames
    .slice(0, -1)
    .map((frame, idx) => ({ frame, idx, score: priorityBySnapshot.get(frame.snapshotId) ?? 0 }))
    .sort((a, b) => b.score - a.score || b.idx - a.idx);

  for (const { frame, score } of candidates) {
    if (chosen.size >= maxCount) break;
    if (score > 0 && !usedStates.has(frame.snapshotId)) {
      chosen.add(frame);
      usedStates.add(frame.snapshotId);
    }
  }
  // Fill any remaining slot with the earliest baseline frame, then evenly spaced frames.
  if (chosen.size < maxCount && frames[0]) chosen.add(frames[0]);
  for (let i = 0; chosen.size < maxCount && i < frames.length; i++) {
    const pick = frames[Math.round((i * (frames.length - 1)) / (maxCount - 1))];
    if (pick) chosen.add(pick);
  }
  return [...chosen].sort((a, b) => a.capturedAt - b.capturedAt).slice(-maxCount);
}

/** Cheap candidates that enrich `/decide`. The Gemini Decisions endpoint makes the calibrated intervention decision. */
export function findStuckSignal(context: ObservationContext | null): StuckSignal | null {
  if (!context) return null;
  const now = Date.now();
  const recent = context.workflow.events.filter((event) => event.ts >= now - 60_000);

  // 1. Repeated / disabled / dead / rage clicks (highest priority, D-30 + disabled-button & dead-click awareness).
  const repeated = recent.filter((event) => (event.type === "repeated_click" || event.type === "rage_click") && event.ts >= now - 30_000).pop();
  if (repeated) {
    const label = repeated.elementLabel ? `"${repeated.elementLabel}"` : "the same spot";
    const reasonMatch = /reason=([^;]+)/.exec(repeated.detail ?? "")?.[1];
    if (repeated.detail?.includes("disabled=true")) {
      return {
        type: "repeated_click",
        reason: `Clicked disabled control ${label} multiple times${reasonMatch ? ` (${reasonMatch})` : ""}.`,
      };
    }
    if (repeated.detail?.includes("deadClick=true")) {
      return { type: "repeated_click", reason: `Clicked ${label} repeatedly with no UI state change.` };
    }
    return { type: "repeated_click", reason: `Repeatedly clicked ${label}.` };
  }

  // Single click on a disabled control followed immediately by an error or hesitation.
  const disabledClick = recent.filter((e) => e.type === "click" && e.detail?.includes("disabled=true") && e.ts >= now - 25_000).pop();

  // 2. Errors: permission blockade, off-screen error banner + retry, or ≥ 2 validation/UI errors in the workflow.
  const errors = recent.filter((event) => event.type === "error");
  const permissionErr = errors.find((e) => e.detail?.includes("permission=true"));
  if (permissionErr) {
    return { type: "repeated_error", reason: `Blocked by missing role/permission: ${permissionErr.elementLabel ?? "permission denied"}.` };
  }
  const offscreenErr = errors.find((e) => e.detail?.includes("offscreen=true"));
  if (offscreenErr && recent.some((e) => (e.type === "submit" || e.type === "click") && e.ts > offscreenErr.ts)) {
    return { type: "repeated_error", reason: `Form error appeared outside viewport (${offscreenErr.elementLabel ?? "validation error"}) while user kept trying.` };
  }
  if (errors.length >= 2 || (errors.length >= 1 && disabledClick)) {
    return { type: "repeated_error", reason: `Encountered ${errors.length} visible error(s) in the current workflow.` };
  }

  // 3. Unsuccessful searches (≥ 2 empty searches, OR 1 empty search followed by hunting through ≥ 2 routes/tabs).
  const searches = context.workflow.events.filter((event) => event.type === "search" && event.ts >= now - 90_000);
  const emptyResults = context.workflow.events.filter((event) => event.type === "empty_results" && event.ts >= now - 90_000);
  const failedAttempts = searches.filter((search, index) => {
    if (search.detail?.includes("results=0")) return true;
    const until = searches[index + 1]?.ts ?? now;
    return emptyResults.some((result) => result.route === search.route && result.ts >= search.ts - 600 && result.ts <= until + 600);
  });
  if (failedAttempts.length >= 2) {
    return { type: "unsuccessful_searches", reason: `At least ${failedAttempts.length} search attempts returned no results.` };
  }
  const lastEmpty = emptyResults.at(-1);
  if (lastEmpty && lastEmpty.ts >= now - 35_000) {
    const navAfterEmpty = recent.filter(
      (e) => e.ts > lastEmpty.ts && (e.type === "route" || (e.type === "click" && (e.elementRole === "tab" || e.elementRole === "link"))),
    );
    if (navAfterEmpty.length >= 2) {
      return { type: "unsuccessful_searches", reason: "Search returned no results, followed by navigating across pages/tabs to find the feature." };
    }
  }

  // 4. Route ping-pong (A→B→A→B), in-page tab ping-pong / tab hunting, or repeated Back/Cancel in wizards/dialogs.
  const routes = context.workflow.routeSequence.slice(-4);
  if (routes.length === 4 && routes[0] !== routes[1] && routes.every((r, index) => r === routes[index % 2])) {
    return { type: "route_ping_pong", reason: "Switched back and forth between the same two pages." };
  }
  const recent35s = recent.filter((e) => e.ts >= now - 35_000);
  const tabClicks = recent35s.filter((e) => e.type === "click" && e.elementRole === "tab" && e.elementLabel);
  if (tabClicks.length >= 3) {
    const labels = tabClicks.map((t) => t.elementLabel!);
    const uniqueTabs = new Set(labels);
    const hasFormWork = recent35s.some((e) => e.type === "submit" || (e.type === "focus" && e.elementRole === "textbox"));
    if (!hasFormWork && (labels.length > uniqueTabs.size || uniqueTabs.size >= 4)) {
      return { type: "route_ping_pong", reason: `Switched across tabs (${labels.slice(-4).join(" → ")}) without finding the target action.` };
    }
  }
  const backtracks = recent.filter((e) => e.type === "click" && e.elementLabel && BACKTRACK_LABEL.test(e.elementLabel.trim()));
  if (backtracks.length >= 2) {
    return { type: "route_ping_pong", reason: "Repeatedly clicked Back/Cancel in a multi-step flow or dialog." };
  }

  // 5. Form idle or post-problem hesitation.
  const idleEvent = recent.filter((event) => event.type === "idle" && event.ts >= now - 45_000).pop();
  if (idleEvent) {
    return {
      type: "form_idle",
      reason: idleEvent.detail?.includes("afterProblem=true")
        ? "User paused for 20s after hitting a blocked control, error, or empty search."
        : "No action in an active form or dialog for 18 seconds.",
    };
  }
  return null;
}
