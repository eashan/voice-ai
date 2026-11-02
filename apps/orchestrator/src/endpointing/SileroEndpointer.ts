import type { Endpointer } from "./Endpointer.js";
import { SileroVad } from "./SileroVad.js";
import { now } from "../metrics/latencyLog.js";

export interface SileroEndpointerOptions {
  /** Silence after speech that ends the turn. From agent config turnTaking.silenceMs. */
  silenceMs: number;
  /** Speech probability to count a window as voiced. */
  threshold?: number;
  /** Probability below which a window counts as silence (hysteresis, as in Silero's reference). */
  negThreshold?: number;
  /** Voiced audio needed before we call it speech (debounces clicks/breaths). */
  minSpeechMs?: number;
}

const WINDOW_MS = (SileroVad.WINDOW / SileroVad.SAMPLE_RATE) * 1000; // 32 ms

/**
 * Endpointer B: local Silero VAD decides end-of-turn. The session then manually commits STT.
 * Input: PCM16 @ 16 kHz (μ-law/8 kHz transports must convert first — TODO for Twilio).
 * Silence is counted in audio time (windows), not wall-clock, so jitter doesn't shorten it.
 */
export class SileroEndpointer implements Endpointer {
  private readonly threshold: number;
  private readonly negThreshold: number;
  private readonly minSpeechWindows: number;
  private readonly silenceWindows: number;

  private buf = new Float32Array(SileroVad.WINDOW);
  private bufLen = 0;
  private queue: Promise<void> = Promise.resolve();
  private closed = false;

  private inSpeech = false;
  private voicedRun = 0;
  private silentRun = 0;
  private lastVoicedT = 0;

  private speechStartHandlers: Array<(t: number) => void> = [];
  private endpointHandlers: Array<(speechEndT: number, endpointT: number) => void> = [];

  constructor(private readonly vad: SileroVad, opts: SileroEndpointerOptions) {
    this.threshold = opts.threshold ?? 0.5;
    this.negThreshold = opts.negThreshold ?? 0.35;
    this.minSpeechWindows = Math.max(1, Math.round((opts.minSpeechMs ?? 96) / WINDOW_MS));
    this.silenceWindows = Math.max(1, Math.round(opts.silenceMs / WINDOW_MS));
  }

  pushAudio(frame: Buffer, t: number): void {
    const samples = frame.length >> 1;
    for (let i = 0; i < samples; i++) {
      this.buf[this.bufLen++] = frame.readInt16LE(i * 2) / 32768;
      if (this.bufLen === SileroVad.WINDOW) {
        const window = this.buf;
        this.buf = new Float32Array(SileroVad.WINDOW);
        this.bufLen = 0;
        // Serialize inference: the model is recurrent, order matters.
        this.queue = this.queue.then(() => this.onWindow(window, t)).catch((err) => {
          console.error("[silero] inference failed", err);
        });
      }
    }
  }

  private async onWindow(window: Float32Array, t: number): Promise<void> {
    if (this.closed) return;
    const p = await this.vad.process(window);

    if (p >= this.threshold) {
      this.lastVoicedT = t;
      this.silentRun = 0;
      this.voicedRun++;
      if (!this.inSpeech && this.voicedRun >= this.minSpeechWindows) {
        this.inSpeech = true;
        this.speechStartHandlers.forEach((h) => h(t));
      }
      return;
    }

    if (p < this.negThreshold) this.voicedRun = 0;
    if (!this.inSpeech) return;

    // In speech: windows between negThreshold and threshold neither extend nor end speech.
    if (p < this.negThreshold && ++this.silentRun >= this.silenceWindows) {
      this.inSpeech = false;
      this.silentRun = 0;
      this.voicedRun = 0;
      const endpointT = now();
      this.endpointHandlers.forEach((h) => h(this.lastVoicedT, endpointT));
    }
  }

  onSpeechStart(h: (t: number) => void): void {
    this.speechStartHandlers.push(h);
  }
  onEndpoint(h: (speechEndT: number, endpointT: number) => void): void {
    this.endpointHandlers.push(h);
  }
  close(): void {
    this.closed = true;
  }
}
