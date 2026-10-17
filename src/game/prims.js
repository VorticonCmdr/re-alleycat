// Low-level routines shared by every part of the game: RNG, CGA addressing, blitters,
// bounding-box test. Each function names the original routine (CS offset) it translates.
// Cycle charges approximate the original instruction counts (see docs/ARCHITECTURE.md).

import { SEG_DS, SEG_VRAM } from '../machine/memory.js';

export const V = {
  RNG_SEED: 0x2ae5,
  BLIT_WORDS: 0x2ae0, // byte, but read back as a word by SUB DI,[2ae0]
  BLIT_ROWS: 0x2ae2,
  BLIT_SPRITE: 0x2ae3,
  COPY_SRC: 0x2ae9,
  COPY_STRIDE: 0x2aeb,
};

// CS:2dfd - 16-bit shift register. Returns the new seed (the original returns it in DX).
export function random(g) {
  const s = g.rw(V.RNG_SEED);
  const t = (s ^ (s >> 8)) & 0xff;
  const next = (s >>> 1) | (((t >> 1) & 1) << 15);
  g.ww(V.RNG_SEED, next);
  g.c(7);
  return next;
}

// CS:2e10 - seed the RNG from a PIT channel 0 latch (low byte first, NOT swapped).
export function seedRandom(g) {
  const cnt = g.pit0();
  let ax = ((cnt & 0xff) << 8) | ((cnt >> 8) & 0xff);
  if (ax === 0) ax = 0xfa59;
  g.ww(V.RNG_SEED, ax);
  g.c(11);
}

// CS:2cb0 - pixel (x=CX, y=DL) -> CGA offset (AX). CL gets (x&3)*2 (kept in g.shift).
export function xyAddr(g, x, y) {
  let ax = (y & 0xff) * 40;
  if (y & 1) ax += 0x1fd8;
  ax = (ax + ((x & 0xffff) >> 2)) & 0xffff;
  g.shift = (x & 3) * 2;
  g.c(13);
  return ax;
}

// Advance a CGA row pointer: DI -= 2*words; DI ^= 2000h; if bank 0 -> DI += 50h.
function nextRow(di, back) {
  di = (di - back) & 0xffff;
  di ^= 0x2000;
  if (!(di & 0x2000)) di = (di + 0x50) & 0xffff;
  return di;
}

// CS:2d35 - AND-blit DS:SI onto ES:DI (words x rows), saving the background to DS:BP.
export function blitAnd(g, es, di, si, bp, words, rows) {
  g.df = 0; // CLD
  const m = g.mem;
  g.wb(V.BLIT_WORDS, words);
  g.wb(V.BLIT_ROWS, rows);
  let cyc = 5;
  do {
    for (let i = 0; i < words; i++) {
      const b0 = es === SEG_VRAM ? m.vrb(di) : m.rb(di);
      const b1 = es === SEG_VRAM ? m.vrb(di + 1) : m.rb(di + 1);
      m.wb(bp, b0);
      m.wb(bp + 1, b1);
      const s0 = m.rb(si) & b0;
      const s1 = m.rb(si + 1) & b1;
      if (es === SEG_VRAM) {
        m.vwb(di, s0);
        m.vwb(di + 1, s1);
      } else {
        m.wb(di, s0);
        m.wb(di + 1, s1);
      }
      di = (di + 2) & 0xffff;
      si = (si + 2) & 0xffff;
      bp = (bp + 2) & 0xffff;
    }
    cyc += words * 7 + 9;
    di = nextRow(di, 2 * g.rw(V.BLIT_WORDS));
    rows = (rows - 1) & 0xff;
    g.wb(V.BLIT_ROWS, rows);
  } while (rows !== 0);
  g.c(cyc);
  return { di, si, bp };
}

// Per-byte transparency of CS:2ccc: pixels that are 0 in the sprite keep the background.
function maskOf(b) {
  let mask = 0;
  if (!(b & 0xc0)) mask |= 0xc0;
  if (!(b & 0x30)) mask |= 0x30;
  if (!(b & 0x0c)) mask |= 0x0c;
  if (!(b & 0x03)) mask |= 0x03;
  return mask;
}
function zeroPixels(b) {
  return (!(b & 0xc0)) + (!(b & 0x30)) + (!(b & 0x0c)) + (!(b & 0x03));
}

// CS:2ccc - transparent blit (colour 0 = see-through), saving the background to DS:BP.
export function blitOver(g, es, di, si, bp, words, rows) {
  g.df = 0; // CLD
  const m = g.mem;
  g.wb(V.BLIT_WORDS, words);
  g.wb(V.BLIT_ROWS, rows);
  let cyc = 6;
  do {
    for (let i = 0; i < words; i++) {
      const b0 = es === SEG_VRAM ? m.vrb(di) : m.rb(di);
      const b1 = es === SEG_VRAM ? m.vrb(di + 1) : m.rb(di + 1);
      m.wb(bp, b0);
      m.wb(bp + 1, b1);
      const s0 = m.rb(si);
      const s1 = m.rb(si + 1);
      m.wb(V.BLIT_SPRITE, s0);
      m.wb(V.BLIT_SPRITE + 1, s1);
      const o0 = (b0 & maskOf(s0)) | s0;
      const o1 = (b1 & maskOf(s1)) | s1;
      if (es === SEG_VRAM) {
        m.vwb(di, o0);
        m.vwb(di + 1, o1);
      } else {
        m.wb(di, o0);
        m.wb(di + 1, o1);
      }
      di = (di + 2) & 0xffff;
      si = (si + 2) & 0xffff;
      bp = (bp + 2) & 0xffff;
      cyc += 38 + zeroPixels(s0) + zeroPixels(s1);
    }
    cyc += 9;
    di = nextRow(di, 2 * g.rw(V.BLIT_WORDS));
    rows = (rows - 1) & 0xff;
    g.wb(V.BLIT_ROWS, rows);
  } while (rows !== 0);
  g.c(cyc);
  return { di, si, bp };
}

// CS:2d9d - copy a packed rectangle DS:SI -> ES:DI (CGA-interlaced destination).
// srcSeg is normally DS; one caller (CS:20be) runs it with DS=B800.
export function copyRect(g, es, di, si, words, rows, srcSeg = SEG_DS) {
  g.df = 0; // CLD
  const m = g.mem;
  g.wb(V.BLIT_WORDS, words);
  g.wb(V.BLIT_ROWS, rows);
  let cyc = 5;
  do {
    for (let i = 0; i < 2 * words; i++) {
      const b = srcSeg === SEG_VRAM ? m.vrb(si) : m.rb(si);
      if (es === SEG_VRAM) m.vwb(di, b);
      else m.wb(di, b);
      di = (di + 1) & 0xffff;
      si = (si + 1) & 0xffff;
    }
    cyc += words + 9;
    di = nextRow(di, 2 * g.rw(V.BLIT_WORDS));
    rows = (rows - 1) & 0xff;
    g.wb(V.BLIT_ROWS, rows);
  } while (rows !== 0);
  g.c(cyc);
  return { di, si };
}

// CS:2dca - copy an interlaced screen rectangle DS(B800):SI -> packed ES(data):DI.
// The counters live at ES:2ae0/2ae2, which is the data segment.
export function saveRect(g, di, si, words, rows) {
  g.df = 0; // CLD
  const m = g.mem;
  m.wb(V.BLIT_WORDS, words);
  m.wb(V.BLIT_ROWS, rows);
  let cyc = 5;
  do {
    for (let i = 0; i < 2 * words; i++) {
      m.wb(di, m.vrb(si));
      di = (di + 1) & 0xffff;
      si = (si + 1) & 0xffff;
    }
    cyc += words + 9;
    si = nextRow(si, 2 * m.rw(V.BLIT_WORDS));
    rows = (rows - 1) & 0xff;
    m.wb(V.BLIT_ROWS, rows);
  } while (rows !== 0);
  g.c(cyc);
  return { di, si };
}

// CS:2d70 - linear copy DS:SI -> ES:DI with a source stride of AL words per row.
export function copyStride(g, es, di, si, words, rows, strideWords) {
  g.df = 0; // CLD
  const m = g.mem;
  g.ww(V.COPY_SRC, si);
  g.wb(V.BLIT_WORDS, words);
  g.wb(V.BLIT_ROWS, rows);
  g.wb(V.COPY_STRIDE, (strideWords << 1) & 0xff);
  let cyc = 8;
  do {
    for (let i = 0; i < 2 * words; i++) {
      const b = m.rb(si);
      if (es === SEG_VRAM) m.vwb(di, b);
      else m.wb(di, b);
      di = (di + 1) & 0xffff;
      si = (si + 1) & 0xffff;
    }
    const src = (g.rw(V.COPY_SRC) + g.rb(V.COPY_STRIDE)) & 0xffff;
    g.ww(V.COPY_SRC, src);
    si = src;
    rows = (rows - 1) & 0xff;
    g.wb(V.BLIT_ROWS, rows);
    cyc += words + 7;
  } while (rows !== 0);
  g.c(cyc);
  return { di, si };
}

// CS:2e29 - box overlap test. Returns CF (true = overlap).
// AX/SI: first x and width; BX: second x; DI: second width;
// DL/CL: first y and height; DH: second y; CH: second height.
export function overlap(g, ax, si, bx, di, dl, cl, dh, ch) {
  g.c(6);
  let a = (ax + si) & 0xffff;
  if (a < bx) return false;
  a = (a - si) & 0xffff;
  a = a < di ? 0 : a - di;
  g.c(4);
  if (a > bx) return false;
  let d = (dl + cl) & 0xff;
  g.c(3);
  if (d < dh) return false;
  d = (d - cl) & 0xff;
  d = d < ch ? 0 : d - ch;
  g.c(5);
  if (d > dh) return false;
  return true;
}

export { SEG_DS, SEG_VRAM };
