// Guest memory as seen by the game.
//
// ds:   the 64 KiB data segment (DS = image + 0x100). It is initialised from the user's
//       CAT.EXE image, so every variable, sprite and table keeps its original offset and the
//       state can be diffed byte-for-byte against the reference emulator. The code segment
//       overlaps it at DS:7130 (CS:x == DS:7130+x).
// vram: the B800 window. DOSBox (svga_s3) maps 32 KiB there; CGA mode 4 displays the
//       first 16 KiB (even scan lines at 0000, odd at 2000). Offsets >= 0x8000 fall outside
//       video memory; writes are dropped and reads return 0xFF.

export const DS_IMAGE_OFFSET = 0x100;
export const CS_IN_DS = 0x7130;
export const VRAM_SIZE = 0x8000;

export class Memory {
  constructor(image) {
    this.ds = new Uint8Array(0x10000);
    const src = image.subarray(DS_IMAGE_OFFSET, Math.min(image.length, DS_IMAGE_OFFSET + 0x10000));
    this.ds.set(src);
    this.vram = new Uint8Array(VRAM_SIZE);
  }

  // --- data segment ---
  rb(a) {
    return this.ds[a & 0xffff];
  }
  wb(a, v) {
    this.ds[a & 0xffff] = v;
  }
  rw(a) {
    return this.ds[a & 0xffff] | (this.ds[(a + 1) & 0xffff] << 8);
  }
  ww(a, v) {
    this.ds[a & 0xffff] = v & 0xff;
    this.ds[(a + 1) & 0xffff] = (v >> 8) & 0xff;
  }
  // signed byte helper for tables holding -1/+1 style values
  rsb(a) {
    const v = this.ds[a & 0xffff];
    return v & 0x80 ? v - 256 : v;
  }

  // --- video segment B800 ---
  vrb(a) {
    a &= 0xffff;
    return a < VRAM_SIZE ? this.vram[a] : 0xff;
  }
  vwb(a, v) {
    a &= 0xffff;
    if (a < VRAM_SIZE) this.vram[a] = v;
  }
  vrw(a) {
    return this.vrb(a) | (this.vrb(a + 1) << 8);
  }
  vww(a, v) {
    this.vwb(a, v & 0xff);
    this.vwb(a + 1, (v >> 8) & 0xff);
  }
  vclear() {
    this.vram.fill(0);
  }
}

// Segment selectors used by translated code for routines whose ES/DS varies at runtime.
export const SEG_DS = 0;
export const SEG_VRAM = 1;

export function segRead(mem, seg, a) {
  return seg === SEG_VRAM ? mem.vrb(a) : mem.rb(a);
}
export function segWrite(mem, seg, a, v) {
  if (seg === SEG_VRAM) mem.vwb(a, v);
  else mem.wb(a, v);
}
