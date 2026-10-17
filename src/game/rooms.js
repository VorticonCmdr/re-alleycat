// Rooms 1..7 and the transitions between alley and rooms.
// Not translated yet: every entry point stops with an explicit UnsupportedPath.

const todo = (g, what) => g.unsupported(what);

export function* roomTransition(g) {
  todo(g, 'room transition CS:1bf0');
}
export function* room1(g) {
  todo(g, 'room 1 loop CS:03e2');
}
export function* room2(g) {
  todo(g, 'room 2 loop CS:0459');
}
export function* room3(g) {
  todo(g, 'room 3 loop CS:0394');
}
export function* room4(g) {
  todo(g, 'room 4 loop CS:0349');
}
export function* room5(g) {
  todo(g, 'room 5 loop CS:02fe');
}
export function* room6(g) {
  todo(g, 'room 6 loop CS:02aa');
}
export function* room7(g) {
  todo(g, 'room 7 loop CS:0260');
}
export function* room2Swim(g) {
  todo(g, 'room 2 swimming CS:0953');
}
export function room3Landing(g) {
  return todo(g, 'room 3 landing CS:3c43');
}
export function room7Landing(g) {
  return todo(g, 'room 7 landing CS:30fa');
}
export function roomWalkHook(g) {
  todo(g, 'room walk hook CS:3445');
}
