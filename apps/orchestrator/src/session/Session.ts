import type { AgentConfig, LatencyStage, TurnLatencyRecord } from "@voiceforge/shared";
import type { Transport } from "../transport/Transport.js";
import type { SttProvider, SttSession } from "../providers/types.js";
import type { Endpointer } from "../endpointing/Endpointer.js";
import { ProviderVadEndpointer } from "../endpointing/ProviderVadEndpointer.js";
import { SileroEndpointer } from "../endpointing/SileroEndpointer.js";
import { SileroVad, loadSileroModel } from "../endpointing/SileroVad.js";
import { logTurn, now } from "../metrics/latencyLog.js";

/**
 * One live call. Week 1: audio → STT → endpoint → transcript + latency stages to the browser.
 * Week 2 adds LLM → clause chunker → TTS and barge-in.
 */
export class Session {
  private stt: SttSession | null = null;
  private endpointer: Endpointer | null = null;
  private turnId = 0;
  private stages: Partial<Record<LatencyStage, number>> = {};
  private closed = false;

  constructor(
    readonly id: string,
    private readonly agent: AgentConfig,
    private readonly transport: Transport,
    private readonly sttProvider: SttProvider,
  ) {}

  async start(): Promise<void> {
    const { turnTaking, stt: sttCfg } = this.agent;
    const useProviderVad = turnTaking.endpointer === "provider_vad";
    this.stt = await this.sttProvider.open({
      format: this.transport.inputFormat,
      language: sttCfg.language,
      keyterms: sttCfg.keyterms,
      providerVad: useProviderVad ? { silenceMs: turnTaking.silenceMs } : undefined,
    });
    const stt = this.stt;

    if (useProviderVad) {
      // Endpointer A: STT commit = endpoint. Must subscribe to STT before the session does.
      this.endpointer = new ProviderVadEndpointer(stt);
      this.endpointer.onEndpoint((speechEndT, endpointT) => {
        this.stage("speech_end", speechEndT);
        this.stage("endpoint", endpointT);
      });
    } else {
      // Endpointer B: local Silero VAD decides; we commit STT manually.
      this.endpointer = new SileroEndpointer(new SileroVad(await loadSileroModel()), {
        silenceMs: turnTaking.silenceMs,
      });
      this.endpointer.onEndpoint((speechEndT, endpointT) => {
        this.stage("speech_end", speechEndT);
        this.stage("endpoint", endpointT);
        stt.commit();
      });
    }
    this.endpointer.onSpeechStart(() => {
      // Week 2: barge-in if agent is speaking.
    });

    stt.onPartial((text) => this.transport.sendEvent({ type: "transcript", turnId: this.turnId, text, final: false }));
    stt.onFinal((text, t) => {
      if (!text) {
        // VAD fired on noise / nothing intelligible: drop this turn's stages, don't advance.
        this.stages = {};
        return;
      }
      this.stage("stt_final", t);
      this.transport.sendEvent({ type: "transcript", turnId: this.turnId, text, final: true });
      this.completeTurn(false); // Week 2: completes after agent audio instead.
    });
    stt.onError((code, message) => {
      console.error(`[session ${this.id}] stt ${code}: ${message}`);
      this.transport.sendEvent({ type: "error", code: `stt_${code}`, message });
    });

    this.transport.onAudio((frame) => {
      if (this.closed) return;
      const t = now();
      stt.pushAudio(frame);
      this.endpointer?.pushAudio(frame, t);
    });
    this.transport.onClose(() => void this.close());
  }

  private stage(stage: LatencyStage, t: number): void {
    this.stages[stage] = t;
    this.transport.sendEvent({ type: "stage", turnId: this.turnId, stage, t });
  }

  private completeTurn(interrupted: boolean): void {
    const s = this.stages;
    const record: TurnLatencyRecord = {
      workspaceId: this.agent.workspaceId,
      agentId: this.agent.agentId,
      sessionId: this.id,
      turnId: this.turnId,
      stages: s,
      serverV2vMs: s.audio_first_out != null && s.speech_end != null ? s.audio_first_out - s.speech_end : null,
      interrupted,
      wallClock: new Date().toISOString(),
    };
    logTurn(record);
    this.transport.sendEvent({ type: "turn_complete", record });
    this.turnId++;
    this.stages = {};
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.endpointer?.close();
    await this.stt?.close();
  }
}
