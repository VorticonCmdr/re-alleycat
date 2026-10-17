// CGA mode 4 (320x200, 4 colours) presentation.
// The adapter state is part of the machine; turning VRAM into pixels is presentation only.

// The 16 RGBI colours as the reference emulator's VGA palette renders them.
export const RGBI = [
  0x000000, 0x0000aa, 0x00aa00, 0x00aaaa, 0xaa0000, 0xaa00aa, 0xaa5500, 0xaaaaaa,
  0x555555, 0x5555ff, 0x55ff55, 0x55ffff, 0xff5555, 0xff55ff, 0xffff55, 0xffffff,
];

export class CgaAdapter {
  constructor() {
    this.mode = 3;
    this.palette = 1; // 0: green/red/brown, 1: cyan/magenta/white
    this.background = 0; // RGBI index for pixel value 0 (also border)
    this.intensity = 0;
    this.crtcR2Adjust = 0; // horizontal sync nudges via the game's Ctrl+Alt+arrows (not displayed)
  }

  // INT 10h AH=0Bh.
  setPaletteBios(bh, bl) {
    if (bh === 0) {
      this.background = bl & 0x0f;
      this.intensity = (bl >> 4) & 1;
    } else if (bh === 1) {
      this.palette = bl & 1;
    }
  }

  // Port 3D9h (colour select register).
  writeColorSelect(v) {
    this.background = v & 0x0f;
    this.intensity = (v >> 4) & 1;
    this.palette = (v >> 5) & 1;
  }

  colours() {
    const base = this.palette ? [3, 5, 7] : [2, 4, 6];
    const hi = this.intensity ? 8 : 0;
    return [this.background, base[0] + hi, base[1] + hi, base[2] + hi].map((i) => RGBI[i]);
  }

  // Render the 320x200 frame into an RGBA byte buffer (Uint8ClampedArray / Uint8Array).
  render(vram, out) {
    const pal = this.colours();
    let o = 0;
    for (let y = 0; y < 200; y++) {
      const row = (y & 1) * 0x2000 + (y >> 1) * 80;
      for (let xb = 0; xb < 80; xb++) {
        const b = vram[row + xb];
        for (let s = 6; s >= 0; s -= 2) {
          const c = pal[(b >> s) & 3];
          out[o++] = c >> 16;
          out[o++] = (c >> 8) & 0xff;
          out[o++] = c & 0xff;
          out[o++] = 255;
        }
      }
    }
  }
}

// Pixel value (0..3) at x,y in a mode-4 framebuffer.
export function pixelAt(vram, x, y) {
  const b = vram[(y & 1) * 0x2000 + (y >> 1) * 80 + (x >> 2)];
  return (b >> (6 - 2 * (x & 3))) & 3;
}
