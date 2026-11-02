// Usage: npx tsx --env-file=.env scripts/bench-llm-ttft.ts [runs]
// Measures Claude time-to-first-event and time-to-first-text for config variants, from this machine.
import Anthropic from "@anthropic-ai/sdk";
import { loadAgent, buildSystemPrompt } from "../apps/orchestrator/src/config/loadAgent.js";

const RUNS = Number(process.argv[2] ?? 5);
const agent = loadAgent();
const fullSystem = buildSystemPrompt(agent);
const shortSystem = "You are a friendly voice assistant. Answer in one short sentence.";
const client = new Anthropic();
const question = "What did Eashan build at JustCall?";

type Variant = { name: string; params: Record<string, unknown> };
const sys = (text: string, cache: boolean) => [{ type: "text", text, ...(cache ? { cache_control: { type: "ephemeral" } } : {}) }];

const ALL: Variant[] = [
  { name: "haiku-5-5  thinking=off effort=low full+cache (current)", params: { model: "claude-haiku-5-5", thinking: { type: "disabled" }, output_config: { effort: "low" }, system: sys(fullSystem, true) } },
  { name: "haiku-5-5  thinking=off effort=low full, no cache", params: { model: "claude-haiku-5-5", thinking: { type: "disabled" }, output_config: { effort: "low" }, system: sys(fullSystem, false) } },
  { name: "haiku-5-5  thinking=off effort=low short system", params: { model: "claude-haiku-5-5", thinking: { type: "disabled" }, output_config: { effort: "low" }, system: sys(shortSystem, false) } },
  { name: "haiku-5-5  adaptive effort=low full+cache", params: { model: "claude-haiku-5-5", thinking: { type: "adaptive" }, output_config: { effort: "low" }, system: sys(fullSystem, true) } },
  { name: "haiku-4-5  no thinking full+cache", params: { model: "claude-haiku-4-5", system: sys(fullSystem, true) } },
  { name: "sonnet-5-5 between_tools effort=low full+cache", params: { model: "claude-sonnet-5-5", thinking: { type: "between_tools" }, output_config: { effort: "low" }, system: sys(fullSystem, true) } },
];
// Optional filter: BENCH_FILTER=substring
const variants = ALL.filter((v) => !process.env.BENCH_FILTER || v.name.includes(process.env.BENCH_FILTER));

const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;

for (const v of variants) {
  const firstEvent: number[] = [];
  const firstText: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    let tEvent = 0, tText = 0;
    const stream = client.messages.stream({
      ...(v.params as object),
      max_tokens: 300,
      messages: [{ role: "user", content: question }],
    } as Anthropic.MessageStreamParams);
    for await (const ev of stream) {
      if (!tEvent) tEvent = performance.now() - t0;
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
        tText = performance.now() - t0;
        stream.abort();
        break;
      }
    }
    firstEvent.push(tEvent);
    firstText.push(tText);
  }
  console.log(
    `${v.name.padEnd(52)} first_event p50=${pct(firstEvent, 0.5).toFixed(0)}  first_text p50=${pct(firstText, 0.5).toFixed(0)} min=${Math.min(...firstText).toFixed(0)} max=${Math.max(...firstText).toFixed(0)} ms`,
  );
}
