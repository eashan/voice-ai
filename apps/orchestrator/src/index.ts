import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import type { AgentConfig, ClientMessage } from "@voiceforge/shared";
import { BrowserWsTransport } from "./transport/BrowserWsTransport.js";
import { loadAgents } from "./config/loadAgent.js";
import { ALLOWED_ORIGINS, LIMITS } from "./config/env.js";
import { Gate } from "./gate/Gate.js";
import { ElevenLabsStt } from "./providers/elevenlabs/ElevenLabsStt.js";
import { Session } from "./session/Session.js";
import { ClaudeLlm } from "./providers/anthropic/ClaudeLlm.js";
import { DeepgramTts } from "./providers/deepgram/DeepgramTts.js";
import { ElevenLabsTts } from "./providers/elevenlabs/ElevenLabsTts.js";
import type { TtsProvider } from "./providers/types.js";

const PORT = Number(process.env.ORCHESTRATOR_PORT ?? 8787);
/** A connection must send a valid `start` within this time. */
const START_TIMEOUT_MS = 10_000;
/** Largest inbound frame we accept (audio frames are 640 B; JSON is tiny). */
const MAX_PAYLOAD_BYTES = 64 * 1024;

const agents = loadAgents();
// A/B override for latency experiments: ENDPOINTER=provider_vad|silero_vad
if (process.env.ENDPOINTER === "provider_vad" || process.env.ENDPOINTER === "silero_vad") {
  for (const a of agents.values()) a.turnTaking.endpointer = process.env.ENDPOINTER;
}
const gate = new Gate(agents);
const stt = new ElevenLabsStt();
/** One provider instance per vendor, created on first use (each call still opens its own socket). */
const ttsProviders = new Map<AgentConfig["voice"]["provider"], TtsProvider>();
const ttsFor = (agent: AgentConfig): TtsProvider => {
  let p = ttsProviders.get(agent.voice.provider);
  if (!p) {
    p = agent.voice.provider === "elevenlabs" ? new ElevenLabsTts() : new DeepgramTts();
    ttsProviders.set(agent.voice.provider, p);
  }
  return p;
};

const http = createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, agents: [...agents.keys()], ...gate.status() }));
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({
  server: http,
  path: "/ws",
  maxPayload: MAX_PAYLOAD_BYTES,
  verifyClient: ({ origin }: { origin: string }) => ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin),
});

wss.on("connection", (ws) => {
  const transport = new BrowserWsTransport(ws);
  const sessionId = randomUUID();
  let session: Session | null = null;
  const startTimer = setTimeout(() => !session && ws.close(4408, "start timeout"), START_TIMEOUT_MS);

  ws.on("message", async (data, isBinary) => {
    if (isBinary) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString()) as ClientMessage;
    } catch {
      return;
    }
    if (msg.type === "start" && !session) {
      const admission = gate.admit(msg.token);
      if (!admission.ok) {
        console.log(`[session ${sessionId}] rejected: ${admission.reason}`);
        transport.sendEvent({ type: "error", code: admission.reason, message: admission.message });
        ws.close(4403, admission.reason);
        return;
      }
      clearTimeout(startTimer);
      const { agent, tier } = admission;
      gate.begin(sessionId, tier);
      session = new Session(sessionId, agent, transport, stt, new ClaudeLlm(agent.llm), ttsFor(agent), {
        maxCallMs: LIMITS.maxCallMs,
        silenceHangupMs: LIMITS.silenceHangupMs,
        budgetExhausted: () => gate.budgetLeftSeconds(tier) <= 0,
      });
      try {
        await session.start();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[session ${sessionId}] start failed: ${message}`);
        transport.sendEvent({ type: "error", code: "session_start_failed", message: "Could not start the call." });
        transport.close();
        return;
      }
      transport.sendEvent({
        type: "ready",
        sessionId,
        agentId: agent.agentId,
        inputFormat: transport.inputFormat,
        outputFormat: transport.outputFormat,
      });
      console.log(`[session ${sessionId}] started (${agent.agentId}, ${tier})`);
      session.greet();
    } else if (msg.type === "playback_stopped") {
      session?.onPlaybackStopped(msg.turnId, msg.playedMs);
    } else if (msg.type === "hangup") {
      transport.close();
    }
  });

  transport.onClose(() => {
    clearTimeout(startTimer);
    gate.end(sessionId);
    void session?.close();
    if (session) console.log(`[session ${sessionId}] closed`);
  });
});

http.listen(PORT, () => {
  const s = gate.status();
  console.log(
    `orchestrator listening on :${PORT} (demo ${s.enabled ? "enabled" : "DISABLED"}, ` +
      `minutes left today: public ${s.tiers.public.budgetLeftMinutes}, invited ${s.tiers.invited.budgetLeftMinutes}, ` +
      `origins ${ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS.join(" ") : "any (dev)"})`,
  );
  for (const a of agents.values()) {
    console.log(
      `  agent ${a.agentId} [${a.access}]: llm ${a.llm.model}, tts ${a.voice.provider}/${a.voice.voiceId}, ` +
        `endpointer ${a.turnTaking.endpointer} ${a.turnTaking.silenceMs}ms`,
    );
  }
});
