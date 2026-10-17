// CS:0000 - program entry, attract/menu cycle, alley loop and room dispatcher.

import { random, seedRandom } from './prims.js';
import { hotKeys, pollInput, speakerOff, MODEL, ProgramExit } from './input.js';
import * as T from './title.js';
import * as S from './sound.js';
import * as C from './cat.js';
import * as A from './alley.js';
import * as R from './rooms.js';
import { scoreDraw } from './score.js';

export const ROOM = 0x0004; // word: 0 alley, 1..7 rooms
export const PREV_ROOM = 0x0006;
export const SKILL = 0x0008;
export const SOUND_ON = 0x0000;
export const LIVES = 0x1f80;

// generator wrapper: ProgramExit ends the program like RETF to PSP:0000 (INT 20h)
export function* program(g) {
  try {
    yield* entry(g);
  } catch (e) {
    if (e instanceof ProgramExit) return;
    throw e;
  }
}

function* entry(g) {
  T.equipmentCheck(g); // CS:5c60
  g.wb(MODEL, g.modelByte()); // CS:13aa
  g.c(6);
  g.wb(0x690, 4);
  g.ww(0x6df8, 0); // selected skill
  g.wb(0x69b, 0); // joystick off
  T.installKeyboard(g); // CS:1419
  T.initKeyState(g); // CS:13e8
  g.ww(0x6e00, g.rw(0x693) + 0x240);
  g.bios.setMode(4);
  g.c(30);
  g.wb(0x690, g.rb(MODEL) === 0xfd ? 4 : 6);
  g.bios.setPalette(1, 1);
  g.ww(0x416, 0);
  g.ww(ROOM, 0);
  A.roomPalette(g); // CS:1d31
  if (g.rb(MODEL) !== 0xfd) g.cga.writeColorSelect(0x20);
  if (g.opts.rngSeed === null) seedRandom(g);
  else g.ww(0x2ae5, g.opts.rngSeed);
  T.scoreClear(g, 0x1f89); // CS:26e1 high score
  T.scoreClear(g, 0x1f82); // CS:26da score
  g.wb(0x41a, 0);
  g.ww(0x41d, 0xffff);
  g.ww(0x41f, 0xffff);
  g.wb(SOUND_ON, 0xff);
  g.c(20);

  let L = 'attract';
  for (;;) {
    switch (L) {
      case 'attract': // L0081
        T.updateHighScore(g); // CS:2690
        g.ww(SKILL, 0);
        g.ww(ROOM, 0);
        A.roomPalette(g);
        speakerOff(g);
        yield* T.titleScreen(g); // CS:5cb0
        speakerOff(g);
        L = g.rb(0x41a) === 0 ? 'menu' : 'newgame';
        break;
      case 'menu': // L00a3
        speakerOff(g);
        yield* T.menu(g); // CS:5ee5
        g.wb(0x41a, 1);
        L = 'newgame';
        break;
      case 'newgame': // L00ae
        g.ww(SKILL, g.rw(0x6df8));
        g.wb(LIVES, 3);
        T.scoreClear(g, 0x1f82);
        g.ww(ROOM, 0);
        A.roomPalette(g);
        speakerOff(g);
        g.ww(0x1c30, 0);
        g.ww(0x412, g.ticks());
        g.ww(0x414, 0);
        g.wb(0x418, 0);
        g.wb(0x419, 0);
        g.wb(0x41c, 0);
        g.wb(0x41b, 0);
        speakerOff(g);
        g.c(20);
        L = 'alley';
        break;
      case 'alley': // L00f3
        L = yield* alley(g);
        break;
      case 'room':
        L = yield* room(g);
        break;
      default:
        throw new Error(`bad label ${L}`);
    }
  }
}

// L00f3 .. L0238: one visit to the alley. Returns the next label.
function* alley(g) {
  g.c(3);
  if (g.rb(LIVES) === 0) return 'attract';
  if (g.rb(0x41b)) return 'newgame';
  if (g.rb(0x41c)) return 'menu';
  A.drawAlley(g); // CS:2a00
  A.alleyDecorations(g); // CS:5400
  g.wb(0x1f81, 0xff);
  speakerOff(g);
  g.ww(ROOM, 0);
  g.c(6);
  if (g.rb(0x419)) {
    C.placeCatFromRoom(g); // CS:07a1
    g.wb(0x550, 2);
    g.wb(0x576, 1);
    g.wb(0x578, 0x20);
  } else {
    g.ww(0x579, 0);
    C.placeCatInAlley(g); // CS:070d
  }
  A.dogInit(g); // CS:1e40
  A.throwerInit(g); // CS:1830
  A.critterInit(g); // CS:2210
  A.miceInit(g); // CS:2330
  scoreDraw(g, 0x1f89, 0x12ca); // CS:26f2 high score
  scoreDraw(g, 0x1f82, 0x143c); // CS:26fc score
  S.musicReset(g); // CS:58bd
  for (;;) {
    yield 0x0155; // loop head L0155 (sync point)
    g.c(2 + 4 + 4); // loop-head test, 41c/41b tests, the four CALLs below
    if (g.rb(LIVES) === 0) return 'attract';
    yield* hotKeys(g, T.pauseScreen);
    if (g.rb(0x41c)) return 'menu';
    if (g.rb(0x41b)) return 'newgame';
    pollInput(g);
    yield* C.catUpdate(g); // CS:08e5
    A.dogUpdate(g); // CS:1e63
    g.c(2);
    if (g.rb(0x1cb8) === 0) {
      g.wb(0x40f, g.rb(0x40f) + 1);
      g.c(3);
      g.c(7); // the seven CALLs of the every-4th-pass block are charged when taken
      if (g.rb(0x40f) & 3) continue;
    }
    S.alleyMusic(g); // CS:546d
    A.clothesline(g); // CS:04a0
    A.windowsUpdate(g); // CS:1936
    yield* A.thrownUpdate(g); // CS:184b
    A.critterUpdate(g); // CS:2216
    yield* A.miceUpdate(g); // CS:237b
    A.livesDraw(g); // CS:26b3
    g.c(3);
    if (g.rb(0x551) === 0) continue;
    if (g.rb(LIVES) === 0) return 'attract';
    // the cat went in through a window
    g.ww(0x410, g.ticks());
    g.ww(0x0001, g.rw(0x579));
    g.wb(0x0003, g.rb(0x57b));
    g.wb(0x419, 1);
    g.c(8);
    if (g.rb(0x418)) {
      g.wb(0x418, 0);
      g.ww(ROOM, 7);
    } else {
      pickRoom(g);
    }
    return 'room';
  }
}

// L01e5 .. L0235: choose the next room, avoiding the same room three times running.
function pickRoom(g) {
  for (;;) {
    let al;
    const dx = random(g);
    const bxSkill = g.rw(SKILL) & 3;
    g.c(4);
    if ((dx & 0xa0) && bxSkill !== 3) {
      al = g.rb(0x421 + (bxSkill << 2) + (dx & 3));
      g.c(6);
    } else {
      let d;
      do {
        d = random(g) & 7;
        g.c(4);
      } while (d >= 5);
      al = g.rb(0x42d + d);
      g.c(2);
    }
    g.c(3);
    if (al === g.rw(0x41d) && al === g.rw(0x41f)) continue;
    g.ww(ROOM, al);
    g.ww(0x41f, g.rw(0x41d));
    g.ww(0x41d, al);
    g.c(5);
    return;
  }
}

// L0238 + jump table at CS:0250, room loops, and L0427 (back to the alley).
function* room(g) {
  g.ww(PREV_ROOM, 0);
  let bx = g.rw(ROOM);
  if (bx > 7) bx = 0;
  g.c(6);
  let next = bx === 0 || bx === 1 ? 1 : bx;
  for (;;) {
    let r;
    switch (next) {
      case 1: r = yield* R.room1(g); break;
      case 2: r = yield* R.room2(g); break;
      case 3: r = yield* R.room3(g); break;
      case 4: r = yield* R.room4(g); break;
      case 5: r = yield* R.room5(g); break;
      case 6: r = yield* R.room6(g); break;
      case 7: r = yield* R.room7(g); break;
      default: throw new Error(`bad room ${next}`);
    }
    if (r === 'room2') {
      next = 2; // room 1 continues into room 2 (CS:0459)
      continue;
    }
    break;
  }
  // L0427
  g.c(3);
  if (g.rb(0x41b)) return 'newgame';
  if (g.rb(0x41c)) return 'menu';
  if (g.rb(0x552)) g.wb(0x419, 0);
  g.ww(PREV_ROOM, g.rw(ROOM));
  g.ww(ROOM, 0);
  yield* R.roomTransition(g); // CS:1bf0
  return 'alley';
}
