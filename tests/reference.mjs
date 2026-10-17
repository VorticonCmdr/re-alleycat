// Reference comparison (closed-loop replay): for every scenario manifest with a capture,
// replay the recorded environment stream into the port from the initial state and compare
// the data segment and VRAM byte-for-byte at every checkpoint.
//
// Fails on: missing/corrupt local capture (exit 2), zero scenarios or checkpoints,
// stream exhaustion, read-count misalignment, unconsumed events, any byte difference
// outside the manifest's documented comparison rules.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, LOCAL_DIR } from '../tools/lib/fixtures.mjs';
import { newGame } from './harness.mjs';
import { RecordedEnv, StreamError } from '../src/machine/replay.js';
import { keyboardInterrupt } from '../src/game/input.js';
import { keyBytes } from '../tools/dosbox/capture.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const only = process.argv.find((a) => a.startsWith('--scenario='))?.split('=')[1];
const MAX_STEPS = 200_000_000;

// Comparison rules: byte ranges (inclusive start, exclusive end) excluded from DS, with
// the reason recorded in the manifest. VRAM can be excluded per checkpoint for text screens.
function buildMask(rules) {
  const mask = new Uint8Array(0x7130).fill(1);
  for (const r of rules?.dsExclude || []) {
    for (let a = parseInt(r.from, 16); a < parseInt(r.to, 16); a++) mask[a] = 0;
  }
  return mask;
}

function diff(a, b, mask, limit = 12) {
  const out = [];
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    if (mask && !mask[i]) continue;
    if (a[i] !== b[i]) {
      n++;
      if (out.length < limit) out.push(`${i.toString(16).padStart(4, '0')}: port ${a[i].toString(16).padStart(2, '0')} ref ${b[i].toString(16).padStart(2, '0')}`);
    }
  }
  return { n, out };
}

function runScenario(manifest, { perturb = null, quiet = false } = {}) {
  const dir = join(LOCAL_DIR, 'captures', manifest.id);
  const streamPath = join(dir, 'stream.json');
  if (!existsSync(streamPath)) return { setup: `missing capture ${streamPath} (run tools/dosbox/capture.mjs)` };
  const buf = readFileSync(streamPath);
  if (sha(buf) !== manifest.capture.artifacts['stream.json']) return { setup: `capture ${streamPath} does not match the manifest checksum` };
  let stream = JSON.parse(buf);
  let events = manifest.events;
  if (perturb) {
    const p = perturb.apply(stream, events);
    stream = p.stream;
    events = p.events;
  }
  const env = new RecordedEnv(stream);
  env.schedule(events);
  const g = newGame({ rngSeed: stream.seed });
  g.replay = env;
  g.audioLog = [];
  const mask = buildMask(manifest.compare);
  const expected = manifest.capture.checkpoints;
  const failures = [];
  let cpIndex = 0;
  let steps = 0;
  try {
    while (cpIndex < expected.length) {
      if (++steps > MAX_STEPS) throw new StreamError('step budget exhausted before the last checkpoint');
      const site = g.step();
      if (g.exited) throw new StreamError('program exited before the last checkpoint');
      if (site === undefined) continue;
      for (const ev of env.sync(site)) {
        if (ev.type === 'key') {
          for (const b of keyBytes(ev.code, ev.down)) keyboardInterrupt(g, b);
        } else if (ev.type === 'poke') {
          const bytes = Buffer.from(ev.bytes, 'hex');
          for (let i = 0; i < bytes.length; i++) g.wb(parseInt(ev.addr, 16) + i, bytes[i]);
        } else if (ev.type === 'checkpoint') {
          const cp = expected[cpIndex];
          const label = `checkpoint ${cpIndex} @${ev.site}#${ev.count}`;
          if (cp.site !== ev.site || cp.count !== ev.count) throw new StreamError(`${label}: manifest order mismatch`);
          const align = env.tickReads === cp.tickReads && env.retraceReads === cp.retraceReads;
          const ds = g.mem.ds.subarray(0, 0x7130);
          const vram = g.mem.vram.subarray(0, 0x4000);
          const refDs = readFileSync(join(dir, `ds-${cpIndex}.bin`));
          const refVram = readFileSync(join(dir, `vram-${cpIndex}.bin`));
          if (sha(refDs) !== cp.ds || sha(refVram) !== cp.vram) return { setup: `${label}: local dump does not match manifest hash` };
          const dd = diff(ds, refDs, mask);
          const compareVram = !(ev.vram === false);
          const vd = compareVram ? diff(vram, refVram, null, 6) : { n: 0, out: [] };
          let audio = '';
          if (cp.speakerWrites !== undefined) {
            const ref = stream.speaker.slice(0, cp.speakerWrites);
            const port = g.audioLog;
            let k = 0;
            while (k < ref.length && k < port.length && ref[k][0] === port[k][0] && ref[k][1] === port[k][1]) k++;
            if (k !== ref.length || port.length !== ref.length) {
              const show = (e) => (e ? `${e[0].toString(16)}:${e[1].toString(16)}` : '-');
              audio = ` speaker writes differ at #${k} (port ${show(port[k])}, ref ${show(ref[k])}; counts ${port.length}/${ref.length})`;
            }
          }
          const ok = align && dd.n === 0 && vd.n === 0 && !audio;
          if (!quiet) console.log(`${ok ? 'PASS' : 'FAIL'}  ${manifest.id} ${label}` +
            `${align ? '' : ` read counts port ${env.tickReads}/${env.retraceReads} ref ${cp.tickReads}/${cp.retraceReads}`}` +
            `${dd.n ? ` DS ${dd.n} bytes differ [${dd.out.join(', ')}]` : ''}` +
            `${vd.n ? ` VRAM ${vd.n} bytes differ [${vd.out.join(', ')}]` : ''}` +
            `${compareVram ? '' : ' (VRAM excluded: text screen)'}${audio}`);
          if (!ok) failures.push(label);
          cpIndex++;
          if (!ok && !process.argv.includes('--all')) return { failures, checkpoints: cpIndex };
        }
      }
    }
  } catch (e) {
    if (e instanceof StreamError || e.name === 'UnsupportedPath') {
      failures.push(e.message);
      if (!quiet) console.log(`FAIL  ${manifest.id}: ${e.message} (tick reads ${env.tickReads}, retrace reads ${env.retraceReads})`);
      return { failures, checkpoints: cpIndex };
    }
    throw e;
  }
  const left = env.unconsumed();
  if (left.length) failures.push(`unconsumed events: ${left.join('; ')}`);
  return { failures, checkpoints: cpIndex };
}

const manifestArg = process.argv.find((a) => a.startsWith('--manifest='))?.split('=')[1];
const files = manifestArg ? [manifestArg] : readdirSync(join(ROOT, 'scenarios')).filter((f) => f.endsWith('.json')).map((f) => join(ROOT, 'scenarios', f));
let total = 0;
let bad = 0;
let ran = 0;
let controlsFailed = 0;
let setup = null;
for (const f of files) {
  const manifest = JSON.parse(readFileSync(f, 'utf8'));
  if (only && manifest.id !== only) continue;
  ran++;
  if (!manifest.capture) {
    console.log(`FAIL  ${manifest.id}: manifest has no capture section (scenario never captured)`);
    bad++;
    continue;
  }
  const r = runScenario(manifest);
  if (r.setup) {
    setup = r.setup;
    console.error(`SETUP FAILURE: ${r.setup}`);
    break;
  }
  total += r.checkpoints;
  if (r.failures.length || r.checkpoints !== manifest.capture.checkpoints.length) {
    bad++;
    for (const f2 of r.failures) console.log(`      ${f2}`);
    continue;
  }
  // Negative controls: the comparison must detect a removed input event and a tick
  // value delivered one read late.
  const keyIdx = manifest.events.findLastIndex((e) => e.type === 'key' && e.down);
  const controls = [
    { name: `drop key event ${manifest.events[keyIdx]?.code}@${manifest.events[keyIdx]?.site}#${manifest.events[keyIdx]?.count}`,
      apply: (st, ev) => ({ stream: st, events: ev.filter((_, i) => i !== keyIdx) }), usable: keyIdx >= 0 },
    { name: 'alter one recorded speaker write',
      apply: (st, ev) => {
        const speaker = st.speaker.map((w) => [...w]);
        const last = manifest.capture.checkpoints.at(-1).speakerWrites; // stay inside the compared range
        const k = Math.floor(last / 2);
        speaker[k][1] ^= 1;
        return { stream: { ...st, speaker }, events: ev };
      }, usable: (manifest.capture.checkpoints.at(-1)?.speakerWrites ?? 0) > 1 },
    { name: 'advance BIOS ticks by one from mid-scenario',
      apply: (st, ev) => {
        const lastRead = manifest.capture.checkpoints.at(-1).tickReads; // inside the compared range
        const inRange = st.ticks.filter((t) => t[0] < lastRead).length;
        const from = Math.floor(inRange / 2);
        const ticks = st.ticks.map((t, i) => (i >= from ? [t[0], (t[1] + 1) >>> 0] : [...t]));
        return { stream: { ...st, ticks }, events: ev };
      }, usable: true },
  ];
  for (const ctl of controls.filter((c) => c.usable)) {
    const nr = runScenario(manifest, { perturb: { apply: ctl.apply }, quiet: true });
    const detected = !!(nr.failures?.length);
    console.log(`${detected ? 'PASS' : 'FAIL'}  ${manifest.id} negative control detected: ${ctl.name}` +
      `${detected ? ` (${nr.failures[0].slice(0, 60)})` : ''}`);
    if (!detected) controlsFailed++;
  }
}
if (setup) process.exit(2);
console.log(`reference: ${ran - bad}/${ran} scenarios, ${total} checkpoints compared${controlsFailed ? `, ${controlsFailed} negative control(s) NOT detected` : ''}`);
if (controlsFailed || ran === 0 || total === 0 || bad) process.exit(1);
