"use client";

import { useEffect, useRef, useState } from "react";
import { PROFILE } from "../content/profile";
import { getTurnstileToken, loadTurnstile } from "../lib/turnstile";
import { useVoiceCall } from "../lib/useVoiceCall";
import type { AgentAvailability } from "../app/api/status/route";
import { EmailButton } from "./EmailButton";
import { LatencyChips } from "./LatencyChips";
import { TranscriptPanel } from "./TranscriptPanel";
import { VoiceOrb } from "./VoiceOrb";

const INVITE_KEY = "voiceforge.invite";

const pill: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 56,
  borderRadius: 999,
  fontFamily: "inherit",
  fontSize: 17,
  boxSizing: "border-box",
  cursor: "pointer",
};

/**
 * Home hero: orb, name, pitch, the concierge call button and per-turn latency chips.
 * Access: a Turnstile check when `turnstileSiteKey` is set, otherwise (or if the server asks) the invite code.
 */
export function Hero({ turnstileSiteKey }: { turnstileSiteKey: string | null }) {
  const call = useVoiceCall();
  const [availability, setAvailability] = useState<AgentAvailability>("unknown");
  const [needsCode, setNeedsCode] = useState(!turnstileSiteKey);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const turnstileBox = useRef<HTMLDivElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);

  // Pre-warm the orchestrator (Fly auto-stops it when idle) and learn whether it's free.
  useEffect(() => {
    try {
      setCode(localStorage.getItem(INVITE_KEY) ?? "");
    } catch {
      // storage blocked
    }
    fetch("/api/status")
      .then((r) => r.json() as Promise<{ status: AgentAvailability }>)
      .then((b) => setAvailability(b.status))
      .catch(() => {});
    if (turnstileSiteKey) void loadTurnstile().catch(() => {});
  }, [turnstileSiteKey]);

  const live = call.status === "live";
  const busy = call.status !== "idle" || checking;

  async function onCta() {
    if (call.status !== "idle") return call.stop();
    setError(null);
    if (availability === "resting") {
      setError("The agent is resting right now. Please try again later, or email Eashan.");
      return;
    }
    let auth: { code?: string; turnstileToken?: string };
    if (needsCode) {
      if (!code.trim()) {
        setError("Enter your invite code first.");
        codeInput.current?.focus();
        return;
      }
      auth = { code: code.trim() };
    } else {
      setChecking(true);
      try {
        auth = { turnstileToken: await getTurnstileToken(turnstileBox.current!, turnstileSiteKey!) };
      } catch (e) {
        setChecking(false);
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
      setChecking(false);
    }
    const res = await call.start(auth);
    if (res.ok) {
      if (auth.code) {
        try {
          localStorage.setItem(INVITE_KEY, auth.code);
        } catch {
          // storage blocked
        }
      }
      return;
    }
    if (res.needsCode) setNeedsCode(true);
    if (res.error) setError(res.error);
  }

  const label =
    checking || call.status === "connecting"
      ? "Connecting…"
      : live
        ? call.agentState === "thinking"
          ? "Thinking… tap to hang up"
          : call.agentState === "speaking"
            ? "Speaking… tap to hang up"
            : "Listening… tap to hang up"
        : availability === "resting"
          ? "Agent is resting"
          : "Talk to my AI about me";

  const filled = !busy;
  const hint = live
    ? "LAST TURN · SERVER CLOCK · TRY: “WHAT DID EASHAN SHIP AT JUSTCALL?”"
    : `EVERY TURN SHOWS ITS OWN LATENCY · INTERRUPT ANYTIME · ${needsCode ? "BEST WITH HEADPHONES" : "NO SIGN-UP"}`;
  const message =
    error ??
    call.notice ??
    (availability === "busy" && call.status === "idle" ? "The agent is on other calls right now. Try again in a minute." : null);

  return (
    <section
      id="top"
      style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 22, padding: "48px 0 64px" }}
    >
      <VoiceOrb live={live} readSpectrum={call.readSpectrum} spectrumSize={call.spectrumSize} />

      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          border: "1px solid var(--line)",
          borderRadius: 999,
          padding: "8px 16px",
          fontSize: 14,
          color: "var(--body)",
        }}
      >
        {PROFILE.tagline}
      </div>

      <h1
        style={{
          margin: 0,
          fontWeight: 800,
          fontSize: "clamp(64px, 11vw, 160px)",
          lineHeight: 0.88,
          letterSpacing: "-0.055em",
        }}
      >
        {PROFILE.name}
      </h1>

      <p style={{ margin: 0, maxWidth: 600, fontSize: 20, lineHeight: 1.5, color: "var(--body)" }}>{PROFILE.pitch}</p>

      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 12, paddingTop: 6 }}>
        <button
          type="button"
          onClick={onCta}
          aria-pressed={live}
          style={{
            ...pill,
            gap: 12,
            padding: "0 26px 0 10px",
            border: "1px solid var(--accent)",
            background: filled ? "var(--accent)" : "transparent",
            color: filled ? "var(--accent-ink)" : "var(--ink)",
            fontWeight: 600,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 38,
              height: 38,
              borderRadius: "50%",
              background: filled ? "var(--accent-ink)" : "var(--accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke={filled ? "var(--accent)" : "var(--accent-ink)"}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0" />
              <path d="M12 18v3" />
            </svg>
          </span>
          <span>{label}</span>
        </button>
        <EmailButton
          style={{
            ...pill,
            padding: "0 24px",
            border: "1px solid var(--line)",
            background: "transparent",
            color: "var(--ink)",
            fontWeight: 500,
          }}
        />
      </div>

      {needsCode && call.status === "idle" && (
        <input
          ref={codeInput}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void onCta()}
          placeholder="Invite code"
          aria-label="Invite code"
          autoComplete="off"
          className="mono"
          style={{
            minHeight: 44,
            width: 220,
            boxSizing: "border-box",
            padding: "0 16px",
            borderRadius: 999,
            border: "1px solid var(--line)",
            background: "var(--surface)",
            color: "var(--ink)",
            fontSize: 13,
            textAlign: "center",
          }}
        />
      )}
      <div ref={turnstileBox} />

      <LatencyChips record={call.lastRecord} />
      <p className="mono" style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
        {hint}
      </p>
      <p role="status" style={{ margin: 0, minHeight: 21, fontSize: 14, color: error ? "var(--danger)" : "var(--body)" }}>
        {message}
      </p>

      <TranscriptPanel status={call.status} turns={call.turns} />
    </section>
  );
}
