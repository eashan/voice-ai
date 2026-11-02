import type { AgentConfig, AgentState, LatencyStage, TurnLatencyRecord } from "@voiceforge/shared";
import type { Transport } from "../transport/Transport.js";
import type {
  ChatMessage,
  LlmProvider,
  LlmTurn,
  LlmTurnResult,
  SttProvider,
  SttSession,
  TtsProvider,
  TtsSession,
} from "../providers/types.js";
import type { Endpointer } from "../endpointing/Endpointer.js";
import { ProviderVadEndpointer } from "../endpointing/ProviderVadEndpointer.js";
import { SileroEndpointer } from "../endpointing/SileroEndpointer.js";
import { SileroVad, loadSileroModel } from "../endpointing/SileroVad.js";
import { buildSystemPrompt } from "../config/loadAgent.js";
import { logTurn, now } from "../metrics/latencyLog.js";
import { ClauseChunker } from "./ClauseChunker.js";
import { Speaker, spokenTextAt, type Segment } from "./Speaker.js";

/** Keep the prompt small: last N messages of conversation history. */
const MAX_HISTORY_MESSAGES = 20;

/**
 * Speculative LLM start on the latest partial at endpoint time (PRD LR-7). OFF by default:
 * ElevenLabs partials lag ~1 s, so at endpoint the partial is missing or cut mid-word (see docs/M0_PLAN.md).
 * Even when on, audio is held until the final transcript confirms the turn.
 */
const SPECULATIVE = process.env.SPECULATIVE_LLM === "1";

export interface CallLimits {
  maxCallMs: number;
  /** Hang up after this long with nobody speaking. */
  silenceHangupMs: number;
  /** Checked every second; true ends the call (daily demo budget). */
  budgetExhausted(): boolean;
}
type EndReason = "max_duration" | "silence_timeout" | "budget_exhausted" | "error";

const LLM_FAILURE_LINE = "Sorry, I had trouble with that. Could you say it again?";

/** Loose equality for "did the final transcript change the meaning?" */
const normalize = (s: string) =>
  s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
const join = (...parts: string[]) => parts.filter(Boolean).join(" ");
/** How an interrupted reply is stored in history. */
const truncated = (spoken: string) => `${spoken}…`;

interface ActiveTurn {
  turnId: number;
  userText: string;
  llm: LlmTurn;
  /** True once the STT final transcript agrees with userText. Audio is held until then. */
  confirmed: boolean;
  speculative: "hit" | "miss" | "off";
  /** Set when the LLM stream has ended (not aborted). */
  result: LlmTurnResult | null;
  chunker: ClauseChunker;
  /** TTS chunks produced before confirmation. */
  held: string[];
  /** speaker.begin() called for this turn. */
  speaking: boolean;
  /** Index of this turn's user message in history once committed. */
  historyIndex: number | null;
}

/**
 * One live call: audio → endpointer + STT → Claude (streamed) → clause chunker → TTS → audio out.
 *
 * Turn-taking:
 * - Barge-in: user speech while the agent is thinking/speaking cancels the LLM + TTS and stops client playback.
 *   History keeps only what the user heard (client reports exact ms played; server estimates until then).
 * - If the user resumes speaking before any reply audio was heard, the new speech is treated as a continuation
 *   of the previous utterance (fixes "cut off after a short pause").
 */
export class Session {
  private stt: SttSession | null = null;
  private tts: TtsSession | null = null;
  private speaker!: Speaker;
  private endpointer: Endpointer | null = null;
  private readonly system: string;
  private history: ChatMessage[] = [];
  /** Bumped on every history push, so stale playback reports can't edit the wrong message. */
  private historyVersion = 0;
  private turnId = 0;
  private stages: Partial<Record<LatencyStage, number>> = {};
  private lastPartial = "";
  private active: ActiveTurn | null = null;
  private state: AgentState | null = null;
  private userSpeaking = false;
  /** User text from an utterance whose reply was cancelled before it was heard. */
  private carryText = "";
  private lastInterrupt: { turnId: number; segments: Segment[]; historyIndex: number; version: number } | null = null;
  private closed = false;
  private readonly startedAt = now();
  /** Last time anyone spoke (user speech start/end, or agent finishing a reply). */
  private lastActivity = now();
  private limitTimer: NodeJS.Timeout | null = null;

  constructor(
    readonly id: string,
    private readonly agent: AgentConfig,
    private readonly transport: Transport,
    private readonly sttProvider: SttProvider,
    private readonly llm: LlmProvider,
    private readonly ttsProvider: TtsProvider,
    private readonly limits: CallLimits,
  ) {
    this.system = buildSystemPrompt(agent);
  }

  async start(): Promise<void> {
    const { turnTaking, stt: sttCfg } = this.agent;
    const useProviderVad = turnTaking.endpointer === "provider_vad";

    // Open STT + TTS, load VAD and pre-warm the prompt cache in parallel (PRD LR-10).
    const [stt, tts, vadModel] = await Promise.all([
      this.sttProvider.open({
        format: this.transport.inputFormat,
        language: sttCfg.language,
        keyterms: sttCfg.keyterms,
        providerVad: useProviderVad ? { silenceMs: turnTaking.silenceMs } : undefined,
      }),
      this.ttsProvider.open({ format: this.transport.outputFormat, voiceId: this.agent.voice.voiceId }),
      useProviderVad ? Promise.resolve(null) : loadSileroModel(),
      this.llm.prewarm(this.system),
    ]);
    this.stt = stt;
    this.tts = tts;
    this.speaker = new Speaker(tts, this.transport);
    tts.onError((code, message) => {
      console.error(`[session ${this.id}] tts ${code}: ${message}`);
      this.transport.sendEvent({ type: "error", code: `tts_${code}`, message });
    });

    if (useProviderVad) {
      // Endpointer A: STT commit = endpoint. Must subscribe to STT before the session does.
      this.endpointer = new ProviderVadEndpointer(stt);
      this.endpointer.onEndpoint((speechEndT, endpointT) => this.onEndpoint(speechEndT, endpointT));
    } else {
      // Endpointer B: local Silero VAD decides; we commit STT manually and may start the LLM early.
      this.endpointer = new SileroEndpointer(new SileroVad(vadModel!), { silenceMs: turnTaking.silenceMs });
      this.endpointer.onEndpoint((speechEndT, endpointT) => {
        this.onEndpoint(speechEndT, endpointT);
        stt.commit();
        if (SPECULATIVE && this.lastPartial) this.startLlm(this.lastPartial, "hit");
        else if (SPECULATIVE) console.log(`[session ${this.id}] no partial at endpoint`);
      });
    }
    this.endpointer.onSpeechStart(() => this.onSpeechStart());

    stt.onPartial((text) => {
      this.lastPartial = text;
      this.transport.sendEvent({ type: "transcript", turnId: this.turnId, text, final: false });
    });
    stt.onFinal((text, t) => this.onFinalTranscript(text, t));
    stt.onError((code, message) => {
      console.error(`[session ${this.id}] stt ${code}: ${message}`);
      this.transport.sendEvent({ type: "error", code: `stt_${code}`, message });
      if (code === "closed") this.end("error"); // can't hear the user any more
    });

    this.transport.onAudio((frame) => {
      if (this.closed) return;
      const t = now();
      stt.pushAudio(frame);
      this.endpointer?.pushAudio(frame, t);
    });
    this.transport.onClose(() => void this.close());
    this.limitTimer = setInterval(() => this.checkLimits(), 1000);
  }

  private checkLimits(): void {
    const t = now();
    if (this.limits.budgetExhausted()) this.end("budget_exhausted");
    else if (t - this.startedAt > this.limits.maxCallMs) this.end("max_duration");
    else if (
      !this.userSpeaking &&
      !this.active &&
      !this.speaker.busy &&
      t - this.lastActivity > this.limits.silenceHangupMs
    ) {
      this.end("silence_timeout");
    }
  }

  /** Speak the configured greeting (not part of LLM history). Call after `ready`. */
  greet(): void {
    const text = this.agent.greeting;
    if (!text) {
      this.setState("listening");
      return;
    }
    this.transport.sendEvent({ type: "agent_text", turnId: -1, text });
    this.speaker.begin(-1, {
      onFirstAudioOut: () => !this.userSpeaking && this.setState("speaking"),
      onFinished: () => {
        this.lastActivity = now();
        this.setState(this.userSpeaking ? "user_speaking" : "listening");
      },
    });
    this.speaker.say(text);
    this.speaker.endText();
  }

  /** Client reply to stop_playback: exact ms of the interrupted reply that was played. Refines history. */
  onPlaybackStopped(turnId: number, playedMs: number): void {
    const li = this.lastInterrupt;
    if (!li || li.turnId !== turnId || li.version !== this.historyVersion) return;
    const spoken = spokenTextAt(li.segments, playedMs);
    if (!spoken) return;
    this.history[li.historyIndex + 1] = { role: "assistant", content: truncated(spoken) };
  }

  // ── turn-taking ────────────────────────────────────────────────────────────

  private onSpeechStart(): void {
    this.userSpeaking = true;
    this.lastActivity = now();
    if (this.agent.turnTaking.bargeIn && (this.active || this.speaker.busy)) this.bargeIn();
    this.setState("user_speaking");
  }

  private onEndpoint(speechEndT: number, endpointT: number): void {
    this.userSpeaking = false;
    this.lastActivity = now();
    // With bargeIn off the agent isn't cut off at speech start, but a new user turn still replaces the reply.
    if (this.active || this.speaker.busy) this.bargeIn();
    this.stage("speech_end", speechEndT);
    this.stage("endpoint", endpointT);
    this.setState("thinking");
  }

  private onFinalTranscript(text: string, t: number): void {
    this.lastPartial = "";
    const turn = this.active;

    if (!text) {
      // VAD fired on noise: cancel any speculative run.
      if (turn && !turn.confirmed) this.dropActive();
      if (!this.userSpeaking && this.carryText && !this.active) {
        // The user's real utterance was put on hold by this noise: answer it now.
        const userText = this.carryText;
        this.carryText = "";
        this.startLlm(userText, "off");
        this.confirm(this.active!);
        return;
      }
      this.stages = {};
      if (!this.active && !this.speaker.busy) this.setState(this.userSpeaking ? "user_speaking" : "listening");
      return;
    }

    if (this.userSpeaking) {
      // The user kept talking after the endpoint: hold this part and answer the whole thing at the next endpoint.
      this.carryText = join(this.carryText, text);
      this.transport.sendEvent({ type: "transcript", turnId: this.turnId, text: this.carryText, final: false });
      return;
    }

    const userText = join(this.carryText, text);
    this.carryText = "";
    this.stage("stt_final", t);
    this.transport.sendEvent({ type: "transcript", turnId: this.turnId, text: userText, final: true });

    if (turn && !turn.confirmed && normalize(turn.userText) === normalize(userText)) {
      turn.userText = userText; // keep punctuation of the final for history
      this.confirm(turn);
      return;
    }
    if (turn && !turn.confirmed) {
      console.log(
        `[session ${this.id}] speculative miss: partial=${JSON.stringify(turn.userText)} final=${JSON.stringify(userText)}`,
      );
    }
    this.startLlm(userText, turn && !turn.confirmed ? "miss" : "off");
    this.confirm(this.active!);
  }

  /** Cancel the current reply. Keeps only what the user heard; if nothing, carries their words forward. */
  private bargeIn(): void {
    const cut = this.speaker.interrupt();
    const turn = this.active;
    if (!turn) return; // greeting, or nothing in progress
    this.active = null;
    turn.llm.abort();

    const spoken = cut?.turnId === turn.turnId ? cut.spokenText : "";
    if (!spoken) {
      if (turn.historyIndex != null) {
        this.history.splice(turn.historyIndex, 2);
        this.historyVersion++;
      }
      if (turn.confirmed) this.carryText = join(turn.userText, this.carryText);
    } else {
      if (turn.historyIndex != null) {
        this.history[turn.historyIndex + 1] = { role: "assistant", content: truncated(spoken) };
      } else {
        turn.historyIndex = this.pushHistory(turn.userText, truncated(spoken));
      }
      this.historyVersion++;
      this.lastInterrupt = {
        turnId: turn.turnId,
        segments: cut!.segments,
        historyIndex: turn.historyIndex,
        version: this.historyVersion,
      };
    }
    console.log(`[session ${this.id}] barge-in on turn ${turn.turnId}: heard ${JSON.stringify(spoken)}`);
    this.completeTurn(turn, { interrupted: true, agentText: spoken });
  }

  // ── LLM → TTS ──────────────────────────────────────────────────────────────

  private startLlm(userText: string, speculative: ActiveTurn["speculative"]): void {
    if (this.active) this.dropActive();

    this.stage("llm_request", now());
    delete this.stages.llm_first_token;
    const llm = this.llm.streamTurn({
      system: this.system,
      history: [...this.history, { role: "user", content: userText }],
    });
    const turn: ActiveTurn = {
      turnId: this.turnId,
      userText,
      llm,
      confirmed: false,
      speculative,
      result: null,
      chunker: new ClauseChunker(),
      held: [],
      speaking: false,
      historyIndex: null,
    };
    this.active = turn;

    void (async () => {
      let first = true;
      for await (const delta of llm.textStream) {
        if (this.active !== turn) return; // superseded
        if (first) {
          this.stage("llm_first_token", now());
          first = false;
        }
        this.transport.sendEvent({ type: "agent_text", turnId: turn.turnId, text: delta });
        for (const chunk of turn.chunker.push(delta)) this.emitChunk(turn, chunk);
      }
    })();

    void llm.done.then((result) => {
      if (this.active !== turn || result.aborted) return;
      if (result.error) {
        console.error(`[session ${this.id}] llm error: ${result.error}`);
        this.transport.sendEvent({ type: "error", code: "llm_error", message: result.error });
      }
      const extra = result.refusal ? result.text : result.error && !result.text ? LLM_FAILURE_LINE : "";
      if (extra) {
        this.transport.sendEvent({ type: "agent_text", turnId: turn.turnId, text: extra });
        this.emitChunk(turn, extra);
      }
      for (const chunk of turn.chunker.flush()) this.emitChunk(turn, chunk);
      turn.result = result;
      this.maybeCommit(turn);
    });
  }

  private emitChunk(turn: ActiveTurn, text: string): void {
    if (!turn.confirmed) {
      turn.held.push(text);
      return;
    }
    if (!turn.speaking) {
      turn.speaking = true;
      this.stage("tts_first_send", now());
      this.speaker.begin(turn.turnId, {
        onFirstAudioByte: (t) => this.active === turn && this.stage("tts_first_byte", t),
        onFirstAudioOut: (t) => {
          if (this.active !== turn) return;
          this.stage("audio_first_out", t);
          this.setState("speaking");
        },
        onFinished: () => this.finishTurn(turn),
      });
    }
    this.speaker.say(text);
  }

  private confirm(turn: ActiveTurn): void {
    turn.confirmed = true;
    for (const chunk of turn.held.splice(0)) this.emitChunk(turn, chunk);
    this.maybeCommit(turn);
  }

  /** LLM done + transcript confirmed: write history, then let the speaker finish playing. */
  private maybeCommit(turn: ActiveTurn): void {
    const result = turn.result;
    if (!result || !turn.confirmed || this.active !== turn || turn.historyIndex != null) return;
    if (result.text) turn.historyIndex = this.pushHistory(turn.userText, result.text);
    if (turn.speaking) this.speaker.endText();
    else this.finishTurn(turn); // nothing to say
  }

  /** Reply fully played (or nothing to play). */
  private finishTurn(turn: ActiveTurn): void {
    if (this.active !== turn) return;
    this.active = null;
    this.lastActivity = now();
    this.completeTurn(turn, { interrupted: false, agentText: turn.result?.text });
    this.setState(this.userSpeaking ? "user_speaking" : "listening");
  }

  /** Abort the active turn without logging it (speculative restart / noise). */
  private dropActive(): void {
    const turn = this.active;
    if (!turn) return;
    this.active = null;
    turn.llm.abort();
    if (turn.speaking) this.speaker.interrupt();
  }

  private pushHistory(user: string, assistant: string): number {
    this.history.push({ role: "user", content: user }, { role: "assistant", content: assistant });
    if (this.history.length > MAX_HISTORY_MESSAGES) this.history = this.history.slice(-MAX_HISTORY_MESSAGES);
    this.historyVersion++;
    return this.history.length - 2;
  }

  // ── bookkeeping ────────────────────────────────────────────────────────────

  private setState(state: AgentState): void {
    if (state === this.state) return;
    this.state = state;
    this.transport.sendEvent({ type: "state", state });
  }

  private stage(stage: LatencyStage, t: number): void {
    this.stages[stage] = t;
    this.transport.sendEvent({ type: "stage", turnId: this.turnId, stage, t });
  }

  private completeTurn(turn: ActiveTurn, extra: { interrupted: boolean; agentText?: string }): void {
    const s = this.stages;
    const record: TurnLatencyRecord = {
      workspaceId: this.agent.workspaceId,
      agentId: this.agent.agentId,
      sessionId: this.id,
      turnId: this.turnId,
      stages: s,
      serverV2vMs: s.audio_first_out != null && s.speech_end != null ? s.audio_first_out - s.speech_end : null,
      wallClock: new Date().toISOString(),
      speculative: turn.speculative,
      userText: turn.userText,
      cacheReadInputTokens: turn.result?.cacheReadInputTokens,
      cacheCreationInputTokens: turn.result?.cacheCreationInputTokens,
      ...extra,
    };
    logTurn(record);
    this.transport.sendEvent({ type: "turn_complete", record });
    this.turnId++;
    this.stages = {};
  }

  end(reason: EndReason): void {
    if (this.closed) return;
    console.log(`[session ${this.id}] ending: ${reason}`);
    this.transport.sendEvent({ type: "ended", reason });
    this.transport.close();
    void this.close();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.limitTimer) clearInterval(this.limitTimer);
    this.active?.llm.abort();
    this.active = null;
    this.speaker?.interrupt();
    this.endpointer?.close();
    await Promise.all([this.stt?.close(), this.tts?.close()]);
  }
}
