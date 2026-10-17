#!/usr/bin/env node
// Capture a reference scenario from the original game running in DOSBox.
//
//   node tools/dosbox/capture.mjs scenarios/<id>.json
//
// Records, at their consumption points, every environment value the game reads that
// influences its state, plus state checkpoints at sync points:
//   * INT 1Ah AH=0 results (BIOS ticks): an interrupt breakpoint whose condition is
//     "tick word at 0040:006C != last value" stops only when the value changes; the
//     breakpoint hit count gives the global read index. Stream: [readIndex, value].
//   * Port 3DAh bit 3 at CS:13dc (the only retrace read): same scheme on AL.
//   * The RNG seed read from PIT ch0 at CS:2e25 (AX).
//   * Sync points: loop heads that are also yield points in the port. Execute
//     breakpoints with ignore_count stop at the scenario's iteration counts; there the
//     scenario's key events are applied and DS/VRAM checkpoints are dumped.
// Keys are applied by writing the memory effects of the game's own INT 9 handler
// (CS:14b3): make counter DS:0693 and the key-state byte for tracked keys. This keeps
// key timing exact at the sync point (DOSBox's own keyboard dispatch is PIC-timed).
//
// Output (local only, never committed): local/captures/<id>/{stream.json, ds-N.bin, vram-N.bin}
// The scenario manifest gets its "capture" section updated (hashes, counts, tool revision).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { DosBox } from './client.mjs';
import { loadCatExe, LOCAL_DIR, ROOT } from '../lib/fixtures.mjs';
import { SCANCODES } from '../../src/machine/keyboard.js';

export const TOOL_REVISION = 'capture-v4';
const sha = (b) => createHash('sha256').update(b).digest('hex');

const EXPECT_PSP = 0x01e5;
const DS = EXPECT_PSP + 0x20;
const CS = EXPECT_PSP + 0x733;
const KEYTAB = 0x6a1;

function log(...a) {
  console.log(...a);
}

async function waitStop(d, since, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const w = await d.wait(since, Math.min(15000, Math.max(1, end - Date.now())));
    if (w.satisfied) return w;
    if (Date.now() >= end) throw new Error(`no debugger stop within ${timeoutMs} ms (last: ${w.reason})`);
  }
}

async function resume(d) {
  const r = await d.cont();
  return r.resumed_from_stop_id ?? r.stop_id ?? 0;
}

// Leave the game: restore the BIOS INT 9 vector the game saved at CS:13df, then run
// MOV AX,4C00h / INT 21h at the current instruction.
async function forceExit(d) {
  const st = await d.status();
  if (!/CAT/i.test(st.program || '')) return;
  const p = await d.pause();
  let regs = p.stop?.registers || (await d.regs()).registers || (await d.regs());
  // paused inside a BIOS/DOS handler: single-step until execution is back in the game
  for (let i = 0; i < 20000 && regs.cs !== CS; i++) {
    const s = await d.step(64);
    regs = (s.stop || s).registers || s.registers;
  }
  if (regs.cs !== CS) throw new Error(`running CAT has CS=${regs.cs.toString(16)}, expected ${CS.toString(16)}`);
  const saved = await d.read(CS, 0x13df, 4);
  await d.req('PUT', '/api/v1/memory/0/36', { data: saved.toString('base64') });
  const patch = Buffer.from([0xb8, 0x00, 0x4c, 0xcd, 0x21]);
  await d.req('PUT', `/api/v1/memory/${CS}/${regs.eip}`, { data: patch.toString('base64') });
  await d.clearBreakpoints();
  await d.cont();
  for (let i = 0; i < 50; i++) {
    const s = await d.status();
    if (!/CAT/i.test(s.program || '') || s.is_shell) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('CAT did not exit');
}

async function launch(d, exe) {
  await d.clearBreakpoints();
  const rs = await d.replayStatus().catch(() => null);
  if (rs && rs.active) await d.req('DELETE', '/api/v1/input/replay');
  await d.type('\n', 30); // flush any partial command line (the type endpoint maps \n to Enter)
  await new Promise((r) => setTimeout(r, 600));
  await d.pause();
  await d.addBreakpoint({ type: 'execute', segment: CS, offset: 0, once: true });
  const since = await resume(d);
  await d.type('CAT\n', 30);
  const w = await waitStop(d, since, 20000);
  const r = w.registers;
  if (r.cs !== CS || r.eip !== 0) throw new Error(`entry stop at ${r.cs.toString(16)}:${r.eip.toString(16)}`);
  // byte-level identity of the loaded image
  const code = await d.read(CS, 0, 0x40);
  const file = exe.subarray(0x7430, 0x7470);
  for (let i = 0; i < 0x40; i++) {
    if (i === 9 || i === 10) continue; // relocated segment immediate
    if (code[i] !== file[i]) throw new Error(`CS:${i.toString(16)} differs from file`);
  }
  const tab = await d.read(DS, KEYTAB, 22);
  if (!tab.equals(Buffer.from(exe.subarray(0x300 + KEYTAB, 0x300 + KEYTAB + 22)))) throw new Error('DS:06a1 differs');
  return w.stop_id;
}

// Apply the INT 9 handler's memory effects for one scan-code byte.
async function applyKeyByte(d, byte) {
  const cnt = (await d.read(DS, 0x693, 2)).readUInt16LE(0);
  if (!(byte & 0x80)) {
    const b = Buffer.alloc(2);
    b.writeUInt16LE((cnt + 1) & 0xffff);
    await d.req('PUT', `/api/v1/memory/${DS}/${0x693}`, { data: b.toString('base64') });
  }
  const tab = await d.read(DS, KEYTAB, 22);
  const i = tab.indexOf(byte & 0x7f);
  if (i >= 0) await d.req('PUT', `/api/v1/memory/${DS}/${0x6b7 + i}`, { data: Buffer.from([byte & 0x80]).toString('base64') });
}

async function crtc(d, index, value) {
  await d.req('PUT', '/api/v1/io/port', { port: 0x3d4, value: index, width: 1 });
  if (value === undefined) return (await d.req('GET', '/api/v1/io/port?port=981&width=1')).value;
  await d.req('PUT', '/api/v1/io/port', { port: 0x3d5, value, width: 1 });
  return value;
}

async function moveRetraceWindow(d) {
  const r10 = await crtc(d, 0x10);
  const r11 = await crtc(d, 0x11);
  const r07 = await crtc(d, 0x07);
  const vrs = r10 | ((r07 & 0x04) << 6) | ((r07 & 0x80) << 2);
  if (vrs !== 412 || (r11 & 0x0f) !== 0x0e) throw new Error(`unexpected CRTC retrace setup VRS=${vrs} VRE=${r11 & 15}`);
  await crtc(d, 0x10, 405 & 0xff);
  await crtc(d, 0x11, (r11 & 0xf0) | 0x0a);
  return { from: [412, 414], to: [405, 410] };
}

export function keyBytes(code, down) {
  const sc = SCANCODES[code];
  if (!sc) throw new Error(`unknown key ${code}`);
  const b = down ? sc[0] : sc[0] | 0x80;
  return sc[1] ? [0xe0, b] : [b];
}

async function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) throw new Error('usage: capture.mjs scenarios/<id>.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const exe = loadCatExe();
  const outDir = join(LOCAL_DIR, 'captures', manifest.id);
  mkdirSync(outDir, { recursive: true });
  const d = new DosBox();
  const info = await d.info();

  // ---- the plan: sorted per site
  const plan = new Map(); // site -> [{count, actions:[]}] ascending
  const add = (site, count, action) => {
    const key = parseInt(site, 16);
    if (!plan.has(key)) plan.set(key, []);
    const list = plan.get(key);
    let e = list.find((x) => x.count === count);
    if (!e) list.push((e = { count, actions: [] }));
    e.actions.push(action);
  };
  for (const ev of manifest.events) add(ev.site, ev.count, ev);
  for (const list of plan.values()) list.sort((a, b) => a.count - b.count);

  await forceExit(d);
  let since = await launch(d, exe);
  log('launched CAT, entry stop', since);

  // ---- breakpoints
  const vec = await d.readLinear(0x1a * 4, 4);
  const int1a = { seg: vec.readUInt16LE(2), iret: vec.readUInt16LE(0) + 5 };
  const stub = await d.read(int1a.seg, int1a.iret - 5, 6);
  if (stub[0] !== 0xfb || stub[1] !== 0xfe || stub[2] !== 0x38 || stub[5] !== 0xcf) {
    throw new Error(`unexpected INT 1Ah handler stub ${stub.toString('hex')}`);
  }
  const st = {
    int1a, setBp: null, setCalls: [],
    tickBp: null, tickCum: 0, tickLast: null, ticks: [],
    retrBp: null, retrCum: 0, retrLast: 0, retrace: [],
    seed: null,
    sync: new Map(), // site -> {bp, cum, nextIdx}
  };
  async function armTick() {
    if (st.tickBp) {
      const l = await d.listBreakpoints();
      const b = (l.breakpoints || l).find((x) => x.id === st.tickBp);
      st.tickCum += b ? b.hit_count : 0;
      await d.req('DELETE', '/api/v1/debug/breakpoints', { id: st.tickBp });
    }
    // Stop at the IRET of the BIOS INT 1Ah stub when the *returned* DX differs from the
    // last recorded value. (Testing 0040:006C before the INT races the timer IRQ.)
    const cond = { register: 'dx', op: 'ne', value: st.tickLast === null ? 0x10000 : st.tickLast & 0xffff };
    st.tickBp = (await d.addBreakpoint({ type: 'execute', segment: st.int1a.seg, offset: st.int1a.iret, condition: cond })).id;
  }
  async function armRetrace() {
    if (st.retrBp) {
      const l = await d.listBreakpoints();
      const b = (l.breakpoints || l).find((x) => x.id === st.retrBp);
      st.retrCum += b ? b.hit_count : 0;
      await d.req('DELETE', '/api/v1/debug/breakpoints', { id: st.retrBp });
    }
    const cond = { register: 'al', op: st.retrLast ? 'lt' : 'ge', value: 8 };
    st.retrBp = (await d.addBreakpoint({ type: 'execute', segment: CS, offset: 0x13dc, condition: cond })).id;
  }
  async function armSync(site) {
    const s = st.sync.get(site) || { bp: null, cum: 0, next: 0 };
    st.sync.set(site, s);
    if (s.bp) {
      const l = await d.listBreakpoints();
      const b = (l.breakpoints || l).find((x) => x.id === s.bp);
      s.cum += b ? b.hit_count : 0;
      await d.req('DELETE', '/api/v1/debug/breakpoints', { id: s.bp });
      s.bp = null;
    }
    const list = plan.get(site);
    if (s.next >= list.length) return;
    const target = list[s.next].count; // 1-based hit number to stop at
    const ignore = target - s.cum - 1;
    if (ignore < 0) throw new Error(`site ${site.toString(16)}: target ${target} already passed (${s.cum})`);
    s.bp = (await d.addBreakpoint({ type: 'execute', segment: CS, offset: site, ignore_count: ignore })).id;
  }
  async function hitsOf(id) {
    const l = await d.listBreakpoints();
    const b = (l.breakpoints || l).find((x) => x.id === id);
    return b ? b.hit_count : 0;
  }

  await armTick();
  st.setBp = (await d.addBreakpoint({ type: 'interrupt', int: 0x1a, ah: 1 })).id;
  await armRetrace();
  const seedBp = (await d.addBreakpoint({ type: 'execute', segment: CS, offset: 0x2e25, once: true })).id;
  for (const site of plan.keys()) await armSync(site);

  const checkpoints = [];
  const applied = [];
  let remaining = [...plan.values()].reduce((n, l) => n + l.length, 0);
  // Budget in BIOS ticks after the first recorded tick: scenarios whose later events are
  // never reached (e.g. the cat leaves a room early) end here and are trimmed.
  const budget = manifest.maxTicks ?? 3000;
  let firstTick = null;
  let truncated = false;
  let stops = 0;
  const t0 = Date.now();
  since = await resume(d);
  while (remaining > 0) {
    const w = await waitStop(d, since, 60000);
    stops++;
    const id = w.breakpoint?.id;
    const r = w.registers;
    if (id === st.tickBp) {
      // AH is preserved by the handler: AH=1 (set time) passes here too and is not a read
      const ah = (r.eax >> 8) & 0xff;
      const idx = st.tickCum + (await hitsOf(id)) - 1 - st.setCalls.length;
      if (ah === 0) {
        const v = (((r.ecx & 0xffff) << 16) | (r.edx & 0xffff)) >>> 0;
        if (st.tickLast === null || (v & 0xffff) !== (st.tickLast & 0xffff)) st.ticks.push([idx, v]);
        st.tickLast = v;
        if (firstTick === null) firstTick = v;
        if (v - firstTick > budget) {
          truncated = true;
          break;
        }
      }
      await armTick();
    } else if (id === st.setBp) {
      st.setCalls.push({ readIndex: st.tickCum + (await hitsOf(st.tickBp)) - st.setCalls.length, cx: r.ecx & 0xffff, dx: r.edx & 0xffff });
      st.tickLast = null;
    } else if (id === st.retrBp) {
      const bit = r.eax & 8 ? 1 : 0;
      const idx = st.retrCum + (await hitsOf(id)) - 1;
      if (bit !== st.retrLast || st.retrace.length === 0) st.retrace.push([idx, bit]);
      st.retrLast = bit;
      await armRetrace();
    } else if (id === seedBp) {
      st.seed = r.eax & 0xffff;
    } else {
      const site = [...st.sync.entries()].find(([, s]) => s.bp === id)?.[0];
      if (site === undefined) throw new Error(`unexpected stop ${JSON.stringify(w).slice(0, 300)}`);
      const s = st.sync.get(site);
      const entry = plan.get(site)[s.next];
      const hits = s.cum + (await hitsOf(id));
      if (hits !== entry.count) throw new Error(`site ${site.toString(16)} stopped at ${hits}, expected ${entry.count}`);
      if (!st.retraceMoved) {
        // Breakpoint stops quantise emulated time to 1 ms slices, so retrace reads land at
        // whole milliseconds after frame start and never inside the stock window (lines
        // 412..414 = 13.24..13.30 ms). Move it to lines 405..410 (12.87..13.03 ms). This only
        // changes an environment value; every value the game reads is recorded.
        st.retraceMoved = await moveRetraceWindow(d);
      }
      const tickReads = st.tickCum + (await hitsOf(st.tickBp)) - st.setCalls.length; // AH=1 calls pass the IRET too
      const retrReads = st.retrCum + (await hitsOf(st.retrBp));
      for (const a of entry.actions) {
        a.done = true;
        if (a.type === 'key') {
          for (const b of keyBytes(a.code, a.down)) await applyKeyByte(d, b);
          applied.push({ site: a.site, count: a.count, code: a.code, down: a.down });
        } else if (a.type === 'poke') {
          // state injection (conditional evidence): same bytes are written in the replay
          const bytes = Buffer.from(a.bytes, 'hex');
          await d.req('PUT', `/api/v1/memory/${DS}/${parseInt(a.addr, 16)}`, { data: bytes.toString('base64') });
          applied.push({ site: a.site, count: a.count, poke: a.addr, bytes: a.bytes });
        } else if (a.type === 'checkpoint') {
          const ds = await d.read(DS, 0, 0x7130);
          const vram = await d.read(0xb800, 0, 0x4000);
          const n = checkpoints.length;
          writeFileSync(join(outDir, `ds-${n}.bin`), ds);
          writeFileSync(join(outDir, `vram-${n}.bin`), vram);
          checkpoints.push({ site: a.site, count: a.count, tickReads, retraceReads: retrReads, ds: sha(ds), vram: sha(vram) });
          log(`checkpoint ${n} @${a.site}#${a.count} ticks=${tickReads} retrace=${retrReads}`);
        }
      }
      s.next++;
      remaining--;
      await armSync(site);
    }
    since = await resume(d);
  }
  await d.pause();
  await d.clearBreakpoints();
  if (truncated) {
    const before = manifest.events.length;
    manifest.events = manifest.events.filter((e) => e.done);
    manifest.truncated = { reason: `tick budget ${budget} exhausted`, droppedEvents: before - manifest.events.length };
    log(`budget exhausted: kept ${manifest.events.length} of ${before} events`);
  }
  for (const e of manifest.events) delete e.done;
  const stream = {
    format: 1,
    scenario: manifest.id,
    tool: TOOL_REVISION,
    seed: st.seed,
    ticks: st.ticks,
    tickSets: st.setCalls,
    retrace: st.retrace,
    checkpoints,
    applied,
  };
  const streamBuf = Buffer.from(JSON.stringify(stream));
  writeFileSync(join(outDir, 'stream.json'), streamBuf);
  await forceExit(d).catch((e) => log('warning: exit failed', e.message));

  manifest.capture = {
    tool: TOOL_REVISION,
    emulator: info.version || info.name,
    date: new Date().toISOString().slice(0, 10),
    stops,
    seconds: Math.round((Date.now() - t0) / 1000),
    seed: st.seed,
    tickChanges: st.ticks.length,
    retraceEdges: st.retrace.length,
    checkpoints: checkpoints.map(({ site, count, tickReads, retraceReads, ds, vram }) => ({ site, count, tickReads, retraceReads, ds, vram })),
    artifacts: { 'stream.json': sha(streamBuf) },
    environmentChanges: st.retraceMoved ? [`CRTC vertical retrace moved from lines ${st.retraceMoved.from.join('-')} to ${st.retraceMoved.to.join('-')} at the first sync point (capture-only; values are recorded)`] : [],
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  log(`done: ${stops} stops, ${checkpoints.length} checkpoints, ${st.ticks.length} tick changes, ${st.retrace.length} retrace edges`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e.stack || e.message);
    process.exit(1);
  });
}
void ROOT;
