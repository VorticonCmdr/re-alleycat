# Current status

_Last updated: 2026-10-17_

## Supported build

| file | sha256 | status |
|---|---|---|
| CAT.EXE (IBM PC, CGA) | 4979c886…dfdd | supported |
| TANDYCAT.EXE | 13bc456a…a321 | rejected with a message (assessed, not ported; see below) |

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
| `npm run verify -- --only=slice` | independent runtime scenario + determinism + negative control | 19 checks |
| `npm run verify -- --only=reference` | closed-loop replay of DOSBox captures, byte-exact DS+VRAM | 15 scenarios, 472 checkpoints, 45 negative controls (incl. speaker writes) |
| `npm run verify -- --only=browser` | browser acceptance (headless Chrome) | 14 checks (incl. a room, touch, gamepad, profiles) |

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
| natural-room6 | room choice injected; the room6 policy holds Alt and steps between floor rows: 10 of 12 bowls eaten by play, then the chaser catches the cat (goal not reached) | 40/40 identical |
| real-keyboard | real DOSBox key presses: the original INT 9 handler (CS:14b3, hot-key routine CS:1572) runs; the 18 scan-code bytes it read, each at an exactly known position, drive the port's translated handler (menu, keypad walking/jumping, Ctrl+S) | 41/41 identical |

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

- Room goals reached by actual play: room 1 (fish bowl) only (room 6 partly); the other rooms' goals are
  verified with injected outcomes. Not covered at all: the 46-second title timeout before
  the first game, Ctrl+9 and Ctrl+Y.
- Joystick: a host gamepad drives an emulated game port (axis one-shots timed in virtual
  time, CS:122e/12a1 translated). Its timing constants are approximate; no reference capture
  covers the joystick (DOSBox exposes no API to drive its emulated stick).
- Keys in reference scenarios are mostly applied as the INT 9 handler's memory effects at
  loop heads; only `real-keyboard` runs the original handler, and only for single-byte
  keys (the E0 prefix of grey arrows arrives at an arbitrary instruction and is covered by
  unit tests only).
- Room 6 (bowls): the play policy eats bowls by itself but does not dodge the chaser
  (port free-run: 4 of 8 seeds reach the goal; the capture ate 10 of 12 bowls).
- Captures run room loops far slower in emulated time than free play (room 6: ~7 passes
  per BIOS tick instead of ~2000) because every breakpoint stop ends a 1 ms DOSBox slice;
  replays are exact, but play policies must be tuned to the capture's pass rate.
- Menu/pause text uses an original substitute 8x8 font (the BIOS ROM font is not part of
  the game files).
- Instruction-cost model is calibrated on the alley loop (+1.3 % passes per tick), the
  retrace-gated idle redraw and the title's attract cat (see RE_NOTES); room loops remain
  approximate (no undistorted measurement available).
- Ctrl+Alt+Del in the original reboots the PC; the port stops with a diagnostic.
- Ctrl+Alt+Left/Right in the original nudges the CRT picture; the port records but does
  not display it.

## Tandy 1000 edition (TANDYCAT.EXE): assessed, not ported

Findings are in RE_NOTES ("TANDYCAT.EXE"). It runs on an isolated second DOSBox
(machine=tandy, `local/dosbox-tandy/start.sh`, port 8387). Its INT 1Ah stub matches what the
tick capture expects, so references can be captured. 97.7 % of its instructions match
CAT.EXE, but a verified port still needs all of the following:
1. A per-edition table for every DS address constant in the translated code (≈2200
   literal accesses; data-held pointers stay as they are) and the code-offset map for
   CS-relative data.
2. Translations of the Tandy-only code: keyboard/input (Tandy arrow codes via the CS:DC08
   patch), menu and two-joystick code, the start-up stub's live patches, the INT 10h hook
   (palette registers, background via palette 0 + border).
3. A three-voice SN76496 music player (CS:173e..1827) and an SN76496 synthesizer for the
   browser, with port C0h writes added to the speaker verification.
4. A timing model for 59.92 Hz CGA video and the PIT ch0 rate change (CFFFh while sound
   plays), plus new alley pacing (tick-change test instead of the pass counter at CAT
   CS:1936).
5. A capture tool parameterised by edition (segments, sync sites, retrace site), and new
   reference scenarios.
Shipping it unverified would break the project's evidence rules, so the edition is still
rejected at load.

## Next milestone

Tandy edition per the plan above (largest item); play policies for the remaining room goals;
calibrate room-loop costs.
