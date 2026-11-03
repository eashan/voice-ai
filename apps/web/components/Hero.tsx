"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { PROFILE } from "../content/profile";
import { getTurnstileToken, loadTurnstile } from "../lib/turnstile";
import { useCall } from "../lib/CallContext";
import type { SessionAuth } from "../lib/useVoiceCall";
import { EmailButton } from "./EmailButton";
import { LatencyChips } from "./LatencyChips";
import { VoiceOrb } from "./VoiceOrb";

const OWNER = "concierge";
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
 * Access: a Turnstile check when `turnstileSiteKey` is set; otherwise the unlock cookie, or the invite code.
 */
export function Hero({ turnstileSiteKey }: { turnstileSiteKey: string | null }) {
  const { call, owner, isActive, busy, startCall, stopCall, availability, unlocked } = useCall();
  const [askedForCode, setAskedForCode] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const turnstileBox = useRef<HTMLDivElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      setCode(localStorage.getItem(INVITE_KEY) ?? "");
    } catch {
      // storage blocked
    }
    if (turnstileSiteKey) void loadTurnstile().catch(() => {});
  }, [turnstileSiteKey]);

  const mine = isActive(OWNER) || checking;
  const live = isActive(OWNER) && call.status === "live";
  const otherCall = busy && owner !== OWNER;
  const needsCode = (!turnstileSiteKey && !unlocked) || askedForCode;
  const resting = availability.public === "resting" && !unlocked;

  async function onCta() {
    if (isActive(OWNER)) return stopCall();
    if (busy || checking) return;
    setError(null);
    if (resting) {
      setError("The agent is resting right now. Please try again later, or email Eashan.");
      return;
    }
    let auth: SessionAuth;
    if (needsCode) {
      if (!code.trim()) {
        setError("Enter your invite code first.");
        codeInput.current?.focus();
        return;
      }
      auth = { code: code.trim() };
    } else if (turnstileSiteKey) {
      setChecking(true);
      try {
        auth = { turnstileToken: await getTurnstileToken(turnstileBox.current!, turnstileSiteKey) };
      } catch (e) {
        setChecking(false);
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
      setChecking(false);
    } else {
      auth = {}; // the unlock cookie is the proof
    }
    const res = await startCall(OWNER, auth);
    if (res.ok) {
      setAskedForCode(false);
      if (auth.code) {
        try {
          localStorage.setItem(INVITE_KEY, auth.code);
        } catch {
          // storage blocked
        }
      }
      return;
    }
    if (res.needsCode) setAskedForCode(true);
    if (res.error) setError(res.error);
  }

  const label = otherCall
    ? "On a call"
    : checking || (mine && call.status === "connecting")
      ? "Connecting…"
      : live
        ? call.agentState === "thinking"
          ? "Thinking… tap to hang up"
          : call.agentState === "speaking"
            ? "Speaking… tap to hang up"
            : "Listening… tap to hang up"
        : resting
          ? "Agent is resting"
          : "Talk to my AI about me";

  const filled = !mine && !otherCall;
  const hint = live
    ? "LAST TURN · SERVER CLOCK · TRY: “WHAT DID EASHAN SHIP AT JUSTCALL?”"
    : `EVERY TURN SHOWS ITS OWN LATENCY · INTERRUPT ANYTIME · ${needsCode ? "BEST WITH HEADPHONES" : "NO SIGN-UP"}`;
  const message =
    error ??
    (owner === OWNER ? call.notice : null) ??
    (availability.public === "busy" && !busy ? "The agent is on other calls right now. Try again in a minute." : null);

  return (
    <section
      id="top"
      style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 22, padding: "48px 0 64px" }}
    >
      <VoiceOrb live={live} readSpectrum={call.readSpectrum} spectrumSize={call.spectrumSize}>
        <Image
          src="/eashan-headshot.jpg"
          alt="Eashan Kadam"
          width={188}
          height={188}
          priority
          style={{
            borderRadius: "50%",
            objectFit: "cover",
            border: "3px solid var(--bg)",
            boxShadow: "0 0 0 1px var(--line)",
            position: "relative",
          }}
        />
      </VoiceOrb>

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

      <h1 style={{ margin: 0, fontWeight: 800, fontSize: "clamp(64px, 11vw, 160px)", lineHeight: 0.88, letterSpacing: "-0.055em" }}>
        {PROFILE.name}
      </h1>

      <p style={{ margin: 0, maxWidth: 600, fontSize: 20, lineHeight: 1.5, color: "var(--body)" }}>{PROFILE.pitch}</p>

      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 12, paddingTop: 6 }}>
        <button
          type="button"
          onClick={onCta}
          aria-pressed={live}
          disabled={otherCall}
          style={{
            ...pill,
            gap: 12,
            padding: "0 26px 0 10px",
            border: "1px solid var(--accent)",
            background: filled ? "var(--accent)" : "transparent",
            color: filled ? "var(--accent-ink)" : "var(--ink)",
            fontWeight: 600,
            opacity: otherCall ? 0.5 : 1,
            cursor: otherCall ? "not-allowed" : "pointer",
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
          style={{ ...pill, padding: "0 24px", border: "1px solid var(--line)", background: "transparent", color: "var(--ink)", fontWeight: 500 }}
        />
      </div>

      {needsCode && !busy && (
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

      <LatencyChips record={owner === OWNER ? call.lastRecord : null} />
      <p className="mono" style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
        {hint}
      </p>
      <p role="status" style={{ margin: 0, minHeight: 21, fontSize: 14, color: error ? "var(--danger)" : "var(--body)" }}>
        {message}
      </p>
    </section>
  );
}
