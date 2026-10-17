// The translated game bound to a virtual machine.
//
// Execution model: translated routines that wait on time, retrace or input are JS
// generators; everything else is plain functions. The top-level program (CS:0000) is a
// generator driven by run(): it is resumed until the virtual clock reaches a deadline.
// Hardware interrupts (keyboard) are delivered only at yield points, so a run is fully
// determined by (original file, options, timed input events).

import { Memory } from '../machine/memory.js';
import { VirtualClock } from '../machine/clock.js';
import { CgaAdapter } from '../machine/video.js';
import { Speaker } from '../machine/speaker.js';
import { Bios } from '../machine/bios.js';
import { KeyboardController } from '../machine/keyboard.js';
import { keyboardInterrupt } from './input.js';
import { program } from './main.js';

export class UnsupportedPath extends Error {
  constructor(what) {
    super(`unsupported original code path: ${what}`);
    this.name = 'UnsupportedPath';
  }
}

export const DEFAULT_OPTIONS = {
  modelId: 0xfc, // BIOS model byte (F000:FFFE); 0xFC = AT, as the reference emulator reports
  cyclesPerMs: 3000, // reference: DOSBox cpu_cycles=3000
  retrace: 'vga', // reference: svga_s3 runs mode 4 at 70 Hz
  retracePhase: 0,
  startTicks: 0,
  rngSeed: null, // null: seed from the virtual PIT like the original; number: override
};

export class Game {
  constructor(image, options = {}) {
    this.opts = { ...DEFAULT_OPTIONS, ...options };
    this.mem = new Memory(image);
    this.clock = new VirtualClock(this.opts);
    this.cga = new CgaAdapter();
    this.speaker = new Speaker(this.clock);
    this.bios = new Bios(this.mem, this.cga, this.speaker);
    this.keyboard = new KeyboardController(this.clock);
    this.shift = 0;
    this.df = 0; // CPU direction flag: persists between routines (CS:05f1 leaves it set)
    this.exited = false;
    this.trace = null; // optional hook: (event, data) => void
    this.replay = null; // RecordedEnv when replaying a reference capture
    this.yields = 0;
    this._gen = program(this);
  }

  // ---- cycle accounting ----
  c(n) {
    this.clock.cycles += n;
  }

  // ---- data segment ----
  rb(a) {
    return this.mem.rb(a);
  }
  wb(a, v) {
    this.mem.wb(a, v & 0xff);
  }
  rw(a) {
    return this.mem.rw(a);
  }
  ww(a, v) {
    this.mem.ww(a, v & 0xffff);
  }

  // ---- environment (values from outside the translated logic) ----
  // INT 1Ah AH=0: returns DX (low word); cx (high word) on g.ticksHigh.
  ticks() {
    this.c(4);
    const t = this.replay ? this.replay.tick() : this.clock.biosTicks();
    this.ticksHigh = t >>> 16;
    return t & 0xffff;
  }
  // INT 1Ah AH=1
  setTicks(cx, dx) {
    this.c(4);
    this.clock.setBiosTicks(((cx & 0xffff) << 16) | (dx & 0xffff));
  }
  // CS:13d8: IN AL,3DAh / AND AL,8. Returns true while in vertical retrace.
  retrace() {
    this.c(5);
    return this.replay ? this.replay.retrace() : this.clock.inRetrace();
  }
  // PIT channel 0 latch (OUT 43h,0 / IN 40h / IN 40h). Returns the 16-bit count.
  pit0() {
    this.c(6);
    return this.clock.pitCounter0();
  }
  // F000:FFFE
  modelByte() {
    return this.opts.modelId;
  }
  // Port 201h. No joystick is attached; an open game port reads as all ones.
  joystickPort() {
    this.c(2);
    return 0xff;
  }

  // ---- hardware outputs ----
  out43(v) {
    this.c(2);
    this.speaker.writePort43(v);
  }
  out42(v) {
    this.c(2);
    this.speaker.writePort42(v);
  }
  in61() {
    this.c(1);
    return this.speaker.readPort61();
  }
  out61(v) {
    this.c(1);
    this.speaker.writePort61(v);
  }

  unsupported(what) {
    throw new UnsupportedPath(what);
  }

  // ---- interrupts ----
  serviceInterrupts() {
    const bytes = this.keyboard.due();
    for (const b of bytes) keyboardInterrupt(this, b);
  }

  // Resume the program until the next yield; returns the yielded sync site (or undefined).
  step() {
    const r = this._gen.next();
    this.yields++;
    if (r.done) this.exited = true;
    return r.value;
  }

  // ---- driver ----
  // Run until the virtual clock reaches `cycles` (absolute) or the program exits.
  runUntil(cycles) {
    while (!this.exited && this.clock.cycles < cycles) {
      this.serviceInterrupts();
      const r = this._gen.next();
      this.yields++;
      if (r.done) {
        this.exited = true;
        break;
      }
    }
  }

  runMs(ms) {
    this.runUntil(this.clock.cycles + ms * this.clock.cyclesPerMs);
  }

  // Schedule a key event (KeyboardEvent.code) at the current virtual time (or at t cycles).
  key(code, down, t = this.clock.cycles) {
    this.keyboard.push(t, code, down);
  }
}
