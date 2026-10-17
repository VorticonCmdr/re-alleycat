#!/usr/bin/env node
// Required verification suite. Exits non-zero if any required check fails, if no checks
// ran, or if fixtures are missing/corrupt (setup failure = exit 2).
//
//   npm run verify                 all required checks
//   npm run verify -- --only=unit  run one group (unit | slice | reference | browser)
//   npm run verify -- --skip=browser
import { spawnSync } from 'node:child_process';
import { ROOT, loadCatExe, SetupError } from './lib/fixtures.mjs';

const argv = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const only = argv.only ? argv.only.split(',') : null;
const skip = argv.skip ? argv.skip.split(',') : [];

try {
  loadCatExe();
} catch (e) {
  if (e instanceof SetupError) {
    console.error(`SETUP FAILURE: ${e.message}`);
    process.exit(2);
  }
  throw e;
}

const groups = [
  { name: 'unit', cmd: ['node', 'tests/run-unit.mjs'] },
  { name: 'slice', cmd: ['node', 'tests/slice.mjs'] },
  { name: 'reference', cmd: ['node', 'tests/reference.mjs'] },
  { name: 'browser', cmd: ['node', 'tools/browser-check.mjs'] },
].filter((g) => (!only || only.includes(g.name)) && !skip.includes(g.name));

if (groups.length === 0) {
  console.error('no check groups selected');
  process.exit(1);
}

const results = [];
for (const g of groups) {
  console.log(`\n=== ${g.name} ===`);
  const r = spawnSync(g.cmd[0], g.cmd.slice(1), { cwd: ROOT, stdio: ['ignore', 'inherit', 'pipe'], encoding: 'utf8' });
  process.stderr.write(r.stderr || '');
  const setup = (r.stderr || '').match(/SETUP FAILURE: (.*)/);
  const status = r.status === 0 ? 'ok' : r.status === 2 ? 'SETUP' : 'FAILED';
  results.push({ name: g.name, status, why: setup ? setup[1] : r.status === 0 ? '' : `exit ${r.status}` });
  console.log(`=== ${g.name}: ${status} ===`);
}
console.log('\nsummary');
for (const r of results) console.log(`  ${r.name.padEnd(10)} ${r.status.padEnd(7)} ${r.why}`);
const failed = results.filter((r) => r.status === 'FAILED').length;
const setupFailed = results.filter((r) => r.status === 'SETUP').length;
console.log(`${results.length - failed - setupFailed}/${results.length} groups passed` +
  (setupFailed ? `; ${setupFailed} could not run (setup) — this is not a pass` : ''));
process.exit(failed ? 1 : setupFailed ? 2 : 0);
