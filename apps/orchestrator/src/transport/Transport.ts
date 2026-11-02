import type { AudioFormat, ServerMessage } from "@voiceforge/shared";

/**
 * A real-time audio leg to a caller. M0: browser WebSocket. Later: Twilio Media Streams, LiveKit.
 * The orchestrator core only talks to this interface.
 */
export interface Transport {
  readonly inputFormat: AudioFormat;
  readonly outputFormat: AudioFormat;
  onAudio(handler: (frame: Buffer) => void): void;
  onClose(handler: () => void): void;
  sendAudio(frame: Buffer): void;
  sendEvent(msg: ServerMessage): void;
  /** Drop any queued outbound audio (barge-in). */
  clearOutbound(): void;
  close(): void;
}
