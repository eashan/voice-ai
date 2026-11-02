import type { LatencyStage, TurnLatencyRecord } from "@voiceforge/shared";

/** Hero chips: [label, from, to] on the orchestrator's clock (docs/PORTFOLIO_PLAN.md → LatencyChips). */
const CHIPS: Array<[string, LatencyStage, LatencyStage]> = [
  ["endpoint", "speech_end", "endpoint"],
  ["stt", "endpoint", "stt_final"],
  ["llm_ttft", "llm_request", "llm_first_token"],
  ["tts", "tts_first_send", "tts_first_byte"],
];

/** Four mono chips showing the last completed turn's stage latencies; "—" until there is one. */
export function LatencyChips({ record }: { record: TurnLatencyRecord | null }) {
  return (
    <div
      className="mono"
      aria-label="Latency of the last turn"
      style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8, fontSize: 12 }}
    >
      {CHIPS.map(([name, from, to]) => {
        const a = record?.stages[from];
        const b = record?.stages[to];
        const ms = a != null && b != null ? `${Math.round(b - a)}ms` : null;
        return (
          <span
            key={name}
            style={{
              border: "1px solid var(--line)",
              background: "var(--surface)",
              borderRadius: 8,
              padding: "8px 12px",
              color: "var(--body)",
            }}
          >
            {name}{" "}
            <span style={{ color: ms ? "var(--accent)" : "var(--muted)", fontWeight: 500 }}>{ms ?? "—"}</span>
          </span>
        );
      })}
    </div>
  );
}
