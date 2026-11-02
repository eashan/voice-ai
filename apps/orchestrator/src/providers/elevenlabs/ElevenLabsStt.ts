import WebSocket from "ws";
import type { AudioFormat } from "@voiceforge/shared";
import type { SttProvider, SttSession } from "../types.js";
import { now } from "../../metrics/latencyLog.js";

/**
 * ElevenLabs Scribe realtime STT (wss /v1/speech-to-text/realtime, model scribe_v2_realtime).
 * Protocol: JSON `input_audio_chunk` with base64 audio; server sends
 * session_started / partial_transcript / committed_transcript / <error types>.
 */
const URL_BASE = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";

/** Docs recommend 0.1–1 s chunks; smaller = lower latency, more overhead. */
const CHUNK_MS = Number(process.env.ELEVENLABS_CHUNK_MS ?? 100);

const ERROR_TYPES = new Set([
  "error", "auth_error", "quota_exceeded", "commit_throttled", "unaccepted_terms", "rate_limited",
  "queue_overflow", "resource_exhausted", "session_time_limit_exceeded", "input_error",
  "invalid_request", "chunk_size_exceeded", "insufficient_audio_activity", "transcriber_error",
]);

function audioFormatParam(f: AudioFormat): string {
  if (f.encoding === "mulaw" && f.sampleRate === 8000) return "ulaw_8000";
  if (f.encoding === "pcm_s16le") return `pcm_${f.sampleRate}`;
  throw new Error(`ElevenLabs STT: unsupported audio format ${f.encoding}@${f.sampleRate}`);
}

export class ElevenLabsStt implements SttProvider {
  constructor(private readonly apiKey = process.env.ELEVENLABS_API_KEY ?? "") {
    if (!this.apiKey) throw new Error("ELEVENLABS_API_KEY is not set");
  }

  open(opts: Parameters<SttProvider["open"]>[0]): Promise<SttSession> {
    const params = new URLSearchParams({
      model_id: "scribe_v2_realtime",
      audio_format: audioFormatParam(opts.format),
      language_code: opts.language,
      commit_strategy: opts.providerVad ? "vad" : "manual",
    });
    for (const term of opts.keyterms ?? []) params.append("keyterms", term);
    if (opts.providerVad) {
      // Docs: accepted range 0.192–3.0 s.
      const secs = Math.min(3, Math.max(0.192, opts.providerVad.silenceMs / 1000));
      params.set("vad_silence_threshold_secs", secs.toFixed(3));
    }
    const ws = new WebSocket(`${URL_BASE}?${params}`, { headers: { "xi-api-key": this.apiKey } });
    const session = new ElevenLabsSttSession(ws, opts.format);

    return new Promise((resolve, reject) => {
      const fail = (err: Error) => reject(err);
      ws.once("error", fail);
      ws.once("unexpected-response", (_req, res) =>
        fail(new Error(`ElevenLabs STT handshake failed: HTTP ${res.statusCode}`)),
      );
      ws.once("open", () => {
        ws.off("error", fail);
        resolve(session);
      });
    });
  }
}

class ElevenLabsSttSession implements SttSession {
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private readonly chunkBytes: number;
  private partialHandlers: Array<(text: string) => void> = [];
  private finalHandlers: Array<(text: string, t: number) => void> = [];
  private errorHandlers: Array<(code: string, message: string) => void> = [];

  constructor(private readonly ws: WebSocket, private readonly format: AudioFormat) {
    const bytesPerSample = format.encoding === "pcm_s16le" ? 2 : 1;
    this.chunkBytes = Math.round((format.sampleRate * bytesPerSample * CHUNK_MS) / 1000);

    ws.on("message", (raw) => {
      const t = now();
      let msg: { message_type?: string; text?: string; error?: string };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const type = msg.message_type ?? "";
      if (type === "partial_transcript") {
        if (msg.text) this.partialHandlers.forEach((h) => h(msg.text!));
      } else if (type === "committed_transcript") {
        const text = (msg.text ?? "").trim();
        this.finalHandlers.forEach((h) => h(text, t));
      } else if (ERROR_TYPES.has(type)) {
        this.errorHandlers.forEach((h) => h(type, msg.error ?? type));
      } else if (type === "session_started") {
        if (process.env.DEBUG_STT) console.log("[elevenlabs] session_started", JSON.stringify(msg));
      }
    });
    ws.on("error", (err) => this.errorHandlers.forEach((h) => h("socket_error", err.message)));
    ws.on("close", (code, reason) => {
      if (code !== 1000) this.errorHandlers.forEach((h) => h("closed", `${code} ${reason.toString()}`));
    });
  }

  pushAudio(frame: Buffer): void {
    this.pending.push(frame);
    this.pendingBytes += frame.length;
    if (this.pendingBytes >= this.chunkBytes) this.send(false);
  }

  commit(): void {
    this.send(true);
  }

  private send(commit: boolean): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    const audio = Buffer.concat(this.pending, this.pendingBytes);
    this.pending = [];
    this.pendingBytes = 0;
    this.ws.send(
      JSON.stringify({
        message_type: "input_audio_chunk",
        audio_base_64: audio.toString("base64"),
        commit,
        sample_rate: this.format.sampleRate,
      }),
    );
  }

  onPartial(h: (text: string) => void): void {
    this.partialHandlers.push(h);
  }
  onFinal(h: (text: string, t: number) => void): void {
    this.finalHandlers.push(h);
  }
  onError(h: (code: string, message: string) => void): void {
    this.errorHandlers.push(h);
  }

  async close(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.close(1000);
  }
}
