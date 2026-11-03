import type { LatencyStage, TurnLatencyRecord } from "@voiceforge/shared";

/** Bars on the orchestrator's clock, offset from speech_end (docs/PORTFOLIO_PLAN.md → LatencyWaterfall). */
const BARS: Array<[string, LatencyStage, LatencyStage]> = [
  ["endpoint", "speech_end", "endpoint"],
  ["stt", "endpoint", "stt_final"],
  ["llm_ttft", "llm_request", "llm_first_token"],
  ["chunker", "llm_first_token", "tts_first_send"],
  ["tts", "tts_first_send", "tts_first_byte"],
];

const ms = (n: number) => `${Math.round(n).toLocaleString("en-US")}ms`;

export function LatencyWaterfall({ record, turn }: { record: TurnLatencyRecord | null; turn: number | null }) {
  const origin = record?.stages.speech_end;
  const bars = BARS.map(([name, from, to]) => {
    const a = record?.stages[from];
    const b = record?.stages[to];
    return origin != null && a != null && b != null ? { name, start: a - origin, dur: b - a } : { name, start: 0, dur: null };
  });
  const scale = Math.max(record?.serverV2vMs ?? 0, ...bars.map((b) => (b.dur == null ? 0 : b.start + b.dur)), 1);

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 20,
        padding: "20px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <h2 className="mono" style={{ margin: 0, fontSize: 12, fontWeight: 500, color: "var(--body)" }}>
          {turn ? `turn ${turn} · ` : ""}latency waterfall
        </h2>
        <span className="mono" style={{ fontSize: 13, color: record?.serverV2vMs != null ? "var(--accent)" : "var(--muted)" }}>
          server V2V {record?.serverV2vMs != null ? ms(record.serverV2vMs) : "—"}
        </span>
      </div>
      {bars.map((b) => (
        <div key={b.name} className="mono" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
          <span style={{ flex: "0 0 72px", color: "var(--body)" }}>{b.name}</span>
          <div style={{ flex: "1 1 auto", height: 10, position: "relative", background: "var(--bg)", borderRadius: 4 }}>
            {b.dur != null && (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: `${((b.start / scale) * 100).toFixed(2)}%`,
                  width: `max(2px, ${((b.dur / scale) * 100).toFixed(2)}%)`,
                  background: b.name === "llm_ttft" ? "var(--accent)" : "var(--track)",
                  borderRadius: 4,
                }}
              />
            )}
          </div>
          <span style={{ flex: "0 0 56px", textAlign: "right", color: b.dur != null ? "var(--ink)" : "var(--muted)" }}>
            {b.dur != null ? ms(b.dur) : "—"}
          </span>
        </div>
      ))}
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--muted)" }}>
        Measured on the orchestrator&apos;s clock, speech end → first audible audio. Your network adds to this.
      </p>
    </div>
  );
}
