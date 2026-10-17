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
// "hostkey" events instead press a real key in DOSBox while stopped at the sync point, so
// the game's own INT 9 handler runs: every scan-code byte it reads (CS:14bc) is recorded
// with its position and becomes a "scan" event that the replay feeds to the port's
// translated handler. A byte is only accepted when its exact position is known (see
// FIRST_READS_KEYS); anything else (e.g. a typematic repeat) aborts the capture.
//
// Output (local only, never committed): local/captures/<id>/{stream.json, ds-N.bin, vram-N.bin}
// The scenario manifest gets its "capture" section updated (hashes, counts, tool revision).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { DosBox } from './client.mjs';
import { loadCatExe, LOCAL_DIR, ROOT } from '../lib/fixtures.mjs';
import { SCANCODES } from '../../src/machine/keyboard.js';
import { policies } from '../bots/policies.mjs';

export const TOOL_REVISION = 'capture-v5';

// Speaker writes compared by the replay: every OUT 42h/61h site except the INT 9
// acknowledge pulse (14e9/14ed, bit 7 only) and the PIT-dependent hit sound / landing
// thud (5a83/5a87/5a8d, 5b04/5b08/5b0e). [CS offset, port]
export const SPEAKER_SITES = [[0x46e0, 0x42], [0x46e4, 0x42], [0x46ea, 0x61], [0x5306, 0x42], [0x530a, 0x42], [0x5310, 0x61], [0x53e9, 0x42], [0x53ed, 0x42], [0x53f3, 0x61], [0x56d6, 0x61], [0x572b, 0x61], [0x578a, 0x42], [0x578e, 0x42], [0x5794, 0x61], [0x57d2, 0x61], [0x5889, 0x42], [0x588d, 0x42], [0x5893, 0x61], [0x59b0, 0x42], [0x59b4, 0x42], [0x59ba, 0x61], [0x59cf, 0x61], [0x5a0f, 0x61], [0x5ab5, 0x42], [0x5ab9, 0x42], [0x5abf, 0x61], [0x5b25, 0x61], [0x5b2f, 0x42], [0x5b33, 0x42], [0x5b39, 0x61], [0x5b51, 0x61], [0x5bb2, 0x42], [0x5bb6, 0x42], [0x5bbc, 0x61], [0x609b, 0x42], [0x609f, 0x42], [0x60a5, 0x61], [0x60e0, 0x42], [0x60e4, 0x42]];
const sha = (b) => createHash('sha256').update(b).digest('hex');

const EXPECT_PSP = 0x01e5;
const DS = EXPECT_PSP + 0x20;
const CS = EXPECT_PSP + 0x733;
const KEYTAB = 0x6a1;

// Sync sites whose first instruction is CMP AX,[0693] in a two-instruction wait loop. A key
// injected at such a stop is taken after that CMP, so the game first sees it on the next
// pass: the byte is placed at count + 1. At every other site the first instruction does
// not read keyboard state (SUB AH,AH / MOV DX / CALL 1338 / CMP [1f80]): placed at count.
const FIRST_READS_KEYS = new Set([0x5ef7, 0x5f29, 0x5faa, 0x6007]);
const FIRST_LEN = { 0x0155: 5, 0x5d71: 2, 0x5ef7: 4, 0x5f29: 4, 0x5faa: 4, 0x6007: 4, 0x5f9e: 3, 0x03fa: 3, 0x0478: 3, 0x03b2: 3, 0x0364: 3, 0x0319: 3, 0x02c5: 3, 0x027e: 3 };
const INT9_AFTER_IN = 0x14be; // after IN AL,60h; AX ES DI CX pushed

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
// CAT is considered running while INT 9 points into its code segment (status.program is
// not reliable across emulator restarts).
async function catHooked(d) {
  const v = await d.readLinear(9 * 4, 4);
  return v.readUInt16LE(2) === CS;
}

export async function forceExit(d) {
  if (!(await catHooked(d))) return;
  let p = await d.pause();
  await d.clearBreakpoints();
  let regs = p.stop?.registers || (await d.regs()).registers || (await d.regs());
  if (regs.cs !== CS) {
    // somewhere in a BIOS/DOS handler: run on to a loop head that every game state reaches
    for (const off of [0x0155, 0x5d71, 0x5ef7, 0x5f29, 0x5faa, 0x03fa, 0x0478, 0x03b2, 0x0364, 0x0319, 0x02c5, 0x027e, 0x13d8]) {
      await d.addBreakpoint({ type: 'execute', segment: CS, offset: off, once: true });
    }
    const since = await resume(d);
    const w = await waitStop(d, since, 30000);
    regs = w.registers;
    await d.clearBreakpoints();
  }
  if (regs.cs !== CS) throw new Error(`running CAT has CS=${regs.cs.toString(16)}, expected ${CS.toString(16)}`);
  const saved = await d.read(CS, 0x13df, 4);
  await d.req('PUT', '/api/v1/memory/0/36', { data: saved.toString('base64') });
  const patch = Buffer.from([0xb8, 0x00, 0x4c, 0xcd, 0x21]);
  await d.req('PUT', `/api/v1/memory/${CS}/${regs.eip}`, { data: patch.toString('base64') });
  await d.clearBreakpoints();
  await d.cont();
  for (let i = 0; i < 50; i++) {
    if (!(await catHooked(d))) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('CAT did not exit');
}

export async function launch(d, exe) {
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
  manifest.events = manifest.events.filter((e) => e.type !== 'scan'); // outputs of an earlier capture
  for (const ev of manifest.events) add(ev.site, ev.count, ev);
  for (const list of plan.values()) list.sort((a, b) => a.count - b.count);
  // Play policy: a recurring pseudo-event; the keys it presses are logged as key events.
  const policy = manifest.policy ? policies[manifest.policy.name] : null;
  if (manifest.policy && !policy) throw new Error(`unknown policy ${manifest.policy.name}`);
  const policyState = { held: new Set(), scratch: {}, log: [] };
  const insert = (siteHex, count, action) => {
    const key = parseInt(siteHex, 16);
    const list = plan.get(key);
    let e = list.find((x) => x.count === count);
    const fresh = !e;
    if (!e) {
      list.push((e = { count, actions: [] }));
      list.sort((a, b) => a.count - b.count);
    }
    e.actions.push(action);
    return fresh;
  };
  if (policy) add(manifest.policy.site, manifest.policy.start, { type: 'policy', site: manifest.policy.site, count: manifest.policy.start });
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
  const speakerBps = new Map();
  for (const [off, port] of SPEAKER_SITES) {
    speakerBps.set((await d.addBreakpoint({ type: 'execute', segment: CS, offset: off })).id, port);
  }
  const speaker = [];
  for (const site of plan.keys()) await armSync(site);
  const hostKeys = manifest.events.some((e) => e.type === 'hostkey');
  const int9Bp = hostKeys ? (await d.addBreakpoint({ type: 'execute', segment: CS, offset: INT9_AFTER_IN })).id : null;
  let pendingHost = null; // {event, countBp}
  const scans = [];
  const ignoredScans = [];
  const keyTable = [...exe.subarray(0x300 + KEYTAB, 0x300 + KEYTAB + 22)];

  const checkpoints = [];
  const applied = [];
  let remaining = [...plan.values()].reduce((n, l) => n + l.length, 0);
  // Budget in BIOS ticks after the first recorded tick: scenarios whose later events are
  // never reached (e.g. the cat leaves a room early) end here and are trimmed.
  const budget = manifest.maxTicks ?? 3000;
  const idleBudget = manifest.maxIdleTicks ?? 900; // ticks without any scenario event
  let firstTick = null;
  let lastEventTick = null;
  let truncated = false;
  let finishedByFinal = false;
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
        if (lastEventTick === null) lastEventTick = v;
        if (v - firstTick > budget || v - lastEventTick > idleBudget) {
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
    } else if (speakerBps.has(id)) {
      const port = speakerBps.get(id);
      speaker.push([port, port === 0x61 ? r.eax & 3 : r.eax & 0xff]);
    } else if (id !== null && id === int9Bp) {
      const byte = r.eax & 0xff;
      const stk = await d.read(r.ss, (r.esp + 8) & 0xffff, 4);
      const ip = stk.readUInt16LE(0);
      const cs = stk.readUInt16LE(2);
      if (!pendingHost && byte & 0x80 && !keyTable.includes(byte & 0x7f)) {
        // release of an untracked key (the Enter that launched CAT): no counter, no table
        // write; recorded for the manifest
        ignoredScans.push({ byte: byte.toString(16), at: `${cs.toString(16)}:${ip.toString(16)}` });
        since = await resume(d);
        continue;
      }
      if (!pendingHost) throw new Error(`unsolicited INT 9 byte ${byte.toString(16)} at ${cs.toString(16)}:${ip.toString(16)} (typematic repeat?)`);
      const e = pendingHost.event;
      const site = parseInt(e.site, 16);
      const passes = await hitsOf(pendingHost.countBp);
      if (cs !== CS || ip !== site + FIRST_LEN[site] || passes !== 0) {
        throw new Error(`INT 9 byte ${byte.toString(16)} for ${e.key} at ${cs.toString(16)}:${ip.toString(16)}, ${passes} passes after ${e.site}#${e.count}: position not exact`);
      }
      const count = e.count + (FIRST_READS_KEYS.has(site) ? 1 : 0);
      scans.push({ type: 'scan', site: e.site, count, byte: byte.toString(16).padStart(2, '0'), from: `${e.key} ${e.down ? 'down' : 'up'} @${e.site}#${e.count}` });
      await d.req('DELETE', '/api/v1/debug/breakpoints', { id: pendingHost.countBp });
      pendingHost = null;
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
      lastEventTick = st.tickLast;
      if (pendingHost) throw new Error(`no INT 9 for ${pendingHost.event.key} @${pendingHost.event.site}#${pendingHost.event.count} before the next sync stop`);
      for (const a of entry.actions) {
        a.done = true;
        if (a.type === 'hostkey') {
          if (pendingHost) throw new Error('two host keys at one sync point');
          const rs = await d.replayStatus();
          if (rs.active) throw new Error('DOSBox input replay still active');
          await d.sequence([{ type: 'key', key: a.key, pressed: a.down }]);
          // counts executions of the site's second instruction: 0 when the IRQ is taken
          // right after the first one (a sync breakpoint already occupies the site itself)
          pendingHost = { event: a, countBp: (await d.addBreakpoint({ type: 'execute', segment: CS, offset: site + FIRST_LEN[site], ignore_count: 0x7fffffff })).id };
          applied.push({ site: a.site, count: a.count, hostkey: a.key, down: a.down });
        } else if (a.type === 'key') {
          for (const b of keyBytes(a.code, a.down)) await applyKeyByte(d, b);
          applied.push({ site: a.site, count: a.count, code: a.code, down: a.down });
        } else if (a.type === 'policy') {
          const ds = await d.read(DS, 0, 0x7130);
          const mem = { rb: (x) => ds[x & 0xffff], rw: (x) => ds[x & 0xffff] | (ds[(x + 1) & 0xffff] << 8), scratch: policyState.scratch };
          const want = policy(mem);
          for (const k of [...policyState.held]) {
            if (want.has(k)) continue;
            for (const b of keyBytes(k, false)) await applyKeyByte(d, b);
            policyState.held.delete(k);
            policyState.log.push({ type: 'key', site: a.site, count: a.count, code: k, down: false, by: manifest.policy.name });
          }
          for (const k of want) {
            if (policyState.held.has(k)) continue;
            for (const b of keyBytes(k, true)) await applyKeyByte(d, b);
            policyState.held.add(k);
            policyState.log.push({ type: 'key', site: a.site, count: a.count, code: k, down: true, by: manifest.policy.name });
          }
          if (insert(a.site, a.count + manifest.policy.every, { type: 'policy', site: a.site, count: a.count + manifest.policy.every })) remaining++;
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
          checkpoints.push({ site: a.site, count: a.count, tickReads, retraceReads: retrReads, speakerWrites: speaker.length, ds: sha(ds), vram: sha(vram) });
          log(`checkpoint ${n} @${a.site}#${a.count} ticks=${tickReads} retrace=${retrReads}`);
        }
      }
      s.next++;
      remaining--;
      if (entry.actions.some((a) => a.type === 'checkpoint' && a.final)) {
        finishedByFinal = true;
        break;
      }
      await armSync(site);
    }
    since = await resume(d);
  }
  await d.pause();
  await d.clearBreakpoints();
  if (truncated || finishedByFinal || policy) {
    const before = manifest.events.length;
    manifest.events = manifest.events.filter((e) => e.done);
    if (policy) {
      // the logged policy inputs become ordinary key events (independent input stream)
      // appended after the planned events: within one sync point, planned actions ran first
      manifest.events.push(...policyState.log);
    }
    if (truncated) manifest.truncated = { reason: `tick budget exhausted (total ${budget}, idle ${idleBudget})`, droppedEvents: before - manifest.events.length };
    if (finishedByFinal) manifest.endedBy = 'final checkpoint';
    log(`kept ${manifest.events.length} events (${policyState.log.length} from the policy)`);
  }
  for (const e of manifest.events) delete e.done;
  if (pendingHost) throw new Error(`capture ended with ${pendingHost.event.key} undelivered`);
  manifest.events.push(...scans);
  const stream = {
    format: 1,
    scenario: manifest.id,
    tool: TOOL_REVISION,
    seed: st.seed,
    ticks: st.ticks,
    tickSets: st.setCalls,
    speaker,
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
    speakerWrites: speaker.length,
    ...(hostKeys ? { int9Bytes: scans.length, ignoredInt9: ignoredScans.map((x) => `${x.byte} at ${x.at}: release of an untracked key, no state change`) } : {}),
    checkpoints: checkpoints.map(({ site, count, tickReads, retraceReads, speakerWrites, ds, vram }) => ({ site, count, tickReads, retraceReads, speakerWrites, ds, vram })),
    artifacts: { 'stream.json': sha(streamBuf) },
    environmentChanges: st.retraceMoved ? [`CRTC vertical retrace moved from lines ${st.retraceMoved.from.join('-')} to ${st.retraceMoved.to.join('-')} at the first sync point (capture-only; values are recorded)`] : [],
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  log(`done: ${stops} stops, ${checkpoints.length} checkpoints, ${st.ticks.length} tick changes, ${st.retrace.length} retrace edges`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (e) => {
    console.error(e.stack || e.message);
    // leave the emulator at the shell with the BIOS keyboard handler restored
    await forceExit(new DosBox()).catch((x) => console.error('warning: exit failed', x.message));
    process.exit(1);
  });
}
void ROOT;
