// Usage: npx tsx --env-file=.env scripts/stream-wav.ts <a.wav> [b.wav ...] [ws(s)://host/ws]
// Headless stand-in for the browser mic. Streams each 16 kHz mono PCM16 WAV in real time (20 ms frames)
// followed by silence, waits for the agent's reply to finish playing, then sends the next file — all in ONE
// session, so conversation history and prompt caching are exercised.
//
// Env:
//   BARGE_IN_MS=800   start the next file 800 ms after the agent's audio starts (tests barge-in)
//   OUT_WAV=out.wav   save all agent audio received to a WAV file
//   SESSION_JWT_SECRET (from .env) is used to mint a session token, as the web app does after the invite code.
import { readFileSync, writeFileSync } from "node:fs";
import WebSocket from "ws";
import { signSessionToken } from "@voiceforge/shared/sessionToken";

const args = process.argv.slice(2);
const url = args.at(-1)?.startsWith("ws") ? args.pop()! : "ws://localhost:8787/ws";
if (args.length === 0) throw new Error("usage: stream-wav.ts <a.wav> [b.wav ...] [ws-url]");
const BARGE_IN_MS = process.env.BARGE_IN_MS ? Number(process.env.BARGE_IN_MS) : null;
const OUT_WAV = process.env.OUT_WAV;

const FRAME = 640; // 20 ms @ 16 kHz PCM16
const SILENCE_FRAMES = 50; // 1 s — enough for the endpointer; the turn wait covers the rest
const TURN_TIMEOUT_MS = 60000;

function framesOf(file: string): Buffer[] {
  const wav = readFileSync(file);
  const pcm = wav.subarray(wav.indexOf("data") + 8);
  const frames: Buffer[] = [];
  for (let i = 0; i < pcm.length; i += FRAME) frames.push(Buffer.concat([pcm.subarray(i, i + FRAME)], FRAME));
  for (let i = 0; i < SILENCE_FRAMES; i++) frames.push(Buffer.alloc(FRAME));
  return frames;
}

function wavFile(pcm: Buffer): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(16000, 24);
  h.writeUInt32LE(32000, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const ws = new WebSocket(url);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const audioOut: Buffer[] = [];
let started = false;
let turnDone: (() => void) | null = null;
let audioStarted: (() => void) | null = null;
let idleSilence: NodeJS.Timeout | null = null;

/** Keep sending silence between turns, like a live mic would (ElevenLabs closes after 15 s without input). */
function startIdleSilence() {
  idleSilence = setInterval(() => ws.readyState === ws.OPEN && ws.send(Buffer.alloc(FRAME)), 20);
}
function stopIdleSilence() {
  if (idleSilence) clearInterval(idleSilence);
  idleSilence = null;
}

async function run() {
  for (const file of args) {
    stopIdleSilence();
    console.log(`\n▶ ${file}`);
    for (const f of framesOf(file)) {
      ws.send(f);
      await sleep(20);
    }
    startIdleSilence();
    const waits: Promise<unknown>[] = [
      new Promise<void>((r) => (turnDone = r)),
      sleep(TURN_TIMEOUT_MS).then(() => console.log("(turn timed out)")),
    ];
    if (BARGE_IN_MS != null && file !== args.at(-1)) {
      waits.push(
        new Promise<void>((r) => (audioStarted = r))
          .then(() => sleep(BARGE_IN_MS))
          .then(() => console.log(`\n(barging in ${BARGE_IN_MS} ms after agent audio started)`)),
      );
    }
    await Promise.race(waits);
    audioStarted = null;
  }
  stopIdleSilence();
  await sleep(500);
  ws.close();
}

const secret = process.env.SESSION_JWT_SECRET;
if (!secret) throw new Error("SESSION_JWT_SECRET not set: run with --env-file=.env");
const token = signSessionToken(secret, { wid: "ws_demo", aid: "agent_portfolio_concierge" });
ws.on("open", () => ws.send(JSON.stringify({ type: "start", token })));
ws.on("message", (data, isBinary) => {
  if (isBinary) {
    if (OUT_WAV) audioOut.push(Buffer.from(data as Buffer));
    return;
  }
  const msg = JSON.parse(data.toString());
  if (msg.type === "ready") {
    startIdleSilence(); // live mic during the greeting
  } else if (msg.type === "state") {
    process.stdout.write(`\n  [state → ${msg.state}]`);
    // Start once the greeting has finished.
    if (msg.state === "listening" && !started) {
      started = true;
      void run();
    }
  } else if (msg.type === "audio_start") {
    audioStarted?.();
  } else if (msg.type === "stop_playback") {
    process.stdout.write("\n  [stop_playback]");
  } else if (msg.type === "agent_text") {
    process.stdout.write(msg.text);
  } else if (msg.type === "turn_complete") {
    const r = msg.record;
    const s = r.stages;
    const ms = (a: string, b: string) => (s[a] != null && s[b] != null ? `${(s[a] - s[b]).toFixed(0)}` : "–");
    console.log(`\n[user] ${r.userText}\n[agent heard] ${r.agentText ?? ""}${r.interrupted ? "  (INTERRUPTED)" : ""}`);
    console.log(
      `turn ${r.turnId}: endpointing=${ms("endpoint", "speech_end")}  stt_finalize=${ms("stt_final", "endpoint")}  ` +
        `llm_ttft=${ms("llm_first_token", "llm_request")}  llm→tts_send=${ms("tts_first_send", "llm_first_token")}  ` +
        `tts_ttfb=${ms("tts_first_byte", "tts_first_send")}  SERVER V2V=${r.serverV2vMs?.toFixed(0) ?? "–"} ms  ` +
        `cache_read=${r.cacheReadInputTokens ?? "–"}`,
    );
    turnDone?.();
  } else if (msg.type === "error" || msg.type === "ended") {
    console.log(`\n${JSON.stringify(msg)}`);
  }
});
ws.on("unexpected-response", (_req, res) => {
  console.log(`connection refused: HTTP ${res.statusCode} (origin not allowed?)`);
  process.exit(1);
});
ws.on("close", () => {
  if (OUT_WAV && audioOut.length) {
    writeFileSync(OUT_WAV, wavFile(Buffer.concat(audioOut)));
    console.log(`\nsaved agent audio → ${OUT_WAV}`);
  }
  process.exit(0);
});
