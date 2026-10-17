// Host input adapters: keyboard, on-screen touch pad, and gamepads. All of them produce
// timed key events (and game-port states) on the simulation's virtual clock; none of them
// touch game state directly.

import { SCANCODES } from '../machine/keyboard.js';

const GAME_KEYS = new Set(Object.keys(SCANCODES));

export class Controls {
  constructor({ getGame, onActivity }) {
    this.getGame = getGame;
    this.onActivity = onActivity;
    this.padKeys = new Set(); // keys currently held by the gamepad mapping
    this.touchHeld = new Map(); // pointerId -> [codes]
    this.lastPad = null;
  }

  key(code, down) {
    const g = this.getGame();
    if (!g || !GAME_KEYS.has(code)) return;
    if (down) this.onActivity();
    g.key(code, down);
  }

  // ---- physical keyboard
  attachKeyboard(target = window) {
    target.addEventListener('keydown', (e) => {
      if (!this.getGame() || !GAME_KEYS.has(e.code)) return;
      e.preventDefault(); // keep browser shortcuts (Ctrl+S, Ctrl+R, Alt menus) away while playing
      this.key(e.code, true);
    });
    target.addEventListener('keyup', (e) => {
      if (!this.getGame() || !GAME_KEYS.has(e.code)) return;
      e.preventDefault();
      this.key(e.code, false);
    });
    window.addEventListener('blur', () => this.releaseAll());
  }

  releaseAll() {
    const g = this.getGame();
    if (!g) return;
    for (const code of [...g.keyboard.down]) g.key(code, false);
    this.padKeys.clear();
    this.touchHeld.clear();
  }

  // ---- on-screen buttons: data-keys="ArrowUp" or "ArrowUp ArrowLeft" (held together)
  attachTouch(root) {
    for (const el of root.querySelectorAll('[data-keys]')) {
      const codes = el.dataset.keys.split(' ');
      const press = (e) => {
        e.preventDefault();
        el.setPointerCapture?.(e.pointerId);
        el.classList.add('held');
        this.touchHeld.set(e.pointerId, codes);
        for (const c of codes) this.key(c, true);
      };
      const release = (e) => {
        const held = this.touchHeld.get(e.pointerId);
        if (!held) return;
        this.touchHeld.delete(e.pointerId);
        el.classList.remove('held');
        for (const c of held) this.key(c, false);
      };
      el.addEventListener('pointerdown', press);
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('lostpointercapture', release);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  // ---- gamepads: polled once per animation frame
  // Default mapping emulates the keyboard (stick/D-pad = arrows, A = Alt, Start = Esc,
  // Back/Select = Space). The pad is also wired to the emulated game port, so answering
  // "Y" to the joystick question uses the original joystick code.
  pollGamepads() {
    const g = this.getGame();
    if (!g || !navigator.getGamepads) return;
    const pad = [...navigator.getGamepads()].find((p) => p && p.connected) || null;
    const port = g.gamePort;
    if (!pad) {
      if (this.lastPad) {
        for (const c of this.padKeys) this.key(c, false);
        this.padKeys.clear();
        port.push(g.clock.cycles, { connected: false, x: 0, y: 0, button: false });
        this.lastPad = null;
      }
      return;
    }
    const dead = 0.35;
    let x = pad.axes[0] || 0;
    let y = pad.axes[1] || 0;
    const btn = (i) => !!pad.buttons[i]?.pressed;
    if (btn(14)) x = -1;
    if (btn(15)) x = 1;
    if (btn(12)) y = -1;
    if (btn(13)) y = 1;
    const fire = btn(0) || btn(1);
    const want = new Set();
    if (x < -dead) want.add('ArrowLeft');
    if (x > dead) want.add('ArrowRight');
    if (y < -dead) want.add('ArrowUp');
    if (y > dead) want.add('ArrowDown');
    if (fire) want.add('AltLeft');
    if (btn(9)) want.add('Escape');
    if (btn(8)) want.add('Space');
    for (const c of this.padKeys) if (!want.has(c)) this.key(c, false);
    for (const c of want) if (!this.padKeys.has(c)) this.key(c, true);
    this.padKeys = want;
    const state = {
      connected: true,
      x: Math.abs(x) < dead ? 0 : x,
      y: Math.abs(y) < dead ? 0 : y,
      button: fire,
    };
    const key = JSON.stringify(state);
    if (key !== this.lastPad) {
      port.push(g.clock.cycles, state);
      this.lastPad = key;
    }
  }
}
