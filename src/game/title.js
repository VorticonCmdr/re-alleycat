// Start-up checks, title/attract screen, menu and pause screen.

import { random, copyRect, saveRect, SEG_VRAM } from './prims.js';
import { MAKE_COUNT, K, speakerOff } from './input.js';
import { catUpdate, placeCatInAlley } from './cat.js';
import { throwerInit, miceInit, dogInit, drawTitleAlley, livesDraw } from './alley.js';
import { scoreDraw } from './score.js';

const held = (g, a) => !(g.rb(a) & 0x80);

// CS:5c60 - INT 11h video check. Only the colour adapter path is supported.
export function equipmentCheck(g) {
  g.c(5);
  if ((g.bios.equipment & 0x30) === 0x30) g.unsupported('monochrome adapter start-up path (CS:5c68)');
}

// CS:1419 - installs the INT 9 handler (and the PCjr NMI hook).
export function installKeyboard(g) {
  if (g.rb(0x697) === 0xfd) g.unsupported('PCjr keyboard installation');
  g.c(25);
}

// CS:13e8 - all tracked keys released; re-arm the hot-key check.
export function initKeyState(g) {
  g.df = 0; // CLD at CS:13f1
  for (let i = 0; i < 22; i++) g.wb(0x6b7 + i, 0x80);
  g.ww(0x691, g.rw(MAKE_COUNT) - 0x70);
  g.c(40);
}

// CS:26e8 - clear a 7-digit BCD score.
export function scoreClear(g, addr) {
  const d = g.df ? -1 : 1; // no CLD in the original: honours a stale direction flag
  for (let i = 0; i < 7; i++) g.wb(addr + d * i, 0);
  g.c(12);
}

// CS:2690 - copy score to high score if larger (digit-wise compare).
// No CLD in the original: LODSB / REP MOVSB follow whatever direction flag is set.
export function updateHighScore(g) {
  const d = g.df ? -1 : 1;
  let a = 0;
  let b = 0;
  let i = 0;
  for (; i < 7; i++) {
    a = g.rb(0x1f82 + d * i);
    b = g.rb(0x1f89 + i);
    if (a !== b) break;
  }
  g.c(4 + 6 * Math.min(i + 1, 7));
  if (a > b) {
    for (let j = 0; j < 7; j++) g.wb(0x1f89 + d * j, g.rb(0x1f82 + d * j));
    g.c(10);
  }
}

// CS:5e2b - print a NUL-terminated string through INT 10h teletype (colour 2).
export function print(g, si) {
  for (;;) {
    const ch = g.rb(si);
    si = (si + (g.df ? -1 : 1)) & 0xffff;
    g.c(3);
    if (ch === 0) return si;
    g.bios.teletype(ch, 2);
    g.c(60);
  }
}

// CS:5fcd - clear the screen to colour 0.
export function clearScreen(g) {
  g.df = 0; // CLD
  g.mem.vram.fill(0, 0, 0x1f40);
  g.mem.vram.fill(0, 0x2000, 0x3f40);
  g.c(8 + 2 * 0xfa0);
}

// CS:5fb1 - print the next menu line (row from the table, column 0).
function menuLine(g) {
  const bx = g.rw(0x6d8f);
  const row = g.rb(0x6d63 + bx + 1);
  g.bios.setCursor(row, 0); // CS:5e5b forces DL=0
  g.ww(0x6d8f, bx + 2);
  g.c(12);
  print(g, g.rw(0x6d37 + bx));
}

// Wait for a new make code (the original spins on DS:0693).
function* waitMake(g) {
  const n = g.rw(MAKE_COUNT);
  g.c(1);
  while (g.rw(MAKE_COUNT) === n) {
    g.c(3);
    yield;
  }
}

// CS:5f97
function* waitKey(g) {
  g.c(3);
  if (g.rb(0x69b)) g.unsupported('joystick button wait (CS:5f9e)');
  yield* waitMake(g);
}

// CS:5fe5 - "use a joystick" check; no game port is present, so this always fails (CF=1).
function* joystickCheck(g) {
  g.c(4);
  if (g.bios.equipment & 0x1000) g.unsupported('joystick detection with a game port (CS:600f)');
  g.ww(0x6d8f, 0x24);
  for (let i = 0; i < 4; i++) menuLine(g);
  yield* waitMake(g);
  return true;
}

// CS:5ee5 - joystick question and skill selection.
export function* menu(g) {
  speakerOff(g);
  for (;;) {
    clearScreen(g);
    g.ww(0x6d8f, 0);
    menuLine(g);
    let retry = false;
    for (;;) {
      yield* waitMake(g);
      g.c(4);
      if (held(g, K.Y)) {
        if (yield* joystickCheck(g)) {
          retry = true;
          break;
        }
        g.wb(0x69b, 1);
        break;
      }
      if (held(g, K.N)) {
        g.wb(0x69b, 0);
        break;
      }
    }
    if (!retry) break;
  }
  for (let i = 0; i < 5; i++) menuLine(g);
  let skill;
  for (;;) {
    yield* waitMake(g);
    g.c(4);
    if (held(g, K.KEY_K)) skill = 0;
    else if (held(g, K.KEY_H)) skill = 1;
    else if (held(g, K.KEY_T)) skill = 2;
    else if (held(g, K.KEY_A)) skill = 3;
    else continue;
    break;
  }
  g.ww(0x6df8, skill);
  for (let i = 0; i < 5; i++) menuLine(g);
  if (g.rb(0x69b)) {
    g.ww(0x6d8f, 0x20);
    menuLine(g);
    menuLine(g);
    g.ww(0x6d8f, 0x18);
    menuLine(g);
    menuLine(g);
  } else {
    g.ww(0x6d8f, 0x1c);
    menuLine(g);
    menuLine(g);
    g.ww(0x6d8f, 0x16);
    menuLine(g);
  }
  yield* waitKey(g);
}

// CS:5e70 - Esc pause: message box, wait for a key, restore screen and BIOS time.
export function* pauseScreen(g) {
  speakerOff(g);
  const dx = g.ticks();
  const cx = g.ticksHigh;
  g.ww(0x6dfc, dx);
  g.ww(0x6dfe, cx);
  saveRect(g, 0x0e, 0x0dca, 0x20, 0x10);
  g.bios.setCursor(0x0b, 0x05);
  g.df = 0; // CLD at CS:5ea0
  print(g, 0x6d91);
  g.bios.setCursor(0x0c, 0x05);
  print(g, g.rb(0x69b) ? 0x6dd3 : 0x6db2);
  yield* waitKey(g);
  copyRect(g, SEG_VRAM, 0x0dca, 0x0e, 0x20, 0x10);
  g.setTicks(g.rw(0x6dfe), g.rw(0x6dfc));
  g.ww(0x6e00, g.rw(MAKE_COUNT));
  g.c(30);
}

// CS:5e3b - alternate the blinking title element.
function titleBlink(g) {
  g.ww(0x6a8d, g.rw(0x6a8d) + 2);
  const bx = g.rw(0x6a8d) & 2;
  copyRect(g, SEG_VRAM, 0x1d38, g.rw(0x6a8f + bx), 0x0a, 0x0c);
  g.c(10);
}

// CS:53b0 - title tune, one note per BIOS tick.
function titleMusic(g) {
  g.c(3);
  if (g.rb(0x0000) === 0) return;
  const dx = g.ticks();
  g.c(3);
  if (dx === g.rw(0x5322)) return;
  g.ww(0x5322, dx);
  const bl = g.rb(0x538c + g.rw(0x5320));
  g.c(6);
  if (bl === 0x66) {
    speakerOff(g);
    return;
  }
  g.ww(0x5320, g.rw(0x5320) + 1);
  g.c(4);
  if (bl === 0) {
    speakerOff(g);
    return;
  }
  g.out43(0xb6);
  const ax = g.rw(0x5324 + bl);
  g.out42(ax & 0xff);
  g.out42(ax >> 8);
  g.out61(g.in61() | 3);
  g.c(4);
}

// CS:5dd4 - attract-mode cat: wander, turn at the edges.
function* attractCat(g) {
  g.c(3);
  const x = g.rw(0x579);
  if (x <= 0x20) {
    g.wb(0x698, 1);
  } else if (x >= 0x120) {
    g.wb(0x698, 0xff);
  } else {
    const t = g.ticks();
    g.c(4);
    if (((t - g.rw(0x6a88)) & 0xffff) >= 0x12) {
      g.ww(0x6a88, t);
      const dl = random(g) & 0xff;
      g.wb(0x698, 0);
      g.c(4);
      if (dl <= 0xa0) g.wb(0x698, dl & 1 ? 1 : 0xff);
    }
  }
  if (g.retrace()) {
    g.ww(0x572, 4);
    yield* catUpdate(g);
  }
}

// CS:5cb0 - title screen with the attract-mode cat. Returns on a key press, or (before
// the first game) when the title has been shown long enough.
export function* titleScreen(g) {
  g.df = 0; // CLD at CS:5cb0
  g.ww(0x0004, 0);
  throwerInit(g); // CS:1830
  miceInit(g); // CS:2330
  drawTitleAlley(g); // CS:2a30
  copyRect(g, SEG_VRAM, 0x00bd, 0x6152, 0x0b, 0x1d);
  copyRect(g, SEG_VRAM, 0x069e, 0x63d0, 0x0e, 0x16);
  copyRect(g, SEG_VRAM, 0x0a78, 0x6638, 0x03, 0x0c);
  copyRect(g, SEG_VRAM, 0x0ca8, 0x6680, 0x0e, 0x08);
  copyRect(g, SEG_VRAM, 0x1d6e, 0x6760, 0x0c, 0x0b);
  copyRect(g, SEG_VRAM, 0x1dec, 0x6868, 0x04, 0x08);
  g.ww(0x6a8d, 0);
  titleBlink(g);
  g.ww(0x579, 0);
  placeCatInAlley(g); // CS:070d
  g.wb(0x57b, 0x60);
  g.wb(0x57c, 0x92);
  scoreDraw(g, 0x1f89, 0x12ca);
  scoreDraw(g, 0x1f82, 0x143c);
  g.wb(0x1f80, 9);
  g.wb(0x1f81, 0xff);
  livesDraw(g); // CS:26b3
  dogInit(g); // CS:1e40
  g.wb(0x698, 0);
  g.wb(0x699, 0);
  g.wb(0x6a8a, 0);
  g.ww(0x6150, g.rw(MAKE_COUNT));
  g.c(40);
  for (;;) {
    // L5d54
    const t0 = g.ticks();
    g.ww(0x6a8b, t0);
    g.ww(0x5322, t0);
    g.ww(0x6a93, t0);
    g.ww(0x6a88, t0 - 0x30);
    g.ww(0x5320, 0);
    g.c(8);
    for (;;) {
      // L5d71
      yield;
      let dx = g.ticks();
      g.c(4);
      if (((dx - g.rw(0x6a93)) & 0xffff) >= 0x24) {
        g.ww(0x6a93, dx);
        titleBlink(g);
      }
      dx = (dx - g.rw(0x6a8b)) & 0xffff;
      let ax = g.rw(0x56da);
      g.c(5);
      if (g.rb(0x41a) !== 0) {
        ax = (ax + 0x48) & 0xffff;
        if (dx >= ax) break; // restart the tune and timers
      } else {
        ax = (ax + 6) & 0xffff;
        if (dx > ax) return; // first run: go to the menu
      }
      titleMusic(g);
      yield* attractCat(g);
      g.c(3);
      if (g.rb(0x69b)) g.unsupported('joystick button on the title screen (CS:5db4)');
      if (g.rw(0x6150) !== g.rw(MAKE_COUNT)) return;
    }
  }
}
