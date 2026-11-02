/**
 * Audio format declared by a Transport. STT/TTS clients are configured from this,
 * never hardcoded — browser WS uses PCM16 @ 16 kHz, Twilio Media Streams uses μ-law @ 8 kHz.
 */
export type AudioEncoding = "pcm_s16le" | "mulaw";

export interface AudioFormat {
  encoding: AudioEncoding;
  sampleRate: 8000 | 16000 | 24000 | 48000;
  channels: 1;
}

export const BROWSER_PCM16: AudioFormat = { encoding: "pcm_s16le", sampleRate: 16000, channels: 1 };
export const TWILIO_MULAW: AudioFormat = { encoding: "mulaw", sampleRate: 8000, channels: 1 };
