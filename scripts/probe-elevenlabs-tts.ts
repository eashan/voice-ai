// Usage: VOICE_ID=<elevenlabs voice id> npx tsx --env-file=.env scripts/probe-elevenlabs-tts.ts [out.wav]
// Exercises ElevenLabsTts exactly as the Speaker does: three chunks in order, time-to-first-byte per chunk,
// chunk-done ordering, then a barge-in clear() mid-reply. Writes the audio to a WAV so you can listen to the voice.
import { writeFileSync } from "node:fs";
import { ElevenLabsTts } from "../apps/orchestrator/src/providers/elevenlabs/ElevenLabsTts";

const voiceId = process.env.VOICE_ID;
if (!voiceId) throw new Error("set VOICE_ID");
const out = process.argv[2] ?? "logs/elevenlabs-probe.wav";
const RATE = 16000;

function wav(pcm: Buffer): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const t0 = performance.now();
const tts = await new ElevenLabsTts().open({ format: { encoding: "pcm_s16le", sampleRate: RATE, channels: 1 }, voiceId });
console.log(`connected in ${(performance.now() - t0).toFixed(0)} ms`);

const audio: Buffer[] = [];
let firstByteAt: number | null = null;
let sentAt = 0;
let done = 0;
tts.onError((c, m) => console.log(`ERROR ${c}: ${m}`));
tts.onAudio((b) => {
  if (firstByteAt == null) {
    firstByteAt = performance.now();
    console.log(`  first byte ${(firstByteAt - sentAt).toFixed(0)} ms`);
  }
  audio.push(b);
});

async function reply(chunks: string[], label: string) {
  console.log(`\n${label}`);
  firstByteAt = null;
  done = 0;
  const finished = new Promise<void>((resolve) =>
    tts.onChunkDone(() => {
      done++;
      console.log(`  chunk ${done} done at ${(performance.now() - sentAt).toFixed(0)} ms`);
      if (done === chunks.length) resolve();
    }),
  );
  sentAt = performance.now();
  for (const c of chunks) tts.speak(c);
  await Promise.race([finished, new Promise((r) => setTimeout(r, 15000))]);
}

await reply(
  [
    "Hi, I'm Eashan's voice assistant.",
    "He took JustCall's AI Voice Agent from zero to one,",
    "growing it to about one million dollars in annual revenue.",
  ],
  "reply 1 (3 chunks)",
);
const bytesBefore = audio.reduce((n, b) => n + b.length, 0);

console.log("\nreply 2: barge-in after 300 ms");
sentAt = performance.now();
firstByteAt = null;
tts.speak("This sentence should be cut off by a barge-in long before it finishes playing out loud.");
await new Promise((r) => setTimeout(r, 300));
tts.clear();
const atClear = audio.reduce((n, b) => n + b.length, 0);
await new Promise((r) => setTimeout(r, 2000));
const late = audio.reduce((n, b) => n + b.length, 0) - atClear;
console.log(`  audio emitted after clear(): ${late} bytes (want 0)`);

await reply(["And this reply after the barge-in should play normally."], "reply 3 (after clear)");

await tts.close();
const pcm = Buffer.concat(audio);
writeFileSync(out, wav(pcm));
console.log(`\nreply 1 audio: ${((bytesBefore / 2 / RATE) * 1000).toFixed(0)} ms · total ${((pcm.length / 2 / RATE) * 1000).toFixed(0)} ms → ${out}`);
process.exit(0);
