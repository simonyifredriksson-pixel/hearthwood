/* FishData.js — what lives in the water.
   ===========================================================================
   A fish is defined by HOW IT MOVES, not by how it looks. The minigame is a
   contest against a moving target, so the only property that changes how a
   catch feels is the target's behaviour: a Silt Loach drifts and is caught by
   anybody, a Glimmerfin darts and stops dead and will beat you twice before
   you learn it.

   The movement is written as a small set of numbers rather than as a script,
   so every fish of a species still moves differently each time — the same
   approach the sticks use, and for the same reason.
*/

import { makeRng, clamp, clamp01, lerp } from '../core/Util.js?v=20260920201841';

/**
 *   speed      how fast it travels along the bar, in bar-widths per second
 *   restless   how often it changes its mind, per second
 *   dart       how violent a change of mind is
 *   pause      how much of its time it spends completely still
 *   drift      how much it wanders while "still"
 *   fight      how quickly the catch slips when you are off it
 *   w          weight in the roll
 *   depth      0 shallow .. 1 deep, for where it can be found
 */
export const FISH = {
  siltLoach: {
    id: 'siltLoach', name: 'Silt Loach', tier: 0, w: 26,
    speed: 0.30, restless: 0.55, dart: 0.25, pause: 0.45, drift: 0.10,
    fight: 0.55, depth: 0.2, len: [0.10, 0.20],
    blurb: 'Bottom-dweller. Mostly a moustache with a fish attached.',
  },
  pebbleperch: {
    id: 'pebbleperch', name: 'Pebble Perch', tier: 0, w: 24,
    speed: 0.42, restless: 0.9, dart: 0.35, pause: 0.25, drift: 0.16,
    fight: 0.7, depth: 0.3, len: [0.12, 0.24],
    blurb: 'Stripy, stubborn, and everywhere. Your first fish is usually one.',
  },
  reedminnow: {
    id: 'reedminnow', name: 'Reed Minnow', tier: 0, w: 22,
    speed: 0.55, restless: 1.5, dart: 0.30, pause: 0.12, drift: 0.22,
    fight: 0.6, depth: 0.15, len: [0.06, 0.12],
    blurb: 'Tiny and endlessly busy. Never once been still.',
  },
  coppertail: {
    id: 'coppertail', name: 'Coppertail', tier: 1, w: 15,
    speed: 0.58, restless: 1.1, dart: 0.55, pause: 0.20, drift: 0.18,
    fight: 0.85, depth: 0.45, len: [0.22, 0.38],
    blurb: 'Turns the colour of a new penny when it comes out of the water.',
  },
  mosscarp: {
    id: 'mosscarp', name: 'Moss Carp', tier: 1, w: 12,
    speed: 0.24, restless: 0.4, dart: 0.20, pause: 0.55, drift: 0.08,
    fight: 1.25, depth: 0.55, len: [0.35, 0.62],
    blurb: 'Enormous, ancient and in no hurry. Pulls like a sack of wet rope.',
  },
  stonebarbel: {
    id: 'stonebarbel', name: 'Stone Barbel', tier: 1, w: 11,
    speed: 0.46, restless: 0.8, dart: 0.45, pause: 0.30, drift: 0.12,
    fight: 1.0, depth: 0.6, len: [0.28, 0.46],
    blurb: 'Lives under the deepest stone it can find and resents being asked to leave.',
  },
  glimmerfin: {
    id: 'glimmerfin', name: 'Glimmerfin', tier: 2, w: 6,
    speed: 0.85, restless: 2.2, dart: 0.85, pause: 0.18, drift: 0.25,
    fight: 1.15, depth: 0.7, len: [0.18, 0.30],
    blurb: 'Catches the light like a struck match and moves about as predictably.',
  },
  ghostroach: {
    id: 'ghostroach', name: 'Ghost Roach', tier: 2, w: 4,
    speed: 0.62, restless: 1.8, dart: 0.70, pause: 0.40, drift: 0.30,
    fight: 1.0, depth: 0.75, len: [0.20, 0.34],
    blurb: 'Pale enough to see the stones through. Nobody agrees on whether it is one fish or many.',
  },
  kingfisher: {
    id: 'kingfisher', name: "King's Trout", tier: 3, w: 2,
    speed: 0.72, restless: 1.4, dart: 0.80, pause: 0.22, drift: 0.20,
    fight: 1.45, depth: 0.85, len: [0.48, 0.85],
    blurb: 'The one the Fisherman has been after for eleven years. He will want to hear about it.',
  },
  moonfish: {
    id: 'moonfish', name: 'Moonfish', tier: 4, w: 0.6,
    speed: 0.50, restless: 2.6, dart: 0.95, pause: 0.35, drift: 0.34,
    fight: 1.6, depth: 0.95, len: [0.30, 0.55],
    blurb: 'Only rises on the clearest nights, and only for people who were not looking for it.',
  },
};

export const FISH_LIST = Object.values(FISH);

/**
 * Roll a fish for a spot.
 * Deeper, more remote water holds the better fish — the same "walk further,
 * find stranger things" rule the forest floor uses.
 */
export function rollFish(seed, { depth = 0.4, remoteness = 0.3, night = false } = {}) {
  const r = makeRng(seed >>> 0);
  const d = clamp01(depth * 0.6 + remoteness * 0.55);
  const pick = r.weighted(FISH_LIST, f => {
    // a fish is unlikely where the water is too shallow for it
    const fit = 1 - clamp01(Math.abs(f.depth - d) * 1.7);
    let w = f.w * (0.15 + fit * fit * 2.2);
    if (f.id === 'moonfish') w *= night ? 6 : 0.15;
    return w;
  });
  const len = r.range(pick.len[0], pick.len[1]);
  /* size within the species is a bell, so most are middling and a genuinely
     big one is worth telling somebody about */
  const size = clamp01((len - pick.len[0]) / Math.max(1e-6, pick.len[1] - pick.len[0]));
  return {
    id: pick.id, name: pick.name, tier: pick.tier, blurb: pick.blurb,
    len: Math.round(len * 100) / 100,
    size,
    seed: seed >>> 0,
    /* the actual movement for THIS fish, jittered off the species */
    move: {
      speed: pick.speed * r.range(0.85, 1.2),
      restless: pick.restless * r.range(0.8, 1.3),
      dart: pick.dart * r.range(0.85, 1.2),
      pause: clamp01(pick.pause * r.range(0.8, 1.25)),
      drift: pick.drift * r.range(0.8, 1.2),
      fight: pick.fight * r.range(0.9, 1.15) * lerp(0.85, 1.25, size),
    },
  };
}

/** A bigger fish of a rare species is the thing worth a banner. */
export function fishTier(f) {
  let t = f.tier;
  if (f.size > 0.88) t += 1;
  return clamp(t, 0, 6);
}
