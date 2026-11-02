import type { AudioFormat } from "./audio.js";
import type { LatencyStage, TurnLatencyRecord } from "./latency.js";

/** Turn state machine (PRD): LISTENING → USER_SPEAKING → THINKING → SPEAKING. */
export type AgentState = "listening" | "user_speaking" | "thinking" | "speaking";

/**
 * Browser <-> orchestrator WebSocket protocol.
 * Binary frames = raw audio in the negotiated AudioFormat. Text frames = JSON messages below.
 */
export type ClientMessage =
  | { type: "start"; token: string }
  /** Reply to stop_playback: how much of the reply's audio (since its audio_start) was actually played. */
  | { type: "playback_stopped"; reason: "barge_in"; turnId: number; playedMs: number }
  | { type: "hangup" };

export type ServerMessage =
  | { type: "ready"; sessionId: string; inputFormat: AudioFormat; outputFormat: AudioFormat }
  | { type: "state"; state: AgentState }
  | { type: "transcript"; turnId: number; text: string; final: boolean }
  /** turnId -1 = greeting. */
  | { type: "agent_text"; turnId: number; text: string }
  /** All binary frames after this belong to this turn's reply (until the next audio_start). */
  | { type: "audio_start"; turnId: number }
  | { type: "stage"; turnId: number; stage: LatencyStage; t: number }
  | { type: "turn_complete"; record: TurnLatencyRecord }
  /** Barge-in: drop all queued audio now, then answer with playback_stopped. */
  | { type: "stop_playback" }
  | { type: "error"; code: string; message: string }
  | { type: "ended"; reason: "hangup" | "max_duration" | "silence_timeout" | "budget_exhausted" | "disabled" | "error" };
