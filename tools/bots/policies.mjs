// Play policies for natural-play reference scenarios. A policy is called at a sync point
// with a memory reader; it returns the set of keys that should be held from now on.
// It depends only on game memory (so it behaves the same on the port and on the
// original), never on wall time. Policy state lives in `mem.scratch`, kept by the runner.

const FENCE_TOP = 0x60;
const LOW_WINDOW_ROW = 88;
const TALL_LID = 0x86;

// Tall cans for the current skill, from the game's own table (DS:0ff0, start DS:1006+skill).
function tallCans(rb, rw) {
  const out = [];
  let bx = rb(0x1006 + rw(0x0008));
  for (;;) {
    const al = rb(0xff0 + bx++);
    if (!al) break;
    if (al & 0x80) out.push((al & 0x7f) << 2);
  }
  return out;
}

export const policies = {
  // Alley: running jump onto a tall can, standing jump onto the fence top, then hop into
  // a window of the lowest row when it opens directly above.
  enterWindow({ rb, rw, scratch }) {
    const x = rw(0x579);
    const y = rb(0x57b);
    const vdir = rb(0x571); // 0 standing, 1 falling, 0xff rising
    const keys = new Set();
    const winState = rb(0x1665);
    const winOpen = winState >= 5 && winState <= 0x18;
    const wx = rw(0x1666);
    const wy = rb(0x1668);
    const onLine = rb(0x55c) !== 0 && vdir === 0 && (y === 8 || y === 0x28 || y === 0x48);
    if (onLine) {
      // ride the line; drop through an open window in the row just below
      if (winOpen && wy === y + 16) {
        const dx = wx + 4 - x;
        if (dx > 3) keys.add('ArrowRight');
        else if (dx < -3) keys.add('ArrowLeft');
        else keys.add('ArrowDown');
      }
      return keys;
    }
    if (y <= FENCE_TOP) {
      // on the fence top (or in the air above it): hop up to the lowest line, drifting
      // towards the window columns
      if (vdir === 0) keys.add('ArrowUp');
      if (winOpen && wy === LOW_WINDOW_ROW && vdir === 1) {
        // falling past an open low window: steer into it
        const dx = wx + 4 - x;
        if (dx > 3) keys.add('ArrowRight');
        else if (dx < -3) keys.add('ArrowLeft');
      }
      return keys;
    }
    if (y === TALL_LID && vdir === 0) {
      keys.add('ArrowUp'); // standing jump onto the fence top
      return keys;
    }
    // on the ground or on a low lid: long run-up, take off ~100 px before a tall can
    // (a full-speed jump covers ~104 px before it drops back to lid height)
    if (scratch.plan === undefined) {
      const cans = tallCans(rb, rw);
      let best = null;
      for (const c of cans) {
        for (const dir of [1, -1]) {
          const goal = c + 10;
          const takeoff = goal - dir * 100;
          const start = Math.max(10, Math.min(290, takeoff - dir * 160));
          const room = Math.abs(takeoff - start);
          if (takeoff < 10 || takeoff > 290) continue;
          if (!best || room > best.room) best = { goal, takeoff, start, dir, room };
        }
      }
      scratch.plan = best;
      scratch.phase = 'back';
    }
    const p = scratch.plan;
    if (scratch.phase === 'back') {
      const d = p.start - x;
      if (Math.abs(d) > 6) keys.add(d > 0 ? 'ArrowRight' : 'ArrowLeft');
      else if (vdir === 0) scratch.phase = 'run';
      return keys;
    }
    keys.add(p.dir > 0 ? 'ArrowRight' : 'ArrowLeft');
    const past = p.dir > 0 ? x >= p.takeoff - 4 : x <= p.takeoff + 4;
    if (vdir === 0 && past) {
      if (Math.abs(x - p.takeoff) < 24) keys.add('ArrowUp');
      else scratch.phase = 'back'; // overshot: start again
    }
    return keys;
  },
};
