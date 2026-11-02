import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import type { ClientMessage } from "@voiceforge/shared";
import { BrowserWsTransport } from "./transport/BrowserWsTransport.js";
import { loadAgent } from "./config/loadAgent.js";

const PORT = Number(process.env.ORCHESTRATOR_PORT ?? 8787);
const agent = loadAgent();

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
  let started = false;

  ws.on("message", (data, isBinary) => {
    if (isBinary) return;
    const msg = JSON.parse(data.toString()) as ClientMessage;
    if (msg.type === "start" && !started) {
      // TODO(week 3): verify session JWT + caps before accepting.
      started = true;
      transport.sendEvent({
        type: "ready",
        sessionId,
        inputFormat: transport.inputFormat,
        outputFormat: transport.outputFormat,
      });
      console.log(`[session ${sessionId}] started`);
    } else if (msg.type === "hangup") {
      transport.close();
    }
  });

  // Week 1 step 3: loopback to verify browser capture → server → playback.
  // Replaced by STT → LLM → TTS pipeline in week 2.
  transport.onAudio((frame) => {
    if (started) transport.sendAudio(frame);
  });

  transport.onClose(() => console.log(`[session ${sessionId}] closed`));
});

http.listen(PORT, () => console.log(`orchestrator listening on :${PORT} (agent ${agent.agentId})`));
