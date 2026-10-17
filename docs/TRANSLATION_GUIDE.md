# Translating original routines

The port is verified byte-for-byte against the original (data segment and video memory
at checkpoints), so translations must reproduce every memory write the original makes,
in the same order relative to environment reads. Read `docs/ARCHITECTURE.md` first and
use `src/game/cat.js`, `src/game/alley.js` and `src/game/rooms/common.js` as models.

## Sources

- Full listing (local only, never commit or paste into tracked files): `local/re/cat.lst`.
  Lines look like `0e78: a06e05  MOV AL,[0x56e]`; a `:` after the address marks a
  branch/call target; `Lxxxx` are code-segment offsets; `[0x56e]` are data-segment
  offsets (DS:056e). `;------ FUN_1723_xxxx` starts a Ghidra function.
- Data (sprites, tables, texts, tunes) is never copied into source. Read it at runtime:
  `g.rb(addr)`, `g.rw(addr)`. Tables are addressed exactly as the original does.

## Runtime API (the `g` object)

| need | use |
|---|---|
| DS byte/word | `g.rb(a)`, `g.wb(a,v)`, `g.rw(a)`, `g.ww(a,v)` (masking to 8/16 bits is done) |
| video B800 | `g.mem.vrb(a)`, `g.mem.vwb(a,v)` |
| cost | `g.c(n)`: n ≈ original instructions executed on that path (per block; loops multiply) |
| INT 1Ah AH=0 | `g.ticks()` (DX; `g.ticksHigh` = CX) — **one call per original INT 1Ah** |
| INT 1Ah AH=1 | `g.setTicks(cx,dx)` |
| port 3DAh bit 3 (CS:13d8) | `g.retrace()` returns true while in retrace (original ZF=0) — one call per original CALL 13d8 |
| PIT ch0 (CS:13b7) | `g.pit0()` |
| model byte | `g.rb(0x697)` (0xFC on the reference machine) |
| speaker | `g.out43(v)`, `g.out42(v)`, `g.in61()`, `g.out61(v)`; helpers in `sound.js` |
| INT 10h AH=0Bh | `g.bios.setPalette(bh, bl)` |
| direction flag | `g.df` (set `g.df = 0` where the original executes CLD, `1` for STD); string ops without CLD must honour it |
| untranslatable path | `g.unsupported('what (CS:xxxx)')` — never guess |

Primitives (`src/game/prims.js`): `random` (2dfd), `xyAddr(g,x,y)` (2cb0), `blitAnd(g,es,di,si,bp,words,rows)` (2d35),
`blitOver(...)` (2ccc), `copyRect(g,es,di,si,words,rows)` (2d9d), `saveRect(g,di,si,words,rows)` (2dca),
`copyStride(g,es,di,si,words,rows,strideWords)` (2d70), `overlap(g,ax,si,bx,di,dl,cl,dh,ch)` (2e29, returns CF),
`SEG_VRAM`/`SEG_DS`. For `CX=0xRRWW` arguments pass `words = CX&0xff`, `rows = CX>>8`.

Already translated (import, don't duplicate): see the `// CS:xxxx` comments in
`cat.js` (07a1, 070d, 08e5, 0fc9, 10dd, 1112, 1124, 1145, 1166, 11e3, 1608...),
`alley.js` (1d31, 2b24 `drawShapes`, 1e40, 1e63, 20f5, 2136...), `sound.js` (5400–5c5c),
`score.js` (2706, 271e, 2739), `input.js` (1200, 1338, 5b21), `title.js` (5e70),
`rooms/common.js` (0872, 1bf0, 2790, 3150, 3339, 3405, 3445).

## Control flow

- A routine that loops until time passes, retrace changes, the PIT moves or a key
  arrives is a generator (`function*`) and must `yield` inside that loop; callers use
  `yield*`. Everything else is a plain function.
- A room loop yields its loop-head address exactly once per original pass through the
  loop head: `yield 0x027e;` at the top of the loop. These are the sync points used by the
  reference scenarios; an extra or missing yield breaks verification.
- Keep the original order of memory writes and environment reads. Do not hoist or merge
  reads of `g.ticks()`/`g.retrace()`.
- CF/ZF results become boolean returns; multiple register results become objects.
- Spell out widths: `SHL BL,1` keeps BH (`(bx & 0xff00) | ((bx << 1) & 0xff)`), 8-bit
  `ADD` wraps, `SUB` borrows (`JC`/`JNC`), `JA/JB` are unsigned, `MUL AH` is 8×8→16.
- Labels with several entry paths: use small helper functions or a `switch` on a label
  variable (see `main.js`), whichever reads more clearly.

## Room module contract (`src/game/rooms/roomN.js`)

```js
import { registerRoom } from './hooks.js';
registerRoom(N, {
  *loop(g) { ... },          // the room's entry sequence + loop from the jump table (CS:0250)
  drawBackground(g) { ... }, // room-specific part called by CS:2790 (rooms 3, 4, 6, 7)
  landing(g) { ... },        // rooms 3 (CS:3c43) and 7 (CS:30fa): returns CF
  *swim(g) { ... },          // room 2: CS:0953..0bab (cat physics under water)
  chaserTest(g) { ... },     // room 6: CS:47b0 (returns CF)
  *successAnimation(g) {},   // room 1: CS:38b0; room 7: CS:5313
  leaveSuccess(g) {},        // room 7: CS:528b
});
```

## Checking your work (no emulator access)

- `node tools/room-sandbox.mjs --room N --ms 6000 --every 500` forces the game into room N
  and writes frames to `local/frames/`; add `--keys "500:ArrowRight:800;300:ArrowUp"`.
- `npm run verify -- --only=unit,slice` must keep passing.
- The lead validates every room against the original with reference captures.
