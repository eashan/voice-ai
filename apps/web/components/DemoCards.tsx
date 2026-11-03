"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { DEMOS, type Demo } from "../content/demos";
import { useCall } from "../lib/CallContext";
import type { AgentAvailability } from "../app/api/status/route";
import { LatencyChips } from "./LatencyChips";
import { VoiceOrb } from "./VoiceOrb";

const STATUS: Record<AgentAvailability, { label: string; color: string }> = {
  ready: { label: "ready", color: "var(--ok)" },
  busy: { label: "busy", color: "var(--muted)" },
  resting: { label: "resting", color: "var(--muted)" },
  unknown: { label: "checking", color: "var(--ring-idle)" },
};

const button: React.CSSProperties = {
  minHeight: 44,
  padding: "0 18px",
  borderRadius: 999,
  fontFamily: "inherit",
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
};

/** "Live voice demos": three invite-only agents. A card becomes the call when you call it. */
export function DemoCards() {
  return (
    <section id="demos" style={{ display: "flex", flexDirection: "column", gap: 24, paddingTop: 64 }}>
      <h2 style={{ margin: 0, fontSize: 40, fontWeight: 800, letterSpacing: "-0.03em" }}>Live voice demos</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, alignItems: "start" }}>
        {DEMOS.map((d) => (
          <DemoCard key={d.agentId} demo={d} />
        ))}
      </div>
      <p className="mono" style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
        Demos use fictional companies and customers. Best with headphones.{" "}
        <Link href="/playground" style={{ color: "var(--accent)" }}>
          Edit the system prompt yourself →
        </Link>
      </p>
    </section>
  );
}

function DemoCard({ demo }: { demo: Demo }) {
  const { call, owner, isActive, busy, startCall, stopCall, availability, unlocked, unlock } = useCall();
  const [unlocking, setUnlocking] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const codeInput = useRef<HTMLInputElement>(null);

  const mine = isActive(demo.agentId);
  const live = mine && call.status === "live";
  const otherCall = busy && !mine;
  const status = STATUS[availability.invited];

  async function onCall() {
    if (mine) return stopCall();
    if (busy) return;
    setError(null);
    if (availability.invited === "resting") {
      setError("Today's demo minutes are used up. Try again tomorrow, or email Eashan.");
      return;
    }
    const res = await startCall(demo.agentId, { agentId: demo.agentId });
    if (!res.ok && res.error) setError(res.error);
  }

  async function onUnlock() {
    if (!code.trim()) {
      codeInput.current?.focus();
      return;
    }
    setWorking(true);
    setError(null);
    const res = await unlock(code.trim());
    setWorking(false);
    if (res.ok) setUnlocking(false);
    else setError(res.error ?? "That didn't work.");
  }

  const stateLabel =
    call.status === "connecting"
      ? "connecting…"
      : call.agentState === "speaking"
        ? `${demo.agentName.toLowerCase()} is speaking`
        : call.agentState === "thinking"
          ? "thinking…"
          : "listening";

  const message = error ?? (owner === demo.agentId && !busy ? call.notice : null);

  return (
    <article
      aria-label={demo.title}
      style={{
        background: "var(--surface)",
        border: `1px solid ${mine ? "var(--accent)" : "var(--line)"}`,
        borderRadius: 20,
        padding: 28,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        className="mono"
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 12, color: "var(--muted)" }}
      >
        <span>
          {demo.num} · {demo.slug} · {demo.market}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: status.color }} />
          {status.label}
        </span>
      </div>

      <h3 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>{demo.title}</h3>
      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: "var(--body)" }}>{demo.body}</p>
      <p className="mono" style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
        {demo.agentName} · {demo.company} (fictional)
      </p>

      {mine && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "8px 0" }}>
          <VoiceOrb
            live={live}
            readSpectrum={call.readSpectrum}
            spectrumSize={call.spectrumSize}
            size={168}
            bars={40}
            idleHeight={8}
            minHeight={10}
            maxHeight={30}
          >
            <div
              className="mono"
              style={{
                width: 104,
                height: 104,
                borderRadius: "50%",
                background: "var(--surface-2)",
                border: "1px solid var(--ring-idle)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13,
                color: "var(--body)",
                position: "relative",
              }}
            >
              {demo.initials}
            </div>
          </VoiceOrb>
          <span className="mono" style={{ fontSize: 12, color: live ? "var(--accent)" : "var(--muted)" }}>
            {stateLabel}
          </span>
          <LatencyChips record={call.lastRecord} />
        </div>
      )}

      <div
        style={{
          border: "1px dashed var(--ring-idle)",
          borderRadius: 12,
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          fontSize: 14,
          lineHeight: 1.5,
        }}
      >
        <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
          YOUR ROLE
        </span>
        <span style={{ color: "var(--ink)" }}>
          <strong style={{ fontWeight: 600 }}>{demo.role.who}</strong> {demo.role.facts}
        </span>
        <span style={{ color: "var(--body)" }}>
          <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
            Try:{" "}
          </span>
          {demo.tryThis.join(" · ")}
        </span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
        {!unlocked && !mine ? (
          unlocking ? (
            <>
              <input
                ref={codeInput}
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void onUnlock()}
                placeholder="Invite code"
                aria-label={`Invite code for the ${demo.title.toLowerCase()}`}
                autoComplete="off"
                className="mono"
                style={{
                  minHeight: 44,
                  width: 160,
                  boxSizing: "border-box",
                  padding: "0 14px",
                  borderRadius: 999,
                  border: "1px solid var(--line)",
                  background: "var(--bg)",
                  color: "var(--ink)",
                  fontSize: 13,
                }}
              />
              <button
                type="button"
                onClick={onUnlock}
                disabled={working}
                style={{ ...button, border: "none", background: "var(--ink)", color: "var(--bg)" }}
              >
                {working ? "Checking…" : "Unlock"}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setUnlocking(true)}
              style={{ ...button, border: "1px solid var(--line)", background: "transparent", color: "var(--ink)" }}
            >
              Unlock with invite code
            </button>
          )
        ) : (
          <button
            type="button"
            onClick={onCall}
            disabled={otherCall}
            aria-pressed={live}
            style={{
              ...button,
              border: mine ? "1px solid var(--ink)" : "none",
              background: mine ? "transparent" : "var(--ink)",
              color: mine ? "var(--ink)" : "var(--bg)",
              opacity: otherCall ? 0.5 : 1,
              cursor: otherCall ? "not-allowed" : "pointer",
            }}
          >
            {mine ? "Hang up" : otherCall ? "On a call" : `Call ${demo.agentName}`}
          </button>
        )}
        <Link
          href={`/playground?agent=${demo.slug}`}
          className="mono"
          style={{ minHeight: 44, display: "inline-flex", alignItems: "center", padding: "0 8px", fontSize: 13, color: "var(--body)" }}
        >
          View prompt →
        </Link>
      </div>

      <p role="status" style={{ margin: 0, minHeight: 0, fontSize: 14, color: error ? "var(--danger)" : "var(--body)" }}>
        {message}
      </p>
    </article>
  );
}
