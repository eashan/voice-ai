"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentState, ClientMessage, ServerMessage, TurnLatencyRecord } from "@voiceforge/shared";

const SAMPLE_RATE = 16000;
/** 64 frequency bins of 125 Hz at 16 kHz: plenty for a 48-bar ring. */
const FFT_SIZE = 128;

export type CallStatus = "idle" | "connecting" | "live";

export interface CallTurn {
  /** -1 = greeting. */
  id: number;
  partial: string;
  user: string;
  agent: string;
  record?: TurnLatencyRecord;
}

/** Sent to /api/session: which agent, plus proof (a Turnstile token or the invite code; the unlock cookie rides along). */
export interface SessionAuth {
  agentId?: string;
  code?: string;
  turnstileToken?: string;
  /** Playground: the visitor's prompt + greeting for this call (hashed into the token, resent on `start`). */
  prompt?: string;
  greeting?: string;
}

export interface StartResult {
  ok: boolean;
  error?: string;
  /** The server wants an invite code (Turnstile off, or code missing/wrong). */
  needsCode?: boolean;
}

const ENDED_MESSAGES: Record<Extract<ServerMessage, { type: "ended" }>["reason"], string> = {
  hangup: "Call ended.",
  max_duration: "Demo calls are limited to 3 minutes. Thanks for trying it!",
  silence_timeout: "Hung up after 20 seconds of silence.",
  budget_exhausted: "Today's demo minutes are used up. Try again tomorrow.",
  disabled: "The demo is paused right now.",
  error: "The call dropped because of a connection problem. Please try again.",
};

/**
 * One browser voice call to the orchestrator: mic capture (16 kHz PCM16 via AudioWorklet), agent audio
 * playback with barge-in reporting, transcript + latency events, and analysers for the orb.
 */
export function useVoiceCall() {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [agentState, setAgentState] = useState<AgentState | null>(null);
  const [turns, setTurns] = useState<CallTurn[]>([]);
  const [lastRecord, setLastRecord] = useState<TurnLatencyRecord | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const outRef = useRef<AnalyserNode | null>(null);
  const micRef = useRef<AnalyserNode | null>(null);
  const playheadRef = useRef(0);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  /** Audio scheduled for the current reply (since its audio_start), to report exactly how much was played. */
  const replyRef = useRef<{ turnId: number; spans: Array<[number, number]> } | null>(null);
  const scratch = useRef<Uint8Array<ArrayBuffer>>(new Uint8Array(FFT_SIZE / 2));

  const send = (msg: ClientMessage) =>
    wsRef.current?.readyState === WebSocket.OPEN && wsRef.current.send(JSON.stringify(msg));

  const updateTurn = (id: number, fn: (t: CallTurn) => CallTurn) =>
    setTurns((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx === -1) return [...prev, fn({ id, partial: "", user: "", agent: "" })];
      const next = [...prev];
      next[idx] = fn(next[idx]!);
      return next;
    });

  /** Stop all agent audio now; returns ms of the current reply that were actually played. */
  function stopPlayback(): number {
    const t = ctxRef.current?.currentTime ?? 0;
    const played = (replyRef.current?.spans ?? []).reduce((acc, [s, d]) => acc + Math.min(Math.max(t - s, 0), d), 0);
    sourcesRef.current.forEach((s) => s.stop());
    sourcesRef.current = [];
    playheadRef.current = 0;
    return Math.round(played * 1000);
  }

  function playPcm(data: ArrayBuffer) {
    const ctx = ctxRef.current;
    const out = outRef.current;
    if (!ctx || !out) return;
    const pcm = new Int16Array(data);
    const buf = ctx.createBuffer(1, pcm.length, SAMPLE_RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i]! / 0x8000;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(out);
    const startAt = Math.max(ctx.currentTime + 0.02, playheadRef.current);
    src.start(startAt);
    playheadRef.current = startAt + buf.duration;
    replyRef.current?.spans.push([startAt, buf.duration]);
    sourcesRef.current.push(src);
    src.onended = () => (sourcesRef.current = sourcesRef.current.filter((s) => s !== src));
  }

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
        if (!msg.record.interrupted && msg.record.serverV2vMs != null) setLastRecord(msg.record);
        break;
      case "stop_playback": {
        const playedMs = stopPlayback();
        const reply = replyRef.current;
        if (reply) send({ type: "playback_stopped", reason: "barge_in", turnId: reply.turnId, playedMs });
        replyRef.current = null;
        break;
      }
      case "error":
        setNotice(msg.message);
        break;
      case "ended":
        setNotice(ENDED_MESSAGES[msg.reason]);
        break;
    }
  }

  const stop = useCallback(() => {
    wsRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    void ctxRef.current?.close();
    wsRef.current = null;
    ctxRef.current = null;
    streamRef.current = null;
    outRef.current = null;
    micRef.current = null;
    playheadRef.current = 0;
    replyRef.current = null;
    sourcesRef.current = [];
    setAgentState(null);
    setStatus("idle");
  }, []);

  useEffect(() => stop, [stop]);

  async function start(auth: SessionAuth): Promise<StartResult> {
    if (status !== "idle") return { ok: false };
    setStatus("connecting");
    setTurns([]);
    setLastRecord(null);
    setNotice(null);

    // Mic first: if the visitor says no, no session token is spent.
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch {
      setStatus("idle");
      return { ok: false, error: "Microphone access is needed for the call. Allow it in your browser and try again." };
    }

    let session: { token: string; wsUrl: string };
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(auth),
      });
      const body = (await res.json()) as { token?: string; wsUrl?: string; error?: string; needsCode?: boolean };
      if (!res.ok || !body.token || !body.wsUrl) {
        stream.getTracks().forEach((t) => t.stop());
        setStatus("idle");
        return { ok: false, error: body.error ?? `HTTP ${res.status}`, needsCode: body.needsCode };
      }
      session = { token: body.token, wsUrl: body.wsUrl };
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      setStatus("idle");
      return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
    }

    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    await ctx.resume();
    await ctx.audioWorklet.addModule("/pcm-worklet.js");
    const capture = new AudioWorkletNode(ctx, "pcm-capture");
    const mic = ctx.createMediaStreamSource(stream);
    mic.connect(capture);
    const micAnalyser = ctx.createAnalyser();
    micAnalyser.fftSize = FFT_SIZE;
    micAnalyser.smoothingTimeConstant = 0.7;
    mic.connect(micAnalyser);
    const outAnalyser = ctx.createAnalyser();
    outAnalyser.fftSize = FFT_SIZE;
    outAnalyser.smoothingTimeConstant = 0.7;
    outAnalyser.connect(ctx.destination);

    const ws = new WebSocket(session.wsUrl);
    ws.binaryType = "arraybuffer";
    const startMsg: ClientMessage =
      auth.prompt !== undefined
        ? { type: "start", token: session.token, prompt: auth.prompt, greeting: auth.greeting }
        : { type: "start", token: session.token };
    ws.onopen = () => ws.send(JSON.stringify(startMsg));
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return playPcm(ev.data as ArrayBuffer);
      onServerMessage(JSON.parse(ev.data) as ServerMessage);
    };
    ws.onclose = () => stop();
    capture.port.onmessage = (e) => ws.readyState === WebSocket.OPEN && ws.send(e.data as ArrayBuffer);

    wsRef.current = ws;
    ctxRef.current = ctx;
    streamRef.current = stream;
    outRef.current = outAnalyser;
    micRef.current = micAnalyser;
    return { ok: true };
  }

  /**
   * Fill `out` (length FFT_SIZE/2) with the louder of agent playback and mic, per frequency bin (0–255).
   * Returns false when there is no live audio graph.
   */
  const readSpectrum = useCallback((out: Uint8Array<ArrayBuffer>): boolean => {
    const a = outRef.current;
    const m = micRef.current;
    if (!a || !m) return false;
    a.getByteFrequencyData(out);
    const tmp = scratch.current;
    m.getByteFrequencyData(tmp);
    for (let i = 0; i < out.length; i++) out[i] = Math.max(out[i]!, tmp[i]!);
    return true;
  }, []);

  return { status, agentState, turns, lastRecord, notice, start, stop, readSpectrum, spectrumSize: FFT_SIZE / 2 };
}

export type VoiceCall = ReturnType<typeof useVoiceCall>;
