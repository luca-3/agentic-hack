/* global AudioWorkletProcessor, registerProcessor */
// AudioWorklet for the offscreen document: mono Float32 frames of 1280 samples (80 ms at 16 kHz) → main thread.
// Shipped as a plain file (wxt.config.ts copies it to /voice/pcm-worklet.js): the extension CSP blocks Blob/data worklets.
const FRAME = 1280;

class LotsePcmFrames extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(FRAME);
    this.pos = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.frame[this.pos++] = channel[i];
        if (this.pos === FRAME) {
          this.port.postMessage(this.frame, [this.frame.buffer]);
          this.frame = new Float32Array(FRAME);
          this.pos = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("lotse-pcm-frames", LotsePcmFrames);
