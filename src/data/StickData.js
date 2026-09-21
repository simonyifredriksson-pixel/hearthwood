/* StickData.js — what a stick IS.
   ===========================================================================
   A stick in Hearthwood is a bag of numbers, rolled once from a seed and then
   never changed. The mesh is generated from those numbers (StickGen.js), the
   name is generated from those numbers, and the weapons it can become are
   decided by those numbers. Nothing is hand-placed and nothing is a copy:
   there are more distinguishable sticks in this game than a player could pick
   up in a lifetime of afternoons.

   The design intent, in one line: A PLAYER SHOULD BE ABLE TO TELL TWO STICKS
   APART FROM ACROSS A CLEARING. That means variation has to live in silhouette
   — length, thickness, curvature, forks, a burl, a spiral — and not only in
   tint, because tint is invisible at ten metres and silhouette is not.
*/

import { makeRng, clamp, lerp, hash2, TAU } from '../core/Util.js?v=20260921164117';
import { BARK, MOSS, MUSHROOM, LEAF, RARITY } from '../art/Palette.js?v=20260921164117';

/* ========================================================================= */
/* SPECIES — the wood itself                                                 */
/* ========================================================================= */

export const SPECIES = {
  oak: {
    name: 'oak', label: 'Oak', w: 20,
    bark: BARK.oak, inner: 0xa07a52, ridge: 0.55, grain: 1.0,
    lenMul: 1.05, thickMul: 1.25, crook: 1.1, hardness: 1.3, leaf: LEAF.oak,
    blurb: 'Hard, heavy, stubborn. Everything made of it outlives the maker.',
  },
  ash: {
    name: 'ash', label: 'Ash', w: 15,
    bark: BARK.ash, inner: 0xd8c8a4, ridge: 0.3, grain: 0.7,
    lenMul: 1.2, thickMul: 0.95, crook: 0.55, hardness: 1.15, leaf: LEAF.rowan,
    blurb: 'Straight and springy. The old spear-wood, and it knows it.',
  },
  hazel: {
    name: 'hazel', label: 'Hazel', w: 18,
    bark: BARK.hazel, inner: 0xc9ab7c, ridge: 0.25, grain: 0.5,
    lenMul: 1.1, thickMul: 0.75, crook: 0.7, hardness: 0.85, leaf: LEAF.hazel,
    blurb: 'Grows long and true from the coppice stool. Light in the hand.',
  },
  birch: {
    name: 'birch', label: 'Birch', w: 14,
    bark: BARK.birch, inner: 0xe4d8b8, ridge: 0.12, grain: 0.35, papery: true,
    lenMul: 1.0, thickMul: 0.8, crook: 0.5, hardness: 0.8, leaf: LEAF.birch,
    blurb: 'Pale as a bone and marked like weather on a wall.',
  },
  pine: {
    name: 'pine', label: 'Pine', w: 13,
    bark: BARK.pine, inner: 0xd6b489, ridge: 0.7, grain: 1.2,
    lenMul: 1.15, thickMul: 1.0, crook: 0.45, hardness: 0.9, leaf: LEAF.pine,
    blurb: 'Sticky with resin and it never stops smelling of the hill.',
  },
  willow: {
    name: 'willow', label: 'Willow', w: 10,
    bark: BARK.willow, inner: 0xc4b48c, ridge: 0.4, grain: 0.8,
    lenMul: 1.25, thickMul: 0.7, crook: 1.5, hardness: 0.65, leaf: LEAF.willow,
    blurb: 'Bends rather than argues. Cut it and it grows back twice.',
  },
  rowan: {
    name: 'rowan', label: 'Rowan', w: 9,
    bark: BARK.rowan, inner: 0xd0b48c, ridge: 0.2, grain: 0.6,
    lenMul: 0.95, thickMul: 0.85, crook: 0.8, hardness: 1.0, leaf: LEAF.rowan,
    blurb: 'Hung over doorways since before anyone remembers why.',
  },
  elder: {
    name: 'elder', label: 'Elder', w: 7,
    bark: BARK.elder, inner: 0xbfae8a, ridge: 0.45, grain: 0.9, hollowProne: true,
    lenMul: 0.85, thickMul: 0.9, crook: 1.2, hardness: 0.55, leaf: LEAF.beech,
    blurb: 'Hollow-hearted. The Stickwright will not cut it after dark.',
  },
  blackthorn: {
    name: 'blackthorn', label: 'Blackthorn', w: 6,
    bark: 0x453a32, inner: 0x8a6a4a, ridge: 0.65, grain: 1.1, thorny: true,
    lenMul: 0.8, thickMul: 1.0, crook: 1.6, hardness: 1.45, leaf: LEAF.shade,
    blurb: 'Black, knotted and armed. Makes a cudgel nobody argues with.',
  },
  applewood: {
    name: 'applewood', label: 'Applewood', w: 5,
    bark: 0x6f5a44, inner: 0xd2a07a, ridge: 0.35, grain: 0.8,
    lenMul: 0.8, thickMul: 1.1, crook: 1.4, hardness: 1.2, leaf: LEAF.maple,
    blurb: 'From the orchard rows. Burns sweet and carves sweeter.',
  },
};

export const SPECIES_LIST = Object.values(SPECIES);

/* ========================================================================= */
/* FORMS — the body plan                                                     */
/* ========================================================================= */

/* `w` is the base weight; `remote` shifts the odds as you walk away from the
   village, so the deep wood is genuinely worth the walk. */
export const FORMS = {
  twig: {
    name: 'twig', label: 'Twig', w: 26, remote: -0.5,
    len: [0.28, 0.65], thick: [0.008, 0.016], crook: 1.2, forks: [0, 2], twigs: [0, 4],
  },
  switch: {
    name: 'switch', label: 'Switch', w: 20, remote: -0.2,
    len: [0.9, 1.7], thick: [0.012, 0.022], crook: 1.5, forks: [0, 1], twigs: [0, 3],
  },
  branch: {
    name: 'branch', label: 'Branch', w: 30, remote: 0,
    len: [0.7, 1.5], thick: [0.020, 0.040], crook: 1.0, forks: [0, 3], twigs: [0, 5],
  },
  bough: {
    name: 'bough', label: 'Bough', w: 16, remote: 0.3,
    len: [1.5, 2.6], thick: [0.038, 0.072], crook: 0.85, forks: [0, 3], twigs: [0, 4],
  },
  limb: {
    name: 'limb', label: 'Limb', w: 7, remote: 0.7,
    len: [2.4, 3.9], thick: [0.060, 0.115], crook: 0.7, forks: [1, 4], twigs: [0, 3],
  },
  root: {
    name: 'root', label: 'Root', w: 8, remote: 0.4,
    len: [0.7, 1.8], thick: [0.030, 0.070], crook: 2.4, forks: [1, 4], twigs: [0, 1],
  },
  stave: {
    name: 'stave', label: 'Stave', w: 9, remote: 0.5,
    len: [1.7, 2.3], thick: [0.026, 0.042], crook: 0.18, forks: [0, 0], twigs: [0, 1],
    straight: true,
  },
};

export const FORM_LIST = Object.values(FORMS);

/* ========================================================================= */
/* RARE FORMS — the ones you stop walking for                                */
/* ========================================================================= */

/* Every one of these is a SILHOUETTE, not a tint. You can see a serpentcoil
   from thirty metres away and you will walk over to it. `w` is per-thousand
   at full remoteness; near the village they are far rarer still. */
export const RARE = {
  serpentcoil: {
    name: 'serpentcoil', label: 'Serpentcoil', w: 12, tier: 3, minLen: 1.6,
    tags: ['spiral', 'straight'],
    desc: 'A honeysuckle vine throttled this sapling for years. The sapling won, ' +
      'but it grew around the wound — and now the spiral is part of the wood.',
  },
  knotbraid: {
    name: 'knotbraid', label: 'Knotbraid', w: 9, tier: 3, minLen: 1.2,
    tags: ['knotted', 'stout'],
    desc: 'Three stems that grew into one another until nobody could say which ' +
      'was which. Peeled, it looks like a rope carved out of bone.',
  },
  ringbough: {
    name: 'ringbough', label: 'Ringbough', w: 7, tier: 3, minLen: 1.0,
    tags: ['holed', 'flat'],
    desc: 'A fork that healed shut around an empty eye. Hold it up and you can ' +
      'look through the tree at the sky.',
  },
  maulhead: {
    name: 'maulhead', label: 'Maulhead', w: 8, tier: 3, minLen: 1.2,
    tags: ['heavy-head', 'stout'],
    desc: 'A burl the size of a loaf, grown hard as iron on the end of a limb. ' +
      'It wants to be swung and everybody who picks it up knows it.',
  },
  besom: {
    name: 'besom', label: 'Besom-bunch', w: 14, tier: 2, minLen: 1.1,
    tags: ['bristled', 'straight'],
    desc: 'A birch shoot that split into a hundred fine whips at the end. ' +
      'Bind it, and it sweeps. Bind it well, and it does other things.',
  },
  antler: {
    name: 'antler', label: 'Antlerwood', w: 7, tier: 3, minLen: 0.9,
    tags: ['forked', 'branching'],
    desc: 'Forked and forked again until it stopped looking like a branch and ' +
      'started looking like something that ran through the wood.',
  },
  driftbone: {
    name: 'driftbone', label: 'Driftbone', w: 8, tier: 2, minLen: 0.8,
    tags: ['pale', 'smooth'],
    desc: 'The river stripped the bark, the sun bleached it, and the current ' +
      'sanded it smooth as a river stone. Light as a promise.',
  },
  heartwood: {
    name: 'heartwood', label: 'Heartwood Core', w: 5, tier: 4, minLen: 1.4,
    tags: ['dense', 'straight', 'stout'],
    desc: 'The dark unrotted core of a fallen giant, after sixty winters ate ' +
      'everything softer. It rings when you knock it.',
  },
  lightningsplit: {
    name: 'lightningsplit', label: 'Lightning-split', w: 5, tier: 4, minLen: 1.3,
    tags: ['charred', 'split'],
    desc: 'Struck, split and thrown clear. Black down one side, raw down the ' +
      'other, and it still smells faintly of the storm.',
  },
  moonpale: {
    name: 'moonpale', label: 'Moonpale Bough', w: 3, tier: 4, minLen: 1.5,
    tags: ['glowing', 'mossy'],
    desc: 'Foxfire got into the grain. In daylight it is only a pale branch. ' +
      'After dusk it is the reason people tell children not to wander.',
  },
};

export const RARE_LIST = Object.values(RARE);

/* ========================================================================= */
/* SPECIAL MATERIALS — the thing that got INTO the wood                      */
/* ========================================================================= */

/**
 * These are the components that survive the forge.
 *
 * A special material is not a tint and not an aura: it is a substance with a
 * place in the wood — a seam, a crust, a set of nodules — and when the
 * Stickwright works the stick into a weapon he works AROUND it, so the same
 * crystal that grew through the branch is still growing through the blade.
 * That is the whole promise of the system, so every entry here carries the
 * numbers the mesh needs (`hex`, `glow`, `hard`), not just a label.
 *
 * `w` is a weight among specials, not an absolute rate — `specialChance`
 * below decides how often a stick has one at all, and it is deliberately low.
 */
export const MATERIALS = {
  amber: {
    name: 'amber', label: 'Amber', w: 14, hex: 0xd9932c, glow: 0.20, hard: 0.6,
    form: 'bead', likes: { resin: 1.9 },
    note: 'Old resin, run out of a wound and set hard as honey-coloured glass.',
  },
  ironvein: {
    /* Cool grey, not brown. The first version was 0x6d6055, which is very
       nearly oak bark — a seam of ore you cannot see is not a component. */
    name: 'ironvein', label: 'Ironvein', w: 12, hex: 0x5b646f, glow: 0, hard: 1.9,
    form: 'seam', likes: { high: 1.4 },
    note: 'A seam of ore drawn up through the heart, thin as a wire and twice as stubborn.',
  },
  crystal: {
    name: 'crystal', label: 'Crystal', w: 10, hex: 0x9fd8ef, glow: 0.35, hard: 1.5,
    form: 'shard', likes: { deep: 1.6, high: 1.3 },
    note: 'Quartz has grown out through the grain in clean blue-white shards.',
  },
  oldstone: {
    name: 'oldstone', label: 'Ancient Stone', w: 9, hex: 0xa7a396, glow: 0, hard: 1.7,
    form: 'crust', likes: { deep: 1.4 },
    note: 'Where it lay, the wood gave up being wood. It is stone now, and heavy.',
  },
  rime: {
    name: 'rime', label: 'Rimefrost', w: 8, hex: 0xcfe6f2, glow: 0.18, hard: 0.8,
    form: 'crust', likes: { high: 2.2, wet: 1.3 },
    note: 'A frost that has not melted since the wood fell, and does not intend to.',
  },
  ember: {
    name: 'ember', label: 'Emberheart', w: 5, hex: 0xe2662a, glow: 0.60, hard: 1.1,
    form: 'seam', likes: { burnt: 2.6 },
    note: 'There is a heat still in it. Not much. It has simply never gone out.',
  },
  wisplight: {
    name: 'wisplight', label: 'Wisplight', w: 4, hex: 0x8ff0c4, glow: 0.85, hard: 0.7,
    form: 'vein', likes: { deep: 2.0, wet: 1.5 },
    note: 'Something pale moves under the bark, slowly, and never quite the same way twice.',
  },
  emberflow: {
    name: 'emberflow', label: 'Emberflow', w: 1, hex: 0xff5a1e, glow: 1.0, hard: 1.3,
    form: 'vein', likes: { deep: 2.4, burnt: 2.0 },
    note: 'It runs. Very slowly, and only when nobody is watching, but it runs.',
  },
};

export const MATERIAL_LIST = Object.values(MATERIALS);

/* ========================================================================= */
/* RARE EFFECTS — the eighth component, and the one nobody expects           */
/* ========================================================================= */

export const EFFECTS = {
  hollow: {
    name: 'hollow', label: 'Hollowed', w: 12,
    note: 'Empty down the middle. Put it to your ear and the wood is still saying something.',
  },
  everdamp: {
    name: 'everdamp', label: 'Everdamp', w: 11,
    note: 'It has not been rained on for a month and it is still wet. Nobody knows why.',
  },
  foxfire: {
    name: 'foxfire', label: 'Foxfire', w: 10,
    note: 'In daylight it is a pale branch. After dusk it is a reason to walk faster.',
  },
  runemark: {
    name: 'runemark', label: 'Rune-marked', w: 7,
    note: 'Beetle-tracks, probably. They repeat, though, and beetles do not repeat.',
  },
  starlit: {
    name: 'starlit', label: 'Starlit', w: 6,
    note: 'Flecks in the grain that catch light there is no source for.',
  },
  petrified: {
    name: 'petrified', label: 'Petrified', w: 5,
    note: 'It has been turning to stone for a very long time and is nearly finished.',
  },
  singing: {
    name: 'singing', label: 'Singing', w: 3,
    note: 'Hold it into the wind and it finds a note. Always the same note.',
  },
};

export const EFFECT_LIST = Object.values(EFFECTS);

/* ========================================================================= */
/* BARK                                                                      */
/* ========================================================================= */

export const BARKS = {
  /* `plain` means "not worth calling a component". Most bark is just bark:
     a ridged oak and a dark elder are the normal state of those trees, and
     listing them would put a component on nearly every stick in the wood. */
  rough: { name: 'rough', label: 'Rough bark', plain: true },
  smooth: { name: 'smooth', label: 'Smooth bark', plain: true },
  ridged: { name: 'ridged', label: 'Deep-ridged bark', plain: true },
  dark: { name: 'dark', label: 'Dark bark', plain: true },
  cracked: { name: 'cracked', label: 'Cracked bark' },
  papery: { name: 'papery', label: 'Papery bark' },
  stripped: { name: 'stripped', label: 'Bark stripped away' },
  charred: { name: 'charred', label: 'Charred bark' },
};

/* ========================================================================= */
/* NATURAL FEATURES — the small living things riding along                   */
/* ========================================================================= */

export const NATURE = {
  leaves: { name: 'leaves', label: 'Clinging leaves', w: 16 },
  vines: { name: 'vines', label: 'Wound with vine', w: 12 },
  thorns: { name: 'thorns', label: 'Thorned', w: 10 },
  flowers: { name: 'flowers', label: 'Small flowers', w: 7 },
  roots: { name: 'roots', label: 'Trailing rootlets', w: 9 },
  ivy: { name: 'ivy', label: 'Ivy-clad', w: 8 },
};

export const NATURE_LIST = Object.values(NATURE);

/* ========================================================================= */
/* BROKEN ENDS                                                               */
/* ========================================================================= */

export const BREAKS = ['snap', 'splinter', 'clean', 'rot', 'torn'];

/* ========================================================================= */
/* THE ROLL                                                                  */
/* ========================================================================= */

/**
 * Turn a seed and a place into a stick.
 *
 * @param {number} seed
 * @param {object} ctx
 * @param {number} ctx.remoteness  0 at the village fence, 1 at the mountains
 * @param {number} ctx.wet         0..1 local ground wetness (streams, bogs)
 * @param {number} ctx.shade       0..1 canopy cover — moss grows in the dark
 * @param {string} ctx.grove       dominant species of the grove it fell in
 * @param {number} ctx.altitude    metres, for the pine-at-height rule
 */
export function rollStick(seed, ctx = {}) {
  const r = makeRng(seed);
  const remote = clamp(ctx.remoteness ?? 0.3, 0, 1);
  const wetness = clamp(ctx.wet ?? 0.2, 0, 1);
  const shade = clamp(ctx.shade ?? 0.5, 0, 1);

  /* --- species: mostly whatever grove you are standing in ---------------- */
  let species;
  if (ctx.grove && SPECIES[ctx.grove] && r.chance(0.68)) species = SPECIES[ctx.grove];
  else species = r.weighted(SPECIES_LIST);

  /* --- form -------------------------------------------------------------- */
  const form = r.weighted(FORM_LIST, f => Math.max(0.4, f.w * (1 + f.remote * remote * 1.6)));

  /* --- rare form? The deep wood is where the strange wood is. ------------ */
  let rare = null;
  const rareChance = lerp(0.012, 0.085, Math.pow(remote, 1.3));
  if (r.chance(rareChance)) {
    const pool = RARE_LIST.filter(x => !x.minLen || form.len[1] >= x.minLen * 0.75);
    if (pool.length) rare = r.weighted(pool);
  }

  /* --- size -------------------------------------------------------------- */
  // bellRange, not range: most sticks should be ordinary, and the extremes
  // should be rare enough that finding a three-metre limb is an event.
  let length = r.bellRange(form.len[0], form.len[1]) * species.lenMul;
  let thick = r.bellRange(form.thick[0], form.thick[1]) * species.thickMul;
  if (rare === RARE.heartwood) { thick *= 1.35; length *= 1.1; }
  if (rare === RARE.maulhead) { thick *= 1.2; }
  if (rare === RARE.driftbone) { thick *= 0.9; }
  if (rare && rare.minLen) length = Math.max(length, rare.minLen);

  /* --- shape ------------------------------------------------------------- */
  const crookBase = form.crook * species.crook;
  const straightRoll = r.pow(1.6);          // most sticks are a bit crooked
  let curve = lerp(0.03, 0.9, straightRoll) * crookBase;
  if (form.straight) curve *= 0.25;
  if (rare === RARE.serpentcoil || rare === RARE.heartwood) curve *= 0.35;
  if (rare === RARE.driftbone) curve *= 1.5;

  const wobble = r.range(0.15, 1.0) * crookBase * (form.straight ? 0.3 : 1);
  const kinks = r.chance(0.34 * crookBase) ? r.int(1, 2) : 0;
  const curvePlane = r.range(0, TAU);
  const taper = r.range(0.25, 0.72) * (form.straight ? 0.5 : 1);

  /* --- branching --------------------------------------------------------- */
  let forkN = r.int(form.forks[0], form.forks[1]);
  if (rare === RARE.antler) forkN = r.int(3, 5);
  if (rare === RARE.ringbough) forkN = Math.min(forkN, 1);
  if (rare === RARE.serpentcoil || rare === RARE.heartwood) forkN = Math.min(forkN, 1);
  // A besom is a shaft and a head. A fork half way up ruins both.
  if (rare === RARE.besom || rare === RARE.maulhead || rare === RARE.driftbone) forkN = 0;
  const forks = [];
  for (let i = 0; i < forkN; i++) {
    forks.push({
      at: r.range(0.18, 0.88),
      len: r.range(0.22, 0.65) * length,
      ang: r.range(0.34, 1.15),
      roll: r.range(0, TAU),
      thick: r.range(0.42, 0.78),
      curve: r.range(0.1, 0.7),
      sub: rare === RARE.antler ? r.int(1, 2) : (r.chance(0.3) ? 1 : 0),
    });
  }

  let twigN = r.int(form.twigs[0], form.twigs[1]);
  if (rare === RARE.driftbone || rare === RARE.heartwood) twigN = 0;
  const twigs = [];
  for (let i = 0; i < twigN; i++) {
    twigs.push({
      at: r.range(0.12, 0.96), len: r.range(0.06, 0.24) * length,
      ang: r.range(0.5, 1.4), roll: r.range(0, TAU),
      leafy: r.chance(0.35) ? r.int(1, 4) : 0,
    });
  }

  /* --- knots and burls --------------------------------------------------- */
  const knots = [];
  // Most sticks have one old branch scar or none. Three is a character trait,
  // not a default — when every stick was "Knotted" the word stopped meaning
  // anything, which is exactly what happened the first time round.
  const knotN = r.chance(0.45) ? 0 : r.int(1, 2) + (species.name === 'blackthorn' ? r.int(0, 2) : 0);
  for (let i = 0; i < knotN; i++) {
    knots.push({ at: r.range(0.08, 0.95), size: r.range(0.35, 1.5), roll: r.range(0, TAU) });
  }

  /* --- surface ----------------------------------------------------------- */
  // Moss is a function of where the stick has been lying, not of luck: damp,
  // shaded ground grows it, and the underside grows more than the top.
  const mossDrive = clamp(wetness * 0.65 + shade * 0.5 - 0.18, 0, 1);
  const moss = clamp(r.pow(1.5) * mossDrive * 1.5, 0, 1) * (rare === RARE.driftbone ? 0.1 : 1);
  const lichen = clamp(r.pow(2) * (1 - wetness) * 0.9, 0, 1) * (1 - moss * 0.6);
  const mossSide = r.range(0, TAU);

  const wet = clamp(wetness * r.range(0.5, 1.3), 0, 1);
  let pale = clamp(r.pow(2.4) * 1.2 - wet * 0.4, 0, 1);
  if (rare === RARE.driftbone || rare === RARE.knotbraid) pale = r.range(0.75, 1);
  if (species.papery) pale = Math.max(pale, r.range(0.3, 0.7));

  let charred = 0;
  if (rare === RARE.lightningsplit) charred = r.range(0.55, 0.9);

  /* --- fungi: small, rare, and a genuine delight ------------------------- */
  const fungi = [];
  const fungalDrive = clamp(wetness * 0.8 + shade * 0.45 - 0.25, 0, 1);
  if (r.chance(fungalDrive * 0.55)) {
    const kinds = ['bracket', 'bracket', 'tiny', 'tiny', 'inkcap', 'puffball'];
    if (remote > 0.55 && r.chance(0.13)) kinds.push('glow');
    const kind = r.pick(kinds);
    const n = kind === 'bracket' ? r.int(1, 4) : r.int(2, 7);
    for (let i = 0; i < n; i++) {
      fungi.push({
        at: clamp(r.range(0.1, 0.95) + r.bell() * 0.05, 0.05, 0.97),
        kind, size: r.range(0.6, 1.5), roll: r.range(0, TAU),
      });
    }
  }

  /* --- leaves still clinging --------------------------------------------- */
  const leaves = r.chance(0.22) ? r.range(0.3, 1) : 0;

  /* --- bark condition ---------------------------------------------------- */
  /* Derived, not rolled blind: a stick that has been in the river is stripped,
     a struck one is charred, birch is papery. Only the middle of the range is
     left to chance, because that is the only part that is genuinely arbitrary. */
  let bark;
  if (charred > 0.3) bark = BARKS.charred;
  else if (pale > 0.72) bark = BARKS.stripped;
  else if (species.papery) bark = BARKS.papery;
  else if (species.ridge > 0.6) bark = r.chance(0.6) ? BARKS.ridged : BARKS.rough;
  else if (species.ridge < 0.25) bark = r.chance(0.6) ? BARKS.smooth : BARKS.rough;
  else if (r.chance(0.18)) bark = BARKS.cracked;
  else if (r.chance(0.16)) bark = BARKS.dark;
  else bark = r.chance(0.5) ? BARKS.rough : BARKS.smooth;

  /* --- a small living thing riding along ---------------------------------- */
  let nature = null;
  const natureDrive = clamp(0.10 + shade * 0.22 + wetness * 0.16, 0, 0.55);
  if (r.chance(natureDrive)) {
    nature = r.weighted(NATURE_LIST, n => {
      if (n === NATURE.thorns) return species.thorny ? n.w * 6 : n.w * 0.35;
      if (n === NATURE.roots) return form.name === 'root' ? n.w * 5 : n.w * 0.5;
      if (n === NATURE.leaves) return leaves > 0 ? n.w * 2.2 : n.w * 0.4;
      if (n === NATURE.flowers) return n.w * (1 - shade * 0.7);
      return n.w;
    });
  }

  /* --- a special material, and this is the rare one ----------------------- */
  /* Kept genuinely scarce: about one stick in a hundred near the village and
     one in fourteen at the far edge of the map. It has to stay an event. */
  let special = null;
  const specialChance = lerp(0.008, 0.070, Math.pow(remote, 1.35));
  if (r.chance(specialChance)) {
    const bias = {
      deep: remote, high: clamp((ctx.altitude ?? 0) / 160, 0, 1),
      wet: wetness, burnt: charred > 0 ? 1 : 0,
      resin: species.name === 'pine' ? 1 : 0,
    };
    special = r.weighted(MATERIAL_LIST, m => {
      let w = m.w;
      for (const k in (m.likes || {})) w *= lerp(1, m.likes[k], bias[k] ?? 0);
      return w;
    });
  }

  /* --- and the eighth component, rarer still ------------------------------ */
  let effect = null;
  const effectChance = lerp(0.005, 0.048, Math.pow(remote, 1.5));
  if (r.chance(effectChance)) {
    effect = r.weighted(EFFECT_LIST, e => {
      if (e === EFFECTS.foxfire) return e.w * (1 + shade * 2);
      if (e === EFFECTS.everdamp) return e.w * (0.3 + wetness * 2.4);
      if (e === EFFECTS.hollow) return e.w * (species.hollowProne ? 3.5 : 1);
      if (e === EFFECTS.petrified) return e.w * (0.4 + remote * 1.8);
      return e.w;
    });
  }
  if (rare === RARE.moonpale && !effect) effect = EFFECTS.foxfire;

  /* --- where the special material sits on the shaft ----------------------- */
  const inclusions = [];
  if (special) {
    const n = special.form === 'bead' ? r.int(2, 6)
      : special.form === 'shard' ? r.int(2, 5)
        : special.form === 'crust' ? r.int(1, 3) : r.int(1, 2);
    for (let i = 0; i < n; i++) {
      inclusions.push({
        at: r.range(0.08, 0.94), roll: r.range(0, TAU),
        /* Generous, deliberately. These are measured in SHAFT RADII, and a
           shaft radius is a centimetre — an inclusion at 0.5 radii is four
           millimetres of stone on a branch and it is simply not visible from
           anywhere a player stands. The crystal worked at the first attempt
           because shards stick out; everything that lies flat needs the size
           to carry it instead. */
        size: r.range(1.0, 2.2), len: r.range(0.22, 0.55),
        tilt: r.range(-0.6, 0.6),
      });
    }
  }

  /* --- how it came off the tree ------------------------------------------ */
  let brokenEnd = r.pick(BREAKS);
  if (rare === RARE.lightningsplit) brokenEnd = 'splinter';
  if (rare === RARE.driftbone) brokenEnd = 'rot';
  const brokenButt = r.chance(0.5) ? r.pick(BREAKS) : 'snap';

  /* --- the rare-form extras ---------------------------------------------- */
  const extra = {};
  if (rare === RARE.serpentcoil) {
    extra.coil = {
      turns: r.range(2.5, 6.5), thick: r.range(0.38, 0.62),
      from: r.range(0.05, 0.22), to: r.range(0.78, 0.98),
      dir: r.sign(), dry: r.range(0.4, 1),
    };
  }
  if (rare === RARE.knotbraid) {
    extra.braid = {
      strands: r.int(2, 3), turns: r.range(1.4, 3.2), thick: r.range(0.55, 0.85),
      lobes: r.int(2, 5), from: r.range(0.08, 0.26), to: r.range(0.78, 0.97),
      seam: r.range(0.5, 1), dir: r.sign(),
    };
  }
  if (rare === RARE.ringbough) {
    // `open` is in SHAFT RADII. Below about 2 the eye closes up and the whole
    // point of the form — that you can see through it — is lost.
    extra.ring = {
      at: r.range(0.34, 0.60), span: r.range(0.24, 0.42),
      open: r.range(2.4, 4.6), flat: r.range(0.30, 0.46),
    };
  }
  if (rare === RARE.maulhead) {
    extra.burl = {
      at: r.chance(0.8) ? 1 : 0, size: r.range(2.8, 5.0),
      lumps: r.int(4, 8), squash: r.range(0.62, 0.86), cross: r.chance(0.45),
    };
  }
  if (rare === RARE.besom) {
    extra.bristle = { n: r.int(48, 96), len: r.range(0.26, 0.48), spread: r.range(0.30, 0.62) };
  }
  if (rare === RARE.lightningsplit) {
    // `gap` is in shaft radii; under 1 the two halves overlap and there is no
    // visible split at all, only a slightly fat stick.
    extra.split = { from: r.range(0.14, 0.34), to: r.range(0.70, 0.96), gap: r.range(1.1, 2.4) };
  }
  if (rare === RARE.moonpale) {
    extra.glow = { strength: r.range(0.5, 1), veins: r.int(3, 7) };
  }

  const spec = {
    v: 1,
    seed: seed >>> 0,
    species: species.name,
    form: form.name,
    rare: rare ? rare.name : null,
    length, thick, taper, curve, curvePlane, wobble, kinks,
    forks, twigs, knots, fungi,
    moss, mossSide, lichen, wet, pale, charred, leaves,
    bark: bark.name,
    nature: nature ? nature.name : null,
    special: special ? special.name : null,
    effect: effect ? effect.name : null,
    inclusions,
    brokenEnd, brokenButt,
    extra,
    hue: r.range(-0.035, 0.035),
    lum: r.range(0.82, 1.18),
  };

  spec.tags = stickTags(spec);
  spec.parts = stickComponents(spec);
  spec.tier = stickTier(spec);
  spec.name = stickName(spec);
  return spec;
}

/* ========================================================================= */
/* DERIVED PROPERTIES                                                        */
/* ========================================================================= */

/** The vocabulary the crafting recipes are written against. */
export function stickTags(s) {
  const t = new Set();
  const sp = SPECIES[s.species] || SPECIES.oak;
  const slender = s.thick / Math.max(0.2, s.length);

  if (s.length < 0.7) t.add('short');
  else if (s.length < 1.6) t.add('medium');
  else if (s.length < 2.6) t.add('long');
  else { t.add('long'); t.add('great'); }

  if (s.thick < 0.018) t.add('slender');
  else if (s.thick < 0.040) t.add('sound');
  else { t.add('stout'); if (s.thick > 0.065) t.add('massive'); }

  if (slender < 0.020) t.add('whippy');

  const crooked = s.curve + s.wobble * 0.5 + s.kinks * 0.35;
  if (crooked < 0.35) t.add('straight');
  else if (crooked > 0.95) t.add('crooked');

  if (s.forks.length >= 1) t.add('forked');
  if (s.forks.length >= 3) t.add('branching');
  if (s.twigs.length >= 3) t.add('twiggy');
  if (s.knots.length >= 3) t.add('knotted');

  if (s.moss > 0.45) t.add('mossy');
  if (s.moss > 0.8) t.add('verdant');
  if (s.lichen > 0.5) t.add('lichened');
  if (s.fungi.length >= 2) t.add('fungal');
  if (s.fungi.some(f => f.kind === 'glow')) { t.add('foxfire'); t.add('glowing'); }
  if (s.wet > 0.6) t.add('damp');
  if (s.pale > 0.6) t.add('pale');
  if (s.charred > 0.3) t.add('charred');
  if (s.leaves > 0) t.add('leafy');

  if (sp.hardness >= 1.25) t.add('hard');
  if (sp.hardness <= 0.75) t.add('soft');
  if (sp.thorny) t.add('thorned');
  t.add('wood:' + s.species);

  if (s.special) { t.add('special'); t.add('mat:' + s.special); }
  if (s.effect) { t.add('effect'); t.add('fx:' + s.effect); }
  if (s.effect === 'foxfire') { t.add('foxfire'); t.add('glowing'); }
  if (s.nature) t.add('nat:' + s.nature);
  if (s.nature === 'thorns') t.add('thorned');
  if (s.bark) t.add('bark:' + s.bark);
  if (s.bark === 'charred') t.add('charred');
  if (s.bark === 'stripped') t.add('pale');

  if (s.rare) {
    const R = RARE[s.rare];
    if (R) for (const x of R.tags) t.add(x);
    t.add('rare:' + s.rare);
  }
  return [...t];
}

export const hasTag = (s, tag) => (s.tags || stickTags(s)).includes(tag);

/* ========================================================================= */
/* COMPONENTS — the stick's DNA, and the whole basis of the forge            */
/* ========================================================================= */

/**
 * Eight slots. A stick has a component in a slot only when that axis is
 * REMARKABLE — every stick has a length, but only an unusual length is a
 * component. That is what makes the count mean something: the ordinary branch
 * you tread on has one or two, and the thing you cross a valley for has all
 * eight. It is also what the Stickwright reads when he decides what to make,
 * what ends up physically on the finished weapon, and what the rarity is.
 *
 * `weight` is that slot's contribution to rarity. Shape and size are cheap —
 * plenty of sticks are long — while a special material or a rare effect is
 * most of the reason a weapon turns out to be worth a name.
 *
 * @returns {Array<{slot,key,label,note,weight}>}
 */
export function stickComponents(s) {
  const out = [];
  const sp = SPECIES[s.species] || SPECIES.oak;
  const add = (slot, key, label, note, weight) => out.push({ slot, key, label, note, weight });

  const bend = s.curve + s.wobble * 0.5 + s.kinks * 0.35;

  /* 1 — SHAPE ------------------------------------------------------------- */
  if (s.rare) {
    const R = RARE[s.rare];
    add('shape', s.rare, R.label, R.desc, 2.6);
  } else if (s.forks.length >= 3) {
    add('shape', 'branching', 'Many-branched', 'It forked, and then the forks forked.', 1.4);
  } else if (s.forks.length >= 2) {
    add('shape', 'forked', 'Forked', 'A clean fork, grown not broken.', 0.9);
  } else if (bend < 0.16 && s.length > 1.4) {
    add('shape', 'true', 'Perfectly straight', 'Straight enough to sight along, which almost nothing is.', 1.5);
  } else if (bend > 1.55) {
    add('shape', 'crooked', 'Strongly curved', 'A long deliberate bend, like something drawn.', 1.2);
  } else if (bend > 1.20) {
    add('shape', 'curved', 'Curved', 'It leans away from straight and keeps leaning.', 0.7);
  }

  /* 2 — LENGTH ------------------------------------------------------------ */
  if (s.length > 3.2) add('length', 'giant', 'Enormous', `${s.length.toFixed(2)} m — taller than most doors.`, 1.6);
  else if (s.length > 2.6) add('length', 'long', 'Very long', `${s.length.toFixed(2)} m.`, 0.9);
  else if (s.length < 0.34) add('length', 'tiny', 'Very short', `${(s.length * 100).toFixed(0)} cm — barely a hand span.`, 0.8);

  /* 3 — THICKNESS --------------------------------------------------------- */
  if (s.thick > 0.098) add('girth', 'colossal', 'Enormously thick', `${(s.thick * 200).toFixed(0)} mm across.`, 1.5);
  else if (s.thick > 0.072) add('girth', 'thick', 'Thick', `${(s.thick * 200).toFixed(0)} mm across.`, 0.8);
  else if (s.thick < 0.0095) add('girth', 'fine', 'Very fine', `${(s.thick * 200).toFixed(0)} mm across.`, 0.7);

  /* 4 — MOSS -------------------------------------------------------------- */
  if (s.moss > 0.82) add('moss', 'ancient', 'Ancient moss', 'Deep enough to sink a thumb into. It has been there for years.', 1.3);
  else if (s.moss > 0.64) add('moss', 'deep', 'Deep moss', 'Green the whole way down one side.', 0.8);
  else if (s.moss > 0.46) add('moss', 'moss', 'Mossed', 'A patch of green where it lay against the ground.', 0.4);
  else if (s.lichen > 0.70) add('moss', 'lichen', 'Lichened', 'Grey-green rosettes, flat to the bark.', 0.4);

  /* 5 — BARK -------------------------------------------------------------- */
  {
    const B = BARKS[s.bark] || BARKS.rough;
    if (!B.plain) {
      const note = {
        charred: 'Black and crazed down one side. It still smells of the storm.',
        stripped: 'No bark at all. Sun and water took it.',
        papery: 'Peeling off in pale sheets.',
        ridged: 'Ridged deep enough to catch a fingernail.',
        cracked: 'Cracked into plates that shift when you hold it.',
        dark: 'Almost black, and it does not lighten when it dries.',
      }[B.name] || '';
      add('bark', B.name, B.label, note, B.name === 'charred' ? 1.1 : 0.5);
    }
  }

  /* 6 — SPECIAL MATERIAL --------------------------------------------------- */
  if (s.special && MATERIALS[s.special]) {
    const M = MATERIALS[s.special];
    add('material', M.name, M.label, M.note, 2.4 + (M.glow > 0.5 ? 1.2 : 0));
  }

  /* 7 — NATURAL FEATURE ---------------------------------------------------- */
  if (s.fungi.length && s.fungi.some(f => f.kind === 'glow')) {
    add('nature', 'glowcap', 'Glowing fungi', 'Small caps along the top, and they are not reflecting anything.', 1.8);
  } else if (s.fungi.length >= 4) {
    add('nature', 'fungal', 'Bracket fungi', 'A row of little shelves down the length of it.', 0.8);
  } else if (s.nature && NATURE[s.nature]) {
    const N = NATURE[s.nature];
    add('nature', N.name, N.label, {
      vines: 'A vine wound round it and never let go.',
      thorns: 'Armed the whole way along.',
      flowers: 'Something small and pale is still flowering on it.',
      roots: 'Fine rootlets trailing off it like hair.',
      ivy: 'Ivy has taken it.',
      leaves: 'Leaves still clinging, brown and dry.',
    }[N.name] || '', 0.5);
  }

  /* 8 — RARE EFFECT --------------------------------------------------------- */
  if (s.effect && EFFECTS[s.effect]) {
    const E = EFFECTS[s.effect];
    add('effect', E.name, E.label, E.note, 2.2);
  }

  /* the wood itself is not a component, but it does colour the rest */
  if (sp.w <= 6 && out.length) out[0].wood = sp.label;

  return out;
}

/** The total weight of a stick's components — the number rarity is read from. */
export const componentScore = s =>
  (s.parts || stickComponents(s)).reduce((n, c) => n + c.weight, 0);

/**
 * 0 Common .. 6 ???. Drives the name colour, the chime, the value and what
 * the forge is willing to attempt.
 *
 * The thresholds are not guesses: test_world rolls forty thousand sticks and
 * checks the real distribution against RARITY[].share. If everything is
 * Legendary then nothing is, so most sticks must come out at 0 or 1 — and
 * they do, because most sticks have one unremarkable component or none.
 */
/* Measured with tools/probe_rarity.mjs against RARITY[].share — these are the
   score quantiles of sixty thousand rolls, not guesses. Re-run it after
   touching any component weight. */
export const TIER_CUTS = [1.40, 2.30, 3.40, 4.50, 5.70, 7.30];

export function stickTier(s) {
  const score = componentScore(s);
  const n = (s.parts || stickComponents(s)).length;
  let tier = 0;
  while (tier < TIER_CUTS.length && score >= TIER_CUTS[tier]) tier++;
  /* The last tier is not reachable by stacking two enormous properties: it
     wants a stick that is remarkable in several ways at once, which is the
     only kind that deserves to come up nameless. */
  if (tier >= 6 && n < 5) tier = 5;
  return clamp(tier, 0, RARITY.length - 1);
}

/** What the Stickwright will pay, and what the satchel tooltip shows. */
export function stickValue(s) {
  const sp = SPECIES[s.species] || SPECIES.oak;
  let v = 2 + s.length * 3 + s.thick * 90;
  v *= sp.hardness;
  v *= 1 + componentScore(s) * 0.34;
  if (s.special) v *= 1.8;
  if (s.effect) v *= 1.6;
  if (s.rare) v *= 1.9;
  return Math.max(1, Math.round(v));
}

/* ========================================================================= */
/* NAMING                                                                    */
/* ========================================================================= */

/* Names are built from the same numbers as the mesh, so a stick's name always
   describes the thing in your hand. No random word salad: if it says
   "Mossy Forked Hazel Branch", it is mossy, it is forked, and it is hazel. */

const SIZE_WORD = {
  twig: ['Twig', 'Sprig', 'Whip'],
  switch: ['Switch', 'Wand', 'Rod'],
  branch: ['Branch', 'Bough', 'Stick'],
  bough: ['Bough', 'Limb', 'Arm'],
  limb: ['Limb', 'Beam', 'Spar'],
  root: ['Root', 'Tangle', 'Grub'],
  stave: ['Stave', 'Pole', 'Shaft'],
};

const ADJ = [
  { tag: 'charred', word: 'Storm-struck', pri: 10 },
  { tag: 'glowing', word: 'Foxfire', pri: 10 },
  { tag: 'verdant', word: 'Velvet-mossed', pri: 8 },
  { tag: 'mossy', word: 'Mossy', pri: 6 },
  { tag: 'fungal', word: 'Toadstooled', pri: 6 },
  { tag: 'lichened', word: 'Lichened', pri: 4 },
  { tag: 'branching', word: 'Many-armed', pri: 5 },
  { tag: 'forked', word: 'Forked', pri: 3 },
  { tag: 'knotted', word: 'Knotted', pri: 4 },
  { tag: 'crooked', word: 'Crooked', pri: 2 },
  { tag: 'straight', word: 'True', pri: 2 },
  { tag: 'great', word: 'Great', pri: 7 },
  { tag: 'massive', word: 'Heavy', pri: 5 },
  { tag: 'slender', word: 'Slender', pri: 1 },
  { tag: 'whippy', word: 'Whippy', pri: 1 },
  { tag: 'pale', word: 'Bleached', pri: 3 },
  { tag: 'damp', word: 'Rain-dark', pri: 2 },
  { tag: 'leafy', word: 'Leaf-clung', pri: 3 },
  { tag: 'thorned', word: 'Thorned', pri: 4 },
];

export function stickName(s) {
  const tags = s.tags || stickTags(s);
  const sp = SPECIES[s.species] || SPECIES.oak;

  if (s.rare) {
    const R = RARE[s.rare];
    const noun = {
      serpentcoil: 'Stave', knotbraid: 'Limb', ringbough: 'Bough', maulhead: 'Limb',
      besom: 'Bundle', antler: 'Fork', driftbone: 'Branch', heartwood: 'Core',
      lightningsplit: 'Shard', moonpale: 'Bough',
    }[s.rare] || 'Branch';
    return `${R.label} ${sp.label} ${noun}`;
  }

  const picks = ADJ.filter(a => tags.includes(a.tag)).sort((a, b) => b.pri - a.pri);
  const r = makeRng(s.seed ^ 0x5eed);
  const noun = r.pick(SIZE_WORD[s.form] || SIZE_WORD.branch);
  const adj = picks.slice(0, picks.length > 2 ? 2 : picks.length).map(a => a.word);
  // Two adjectives is the limit: "Mossy Forked Crooked Knotted Hazel Branch"
  // is a database row, not a name.
  return [...adj, sp.label, noun].join(' ');
}

/** A one-line flavour string for the satchel, chosen from the real traits. */
export function stickBlurb(s) {
  const bits = [];
  const sp = SPECIES[s.species] || SPECIES.oak;
  if (s.rare) return RARE[s.rare].desc;
  if (s.moss > 0.7) bits.push('so thick with moss it feels like velvet');
  else if (s.moss > 0.35) bits.push('green down one side where it lay');
  if (s.fungi.length >= 3) bits.push('a row of little brackets along the top');
  else if (s.fungi.length) bits.push('one small fungus clinging on');
  if (s.forks.length >= 3) bits.push('forked and forked again');
  else if (s.forks.length) bits.push('a clean fork near the middle');
  if (s.curve + s.wobble < 0.28) bits.push('straight enough to sight along');
  else if (s.curve + s.wobble > 1.1) bits.push('bent like a question');
  if (s.pale > 0.6) bits.push('bark long since gone');
  if (s.wet > 0.7) bits.push('still dark with rain');
  if (s.length > 2.6) bits.push('longer than you are tall');
  if (!bits.length) bits.push(sp.blurb.toLowerCase().replace(/\.$/, ''));
  const r = makeRng(s.seed ^ 0xb10b);
  return capitalise(r.shuffle(bits).slice(0, 2).join(', ')) + '.';
}

const capitalise = s => s.charAt(0).toUpperCase() + s.slice(1);

/* ========================================================================= */
/* PLACEMENT                                                                 */
/* ========================================================================= */

/**
 * The deterministic seed for the stick that belongs at a given scatter slot.
 * Two players walking the same wood find the same sticks in the same places,
 * and a stick you did not pick up is still there when you come back.
 */
export const stickSeedAt = (cellX, cellZ, i) => hash2(cellX, cellZ, 0x57 + i * 7919);

/** A stable id for a stick in the world, so "already taken" can be saved. */
export const stickKey = (cellX, cellZ, i) => `${cellX},${cellZ},${i}`;
