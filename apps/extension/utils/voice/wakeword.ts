/**
 * openWakeWord in the browser (offscreen document only — imports ONNX Runtime Web).
 *
 * Port of openWakeWord's streaming feature pipeline (github.com/dscripka/openWakeWord, `utils.AudioFeatures`):
 *   80 ms frame (1280 samples @16 kHz, int16 scale) + 480 samples context → melspectrogram.onnx → 8 frames × 32 bins
 *   → transform x/10+2 → last 76 frames → embedding_model.onnx → 96-d embedding per frame
 *   → last 16 embeddings → keyword head (hey_jarvis_v0.1.onnx) → score 0…1.
 * Plus Silero VAD (v4, 512-sample chunks) for client-side end-of-utterance.
 * Models come from the `openwakeword-wasm-browser` package (MIT wrapper); their engine is not used because it loads
 * its worklet from a Blob URL (blocked by the MV3 CSP), opens its own mic, and feeds the mel model unscaled audio.
 */
import * as ort from "onnxruntime-web/wasm";

const FRAME = 1280;
const MEL_CONTEXT = 480; // 3 hops of 160 samples, as in openWakeWord
const MEL_BINS = 32;
const MEL_WINDOW = 76;
const EMBEDDING = 96;
const VAD_CHUNK = 512;
const SAMPLE_RATE = 16_000;

export interface WakeWordOptions {
  /** URL of the directory with melspectrogram.onnx, embedding_model.onnx, silero_vad.onnx and the keyword model. */
  modelBaseUrl: string;
  /** URL of ort-wasm-simd-threaded.wasm inside the extension (MV3: no remote code). */
  wasmUrl: string;
  keywordModel: string;
  threshold: number;
  cooldownMs: number;
}

interface Sessions {
  mel: ort.InferenceSession;
  embedding: ort.InferenceSession;
  vad: ort.InferenceSession;
  keyword: ort.InferenceSession;
}

const inputName = (session: ort.InferenceSession): string => session.inputNames[0] ?? "input";
const first = (output: ort.InferenceSession.OnnxValueMapType, session: ort.InferenceSession): Float32Array => {
  const value = output[session.outputNames[0] ?? ""];
  if (!value) throw new Error("ONNX model returned no output");
  return value.data as Float32Array;
};

export class WakeWordDetector {
  threshold: number;
  private lock: Promise<unknown> = Promise.resolve();
  private melTail = new Float32Array(0);
  private mel: Float32Array[] = [];
  private embeddings: Float32Array[] = [];
  private framesSinceReset = 0;
  private peakScore = 0;
  private peakSince = 0;
  /** Keyword score of the last processed frame (diagnostics / offline harness). */
  lastScore = 0;
  private lastHit = -Infinity;
  private vadH!: ort.Tensor;
  private vadC!: ort.Tensor;
  private vadCarry = new Float32Array(0);
  private readonly vadRate = new ort.Tensor("int64", BigInt64Array.from([BigInt(SAMPLE_RATE)]), []);

  private constructor(
    private readonly s: Sessions,
    private readonly keywordWindow: number,
    private readonly cooldownMs: number,
    threshold: number,
  ) {
    this.threshold = threshold;
    this.reset();
    this.resetVad();
  }

  static async load(options: WakeWordOptions): Promise<WakeWordDetector> {
    ort.env.wasm.numThreads = 1; // offscreen documents are not cross-origin isolated → no SharedArrayBuffer threads
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = { wasm: options.wasmUrl };
    const base = options.modelBaseUrl.replace(/\/+$/, "");
    const open = (file: string) => ort.InferenceSession.create(`${base}/${file}`, { executionProviders: ["wasm"] });
    // Sequential: the first create() initialises the wasm runtime.
    const mel = await open("melspectrogram.onnx");
    const embedding = await open("embedding_model.onnx");
    const vad = await open("silero_vad.onnx");
    const keyword = await open(options.keywordModel);
    const meta = keyword.inputMetadata[0];
    const dim = meta?.isTensor ? meta.shape[1] : undefined;
    const window = typeof dim === "number" && dim > 0 ? dim : 16;
    return new WakeWordDetector({ mel, embedding, vad, keyword }, window, options.cooldownMs, options.threshold);
  }

  /** Clears the streaming buffers (after listening, the old audio must not re-trigger). */
  reset(): void {
    this.melTail = new Float32Array(0);
    this.mel = Array.from({ length: MEL_WINDOW }, () => new Float32Array(MEL_BINS).fill(1));
    this.embeddings = Array.from({ length: this.keywordWindow }, () => new Float32Array(EMBEDDING));
    this.framesSinceReset = 0;
  }

  resetVad(): void {
    this.vadH = new ort.Tensor("float32", new Float32Array(2 * 64), [2, 1, 64]);
    this.vadC = new ort.Tensor("float32", new Float32Array(2 * 64), [2, 1, 64]);
    this.vadCarry = new Float32Array(0);
  }

  /** Feed one 80 ms frame (Float32 in [-1, 1]); resolves true when the keyword fired. */
  detect(frame: Float32Array): Promise<boolean> {
    return this.exclusive(() => this.detectFrame(frame));
  }

  /** Highest Silero speech probability (0…1) within this frame. */
  speechProbability(frame: Float32Array): Promise<number> {
    return this.exclusive(() => this.vadFrame(frame));
  }

  /** ORT sessions are driven one call at a time (single-threaded wasm). */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  private async detectFrame(frame: Float32Array): Promise<boolean> {
    if (frame.length !== FRAME) return false;
    // openWakeWord feeds 16-bit PCM values (as float32) to the mel model, with 480 samples of left context.
    const input = new Float32Array(this.melTail.length + FRAME);
    input.set(this.melTail);
    for (let i = 0; i < FRAME; i++) input[this.melTail.length + i] = Math.max(-1, Math.min(1, frame[i] ?? 0)) * 32767;
    this.melTail = input.slice(input.length - MEL_CONTEXT);

    const melOut = await this.s.mel.run({ [inputName(this.s.mel)]: new ort.Tensor("float32", input, [1, input.length]) });
    const spec = first(melOut, this.s.mel);
    for (let offset = 0; offset + MEL_BINS <= spec.length; offset += MEL_BINS) {
      const row = new Float32Array(MEL_BINS);
      for (let j = 0; j < MEL_BINS; j++) row[j] = (spec[offset + j] ?? 0) / 10 + 2;
      this.mel.push(row);
    }
    if (this.mel.length > MEL_WINDOW) this.mel.splice(0, this.mel.length - MEL_WINDOW);

    const melWindow = new Float32Array(MEL_WINDOW * MEL_BINS);
    this.mel.forEach((row, i) => melWindow.set(row, i * MEL_BINS));
    const embOut = await this.s.embedding.run({
      [inputName(this.s.embedding)]: new ort.Tensor("float32", melWindow, [1, MEL_WINDOW, MEL_BINS, 1]),
    });
    this.embeddings.push(new Float32Array(first(embOut, this.s.embedding).subarray(0, EMBEDDING)));
    this.embeddings.shift();

    const features = new Float32Array(this.keywordWindow * EMBEDDING);
    this.embeddings.forEach((e, i) => features.set(e, i * EMBEDDING));
    const kwOut = await this.s.keyword.run({
      [inputName(this.s.keyword)]: new ort.Tensor("float32", features, [1, this.keywordWindow, EMBEDDING]),
    });
    const score = first(kwOut, this.s.keyword)[0] ?? 0;
    this.lastScore = score;

    // Warm-up: the keyword window must be filled with real audio before a score counts.
    this.framesSinceReset++;
    const now = performance.now();
    // Diagnostics for tuning on the demo machine: peak keyword score every 3 s (only when something scored at all).
    this.peakScore = Math.max(this.peakScore, score);
    if (now - this.peakSince >= 3_000) {
      if (this.peakScore >= 0.05) console.info(`[lotse voice] wake score peak ${this.peakScore.toFixed(2)} (threshold ${this.threshold})`);
      this.peakScore = 0;
      this.peakSince = now;
    }
    if (this.framesSinceReset < this.keywordWindow || score < this.threshold || now - this.lastHit < this.cooldownMs) return false;
    this.lastHit = now;
    return true;
  }

  private async vadFrame(frame: Float32Array): Promise<number> {
    const samples = new Float32Array(this.vadCarry.length + frame.length);
    samples.set(this.vadCarry);
    samples.set(frame, this.vadCarry.length);
    let offset = 0;
    let probability = 0;
    while (samples.length - offset >= VAD_CHUNK) {
      const chunk = samples.slice(offset, offset + VAD_CHUNK);
      offset += VAD_CHUNK;
      const out = await this.s.vad.run({
        input: new ort.Tensor("float32", chunk, [1, VAD_CHUNK]),
        sr: this.vadRate,
        h: this.vadH,
        c: this.vadC,
      });
      this.vadH = out.hn as ort.Tensor;
      this.vadC = out.cn as ort.Tensor;
      probability = Math.max(probability, (out.output?.data as Float32Array | undefined)?.[0] ?? 0);
    }
    this.vadCarry = samples.slice(offset);
    return probability;
  }
}

/** Fallback speech probability from loudness (when the VAD model is unavailable). */
export function energySpeechProbability(frame: Float32Array): number {
  let sum = 0;
  for (const sample of frame) sum += sample * sample;
  const rms = Math.sqrt(sum / Math.max(1, frame.length));
  return rms > 0.02 ? 1 : rms > 0.01 ? 0.4 : 0;
}
