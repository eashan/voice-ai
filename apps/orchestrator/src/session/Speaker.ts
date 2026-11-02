import type { Transport } from "../transport/Transport.js";
import type { TtsSession } from "../providers/types.js";
import { now } from "../metrics/latencyLog.js";

/** One TTS chunk of a reply and how much audio it produced. */
export interface Segment {
  text: string;
  audioMs: number;
  /** All audio for this chunk has arrived. */
  done: boolean;
}

export interface ReplyHooks {
  onFirstAudioByte?(t: number): void;
  onFirstAudioOut?(t: number): void;
  /** All audio delivered and (by the server's playhead estimate) played out. */
  onFinished(): void;
}

export interface Interruption {
  turnId: number;
  /** Server estimate of how much audio the listener heard. */
  playedMs: number;
  spokenText: string;
  segments: Segment[];
}

/** Grace after the estimated end of playback before we call the reply finished (network + client buffer). */
const FINISH_SLACK_MS = 150;
/** If the TTS stops delivering for this long while chunks are outstanding, give up on them. */
const STALL_TIMEOUT_MS = 8000;
const SILENCE_AMPLITUDE = 600; // of 32768 (~-35 dBFS)
const PRE_ROLL_MS = 20;
const MAX_TRIM_MS = 300;
/** Rough speaking rate, for estimating a chunk whose audio hasn't fully arrived. */
const MS_PER_WORD = 330;

interface Reply {
  turnId: number;
  hooks: ReplyHooks;
  segments: Segment[];
  textEnded: boolean;
  audioStarted: boolean;
  firstByte: boolean;
  trimmedMs: number;
  /** [virtualStartT, durationMs] per audio chunk sent. */
  playback: Array<[number, number]>;
  /** Total audible silence inside the reply caused by audio arriving late. */
  gapMs: number;
  finishTimer?: NodeJS.Timeout;
  stallTimer?: NodeJS.Timeout;
}

/**
 * Plays one agent reply at a time: text chunks → TTS → transport.
 * Keeps a virtual playhead (audio is forwarded faster than real time; the client plays it in real time),
 * which tells us when the agent stops speaking and how much the user actually heard at barge-in.
 */
export class Speaker {
  private reply: Reply | null = null;
  private playhead = 0;
  private readonly bytesPerMs: number;

  constructor(
    private readonly tts: TtsSession,
    private readonly transport: Transport,
  ) {
    const f = transport.outputFormat;
    this.bytesPerMs = (f.sampleRate * (f.encoding === "pcm_s16le" ? 2 : 1)) / 1000;
    tts.onAudio((chunk, t) => this.onAudio(chunk, t));
    tts.onChunkDone(() => this.onChunkDone());
  }

  get busy(): boolean {
    return this.reply !== null;
  }

  begin(turnId: number, hooks: ReplyHooks): void {
    if (this.reply) this.interrupt();
    this.reply = { turnId, hooks, segments: [], textEnded: false, audioStarted: false, firstByte: false, trimmedMs: 0, playback: [], gapMs: 0 };
  }

  say(text: string): void {
    const r = this.reply;
    if (!r) return;
    r.segments.push({ text, audioMs: 0, done: false });
    this.tts.speak(text);
    this.armStall(r);
  }

  /** No more text for this reply. */
  endText(): void {
    const r = this.reply;
    if (!r) return;
    r.textEnded = true;
    this.checkFinished(r);
  }

  /** Barge-in: cancel TTS, drop client audio. Returns the server's estimate of what was heard. */
  interrupt(): Interruption | null {
    const r = this.reply;
    if (!r) return null;
    this.reply = null;
    clearTimeout(r.finishTimer);
    clearTimeout(r.stallTimer);
    this.tts.clear();
    if (r.audioStarted) this.transport.clearOutbound();
    const t = now();
    const playedMs = r.playback.reduce((acc, [start, dur]) => acc + Math.min(Math.max(t - start, 0), dur), 0);
    this.playhead = 0;
    return { turnId: r.turnId, playedMs, spokenText: spokenTextAt(r.segments, playedMs), segments: r.segments };
  }

  private onAudio(chunk: Buffer, t: number): void {
    const r = this.reply;
    if (!r) return; // stale audio after an interrupt
    if (!r.firstByte) {
      r.firstByte = true;
      r.hooks.onFirstAudioByte?.(t);
    }
    if (!r.audioStarted) {
      // TTS output starts with ~90 ms (sometimes ~450 ms) of silence: don't make the user wait for it.
      const trimmed = this.trimLeadingSilence(r, chunk);
      if (!trimmed) return;
      chunk = trimmed;
      r.audioStarted = true;
      this.transport.sendEvent({ type: "audio_start", turnId: r.turnId });
    }
    this.transport.sendAudio(chunk);
    const sentT = now();
    if (r.playback.length === 0) r.hooks.onFirstAudioOut?.(sentT);

    const dur = chunk.length / this.bytesPerMs;
    // Underrun: the client ran out of audio mid-reply (audible gap). Usually TTS latency between chunks.
    if (r.playback.length > 0 && sentT > this.playhead) {
      r.gapMs += sentT - this.playhead;
      if (sentT - this.playhead > 40) console.log(`[speaker] turn ${r.turnId}: ${(sentT - this.playhead).toFixed(0)} ms gap before chunk ${r.segments.findIndex((s) => !s.done)}`);
    }
    const start = Math.max(sentT, this.playhead);
    this.playhead = start + dur;
    r.playback.push([start, dur]);
    const seg = r.segments.find((s) => !s.done);
    if (seg) seg.audioMs += dur;
    this.armStall(r);
  }

  /** Drop near-silent PCM16 samples at the start of a reply (keeps 20 ms pre-roll, trims at most 300 ms). */
  private trimLeadingSilence(r: Reply, chunk: Buffer): Buffer | null {
    if (this.transport.outputFormat.encoding !== "pcm_s16le" || r.trimmedMs >= MAX_TRIM_MS) return chunk;
    const samples = chunk.length >> 1;
    for (let i = 0; i < samples; i++) {
      if (Math.abs(chunk.readInt16LE(i * 2)) > SILENCE_AMPLITUDE) {
        const keepFrom = Math.max(0, i - (PRE_ROLL_MS * this.bytesPerMs) / 2);
        r.trimmedMs += (keepFrom * 2) / this.bytesPerMs;
        return chunk.subarray(keepFrom * 2);
      }
    }
    r.trimmedMs += chunk.length / this.bytesPerMs;
    return null;
  }

  private onChunkDone(): void {
    const r = this.reply;
    if (!r) return;
    const seg = r.segments.find((s) => !s.done);
    if (seg) seg.done = true;
    this.armStall(r);
    this.checkFinished(r);
  }

  private checkFinished(r: Reply): void {
    if (!r.textEnded || r.segments.some((s) => !s.done)) return;
    clearTimeout(r.stallTimer);
    clearTimeout(r.finishTimer);
    const wait = Math.max(0, this.playhead - now()) + FINISH_SLACK_MS;
    r.finishTimer = setTimeout(() => {
      if (this.reply !== r) return;
      this.reply = null;
      r.hooks.onFinished();
    }, wait);
  }

  private armStall(r: Reply): void {
    clearTimeout(r.stallTimer);
    if (!r.segments.some((s) => !s.done)) return;
    r.stallTimer = setTimeout(() => {
      if (this.reply !== r) return;
      console.warn(`[speaker] TTS stalled on turn ${r.turnId}; giving up on remaining chunks`);
      r.segments.forEach((s) => (s.done = true));
      this.checkFinished(r);
    }, STALL_TIMEOUT_MS);
  }
}

/** Map "ms of reply audio played" to the words the listener heard (whole chunks + a proportional share of the current one). */
export function spokenTextAt(segments: Segment[], playedMs: number): string {
  const out: string[] = [];
  let cum = 0;
  for (const s of segments) {
    if (s.audioMs === 0) break;
    const words = s.text.split(/\s+/).filter(Boolean);
    const length = s.done ? s.audioMs : Math.max(s.audioMs, words.length * MS_PER_WORD);
    if (playedMs >= cum + length) {
      out.push(s.text);
      cum += length;
      continue;
    }
    const n = Math.floor((words.length * (playedMs - cum)) / length);
    if (n > 0) out.push(words.slice(0, n).join(" "));
    break;
  }
  return out.join(" ");
}
