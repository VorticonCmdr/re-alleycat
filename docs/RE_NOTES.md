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
