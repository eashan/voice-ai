"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentState, ClientMessage, LatencyStage, ServerMessage, TurnLatencyRecord } from "@voiceforge/shared";

const SAMPLE_RATE = 16000;
const INVITE_KEY = "voiceforge.invite";

const ENDED_MESSAGES: Record<Extract<ServerMessage, { type: "ended" }>["reason"], string> = {
  hangup: "Call ended.",
  max_duration: "Demo calls are limited to 3 minutes. Thanks for trying it!",
  silence_timeout: "Hung up after 20 seconds of silence.",
  budget_exhausted: "Today's demo minutes are used up. Try again tomorrow.",
  disabled: "The demo is paused right now.",
  error: "The call dropped because of a connection problem. Please try again.",
};

interface Turn {
  id: number;
  partial: string;
  user: string;
  agent: string;
  record?: TurnLatencyRecord;
}

const STATE_COLORS: Record<AgentState, string> = {
  listening: "#2a7",
  user_speaking: "#27a",
  thinking: "#a72",
  speaking: "#72a",
};

/** Waterfall segments: [label, from-stage, to-stage, color]. */
const SEGMENTS: Array<[string, LatencyStage, LatencyStage, string]> = [
  ["endpointing", "speech_end", "endpoint", "#7aa2f7"],
  ["STT finalize", "endpoint", "stt_final", "#9ece6a"],
  ["LLM TTFT", "llm_request", "llm_first_token", "#e0af68"],
  ["TTS first byte", "tts_first_send", "tts_first_byte", "#bb9af7"],
];

function Waterfall({ record }: { record: TurnLatencyRecord }) {
  const s = record.stages;
  const origin = s.speech_end;
  if (origin == null) return null;
  const end = Math.max(...Object.values(s).filter((v): v is number => v != null));
  const total = Math.max(end - origin, 1);
  return (
    <div style={{ marginTop: 8 }}>
      {SEGMENTS.map(([label, from, to, color]) => {
        const a = s[from];
        const b = s[to];
        if (a == null || b == null) return null;
        return (
          <div key={label} style={{ display: "flex", alignItems: "center", fontSize: 12, height: 18 }}>
            <span style={{ width: 110, color: "#666" }}>{label}</span>
            <div style={{ position: "relative", flex: 1, height: 10, background: "#f0f0f0", borderRadius: 2 }}>
              <div
                style={{
                  position: "absolute",
                  left: `${((a - origin) / total) * 100}%`,
                  width: `${Math.max(((b - a) / total) * 100, 0.5)}%`,
                  height: "100%",
                  background: color,
                  borderRadius: 2,
                }}
              />
            </div>
            <span style={{ width: 60, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{(b - a).toFixed(0)} ms</span>
          </div>
        );
      })}
      <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
        speech end → first LLM token:{" "}
        <b>{s.llm_first_token != null ? `${(s.llm_first_token - origin).toFixed(0)} ms` : "–"}</b>
        {record.serverV2vMs != null && (
          <>
            {" "}
            · server V2V: <b>{record.serverV2vMs.toFixed(0)} ms</b>
          </>
        )}
        {record.cacheReadInputTokens != null && <> · cache read {record.cacheReadInputTokens} tok</>}
      </div>
    </div>
  );
}

export default function Page() {
  const [status, setStatus] = useState<"idle" | "connecting" | "live">("idle");
  const [agentState, setAgentState] = useState<AgentState | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [invite, setInvite] = useState("");
  useEffect(() => setInvite(localStorage.getItem(INVITE_KEY) ?? ""), []);
  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playheadRef = useRef(0);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  /** Audio scheduled for the current reply (since its audio_start), to report exactly how much was played. */
  const replyRef = useRef<{ turnId: number; spans: Array<[number, number]> } | null>(null);

  const send = (msg: ClientMessage) =>
    wsRef.current?.readyState === WebSocket.OPEN && wsRef.current.send(JSON.stringify(msg));

  const updateTurn = (id: number, fn: (t: Turn) => Turn) =>
    setTurns((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx === -1) return [...prev, fn({ id, partial: "", user: "", agent: "" })];
      const next = [...prev];
      next[idx] = fn(next[idx]!);
      return next;
    });

  function onServerMessage(msg: ServerMessage) {
    switch (msg.type) {
      case "ready":
        setStatus("live");
        break;
      case "transcript":
        updateTurn(msg.turnId, (t) => (msg.final ? { ...t, user: msg.text, partial: "" } : { ...t, partial: msg.text }));
        break;
      case "state":
        setAgentState(msg.state);
        break;
      case "audio_start":
        replyRef.current = { turnId: msg.turnId, spans: [] };
        break;
      case "agent_text":
        updateTurn(msg.turnId, (t) => ({ ...t, agent: t.agent + msg.text }));
        break;
      case "turn_complete":
        // agentText = what was actually spoken (truncated on barge-in).
        updateTurn(msg.record.turnId, (t) => ({ ...t, record: msg.record, agent: msg.record.agentText ?? t.agent }));
        break;
      case "stop_playback": {
        const playedMs = stopPlayback();
        const reply = replyRef.current;
        if (reply) send({ type: "playback_stopped", reason: "barge_in", turnId: reply.turnId, playedMs });
        replyRef.current = null;
        break;
      }
      case "error":
        setErrors((e) => [...e.slice(-4), `${msg.message} (${msg.code})`]);
        break;
      case "ended":
        setNotice(ENDED_MESSAGES[msg.reason]);
        break;
    }
  }

  function playPcm(data: ArrayBuffer) {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const pcm = new Int16Array(data);
    const buf = ctx.createBuffer(1, pcm.length, SAMPLE_RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i]! / 0x8000;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime + 0.02, playheadRef.current);
    src.start(startAt);
    playheadRef.current = startAt + buf.duration;
    replyRef.current?.spans.push([startAt, buf.duration]);
    sourcesRef.current.push(src);
    src.onended = () => (sourcesRef.current = sourcesRef.current.filter((s) => s !== src));
  }

  /** Stop all audio now; returns ms of the current reply that were actually played. */
  function stopPlayback(): number {
    const t = ctxRef.current?.currentTime ?? 0;
    const played = (replyRef.current?.spans ?? []).reduce((acc, [start, dur]) => acc + Math.min(Math.max(t - start, 0), dur), 0);
    sourcesRef.current.forEach((s) => s.stop());
    sourcesRef.current = [];
    playheadRef.current = 0;
    return Math.round(played * 1000);
  }

  async function start() {
    setStatus("connecting");
    setTurns([]);
    setErrors([]);
    setNotice(null);

    // Invite code → short-lived single-use session token (checked by the orchestrator).
    let session: { token: string; wsUrl: string };
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: invite }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      session = body;
      localStorage.setItem(INVITE_KEY, invite);
    } catch (err) {
      setErrors([err instanceof Error ? err.message : String(err)]);
      setStatus("idle");
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    await ctx.audioWorklet.addModule("/pcm-worklet.js");
    const node = new AudioWorkletNode(ctx, "pcm-capture");
    ctx.createMediaStreamSource(stream).connect(node);

    const ws = new WebSocket(session.wsUrl);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => ws.send(JSON.stringify({ type: "start", token: session.token } satisfies ClientMessage));
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return playPcm(ev.data as ArrayBuffer);
      onServerMessage(JSON.parse(ev.data) as ServerMessage);
    };
    ws.onclose = () => stop();
    node.port.onmessage = (e) => ws.readyState === WebSocket.OPEN && ws.send(e.data as ArrayBuffer);

    wsRef.current = ws;
    ctxRef.current = ctx;
    streamRef.current = stream;
  }

  function stop() {
    wsRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    void ctxRef.current?.close();
    wsRef.current = null;
    ctxRef.current = null;
    streamRef.current = null;
    playheadRef.current = 0;
    replyRef.current = null;
    setAgentState(null);
    setStatus("idle");
  }

  return (
    <main>
      <h1 style={{ marginBottom: 4 }}>VoiceForge</h1>
      <p style={{ color: "#666", marginTop: 0 }}>
        Ask about Eashan&apos;s experience. Interrupt any time. Use headphones so the agent doesn&apos;t hear itself.
        Latencies are server-measured.
      </p>
      {status === "idle" && (
        <input
          value={invite}
          onChange={(e) => setInvite(e.target.value)}
          placeholder="Invite code"
          aria-label="Invite code"
          style={{ fontSize: 18, padding: "11px 12px", marginRight: 8, width: 180 }}
        />
      )}
      <button
        onClick={status === "idle" ? start : stop}
        disabled={status === "idle" && !invite.trim()}
        style={{ fontSize: 18, padding: "12px 24px" }}
      >
        {status === "idle" ? "🎙 Talk" : status === "connecting" ? "Connecting…" : "Hang up"}
      </button>
      {status === "live" && agentState && (
        <span style={{ marginLeft: 12, color: STATE_COLORS[agentState] }}>● {agentState.replace("_", " ")}</span>
      )}

      {notice && <p style={{ color: "#555", background: "#f4f4f4", padding: 8 }}>{notice}</p>}
      {errors.length > 0 && (
        <pre style={{ background: "#fee", color: "#900", padding: 8, fontSize: 12, whiteSpace: "pre-wrap" }}>
          {errors.join("\n")}
        </pre>
      )}

      <div style={{ marginTop: 24 }}>
        {turns.map((t) => (
          <div key={t.id} style={{ borderBottom: "1px solid #eee", padding: "12px 0" }}>
            {t.id >= 0 && (
              <div>
                <b>You:</b> {t.user || <i style={{ color: "#999" }}>{t.partial || "…"}</i>}
              </div>
            )}
            {(t.agent || t.record?.interrupted) && (
              <div style={{ marginTop: 6 }}>
                <b>Agent:</b> {t.agent}
                {t.record?.interrupted && (
                  <i style={{ color: "#c60" }}>
                    {t.agent ? " (interrupted)" : "(you kept talking: merged into the next turn)"}
                  </i>
                )}
              </div>
            )}
            {t.record && <Waterfall record={t.record} />}
          </div>
        ))}
      </div>
    </main>
  );
}
