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

// Room loop heads (sync points) -> room number.
export const ROOM_SITES = { 0x03fa: 1, 0x0478: 2, 0x03b2: 3, 0x0364: 4, 0x0319: 5, 0x02c5: 6, 0x027e: 7 };

export const policies = {
  // Whole game: alley -> window; inside a room, the room's own policy (if any).
  play(mem) {
    const room = mem.rw(0x0004);
    if (room === 0) return policies.enterWindow(mem);
    const p = policies[`room${room}`];
    return p ? p(mem) : new Set();
  },

  // Room 1: reach the fish bowl (overlap test at x E4h, y 8Ah in CS:3850 sets DS:0554).
  room1({ rb, rw, scratch }) {
    const x = rw(0x579);
    const y = rb(0x57b);
    const vdir = rb(0x571);
    const keys = new Set();
    const takeoff = scratch.takeoff ?? 160; // 158..166: 8/8 seeds on the port
    if (y === 136) {
      // on the table: the bowl test needs x within [204, 244]
      if (x < 212) keys.add('ArrowRight');
      else if (x > 236) keys.add('ArrowLeft');
      return keys;
    }
    if (vdir !== 0) {
      if (y < 120 && x < 150) keys.add('ArrowRight'); // steer onto the chair while dropping in
      return keys;
    }
    // standing on the chair (or elsewhere): run right and jump at the take-off point
    keys.add('ArrowRight');
    if (x >= takeoff) keys.add('ArrowUp');
    return keys;
  },

  // Room 6 (bowls): with Alt held (DS:069a = 0) the room walks the cat to the nearest
  // non-empty bowl on its own floor row and eats it (CS:4943; bowl rows DS:4499, counts
  // DS:44c4). Holding Down/Up steps the cat between the floor rows (y = row - 8).
  room6({ rb, scratch }) {
    const keys = new Set(['AltLeft']);
    const y = rb(0x57b);
    const vdir = rb(0x571);
    const rows = new Set();
    for (let bx = 0; bx < 12; bx++) if (rb(0x44c4 + bx) > 0) rows.add(rb(0x4499 + bx) - 8);
    if (!rows.size || (vdir === 0 && rows.has(y))) {
      scratch.step = null;
      return keys;
    }
    if (vdir !== 0) {
      if (scratch.step) keys.add(scratch.step); // keep stepping through a row change
      return keys;
    }
    scratch.step = [...rows].some((r) => r > y) ? 'ArrowDown' : 'ArrowUp';
    keys.add(scratch.step);
    return keys;
  },

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
    // dodge a thrown object that is coming down near the cat (above the ground)
    if (rb(0x1673) !== 0 && y < 0xb4) {
      const tx = rw(0x1671);
      const aligned = winOpen && Math.abs(wx + 4 - x) <= 3 && wy === y + 16;
      if (Math.abs(tx - x) < 48 && !aligned) {
        keys.add(x >= tx ? 'ArrowRight' : 'ArrowLeft');
        return keys;
      }
    }
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
