// Probe Deepgram Aura streaming TTS WS: message types + timing. Usage: npx tsx --env-file=.env scripts/probe-deepgram-tts.ts
import WebSocket from "ws";
const t0 = performance.now();
const ms = () => (performance.now() - t0).toFixed(0);
const url = "wss://api.deepgram.com/v1/speak?model=aura-2-thalia-en&encoding=linear16&sample_rate=16000";
const ws = new WebSocket(url, { headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` } });
let bytes = 0;
let firstByte = 0;
let sent = 0;
ws.on("open", () => {
  console.log(`${ms()} open`);
  sent = performance.now();
  ws.send(JSON.stringify({ type: "Speak", text: "Hi there, this is a quick test." }));
  ws.send(JSON.stringify({ type: "Flush" }));
  setTimeout(() => {
    console.log(`${ms()} sending second clause then Clear after 150ms`);
    ws.send(JSON.stringify({ type: "Speak", text: "This second sentence should get cut off by a clear message quite early on." }));
    ws.send(JSON.stringify({ type: "Flush" }));
    setTimeout(() => ws.send(JSON.stringify({ type: "Clear" })), 150);
    setTimeout(() => {
      sent = performance.now();
      firstByte = 0;
      ws.send(JSON.stringify({ type: "Speak", text: "Third, after clear." }));
      ws.send(JSON.stringify({ type: "Flush" }));
    }, 1500);
    setTimeout(() => ws.send(JSON.stringify({ type: "Close" })), 4000);
  }, 2500);
});
ws.on("message", (d, isBinary) => {
  if (isBinary) {
    if (!firstByte) {
      firstByte = performance.now();
      console.log(`${ms()} first audio byte, ttfb=${(firstByte - sent).toFixed(0)}ms`);
    }
    bytes += (d as Buffer).length;
  } else console.log(`${ms()} json ${d.toString()} (audio so far ${bytes} B = ${(bytes / 32000).toFixed(2)} s)`);
});
ws.on("unexpected-response", (_r, res) => console.log("http", res.statusCode));
ws.on("close", (c, r) => console.log(`${ms()} close ${c} ${r}`));
ws.on("error", (e) => console.log("error", e.message));
