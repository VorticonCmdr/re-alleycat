// Keyboard: browser key codes -> PC/XT scan codes (set 1), with typematic repeat
// generated in virtual time (same defaults as the reference emulator: 500 ms delay,
// one repeat every 33 ms). Events become INT 9 deliveries handled by the game's
// translated keyboard handler.

// KeyboardEvent.code -> [scancode, extended]
export const SCANCODES = {
  Escape: [0x01, 0], Digit1: [0x02, 0], Digit2: [0x03, 0], Digit3: [0x04, 0], Digit4: [0x05, 0],
  Digit5: [0x06, 0], Digit6: [0x07, 0], Digit7: [0x08, 0], Digit8: [0x09, 0], Digit9: [0x0a, 0],
  Digit0: [0x0b, 0], Minus: [0x0c, 0], Equal: [0x0d, 0], Backspace: [0x0e, 0], Tab: [0x0f, 0],
  KeyQ: [0x10, 0], KeyW: [0x11, 0], KeyE: [0x12, 0], KeyR: [0x13, 0], KeyT: [0x14, 0],
  KeyY: [0x15, 0], KeyU: [0x16, 0], KeyI: [0x17, 0], KeyO: [0x18, 0], KeyP: [0x19, 0],
  BracketLeft: [0x1a, 0], BracketRight: [0x1b, 0], Enter: [0x1c, 0], ControlLeft: [0x1d, 0],
  KeyA: [0x1e, 0], KeyS: [0x1f, 0], KeyD: [0x20, 0], KeyF: [0x21, 0], KeyG: [0x22, 0],
  KeyH: [0x23, 0], KeyJ: [0x24, 0], KeyK: [0x25, 0], KeyL: [0x26, 0], Semicolon: [0x27, 0],
  Quote: [0x28, 0], Backquote: [0x29, 0], ShiftLeft: [0x2a, 0], Backslash: [0x2b, 0],
  KeyZ: [0x2c, 0], KeyX: [0x2d, 0], KeyC: [0x2e, 0], KeyV: [0x2f, 0], KeyB: [0x30, 0],
  KeyN: [0x31, 0], KeyM: [0x32, 0], Comma: [0x33, 0], Period: [0x34, 0], Slash: [0x35, 0],
  ShiftRight: [0x36, 0], NumpadMultiply: [0x37, 0], AltLeft: [0x38, 0], Space: [0x39, 0],
  CapsLock: [0x3a, 0], F1: [0x3b, 0], F2: [0x3c, 0], F3: [0x3d, 0], F4: [0x3e, 0], F5: [0x3f, 0],
  F6: [0x40, 0], F7: [0x41, 0], F8: [0x42, 0], F9: [0x43, 0], F10: [0x44, 0],
  Numpad7: [0x47, 0], Numpad8: [0x48, 0], Numpad9: [0x49, 0], NumpadSubtract: [0x4a, 0],
  Numpad4: [0x4b, 0], Numpad5: [0x4c, 0], Numpad6: [0x4d, 0], NumpadAdd: [0x4e, 0],
  Numpad1: [0x4f, 0], Numpad2: [0x50, 0], Numpad3: [0x51, 0], Numpad0: [0x52, 0],
  NumpadDecimal: [0x53, 0],
  // Grey keys arrive with an E0 prefix; the game's handler ignores the prefix byte.
  ArrowUp: [0x48, 1], ArrowDown: [0x50, 1], ArrowLeft: [0x4b, 1], ArrowRight: [0x4d, 1],
  Home: [0x47, 1], End: [0x4f, 1], PageUp: [0x49, 1], PageDown: [0x51, 1],
  Insert: [0x52, 1], Delete: [0x53, 1], NumpadEnter: [0x1c, 1], ControlRight: [0x1d, 1],
  AltRight: [0x38, 1],
};

export const TYPEMATIC_DELAY_MS = 500;
export const TYPEMATIC_RATE_MS = 33;

// Produces raw port-60h bytes in virtual time. Host events are queued with the cycle
// time they should be delivered at; typematic repeats are synthesised here.
export class KeyboardController {
  constructor(clock) {
    this.clock = clock;
    this.queue = []; // {t, code, down}
    this.held = null; // {code, nextRepeat}
    this.down = new Set();
  }

  // Schedule a logical key event at virtual time t (cycles).
  push(t, code, down) {
    this.queue.push({ t, code, down });
  }

  // Return port-60h bytes due at the current time, in order.
  due() {
    const now = this.clock.cycles;
    const out = [];
    const msCycles = this.clock.cyclesPerMs;
    for (;;) {
      const ev = this.queue.length ? this.queue[0] : null;
      const rep = this.held && this.held.nextRepeat <= now ? this.held.nextRepeat : Infinity;
      const evT = ev && ev.t <= now ? ev.t : Infinity;
      if (evT === Infinity && rep === Infinity) break;
      if (rep < evT) {
        out.push(...this._bytes(this.held.code, true));
        this.held.nextRepeat += TYPEMATIC_RATE_MS * msCycles;
        continue;
      }
      this.queue.shift();
      const sc = SCANCODES[ev.code];
      if (!sc) continue;
      if (ev.down) {
        if (this.down.has(ev.code)) continue; // host auto-repeat is ignored; we synthesise it
        this.down.add(ev.code);
        this.held = { code: ev.code, nextRepeat: ev.t + TYPEMATIC_DELAY_MS * msCycles };
      } else {
        if (!this.down.has(ev.code)) continue;
        this.down.delete(ev.code);
        if (this.held && this.held.code === ev.code) this.held = null;
      }
      out.push(...this._bytes(ev.code, ev.down));
    }
    return out;
  }

  _bytes(code, down) {
    const [sc, ext] = SCANCODES[code];
    const b = down ? sc : sc | 0x80;
    return ext ? [0xe0, b] : [b];
  }
}
