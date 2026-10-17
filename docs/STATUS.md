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
sound toggle, restart, back to menu. Entering a window (a room) stops with
"not yet ported: room …".

## Verification

| command | level | result |
|---|---|---|
| `npm run verify` | all required groups | passing |
| `npm run verify -- --only=unit` | unit: machine layer and primitives vs. definitions | 24 checks |
| `npm run verify -- --only=slice` | independent runtime scenario + determinism + negative control | 11 checks |
| `npm run verify -- --only=reference` | closed-loop replay of DOSBox captures, byte-exact DS+VRAM | 1 scenario, 34 checkpoints, 2 negative controls |
| `npm run verify -- --only=browser` | browser acceptance (headless Chrome) | 10 checks |

Reference scenarios (`scenarios/*.json`, captures in `local/captures/`, recapture with
`node tools/dosbox/capture.mjs scenarios/<id>.json` against a running dosbox-automation):

| scenario | covers | checkpoints |
|---|---|---|
| boot-title-alley | entry, title + attract mode + tune, menu N/K (DS only), alley 3000 iterations, walk, jump | 34/34 identical |

Evidence scope: the reference replay uses recorded BIOS ticks/retrace/seed and keys applied
at loop heads; the port's own timing model (instruction costs) is **not** validated by it.
The free-running browser timing is an approximation of DOSBox at 3000 cycles/ms.

## Known limitations

- Rooms 1–7 (inside the windows), the alley↔room transition wipe, the return-to-alley
  animations and the game-over animation path into the attract loop are not ported.
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

Rooms: transition wipe (CS:1bf0), the seven room loops and their objects, the return to
the alley; each validated with a reference scenario that enters the room.
