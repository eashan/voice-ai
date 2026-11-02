/**
 * Decides when the user has finished speaking.
 * A: provider VAD (ElevenLabs Scribe commit). B: Silero VAD in-process. Later: semantic turn detection.
 */
export interface EndpointEvents {
  /** User started speaking (drives barge-in). */
  onSpeechStart(handler: (t: number) => void): void;
  /** End of turn decided. `speechEndT` = time of the last voiced frame. */
  onEndpoint(handler: (speechEndT: number, endpointT: number) => void): void;
}

export interface Endpointer extends EndpointEvents {
  pushAudio(frame: Buffer, t: number): void;
  close(): void;
}
