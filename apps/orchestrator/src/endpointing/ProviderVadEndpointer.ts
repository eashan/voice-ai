import type { Endpointer } from "./Endpointer.js";
import type { SttSession } from "../providers/types.js";
import { EnergyDetector } from "./EnergyDetector.js";

/**
 * Endpointer A: the STT provider's VAD decides end-of-turn (ElevenLabs commit_strategy=vad).
 * The committed transcript IS the endpoint. Our EnergyDetector supplies speech start and the
 * last-voiced-frame time so the waterfall can show how long provider endpointing really took.
 *
 * Input must be PCM16 (μ-law transports must decode before pushAudio — TODO for Twilio).
 */
export class ProviderVadEndpointer implements Endpointer {
  private readonly energy = new EnergyDetector();
  private speechStartHandlers: Array<(t: number) => void> = [];
  private endpointHandlers: Array<(speechEndT: number, endpointT: number) => void> = [];

  constructor(stt: SttSession) {
    stt.onFinal((text, t) => {
      if (!text) return;
      const speechEndT = this.energy.lastVoicedT ?? t;
      this.energy.resetTurn();
      this.endpointHandlers.forEach((h) => h(speechEndT, t));
    });
  }

  pushAudio(frame: Buffer, t: number): void {
    if (this.energy.push(frame, t) === "start") this.speechStartHandlers.forEach((h) => h(t));
  }

  onSpeechStart(h: (t: number) => void): void {
    this.speechStartHandlers.push(h);
  }
  onEndpoint(h: (speechEndT: number, endpointT: number) => void): void {
    this.endpointHandlers.push(h);
  }
  close(): void {}
}
