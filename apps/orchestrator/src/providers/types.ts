import type { AudioFormat } from "@voiceforge/shared";

/** Streaming STT over one persistent connection per session (PRD LR-3). */
export interface SttSession {
  pushAudio(frame: Buffer): void;
  /** Manual end-of-utterance (Endpointer B). Flushes buffered audio, then commits. */
  commit(): void;
  onPartial(handler: (text: string) => void): void;
  /** Final (committed) transcript for one utterance; `t` = arrival time on the monotonic clock. May be "" (noise). */
  onFinal(handler: (text: string, t: number) => void): void;
  onError(handler: (code: string, message: string) => void): void;
  close(): Promise<void>;
}
export interface SttProvider {
  open(opts: {
    format: AudioFormat;
    language: string;
    keyterms?: string[];
    /** If set, the provider decides end-of-turn (Endpointer A) using this silence threshold. */
    providerVad?: { silenceMs: number };
  }): Promise<SttSession>;
}

/** Streaming LLM turn; abort() is used for barge-in / speculative restarts. */
export interface LlmTurn {
  /** Text deltas as they arrive. Ends early (without throwing) if aborted. */
  textStream: AsyncIterable<string>;
  abort(): void;
  /** Resolves when the stream ends or is aborted. Never rejects. */
  done: Promise<LlmTurnResult>;
}
export interface LlmTurnResult {
  text: string;
  aborted: boolean;
  error?: string;
  refusal?: boolean;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}
export type ChatMessage = { role: "user" | "assistant"; content: string };

export interface LlmProvider {
  /** Write the static prefix (system prompt) to the prompt cache before the first turn. */
  prewarm(system: string): Promise<void>;
  streamTurn(opts: { system: string; history: ChatMessage[] }): LlmTurn;
}

/** Streaming TTS over one persistent connection per session. */
export interface TtsSession {
  /** Synthesize one chunk of text now (one clause/sentence). Chunks are spoken in order. */
  speak(text: string): void;
  /** Barge-in: cancel everything queued or in flight. Audio still arriving for it is discarded. */
  clear(): void;
  onAudio(handler: (chunk: Buffer, t: number) => void): void;
  /** One speak() chunk has been fully synthesized (all of its audio delivered). */
  onChunkDone(handler: () => void): void;
  onError(handler: (code: string, message: string) => void): void;
  close(): Promise<void>;
}
export interface TtsProvider {
  open(opts: { format: AudioFormat; voiceId: string }): Promise<TtsSession>;
}
