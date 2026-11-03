"use client";

import { useEffect, useRef, useState } from "react";
import { SANDBOX_LIMITS } from "@voiceforge/shared/sandbox";
import { AGENT_PROMPTS } from "../content/agentPrompts.generated";
import { useCall } from "../lib/CallContext";
import type { CallTurn } from "../lib/useVoiceCall";
import { LatencyWaterfall } from "./LatencyWaterfall";
import { Line } from "./TranscriptPanel";
import { VoiceOrb } from "./VoiceOrb";

/** Tab label + the name inside the orb, keyed by the agent file slug (also the `?agent=` value). */
const TABS: Record<string, { label: string; short: string; speaker: string }> = {
  "debt-collection": { label: "Debt collection", short: "riya", speaker: "riya" },
  "insurance-support": { label: "Insurance support", short: "sameer", speaker: "sameer" },
  "roofing-support": { label: "Roofing support", short: "jo", speaker: "jo" },
  "portfolio-concierge": { label: "Portfolio concierge", short: "concierge", speaker: "the agent" },
};

type Draft = { prompt: string; greeting: string };

const fmt = (n: number) => n.toLocaleString("en-US");

const card: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: 20,
};

const pill: React.CSSProperties = {
  minHeight: 44,
  padding: "0 18px",
  borderRadius: 999,
  fontFamily: "inherit",
  fontSize: 15,
  cursor: "pointer",
};

const field: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "var(--bg)",
  color: "var(--ink)",
  border: "1px solid var(--line)",
  borderRadius: 12,
  fontFamily: "var(--font-mono), monospace",
  fontSize: 13,
  lineHeight: 1.6,
};

/**
 * /playground: pick an agent, rewrite its greeting + system prompt, call it. Readable and editable by anyone;
 * calling needs the invite (the unlock box replaces Start call). Edits live per tab until reload.
 */
export function Playground() {
  const { call, isActive, busy, startCall, stopCall, availability, unlocked, unlock } = useCall();
  const [slug, setSlug] = useState(AGENT_PROMPTS[0]!.slug);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [working, setWorking] = useState(false);
  const codeInput = useRef<HTMLInputElement>(null);

  // ?agent=<slug> picks the tab ("View prompt →" on the home cards). Read after mount so the page stays static.
  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get("agent");
    if (want && AGENT_PROMPTS.some((a) => a.slug === want)) setSlug(want);
  }, []);

  const base = AGENT_PROMPTS.find((a) => a.slug === slug)!;
  const tab = TABS[slug]!;
  const draft: Draft = drafts[slug] ?? { prompt: base.prompt, greeting: base.greeting };
  const edited = draft.prompt !== base.prompt || draft.greeting !== base.greeting;
  const owner = `playground:${base.agentId}`;
  const mine = isActive(owner);
  const live = mine && call.status === "live";

  const overPrompt = draft.prompt.length > SANDBOX_LIMITS.promptChars;
  const overGreeting = draft.greeting.length > SANDBOX_LIMITS.greetingChars;
  const empty = !draft.prompt.trim() || !draft.greeting.trim();
  const invalid = overPrompt || overGreeting || empty;

  function pick(next: string) {
    if (busy || next === slug) return;
    setSlug(next);
    setError(null);
    const url = new URL(window.location.href);
    url.searchParams.set("agent", next);
    window.history.replaceState(null, "", url);
  }

  const edit = (patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [slug]: { ...draft, ...patch } }));

  function reset() {
    setDrafts((d) => {
      const next = { ...d };
      delete next[slug];
      return next;
    });
  }

  async function onCall() {
    if (mine) return stopCall();
    if (busy || invalid) return;
    setError(null);
    if (availability.invited === "resting") {
      setError("Today's demo minutes are used up. Try again tomorrow, or email Eashan.");
      return;
    }
    const res = await startCall(owner, { agentId: base.agentId, prompt: draft.prompt, greeting: draft.greeting });
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
    if (!res.ok) setError(res.error ?? "That didn't work.");
  }

  const stateLabel = !mine
    ? "idle · 3 min max per call"
    : call.status === "connecting"
      ? "connecting…"
      : call.agentState === "speaking"
        ? `${tab.speaker} is speaking · tap Hang up to end`
        : call.agentState === "thinking"
          ? "thinking…"
          : "listening";

  const message = error ?? (mine || !busy ? call.notice : null);
  const turns = mine || !busy ? call.turns : [];
  const lastTurnNo = call.lastRecord
    ? call.turns.filter((t) => t.id >= 0 && t.id <= call.lastRecord!.turnId && (t.user || t.agent)).length || null
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28, paddingTop: 40 }}>
      <header style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h1 style={{ margin: 0, fontSize: 56, fontWeight: 800, letterSpacing: "-0.045em", lineHeight: 1 }}>Agent playground</h1>
          <p style={{ margin: 0, maxWidth: 680, fontSize: 18, lineHeight: 1.5, color: "var(--body)" }}>
            Pick an agent, rewrite its system prompt, then call it. Your prompt runs for this call only.
          </p>
        </div>
        {unlocked && (
          <span
            className="mono"
            style={{ fontSize: 12, color: "var(--ok)", border: "1px solid var(--line)", borderRadius: 999, padding: "8px 14px" }}
          >
            ● invite unlocked
          </span>
        )}
      </header>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start" }}>
        <section
          aria-label="Prompt editor"
          style={{ ...card, flex: "999 1 560px", minWidth: 0, padding: 24, display: "flex", flexDirection: "column", gap: 16 }}
        >
          <div
            role="tablist"
            aria-label="Base agent"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              background: "var(--bg)",
              border: "1px solid var(--line)",
              borderRadius: 12,
              padding: 4,
            }}
          >
            {AGENT_PROMPTS.map((a) => {
              const sel = a.slug === slug;
              return (
                <button
                  key={a.slug}
                  type="button"
                  role="tab"
                  aria-selected={sel}
                  disabled={busy && !sel}
                  onClick={() => pick(a.slug)}
                  style={{
                    minHeight: 44,
                    padding: "0 14px",
                    borderRadius: 8,
                    border: "none",
                    background: sel ? "var(--line)" : "transparent",
                    color: sel ? "var(--ink)" : "var(--body)",
                    fontFamily: "inherit",
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: busy && !sel ? "not-allowed" : "pointer",
                    opacity: busy && !sel ? 0.5 : 1,
                  }}
                >
                  {TABS[a.slug]?.label ?? a.slug}
                  {drafts[a.slug] && <span aria-label=" (edited)" style={{ color: "var(--accent)" }}> •</span>}
                </button>
              );
            })}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              border: "1px dashed var(--ring-idle)",
              borderRadius: 12,
              padding: "12px 14px",
              fontSize: 13,
              lineHeight: 1.5,
              color: "var(--muted)",
            }}
          >
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flex: "0 0 auto" }}
            >
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            <span>
              Safety rules run before your prompt and can&apos;t be edited: fictional company only, never collects real card,
              bank or ID numbers, no threats.
              {slug === "portfolio-concierge" && " Eashan's profile facts are attached after your prompt and are locked too."}
            </span>
          </div>

          <label htmlFor="greeting" className="mono" style={{ fontSize: 12, color: "var(--body)" }}>
            greeting <span style={{ color: "var(--muted)" }}>· spoken first, word for word</span>
          </label>
          <input
            id="greeting"
            value={draft.greeting}
            onChange={(e) => edit({ greeting: e.target.value })}
            readOnly={busy}
            autoComplete="off"
            spellCheck
            style={{ ...field, minHeight: 44, padding: "0 16px", borderColor: overGreeting ? "var(--danger)" : "var(--line)" }}
          />

          <label htmlFor="sysprompt" className="mono" style={{ fontSize: 12, color: "var(--body)" }}>
            system_prompt
          </label>
          <textarea
            id="sysprompt"
            value={draft.prompt}
            onChange={(e) => edit({ prompt: e.target.value })}
            readOnly={busy}
            rows={18}
            spellCheck={false}
            style={{ ...field, resize: "vertical", padding: 16, borderColor: overPrompt ? "var(--danger)" : "var(--line)" }}
          />

          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <span className="mono" aria-live="polite" style={{ fontSize: 12, color: overPrompt ? "var(--danger)" : "var(--muted)" }}>
              {fmt(draft.prompt.length)} / {fmt(SANDBOX_LIMITS.promptChars)} chars
              {overGreeting && <span style={{ color: "var(--danger)" }}> · greeting over {SANDBOX_LIMITS.greetingChars}</span>}
            </span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button
                type="button"
                onClick={reset}
                disabled={!edited || busy}
                style={{
                  ...pill,
                  border: "1px solid var(--line)",
                  background: "transparent",
                  color: "var(--ink)",
                  opacity: !edited || busy ? 0.5 : 1,
                  cursor: !edited || busy ? "not-allowed" : "pointer",
                }}
              >
                Reset to default
              </button>
              {unlocked || mine ? (
                <button
                  type="button"
                  onClick={onCall}
                  disabled={(busy && !mine) || (!mine && invalid)}
                  aria-pressed={live}
                  style={{
                    ...pill,
                    padding: "0 20px",
                    fontWeight: 600,
                    border: mine ? "1px solid var(--ink)" : "none",
                    background: mine ? "transparent" : "var(--accent)",
                    color: mine ? "var(--ink)" : "var(--accent-ink)",
                    opacity: (busy && !mine) || (!mine && invalid) ? 0.5 : 1,
                    cursor: (busy && !mine) || (!mine && invalid) ? "not-allowed" : "pointer",
                  }}
                >
                  {mine ? "Hang up" : busy ? "On a call" : "Start call with this prompt"}
                </button>
              ) : (
                <>
                  <input
                    ref={codeInput}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void onUnlock()}
                    placeholder="Invite code"
                    aria-label="Invite code to call the agent"
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
                    style={{ ...pill, fontWeight: 600, border: "none", background: "var(--ink)", color: "var(--bg)" }}
                  >
                    {working ? "Checking…" : "Unlock to call"}
                  </button>
                </>
              )}
            </div>
          </div>
          {!unlocked && !mine && (
            <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
              Anyone can read and edit the prompts. Calling an agent needs an invite code; email Eashan for one.
            </p>
          )}
          <p role="status" style={{ margin: 0, fontSize: 14, color: error ? "var(--danger)" : "var(--body)" }}>
            {message}
          </p>
        </section>

        <section aria-label="Live call" style={{ flex: "1 1 380px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ ...card, padding: 24, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
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
                {tab.short}
              </div>
            </VoiceOrb>
            <span className="mono" style={{ fontSize: 12, color: live ? "var(--accent)" : "var(--muted)" }}>
              {stateLabel}
            </span>
          </div>

          <Transcript turns={turns} />
          <LatencyWaterfall record={mine || !busy ? call.lastRecord : null} turn={lastTurnNo} />
        </section>
      </div>
    </div>
  );
}

function Transcript({ turns }: { turns: CallTurn[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const shown = turns.filter((t) => t.agent || t.user || t.partial || t.record?.interrupted);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  return (
    <div style={{ ...card, padding: "20px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 className="mono" style={{ margin: 0, fontSize: 12, fontWeight: 500, color: "var(--body)" }}>
        transcript
      </h2>
      <div
        ref={scroller}
        aria-live="polite"
        style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: 300, overflowY: "auto" }}
      >
        {shown.length === 0 && (
          <p style={{ margin: 0, fontSize: 14, color: "var(--muted)" }}>The conversation shows up here once the call starts.</p>
        )}
        {shown.map((t) => (
          <div key={t.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
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
    </div>
  );
}
