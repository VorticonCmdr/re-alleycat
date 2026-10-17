// The small subset of BIOS services the game calls (INT 10h video, INT 11h equipment).
// INT 1Ah lives on the clock; INT 9 is replaced by the game's own handler.
//
// Text output (INT 10h AH=0Eh in mode 4) needs the machine's ROM font, which is not part
// of the game files. An original substitute font is used instead; text pixels therefore
// differ from the reference emulator by design (documented comparison exclusion).

import { glyph } from './font8x8.js';

export class Bios {
  constructor(mem, cga, speaker) {
    this.mem = mem;
    this.cga = cga;
    this.speaker = speaker;
    this.cursorRow = 0;
    this.cursorCol = 0;
    this.equipment = 0x0020; // 80x25 colour adapter, no game port, no printers
  }

  // INT 10h AH=00h
  setMode(al) {
    if ((al & 0x7f) !== 4) throw new Error(`unsupported video mode ${al}`);
    this.cga.mode = 4;
    this.cga.palette = 1;
    this.cga.background = 0;
    this.cga.intensity = 0;
    if (!(al & 0x80)) this.mem.vclear();
    this.cursorRow = 0;
    this.cursorCol = 0;
  }

  // INT 10h AH=02h (page ignored: mode 4 has one page)
  setCursor(row, col) {
    this.cursorRow = row & 0xff;
    this.cursorCol = col & 0xff;
  }

  // INT 10h AH=0Bh
  setPalette(bh, bl) {
    this.cga.setPaletteBios(bh, bl);
  }

  // INT 10h AH=0Eh, graphics-mode teletype. BL = foreground colour (bit 7: XOR).
  teletype(ch, bl) {
    switch (ch) {
      case 0x07:
        return; // bell: not emitted (BIOS beep is a host effect the game never relies on)
      case 0x08:
        if (this.cursorCol > 0) this.cursorCol--;
        return;
      case 0x0a:
        this._lineFeed();
        return;
      case 0x0d:
        this.cursorCol = 0;
        return;
      default:
        break;
    }
    this._drawChar(ch, bl);
    if (++this.cursorCol >= 40) {
      this.cursorCol = 0;
      this._lineFeed();
    }
  }

  _lineFeed() {
    if (this.cursorRow < 24) {
      this.cursorRow++;
      return;
    }
    // scroll the whole screen up one character row (8 scan lines), fill with colour 0
    const v = this.mem.vram;
    for (const bank of [0, 0x2000]) {
      v.copyWithin(bank, bank + 4 * 80, bank + 100 * 80);
      v.fill(0, bank + 96 * 80, bank + 100 * 80);
    }
  }

  _drawChar(ch, bl) {
    const g = glyph(ch);
    const colour = bl & 3;
    const xor = bl & 0x80;
    const col = this.cursorCol;
    const row = this.cursorRow;
    for (let r = 0; r < 8; r++) {
      const y = row * 8 + r;
      const off = (y & 1) * 0x2000 + (y >> 1) * 80 + col * 2;
      const bits = g[r];
      let w = 0;
      for (let i = 0; i < 8; i++) {
        if (bits & (0x80 >> i)) w |= colour << (14 - 2 * i);
      }
      const hi = (w >> 8) & 0xff;
      const lo = w & 0xff;
      if (xor) {
        this.mem.vwb(off, this.mem.vrb(off) ^ hi);
        this.mem.vwb(off + 1, this.mem.vrb(off + 1) ^ lo);
      } else {
        this.mem.vwb(off, hi);
        this.mem.vwb(off + 1, lo);
      }
    }
  }
}
