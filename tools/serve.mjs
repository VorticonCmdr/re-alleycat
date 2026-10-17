#!/usr/bin/env node
// Static development server (localhost only). Serves the repository; /game/ maps to the
// local original files so tests can use ?exe=/game/CAT.EXE. Nothing here is deployed.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { ROOT, GAME_DIR } from './lib/fixtures.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
};

export function serve(port = 0) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let path = decodeURIComponent(url.pathname);
      if (path === '/') path = '/index.html';
      const base = path.startsWith('/game/') ? GAME_DIR : ROOT;
      const rel = path.startsWith('/game/') ? path.slice(6) : path.slice(1);
      const file = normalize(join(base, rel));
      if (!file.startsWith(base) || rel.split('/').some((p) => p.startsWith('.'))) {
        res.writeHead(403).end();
        return;
      }
      if (!path.startsWith('/game/') && (rel.startsWith('local') || rel.startsWith('ghidra'))) {
        res.writeHead(403).end();
        return;
      }
      await stat(file);
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': TYPES[extname(file)] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] || 8000);
  serve(port).then((s) => console.log(`http://127.0.0.1:${s.address().port}/`));
}
