import type { AudioFormat } from "./audio.js";
import type { LatencyStage, TurnLatencyRecord } from "./latency.js";

/**
 * Browser <-> orchestrator WebSocket protocol.
 * Binary frames = raw audio in the negotiated AudioFormat. Text frames = JSON messages below.
 */
export type ClientMessage =
  | { type: "start"; token: string }
  | { type: "playback_stopped"; reason: "barge_in" | "ended" }
  | { type: "hangup" };

export type ServerMessage =
  | { type: "ready"; sessionId: string; inputFormat: AudioFormat; outputFormat: AudioFormat }
  | { type: "transcript"; turnId: number; text: string; final: boolean }
  | { type: "agent_text"; turnId: number; text: string }
  | { type: "stage"; turnId: number; stage: LatencyStage; t: number }
  | { type: "turn_complete"; record: TurnLatencyRecord }
  | { type: "stop_playback" }
  | { type: "error"; code: string; message: string }
  | { type: "ended"; reason: "hangup" | "max_duration" | "silence_timeout" | "budget_exhausted" | "disabled" };
