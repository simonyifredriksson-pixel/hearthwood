/* Config.js — every number worth arguing about, in one place.
   ===========================================================================
   If a value appears in two files, it belongs here instead. The world layout
   numbers in particular are load-bearing: the whole design rests on the
   village being *small* compared to the wood around it, and that is a ratio
   you can only keep honest if it is written down.
*/

export const BUILD = 'v1';

/* ------------------------------------------------------------------ world */

export const WORLD = {
  /** The map runs from -half to +half on both axes. 1800 m across. */
  half: 900,
  get size() { return this.half * 2; },
  get area() { return this.size * this.size; },        // 3,240,000 m²

  seed: 0x48454152,              // "HEAR" — Hearthwood's one true seed

  /** Terrain tile edge, in metres. Detail streams a tile at a time.
   *  64 rather than 100 so the full-detail ring can be tight: the cost of
   *  a tile grows with its AREA, and a 100 m tile of near-detail forest is
   *  two and a half times the work of a 64 m one. */
  tile: 64,

  /** Height field. */
  seaLevel: 0.0,
  hillAmp: 34,                   // rolling woodland
  mountainAmp: 168,              // the ring of peaks that closes the map
  mountainStart: 0.62,           // fraction of `half` where the rise begins

  /* --- the village occupies ~3% of the map, and that is the whole point --- */
  village: {
    cx: -60, cz: 110,            // sat in a sheltered bowl, off-centre
    /** Outer edge of village land (fences, farms, orchard). */
    radius: 176,                 // π·176² = 97,300 m² = 3.00% of the map
    /** The built-up core: houses, market, workshop. */
    core: 96,
    /** Ground inside this is levelled toward the village datum. */
    flatten: 150,
    datum: 6.5,                  // the height the village sits at
  },

  /** The river runs past the village and out to the map edge. */
  river: {
    width: 7.5,
    depth: 2.4,
    bankWidth: 13,
  },
};

/** Percentage of the map that is village — computed, not asserted, so it can
 *  never quietly drift away from the design. */
export const villageFraction = () =>
  (Math.PI * WORLD.village.radius * WORLD.village.radius) / WORLD.area;

/* ----------------------------------------------------------------- render */

export const RENDER = {
  fov: 58,
  near: 0.15,
  far: 1400,

  /** Fog is atmospheric haze, not a wall: it is the colour of the sky at the
   *  horizon, so distant hills fade into the sky instead of into grey soup. */
  fogDensity: 0.0020,

  shadow: {
    size: 2048,
    /** Half-extent of the shadow camera box that follows the player. */
    extent: 62,
    near: 1,
    far: 260,
    bias: -0.0009,
    normalBias: 0.035,
  },

  /** Detail streaming radii, in metres from the player. */
  detailNear: 192,        // full merged geometry: trees, bushes, ferns, rocks
  detailFar: 900,         // cheap silhouette tier
  grassRadius: 120,
  /** Live, individually pickable stick meshes.
   *  Each one is its own draw call, so this is a HARD budget rather than a
   *  view distance: at 92 m there were six hundred and sixty of them on
   *  screen at once. Beyond this the forest floor is carried by the merged
   *  brash and twigs in the tile scatter, which cost nothing. */
  stickRadius: 36,
  tileBudgetMs: 7,        // per-frame world-building slice
};

/* ----------------------------------------------------------------- player */

export const PLAYER = {
  /** Per species: these are *feel* numbers and they differ a lot on purpose. */
  eyeHeight: 1.0,
  gravity: -22,
  stepUp: 0.55,           // how tall a ledge you can walk straight up
  slopeLimit: 0.72,       // cos of the steepest walkable slope (~44°)
  interactRange: 2.6,     // reach for picking things up
  npcTalkRange: 3.4,
};

/* -------------------------------------------------------------------- cam */

export const CAM = {
  sensitivity: 1,
  invertY: false,
};

/* --------------------------------------------------------------- gameplay */

export const GAME = {
  satchelBase: 24,        // sticks you can carry
  satchelMax: 60,

  /** Sticks per square metre in ordinary woodland. Multiplied by a local
   *  density field, so groves under old trees are thick with fallen wood and
   *  open meadows have almost none. */
  stickDensity: 1 / 190,

  /** Rare forms are gated behind this: the deeper into the wood you are, the
   *  better the odds. 0 at the village fence, 1 at the far mountains. */
  remotenessBoost: 2.6,

  autosaveSeconds: 45,
};

/* ------------------------------------------------------------------ audio */

export const AUDIO = {
  master: 0.72,
  music: 0.42,
  ambience: 0.6,
  sfx: 0.85,
};

export const SAVE_KEY = 'hearthwood.save.v1';
