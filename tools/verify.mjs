#!/usr/bin/env node
// Required verification suite. Exits non-zero if any required check fails, if no checks
// ran, or if fixtures are missing/corrupt (setup failure = exit 2).
//
//   npm run verify                 all required checks
//   npm run verify -- --only=unit  run one group (unit | slice | browser)
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
  { name: 'browser', cmd: ['node', 'tools/browser-check.mjs'] },
].filter((g) => (!only || only.includes(g.name)) && !skip.includes(g.name));

if (groups.length === 0) {
  console.error('no check groups selected');
  process.exit(1);
}

let failed = 0;
for (const g of groups) {
  console.log(`\n=== ${g.name} ===`);
  const r = spawnSync(g.cmd[0], g.cmd.slice(1), { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) {
    failed++;
    console.log(`=== ${g.name}: FAILED (exit ${r.status}) ===`);
    if (r.status === 2) {
      console.error('setup failure inside a check group');
      process.exit(2);
    }
  } else console.log(`=== ${g.name}: ok ===`);
}
console.log(`\n${groups.length - failed}/${groups.length} groups passed`);
process.exit(failed ? 1 : 0);
