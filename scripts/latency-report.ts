// Usage: npx tsx scripts/latency-report.ts [logs/latency-*.jsonl ...]   (default: every file in logs/)
// p50/p95 per pipeline stage over completed (non-interrupted) turns with audio. Exit bar: server V2V p50 ≤ 700 ms.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { LatencyStage, TurnLatencyRecord } from "@voiceforge/shared";

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync("logs")
      .filter((f) => f.startsWith("latency-") && f.endsWith(".jsonl"))
      .map((f) => join("logs", f));

const all: TurnLatencyRecord[] = files.flatMap((f) =>
  readFileSync(f, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as TurnLatencyRecord),
);
const since = process.env.SINCE; // e.g. SINCE=2026-11-05T10:00 to only count the deployed run
const turns = all.filter((r) => !r.interrupted && r.serverV2vMs != null && (!since || r.wallClock >= since));

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
};

const SPANS: Array<[string, LatencyStage, LatencyStage]> = [
  ["endpointing", "speech_end", "endpoint"],
  ["STT finalize", "endpoint", "stt_final"],
  ["LLM TTFT", "llm_request", "llm_first_token"],
  ["chunker wait", "llm_first_token", "tts_first_send"],
  ["TTS first byte", "tts_first_send", "tts_first_byte"],
  ["first audible out", "tts_first_byte", "audio_first_out"],
  ["SERVER V2V", "speech_end", "audio_first_out"],
];

console.log(`${turns.length} completed turns (${all.length - turns.length} interrupted/incomplete skipped) from ${files.length} file(s)\n`);
if (!turns.length) process.exit(0);
console.log("stage".padEnd(20) + "p50".padStart(8) + "p95".padStart(8) + "max".padStart(8) + "   n");
for (const [label, a, b] of SPANS) {
  const xs = turns.map((r) => (r.stages[b] ?? NaN) - (r.stages[a] ?? NaN)).filter(Number.isFinite);
  if (!xs.length) continue;
  const row = [pct(xs, 50), pct(xs, 95), Math.max(...xs)].map((v) => v.toFixed(0).padStart(8)).join("");
  console.log(label.padEnd(20) + row + `   ${xs.length}`);
}
const v2v = turns.map((r) => r.serverV2vMs!);
const p50 = pct(v2v, 50);
const cacheHits = turns.filter((r) => (r.cacheReadInputTokens ?? 0) > 0).length;
console.log(`\nprompt cache hits: ${cacheHits}/${turns.length}`);
console.log(`exit bar (server V2V p50 ≤ 700 ms): ${p50 <= 700 ? "PASS" : "FAIL"} (${p50.toFixed(0)} ms)`);
