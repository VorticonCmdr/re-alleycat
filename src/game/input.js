// Keyboard handling: the game's own INT 9 handler and its polling routines.

export const KEYTAB = 0x6a1; // 22 scan codes
export const KEYSTATE = 0x6b7; // 22 bytes, 0x80 = released, 0x00 = held
export const K = {
  ALT: 0x6b7, UP: 0x6b8, RIGHT: 0x6b9, DOWN: 0x6ba, LEFT: 0x6bb,
  PGUP: 0x6bc, PGDN: 0x6bd, END: 0x6be, HOME: 0x6bf, ESC: 0x6c0,
  Y: 0x6c1, N: 0x6c2, KEY_K: 0x6c3, KEY_H: 0x6c4, KEY_T: 0x6c5, KEY_A: 0x6c6,
  S: 0x6c7, R: 0x6c8, CTRL: 0x6c9, DEL: 0x6ca, M: 0x6cb, NINE: 0x6cc,
};
export const MAKE_COUNT = 0x693; // word, incremented on every make code
export const MODEL = 0x697;
export const HSYNC_ADJ = 0x690;
export const DIR_X = 0x698; // -1/0/+1 requested horizontal direction
export const DIR_Y = 0x699; // -1 up, +1 down
export const FIRE = 0x69a; // 0 when Alt held, 0x10 when released
export const JOYSTICK = 0x69b;

export class ProgramExit extends Error {
  constructor() {
    super('program exited to DOS');
    this.name = 'ProgramExit';
  }
}

const down = (g, a) => !(g.rb(a) & 0x80);

// CS:14b3 (PC/AT handler; the PCjr handler at CS:14fb is not ported).
export function keyboardInterrupt(g, byte) {
  if (g.rb(MODEL) === 0xfd) g.unsupported('PCjr keyboard handler CS:14fb');
  const code = byte & 0x7f;
  if (!(byte & 0x80)) g.ww(MAKE_COUNT, g.rw(MAKE_COUNT) + 1);
  let found = -1;
  for (let i = 0; i < 22; i++) {
    if (g.rb(KEYTAB + i) === code) {
      found = i;
      break;
    }
  }
  g.c(14 + 3 * (found < 0 ? 22 : found + 1));
  if (found >= 0) g.wb(KEYSTATE + found, byte & 0x80);
  ctrlAltKeys(g);
  g.c(10);
}

// CS:1572 - Ctrl+Alt combinations handled inside the interrupt.
function ctrlAltKeys(g) {
  g.c(5);
  if (g.rb(K.CTRL) | g.rb(K.ALT)) return;
  if (down(g, K.DEL)) g.unsupported('Ctrl+Alt+Del warm reboot (CS:1557)');
  let v = g.rb(HSYNC_ADJ);
  if (down(g, K.RIGHT)) {
    if (v < 1) return;
    v--;
  } else if (down(g, K.LEFT)) {
    if (v >= 7) return;
    v++;
  } else return;
  g.wb(HSYNC_ADJ, v);
  // CRTC R2 (horizontal sync position) := v + 27h. Moves the picture on a real CGA monitor;
  // recorded but not displayed.
  g.cga.crtcR2Adjust = v + 0x27;
  g.c(12);
}

// CS:12c1 - keyboard state -> requested direction and fire button.
export function readKeyboard(g) {
  const pcjr = g.rb(MODEL) === 0xfd;
  const any = (...a) => (pcjr ? down(g, a[0]) : a.some((x) => down(g, x)));
  g.wb(DIR_Y, any(K.DOWN, K.PGDN, K.END) ? 1 : 0);
  if (any(K.UP, K.PGUP, K.HOME)) g.wb(DIR_Y, 0xff);
  g.wb(DIR_X, any(K.RIGHT, K.PGUP, K.PGDN) ? 1 : 0);
  if (any(K.LEFT, K.END, K.HOME)) g.wb(DIR_X, 0xff);
  g.wb(FIRE, g.rb(K.ALT) >> 3);
  g.c(46);
}

// CS:1200 - input poll, at most every second BIOS tick.
export function pollInput(g) {
  const t = g.ticks();
  g.c(6); // SUB AH,AH / MOV AX,DX / SUB / CMP / JNC / RET
  if (((t - g.rw(0x69f)) & 0xffff) < 2) return;
  g.ww(0x69f, t);
  if (g.rb(JOYSTICK) !== 0) {
    readJoystick(g); // CS:122e
    return;
  }
  readKeyboard(g);
  // short PIT-based settle delay: wait for the counter to move by 1..0x713 counts
  const start = g.pit0();
  for (let guard = 0; ; guard++) {
    const d = (g.pit0() - start) & 0xffff;
    g.c(4);
    if (d >= 0xf8ed) break;
    if (guard > 1e6) throw new Error('PIT delay at CS:1223 did not terminate');
  }
}

// CS:12a1 - one-shot length so far -> axis direction (-1 short, 0 middle, +1 long).
function axisFromTime(g) {
  const bx = (g.pit0() - g.rw(0x69c)) & 0xffff;
  g.c(8);
  if (bx < 0xf5e6) return 1;
  if (bx < 0xfafa) return 0;
  return 0xff;
}

// CS:122e - read the joystick: fire button, then time both axis one-shots.
function readJoystick(g) {
  g.wb(FIRE, g.joystickPort() & 0x10);
  g.wb(0x69e, 3);
  g.ww(0x69c, g.pit0());
  g.joystickFire();
  g.c(8);
  let cx = 0x7d0;
  do {
    const al = g.joystickPort();
    if (!(al & 1) && g.rb(0x69e) & 1) {
      g.wb(0x69e, g.rb(0x69e) & 0xfe);
      g.wb(DIR_X, axisFromTime(g));
    }
    if (!(al & 2) && g.rb(0x69e) & 2) {
      g.wb(0x69e, g.rb(0x69e) & 0xfd);
      g.wb(DIR_Y, axisFromTime(g));
    }
    g.c(10);
    if ((g.rb(0x69e) & 3) === 0) return;
    const ax = (g.pit0() - g.rw(0x69c)) & 0xffff;
    g.c(4);
    cx = (cx - 1) & 0xffff;
    if (ax === 0x1964) break; // LOOPNZ also ends on ZF from CMP AX,1964h
  } while (cx !== 0);
  if (g.rb(0x69e) & 1) g.wb(DIR_X, 0xff);
  if (g.rb(0x69e) & 2) g.wb(DIR_Y, 0xff);
  g.c(8);
}

// CS:1338 - global hot keys, checked when a new make code has arrived.
// Returns true when the routine asked for the pause screen (handled by the caller).
export function* hotKeys(g, pauseScreen) {
  g.c(4); // MOV AX,[693] / CMP / JZ / RET
  const n = g.rw(MAKE_COUNT);
  if (n === g.rw(0x691)) return;
  g.ww(0x691, n);
  g.c(4);
  if (down(g, K.ESC)) {
    if (g.rw(MAKE_COUNT) !== g.rw(0x6e00)) yield* pauseScreen(g);
    return;
  }
  if (!down(g, K.CTRL)) return;
  g.c(3);
  if (down(g, K.NINE)) {
    g.wb(0x1f80, 9); // Ctrl+9: nine lives
    return;
  }
  if (down(g, K.Y)) throw new ProgramExit(); // CS:13a5: restore vectors, return to DOS
  if (down(g, K.M)) {
    g.wb(0x41c, 0xff); // Ctrl+M: back to the menu
    return;
  }
  if (down(g, K.R)) {
    g.wb(0x41b, 0xff); // Ctrl+R: restart
    return;
  }
  if (down(g, K.S)) {
    g.wb(0x0000, ~g.rb(0x0000)); // Ctrl+S: sound on/off
    if (g.rb(0x0000) === 0) speakerOff(g);
  }
}

// CS:5b21
export function speakerOff(g) {
  g.out61(g.in61() & 0xfc);
  g.c(2);
}
