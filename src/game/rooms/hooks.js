// Registry of room-specific routines used by shared code (transition, background,
// chaser). Room modules register themselves; anything not registered is an explicit
// unsupported path.

const rooms = new Map();

export function registerRoom(n, hooks) {
  rooms.set(n, hooks);
}

export function roomHooks(n) {
  const h = rooms.get(n) || {};
  return new Proxy(h, {
    get(target, name) {
      if (name in target) return target[name];
      return (g) => g.unsupported(`room ${n} routine "${String(name)}" not ported`);
    },
  });
}
