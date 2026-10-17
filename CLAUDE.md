# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser port (HTML/CSS/vanilla JS, no build step, no npm dependencies) of the DOS game
**Alley Cat** (1984, IBM PC/CGA). The port translates the original program routine by
routine and runs it against the user's own `CAT.EXE`, which is loaded at runtime.

**Never commit or publish original data**: `game/` (original files), `ghidra/` (project
with binary bytes) and `local/` (disassembly listings, DOSBox captures, frames) are
gitignored. Do not paste disassembly, extracted sprites, texts or tables into tracked
files; read them from `g.mem.ds` at runtime.

## Commands

```sh
npm run serve                       # dev server on 127.0.0.1:8000 (/game/ maps to local originals)
npm run verify                      # required suite: unit, slice, browser (non-zero on failure)
npm run verify -- --only=unit       # one group: unit | slice | browser
node tests/slice.mjs                # single test group directly
node tools/run.mjs --script "3000:Space;1000:KeyN;1000:KeyK;1000:Space" --ms 9000 --png x.png
                                    # exploratory headless run; frames go to local/frames/
```

Reference captures (need the dosbox-automation emulator running with C: = game/; one owner
at a time, never run two captures concurrently):

```sh
node tools/make-scenarios.mjs [id ...] [--reset]   # (re)generate scenario manifests
node tools/dosbox/capture.mjs scenarios/<id>.json  # capture into local/captures/<id>/
node tests/reference.mjs --scenario=<id> [--all]   # replay + byte compare (--all: don't stop at first failure)
node tools/room-sandbox.mjs --room N --ms 6000 --every 500   # headless room run, frames in local/frames/
```

Captures expect CAT at PSP 01E5 in the managed emulator (svga_s3). After an emulator restart
mount C: = game/ again and type `C:`. A failed capture runs `forceExit`, which restores the
BIOS INT 9 vector; if the shell ignores keys, a dead CAT handler is still hooked, so restart the
emulator. `hostkey` events press real DOSBox keys (`KBD_*` names; single-byte keys only), and the
capture writes the resulting `scan` events. The Tandy edition runs on a separate instance:
`local/dosbox-tandy/start.sh` (port 8387, `DOSBOX_URL`/`DOSBOX_TOKEN` env for the client).

Browser checks need Chrome (`CHROME_PATH`); originals are found in `game/` or `ALLEYCAT_GAME_DIR`.
A missing/corrupt `CAT.EXE` is a setup failure (exit 2), not a pass.

## Architecture (read docs/ARCHITECTURE.md)

- `src/machine/`: virtual PC: `clock.js` (one cycle = one original instruction; BIOS
  ticks, PIT ch0 mode 3, VGA-timed retrace as DOSBox svga_s3), `memory.js` (64 KiB data
  segment image at original offsets + B800 VRAM), `video.js`, `speaker.js`, `keyboard.js`
  (scan codes, typematic in virtual time), `bios.js` (INT 10h subset, original font).
- `src/game/`: translated routines; comments name the original `CS:xxxx` offset.
  `game.js` wires the machine and runs the top-level generator (`main.js`, CS:0000).
  Routines that wait on time/retrace/input are generators (`yield*`); interrupts are
  delivered only at yields, which keeps runs deterministic. Charge cycles with `g.c(n)`.
  Model 8/16-bit wrap explicitly; keep `g.df` (direction flag) updated for routines with
  CLD/STD.
- Untranslated paths call `g.unsupported(...)` → `UnsupportedPath`; never invent behaviour.
- `src/ui/`: page shell (`app.js`), Web Audio speaker synthesis, IndexedDB file memory.

## Reverse engineering

- Addresses: `DS:x` = file offset `0x300+x`; `CS:x` = file offset `0x7430+x` = Ghidra `1723:x`.
  Ghidra shows call targets as linear `1000:yyyy` → CS offset = yyyy+0x10000-0x17230.
- Full listing (local only): `local/re/cat.lst` (regenerate with the Ghidra scripts noted in
  docs/RE_NOTES.md). Use the `ghidra-evidence` skill before recording negative findings.
- DOSBox (MCP or REST at 127.0.0.1:8386): live DS = PSP+0x20, CS = PSP+0x733 (PSP was
  0x01E5 → DS 0x0205, CS 0x0918). Re-verify by bytes after any launch change.
- Record claims with evidence levels in docs/RE_NOTES.md; keep docs/STATUS.md current.
