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
| `npm run verify -- --only=reference` | closed-loop replay of DOSBox captures, byte-exact DS+VRAM | 13 scenarios, 391 checkpoints, 39 negative controls (incl. speaker writes) |
| `npm run verify -- --only=browser` | browser acceptance (headless Chrome) | 11 checks (incl. a room) |

Reference scenarios (`scenarios/*.json`, captures in `local/captures/`, recapture with
`node tools/dosbox/capture.mjs scenarios/<id>.json` against a running dosbox-automation):

| scenario | covers | checkpoints |
|---|---|---|
| boot-title-alley | entry, title + attract mode + tune, menu N/K (DS only), alley 3000 iterations, walk, jump | 34/34 identical |
| room-1 … room-7 | intro, room forced at alley pass 60 (state injection, see manifest), transition wipe, room background, 1600 room loop passes with walking/jumping | 19/19 identical each |
| room-exits | skill H; room 3 solved → bonus animation CS:38b0; room 1 → room 2 via the fish bowl; dog bite CS:5be0; last life lost → game over → attract title | 30/30 identical |
| room7-win | room 7 solved → win sequences CS:528b and CS:5313 → alley | 30/30 identical |
| natural-window | no state injection: the `enterWindow` play policy climbs cans → fence → clothes line and drops into an open window (room 6 in this capture); its key presses are logged and replayed | 76/76 identical |
| natural-room1 | room choice injected; the `play` policy lands on the chair, jumps onto the table into the fish bowl; original hands over to room 2 | 76/76 identical |
| hotkeys | skill T; Esc pause/resume (INT 1Ah AH=1 checked); Ctrl+S sound off and play; Ctrl+R restart; Ctrl+M menu, skill A, new game | 29/29 identical |

Outcomes in room-exits/room7-win are triggered by state injection (documented `poke`
events), not by playing the room to its goal. Captures move the CRTC retrace window
(environment change recorded in each manifest) because breakpoint stops quantise DOSBox's
emulated time and the stock window would never be observed by retrace-wait loops.

Room scenarios exclude four sound-only variable ranges written from unrecorded PIT samples
(listed with reasons in each manifest, `compare.dsExclude`).

Evidence scope: the reference replay uses recorded BIOS ticks/retrace/seed and keys applied
at loop heads; the port's own timing model (instruction costs) is **not** validated by it.
The free-running browser timing is an approximation of DOSBox at 3000 cycles/ms.

## Known limitations

- Room goals reached by actual play: room 1 (fish bowl) only; the other rooms' goals are
  verified with injected outcomes. Not covered at all: the 46-second title timeout before
  the first game, Ctrl+9 and Ctrl+Y.
- Joystick input is not supported (no game port is reported, so the original's own
  "joystick not found" path is taken when Y is chosen).
- Menu/pause text uses an original substitute 8x8 font (the BIOS ROM font is not part of
  the game files).
- Instruction-cost model is calibrated on the alley loop (+1.3 % passes per tick), the
  retrace-gated idle redraw and the title's attract cat (see RE_NOTES); room loops remain
  approximate (no undistorted measurement available).
- Ctrl+Alt+Del in the original reboots the PC; the port stops with a diagnostic.
- Ctrl+Alt+Left/Right in the original nudges the CRT picture; the port records but does
  not display it.

## Next milestone

Calibrate the cost model on room loops and the title (free-running DOSBox measurements);
longer natural-play scenarios (no state injection) that reach room goals.
