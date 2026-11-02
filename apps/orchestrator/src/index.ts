import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import type { ClientMessage } from "@voiceforge/shared";
import { BrowserWsTransport } from "./transport/BrowserWsTransport.js";
import { loadAgent } from "./config/loadAgent.js";
import { ElevenLabsStt } from "./providers/elevenlabs/ElevenLabsStt.js";
import { Session } from "./session/Session.js";
import { ClaudeLlm } from "./providers/anthropic/ClaudeLlm.js";
import { DeepgramTts } from "./providers/deepgram/DeepgramTts.js";

const PORT = Number(process.env.ORCHESTRATOR_PORT ?? 8787);
const agent = loadAgent();
// A/B override for latency experiments: ENDPOINTER=provider_vad|silero_vad
if (process.env.ENDPOINTER === "provider_vad" || process.env.ENDPOINTER === "silero_vad") {
  agent.turnTaking.endpointer = process.env.ENDPOINTER;
}
const stt = new ElevenLabsStt();
const tts = new DeepgramTts();

const http = createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, agent: agent.agentId }));
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server: http, path: "/ws" });

wss.on("connection", (ws) => {
  const transport = new BrowserWsTransport(ws);
  const sessionId = randomUUID();
  let session: Session | null = null;

  ws.on("message", async (data, isBinary) => {
    if (isBinary) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString()) as ClientMessage;
    } catch {
      return;
    }
    if (msg.type === "start" && !session) {
      // TODO(week 3): verify session JWT + caps before accepting.
      session = new Session(sessionId, agent, transport, stt, new ClaudeLlm(agent.llm), tts);
      try {
        await session.start();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[session ${sessionId}] start failed: ${message}`);
        transport.sendEvent({ type: "error", code: "session_start_failed", message });
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
    void session?.close();
    console.log(`[session ${sessionId}] closed`);
  });
});

http.listen(PORT, () =>
  console.log(`orchestrator listening on :${PORT} (agent ${agent.agentId}, endpointer ${agent.turnTaking.endpointer})`),
);
