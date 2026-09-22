/* FishData.js — everything that lives in the water.
   ===========================================================================
   Fishing is the economy of FISH N STICKS, so this file has to carry three
   jobs at once and keep them separate:

     WHAT IT IS      species, rarity, base worth, and the BODY GENOME that
                     FishArt.js builds a mesh from. Every species has its own
                     silhouette — a different body solid, head, tail, fin set,
                     pattern and palette. There are no recolours in here; if
                     two fish share a body they do not share anything else.
     HOW IT FIGHTS   the movement numbers the minigame plays against. This is
                     the only thing that changes how a catch FEELS, so it is
                     rolled per fish rather than fixed per species.
     WHAT IT IS WORTH
                     base x rarity x mutation x size, and nothing else. One
                     formula, written once, used by the shop, the inventory,
                     the hotbar and the catch card.

   THE SHAPE OF THE ECONOMY. A common fish is a handful of coins and you will
   catch hundreds; the multipliers do all the work above that. The anchor is
   deliberate: a mid-value MYTHIC with a x4 mutation lands around $12,000,
   which is one very good rod. Nothing else is tuned by feel.
*/

import { makeRng, hash2, clamp, clamp01, lerp } from '../core/Util.js?v=1790102737';

/* ========================================================================= */
/* RARITY                                                                    */
/* ========================================================================= */

/**
 * Nine tiers. `share` is roughly what fraction of catches should be this
 * rarity in ordinary water with an ordinary rod — the weights below are
 * fitted to it, and probe_fish.mjs fails if reality drifts away.
 *
 * `mult` is the money. It climbs steeply on purpose: the whole progression
 * loop is "go somewhere worse to find something better", and that only reads
 * if one Legendary is worth more than an afternoon of Perch.
 */
export const FISH_RARITY = [
  { id: 'common', name: 'Common', mult: 1.16, css: '#b9b1a0', share: 0.450, mid: 10 },
  { id: 'uncommon', name: 'Uncommon', mult: 1.36, css: '#8fc46a', share: 0.280, mid: 28 },
  { id: 'rare', name: 'Rare', mult: 2.18, css: '#63b4e8', share: 0.150, mid: 75 },
  { id: 'superRare', name: 'Super Rare', mult: 2.90, css: '#7f86ec', share: 0.070, mid: 200 },
  { id: 'epic', name: 'Epic', mult: 4.41, css: '#b46ae0', share: 0.0300, mid: 520 },
  { id: 'legendary', name: 'Legendary', mult: 6.77, css: '#e8a13c', share: 0.0120, mid: 1300 },
  { id: 'mythic', name: 'Mythic', mult: 9.40, css: '#e8556a', share: 0.0045, mid: 3100 },
  { id: 'divine', name: 'Divine', mult: 13.6, css: '#f5e6a8', share: 0.0012, mid: 9000 },
  { id: 'unknown', name: '???', mult: 21.4, css: '#d8f3ff', share: 0.0002, mid: 30000 },
];

/* WHY THOSE MULTIPLIERS LOOK ARBITRARY. They are a fit, not a design. The
   design is the `mid` column: what an average fish of that tier should be
   worth, roughly 2.6x per step, anchored on the brief's own example — a
   mid MYTHIC with a x4 mutation comes to about $12,400, which is one very
   good rod. `base` on each species is then its worth WITHIN its tier
   (a Thorn Pike is a better prize than a Coppertail), and `mult` is
   whatever makes the two agree. probe_fish.mjs prints the real spread and
   test_game fails if a tier drifts off its `mid`. */

export const RARITY_BY_ID = Object.fromEntries(FISH_RARITY.map((r, i) => [r.id, { ...r, index: i }]));
export const rarityOf = id => RARITY_BY_ID[id] || RARITY_BY_ID.common;

/* ========================================================================= */
/* MUTATIONS                                                                 */
/* ========================================================================= */

/**
 * A mutation is a VISIBLE change, not a number on a card.
 *
 * Every entry says what it does to the model — the palette, the finish, the
 * size, whether it emits light — because "Golden" that renders the same as
 * the plain fish is just a bigger price tag, and the player stops caring the
 * second they notice. FishArt reads `skin`, `tint`, `glow`, `scale` and
 * `shimmer` straight off this table.
 *
 *   one: the chance is one in this many
 *   mult: what it does to the value
 */
export const MUTATIONS = [
  {
    id: 'albino', name: 'Albino', one: 35, mult: 4, css: '#f3ece0',
    skin: 'flat', tint: 0xf6efe2, belly: 0xffffff, accent: 0xffc9c0, eye: 0xd6485a,
    desc: 'No pigment at all. Pink-eyed and faintly translucent.',
  },
  {
    id: 'giant', name: 'Giant', one: 48, mult: 5, css: '#c9a66b',
    scale: 1.55, desc: 'Far past the size this species is supposed to reach.',
  },
  {
    id: 'tiny', name: 'Tiny', one: 48, mult: 3, css: '#a8c7d8',
    scale: 0.42, desc: 'Perfectly formed, and absurdly small.',
  },
  {
    id: 'glowing', name: 'Glowing', one: 60, mult: 6, css: '#a8f5c8',
    glow: 0x8cffbe, glowAmt: 0.85, desc: 'Lit from inside. Nobody can explain it.',
  },
  {
    id: 'golden', name: 'Golden', one: 90, mult: 9, css: '#f0c14c',
    skin: 'metal', tint: 0xe8b23a, belly: 0xf7dd92, accent: 0xfff0b4, shimmer: 0.9,
    desc: 'Scales like beaten coin. Heavier than it looks.',
  },
  {
    id: 'shadow', name: 'Shadow', one: 120, mult: 12, css: '#6a5f86',
    skin: 'flat', tint: 0x201c2c, belly: 0x2e2840, accent: 0x6a5f96, eye: 0xc9b4ff,
    desc: 'Light goes in and does not come back out.',
  },
  {
    id: 'frozen', name: 'Frozen', one: 140, mult: 13, css: '#a7dcf2',
    tint: 0xbfe4f5, belly: 0xe8f7ff, accent: 0x7fc0e8, glow: 0x9fd8ff, glowAmt: 0.25,
    rime: true, desc: 'Rimed over and still swimming. Cold enough to ache.',
  },
  {
    id: 'ember', name: 'Ember', one: 150, mult: 14, css: '#f07a3a',
    tint: 0x3a1a14, belly: 0x8e3a1e, accent: 0xff9a3c, glow: 0xff7a28, glowAmt: 0.7,
    desc: 'Banked coals under the scales. The water steams around it.',
  },
  {
    id: 'twintail', name: 'Twin-Tailed', one: 200, mult: 18, css: '#d9a8e8',
    twinTail: true, desc: 'Two perfect tails, and it uses both.',
  },
  {
    id: 'crystal', name: 'Crystal', one: 260, mult: 22, css: '#9fe8e0',
    skin: 'glass', tint: 0x9fe0e8, belly: 0xd8f6f4, accent: 0xffffff,
    glow: 0x7fe4ff, glowAmt: 0.45, facet: true,
    desc: 'Grown rather than hatched. You can see the light bend through it.',
  },
  {
    id: 'spectral', name: 'Spectral', one: 400, mult: 32, css: '#bfe8ff',
    skin: 'ghost', tint: 0x9fc4e0, belly: 0xdaf0ff, accent: 0xffffff,
    glow: 0x9fd8ff, glowAmt: 0.6, ghost: true,
    desc: 'You can see the riverbed through it. It does not seem to mind.',
  },
  {
    id: 'ancient', name: 'Ancient', one: 650, mult: 55, css: '#b09a6a',
    skin: 'stone', tint: 0x6a6048, belly: 0x9a9070, accent: 0x3e3a2c,
    plated: true, desc: 'Armoured, scarred, and older than the village.',
  },
  {
    id: 'starbound', name: 'Starbound', one: 1500, mult: 120, css: '#e0d0ff',
    skin: 'flat', tint: 0x1a1a3a, belly: 0x2c2c5a, accent: 0xfff4c0,
    glow: 0xc8b4ff, glowAmt: 1.0, stars: true,
    desc: 'The pattern on its flank is not a pattern. It is a sky.',
  },
];

export const MUTATION_BY_ID = Object.fromEntries(MUTATIONS.map(m => [m.id, m]));

/**
 * Roll a mutation, or null.
 *
 * Rolled independently per mutation rather than as one weighted pick, so the
 * printed odds ("about one in thirty-five") are the actual odds and a player
 * counting catches will find they agree. Rarer mutations are tested first, so
 * the best one wins when two come up at once.
 */
export function rollMutation(r, luck = 1) {
  const sorted = [...MUTATIONS].sort((a, b) => b.one - a.one);
  for (const m of sorted) {
    if (r() < (1 / m.one) * luck) return m;
  }
  return null;
}

/* ========================================================================= */
/* THE SPECIES                                                               */
/* ========================================================================= */

/**
 * A species entry.
 *
 *   BODY GENOME (read by FishArt)
 *     body      the solid: torpedo, deep, flat, eel, ribbon, globe, needle, ray
 *     depthR    body depth as a fraction of length
 *     wideR     body width as a fraction of depth
 *     head      blunt, pointed, beak, wide, whisker, hooked
 *     tail      fork, fan, round, lunate, spade, ribbon, whip
 *     dorsal    none, low, tall, sail, spiny, ridge
 *     pect      small, long, wing
 *     pattern   plain, stripe, band, spot, mottle, net, gradient, marble
 *     cols      [back, belly, accent]
 *     eye       eye radius as a fraction of head depth
 *     extras    barbels / spines / horn / lantern / plates / trailing
 *
 *   WATER
 *     depth     0 shallow .. 1 deep — where in the water column it sits
 *     zone      0 the home valley .. 1 the far mountains
 *     night     weight multiplier after dark (1 = indifferent)
 *
 *   FIGHT — see the header. Jittered per catch.
 */
export const FISH = {

  /* ---------------------------------------------------------- COMMON ---- */
  pebbleperch: {
    id: 'pebbleperch', name: 'Pebble Perch', rarity: 'common', base: 9, w: 100,
    body: 'deep', depthR: 0.36, wideR: 0.42, head: 'blunt', tail: 'fork',
    dorsal: 'spiny', pect: 'small', pattern: 'stripe', eye: 0.26,
    cols: [0x6e7a4a, 0xd8cf9a, 0x3c4426],
    len: [0.12, 0.26], depth: 0.25, zone: 0.0, night: 1,
    speed: 0.42, restless: 0.9, dart: 0.35, pause: 0.25, drift: 0.16, fight: 0.70,
    blurb: 'Stripy, stubborn and everywhere. Your first fish is always one.',
  },
  siltloach: {
    id: 'siltloach', name: 'Silt Loach', rarity: 'common', base: 7, w: 96,
    body: 'eel', depthR: 0.15, wideR: 0.85, head: 'whisker', tail: 'round',
    dorsal: 'low', pect: 'small', pattern: 'mottle', eye: 0.16,
    cols: [0x6b5a42, 0xc4b494, 0x3a3024], extras: ['barbels'],
    len: [0.10, 0.22], depth: 0.15, zone: 0.0, night: 1.4,
    speed: 0.30, restless: 0.55, dart: 0.25, pause: 0.45, drift: 0.10, fight: 0.55,
    blurb: 'Bottom-dweller. Mostly a moustache with a fish attached.',
  },
  reedminnow: {
    id: 'reedminnow', name: 'Reed Minnow', rarity: 'common', base: 6, w: 92,
    body: 'needle', depthR: 0.17, wideR: 0.55, head: 'pointed', tail: 'fork',
    dorsal: 'low', pect: 'small', pattern: 'gradient', eye: 0.32,
    cols: [0x8aa06a, 0xeae4c4, 0xb9c98a],
    len: [0.05, 0.11], depth: 0.10, zone: 0.0, night: 0.8,
    speed: 0.55, restless: 1.5, dart: 0.30, pause: 0.12, drift: 0.22, fight: 0.60,
    blurb: 'Tiny and endlessly busy. Has never once been still.',
  },
  mudbream: {
    id: 'mudbream', name: 'Mud Bream', rarity: 'common', base: 11, w: 74,
    body: 'flat', depthR: 0.52, wideR: 0.24, head: 'blunt', tail: 'fan',
    dorsal: 'ridge', pect: 'long', pattern: 'plain', eye: 0.24,
    cols: [0x7a6a4e, 0xd6c8a0, 0x5a4c34],
    len: [0.18, 0.34], depth: 0.35, zone: 0.05, night: 1,
    speed: 0.34, restless: 0.6, dart: 0.30, pause: 0.38, drift: 0.12, fight: 0.85,
    blurb: 'A dinner plate that resents you. Turns sideways and simply refuses.',
  },
  chubdace: {
    id: 'chubdace', name: 'Chub Dace', rarity: 'common', base: 10, w: 70,
    body: 'torpedo', depthR: 0.26, wideR: 0.62, head: 'blunt', tail: 'fork',
    dorsal: 'low', pect: 'small', pattern: 'gradient', eye: 0.22,
    cols: [0x5a6a72, 0xe0e2dc, 0x8c9aa0],
    len: [0.16, 0.30], depth: 0.28, zone: 0.08, night: 1,
    speed: 0.48, restless: 1.0, dart: 0.40, pause: 0.20, drift: 0.18, fight: 0.72,
    blurb: 'Shoals in the shallows and panics as a committee.',
  },

  /* -------------------------------------------------------- UNCOMMON ---- */
  coppertail: {
    id: 'coppertail', name: 'Coppertail', rarity: 'uncommon', base: 16, w: 52,
    body: 'torpedo', depthR: 0.28, wideR: 0.58, head: 'pointed', tail: 'lunate',
    dorsal: 'low', pect: 'long', pattern: 'gradient', eye: 0.24,
    cols: [0x7a4a2a, 0xefd8b4, 0xd98a3c],
    len: [0.22, 0.40], depth: 0.45, zone: 0.12, night: 1,
    speed: 0.58, restless: 1.1, dart: 0.55, pause: 0.20, drift: 0.18, fight: 0.85,
    blurb: 'Turns the colour of a new penny the moment it leaves the water.',
  },
  mosscarp: {
    id: 'mosscarp', name: 'Moss Carp', rarity: 'uncommon', base: 22, w: 44,
    body: 'deep', depthR: 0.42, wideR: 0.50, head: 'blunt', tail: 'fan',
    dorsal: 'ridge', pect: 'small', pattern: 'net', eye: 0.18,
    cols: [0x4c5c38, 0xbcc48a, 0x2e3a22], extras: ['barbels'],
    len: [0.34, 0.66], depth: 0.55, zone: 0.10, night: 1,
    speed: 0.24, restless: 0.4, dart: 0.20, pause: 0.55, drift: 0.08, fight: 1.25,
    blurb: 'Enormous, ancient and in no hurry. Pulls like a sack of wet rope.',
  },
  stonebarbel: {
    id: 'stonebarbel', name: 'Stone Barbel', rarity: 'uncommon', base: 19, w: 42,
    body: 'torpedo', depthR: 0.24, wideR: 0.70, head: 'whisker', tail: 'spade',
    dorsal: 'low', pect: 'long', pattern: 'mottle', eye: 0.15,
    cols: [0x5e5a4e, 0xc0b8a0, 0x38342c], extras: ['barbels'],
    len: [0.28, 0.48], depth: 0.60, zone: 0.16, night: 1.2,
    speed: 0.46, restless: 0.8, dart: 0.45, pause: 0.30, drift: 0.12, fight: 1.00,
    blurb: 'Lives under the deepest stone it can find and resents being asked to leave.',
  },
  thornpike: {
    id: 'thornpike', name: 'Thorn Pike', rarity: 'uncommon', base: 28, w: 34,
    body: 'needle', depthR: 0.20, wideR: 0.52, head: 'beak', tail: 'fork',
    dorsal: 'low', pect: 'small', pattern: 'band', eye: 0.20,
    cols: [0x4a5e3a, 0xd4d09c, 0x22301c], extras: ['teeth'],
    len: [0.42, 0.88], depth: 0.40, zone: 0.22, night: 1.1,
    speed: 0.76, restless: 0.7, dart: 0.95, pause: 0.34, drift: 0.10, fight: 1.15,
    blurb: 'Hangs in the weed like a dropped spear, then is somewhere else.',
  },
  ribbonsole: {
    id: 'ribbonsole', name: 'Ribbon Sole', rarity: 'uncommon', base: 18, w: 36,
    body: 'ray', depthR: 0.60, wideR: 0.14, head: 'wide', tail: 'ribbon',
    dorsal: 'none', pect: 'wing', pattern: 'spot', eye: 0.20,
    cols: [0x8a7a5a, 0xf0e8d0, 0x4a4030],
    len: [0.20, 0.42], depth: 0.70, zone: 0.18, night: 1,
    speed: 0.28, restless: 0.5, dart: 0.30, pause: 0.50, drift: 0.28, fight: 0.95,
    blurb: 'Lies flat on the bottom pretending to be the bottom. Usually works.',
  },

  /* ------------------------------------------------------------ RARE ---- */
  glimmerfin: {
    id: 'glimmerfin', name: 'Glimmerfin', rarity: 'rare', base: 26, w: 22,
    body: 'torpedo', depthR: 0.30, wideR: 0.46, head: 'pointed', tail: 'lunate',
    dorsal: 'tall', pect: 'long', pattern: 'gradient', eye: 0.30,
    cols: [0x3a6a8a, 0xeaf4f8, 0x9fd8f0], extras: ['shine'],
    len: [0.18, 0.32], depth: 0.70, zone: 0.24, night: 1.2,
    speed: 0.85, restless: 2.2, dart: 0.85, pause: 0.18, drift: 0.25, fight: 1.15,
    blurb: 'Catches the light like a struck match and moves about as predictably.',
  },
  ghostroach: {
    id: 'ghostroach', name: 'Ghost Roach', rarity: 'rare', base: 30, w: 20,
    body: 'flat', depthR: 0.40, wideR: 0.22, head: 'blunt', tail: 'fan',
    dorsal: 'low', pect: 'long', pattern: 'plain', eye: 0.34,
    cols: [0xa8b0b8, 0xf4f8fa, 0xd0dae0], extras: ['translucent'],
    len: [0.20, 0.36], depth: 0.75, zone: 0.26, night: 2.2,
    speed: 0.62, restless: 1.8, dart: 0.70, pause: 0.40, drift: 0.30, fight: 1.00,
    blurb: 'Pale enough to see the stones through. Nobody agrees whether it is one fish or many.',
  },
  bristlecat: {
    id: 'bristlecat', name: 'Bristle Catfish', rarity: 'rare', base: 44, w: 17,
    body: 'eel', depthR: 0.22, wideR: 0.90, head: 'wide', tail: 'spade',
    dorsal: 'ridge', pect: 'long', pattern: 'mottle', eye: 0.12,
    cols: [0x3e382e, 0xa89878, 0x1e1a14], extras: ['barbels', 'spines'],
    len: [0.45, 0.95], depth: 0.85, zone: 0.30, night: 1.8,
    speed: 0.32, restless: 0.45, dart: 0.40, pause: 0.48, drift: 0.10, fight: 1.55,
    blurb: 'Eight whiskers and a grudge. Goes down and stays down.',
  },
  sunwheel: {
    id: 'sunwheel', name: 'Sunwheel', rarity: 'rare', base: 34, w: 18,
    body: 'globe', depthR: 0.64, wideR: 0.48, head: 'blunt', tail: 'fan',
    dorsal: 'sail', pect: 'long', pattern: 'band', eye: 0.30,
    cols: [0xd8a032, 0xfaeec0, 0x8a4e18],
    len: [0.16, 0.30], depth: 0.35, zone: 0.28, night: 0.4,
    speed: 0.44, restless: 1.3, dart: 0.55, pause: 0.26, drift: 0.24, fight: 0.90,
    blurb: 'A coin with fins. Only comes up when the sun is properly out.',
  },
  slateeel: {
    id: 'slateeel', name: 'Slate Eel', rarity: 'rare', base: 38, w: 15,
    body: 'eel', depthR: 0.11, wideR: 0.95, head: 'pointed', tail: 'ribbon',
    dorsal: 'ridge', pect: 'small', pattern: 'plain', eye: 0.14,
    cols: [0x3a4048, 0x8a929a, 0x20242a],
    len: [0.55, 1.20], depth: 0.80, zone: 0.34, night: 1.9,
    speed: 0.70, restless: 1.6, dart: 0.60, pause: 0.22, drift: 0.34, fight: 1.30,
    blurb: 'A metre of muscle with an opinion. Ties itself in knots to make a point.',
  },

  /* ------------------------------------------------------ SUPER RARE ---- */
  kingstrout: {
    id: 'kingstrout', name: "King's Trout", rarity: 'superRare', base: 58, w: 9,
    body: 'torpedo', depthR: 0.29, wideR: 0.55, head: 'blunt', tail: 'spade',
    dorsal: 'low', pect: 'long', pattern: 'spot', eye: 0.22,
    cols: [0x5a6a4a, 0xf2e0c0, 0xc4506a],
    len: [0.48, 0.90], depth: 0.65, zone: 0.36, night: 1,
    speed: 0.72, restless: 1.4, dart: 0.80, pause: 0.22, drift: 0.20, fight: 1.45,
    blurb: 'The one the Fisherman has been after for eleven years.',
  },
  lanternfish: {
    id: 'lanternfish', name: 'Bog Lantern', rarity: 'superRare', base: 66, w: 8,
    body: 'globe', depthR: 0.58, wideR: 0.56, head: 'wide', tail: 'round',
    dorsal: 'none', pect: 'small', pattern: 'spot', eye: 0.38,
    cols: [0x2e3a30, 0x7a8a5c, 0xc8f088], extras: ['lantern', 'teeth'],
    len: [0.14, 0.28], depth: 0.90, zone: 0.40, night: 3.0,
    speed: 0.38, restless: 1.0, dart: 0.70, pause: 0.44, drift: 0.20, fight: 1.20,
    blurb: 'Carries its own light on a stalk. Follow it and you will be wet to the knees.',
  },
  bladefin: {
    id: 'bladefin', name: 'Bladefin', rarity: 'superRare', base: 72, w: 7,
    body: 'needle', depthR: 0.15, wideR: 0.36, head: 'beak', tail: 'lunate',
    dorsal: 'tall', pect: 'long', pattern: 'gradient', eye: 0.24,
    cols: [0x2a3a5a, 0xdce8f4, 0x8ab4e0], extras: ['shine'],
    len: [0.40, 0.75], depth: 0.60, zone: 0.44, night: 1,
    speed: 1.05, restless: 1.9, dart: 1.00, pause: 0.10, drift: 0.18, fight: 1.35,
    blurb: 'Shaped like something that was designed rather than evolved.',
  },
  marblekoi: {
    id: 'marblekoi', name: 'Marble Koi', rarity: 'superRare', base: 80, w: 6,
    body: 'deep', depthR: 0.34, wideR: 0.52, head: 'blunt', tail: 'ribbon',
    dorsal: 'low', pect: 'long', pattern: 'marble', eye: 0.20,
    cols: [0xf0ede4, 0xffffff, 0xd8613a], extras: ['barbels', 'trailing'],
    len: [0.30, 0.62], depth: 0.40, zone: 0.42, night: 1,
    speed: 0.36, restless: 0.7, dart: 0.35, pause: 0.42, drift: 0.16, fight: 1.10,
    blurb: 'Somebody kept these once. Nobody remembers who, or where the pond was.',
  },

  /* ------------------------------------------------------------ EPIC ---- */
  moonfish: {
    id: 'moonfish', name: 'Moonfish', rarity: 'epic', base: 96, w: 3.4,
    body: 'flat', depthR: 0.72, wideR: 0.18, head: 'blunt', tail: 'lunate',
    dorsal: 'sail', pect: 'wing', pattern: 'gradient', eye: 0.34,
    cols: [0x8a96b8, 0xf6f4ff, 0xc8d4f0], extras: ['shine'],
    len: [0.30, 0.58], depth: 0.95, zone: 0.48, night: 6.0,
    speed: 0.50, restless: 2.6, dart: 0.95, pause: 0.35, drift: 0.34, fight: 1.60,
    blurb: 'Only rises on the clearest nights, and only for people who were not looking.',
  },
  ironjaw: {
    id: 'ironjaw', name: 'Ironjaw', rarity: 'epic', base: 120, w: 3.0,
    body: 'torpedo', depthR: 0.34, wideR: 0.72, head: 'hooked', tail: 'spade',
    dorsal: 'spiny', pect: 'small', pattern: 'band', eye: 0.16,
    cols: [0x4a4e54, 0x9aa2a8, 0x24282c], extras: ['teeth', 'plates'],
    len: [0.60, 1.30], depth: 0.75, zone: 0.55, night: 1.2,
    speed: 0.62, restless: 0.8, dart: 0.90, pause: 0.26, drift: 0.12, fight: 2.10,
    blurb: 'Takes the hook, the line, and a fair amount of your confidence.',
  },
  stormray: {
    id: 'stormray', name: 'Storm Ray', rarity: 'epic', base: 138, w: 2.6,
    body: 'ray', depthR: 0.76, wideR: 0.12, head: 'wide', tail: 'whip',
    dorsal: 'none', pect: 'wing', pattern: 'net', eye: 0.18,
    cols: [0x384258, 0xbcc8d8, 0x6a86b4], extras: ['spines'],
    len: [0.55, 1.05], depth: 0.85, zone: 0.58, night: 1.4,
    speed: 0.44, restless: 1.2, dart: 0.80, pause: 0.34, drift: 0.40, fight: 1.75,
    blurb: 'Flies more than it swims. The water goes strange just before it surfaces.',
  },

  /* ------------------------------------------------------- LEGENDARY ---- */
  goldscale: {
    id: 'goldscale', name: 'Goldscale', rarity: 'legendary', base: 165, w: 1.5,
    body: 'deep', depthR: 0.40, wideR: 0.46, head: 'blunt', tail: 'fan',
    dorsal: 'sail', pect: 'long', pattern: 'net', eye: 0.24,
    cols: [0xd8a832, 0xfbeeb8, 0x9a6414], extras: ['shine', 'trailing'],
    len: [0.40, 0.80], depth: 0.60, zone: 0.62, night: 1,
    speed: 0.54, restless: 1.5, dart: 0.70, pause: 0.30, drift: 0.22, fight: 1.65,
    blurb: 'Worth more than the boat you would need to chase it properly.',
  },
  frostpike: {
    id: 'frostpike', name: 'Frostpike', rarity: 'legendary', base: 190, w: 1.2,
    body: 'needle', depthR: 0.19, wideR: 0.48, head: 'beak', tail: 'fork',
    dorsal: 'spiny', pect: 'small', pattern: 'band', eye: 0.22,
    cols: [0x7fa8c4, 0xe8f6ff, 0x2e5470], extras: ['teeth', 'rime'],
    len: [0.70, 1.40], depth: 0.70, zone: 0.70, night: 1.3,
    speed: 0.92, restless: 1.1, dart: 1.10, pause: 0.30, drift: 0.14, fight: 2.00,
    blurb: 'The water around it is a degree or two colder than it has any right to be.',
  },
  deepcoil: {
    id: 'deepcoil', name: 'Deep Coil', rarity: 'legendary', base: 220, w: 1.0,
    body: 'ribbon', depthR: 0.13, wideR: 0.70, head: 'pointed', tail: 'ribbon',
    dorsal: 'ridge', pect: 'small', pattern: 'stripe', eye: 0.26,
    cols: [0x2a2c44, 0x8a8ab0, 0x6a5ec8], extras: ['trailing', 'shine'],
    len: [1.10, 2.20], depth: 1.00, zone: 0.72, night: 2.0,
    speed: 0.80, restless: 2.0, dart: 0.85, pause: 0.20, drift: 0.44, fight: 2.20,
    blurb: 'Comes up out of water nobody has found the bottom of.',
  },

  /* ---------------------------------------------------------- MYTHIC ---- */
  emberkoi: {
    id: 'emberkoi', name: 'Ember Koi', rarity: 'mythic', base: 300, w: 0.55,
    body: 'deep', depthR: 0.36, wideR: 0.50, head: 'blunt', tail: 'ribbon',
    dorsal: 'sail', pect: 'wing', pattern: 'marble', eye: 0.22,
    cols: [0x8a2a14, 0xffc47a, 0xff7a28], extras: ['barbels', 'trailing', 'lantern'],
    len: [0.45, 0.95], depth: 0.55, zone: 0.78, night: 1.5,
    speed: 0.60, restless: 1.7, dart: 0.80, pause: 0.28, drift: 0.26, fight: 2.15,
    blurb: 'Warm to the touch. The pond it came out of never froze once.',
  },
  voidperch: {
    id: 'voidperch', name: 'Void Perch', rarity: 'mythic', base: 360, w: 0.45,
    body: 'deep', depthR: 0.38, wideR: 0.40, head: 'blunt', tail: 'lunate',
    dorsal: 'spiny', pect: 'long', pattern: 'gradient', eye: 0.36,
    cols: [0x161428, 0x2e2a4e, 0x8a7aff], extras: ['shine', 'teeth'],
    len: [0.35, 0.70], depth: 1.00, zone: 0.82, night: 2.6,
    speed: 0.74, restless: 2.4, dart: 1.00, pause: 0.26, drift: 0.30, fight: 2.30,
    blurb: 'Perfectly ordinary in shape. Nothing else about it is ordinary at all.',
  },

  /* ---------------------------------------------------------- DIVINE ---- */
  riverfather: {
    id: 'riverfather', name: 'The River Father', rarity: 'divine', base: 620, w: 0.16,
    body: 'torpedo', depthR: 0.36, wideR: 0.68, head: 'whisker', tail: 'fan',
    dorsal: 'ridge', pect: 'wing', pattern: 'marble', eye: 0.14,
    cols: [0x3e5a4a, 0xe4dcb8, 0xc8a84a], extras: ['barbels', 'plates', 'trailing', 'shine'],
    len: [1.60, 2.80], depth: 0.90, zone: 0.88, night: 1.2,
    speed: 0.46, restless: 0.9, dart: 0.70, pause: 0.40, drift: 0.18, fight: 2.80,
    blurb: 'Every village tells a story about this fish. They are all the same story.',
  },
  auroraeel: {
    id: 'auroraeel', name: 'Aurora Eel', rarity: 'divine', base: 700, w: 0.13,
    body: 'ribbon', depthR: 0.12, wideR: 0.62, head: 'pointed', tail: 'ribbon',
    dorsal: 'sail', pect: 'small', pattern: 'gradient', eye: 0.24,
    cols: [0x1a3a4a, 0x9ff0d8, 0x7a9fff], extras: ['lantern', 'trailing', 'shine'],
    len: [1.40, 2.60], depth: 1.00, zone: 0.92, night: 4.0,
    speed: 0.88, restless: 2.2, dart: 0.95, pause: 0.18, drift: 0.48, fight: 2.60,
    blurb: 'The light comes off it in sheets. You will not sleep the night you catch one.',
  },

  /* ------------------------------------------------------------- ??? ---- */
  thefirstfish: {
    id: 'thefirstfish', name: 'The First Fish', rarity: 'unknown', base: 1400, w: 0.03,
    body: 'torpedo', depthR: 0.42, wideR: 0.66, head: 'hooked', tail: 'lunate',
    dorsal: 'sail', pect: 'wing', pattern: 'marble', eye: 0.20,
    cols: [0x2a2a38, 0xf4ecd0, 0xd8c070],
    extras: ['plates', 'barbels', 'teeth', 'trailing', 'shine', 'lantern'],
    len: [2.20, 3.60], depth: 1.00, zone: 0.96, night: 1.6,
    speed: 0.66, restless: 2.8, dart: 1.20, pause: 0.22, drift: 0.34, fight: 3.20,
    blurb: 'It was here before the water was. Nobody has any idea what to do with it.',
  },
};

export const FISH_LIST = Object.values(FISH);

/**
 * SHARE IS THE KNOB, NOT A WISH.
 *
 * The first version set a `w` on every species by hand and hoped the tiers
 * came out near their stated shares. They did not — Uncommon ran at 37% and
 * Mythic at a ninth of its target — because the depth and zone fits multiply
 * into the weight and there is no way to keep thirty hand-picked numbers in
 * agreement with nine targets. So `w` now only says how a species compares
 * to its OWN tier-mates, and this table converts a tier's `share` into the
 * weight budget those species divide between them. Change `share` and the
 * frequency changes; add a species and nothing else has to move.
 */
const TIER_BUDGET = (() => {
  const out = {};
  for (const R of FISH_RARITY) {
    const inTier = FISH_LIST.filter(f => f.rarity === R.id);
    const sum = inTier.reduce((a, f) => a + f.w, 0) || 1;
    out[R.id] = (R.share * 1000) / sum;
  }
  return out;
})();

/** Every species, grouped for the almanac and the tests. */
export const BY_RARITY = FISH_RARITY.map(r => ({
  ...r, fish: FISH_LIST.filter(f => f.rarity === r.id),
}));

/* ========================================================================= */
/* ROLLING A CATCH                                                           */
/* ========================================================================= */

/**
 * What is on the end of the line.
 *
 * Three things push the roll: how DEEP the water is, how FAR from home you
 * are, and what ROD you are using. Depth and zone decide which species fit
 * at all; the rod's `luck` and `rareChance` then bias the pick up the rarity
 * table and make mutations more likely. A better rod does not catch a
 * different fish in the same pond — it catches the pond's better fish more
 * often, and lets you reach ponds that have better fish in them.
 */
/* ========================================================================= */
/* EVERY WATER IS ITS OWN WATER                                              */
/* ========================================================================= */

/**
 * The character of a body of water, and what lives in it.
 *
 * Until now a pool's stock was decided entirely by how deep it was and
 * how far from the village — so two lakes the same distance out held
 * the same fish, and discovering a new one told you nothing you did not
 * already know. Walking to a lake should be worth doing for its own
 * sake: "what can I catch HERE" is the question the whole activity
 * hangs on.
 *
 * Each water therefore gets a CHARACTER, rolled once from its own seed
 * and stable forever, which bends the table: a peat pool is thick with
 * the things that like dark water and nearly empty of the rest, a clear
 * mountain tarn is the other way round. The bend is strong enough to
 * notice and weak enough that nothing is ever locked out — you can
 * still catch a perch in a tarn, it is just not what the tarn is for.
 *
 * Distance is untouched by this. A shallow weedy pond in the far wood
 * still holds far-wood fish; its character decides WHICH far-wood fish.
 * Progression and variety are separate axes, and mixing them is how you
 * get a late lake that is worse than an early one.
 */
/*
 * NO TWO OF THESE MAY SHARE A SIGNATURE.
 *
 * The first draft gave Deep and Cold the same `likes` — torpedo and
 * deep-bodied — and they came out three per cent apart, which is to say
 * they were the same lake with two names. The whole value of this
 * system is that arriving at new water is worth something, so the
 * like/hate pairs are deliberately spread across all eight body shapes
 * and checked against each other. Adding a seventh water means picking
 * a pair nothing else uses.
 */
export const WATERS = [
  {
    id: 'weedy', name: 'Weedy', blurb: 'Thick with weed. Slow water, and plenty in it.',
    likes: ['flat', 'globe'], hates: ['torpedo', 'needle'], boost: 2.2, damp: 0.38,
  },
  {
    id: 'peat', name: 'Peat-dark', blurb: 'Black water. You cannot see your own hook.',
    likes: ['eel', 'deep'], hates: ['ray'], boost: 2.3, damp: 0.40, night: 1.35,
  },
  {
    id: 'clear', name: 'Gin-clear', blurb: 'You can count the stones on the bottom.',
    likes: ['torpedo', 'needle'], hates: ['eel', 'globe'], boost: 2.2, damp: 0.38,
  },
  {
    id: 'deep', name: 'Deep', blurb: 'It shelves away fast a yard from the bank.',
    likes: ['ray', 'deep'], hates: ['flat'], boost: 2.4, damp: 0.42, depth: 0.22,
  },
  {
    id: 'reedy', name: 'Reedy', blurb: 'More reed than water at the margins.',
    likes: ['ribbon', 'eel'], hates: ['deep', 'ray'], boost: 2.2, damp: 0.40,
  },
  {
    id: 'cold', name: 'Cold', blurb: 'Snowmelt. Your paws ache after a minute.',
    likes: ['torpedo', 'ray'], hates: ['globe', 'flat'], boost: 2.1, damp: 0.42, rare: 1.20,
  },
];
export const WATER_BY_ID = Object.fromEntries(WATERS.map(w => [w.id, w]));

/**
 * Which water this is, decided from its position alone.
 *
 * Position, not a stored id, so it is stable across saves, identical on
 * every machine, and works for the river as well as for the lakes —
 * and so a lake that has not been generated yet still has a known
 * character the moment the player walks up to it.
 *
 * @param key  something stable for this body of water: a lake's centre,
 *             or a coarse cell of the river.
 */
export function waterAt(kx, kz) {
  const h = hash2(Math.round(kx), Math.round(kz), 0x77a7e4) / 4294967296;
  const W = WATERS[Math.floor(h * WATERS.length) % WATERS.length];
  /* a speciality: the one species this water is KNOWN for, which is what
     makes a pool worth coming back to rather than just worth visiting */
  const h2 = hash2(Math.round(kx), Math.round(kz), 0x1d3b57) / 4294967296;
  const pool = FISH_LIST.filter(f => W.likes.includes(f.body));
  const star = pool.length ? pool[Math.floor(h2 * pool.length) % pool.length] : null;
  return { ...W, star: star ? star.id : null, key: `${Math.round(kx)},${Math.round(kz)}` };
}

export function rollFish(seed, {
  depth = 0.4, remoteness = 0.3, zone = 0, night = false,
  luck = 1, rareChance = 1, water = null,
} = {}) {
  const r = makeRng(seed >>> 0);
  const d = clamp01(depth * 0.62 + remoteness * 0.5);
  const z = clamp01(Math.max(zone, remoteness));

  const pick = r.weighted(FISH_LIST, f => {
    /* wrong depth: it is simply not in this part of the water column */
    const fit = 1 - clamp01(Math.abs(f.depth - d) * 1.6);
    /* wrong zone: a Void Perch is not in the village pond at any odds, and a
       Pebble Perch thins out (but never vanishes) as you go deeper in */
    const need = f.zone;
    if (z < need - 0.14) return 0;
    const far = clamp01((z - need) * 1.6);
    const common = rarityOf(f.rarity).index === 0 ? lerp(1, 0.45, z) : 1;
    let w = f.w * TIER_BUDGET[f.rarity] * (0.12 + fit * fit * 2.3) * (0.35 + far * 0.9) * common;
    if (night) w *= f.night; else if (f.night > 1.6) w *= 0.35;

    /* THE CHARACTER OF THIS PARTICULAR WATER. Applied as a multiplier on
       body shape rather than on species, so it needs no per-fish table
       and a fish added later is placed sensibly by its own anatomy: an
       eel belongs in peat and reeds whatever else is true about it. */
    if (water) {
      if (water.likes?.includes(f.body)) w *= water.boost ?? 1.8;
      else if (water.hates?.includes(f.body)) w *= water.damp ?? 0.5;
      /* and the speciality, which is the reason to walk back to a pool */
      if (water.star === f.id) w *= 2.4;
      if (water.night && night) w *= water.night;
      if (water.rare && rarityOf(f.rarity).index >= 3) w *= water.rare;
    }
    /* the rod tilts the whole table upwards rather than adding a flat bonus,
       so a good rod feels like better water rather than a coupon */
    const ri = rarityOf(f.rarity).index;
    if (ri >= 2) w *= Math.pow(rareChance, ri - 1);
    return w;
  });

  const len = r.range(pick.len[0], pick.len[1]);
  const size = clamp01((len - pick.len[0]) / Math.max(1e-6, pick.len[1] - pick.len[0]));
  const mut = rollMutation(r, luck);

  return makeCatch(pick, {
    seed: seed >>> 0, len, size, mutation: mut ? mut.id : null,
    move: {
      speed: pick.speed * r.range(0.85, 1.2),
      restless: pick.restless * r.range(0.8, 1.3),
      dart: pick.dart * r.range(0.85, 1.2),
      pause: clamp01(pick.pause * r.range(0.8, 1.25)),
      drift: pick.drift * r.range(0.8, 1.2),
      fight: pick.fight * r.range(0.9, 1.15) * lerp(0.85, 1.3, size),
    },
  });
}

/** Build the catch record from a species and a roll. Also used by the save. */
export function makeCatch(spec, { seed, len, size, mutation, move }) {
  const m = mutation ? MUTATION_BY_ID[mutation] : null;
  const shown = len * (m?.scale ?? 1);
  return {
    id: spec.id,
    name: spec.name,
    rarity: spec.rarity,
    mutation: mutation || null,
    blurb: spec.blurb,
    seed: seed >>> 0,
    len: Math.round(shown * 100) / 100,
    baseLen: len,
    size,
    move,
    value: fishValue(spec, size, m),
  };
}

/**
 * THE ONE VALUE FORMULA.
 *
 *   base x rarity x mutation x size
 *
 * Size runs 0.78..1.65 across a species' length range, so a record specimen
 * of a common fish can be worth more than a runt of the tier above — which is
 * the only reason to care how big the thing on your line is.
 */
export function fishValue(spec, size = 0.5, mutation = null) {
  const m = typeof mutation === 'string' ? MUTATION_BY_ID[mutation] : mutation;
  const v = spec.base
    * rarityOf(spec.rarity).mult
    * (m?.mult ?? 1)
    * lerp(0.78, 1.65, clamp01(size));
  return Math.max(1, Math.round(v));
}

/** Recompute the value of a stored catch (the save keeps the inputs). */
export function catchValue(f) {
  const spec = FISH[f.id];
  if (!spec) return f.value || 1;
  return fishValue(spec, f.size ?? 0.5, f.mutation);
}

/** The full display name: "Albino Marble Koi". */
export function fishTitle(f) {
  const m = f.mutation ? MUTATION_BY_ID[f.mutation] : null;
  /* THE SPECIES IS THE FALLBACK, because a record that has lost its
     `name` still knows what it is. `makeCatch` always writes one, but the
     catch card is the loudest moment in the game and the failure mode of
     trusting the field was the word "undefined" in forty-point display
     type across the middle of the screen. An old save, a hand-built
     record or a future code path should not be able to do that. */
  const name = f.name || FISH[f.id]?.name || 'a strange fish';
  return m ? `${m.name} ${name}` : name;
}

/** How loudly to announce a catch: 0 quiet, 3 stop-everything. */
export function catchDrama(f) {
  const ri = rarityOf(f.rarity).index;
  const m = f.mutation ? MUTATION_BY_ID[f.mutation] : null;
  let d = ri >= 7 ? 3 : ri >= 5 ? 2 : ri >= 3 ? 1 : 0;
  if (m && m.mult >= 12) d = Math.max(d, 2);
  else if (m) d = Math.max(d, 1);
  return d;
}

/** Legacy shim: the old code asked for a 0..6 tier. */
export function fishTier(f) {
  return clamp(rarityOf(f.rarity).index, 0, FISH_RARITY.length - 1);
}
