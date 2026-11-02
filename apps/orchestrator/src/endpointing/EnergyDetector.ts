/**
 * Cheap RMS voice-activity tracker on PCM16 frames. Not used to decide endpoints in Endpointer A —
 * only to timestamp speech start / last voiced frame honestly for the latency waterfall and barge-in.
 * Replaced by Silero VAD in Endpointer B.
 */
export class EnergyDetector {
  private voicedRun = 0;
  speaking = false;
  lastVoicedT: number | null = null;

  constructor(
    /** RMS threshold in [0,1] of full scale. */
    private readonly threshold = Number(process.env.ENERGY_VAD_THRESHOLD ?? 0.02),
    /** Consecutive voiced frames needed to call it speech (debounces clicks). */
    private readonly minVoicedFrames = 3,
  ) {}

  /** Returns "start" on the frame where speech is first confirmed. */
  push(frame: Buffer, t: number): "start" | null {
    const samples = frame.length >> 1;
    if (samples === 0) return null;
    let sum = 0;
    for (let i = 0; i < samples; i++) {
      const s = frame.readInt16LE(i * 2) / 32768;
      sum += s * s;
    }
    const voiced = Math.sqrt(sum / samples) >= this.threshold;
    if (voiced) {
      this.lastVoicedT = t;
      this.voicedRun++;
      if (!this.speaking && this.voicedRun >= this.minVoicedFrames) {
        this.speaking = true;
        return "start";
      }
    } else {
      this.voicedRun = 0;
    }
    return null;
  }

  /** Called once a turn has been endpointed. */
  resetTurn(): void {
    this.speaking = false;
    this.voicedRun = 0;
  }
}
