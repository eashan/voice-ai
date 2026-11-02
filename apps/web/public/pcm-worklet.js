// Runs in the AudioWorklet thread. AudioContext is created at 16 kHz, so we only convert
// Float32 [-1,1] → Int16 and batch into 20 ms frames (320 samples).
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Int16Array(320);
    this.i = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let n = 0; n < ch.length; n++) {
      const s = Math.max(-1, Math.min(1, ch[n]));
      this.buf[this.i++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.i === this.buf.length) {
        this.port.postMessage(this.buf.buffer, [this.buf.buffer]);
        this.buf = new Int16Array(320);
        this.i = 0;
      }
    }
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
