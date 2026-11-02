"use client";

import { useEffect, useState } from "react";
import type { CallStatus, CallTurn } from "../lib/useVoiceCall";

const MAX_TURNS = 2;
const LINGER_MS = 4000;

/**
 * Floating transcript on the right (wide screens only; hidden below 900px via .transcript-panel in globals.css).
 * Shows the last 2 turns; a new turn slides in from below and the oldest leaves the top under a fade.
 * Appears with the call and lingers 4 s after it ends.
 */
export function TranscriptPanel({ status, turns }: { status: CallStatus; turns: CallTurn[] }) {
  const active = status !== "idle";
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (active) {
      setVisible(true);
      return;
    }
    const t = setTimeout(() => setVisible(false), LINGER_MS);
    return () => clearTimeout(t);
  }, [active]);

  const shown = turns.filter((t) => t.agent || t.user || t.partial || t.record?.interrupted).slice(-MAX_TURNS);
  if (!visible || shown.length === 0) return null;

  return (
    <aside
      aria-label="Live transcript"
      className="transcript-panel"
      data-active={active}
      style={{
        position: "fixed",
        right: 24,
        top: "50%",
        transform: "translateY(-50%)",
        width: 340,
        maxHeight: "min(60vh, 420px)",
        flexDirection: "column",
        gap: 10,
        padding: "16px 20px",
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 20,
        boxShadow: "0 12px 40px rgba(10, 15, 28, 0.12)",
        zIndex: 20,
      }}
    >
      <h2 className="mono" style={{ margin: 0, fontSize: 12, fontWeight: 500, color: "var(--body)" }}>
        transcript
      </h2>
      <div
        aria-live="polite"
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          gap: 14,
          overflow: "hidden",
          maskImage: "linear-gradient(to bottom, transparent 0, #000 28px)",
          WebkitMaskImage: "linear-gradient(to bottom, transparent 0, #000 28px)",
          paddingTop: 12,
        }}
      >
        {shown.map((t) => (
          <div key={t.id} className="transcript-turn" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {t.id >= 0 && (t.user || t.partial) && (
              <Line who="you" color="var(--ok)">
                {t.user || <span style={{ color: "var(--muted)" }}>{t.partial}</span>}
              </Line>
            )}
            {(t.agent || t.record?.interrupted) && (
              <Line who="agent" color="var(--accent)">
                {t.agent}
                {t.record?.interrupted && (
                  <span style={{ color: "var(--muted)" }}>{t.agent ? " (interrupted)" : "(merged into your next turn)"}</span>
                )}
              </Line>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}

function Line({ who, color, children }: { who: string; color: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 10, fontSize: 14, lineHeight: 1.5 }}>
      <span className="mono" style={{ flex: "0 0 44px", fontSize: 12, color, paddingTop: 2 }}>
        {who}
      </span>
      <span style={{ color: "var(--ink)", minWidth: 0 }}>{children}</span>
    </div>
  );
}
