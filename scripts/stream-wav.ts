// Usage: npx tsx scripts/stream-wav.ts <file.wav> [ws-url]
// Streams a 16 kHz mono PCM16 WAV to the orchestrator in real time (20 ms frames), then 3 s of silence,
// and prints transcript / stage / turn events. Headless stand-in for the browser mic.
import { readFileSync } from "node:fs";
import WebSocket from "ws";

const file = process.argv[2];
const url = process.argv[3] ?? "ws://localhost:8787/ws";
if (!file) throw new Error("usage: stream-wav.ts <file.wav> [ws-url]");

const wav = readFileSync(file);
const dataIdx = wav.indexOf("data");
const pcm = wav.subarray(dataIdx + 8);
const FRAME = 640; // 20 ms @ 16 kHz PCM16
const silence = Buffer.alloc(FRAME);
const frames: Buffer[] = [];
for (let i = 0; i < pcm.length; i += FRAME) frames.push(Buffer.concat([pcm.subarray(i, i + FRAME)], FRAME));
for (let i = 0; i < 150; i++) frames.push(silence);

const ws = new WebSocket(url);
ws.on("open", () => ws.send(JSON.stringify({ type: "start", token: "dev" })));
ws.on("message", (data, isBinary) => {
  if (isBinary) return;
  const msg = JSON.parse(data.toString());
  if (msg.type === "ready") {
    console.log("ready → streaming", frames.length, "frames");
    let i = 0;
    const timer = setInterval(() => {
      if (i >= frames.length) {
        clearInterval(timer);
        setTimeout(() => ws.close(), 500);
        return;
      }
      ws.send(frames[i++]!);
    }, 20);
  } else if (msg.type === "turn_complete") {
    const s = msg.record.stages;
    const ms = (a: string, b: string) => (s[a] != null && s[b] != null ? `${(s[a] - s[b]).toFixed(0)}` : "–");
    console.log(
      `turn ${msg.record.turnId}: endpointing=${ms("endpoint", "speech_end")} ms  stt_finalize=${ms("stt_final", "endpoint")} ms  speech_end→final=${ms("stt_final", "speech_end")} ms`,
    );
  } else {
    console.log(JSON.stringify(msg));
  }
});
ws.on("close", () => process.exit(0));
