import type { AudioFormat } from "@voiceforge/shared";

/** Streaming STT over one persistent connection per session (PRD LR-3). */
export interface SttSession {
  pushAudio(frame: Buffer): void;
  onPartial(handler: (text: string) => void): void;
  onFinal(handler: (text: string, t: number) => void): void;
  close(): Promise<void>;
}
export interface SttProvider {
  open(opts: { format: AudioFormat; language: string }): Promise<SttSession>;
}

/** Streaming LLM turn; abort() is used for barge-in. */
export interface LlmTurn {
  textStream: AsyncIterable<string>;
  abort(): void;
  /** Resolves when the stream ends (or is aborted). */
  done: Promise<{ cacheReadInputTokens?: number }>;
}
export interface LlmProvider {
  streamTurn(opts: {
    system: string;
    history: Array<{ role: "user" | "assistant"; content: string }>;
  }): LlmTurn;
}

/** Streaming TTS over one persistent connection per session. */
export interface TtsSession {
  /** Send one clause of text. */
  speak(text: string): void;
  flush(): void;
  /** Cancel current utterance (barge-in). */
  clear(): void;
  onAudio(handler: (chunk: Buffer, t: number) => void): void;
  close(): Promise<void>;
}
export interface TtsProvider {
  open(opts: { format: AudioFormat; voiceId: string }): Promise<TtsSession>;
}
