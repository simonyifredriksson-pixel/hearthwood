/* Palette.js — the colour language of Hearthwood.
   ===========================================================================
   One place for every colour, because a cozy world is a world whose colours
   agree with each other. The rules this palette follows:

   1. NOTHING IS GREY. Every neutral leans warm (stone, thatch, fur) or cool
      (shadowed rock, water). A true grey in a sunlit wood reads as dead.
   2. GREENS VARY IN HUE, NOT JUST BRIGHTNESS. A forest where every leaf is
      the same hue at different lightness looks like a colour ramp. Real
      canopy runs from yellow-green through to blue-green, and that spread is
      most of what makes a wide shot look painted rather than generated.
   3. SHADOWS ARE BLUE, LIGHT IS GOLD. The whole world is lit at late
      afternoon, so anything in shade picks up the sky and anything lit picks
      up the sun.
*/

/** Hex helpers that work on plain numbers, so this file needs no three.js. */
export const rgb = (r, g, b) => ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
export const chan = h => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

export function mixHex(a, b, t) {
  const [ar, ag, ab] = chan(a), [br, bg, bb] = chan(b);
  return rgb(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

export function shade(hex, amount) {
  const [r, g, b] = chan(hex);
  if (amount >= 0) return rgb(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
  const k = 1 + amount;
  return rgb(r * k, g * k, b * k);
}

/** Nudge a colour's hue/saturation/lightness. The workhorse of variation. */
export function tweak(hex, { h = 0, s = 1, l = 1 } = {}) {
  let [r, g, b] = chan(hex).map(v => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hh = 0, ss = 0; const ll = (max + min) / 2;
  const d = max - min;
  if (d > 1e-6) {
    ss = ll > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hh = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) hh = (b - r) / d + 2;
    else hh = (r - g) / d + 4;
    hh /= 6;
  }
  hh = (hh + h + 1) % 1;
  ss = Math.max(0, Math.min(1, ss * s));
  const L = Math.max(0, Math.min(1, ll * l));
  if (ss < 1e-6) return rgb(L * 255, L * 255, L * 255);
  const q = L < 0.5 ? L * (1 + ss) : L + ss - L * ss;
  const p = 2 * L - q;
  const f = t => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return rgb(f(hh + 1 / 3) * 255, f(hh) * 255, f(hh - 1 / 3) * 255);
}

/* =========================================================== SKY & LIGHT */

export const SKY = {
  zenith: 0x4e87c4,
  mid: 0x8fb6dd,
  horizon: 0xd9dfc8,
  haze: 0xe4e2cd,          // fog colour: the horizon, so distance = haze not soup
  sun: 0xfff0cc,
  sunDisc: 0xfff6d8,
  cloud: 0xfdfaf0,
  cloudShade: 0xc3cede,

  duskZenith: 0x2d3f70,
  duskHorizon: 0xe9a468,
  nightZenith: 0x141d38,
  nightHorizon: 0x35406a,
};

export const LIGHT = {
  sun: 0xfff2d2,
  sunIntensity: 2.05,
  skyAmbient: 0xa8c4e8,
  groundBounce: 0x6e7346,
  hemiIntensity: 1.12,
  fill: 0xbcd0e8,
  fillIntensity: 0.30,
};

/* ================================================================ GROUND */

export const GROUND = {
  grass: 0x6f8a3c,
  grassDry: 0x93994a,
  grassLush: 0x55813a,
  grassShade: 0x41602f,
  moss: 0x5f8a41,
  mossDeep: 0x3f6b33,
  dirt: 0x7a6144,
  dirtDark: 0x5b4732,
  mud: 0x4f4130,
  mudWet: 0x3c3323,
  // Litter is much browner and darker than people reach for. The first
  // values shared a blue channel with the grass, so mixing them together
  // only slid the hue along the olive axis and the forest floor stayed
  // bright green-yellow whatever the mix weight was.
  leafLitter: 0x6b4a28,
  leafLitter2: 0x86633a,
  pineNeedle: 0x54412a,
  sand: 0xc4ae7e,
  gravel: 0x8c8878,
  rock: 0x8a8a84,
  rockDark: 0x5f6165,
  rockWarm: 0x9a8f7c,
  snow: 0xe8eef2,
  path: 0xa3947a,
  pathStone: 0x9b9a92,
  farmSoil: 0x5e4a33,
};

/* ================================================================== WOOD */

/* Bark is where most of the variety in a wood actually lives. These are
   whole-species colours; StickGen and TreeGen pull hue and lightness around
   them per individual, so no two trunks are the same brown. */
export const BARK = {
  oak: 0x6b5541,
  oakDark: 0x4b3c2d,
  birch: 0xdfd8c6,
  birchMark: 0x4a4740,
  pine: 0x7a5238,
  pineDark: 0x553824,
  ash: 0x8d8574,
  willow: 0x6f6349,
  rowan: 0x7d6f5d,
  hazel: 0x8a6c4c,
  elder: 0x5c5040,
  deadWood: 0x8f8574,
  freshCut: 0xcbb083,
  peeled: 0xd8c9a4,        // the pale wood of a stripped branch
  wet: 0x3f3226,
  charred: 0x2e2a26,
};

/* Deliberately spread across the green HUES — see rule 2 at the top — and
   deliberately darker than they look on a colour picker. Leaf green sampled
   from a photograph is much deeper than the green people reach for, and a
   canopy painted in picker-green comes out looking like lettuce. */
export const LEAF = {
  oak: 0x4a7229,
  oakAutumn: 0xa86e2a,
  birch: 0x709440,
  beech: 0x587f2c,
  pine: 0x2f5a3c,
  pineBlue: 0x2a5044,
  willow: 0x6f8e40,
  maple: 0x658030,
  mapleRed: 0x9a4628,
  rowan: 0x557c3a,
  hazel: 0x5f7c32,
  young: 0x86a747,
  shade: 0x2c4a26,
  dead: 0x8a6c38,
};

export const PLANT = {
  fern: 0x4f7a38,
  fernPale: 0x6d9145,
  bush: 0x527f38,
  bushDry: 0x76823f,
  bramble: 0x3f5f2f,
  reed: 0x8a9a4a,
  nettle: 0x4a7034,
  cloverFlower: 0xf2f0e2,
  flowerWhite: 0xf6f4e8,
  flowerYellow: 0xf2cf54,
  flowerBlue: 0x7a8fd0,
  flowerPink: 0xe098b4,
  flowerRed: 0xd2503f,
  flowerPurple: 0x9a72c0,
  flowerOrange: 0xe89347,
  foxglove: 0xc86fb0,
  heather: 0xa4739e,
};

/* Fungi get their own table because they are the game's small delights, and
   because a stick with three tiny orange brackets on it is worth more to a
   player than any number I could print next to it. */
export const MUSHROOM = {
  flyAgaricCap: 0xc4402c,
  flyAgaricSpot: 0xf4efdf,
  flyAgaricStem: 0xefe6cf,
  boleteCap: 0x8a5b34,
  boleteStem: 0xd6c39a,
  inkcapCap: 0xcfc6ae,
  inkcapStem: 0xe3dcc8,
  bracketTop: 0x7c5a38,
  bracketLip: 0xdccfae,
  chanterelle: 0xdda23e,
  glowCap: 0x7fd8c0,       // the rare ones, deep in the wood
  glowStem: 0xcfeee4,
  puffball: 0xd9cfb4,
  toadstoolPurple: 0x8a6bb0,
};

export const MOSS = {
  bright: 0x7ca23f,
  mid: 0x5d8a37,
  deep: 0x3f6a2e,
  grey: 0x8f9c72,          // lichen
  lichenPale: 0xb6bfa0,
  lichenMint: 0x9fc4a8,
};

/* ============================================================== VILLAGE */

export const BUILD = {
  daub: 0xe4d9bf,          // the pale infill of a timber-framed wall
  daubWarm: 0xe8d4ac,
  daubPink: 0xe0c6ae,
  daubGreen: 0xd6d6bc,
  beam: 0x4a3626,          // the dark timbers
  beamPale: 0x6a5238,
  thatch: 0xbfa062,
  thatchOld: 0x9d8451,
  thatchRidge: 0x8a7343,
  shingle: 0x6d5a45,
  shingleMoss: 0x5f6642,
  slate: 0x565d63,
  tileClay: 0xa4593c,
  tileClayOld: 0x8d5340,
  stone: 0x9b9384,
  stoneDark: 0x6f6a5f,
  stoneWarm: 0xab9c83,
  mortar: 0xbdb6a3,
  plank: 0x8a6a45,
  plankOld: 0x6f573b,
  plankPale: 0xb59a6f,
  door: 0x5a3f2a,
  doorPainted: 0x3f5a52,
  windowFrame: 0x4b3728,
  glassLit: 0xffd98a,
  glassDark: 0x2e3a42,
  chimney: 0x8f8375,
  iron: 0x3c3c40,
  ironRust: 0x6b4a33,
  copper: 0x7fae9b,
  brass: 0xc09a4a,
  rope: 0xbaa077,
  cloth: 0xc9bda2,
  clothRed: 0xa8483c,
  clothBlue: 0x476f92,
  clothGreen: 0x5c7a45,
  clothGold: 0xd0a447,
  clothCream: 0xe4d8bc,
  lanternGlow: 0xffbe63,
  fire: 0xff9436,
  fireHot: 0xffd98e,
  ember: 0xd2431f,
};

/* ================================================================= WATER */

export const WATER = {
  shallow: 0x6f9c92,
  deep: 0x2f5a5e,
  streamBed: 0x5a5342,
  foam: 0xeef4ee,
  reflectTint: 0xa8c8d8,
};

/* ============================================================ CHARACTERS */

export const FUR = {
  /* Playable animals. Each species owns a hue family so the three read as
     different creatures from across a clearing, not as three palette swaps. */
  /* Lifted and softened to match the fox: the old greens were swamp-dark and
     the countershading between back and belly was hard enough to read as a
     marking rather than as a shape. */
  frogBody: 0x8ecb63,
  frogBelly: 0xf2f4cc,
  frogBack: 0x6fae4d,
  frogSpot: 0x63a045,
  frogEye: 0xf0c85a,
  frogThroat: 0xdceca0,

  /* Softened and warmed. The old fox was a saturated rust-orange with almost
     black socks, which at this size reads as a wild animal rather than as a
     character — the contrast does the same work a hard outline does. A
     honey-gold body against cream, with brown boots instead of black, is the
     same fox with the harshness taken out of it. */
  foxBody: 0xe2a049,
  foxBelly: 0xfaf0dc,
  foxTip: 0xfdf8ee,
  foxSock: 0x8a6448,
  foxEar: 0xd08a5c,
  foxEye: 0x9a6a38,

  bearBody: 0x6d4f38,
  bearBelly: 0x9c7c58,
  bearMuzzle: 0xbfa079,
  bearPaw: 0x4a3627,
  bearEye: 0x2e241c,

  /* Villagers. */
  rabbit: 0xb8ab97,
  rabbitIn: 0xe0d6c2,
  mouse: 0x9a8a78,
  mouseIn: 0xd6c9b6,
  badger: 0x3f3c3a,
  badgerWhite: 0xe8e4d8,
  hedgehog: 0x6a5a45,
  hedgehogSpine: 0x4a3f30,
  otter: 0x6b5a45,
  otterIn: 0xc0ab8c,
  hare: 0xa89a7e,
  hareSilver: 0xcfc7b4,
  squirrel: 0xa05f33,
  squirrelIn: 0xe2d4bc,
  deer: 0x9c7a52,
  deerIn: 0xd8c4a4,
  cat: 0x8a7a66,
  chicken: 0xe8dcc2,
  chickenComb: 0xc4402c,
  goat: 0xcfc4ae,
  pig: 0xd4a49a,
  duck: 0x7a6e50,
};

/* Villager clothing — muted, dyed-with-plants colours. Nothing saturated:
   medieval cloth was never neon, and a village of neon is a theme park. */
export const CLOTH = [
  0x8a4a3c, 0x6d7a48, 0x4a6272, 0x8d7440, 0x7a5570, 0x53704f,
  0xa87a4a, 0x5c5a75, 0x9a6a52, 0x6b8272, 0x8c6f8a, 0x76664a,
];

export const METAL = {
  iron: 0x54585e,
  ironDark: 0x35383d,
  steel: 0x8a9099,
  bronze: 0x9a7038,
  gold: 0xc9a13e,
  rust: 0x8a4e2c,
  nail: 0x494c52,
};

/* ================================================================ UI/FX */

export const UI = {
  parchment: 0xefe3c8,
  ink: 0x3a2c1e,
  gold: 0xc8a34a,
  green: 0x6f9046,
  highlight: 0xffe08a,
  glow: 0xffd98a,
  rare: 0x9fd0e8,
  wondrous: 0xe0a8f0,
};

/**
 * Rarity, indexed by tier. Used by the UI, the pickup chime and the glow.
 *
 * Seven tiers, and the share each one is MEANT to be — if everything is
 * Legendary then nothing is, so the roll is tuned against this table and
 * test_world asserts the real distribution against it. The last tier has no
 * name on purpose: you will see perhaps one, and it should not have a word
 * that tells you how it ranks.
 */
export const RARITY = [
  { name: 'Common', hex: 0xcfc6ae, css: '#cfc6ae', share: 0.52 },
  { name: 'Uncommon', hex: 0x8fc46a, css: '#8fc46a', share: 0.26 },
  { name: 'Rare', hex: 0x6fb6e0, css: '#6fb6e0', share: 0.13 },
  { name: 'Epic', hex: 0xb08ae8, css: '#b08ae8', share: 0.060 },
  { name: 'Legendary', hex: 0xf2c159, css: '#f2c159', share: 0.023 },
  { name: 'Mythic', hex: 0xf4746a, css: '#f4746a', share: 0.006 },
  { name: '???', hex: 0xd8fbff, css: '#d8fbff', share: 0.001 },
];

export const MAX_TIER = RARITY.length - 1;

export const cssHex = h => '#' + (h >>> 0).toString(16).padStart(6, '0');

/**
 * THE SAME COLOUR, FOR TEXT ON PARCHMENT.
 *
 * Every rarity colour in the game — weapon tiers, fish tiers, mutations —
 * was picked to glow on a dark HUD or against the wood. Printed as text on
 * the satchel's parchment it ranges from faint to invisible: Common is a
 * pale warm grey on pale warm paper, and ??? is very nearly white.
 *
 * The panels used to dodge this by only colouring tier 2 and above, which
 * left Legendary and ??? — the two the player most wants to see — as the
 * worst offenders. So: one function, used by every parchment panel, that
 * takes the world colour and returns the same HUE at an ink weight paper
 * can carry. Saturation is pushed up FIRST, because merely darkening a
 * pale tint gives mud and the entire job of the colour is to say which
 * tier this is at a glance.
 *
 * @param {string} css   '#rrggbb'
 * @param {number} target relative luminance to land at; 0.20 is about the
 *                        weight of the body ink beside it.
 */
export function onPaper(css, target = 0.20) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(css || '').trim());
  if (!m) return css;
  const n = parseInt(m[1], 16);
  let r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;

  const mid = (Math.max(r, g, b) + Math.min(r, g, b)) * 0.5;
  const SAT = 1.5;
  r = Math.min(1, Math.max(0, mid + (r - mid) * SAT));
  g = Math.min(1, Math.max(0, mid + (g - mid) * SAT));
  b = Math.min(1, Math.max(0, mid + (b - mid) * SAT));

  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (lum > target) {
    const k = target / Math.max(1e-4, lum);
    r *= k; g *= k; b *= k;
  }
  const h = x => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
