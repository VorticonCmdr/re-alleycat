# Current status

_Last updated: 2026-10-17_

## Supported build

| file | sha256 | status |
|---|---|---|
| CAT.EXE (IBM PC, CGA) | 4979c886…dfdd | supported |
| TANDYCAT.EXE | 13bc456a…a321 | rejected with a message (not ported) |

Reference machine profile: DOSBox 0.84.0-vc1, machine=svga_s3 (model byte 0xFC),
cpu_cycles=3000. The port defaults to the same profile. The IBM PC/XT (0xFF) and PCjr
(0xFD) branches of the original are only partly implemented: PCjr paths stop with a
diagnostic; PC/XT-specific waits exist in code but are unverified.

## Working playable route (browser)

load CAT.EXE (hash-checked) → title screen with attract-mode cat and tune → menu
(joystick question, skill level) → alley: walk, jump, clothes lines, windows that open
and throw objects, the dog, the critter in the cans, mice to catch (score), lives, pause,
sound toggle, restart, back to menu → through an open window into all seven rooms (with
their creatures, chaser, goals, bonuses, fish-bowl room) and back, game over → title.

## Verification

| command | level | result |
|---|---|---|
| `npm run verify` | all required groups | passing |
| `npm run verify -- --only=unit` | unit: machine layer and primitives vs. definitions | 24 checks |
| `npm run verify -- --only=slice` | independent runtime scenario + determinism + negative control | 11 checks |
| `npm run verify -- --only=reference` | closed-loop replay of DOSBox captures, byte-exact DS+VRAM | 8 scenarios, 167 checkpoints, 16 negative controls |
| `npm run verify -- --only=browser` | browser acceptance (headless Chrome) | 10 checks |

Reference scenarios (`scenarios/*.json`, captures in `local/captures/`, recapture with
`node tools/dosbox/capture.mjs scenarios/<id>.json` against a running dosbox-automation):

| scenario | covers | checkpoints |
|---|---|---|
| boot-title-alley | entry, title + attract mode + tune, menu N/K (DS only), alley 3000 iterations, walk, jump | 34/34 identical |
| room-1 … room-7 | intro, room forced at alley pass 60 (state injection, see manifest), transition wipe, room background, 1600 room loop passes with walking/jumping | 19/19 identical each |

Room scenarios exclude four sound-only variable ranges written from unrecorded PIT samples
(listed with reasons in each manifest, `compare.dsExclude`).

Evidence scope: the reference replay uses recorded BIOS ticks/retrace/seed and keys applied
at loop heads; the port's own timing model (instruction costs) is **not** validated by it.
The free-running browser timing is an approximation of DOSBox at 3000 cycles/ms.

## Known limitations

- Room goals, bonus animations (CS:38b0, 5313/528b), the fish-bowl handover and the
  return-to-alley sequences are translated and run in the sandbox, but no reference
  scenario reaches them yet (the room scenarios cover entry and 1600 loop passes).
- Joystick input is not supported (no game port is reported, so the original's own
  "joystick not found" path is taken when Y is chosen).
- Menu/pause text uses an original substitute 8x8 font (the BIOS ROM font is not part of
  the game files).
- Instruction-cost model is approximate; free-running timing (iterations per BIOS tick)
  has not been calibrated against DOSBox yet.
- Ctrl+Alt+Del in the original reboots the PC; the port stops with a diagnostic.
- Ctrl+Alt+Left/Right in the original nudges the CRT picture; the port records but does
  not display it.

## Next milestone

Reference scenarios that reach room goals and exits (bonus animation, room 2 from room 1,
return to the alley, game over), then calibration of the remaining hot paths.
