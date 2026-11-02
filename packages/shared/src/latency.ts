/** Per-turn latency stages, all on the orchestrator's monotonic clock (ms). */
export const LATENCY_STAGES = [
  "speech_end",
  "endpoint",
  "stt_final",
  "llm_request",
  "llm_first_token",
  "tts_first_send",
  "tts_first_byte",
  "audio_first_out",
] as const;

export type LatencyStage = (typeof LATENCY_STAGES)[number];

/** One JSONL line per completed turn. Shape is stable so it can load into ClickHouse later. */
export interface TurnLatencyRecord {
  workspaceId: string;
  agentId: string;
  sessionId: string;
  turnId: number;
  stages: Partial<Record<LatencyStage, number>>;
  /** audio_first_out − speech_end. Excludes network + browser playout. */
  serverV2vMs: number | null;
  interrupted: boolean;
  cacheReadInputTokens?: number;
  wallClock: string;
}
