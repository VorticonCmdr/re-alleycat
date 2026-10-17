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
    for (const [k, v] of this.events) out.push(`${k} (${v.map((e) => e.type).join(',')})`);
    return out;
  }
}
