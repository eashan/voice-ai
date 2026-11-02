import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import type { ClientMessage } from "@voiceforge/shared";
import { BrowserWsTransport } from "./transport/BrowserWsTransport.js";
import { loadAgent } from "./config/loadAgent.js";
import { ALLOWED_ORIGINS, LIMITS } from "./config/env.js";
import { Gate } from "./gate/Gate.js";
import { ElevenLabsStt } from "./providers/elevenlabs/ElevenLabsStt.js";
import { Session } from "./session/Session.js";
import { ClaudeLlm } from "./providers/anthropic/ClaudeLlm.js";
import { DeepgramTts } from "./providers/deepgram/DeepgramTts.js";

const PORT = Number(process.env.ORCHESTRATOR_PORT ?? 8787);
/** A connection must send a valid `start` within this time. */
const START_TIMEOUT_MS = 10_000;
/** Largest inbound frame we accept (audio frames are 640 B; JSON is tiny). */
const MAX_PAYLOAD_BYTES = 64 * 1024;

const agent = loadAgent();
// A/B override for latency experiments: ENDPOINTER=provider_vad|silero_vad
if (process.env.ENDPOINTER === "provider_vad" || process.env.ENDPOINTER === "silero_vad") {
  agent.turnTaking.endpointer = process.env.ENDPOINTER;
}
const gate = new Gate({ wid: agent.workspaceId, aid: agent.agentId });
const stt = new ElevenLabsStt();
const tts = new DeepgramTts();

const http = createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, agent: agent.agentId, ...gate.status() }));
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
      gate.begin(sessionId);
      session = new Session(sessionId, agent, transport, stt, new ClaudeLlm(agent.llm), tts, {
        maxCallMs: LIMITS.maxCallMs,
        silenceHangupMs: LIMITS.silenceHangupMs,
        budgetExhausted: () => gate.budgetLeftSeconds() <= 0,
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
      transport.sendEvent({ type: "ready", sessionId, inputFormat: transport.inputFormat, outputFormat: transport.outputFormat });
      console.log(`[session ${sessionId}] started`);
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
    `orchestrator listening on :${PORT} (agent ${agent.agentId}, endpointer ${agent.turnTaking.endpointer}, ` +
      `demo ${s.enabled ? "enabled" : "DISABLED"}, ${s.budgetLeftMinutes} min budget left today, ` +
      `origins ${ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS.join(" ") : "any (dev)"})`,
  );
});
