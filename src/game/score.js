// Score, high score and lives display (7-digit unpacked BCD at DS:1f82 / DS:1f89).

import { copyRect, SEG_VRAM } from './prims.js';

// CS:2739 - draw 7 digits (8x8 glyphs at DS:2720 + 16*digit) with a gap after 3 digits.
export function scoreDraw(g, digits, di) {
  g.ww(0x1f90, di);
  g.ww(0x1f93, digits);
  g.wb(0x1f92, 0);
  g.c(6);
  for (;;) {
    const d = g.rb(g.rw(0x1f93));
    copyRect(g, SEG_VRAM, g.rw(0x1f90), (0x2720 + (d << 4)) & 0xffff, 1, 8);
    g.ww(0x1f90, g.rw(0x1f90) + 2);
    g.ww(0x1f93, g.rw(0x1f93) + 1);
    const n = (g.rb(0x1f92) + 1) & 0xff;
    g.wb(0x1f92, n);
    g.c(14);
    if (n === 7) return;
    if (n === 3) g.ww(0x1f90, g.rw(0x1f90) + 2);
  }
}

// 8086 AAA on AL with the AF produced by the preceding ADD.
function aaa(al, ah, af) {
  if ((al & 0x0f) > 9 || af) {
    al = (al + 6) & 0xff;
    ah = (ah + 1) & 0xff;
  }
  return { al: al & 0x0f, ah };
}

// CS:2706 - add AL to the score digit-wise (digits 1f82..1f87) and redraw it.
export function addScore(g, al) {
  for (let cx = 6; cx >= 1; cx--) {
    const d = g.rb(0x1f81 + cx);
    const sum = al + d;
    const af = (al & 0x0f) + (d & 0x0f) > 0x0f;
    const r = aaa(sum & 0xff, 0, af);
    g.wb(0x1f81 + cx, r.al);
    al = r.ah;
    g.c(7);
  }
  scoreDraw(g, 0x1f82, 0x143c);
}

// CS:271e - add the 7-digit BCD number at DS:SI into DS:DI (with carry).
export function addBcd(g, di, si) {
  let cf = 0;
  for (let cx = 7; cx >= 1; cx--) {
    const bx = cx - 1;
    const a = g.rb(di + bx);
    const b = g.rb(si + bx);
    const sum = a + b + cf;
    const af = (a & 0x0f) + (b & 0x0f) + cf > 0x0f;
    let al = sum & 0xff;
    if ((al & 0x0f) > 9 || af) {
      al = (al + 6) & 0xff;
      cf = 1;
    } else cf = 0;
    g.wb(di + bx, al & 0x0f);
    g.c(9);
  }
}
