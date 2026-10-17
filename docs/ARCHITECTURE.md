# Architecture

## Runtime boundary

```
user's CAT.EXE ──► exe.js (hash check, MZ parse) ──► Memory.ds (64 KiB data segment image)
                                                     Memory.vram (B800 window)
src/game/*  translated routines ──► g.rb/g.wb/... (data segment)  g.mem.vrb/vwb (video)
            environment reads  ──► g.ticks() g.retrace() g.pit0() g.modelByte() g.joystickPort()
            hardware writes    ──► g.out42/43/61 (speaker), g.bios.* (INT 10h), g.cga.*
browser shell (src/ui) ──► keyboard events → KeyboardController → INT 9 (input.js)
                       ──► requestAnimationFrame → Game.runUntil(virtual cycles) → render, audio
```

* **Original memory layout.** The game is hand-written assembly addressing hundreds of
  global bytes/words. Keeping the data segment as a byte array at its original offsets
  makes translation mechanical and lets any state be diffed byte-for-byte against the
  reference emulator. Sprites, tables, music and texts are read from that array; the
  repository contains none of them.
* **One function per original routine**, commented with the original `CS:xxxx` offset.
  Register arguments become parameters, CF/ZF results become boolean returns.
  Integer widths are explicit (`& 0xff`, `& 0xffff`, 8-bit `SHL BL` vs 16-bit forms).
  The CPU direction flag is modelled (`g.df`) because one routine leaves it set and a
  few others use string instructions without `CLD`.
* **Coroutines.** Routines that wait on time, retrace or input are generators
  (`function*`, called with `yield*`); the top level is a generator resumed by
  `Game.runUntil`. Keyboard interrupts are delivered only at yield points, so a run is
  fully determined by the original file, the options and the timed input events.

## Time

`VirtualClock` counts executed original instructions (`g.c(n)` per basic block; string
repetitions and `LOOP` iterations individually). This mirrors DOSBox's fixed-cycles
model, the reference configuration (`cpu_cycles=3000`). All time the game can observe is
derived from that counter:

| source | model | consumed at |
|---|---|---|
| INT 1Ah AH=0 | BIOS tick = one PIT ch0 wrap (65536 clocks, 18.2065 Hz) | many routines (`g.ticks()`) |
| INT 1Ah AH=1 | rebases the tick count (pause screen) | CS:5ed2 |
| PIT ch0 latch | mode 3: counts down by 2, wraps every 32768 clocks | CS:13b7, CS:2e10 (RNG seed) |
| port 3DAh bit 3 | VGA mode-4 timing as in DOSBox svga_s3: 70.09 Hz, lines 412..414 | CS:13d8 |
| F000:FFFE | option `modelId`, default 0xFC (as DOSBox reports) | CS:13aa |

The browser advances the clock by wall time × `cyclesPerMs` per animation frame (capped
at 100 ms per frame). Rendering and audio never feed back into the simulation.

Instruction counts per block are approximate **[approx]**: they matter only for how many
main-loop iterations fit in a BIOS tick, which the game uses for some pacing (e.g. the cat
update also runs after 32 calls within one tick). Calibration against DOSBox is tracked in
STATUS.md.

## Sound

The game drives the PC speaker directly (PIT ch2 divisor, port 61h gate/data bits, and
direct bit toggling for noises). `Speaker` logs each change with its virtual time;
`src/ui/audio.js` synthesises the square wave / clicks into Web Audio buffers. The sound
switch (DS:0000, Ctrl+S) *is* simulation state: several effects busy-wait only when sound
is on, so it changes game timing exactly like the original.

## Text

Menus and the pause box print through BIOS INT 10h teletype, i.e. the machine's ROM font,
which is not part of the game files. `src/machine/font8x8.js` is an original substitute
font. Text pixels therefore differ from the reference by design; reference comparisons
exclude screens while text is shown.

## Strict mode

Untranslated original paths throw `UnsupportedPath`; the page stops and shows which
routine was reached. There is no fallback behaviour.

## Verification levels

1. **Unit** (`tests/run-unit.mjs`): machine layer and primitives against independent
   definitions.
2. **Slice** (`tests/slice.mjs`): the real program flow headless with the port's own
   environment providers, plus determinism and a negative control.
3. **Reference** (planned): DOSBox captures of environment values at their consumption
   points replayed into the port (closed loop), compared byte-for-byte at checkpoints.
4. **Browser** (`tools/browser-check.mjs`): headless Chrome over CDP drives the real
   page: loading, canvas, trusted key events, audio start, IndexedDB persistence.

Success at one level is not reported as success at another.
