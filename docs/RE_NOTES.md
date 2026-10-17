# Reverse-engineering notes: CAT.EXE (IBM PC edition)

Evidence levels: **[obs]** observed live in DOSBox, **[static]** read from disassembly,
**[reg]** regression-validated, **[approx]** approximation, **[unk]** unknown.
Addresses: `CS:xxxx` = code segment offset (Ghidra `1723:xxxx`), `DS:xxxx` = data offset (DS=1010).

## Identity
| file | size | sha256 |
|---|---|---|
| CAT.EXE | 55067 | 4979c8867826e08881d1d4bec95c95d6bc1ac70fd21050ccdb4f733a50d7bfdd |
| TANDYCAT.EXE | 56865? | 13bc456aa15ce54456fba0618192ecaffc10536109488e5ff9366123844da321 |
| Alley Cat (1984).ba1 | 80 | stray ScummVM/Loom launcher, unrelated |

## Format / loader [static]
- MZ, header 0x200 bytes, 9 relocations, entry CS:IP = 0723:0000 (image-relative), SS:SP = 0000:0100.
- 16-bit real mode, hand-written assembly (no compiler runtime). Near CALLs, register arguments,
  flags (CF/ZF) used as return values. No overlays, no extender. Program needs only CAT.EXE.
- Ghidra loads the image at 1000:0000. DS = image+0x100 (segment 1010, paragraph-relocated),
  CS = image+0x7230 (segment 1723). So `CS:x == DS:(0x7130+x)`.
- Ghidra auto-analysis missed the code reached through the room jump table at CS:0250 and
  the INT 9 handlers; they were disassembled with `local/` scripts (≈8450 instructions).

## Machine dependence [static]
- `DS:0697` = byte at F000:FFFE (BIOS model ID). Branches compare with 0xFD (PCjr):
  `<0xFD` (AT, 0xFC — what DOSBox reports **[obs]**), `==0xFD` (PCjr), `>0xFD` (PC/XT 0xFF/0xFE).
- CS:5c60: INT 11h equipment check: requires a colour adapter (else prints error & hangs).

## Hardware touchpoints (environment contract)
- INT 1Ah AH=0: BIOS tick count (DX). Used everywhere for pacing.
- Port 3DAh bit 3 (vertical retrace) — CS:13d8 returns ZF=1 when NOT in retrace.
- PIT ch0 latched read (ports 43h/40h): CS:13b7 (timing), CS:2e10 (RNG seed; seed=(lo<<8)|hi, 0→FA59).
- INT 9 replaced by CS:14b3 (PC) / CS:14fb (PCjr). Scan-code table DS:06a1 (22 bytes) →
  key-state bytes DS:06b7.. (0x80 = up, 0x00 = down). DS:0693 counts make codes.
  CS:1572: Ctrl+Alt+Del style reboot path (not ported) and CRTC R2 horizontal adjust keys.
- Joystick port 201h (CS:122e) — only when DS:069b != 0 (joystick chosen).
- INT 10h: mode 4 (320x200x4), AH=0Bh palette/background, PCjr AX=1000h palette regs.
- Port 3D9h <- 0x20 (CGA colour select: palette 1).
- PC speaker: (to be documented)

## RNG [static]
CS:2dfd: `seed` = word DS:2ae5. t = (lo ^ hi) ; cf = bit1 of t; seed = (seed>>1) | cf<<15; returns DX=seed.

## Video helpers [static]
- CS:2cb0 xy→CGA offset: AX = y*40 (+0x1fd8 if y odd) + x>>2 ; CL = (x&3)*2.
- CS:2d35 AND-blit with background save to DS:[BP]; CX = rows<<8 | words.
- CS:2ccc OR/auto-mask blit with background save.
- CS:2d9d copy DS:SI → ES:DI rect (restore), CS:2dca copy screen → buffer, CS:2d70 linear copy with stride.

## Game structure [static]
- Room index word DS:0004 (0 = alley, 1..7 via jump table CS:0250). DS:0008 = skill level (0..3).
- Main entry loop CS:0000..049c; per-room loops call the per-frame routines.
- Cat state: x word DS:0579, y byte DS:057b, y+0x32 DS:057c, dir DS:056e, vertical DS:0571...
- Cat update CS:08e5 runs when BIOS tick changes, or every 32 calls within a tick (16 on PCjr).

## Static↔runtime address correspondence [obs]
DOSBox 0.84.0-vc1 (dosbox-automation build), `C:\CAT.EXE` launched from the shell:
PSP=0x01E5 → image=0x01F5, DS=image+0x10=0x0205, CS=image+0x723=0x0918.
Checked by bytes: live CS:0000..000F == file 0x7430.. except the relocated word at CS:0009
(0x1010→0x0205); live DS:06a1..06b6 (scan-code table) == file 0x9a1... All 9 relocations are
segment immediates inside CS (0009,0541,1125,13ed,14b8,1501,2ade,3a98,5c9f) — no data relocations.
Formula: file offset of DS:x = 0x300 + x; of CS:x = 0x7430 + x. Recheck if the launch path changes.
Live model byte DS:0697 = 0xFC. Example RNG seed DS:2ae5 after startup = 0x24EC (PIT-dependent).

## Reference emulator configuration [obs]
machine=svga_s3 (BIOS model 0xFC), cpu_cycles=3000 (fixed), core=auto, cputype=auto.
Mode 4 on a VGA machine runs at 70 Hz with VGA retrace timing (not 60 Hz CGA).

## Reference capture method (tools/dosbox/capture.mjs, capture-v2)
Environment values are recorded at their consumption points while the original runs:
- **BIOS ticks**: execute breakpoint on the IRET of DOSBox's INT 1Ah stub (F000:1265,
  `STI / callback / IRET`), condition `DX != last`; hit count = global read index.
  **[obs] Finding:** an earlier variant (interrupt breakpoint with condition on 0040:006C)
  races the timer IRQ: at read 6440 the game received the new tick while the capture
  logged the change at 6441. The replay caught it as a 6-byte DS divergence (mouse
  update + RNG). Testing the *returned* register removes the race.
- **Retrace**: execute breakpoint at CS:13dc (after `IN AL,DX`, the only 3DAh read),
  condition on AL ≥ 8 / < 8 alternately. **[obs]** DOSBox returns 4 or 5 here (bit 2
  always set, bit 0 display-enable); in ~7000 alley reads none fell into the 2-line VGA
  retrace window, consistent with its ~0.45 % duty cycle.
- **RNG seed**: CS:2e25 (AX before `MOV [2ae5],AX`).
- **Keys**: applied at sync points (loop heads that are yield points in the port) by
  writing the memory effects of the game's INT 9 handler (DS:0693 make counter,
  DS:06b7+i key state). DOSBox's own key injection is dispatched on its PIC clock after
  resuming, so it cannot be aligned with a sync point. **Conditional evidence:** reference
  runs therefore do not exercise the real INT 9 handler (CS:14b3); the port's translation of
  it is covered by unit/slice/browser checks only.
- **PIT-derived state**: other PIT ch0 reads are not recorded; in replay they come from the
  port's clock. They only time delay loops and set sound-only variables (DS:5a0e, 5a12,
  5a16-5a19, 5a3c-5a3f via CS:5a1c/5ac2). CS:5ac2 calls the RNG once per loop iteration
  whenever the PIT moved, which is every iteration at reference speed, so the RNG stays
  aligned. No DS exclusion has been needed so far.

Verified (**[reg]**, scenario boot-title-alley): title (attract mode, tune), menu
(data segment; VRAM excluded for BIOS-font text), alley for 3000 loop iterations with
walking and jumping: 34/34 checkpoints byte-identical in DS 0000-7130 and VRAM 0000-4000.

## Speed calibration [obs]/[approx]
- Free-running DOSBox (3000 cycles/ms, no breakpoints), alley with an idle cat: DS:040f
  (+1 per loop pass) sampled every ~2 ms against 0040:006C: **≈2066 passes per BIOS tick**
  (≈80 cycles per pass). A hand count of the original idle pass gives ≈76 instructions with
  INT 1Ah ≈4 (INT, STI, callback, IRET), i.e. DOSBox ≈ 1 cycle per instruction.
- During captures the same loop ran ≈7.8 passes per tick: conditional breakpoints evaluated
  on hot addresses distort DOSBox's emulated speed. Captures are therefore exact for
  replay (every environment value is recorded) but unusable for timing calibration.
- Port after correcting the hot-path charges (1338, 1200, 08e5 early exit, 1e63, loop
  overhead): **≈2143 passes per tick** (77.6 cycles). Within 4 % on this path; other paths
  remain approximate. Most game pacing is tick-gated and saturates well below these rates
  (cat: max 2 updates per tick after 32 calls; clothes lines/windows count loop calls but
  are capped by the tick), so the residual error mainly changes how often retrace-gated
  actions fire.

## Rooms [static], validated per room in scenarios/room-N.json
Jump table CS:0250 (index = DS:0004): 0/1 → room 1 (CS:03e2, loop head 03fa), 2 → 0459
(0478), 3 → 0394 (03b2), 4 → 0349 (0364), 5 → 02fe (0319), 6 → 02aa (02c5), 7 → 0260 (027e).
- Room choice CS:01e5: random table entry DS:0421+skill*4+(rnd&3) with probability depending
  on rnd&0xa0 (skill 3 always uses the 5-entry table DS:042d); never the same room three
  times in a row (DS:041d/041f). DS:0418 set → room 7 directly.
- Shared: transition wipe CS:1bf0/1c67, return sequences CS:1d76 (picture fade + tune; a
  life is lost when DS:0552 is set; dog bite CS:5be0 when DS:0552=DDh), CS:6040 after
  room 7, room backgrounds CS:2790, the room chaser CS:3150 (homes in on footprints that
  the walking cat leaves on 40 floor cells, CS:3445, and knocks the cat away, CS:0872).
- Goals: DS:0551 = reached the room's exit object, DS:0553 = room solved (score bonus via
  CS:38b0, room 7 via CS:528b/5313), DS:0552 = thrown out (life lost), DS:0554 = room 1
  hands over to room 2 (fish bowl).
- Room 2 (under water) runs its own cat physics CS:0953..0bab inside the cat update; the
  background colour (INT 10h AH=0Bh) signals the remaining air.
- Model-dependent waits in room 2 only run for model bytes ≥ 0xFD (not on the reference AT).
- Room 4's loop count at CS:3fee and room 6's at CS:4b47 come from tables (never 0 in the
  data); a 0 would hang the original, the port stops with a diagnostic instead.
- Random seed value 1 makes the shift register reach 0 and stay there; reject loops (e.g.
  CS:4277) would then never end, in the original as well. CS:2e10 only replaces a PIT value
  of 0, so a start-up PIT sample of 0001 (≈1/65536) reproduces this original hang; the
  port behaves identically (not guarded).

## Capture-time retrace window [obs]
Under capture every breakpoint stop ends DOSBox's 1 ms cycle slice, so reads of 3DAh land
at whole milliseconds after the VGA frame start. Evidence: bit 0 (display disabled) was set
in 65/400 samples ≈ 2 of the 14 whole-ms positions after display end (12.7 ms); the stock
retrace window 13.24–13.30 ms contains no whole millisecond, so retrace-wait loops (CS:3a1c,
CS:6040) never terminated. capture-v3 moves the window to lines 405–410 (12.87–13.03 ms)
via CRTC registers 10h/11h at the first sync point. Recorded per manifest
(`capture.environmentChanges`).

## Translation bug found by reference replay
CS:5be0 stores DX from the wait loop's last INT 1Ah (`MOV [5f66],DX`); the first translation
re-read the clock, shifting the tick-read alignment (room-exits checkpoint 16, DS:5a83/5a85).

## Speed calibration, round 2 [obs] (free-running DOSBox, no breakpoints)
| metric | DOSBox | port | note |
|---|---|---|---|
| alley passes per BIOS tick (idle cat, DS:040f) | 2088 | 2116 | +1.3 % |
| idle-cat redraws per tick (retrace-gated, DS:056d) | 0.993 | 1.000 | retrace gate retried every pass until it hits |
| title: attract-cat updates per moving tick (DS:056b) | 0.978 | 0.986 | travel per tick is RNG-dominated and unusable |
| port 3DAh bit 3 duty (3000 random REST samples) | 0.37 % | 0.45 % model | 2 of 449 lines; within sampling error |
Room loops: no pass counter exists and breakpoint counting distorts DOSBox, and walking
update rates in rooms are dominated by what the cat runs into (two DOSBox runs: 0.81 and
0.61 updates per moving tick; port 1.06). Room-loop speed therefore remains **[approx]**.

## TANDYCAT.EXE (Tandy 1000 edition) [static]/[obs]
- sha256 13bc456a…a321, 56881 bytes, MZ with no relocations, CS:IP = 0000:DB30 (a start-up
  stub after the data), SS:SP = FFF0:0100. Not packed.
- Live on DOSBox machine=tandy (model byte FFh) [obs]: PSP 0191h, CS = image base 01A1h,
  DS = 0815h = image + 6740h. Runs in BIOS mode 4 (CGA 320x200x4), like CAT.EXE.
- Code: a normalised diff of the two disassemblies (addresses/immediates masked) matches
  97.7 % of CAT.EXE's 8452 instructions in sequence. Differences: keyboard handler
  (CAT CS:147f..15c9), input poll (CS:1200..12c1), menu/joystick (CS:5d7b..600f), an added
  Tandy start-up stub, 4-instruction changes at CS:1936 and CS:221a, and six writes to the
  SN76496 sound chip (port C0h). Code offsets shift by +2B0h in the middle of the program.
- Data: 97 % of CAT's data bytes reappear in constant-shift runs (local/re/tandy_runs.json):
  +1 (0000-043f), +20h (06c6-0fed), +270h/+272h (0fed-37af), +280h (37af-6d37),
  +2C0h..+2C9h (6d63-7128). Gaps are Tandy-specific data (e.g. the scan-code table).
- Consequence for the port: the translated logic can be shared if DS address constants in
  the code are mapped per edition (pointers stored in data are already in the edition's own
  space and must not be mapped), plus translations of the Tandy-only routines.
- Reference: a second, isolated dosbox-automation instance with machine=tandy
  (local/dosbox-tandy/start.sh, port 8387) runs it; the managed instance stays svga_s3.
- Start-up stub (CS:DB30, DS = PSP so its stores are CS+100h) [obs, live diff of DOSBox
  machine=tandy memory against the file]: the Tandy BIOS signature (F000:C000 = 21h) is
  found, so it patches CS:158d into `CALL DC08` (Tandy 1000 arrow scan codes 2Bh/4Eh/29h/4Ah
  -> 4Bh/4Dh/48h/50h), stores model FFh at CS:0089/1fa5/5582 (immediates of the model
  tests), sets the sound-enable immediate at CS:61f4 to FFh and hooks INT 10h. The
  `OUT C0h` -> `INT C0h` rewrite (for a 1E0h sound port) does not run on a Tandy.
- INT 10h hook (CS:DBE1) [static]: AH=10h with BH<8 gets BH+8; AH=0Bh BH=0 (background)
  becomes AX=1000h (palette register 0) plus AX=1001h (border); AH=0Bh BH!=0 (palette
  select) is swallowed. The game sets Tandy palette registers itself.
- Timing [static]: CS:16e9 programs PIT ch0 with CFFFh (BIOS tick ~22.4 Hz) while sound
  plays, CS:16f0 restores 0 (65536). The alley pacing at CAT CS:1936 (a pass counter) becomes
  a tick-change test; CS:221a and CS:4b02 also change tick handling.
- Sound [static]: a three-voice SN76496 music player (CS:173e..1827, tables near DS:1228),
  mute at CS:1732 (9Fh/BFh/DFh/FFh to port C0h).
- Video [obs]: DOSBox reports CGA timing at 59.92 Hz for machine=tandy.
