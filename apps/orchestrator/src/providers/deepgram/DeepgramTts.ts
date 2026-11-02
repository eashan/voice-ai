import WebSocket from "ws";
import type { AudioFormat } from "@voiceforge/shared";
import type { TtsProvider, TtsSession } from "../types.js";
import { now } from "../../metrics/latencyLog.js";

const DG_SPEAK_URL = "wss://api.deepgram.com/v1/speak";

/**
 * Deepgram Aura streaming TTS over one persistent WebSocket per call.
 * Protocol: {"type":"Speak","text"} + {"type":"Flush"} → binary audio → {"type":"Flushed"}.
 * {"type":"Clear"} cancels; audio already in flight keeps arriving until {"type":"Cleared"}, so we drop it.
 */
export class DeepgramTts implements TtsProvider {
  async open({ format, voiceId }: { format: AudioFormat; voiceId: string }): Promise<TtsSession> {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) throw new Error("DEEPGRAM_API_KEY is not set");
    const params = new URLSearchParams({
      model: voiceId,
      encoding: format.encoding === "mulaw" ? "mulaw" : "linear16",
      sample_rate: String(format.sampleRate),
    });
    const session = new DeepgramTtsSession(`${DG_SPEAK_URL}?${params}`, apiKey, format.encoding === "pcm_s16le" ? 2 : 1);
    await session.connect();
    return session;
  }
}

class DeepgramTtsSession implements TtsSession {
  private ws: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  /** Messages queued while (re)connecting. */
  private outbox: string[] = [];
  /** Clears sent but not yet acked: drop audio + Flushed until then. */
  private pendingClears = 0;
  /** Odd trailing byte of a PCM16 chunk, prepended to the next one. */
  private carry: Buffer | null = null;
  private closed = false;

  private audioHandlers: Array<(chunk: Buffer, t: number) => void> = [];
  private chunkDoneHandlers: Array<() => void> = [];
  private errorHandlers: Array<(code: string, message: string) => void> = [];

  constructor(
    private readonly url: string,
    private readonly apiKey: string,
    private readonly bytesPerSample: number,
  ) {}

  connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    const attempt = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url, { headers: { Authorization: `Token ${this.apiKey}` } });
      ws.on("open", () => {
        this.ws = ws;
        for (const m of this.outbox.splice(0)) ws.send(m);
        resolve();
      });
      ws.on("message", (data, isBinary) => this.onMessage(data as Buffer, isBinary));
      ws.on("error", (err) => {
        reject(err);
        if (this.ws === ws) this.emitError("ws_error", err.message);
      });
      ws.on("close", (code, reason) => {
        const wasOpen = this.ws === ws;
        if (wasOpen) this.ws = null;
        this.connecting = null;
        this.pendingClears = 0;
        this.carry = null;
        // Idle timeouts are fine: we reconnect lazily on the next speak().
        if (wasOpen && !this.closed && code !== 1000) this.emitError("closed", `${code} ${reason.toString()}`);
      });
    });
    this.connecting = attempt;
    attempt.catch(() => {
      if (this.connecting === attempt) this.connecting = null;
    });
    return attempt;
  }

  speak(text: string): void {
    this.send({ type: "Speak", text });
    this.send({ type: "Flush" });
  }

  clear(): void {
    this.carry = null;
    if (this.outbox.length) {
      this.outbox = []; // never sent, nothing in flight
      return;
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.pendingClears++;
      this.ws.send(JSON.stringify({ type: "Clear" }));
    }
  }

  private send(msg: object): void {
    const m = JSON.stringify(msg);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(m);
      return;
    }
    this.outbox.push(m);
    this.connect().catch((err: Error) => {
      this.outbox = [];
      this.emitError("connect_failed", err.message);
    });
  }

  private onMessage(data: Buffer, isBinary: boolean): void {
    if (isBinary) {
      if (this.pendingClears > 0) return; // audio for a cancelled reply
      let buf = this.carry ? Buffer.concat([this.carry, data]) : data;
      this.carry = null;
      if (buf.length >= 44 && buf.toString("ascii", 0, 4) === "RIFF") buf = buf.subarray(44); // defensive: WAV header
      const rem = buf.length % this.bytesPerSample;
      if (rem) {
        this.carry = Buffer.from(buf.subarray(buf.length - rem));
        buf = buf.subarray(0, buf.length - rem);
      }
      if (buf.length === 0) return;
      const t = now();
      this.audioHandlers.forEach((h) => h(buf, t));
      return;
    }
    let msg: { type?: string; description?: string; err_msg?: string; [k: string]: unknown };
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    switch (msg.type) {
      case "Flushed":
        if (this.pendingClears === 0) this.chunkDoneHandlers.forEach((h) => h());
        break;
      case "Cleared":
        this.pendingClears = Math.max(0, this.pendingClears - 1);
        break;
      case "Warning":
        console.warn(`[deepgram tts] warning: ${JSON.stringify(msg)}`);
        break;
      case "Error":
        this.emitError("provider_error", msg.description ?? msg.err_msg ?? JSON.stringify(msg));
        break;
    }
  }

  private emitError(code: string, message: string): void {
    this.errorHandlers.forEach((h) => h(code, message));
  }

  onAudio(h: (chunk: Buffer, t: number) => void): void {
    this.audioHandlers.push(h);
  }
  onChunkDone(h: () => void): void {
    this.chunkDoneHandlers.push(h);
  }
  onError(h: (code: string, message: string) => void): void {
    this.errorHandlers.push(h);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.outbox = [];
    const ws = this.ws;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "Close" }));
      ws.close(1000);
    }
  }
}
