import type { WebSocket } from "ws";
import { BROWSER_PCM16, type ServerMessage } from "@voiceforge/shared";
import type { Transport } from "./Transport.js";

export class BrowserWsTransport implements Transport {
  readonly inputFormat = BROWSER_PCM16;
  readonly outputFormat = BROWSER_PCM16;

  constructor(private readonly ws: WebSocket) {}

  onAudio(handler: (frame: Buffer) => void): void {
    this.ws.on("message", (data, isBinary) => {
      if (isBinary) handler(data as Buffer);
    });
  }

  onClose(handler: () => void): void {
    this.ws.on("close", handler);
  }

  sendAudio(frame: Buffer): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(frame, { binary: true });
  }

  sendEvent(msg: ServerMessage): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(msg));
  }

  clearOutbound(): void {
    // Server sends audio as soon as it arrives; the client owns the playback buffer.
    this.sendEvent({ type: "stop_playback" });
  }

  close(): void {
    this.ws.close();
  }
}
