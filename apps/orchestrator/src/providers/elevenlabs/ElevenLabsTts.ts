import WebSocket from "ws";
import type { AudioFormat } from "@voiceforge/shared";
import type { TtsProvider, TtsSession } from "../types.js";
import { now } from "../../metrics/latencyLog.js";

const BASE_URL = "wss://api.elevenlabs.io/v1/text-to-speech";
/** Socket-level idle timeout in seconds (docs: default 20, max 180). Calls are capped at 180 s. */
const INACTIVITY_TIMEOUT_S = 180;

/**
 * ElevenLabs streaming TTS over the multi-context WebSocket (`/multi-stream-input`), one socket per call.
 *
 * Each speak() chunk gets its own context: init (" ") → text + flush → close_context. The server's
 * `isFinal` for that context = all of the chunk's audio has been delivered (→ onChunkDone).
 * Contexts may synthesize in parallel, so audio is emitted strictly in speak() order: later contexts are
 * buffered until every earlier one is final. clear() closes all open contexts and drops their late audio.
 */
export class ElevenLabsTts implements TtsProvider {
  constructor(private readonly modelId = process.env.ELEVENLABS_TTS_MODEL ?? "eleven_flash_v2_5") {}

  async open({ format, voiceId }: { format: AudioFormat; voiceId: string }): Promise<TtsSession> {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set");
    const params = new URLSearchParams({
      model_id: this.modelId,
      output_format: format.encoding === "mulaw" ? `ulaw_${format.sampleRate}` : `pcm_${format.sampleRate}`,
      inactivity_timeout: String(INACTIVITY_TIMEOUT_S),
    });
    const url = `${BASE_URL}/${encodeURIComponent(voiceId)}/multi-stream-input?${params}`;
    const session = new ElevenLabsTtsSession(url, apiKey, format.encoding === "pcm_s16le" ? 2 : 1);
    await session.connect();
    return session;
  }
}

interface Ctx {
  id: string;
  /** Audio received before this context reached the head of the queue. */
  pending: Buffer[];
  /** Odd trailing byte of a PCM16 chunk, prepended to this context's next chunk. */
  carry: Buffer | null;
  final: boolean;
  /** Any audio received. A final with none = a silent failure (e.g. plan/voice not allowed). */
  gotAudio: boolean;
}

interface ServerMsg {
  audio?: string | null;
  isFinal?: boolean | null;
  contextId?: string;
  error?: unknown;
  message?: unknown;
  detail?: unknown;
}

class ElevenLabsTtsSession implements TtsSession {
  private ws: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  private outbox: string[] = [];
  /** Live contexts in speak() order; queue[0] is the one being played. */
  private queue: Ctx[] = [];
  /** Contexts cancelled by clear(): their late audio/finals are ignored. */
  private dropped = new Set<string>();
  private seq = 0;
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
      const ws = new WebSocket(this.url, { headers: { "xi-api-key": this.apiKey } });
      ws.on("open", () => {
        this.ws = ws;
        for (const m of this.outbox.splice(0)) ws.send(m);
        resolve();
      });
      ws.on("message", (data) => this.onMessage(data as Buffer));
      ws.on("unexpected-response", (_req, res) => {
        const err = new Error(`HTTP ${res.statusCode} opening ElevenLabs TTS`);
        reject(err);
        this.emitError("connect_failed", err.message);
      });
      ws.on("error", (err) => {
        reject(err);
        if (this.ws === ws) this.emitError("ws_error", err.message);
      });
      ws.on("close", (code, reason) => {
        const wasOpen = this.ws === ws;
        if (wasOpen) this.ws = null;
        this.connecting = null;
        // Contexts on a dead socket will never finish; the Speaker's stall watchdog recovers the turn.
        this.queue = [];
        this.dropped.clear();
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
    const clean = text.trim();
    if (!clean) {
      // Nothing to say: still honour the chunk contract.
      queueMicrotask(() => this.chunkDoneHandlers.forEach((h) => h()));
      return;
    }
    const id = `c${++this.seq}`;
    this.queue.push({ id, pending: [], carry: null, final: false, gotAudio: false });
    this.send({ text: " ", context_id: id });
    this.send({ text: `${clean} `, context_id: id, flush: true });
    this.send({ context_id: id, close_context: true });
  }

  clear(): void {
    if (this.outbox.length) this.outbox = []; // never sent: nothing in flight for those
    for (const c of this.queue) {
      this.dropped.add(c.id);
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ context_id: c.id, close_context: true }));
    }
    this.queue = [];
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
      this.queue = [];
      this.emitError("connect_failed", err.message);
    });
  }

  private onMessage(data: Buffer): void {
    let msg: ServerMsg;
    try {
      msg = JSON.parse(data.toString()) as ServerMsg;
    } catch {
      return;
    }
    const id = msg.contextId;
    if (!id) {
      if (msg.error || msg.detail || msg.message) this.emitError("provider_error", JSON.stringify(msg).slice(0, 500));
      return;
    }
    if (this.dropped.has(id)) {
      if (msg.isFinal) this.dropped.delete(id);
      return;
    }
    const ctx = this.queue.find((c) => c.id === id);
    if (!ctx) return;

    if (msg.audio) {
      ctx.gotAudio = true;
      const pcm = this.align(ctx, Buffer.from(msg.audio, "base64"));
      if (pcm.length) {
        if (ctx === this.queue[0]) this.emitAudio(pcm);
        else ctx.pending.push(pcm);
      }
    }
    if (msg.isFinal) {
      // The multi-context endpoint reports some rejections (e.g. "Free users cannot use library voices via the
      // API") only as an empty final, with no error message.
      if (!ctx.gotAudio) this.emitError("no_audio", `context ${id} finished without audio (voice/plan not allowed?)`);
      ctx.final = true;
      this.drain();
    }
  }

  /** Emit finished head contexts in order, then promote and play the next one's buffered audio. */
  private drain(): void {
    while (this.queue[0]?.final) {
      this.queue.shift();
      this.chunkDoneHandlers.forEach((h) => h());
      const next = this.queue[0];
      if (next) for (const b of next.pending.splice(0)) this.emitAudio(b);
    }
  }

  private align(ctx: Ctx, data: Buffer): Buffer {
    let buf = ctx.carry ? Buffer.concat([ctx.carry, data]) : data;
    ctx.carry = null;
    const rem = buf.length % this.bytesPerSample;
    if (rem) {
      ctx.carry = Buffer.from(buf.subarray(buf.length - rem));
      buf = buf.subarray(0, buf.length - rem);
    }
    return buf;
  }

  private emitAudio(buf: Buffer): void {
    const t = now();
    this.audioHandlers.forEach((h) => h(buf, t));
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
    this.queue = [];
    const ws = this.ws;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ close_socket: true }));
      ws.close(1000);
    }
  }
}
