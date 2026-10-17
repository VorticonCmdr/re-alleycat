// Renders the PC-speaker event log (virtual-time stamped) to Web Audio buffers.
// Presentation only: audio never feeds back into the simulation.

import { PIT_HZ } from '../machine/clock.js';

export class SpeakerAudio {
  constructor(speaker, clock) {
    this.speaker = speaker;
    this.clock = clock;
    this.ctx = null;
    this.state = { gate: 0, data: 0, divisor: 65536, since: 0 };
    this.cursorCycles = 0;
    this.playAt = 0;
    this.volume = 0.12;
    this.dc = 0;
  }

  // Must be called from a user gesture (autoplay policy).
  start() {
    if (this.ctx) return this.ctx.resume();
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.cursorCycles = this.clock.cycles;
    this.speaker.drain(this.clock.cycles);
    return this.ctx.resume();
  }

  // Render everything between the last call and the current virtual time.
  pump() {
    const ctx = this.ctx;
    const now = this.clock.cycles;
    if (!ctx || ctx.state !== 'running') {
      this.speaker.drain(now);
      this.cursorCycles = now;
      return;
    }
    const cpms = this.clock.cyclesPerMs;
    const rate = ctx.sampleRate;
    const span = now - this.cursorCycles;
    if (span <= 0) return;
    const frames = Math.floor((span / cpms / 1000) * rate);
    if (frames <= 0) return;
    const events = this.speaker.drain(now);
    const buf = ctx.createBuffer(1, frames, rate);
    const out = buf.getChannelData(0);
    const cyclesPerSample = span / frames;
    let ei = 0;
    const st = this.state;
    for (let i = 0; i < frames; i++) {
      const t = this.cursorCycles + i * cyclesPerSample;
      while (ei < events.length && events[ei].t <= t) {
        const e = events[ei++];
        if (e.divisor !== st.divisor) st.since = e.t;
        st.gate = e.gate;
        st.data = e.data;
        st.divisor = e.divisor;
      }
      let level;
      if (!st.data) level = 0;
      else if (!st.gate) level = 1;
      else {
        const freq = PIT_HZ / st.divisor;
        if (freq > rate / 2) level = 0.5; // inaudible: averages out
        else {
          const ph = (((t - st.since) / (cpms * 1000)) * freq) % 1;
          level = ph < 0.5 ? 1 : 0;
        }
      }
      // DC-blocking high-pass so a held-high speaker is silent
      this.dc += (level - this.dc) * 0.002;
      out[i] = (level - this.dc) * this.volume;
    }
    this.cursorCycles = now;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const lead = 0.06;
    if (this.playAt < ctx.currentTime + 0.01 || this.playAt > ctx.currentTime + 0.5) {
      this.playAt = ctx.currentTime + lead;
    }
    src.start(this.playAt);
    this.playAt += frames / rate;
  }
}
