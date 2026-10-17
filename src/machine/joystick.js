// PC game port (201h) in virtual time, driven by a host gamepad.
//
// Writing 201h fires the axis one-shots; bits 0/1 (stick A x/y) stay 1 for a time that
// grows with the stick position, bits 2/3 (stick B, absent) never drop, bits 4..7 are the
// buttons (0 = pressed). The game measures the one-shots with PIT channel 0 (CS:122e,
// CS:12a1): fewer than 1286 counts reads as left/up, more than 2586 as right/down.
// Durations here are chosen inside those bands. [approx] — a real stick's timing depends on
// its potentiometers; no reference capture covers the joystick (DOSBox exposes no API to
// drive its emulated stick).

import { PIT_HZ } from './clock.js';

// PIT ch0 counts (mode 3 counts down by 2 per input clock) for axis -1, 0, +1.
const COUNTS = { min: 700, centre: 1936, max: 3400 };

export class GamePort {
  constructor(clock) {
    this.clock = clock;
    this.connected = false;
    this.x = 0;
    this.y = 0;
    this.button = false; // fire (button 1)
    this.firedAt = -Infinity;
    this.queue = []; // timed state changes {t, x, y, button, connected}
  }

  // Schedule a stick/button state at virtual time t (cycles).
  push(t, state) {
    this.queue.push({ t, ...state });
  }

  _apply() {
    const now = this.clock.cycles;
    while (this.queue.length && this.queue[0].t <= now) {
      const { connected, x, y, button } = this.queue.shift();
      Object.assign(this, { connected, x, y, button });
    }
  }

  _cycles(axis) {
    const a = Math.max(-1, Math.min(1, axis));
    const counts = a < 0 ? COUNTS.centre + a * (COUNTS.centre - COUNTS.min) : COUNTS.centre + a * (COUNTS.max - COUNTS.centre);
    return ((counts / 2) / PIT_HZ) * 1000 * this.clock.cyclesPerMs;
  }

  // Connection state at the current virtual time (INT 11h, status display).
  isConnected() {
    this._apply();
    return this.connected;
  }

  write() {
    this._apply();
    this.firedAt = this.clock.cycles;
  }

  read() {
    this._apply();
    if (!this.connected) return 0xff;
    const dt = this.clock.cycles - this.firedAt;
    let v = 0xec; // stick B one-shots never end; buttons 2..4 released
    if (dt < this._cycles(this.x)) v |= 1;
    if (dt < this._cycles(this.y)) v |= 2;
    if (!this.button) v |= 0x10;
    return v;
  }
}
