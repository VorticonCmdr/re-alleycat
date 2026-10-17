// REST client for the dosbox-automation webserver (reference emulator).
// One process should own the live session at a time: breakpoints and inputs are global.
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const TOKEN_FILE = process.env.DOSBOX_TOKEN_FILE ||
  join(homedir(), 'Library/Preferences/dosbox-automation/webserver/api_token');
const BASE = process.env.DOSBOX_URL || 'http://127.0.0.1:8386';

export class DosBox {
  constructor() {
    this.token = existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, 'utf8').trim() : null;
    this.calls = 0;
  }

  async req(method, path, body) {
    this.calls++;
    const res = await fetch(BASE + path, {
      method,
      headers: {
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const type = res.headers.get('content-type') || '';
    if (res.ok && !type.includes('json') && !type.startsWith('text/')) {
      return { bytes: Buffer.from(await res.arrayBuffer()) };
    }
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    if (!res.ok) {
      const err = new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  }

  status() {
    return this.req('GET', '/api/v1/status');
  }
  internals() {
    return this.req('GET', '/api/v1/dos/internals');
  }
  regs() {
    return this.req('GET', '/api/v1/cpu/state');
  }
  async read(seg, off, len) {
    const r = await this.req('GET', `/api/v1/memory/${seg}/${off}/${len}`);
    return r.bytes ?? Buffer.from(r.data, 'base64');
  }
  async readLinear(off, len) {
    const r = await this.req('GET', `/api/v1/memory/${off}/${len}`);
    return r.bytes ?? Buffer.from(r.data, 'base64');
  }
  batch(ops, onError = 'abort') {
    return this.req('POST', '/api/v1/batch', { ops, on_error: onError });
  }
  pause() {
    return this.req('POST', '/api/v1/debug/pause');
  }
  cont() {
    return this.req('POST', '/api/v1/debug/continue');
  }
  stepOver() {
    return this.req('POST', '/api/v1/debug/step_over');
  }
  step(count = 1) {
    return this.req('POST', '/api/v1/debug/step', { count });
  }
  debugStatus() {
    return this.req('GET', '/api/v1/debug/status');
  }
  wait(sinceStopId, timeoutMs = 15000) {
    return this.req('GET', `/api/v1/debug/wait?since_stop_id=${sinceStopId}&timeout_ms=${timeoutMs}`);
  }
  addBreakpoint(bp) {
    return this.req('POST', '/api/v1/debug/breakpoints', bp);
  }
  listBreakpoints() {
    return this.req('GET', '/api/v1/debug/breakpoints');
  }
  clearBreakpoints() {
    return this.req('DELETE', '/api/v1/debug/breakpoints');
  }
  type(text, cps = 30) {
    return this.req('POST', '/api/v1/input/type', { text, cps });
  }
  sequence(events) {
    return this.req('POST', '/api/v1/input/sequence', { events });
  }
  replayStatus() {
    return this.req('GET', '/api/v1/input/replay/status');
  }
  waitFor(cond) {
    return this.req('POST', '/api/v1/wait', cond);
  }
  info() {
    return this.req('GET', '/api/v1/dosbox/info');
  }
}
