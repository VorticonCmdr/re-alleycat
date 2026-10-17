// PC speaker: PIT channel 2 + port 61h bits 0 (timer 2 gate) and 1 (speaker data).
// The simulation only writes to it; nothing here feeds back into game logic.
// Every state change is logged with its virtual cycle time so audio can be rendered
// (or compared) independently of host scheduling.

import { PIT_HZ } from './clock.js';

export class Speaker {
  constructor(clock) {
    this.clock = clock;
    this.port61 = 0;
    this.divisor = 0;
    this.latchLow = null;
    this.mode = 3;
    this.events = []; // {t: cycles, gate, data, divisor}
    this.maxEvents = 200000;
  }

  writePort43(v) {
    // Only channel 2 square-wave programming (0xB6) is used by the game.
    if ((v & 0xc0) === 0x80) {
      this.mode = (v >> 1) & 7;
      this.latchLow = null;
    }
  }

  writePort42(v) {
    if (this.latchLow === null) {
      this.latchLow = v & 0xff;
    } else {
      this.divisor = this.latchLow | ((v & 0xff) << 8);
      this.latchLow = null;
      this._log();
    }
  }

  readPort61() {
    return this.port61;
  }

  writePort61(v) {
    v &= 0xff;
    if ((v & 3) !== (this.port61 & 3)) {
      this.port61 = v;
      this._log();
    } else {
      this.port61 = v;
    }
  }

  frequency() {
    const d = this.divisor || 65536;
    return PIT_HZ / d;
  }

  _log() {
    if (this.events.length >= this.maxEvents) this.events.splice(0, this.events.length >> 1);
    this.events.push({
      t: this.clock.cycles,
      gate: this.port61 & 1,
      data: (this.port61 >> 1) & 1,
      divisor: this.divisor || 65536,
    });
  }

  // Remove and return events up to (and including) cycle t.
  drain(t) {
    let n = 0;
    while (n < this.events.length && this.events[n].t <= t) n++;
    return this.events.splice(0, n);
  }
}
