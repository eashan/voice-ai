import { PROFILE } from "../content/profile";

/** Four headline numbers, all from the résumé. */
export function HighlightsStrip() {
  return (
    <section
      aria-label="Highlights"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 24,
        padding: "32px 0",
        borderTop: "1px solid var(--strong)",
        borderBottom: "1px solid var(--line)",
      }}
    >
      {PROFILE.highlights.map((h) => (
        <div key={h.value} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-0.03em" }}>{h.value}</span>
          <span style={{ fontSize: 14, color: "var(--muted)" }}>{h.label}</span>
        </div>
      ))}
    </section>
  );
}
