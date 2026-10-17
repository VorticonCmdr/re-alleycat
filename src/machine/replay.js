// Recorded-stream environment provider (verification only).
//
// Replays environment values captured from the reference emulator at their consumption
// points: BIOS tick reads and retrace reads by global read index, the RNG seed, and key
// events at sync points (loop heads that yield in the port). PIT channel-0 reads other
// than the seed are not recorded; they come from the port's own clock (they only time
// delay loops and sound-only variables, see docs/RE_NOTES.md "PIT-derived state").

export class StreamError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'StreamError';
  }
}

export class RecordedEnv {
  constructor(stream) {
    this.stream = stream;
    this.tickReads = 0;
    this.tickPtr = -1;
    this.retraceReads = 0;
    this.retracePtr = -1;
    this.siteHits = new Map();
    this.events = new Map(); // "site:count" -> [events]
    this.consumedEvents = 0;
    this.totalEvents = 0;
  }

  schedule(events) {
    for (const e of events) {
      const k = `${parseInt(e.site, 16)}:${e.count}`;
      if (!this.events.has(k)) this.events.set(k, []);
      this.events.get(k).push(e);
      this.totalEvents++;
    }
  }

  tick() {
    const i = this.tickReads++;
    const t = this.stream.ticks;
    while (this.tickPtr + 1 < t.length && t[this.tickPtr + 1][0] <= i) this.tickPtr++;
    if (this.tickPtr < 0) throw new StreamError(`tick read #${i} precedes the first recorded value`);
    return t[this.tickPtr][1] >>> 0;
  }

  // INT 1Ah AH=1: must match the recorded call (value and position in the read stream).
  setTicks(cx, dx) {
    const sets = this.stream.tickSets || [];
    const i = (this.setCalls = (this.setCalls || 0) + 1) - 1;
    const rec = sets[i];
    if (!rec) throw new StreamError(`unrecorded INT 1Ah AH=1 #${i} (CX=${cx.toString(16)} DX=${dx.toString(16)})`);
    if (rec.cx !== cx || rec.dx !== dx || rec.readIndex !== this.tickReads) {
      throw new StreamError(`INT 1Ah AH=1 #${i}: port CX:DX=${cx.toString(16)}:${dx.toString(16)} at read ${this.tickReads}, ` +
        `reference ${rec.cx.toString(16)}:${rec.dx.toString(16)} at read ${rec.readIndex}`);
    }
  }

  retrace() {
    const i = this.retraceReads++;
    const r = this.stream.retrace;
    while (this.retracePtr + 1 < r.length && r[this.retracePtr + 1][0] <= i) this.retracePtr++;
    return this.retracePtr < 0 ? false : r[this.retracePtr][1] === 1;
  }

  // Called at every sync yield; returns the events due here.
  sync(site) {
    const n = (this.siteHits.get(site) || 0) + 1;
    this.siteHits.set(site, n);
    const ev = this.events.get(`${site}:${n}`);
    if (ev) {
      this.events.delete(`${site}:${n}`);
      this.consumedEvents += ev.length;
    }
    return ev || [];
  }

  // Leftovers after the scenario finished.
  unconsumed() {
    const out = [];
    const sets = (this.stream.tickSets || []).length;
    if ((this.setCalls || 0) !== sets) out.push(`INT 1Ah AH=1 calls: port ${this.setCalls || 0}, reference ${sets}`);
    for (const [k, v] of this.events) out.push(`${k} (${v.map((e) => e.type).join(',')})`);
    return out;
  }
}
