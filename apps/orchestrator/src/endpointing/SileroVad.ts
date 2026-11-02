import { fileURLToPath } from "node:url";
import * as ort from "onnxruntime-node";

const MODEL_PATH = fileURLToPath(new URL("../../models/silero_vad.onnx", import.meta.url));

/** Shared across sessions; each session keeps its own recurrent state. */
let sessionPromise: Promise<ort.InferenceSession> | null = null;
export function loadSileroModel(): Promise<ort.InferenceSession> {
  sessionPromise ??= ort.InferenceSession.create(MODEL_PATH, {
    intraOpNumThreads: 1,
    interOpNumThreads: 1,
  });
  return sessionPromise;
}

/**
 * Silero VAD v5 streaming wrapper for 16 kHz: 512-sample windows (32 ms), with the previous
 * 64 samples prepended as context (as in the reference OnnxWrapper). Returns speech probability.
 */
export class SileroVad {
  static readonly SAMPLE_RATE = 16000;
  static readonly WINDOW = 512;
  private static readonly CONTEXT = 64;

  private state: Float32Array = new Float32Array(2 * 1 * 128);
  private context: Float32Array = new Float32Array(SileroVad.CONTEXT);
  private readonly sr = new ort.Tensor("int64", BigInt64Array.from([BigInt(SileroVad.SAMPLE_RATE)]), []);

  constructor(private readonly model: ort.InferenceSession) {}

  async process(window: Float32Array): Promise<number> {
    const input = new Float32Array(SileroVad.CONTEXT + SileroVad.WINDOW);
    input.set(this.context, 0);
    input.set(window, SileroVad.CONTEXT);
    const out = await this.model.run({
      input: new ort.Tensor("float32", input, [1, input.length]),
      state: new ort.Tensor("float32", this.state, [2, 1, 128]),
      sr: this.sr,
    });
    this.state = out.stateN!.data as Float32Array;
    this.context = window.slice(SileroVad.WINDOW - SileroVad.CONTEXT);
    return (out.output!.data as Float32Array)[0]!;
  }

  reset(): void {
    this.state = new Float32Array(2 * 1 * 128);
    this.context = new Float32Array(SileroVad.CONTEXT);
  }
}
