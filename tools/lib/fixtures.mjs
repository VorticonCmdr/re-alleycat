// Locating and validating the user's original files (never part of the repository).
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const GAME_DIR = process.env.ALLEYCAT_GAME_DIR || join(ROOT, 'game');
export const LOCAL_DIR = join(ROOT, 'local');

export const CAT_EXE_SHA256 = '4979c8867826e08881d1d4bec95c95d6bc1ac70fd21050ccdb4f733a50d7bfdd';

export class SetupError extends Error {}

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

// Returns the bytes of CAT.EXE; throws SetupError if missing or not the expected file.
export function loadCatExe() {
  const path = join(GAME_DIR, 'CAT.EXE');
  if (!existsSync(path)) {
    throw new SetupError(`missing original file ${path} (set ALLEYCAT_GAME_DIR or copy CAT.EXE into game/)`);
  }
  const bytes = new Uint8Array(readFileSync(path));
  const h = sha256(bytes);
  if (h !== CAT_EXE_SHA256) throw new SetupError(`${path} has sha256 ${h}, expected ${CAT_EXE_SHA256}`);
  return bytes;
}

export function localPath(...parts) {
  const p = join(LOCAL_DIR, ...parts);
  mkdirSync(dirname(p), { recursive: true });
  return p;
}
