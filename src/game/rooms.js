// Rooms 1..7 (behind the windows) and the transitions between alley and rooms.
// Room-specific code lives in rooms/roomN.js; each registers its routines in
// rooms/hooks.js. Shared code is in rooms/common.js.

import { roomHooks } from './rooms/hooks.js';
import { roomTransition, floorMark } from './rooms/common.js';
import './rooms/room1.js';
import './rooms/room2.js';
import './rooms/room3.js';
import './rooms/room4.js';
import './rooms/room5.js';
import './rooms/room6.js';
import './rooms/room7.js';

export { roomTransition };

// Room loops (jump table at CS:0250). Each returns undefined, or 'room2' when room 1
// hands over to room 2 (CS:040f).
export const room1 = (g) => roomHooks(1).loop(g);
export const room2 = (g) => roomHooks(2).loop(g);
export const room3 = (g) => roomHooks(3).loop(g);
export const room4 = (g) => roomHooks(4).loop(g);
export const room5 = (g) => roomHooks(5).loop(g);
export const room6 = (g) => roomHooks(6).loop(g);
export const room7 = (g) => roomHooks(7).loop(g);

// Called from the cat engine.
export const room2Swim = (g) => roomHooks(2).swim(g); // CS:0953..0bab (generator)
export const room3Landing = (g) => roomHooks(3).landing(g); // CS:3c43
export const room7Landing = (g) => roomHooks(7).landing(g); // CS:30fa
export const roomWalkHook = (g) => floorMark(g); // CS:3445
