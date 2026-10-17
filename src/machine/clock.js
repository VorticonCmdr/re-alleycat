// Virtual machine clock.
//
// Simulation time is measured in executed "cycles", where one cycle is one original
// x86 instruction (string-op repetitions and LOOP iterations count individually).
// This mirrors how the reference emulator (DOSBox, fixed cpu_cycles) advances time,
// so translated code charges cycles with g.c(n) per basic block.
//
// Everything time-dependent the game can observe is derived from this one counter:
// BIOS ticks (INT 1Ah), PIT channel 0 latch reads, and the vertical-retrace bit.

export const PIT_HZ = 1193182;

// Retrace profiles. 'vga' matches DOSBox machine=svga_s3 in BIOS mode 4
// (449 lines at 31.469 kHz, retrace on lines 412..414). 'cga' is an
// unverified approximation of real IBM CGA timing (262 lines, 59.92 Hz).
export const RETRACE_PROFILES = {
  vga: { frameHz: 31469 / 449, startFrac: 412 / 449, endFrac: 414 / 449 },
  cga: { frameHz: 59.92, startFrac: 224 / 262, endFrac: 240 / 262 },
};

export class VirtualClock {
  constructor({ cyclesPerMs = 3000, retrace = 'vga', retracePhase = 0, startTicks = 0 } = {}) {
    this.cyclesPerMs = cyclesPerMs;
    this.cycles = 0;
    this.retrace = RETRACE_PROFILES[retrace];
    if (!this.retrace) throw new Error(`unknown retrace profile ${retrace}`);
    this.retracePhase = retracePhase; // fraction of a frame at cycle 0
    this.tickBase = startTicks >>> 0; // BIOS tick count at the last set
    this.tickBaseWraps = 0;           // PIT ch0 wraps at the last set
  }

  // PIT input clocks elapsed since power-on.
  pitClocks() {
    return Math.floor((this.cycles * PIT_HZ) / (this.cyclesPerMs * 1000));
  }

  // INT 1Ah AH=0: 32-bit tick count (CX:DX). INT 8 fires on every ch0 wrap (65536 clocks).
  biosTicks() {
    const wraps = Math.floor(this.pitClocks() / 65536);
    return (this.tickBase + wraps - this.tickBaseWraps) >>> 0;
  }

  // INT 1Ah AH=1.
  setBiosTicks(value) {
    this.tickBase = value >>> 0;
    this.tickBaseWraps = Math.floor(this.pitClocks() / 65536);
  }

  // PIT channel 0 latched count. The BIOS programs ch0 in mode 3 with reload 0 (65536);
  // in mode 3 the counter decrements by 2 and reloads every half period.
  pitCounter0() {
    const half = this.pitClocks() % 32768;
    return (65536 - 2 * half) & 0xffff;
  }

  // Port 3DAh bit 3.
  inRetrace() {
    const r = this.retrace;
    const frames = (this.cycles / (this.cyclesPerMs * 1000)) * r.frameHz + this.retracePhase;
    const f = frames - Math.floor(frames);
    return f >= r.startFrac && f < r.endFrac;
  }

  ms() {
    return this.cycles / this.cyclesPerMs;
  }
}
