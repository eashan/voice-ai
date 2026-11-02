"use client";

import { useRef, useState } from "react";
import type { ServerMessage } from "@voiceforge/shared";

const WS_URL = process.env.NEXT_PUBLIC_ORCHESTRATOR_WS_URL ?? "ws://localhost:8787/ws";
const SAMPLE_RATE = 16000;

export default function Page() {
  const [status, setStatus] = useState<"idle" | "connecting" | "live">("idle");
  const [log, setLog] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playheadRef = useRef(0);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);

  const push = (line: string) => setLog((l) => [...l.slice(-30), line]);

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
    sourcesRef.current.push(src);
    src.onended = () => (sourcesRef.current = sourcesRef.current.filter((s) => s !== src));
  }

  function stopPlayback() {
    sourcesRef.current.forEach((s) => s.stop());
    sourcesRef.current = [];
    playheadRef.current = 0;
  }

  async function start() {
    setStatus("connecting");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    await ctx.audioWorklet.addModule("/pcm-worklet.js");
    const node = new AudioWorkletNode(ctx, "pcm-capture");
    ctx.createMediaStreamSource(stream).connect(node);

    const ws = new WebSocket(WS_URL);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => ws.send(JSON.stringify({ type: "start", token: "dev" }));
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return playPcm(ev.data as ArrayBuffer);
      const msg = JSON.parse(ev.data) as ServerMessage;
      if (msg.type === "ready") setStatus("live");
      if (msg.type === "stop_playback") stopPlayback();
      push(JSON.stringify(msg));
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
    ctxRef.current?.close();
    wsRef.current = null;
    ctxRef.current = null;
    streamRef.current = null;
    playheadRef.current = 0;
    setStatus("idle");
  }

  return (
    <main>
      <h1>VoiceForge</h1>
      <p>M0 demo — week 1 loopback (you should hear yourself; use headphones).</p>
      <button onClick={status === "idle" ? start : stop} style={{ fontSize: 18, padding: "12px 24px" }}>
        {status === "idle" ? "Talk" : status === "connecting" ? "Connecting…" : "Hang up"}
      </button>
      <pre style={{ background: "#f4f4f4", padding: 12, marginTop: 24, fontSize: 12, whiteSpace: "pre-wrap" }}>
        {log.join("\n")}
      </pre>
    </main>
  );
}
