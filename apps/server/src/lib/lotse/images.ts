import "server-only";
import type { FilePart, TextPart } from "ai";
import type { ScreenshotFrame } from "@lotse/shared";

/**
 * Screenshot frames (extension, only in /ask) → real Gemini multimodal parts: one caption TextPart + one image FilePart
 * per frame, chronological. Never base64 inside the text prompt.
 * Caps: ≤ 4 frames, each ≤ 600 k base64 chars (same as ScreenshotFrameSchema), ≤ 2.4 M chars in total — oversized or
 * malformed frames are dropped (oldest first when over the total budget).
 */
export const IMAGE_LIMITS = { maxFrames: 4, maxFrameChars: 600_000, maxTotalChars: 2_400_000 } as const;

const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/;

export interface ImageParts {
  parts: (TextPart | FilePart)[];
  used: number;
  dropped: number;
}

export function screenshotParts(frames: ScreenshotFrame[] | undefined, current: { id?: string; capturedAt: number }): ImageParts {
  if (!frames?.length) return { parts: [], used: 0, dropped: 0 };

  const valid: { frame: ScreenshotFrame; mediaType: string; base64: string }[] = [];
  for (const frame of frames) {
    if (frame.dataUrl.length > IMAGE_LIMITS.maxFrameChars) continue;
    const m = DATA_URL.exec(frame.dataUrl);
    if (!m) continue;
    valid.push({ frame, mediaType: m[1], base64: m[2] });
  }
  valid.sort((a, b) => a.frame.capturedAt - b.frame.capturedAt);

  // Newest frames win: drop the oldest while over the frame count or the total size budget.
  let kept = valid.slice(-IMAGE_LIMITS.maxFrames);
  let total = kept.reduce((n, f) => n + f.base64.length, 0);
  while (kept.length && total > IMAGE_LIMITS.maxTotalChars) {
    total -= kept[0].base64.length;
    kept = kept.slice(1);
  }

  const parts: (TextPart | FilePart)[] = [];
  kept.forEach(({ frame, mediaType, base64 }, i) => {
    const ago = Math.max(0, Math.round((current.capturedAt - frame.capturedAt) / 1000));
    const which = current.id && frame.snapshotId === current.id ? "current page state" : "earlier page state";
    parts.push({ type: "text", text: `Screenshot ${i + 1}/${kept.length} (${which}, ${ago}s before the current snapshot):` });
    parts.push({ type: "file", mediaType, data: { type: "data", data: base64 } });
  });
  return { parts, used: kept.length, dropped: frames.length - kept.length };
}
