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

import { makeRng, clamp, lerp, hash2, TAU } from '../core/Util.js';
import { BARK, MOSS, MUSHROOM, LEAF } from '../art/Palette.js';

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
    brokenEnd, brokenButt,
    extra,
    hue: r.range(-0.035, 0.035),
    lum: r.range(0.82, 1.18),
  };

  spec.tags = stickTags(spec);
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

  if (s.rare) {
    const R = RARE[s.rare];
    if (R) for (const x of R.tags) t.add(x);
    t.add('rare:' + s.rare);
  }
  return [...t];
}

export const hasTag = (s, tag) => (s.tags || stickTags(s)).includes(tag);

/** 0 common .. 4 storied. Drives the name colour, the chime, and the value. */
export function stickTier(s) {
  if (s.rare) return RARE[s.rare]?.tier ?? 3;
  let score = 0;
  if (s.length > 2.4) score += 1;
  if (s.thick > 0.062) score += 1;
  if (s.moss > 0.7) score += 1;
  if (s.fungi.length >= 3) score += 1;
  if (s.forks.length >= 3) score += 1;
  if (s.curve + s.wobble < 0.28 && s.length > 1.6) score += 1;   // a true stave
  if ((SPECIES[s.species]?.w ?? 20) <= 7) score += 1;            // uncommon wood
  return clamp(Math.floor(score / 2), 0, 2);
}

/** What the Stickwright will pay, and what the satchel tooltip shows. */
export function stickValue(s) {
  const sp = SPECIES[s.species] || SPECIES.oak;
  let v = 2 + s.length * 3 + s.thick * 90;
  v *= sp.hardness;
  v *= 1 + s.moss * 0.4 + s.fungi.length * 0.12 + s.forks.length * 0.1;
  if (s.rare) v *= 2.2 + (RARE[s.rare]?.tier ?? 3) * 0.6;
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
