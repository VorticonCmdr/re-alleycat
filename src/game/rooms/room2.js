// Room 2 (jump table entry 2, CS:0459): under water. Reached from room 1 (DS:0554).
// The cat swims (CS:0953..0bab, the room-2 branch of the cat update) with an air timer
// (DS:05f1 against the per-skill limits at DS:0589.. / DS:0599..), and 24 moving
// objects (indices 0..0x0b: 1x6-word sprites, 0x0c..0x17: 2x2-word sprites) live in
// the tables at DS:3417.. (routines CS:34a0..CS:384a). Touching one of the first group
// collects it (the last one completes the room); touching one of the second group
// ends the visit.

import { registerRoom } from './hooks.js';
import { roomTransition, roomBackground } from './common.js';
import { random, xyAddr, copyRect, blitAnd, overlap, SEG_VRAM } from '../prims.js';
import { hotKeys, pollInput } from '../input.js';
import { pauseScreen } from '../title.js';
import * as S from '../sound.js';
import { catUpdate, placeCatFromRoom, moveX, eraseCat, drawCat } from '../cat.js';

// CS:35c9 - reset the 24 objects: positions, directions, and mark a per-skill number
// (DS:351c + skill) of the second group as inactive.
function objectsInit(g) {
  g.ww(0x3411, 0);
  g.ww(0x3415, 0);
  g.wb(0x3410, 0x0c);
  g.c(4);
  for (let cx = 0x18; cx !== 0; cx--) {
    let bx = cx - 1;
    g.wb(0x348f + bx, 1);
    g.wb(0x34a7 + bx, 0);
    g.wb(0x3477 + bx, g.rb(0x34f1 + bx));
    g.wb(0x342f + bx, 1);
    let dl = random(g) & 1;
    if (dl === 0) dl = 0xff; // NOT DL
    g.wb(0x3417 + bx, dl);
    bx = (bx << 1) & 0xffff;
    const dx = random(g) & 0xff; // SUB DH,DH
    g.ww(0x3447 + bx, dx);
    g.c(18);
  }
  const cl = g.rb(0x351c + g.rw(0x0008));
  g.c(4);
  // LOOP with CX=0 would run 65536 times over only 12 slots and never end.
  if (cl === 0 || cl > 0x0c) g.unsupported(`room 2 init with ${cl} inactive objects (CS:361a)`);
  for (let cx = cl; cx !== 0; cx--) {
    let bx;
    for (;;) {
      const dl = random(g) & 0x0f;
      g.c(3);
      if (dl >= 0x0c) continue;
      bx = dl + 0x0c;
      g.c(4);
      if (g.rb(0x34a7 + bx) !== 0) continue;
      break;
    }
    g.wb(0x34a7 + bx, 1);
    g.c(2);
  }
}

// CS:37c1 - erase object BX at its previous screen position (if it was drawn).
function objectErase(g, bx) {
  g.c(2);
  if (g.rb(0x348f + bx) !== 0) return;
  bx = (bx << 1) & 0xffff;
  const di = g.rw(0x34bf + bx);
  g.c(8);
  if (bx >= 0x18) copyRect(g, SEG_VRAM, di, 0x3404, 2, 2);
  else copyRect(g, SEG_VRAM, di, 0x3404, 1, 6);
}

// CS:363d - bring back up to DS:351b inactive objects of the second group at the
// screen edge away from the cat.
function objectsRespawn(g) {
  restart: for (;;) {
    g.c(1);
    for (let cx = 0x0c; cx !== 0; cx--) {
      let bx = cx + 0x0b;
      g.c(4);
      if (g.rb(0x34a7 + bx) === 0) continue;
      let ax = 0;
      let dl = 1;
      g.wb(0x34a7 + bx, 0);
      g.c(5);
      if (!(g.rw(0x579) > 0xa0)) {
        ax = 0x12e;
        dl = 0xff;
        g.c(2);
      }
      g.wb(0x3417 + bx, dl);
      bx = (bx & 0xff00) | ((bx << 1) & 0xff); // SHL BL,1
      g.ww(0x3447 + bx, ax);
      const n = (g.rb(0x351b) - 1) & 0xff;
      g.wb(0x351b, n);
      g.c(5);
      if (n !== 0) continue restart;
      return;
    }
    return;
  }
}

// CS:34a0 - does the swimming cat touch an object? Returns CF (true: redraw the cat).
function* objectsTouch(g) {
  g.ww(0x3511, 0);
  g.wb(0x351b, 0);
  g.c(2);
  for (;;) {
    let bx = g.rw(0x3511);
    g.c(3);
    if (g.rb(0x34a7 + bx) === 0) {
      const ax = g.rw(0x3447 + ((bx << 1) & 0xffff));
      const dl = g.rb(0x3477 + bx);
      const d = bx >= 0x0c ? 2 : 0;
      const si = g.rw(0x3513 + d);
      const cl = g.rw(0x3517 + d) & 0xff; // MOV CX,..; MOV CH,0Eh
      g.c(14);
      if (overlap(g, ax, si, g.rw(0x579), 0x18, dl, cl, g.rb(0x57b), 0x0e)) {
        bx = g.rw(0x3511);
        g.c(4);
        if (bx >= 0x0c && g.rb(0x553) === 0 && g.rb(0x5f3) === 0) {
          yield* caught(g); // CS:3501 .. 356e
          return false; // RET with CF from CMP DX,0Dh (no borrow)
        }
        // L356f
        g.wb(0x351b, g.rb(0x351b) + 1);
        S.effect(g, 0x5dc, 0x425); // CS:593b
        g.c(3);
        if (g.rb(0x351b) === 1) eraseCat(g); // CS:11e3
        objectErase(g, g.rw(0x3511)); // CS:37c1
        bx = g.rw(0x3511);
        g.wb(0x34a7 + bx, 1);
        g.c(6);
        if (bx < 0x0c) {
          const n = (g.rb(0x3410) - 1) & 0xff;
          g.wb(0x3410, n);
          g.c(3);
          if (n === 0) {
            g.c(2);
            if (g.rb(0x5f3) === 0) g.wb(0x553, 1);
          }
        }
      }
    }
    // L35ad
    g.ww(0x3511, g.rw(0x3511) + 1);
    g.c(3);
    if (g.rw(0x3511) >= 0x18) break;
  }
  g.c(2);
  if (g.rb(0x351b) !== 0) {
    objectsRespawn(g); // CS:363d
    return true;
  }
  return false;
}

// CS:3501 .. 356e - caught: draw the picture at DS:3350 over the cat and flash the
// palette with the pulse sound for 13 ticks.
function* caught(g) {
  g.wb(0x552, 1);
  let cx = g.rw(0x579);
  cx = cx < 8 ? 0 : cx - 8;
  if (cx >= 0x117) cx = 0x116;
  let dl = g.rb(0x57b);
  if (dl >= 0xb5) dl = 0xb4;
  g.c(10);
  copyRect(g, SEG_VRAM, xyAddr(g, cx, dl), 0x3350, 5, 0x12);
  S.pulseInit(g); // CS:5797
  let dx = g.ticks();
  g.ww(0x3509, dx);
  g.c(4);
  for (;;) {
    // L3543: PUSH DX
    for (;;) {
      S.pulse(g); // CS:57a6
      const r = g.retrace(); // CS:13d8
      g.c(2);
      if (r) break;
      yield;
    }
    S.pulse(g);
    const bl = dx & 1 ? 1 : 0x0f; // POP DX; TEST DL,1
    g.bios.setPalette(0, bl);
    S.pulse(g);
    dx = (g.ticks() - g.rw(0x3509)) & 0xffff;
    g.c(12);
    if (dx >= 0x0d) return;
  }
}

// CS:3675 - move one object per call while the BIOS tick differs from DS:3509.
function objectsUpdate(g) {
  const dx = g.ticks();
  g.c(4);
  if (dx === g.rw(0x3509)) return;
  g.ww(0x350b, dx);
  g.ww(0x3415, g.rw(0x3415) + 1);
  let bx = g.rw(0x3415);
  g.c(5);
  let setTick;
  if (bx >= 0x18) {
    bx = 0;
    g.ww(0x3415, bx);
    g.ww(0x3411, g.rw(0x3411) ^ 0x0c);
    g.ww(0x3413, g.rw(0x3413) + 8);
    g.c(5);
    setTick = true;
  } else if (bx === 0x0c) {
    g.c(4);
    setTick = !(g.rb(0x697) === 0xfd && g.rb(0x57b) < 0x30);
  } else {
    g.c(2);
    setTick = false;
  }
  if (setTick) {
    g.ww(0x3509, g.rw(0x350b)); // L36b7
    g.c(2);
  }
  // L36bd
  const si = (bx << 1) & 0xffff;
  g.c(4);
  if (g.rb(0x34a7 + bx) !== 0) return;
  let dl = random(g) & 0xff;
  g.c(3);
  if (dl <= 0x10) {
    dl &= 1;
    if (dl === 0) dl = 0xff;
    g.wb(0x3417 + bx, dl);
    dl = random(g) & 1;
    if (dl === 0) dl = 0xff;
    g.wb(0x342f + bx, dl);
    g.c(10);
  }
  // L36e9: horizontal
  const step = bx >= 0x0c ? 2 : 4;
  let ax = g.rw(0x3447 + si);
  g.c(6);
  if (g.rb(0x3417 + bx) === 1) {
    ax += step;
    if (ax >= 0x12f) {
      ax = 0x12e;
      g.wb(0x3417 + bx, 0xff);
    }
  } else if (ax < step) {
    ax = 0;
    g.wb(0x3417 + bx, 1);
  } else {
    ax -= step;
  }
  g.ww(0x3447 + si, ax);
  // vertical, within [34f1+bx] .. [34f1+bx]+18h
  let al = g.rb(0x3477 + bx);
  g.c(6);
  if (g.rb(0x342f + bx) === 1) {
    al = (al + 1) & 0xff;
    const lim = (g.rb(0x34f1 + bx) + 0x18) & 0xff;
    if (al > lim) {
      al = lim;
      g.wb(0x342f + bx, 0xff);
    }
  } else {
    al = (al - 1) & 0xff;
    if (al < g.rb(0x34f1 + bx)) {
      al = g.rb(0x34f1 + bx);
      g.wb(0x342f + bx, 1);
    }
  }
  g.wb(0x3477 + bx, al);
  g.ww(0x34ef, xyAddr(g, g.rw(0x3447 + si), al));
  g.c(8);
  objectErase(g, g.rw(0x3415)); // CS:37c1
  bx = g.rw(0x3415);
  const di = g.rw(0x34ef);
  g.ww(0x34bf + ((bx << 1) & 0xffff), di);
  g.wb(0x348f + bx, 0);
  g.c(10);
  if (bx >= 0x0c) {
    let s = (bx << 3) & 0xffff;
    s = (((s + g.rw(0x3413)) & 0xffff) & 0x18) + 0x3330;
    g.c(6);
    copyRect(g, SEG_VRAM, di, s, 2, 2);
    return;
  }
  let s = g.rw(0x3411);
  if (!(bx & 1)) s ^= 0x0c;
  if (g.rb(0x3417 + bx) !== 1) s = (s + 0x18) & 0xffff;
  s = (s + 0x3300) & 0xffff;
  g.c(9);
  copyRect(g, SEG_VRAM, di, s, 1, 6);
}

// CS:37e5 - once 8 ticks have passed since DS:350f, redraw one cell of the top row
// (DS:2656 + BX) per call, except next to the cat at the surface; after 28h cells
// it wraps and DS:350f restarts the 8-tick pause.
function surfaceUpdate(g) {
  const dx = g.ticks();
  g.c(4);
  if (((dx - g.rw(0x350f)) & 0xffff) < 8) return;
  g.ww(0x350d, g.rw(0x350d) + 1);
  let bx = g.rw(0x350d);
  g.c(4);
  if (bx >= 0x28) {
    bx = 0;
    g.ww(0x350d, bx);
    g.ww(0x350f, dx);
    g.c(3);
  }
  let di = (bx << 1) & 0xffff;
  g.c(3);
  if (!(g.rb(0x57b) > 7)) {
    let ax = ((g.rw(0x579) >> 2) + 1) & 0xffff;
    if (ax < di) ax = ~(ax - di) & 0xffff;
    else ax -= di;
    g.c(7);
    if (ax < 4) return;
  }
  di = (di + 0xa0) & 0xffff;
  const al = (g.rb(0x2656 + bx) + 8) & 0xff;
  g.wb(0x2656 + bx, al);
  g.c(8);
  copyRect(g, SEG_VRAM, di, (al & 0x18) + 0x2020, 1, 4);
}

// CS:0953 .. 0bab - the cat under water (called by the cat update in room 2).
function* swim(g) {
  const si = (g.rw(0x0008) << 1) & 0xffff;
  const ax = (g.rw(0x57d) - g.rw(0x5f1)) & 0xffff;
  g.c(5);
  if (ax >= g.rw(0x589 + si)) {
    // out of air
    g.c(2);
    if (ax >= g.rw(0x599 + si)) g.wb(0x552, 1);
    const n = (g.rb(0x5f5) - 1) & 0xff;
    g.wb(0x5f5, n);
    g.c(2);
    if (n === 0) {
      S.bubbleEffect(g); // CS:597f
      g.wb(0x5f5, 6);
      let al = g.rb(0x5f4);
      g.c(4);
      if (g.rb(0x57b) >= 0xb3 && al < 0xc8) {
        al = (al + 0x1e) & 0xff;
        g.wb(0x5f4, al);
        g.c(2);
      }
      let dl = g.rb(0x57b) - al;
      if (dl < 0) dl = 0;
      g.c(5);
      const di = xyAddr(g, g.rw(0x579), dl & 0xf8);
      g.c(6);
      blitAnd(g, SEG_VRAM, di, 0x64e, 0x0e, 3, 5);
    }
    // L09b9
    g.wb(0x56e, 0);
    g.wb(0x571, 1);
    g.wb(0x5f3, 1);
    g.wb(0x576, 0x20);
    g.bios.setPalette(0, 0);
    g.c(7);
  } else {
    // L09d6: background colour from the air time used
    let bl = 0;
    g.c(4);
    if (ax >= g.rw(0x5a9 + si)) {
      bl = 1;
      g.c(2);
      if (ax >= g.rw(0x5b9 + si)) {
        bl = 5;
        g.c(2);
        if (ax >= g.rw(0x5c9 + si)) bl = 4;
      }
    }
    g.bios.setPalette(0, bl);
    g.wb(0x56f, g.rb(0x56e));
    g.wb(0x570, g.rb(0x571));
    // horizontal: DS:0574 is the speed accumulator (speed = [574] >> 3)
    let al = g.rb(0x698);
    g.c(8);
    if (al === 0) {
      g.c(2);
      if (g.rw(0x574) < 0x10) {
        g.wb(0x56e, al);
        g.ww(0x574, 0x20);
      } else {
        g.ww(0x574, g.rw(0x574) - 1);
      }
    } else if (al === g.rb(0x56e)) {
      g.c(3);
      if (g.rw(0x574) < 0x30) g.ww(0x574, g.rw(0x574) + 3);
    } else {
      g.wb(0x56e, al);
      g.ww(0x574, 0x20);
      g.c(2);
    }
    // L0a37
    let sp = g.rw(0x574) >> 3;
    let bx = g.rw(0x0008);
    bx = (bx & 0xff00) | ((bx << 1) & 0xff); // SHL BL,1
    const lim = g.rw(0x66c + bx);
    if (sp > lim) sp = lim;
    g.ww(0x572, sp);
    g.c(9);
    moveX(g); // CS:0fc9
    // vertical: DS:0576 is the accumulator (step = [576] >> 4)
    al = g.rb(0x699);
    g.c(2);
    if (al === 0) {
      al = 0xff; // NOT AL
      g.c(2);
      if (g.rb(0x576) < 0x10) {
        g.wb(0x571, al);
        g.wb(0x576, 0x20);
      } else {
        g.wb(0x576, g.rb(0x576) - 1);
      }
    } else if (al === g.rb(0x571)) {
      g.c(3);
      if (g.rb(0x576) < 0x40) g.wb(0x576, g.rb(0x576) + 4);
    } else {
      g.wb(0x571, al);
      g.wb(0x576, 0x20);
      g.c(2);
    }
  }
  // L0a86
  let dl = g.rb(0x57b);
  let bl = g.rb(0x576) >> 4;
  const lim = g.rb(0x67c + g.rw(0x0008));
  if (bl > lim) bl = lim;
  const vd = g.rb(0x571);
  g.c(10);
  if (vd === 1) {
    dl = (dl + bl) & 0xff;
    if (dl >= 0xb4) dl = 0xb3;
    g.c(3);
  } else if (vd !== 0) {
    const d = dl - bl;
    g.c(3);
    if (d < 0 || d <= 3) {
      // L0abd: at the surface; the air timer restarts with the sprite at DS:09b8 shown
      if (g.rw(0x9b8) === g.rw(0x55d)) g.ww(0x5f1, g.rw(0x57d));
      dl = 2;
      g.c(5);
    } else {
      dl = d;
    }
  }
  // L0ace
  g.wb(0x57b, dl);
  g.ww(0x563, xyAddr(g, g.rw(0x579), dl));
  g.c(6);
  let bx;
  if (g.rb(0x5f3) !== 0) {
    bx = 0x10;
    g.c(2);
  } else if (g.rb(0x56e) !== g.rb(0x56f) || g.rb(0x571) !== g.rb(0x570)) {
    bx = 0x18;
    g.c(4);
  } else {
    g.ww(0x587, g.rw(0x587) + 1);
    bx = g.rw(0x587);
    g.c(8);
    if ((g.rb(0x698) | g.rb(0x699)) === 0) bx = (bx & 0xff00) | ((bx & 0xff) >> 1); // SHR BL,1
    let L;
    g.c(2);
    if (g.rb(0x57b) >= 0xb3 && g.rb(0x571) === 1) {
      L = 'b3c';
    } else if (g.rb(0x57b) <= 4 && g.rb(0x699) !== 0) {
      L = 'b53';
    } else {
      L = (g.rb(0x576) >> 1) >= g.rw(0x574) ? 'b53' : 'b3c';
    }
    g.c(4);
    if (L === 'b3c') {
      g.c(2);
      if (g.rb(0x56e) === 0) {
        L = 'b53';
      } else {
        bx &= 6;
        g.c(3);
        if (g.rb(0x56e) !== 1) bx |= 8;
      }
    }
    if (L === 'b53') {
      bx = (bx & 2) | 0x10;
      g.c(4);
      if (g.rb(0x571) === 1) bx += 4;
    }
  }
  // L0b64
  g.ww(0x55d, g.rw(0x9a6 + bx));
  g.ww(0x565, g.rw(0x9c0 + bx));
  let wy = 0x30;
  let cx = 0x2bc;
  const model = g.rb(0x697);
  g.c(7);
  if (model >= 0xfd) {
    if (model !== 0xfd) {
      wy = 8;
      cx = 0x3e8;
      g.c(2);
    }
    g.c(2);
    if (!(g.rb(0x57b) > wy)) {
      // wait for the end of the current retrace, then for the next one, then LOOP $
      for (;;) {
        const r = g.retrace(); // CS:13d8
        g.c(2);
        if (!r) break;
        yield;
      }
      for (;;) {
        const r = g.retrace();
        g.c(2);
        if (r) break;
        yield;
      }
      g.c(cx);
    }
  }
  // L0b97
  eraseCat(g); // CS:11e3
  g.ww(0x55f, g.rw(0x563));
  g.c(2);
  drawCat(g); // CS:1145
  if (yield* objectsTouch(g)) drawCat(g); // CS:34a0
}

registerRoom(2, {
  // CS:0459 - room 2 entry and loop (loop head CS:0478).
  *loop(g) {
    g.ww(0x0004, 2);
    g.c(1);
    yield* roomTransition(g); // CS:1bf0
    roomBackground(g); // CS:2790
    objectsInit(g); // CS:35c9
    placeCatFromRoom(g); // CS:07a1
    g.wb(0x1cbf, 0);
    g.wb(0x1cb8, 0);
    g.c(2);
    S.musicReset(g); // CS:58bd
    for (;;) {
      yield 0x0478; // loop head L0478 (sync point)
      yield* hotKeys(g, pauseScreen); // CS:1338
      pollInput(g); // CS:1200
      S.alleyMusic(g); // CS:546d
      yield* catUpdate(g); // CS:08e5 (swim branch below)
      objectsUpdate(g); // CS:3675
      surfaceUpdate(g); // CS:37e5
      g.c(6);
      if ((g.rb(0x552) | g.rb(0x553) | g.rb(0x41c) | g.rb(0x41b)) !== 0) return; // L0427
    }
  },
  swim,
});
