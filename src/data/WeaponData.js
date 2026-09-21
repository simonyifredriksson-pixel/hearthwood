/* WeaponData.js — what a stick becomes.
   ===========================================================================
   THERE IS NO RECIPE LIST. There used to be, and it was the wrong idea: a
   list of recipes means a list of sticks that do not qualify, and being told
   "this stick cannot be used" is the exact opposite of what picking a stick
   up is supposed to feel like.

   So: every stick becomes a weapon. Which weapon is not a choice the player
   makes and not a lottery — it is READ OUT OF THE WOOD. A long straight limb
   wants to be a spear; a short heavy one wants to be a club; a limb with a
   burl on the end is already a maul and only needs a handle. The stick's
   proportions propose a handful of candidates, the grain decides between
   them, and the player finds out when the Stickwright is finished.

   Everything here is a pure function of the stick, which matters for three
   reasons: the same stick always makes the same weapon (so the world is
   honest), a save only has to store the stick (so a save is small), and the
   test suite can roll a hundred thousand sticks through the forge and check
   that every single one comes out holding something.
*/

import { makeRng, clamp, clamp01, lerp, TAU } from '../core/Util.js?v=1790014861';
import {
  SPECIES, RARE, MATERIALS, EFFECTS,
  stickComponents, componentScore,
} from './StickData.js';
import { RARITY } from '../art/Palette.js?v=1790014861';

/* ========================================================================= */
/* CLASSES                                                                   */
/* ========================================================================= */

/**
 * `fit` scores how much a stick WANTS to be this. It is not a filter — it
 * returns a weight, the weights are normalised, and the pick is random among
 * whatever scored above zero. A stick usually has two or three plausible
 * futures and you cannot tell which one you are going to get.
 *
 * `swing` is seconds for a full swing, `reach` metres, `weight` how much the
 * character leans into it. `build` names the family the mesh builder uses.
 */
export const WEAPON_CLASSES = {
  /* ------------------------------------------------------------- blades */
  dagger: {
    label: 'Dagger', build: 'blade', hands: 1, swing: 0.30, reach: 0.7, weight: 0.18,
    nouns: ['Fang', 'Tooth', 'Thorn', 'Splinter', 'Kiss'],
    fit: m => bell(m.len, 0.20, 0.55) * 2.2 * (1 - m.bendN * 0.4),
  },
  shortsword: {
    label: 'Shortsword', build: 'blade', hands: 1, swing: 0.40, reach: 1.1, weight: 0.42,
    nouns: ['Shortblade', 'Leaf', 'Sting', 'Cutter'],
    fit: m => bell(m.len, 0.55, 1.05) * 1.6 * m.straightN,
  },
  sword: {
    label: 'Sword', build: 'blade', hands: 1, swing: 0.50, reach: 1.6, weight: 0.68,
    nouns: ['Blade', 'Edge', 'Sword', 'Tongue'],
    fit: m => bell(m.len, 0.95, 1.7) * 1.9 * m.straightN,
  },
  longsword: {
    label: 'Longsword', build: 'blade', hands: 2, swing: 0.68, reach: 2.0, weight: 1.0,
    nouns: ['Longblade', 'Reach', 'Answer', 'Warblade'],
    fit: m => bell(m.len, 1.5, 2.3) * 1.7 * m.straightN * (0.5 + m.girthN),
  },
  greatsword: {
    label: 'Greatsword', build: 'blade', hands: 2, swing: 0.98, reach: 2.5, weight: 1.7,
    nouns: ['Greatblade', 'Colossus', 'Judgement', 'Ruin'],
    fit: m => bell(m.len, 2.1, 3.6) * 1.8 * m.straightN * m.girthN * 1.6,
  },
  sabre: {
    label: 'Curved Sword', build: 'blade', hands: 1, swing: 0.46, reach: 1.7, weight: 0.62,
    nouns: ['Crescent', 'Curve', 'Moonblade', 'Sickle', 'Claw'],
    /* the whole point of this one: it exists BECAUSE the stick was bent */
    fit: m => bell(m.len, 0.85, 2.2) * m.bendN * 4.0,
  },
  rapier: {
    label: 'Rapier', build: 'blade', hands: 1, swing: 0.34, reach: 1.8, weight: 0.34,
    nouns: ['Needle', 'Whisper', 'Point', 'Line'],
    fit: m => bell(m.len, 0.95, 1.8) * m.straightN * m.slimN * 2.6,
  },

  /* ------------------------------------------------------------ crushing */
  club: {
    label: 'Club', build: 'club', hands: 1, swing: 0.70, reach: 1.3, weight: 0.85,
    nouns: ['Club', 'Cudgel', 'Knuckle', 'Argument'],
    /* the universal answer: a stick is a club unless it is something better */
    fit: m => 0.35 + bell(m.len, 0.45, 1.25) * m.girthN * 2.0,
  },
  mace: {
    label: 'Mace', build: 'club', hands: 1, swing: 0.80, reach: 1.4, weight: 1.05,
    nouns: ['Mace', 'Star', 'Crown', 'Knot'],
    fit: m => bell(m.len, 0.7, 1.5) * m.girthN * 1.6 * (0.6 + m.knots * 0.5),
  },
  warhammer: {
    label: 'War Hammer', build: 'hammer', hands: 1, swing: 0.88, reach: 1.5, weight: 1.25,
    nouns: ['Hammer', 'Beak', 'Verdict', 'Toll'],
    fit: m => bell(m.len, 0.9, 1.8) * m.girthN * 2.0 * (m.head ? 3.5 : 1),
  },
  maul: {
    label: 'Maul', build: 'hammer', hands: 2, swing: 1.10, reach: 1.9, weight: 1.7,
    nouns: ['Maul', 'Breaker', 'Fall', 'Thunder'],
    fit: m => bell(m.len, 1.2, 2.4) * m.girthN * 2.2 * (m.head ? 5.0 : 1),
  },
  sledge: {
    label: 'Sledge', build: 'hammer', hands: 2, swing: 1.30, reach: 2.2, weight: 2.0,
    nouns: ['Sledge', 'Colossus', 'Mountain', 'Last Word'],
    fit: m => bell(m.len, 1.9, 3.4) * m.girthN * 2.0 * (m.head ? 4.0 : 0.8),
  },

  /* --------------------------------------------------------------- edged */
  axe: {
    label: 'Axe', build: 'axe', hands: 1, swing: 0.76, reach: 1.4, weight: 1.0,
    nouns: ['Axe', 'Bite', 'Splitter', 'Cleaver'],
    fit: m => bell(m.len, 0.7, 1.6) * (0.6 + m.girthN) * 1.5 * (m.split ? 2.5 : 1),
  },
  battleaxe: {
    label: 'Battle Axe', build: 'axe', hands: 2, swing: 1.02, reach: 2.0, weight: 1.6,
    nouns: ['Battleaxe', 'Moon', 'Harvest', 'Reaper'],
    fit: m => bell(m.len, 1.6, 2.9) * m.girthN * 1.8 * (m.split ? 2.0 : 1),
  },

  /* -------------------------------------------------------------- hafted */
  spear: {
    label: 'Spear', build: 'polearm', hands: 2, swing: 0.48, reach: 2.9, weight: 0.5,
    nouns: ['Spear', 'Lance', 'Reach', 'Rain'],
    fit: m => bell(m.len, 1.5, 3.0) * m.straightN * (0.4 + m.slimN) * 2.4,
  },
  polearm: {
    label: 'Polearm', build: 'polearm', hands: 2, swing: 0.72, reach: 3.1, weight: 0.95,
    nouns: ['Glaive', 'Bill', 'Wing', 'Tide'],
    fit: m => bell(m.len, 2.2, 3.8) * m.straightN * 2.0,
  },
  halberd: {
    label: 'Halberd', build: 'polearm', hands: 2, swing: 0.95, reach: 3.0, weight: 1.45,
    nouns: ['Halberd', 'Standard', 'Sentence', 'Gate'],
    fit: m => bell(m.len, 2.0, 3.6) * m.girthN * 1.6 * (0.5 + m.forks * 0.6),
  },

  /* ---------------------------------------------------------- the quiet */
  staff: {
    label: 'Staff', build: 'staff', hands: 2, swing: 0.60, reach: 2.2, weight: 0.5,
    nouns: ['Staff', 'Stave', 'Pillar', 'Road'],
    fit: m => bell(m.len, 1.4, 2.8) * (0.4 + m.straightN * 1.6) * 1.7,
  },
  broom: {
    label: 'Broom', build: 'broom', hands: 2, swing: 0.58, reach: 2.0, weight: 0.55,
    nouns: ['Besom', 'Sweep', 'Broom', 'Errand'],
    fit: m => (m.bristle ? 14 : m.twiggy * 1.4) * bell(m.len, 1.0, 2.6),
  },
  wand: {
    label: 'Wand', build: 'wand', hands: 1, swing: 0.32, reach: 0.9, weight: 0.16,
    nouns: ['Wand', 'Rod', 'Question', 'Wish'],
    /* The glow and the strange material make a wand MORE likely, but they
       cannot make one out of a three-metre limb: the bonus is inside the
       length window, not added to it. A bonus that sits outside the window
       is a bonus that overrules the wood, and the wood decides. */
    fit: m => bell(m.len, 0.18, 0.85)
      * ((0.6 + m.slimN * 2.0) * 2.0 + (m.glow ? 3.0 : 0) + (m.special ? 1.2 : 0)),
  },
  walkingStick: {
    label: 'Walking Stick', build: 'staff', hands: 1, swing: 0.60, reach: 1.5, weight: 0.4,
    nouns: ['Walking Stick', 'Companion', 'Mile', 'Long Way'],
    /* the other universal answer, and the one that suits a crooked stick */
    fit: m => 0.30 + bell(m.len, 0.9, 1.8) * (0.5 + m.bendN) * 1.2,
  },

  /* --------------------------------------------------------- the strange */
  oddity: {
    label: 'Oddity', build: 'oddity', hands: 2, swing: 0.62, reach: 1.9, weight: 0.7,
    nouns: ['Curiosity', 'Puzzle', 'Notion', 'Instrument', 'Apparatus'],
    /* Only ever offered to a stick with several strange things going on, and
       then only sometimes. It is the one result the wood does not explain. */
    fit: m => (m.parts >= 4 ? 0.8 : 0) + (m.special ? 0.9 : 0) + (m.effect ? 1.1 : 0)
      + (m.ring ? 1.6 : 0) + (m.coil ? 1.2 : 0),
  },
};

export const CLASS_LIST = Object.entries(WEAPON_CLASSES).map(([id, c]) => ({ id, ...c }));

/** A soft window: 1 in the middle of [a,b], falling to 0 outside it. */
function bell(v, a, b) {
  const mid = (a + b) / 2, half = (b - a) / 2;
  if (half <= 0) return 0;
  const d = Math.abs(v - mid) / half;
  return d >= 1.6 ? 0 : Math.pow(clamp01(1 - d / 1.6), 1.5);
}

/* ========================================================================= */
/* READING THE STICK                                                         */
/* ========================================================================= */

/** Everything the class fits and the mesh need, in one normalised bundle. */
export function stickMetrics(s) {
  const sp = SPECIES[s.species] || SPECIES.oak;
  const parts = s.parts || stickComponents(s);
  const bend = s.curve + s.wobble * 0.5 + s.kinks * 0.35;
  const slim = s.thick / Math.max(0.2, s.length);
  const x = s.extra || {};
  return {
    len: s.length,
    girth: s.thick,
    bend,
    bendN: clamp01((bend - 0.35) / 1.5),           // 0 dead straight, 1 a hook
    straightN: clamp01(1 - bend / 1.25),
    girthN: clamp01((s.thick - 0.010) / 0.085),
    slimN: clamp01(1 - slim / 0.035),
    forks: s.forks?.length || 0,
    twigs: s.twigs?.length || 0,
    twiggy: clamp01((s.twigs?.length || 0) / 4),
    knots: clamp01((s.knots?.length || 0) / 3),
    hard: sp.hardness,
    parts: parts.length,
    score: componentScore(s),
    head: !!x.burl,
    split: !!x.split,
    ring: !!x.ring,
    coil: !!x.coil,
    braid: !!x.braid,
    bristle: !!x.bristle,
    glow: !!(s.effect === 'foxfire' || s.fungi?.some(f => f.kind === 'glow')
      || (s.special && MATERIALS[s.special]?.glow > 0.5)),
    special: s.special || null,
    effect: s.effect || null,
    moss: s.moss,
    tier: s.tier ?? 0,
  };
}

/**
 * The candidates this stick could become, best first, with their odds.
 * Exported because the workshop shows the player a hint — "it could be a few
 * things" — without ever telling them which.
 */
export function candidates(s) {
  const m = stickMetrics(s);
  const out = [];
  for (const c of CLASS_LIST) {
    const w = Math.max(0, c.fit(m) || 0);
    if (w > 0.001) out.push({ id: c.id, cls: c, w });
  }
  /* A stick that somehow suits nothing still has to become something. This
     cannot fire given club's and walkingStick's constant terms, but the
     promise is "every stick becomes a weapon" and a promise with an
     unreachable exception is still an exception. */
  if (!out.length) out.push({ id: 'club', cls: WEAPON_CLASSES.club, w: 1 });
  const total = out.reduce((a, c) => a + c.w, 0);
  for (const c of out) c.p = c.w / total;
  return out.sort((a, b) => b.w - a.w);
}

/* ========================================================================= */
/* THE FORGE                                                                 */
/* ========================================================================= */

const METALS = {
  iron: { label: 'Iron', hex: 0x8d9099, spec: 0.55 },
  steel: { label: 'Steel', hex: 0xb9c0cb, spec: 0.85 },
  darksteel: { label: 'Dark Steel', hex: 0x4f545e, spec: 0.7 },
  bronze: { label: 'Bronze', hex: 0xb07a3c, spec: 0.6 },
  copper: { label: 'Copper', hex: 0xb5623a, spec: 0.6 },
  silver: { label: 'Silver', hex: 0xd4d8dd, spec: 0.95 },
  blackiron: { label: 'Black Iron', hex: 0x35383d, spec: 0.4 },
  palegold: { label: 'Pale Gold', hex: 0xd8b463, spec: 0.9 },
  greenbronze: { label: 'Verdigris', hex: 0x6f9a7e, spec: 0.45 },
  sunmetal: { label: 'Sunmetal', hex: 0xe8c07a, spec: 1.0 },
};

/*
 * NO 'none' IN ANY OF THESE, and that is the point.
 *
 * The brief asks that everything off this bench look professionally
 * constructed: a proper handle, a head, a guard, a grip and a pommel.
 * Every one of those used to be an independent coin-flip that could come
 * up "nothing" — a 6% chance of no wrap, roughly a sixth with no pommel,
 * more than half with no ferrule and a seventh of the blades with no
 * guard. Multiply those out and a real slice of the rack was a branch
 * with nothing on it at all, which is precisely what the contact sheet
 * came back as: a Walking Stick that was a bare curved stick and a
 * Rapier with no bell.
 *
 * So the variety moves from WHETHER a weapon has a fitting to WHICH
 * fitting it has. A plain turned collar is the humble option now, and it
 * is still a thing somebody made.
 */
const GUARDS = ['crossbar', 'swept', 'ring', 'antler', 'leaf', 'disc', 'thorn'];
const POMMELS = ['knob', 'disc', 'cap', 'beak', 'stone', 'hook', 'sphere'];
const WRAPS = ['cord', 'leather', 'braid', 'wire', 'bark'];
const EDGES = ['plain', 'fuller', 'serrated', 'ridged', 'scalloped', 'double'];

/**
 * Turn a stick into a finished weapon.
 *
 * Deterministic: the same stick always produces the same weapon, because the
 * weapon IS the stick. The randomness is real but it was fixed the moment the
 * stick was rolled, out in the wood, long before anyone picked it up.
 *
 * @returns {{cls, label, design, stats, name, tier, traits, blurb}}
 */
export function forgeWeapon(stick) {
  const s = stick;
  const m = stickMetrics(s);
  const sp = SPECIES[s.species] || SPECIES.oak;
  const r = makeRng((s.seed ^ 0x0f09e3d1) >>> 0);

  /* --- which weapon ------------------------------------------------------ */
  const cand = candidates(s);
  const pick = r.weighted(cand, c => c.w);
  const id = pick.id, C = pick.cls;

  /* --- the appearance genome --------------------------------------------- */
  const design = buildDesign(s, m, C, id, r);

  /* --- what it is made of, carried over from the wood -------------------- */
  const traits = weaponTraits(s, m);

  /* --- numbers ----------------------------------------------------------- */
  const stats = weaponStats(id, s, m, design);

  /* --- rarity: the stick's, nudged by what the forge managed -------------- */
  let tier = m.tier;
  if (design.metal === 'sunmetal' || design.metal === 'palegold') tier = Math.max(tier, 3);
  if (id === 'oddity') tier = Math.max(tier, 2);
  tier = clamp(tier, 0, RARITY.length - 1);

  const name = weaponName(s, m, C, design, tier, r);

  return { cls: id, label: C.label, design, stats, name, tier, traits, blurb: forgeBlurb(s, m, C, r) };
}

/* ------------------------------------------------------------------------- */

function buildDesign(s, m, C, id, r) {
  const sp = SPECIES[s.species] || SPECIES.oak;

  /* METAL. Mostly what a village forge has, with the wood's own material
     pulling it somewhere stranger. */
  let metal = r.weighted(
    ['iron', 'iron', 'steel', 'steel', 'bronze', 'copper', 'darksteel', 'blackiron'],
    () => 1);
  if (s.special === 'ironvein') metal = r.pick(['darksteel', 'blackiron', 'iron']);
  if (s.special === 'crystal') metal = r.pick(['silver', 'steel', 'palegold']);
  if (s.special === 'rime') metal = r.pick(['silver', 'steel', 'darksteel']);
  if (s.special === 'ember' || s.special === 'emberflow') metal = r.pick(['blackiron', 'copper', 'bronze']);
  if (s.special === 'amber') metal = r.pick(['bronze', 'copper', 'palegold']);
  if (s.special === 'oldstone') metal = r.pick(['greenbronze', 'bronze', 'blackiron']);
  if (s.special === 'wisplight') metal = r.pick(['silver', 'greenbronze', 'palegold']);
  if (m.tier >= 5 && r.chance(0.5)) metal = 'sunmetal';

  /* THE SHAFT keeps the stick's own path. This is the promise of the whole
     system — the curve you found is the curve you carry — so it is not a
     style option, it is copied across and only softened. */
  const straighten = clamp01(
    C.build === 'polearm' ? r.range(0.55, 0.85)
      : C.build === 'staff' ? r.range(0.15, 0.45)
        : C.build === 'blade' ? (id === 'sabre' ? r.range(0, 0.15) : r.range(0.45, 0.8))
          : r.range(0.2, 0.55));

  const d = {
    build: C.build,
    metal,
    straighten,
    strip: clamp01(r.range(0.25, 1.0) * (s.moss > 0.5 ? 0.55 : 1)),
    polish: r.range(0, 1),
    wear: clamp01(r.pow(1.6) * 0.9),
    asym: r.range(-1, 1) * r.pow(2),          // nothing here is symmetrical
    seed: (s.seed ^ 0x51de) >>> 0,
  };

  /* BLADE ---------------------------------------------------------------- */
  if (C.build === 'blade') {
    const frac = { dagger: 0.55, shortsword: 0.58, sword: 0.62, longsword: 0.66,
      greatsword: 0.70, sabre: 0.64, rapier: 0.72 }[id] ?? 0.62;
    /* HALF-width as a fraction of blade length, taken from the real thing:
       a 90 cm longsword blade is about 4.5 cm across, which is 0.025. Sizing
       the blade off the STICK's girth instead — which is what the first
       version did — gave every sword the same 9 cm blade whether it was a
       dagger or a greatsword, so the long ones looked like wire and the
       short ones looked like paddles. Girth still has a say; it just is not
       the whole story any more. */
    const ratio = { dagger: 0.095, shortsword: 0.050, sword: 0.038, longsword: 0.030,
      greatsword: 0.032, sabre: 0.042, rapier: 0.014 }[id] ?? 0.035;
    const len = s.length * frac * r.range(0.92, 1.08);
    const width = len * ratio * (0.72 + m.girthN * 0.75) * r.range(0.85, 1.2);
    d.blade = {
      len,
      width,
      thick: width * r.range(0.17, 0.32),
      /* the stick's bend, kept */
      curve: m.bend * (1 - straighten) * (id === 'sabre' ? 1.5 : 0.8),
      taper: r.range(0.25, 0.9),
      belly: r.range(-0.3, 0.55),             // where the blade is widest
      edge: r.weighted(EDGES, e => e === 'plain' ? 3 : e === 'fuller' ? 2 : 1),
      tip: r.pick(['point', 'point', 'clip', 'spatulate', 'round', 'hook']),
      backEdge: r.chance(0.3),
      fullerDepth: r.range(0.2, 0.7),
    };
    d.guard = {
      kind: id === 'rapier' ? r.pick(['swept', 'ring', 'disc'])
        : r.weighted(GUARDS, g => g === 'crossbar' ? 4 : g === 'disc' ? 2 : 1),
      /* A guard is measured against the BLADE, never against the branch —
         but it also has a floor, because a guard's job is to cover a hand
         and a hand is the same size whatever is bolted in front of it.
         Blade-only sizing is right for a broadsword and exactly backwards
         for a rapier, whose hilt is huge precisely BECAUSE the blade is a
         needle: at 1.4 cm of half-width it was given a four-centimetre
         guard, and on the rack it read as a stick with nothing on it. */
      span: Math.max(
        width * r.range(2.4, 5.0),
        (id === 'rapier' ? 0.115 : id === 'dagger' ? 0.045 : 0.060) * r.range(0.9, 1.25)),
      droop: r.range(-0.5, 0.7),
      thick: width * r.range(0.30, 0.55),
    };
  }

  /* HEAD (hammers, maces, axes) ------------------------------------------- */
  if (C.build === 'hammer' || C.build === 'club' || C.build === 'axe') {
    const burl = s.extra?.burl;
    d.head = {
      kind: C.build === 'axe' ? r.pick(['bearded', 'wedge', 'crescent', 'broad'])
        : C.build === 'club' ? (burl ? 'burl' : r.pick(['taper', 'burl', 'knotted', 'banded']))
          : r.pick(['blockface', 'burl', 'stone', 'beaked', 'drum']),
      /* A head has to read as a head from across a clearing, so it gets a
         floor as well as a scale — a maul made from a whippy branch is still
         a maul, and a maul with a walnut on the end is a joke. Hammers carry
         the biggest heads because that is the entire idea of a hammer. */
      size: Math.max(C.build === 'hammer' ? 0.075 : 0.045,
        lerp(0.055, 0.19, m.girthN) * r.range(0.85, 1.35)
        * (burl ? r.range(1.2, 1.6) : 1)
        * (C.build === 'hammer' ? 1.35 : 1)),
      // 4 minimum: a 3-faced lathe is a triangular prism, and a hammer head
      // shaped like a wedge of cheese reads as a mistake rather than a style
      faces: r.int(4, 8),
      lumps: r.int(3, 9),
      spike: r.chance(C.build === 'hammer' ? 0.45 : 0.2),
      beard: r.range(0.2, 0.9),
      bands: r.int(0, 3),
      keepBurl: !!burl,
    };
  }

  /* POINT (spears, polearms) ---------------------------------------------- */
  if (C.build === 'polearm') {
    d.point = {
      kind: id === 'halberd' ? 'halberd'
        : id === 'polearm' ? r.pick(['glaive', 'bill', 'broad'])
          : r.pick(['leaf', 'needle', 'barbed', 'broad', 'tines']),
      len: Math.max(0.17, lerp(0.16, 0.44, m.girthN) * r.range(0.8, 1.3)
        * (id === 'spear' ? 1 : 1.5)),
      width: 0,     // half-width; set from len just below
      barbs: r.int(0, 3),
      socket: r.range(0.06, 0.16),
      tines: m.forks >= 2 && r.chance(0.6) ? Math.min(4, m.forks) : 0,
    };
    /* Half-width measured against the point's OWN length, because a spearhead
       is a long narrow leaf. Sized off the stick's girth instead — the first
       attempt — a short point on a fat branch came out as a gourd. */
    d.point.width = d.point.len * r.range(0.085, 0.17)
      * (d.point.kind === 'needle' ? 0.55 : 1);
  }

  /* GRIP — every weapon has one, and it is the part you actually look at -- */
  d.grip = {
    /* Clamped AFTER the two-hand bonus, not before. Multiplying a clamped
       length by up to 1.8 put a 90 cm grip on a 1.7 m spear, and a leather
       grip that long with a swell in the middle reads as a gourd stuck to
       the shaft rather than as somewhere to put your hands. */
    len: clamp(s.length * r.range(0.14, 0.27) * (C.hands === 2 ? r.range(1.15, 1.5) : 1),
      0.10, 0.52),
    wrap: r.weighted(WRAPS, w => w === 'cord' ? 3 : w === 'leather' ? 3 : 1.4),
    turns: r.int(5, 22),
    gap: r.chance(0.35),                       // wrapped in two bands, not one
    swell: r.range(0.96, 1.16),
    colour: r.range(0, 1),
  };
  d.pommel = {
    kind: r.weighted(POMMELS, p => p === 'knob' ? 3 : p === 'cap' ? 2 : 1),
    size: r.range(0.75, 1.5),
  };
  /* A FERRULE, ALWAYS. The collar where the grip stops and the working
     end begins is the single cheapest thing that makes a stick read as a
     made object rather than as a found one, and it used to be there
     barely half the time. */
  d.ferrule = true;
  d.bands = r.int(0, 4);

  /* DECORATION — sparse. A weapon covered in decoration reads as a toy. */
  d.deco = {
    inlay: r.chance(0.22) ? r.pick(['copper', 'silver', 'gold', 'bone', 'green']) : null,
    engraving: r.chance(0.28) ? r.pick(['knot', 'line', 'leaf', 'rune', 'wave', 'scale']) : null,
    studs: r.chance(0.18) ? r.int(2, 9) : 0,
    charms: r.chance(m.tier >= 3 ? 0.4 : 0.12) ? r.int(1, 3) : 0,
    cracks: clamp01(r.pow(2) * (0.3 + m.tier * 0.12)),
  };

  /* WHAT THE WOOD BROUGHT WITH IT. These are not effects layered on top —
     the builder places real geometry for each one, in the place it was on
     the stick, which is how you recognise the stick in the weapon. */
  d.carry = {
    moss: s.moss * (1 - d.strip * 0.55),
    mossSide: s.mossSide,
    fungi: (s.fungi || []).filter(() => r.chance(0.7)),
    bark: s.bark,
    barkLeft: clamp01(1 - d.strip),
    char: s.charred,
    pale: s.pale,
    lichen: s.lichen * (1 - d.strip * 0.7),
    nature: s.nature,
    special: s.special,
    inclusions: s.inclusions || [],
    effect: s.effect,
    knots: s.knots || [],
    ring: s.extra?.ring || null,
    coil: s.extra?.coil || null,
    braid: s.extra?.braid || null,
    split: s.extra?.split || null,
    bristle: s.extra?.bristle || null,
  };

  return d;
}

/* ========================================================================= */
/* TRAITS — the bullet list on the reveal card                               */
/* ========================================================================= */

/** The properties the finished weapon actually has, read off the stick. */
export function weaponTraits(s, m = null) {
  m = m || stickMetrics(s);
  const out = [];
  const push = (label, note) => out.push({ label, note });

  if (s.special && MATERIALS[s.special]) {
    const M = MATERIALS[s.special];
    push(M.label, M.note);
  }
  if (s.effect && EFFECTS[s.effect]) {
    const E = EFFECTS[s.effect];
    push(E.label, E.note);
  }
  if (s.rare && RARE[s.rare]) push(RARE[s.rare].label, RARE[s.rare].desc);

  if (s.moss > 0.64) push('Ancient Moss', 'Left on, and still growing.');
  else if (s.moss > 0.40) push('Mossbound', 'The green was worth keeping.');
  if (s.fungi?.some(f => f.kind === 'glow')) push('Foxfire Caps', 'They have not stopped.');
  else if ((s.fungi || []).length >= 3) push('Bracketed', 'Little shelves along the back of it.');
  if (s.charred > 0.3) push('Storm-struck', 'Black down one side and proud of it.');
  if (m.bend > 1.1) push('Curved Branch', 'The bend is the stick\'s, not the smith\'s.');
  if (m.straightN > 0.85 && s.length > 1.4) push('True Grain', 'Straight from end to end.');
  if (m.girthN > 0.7) push('Heavy Stock', 'There was a great deal of wood to work with.');
  if (m.forks >= 2) push('Forked', 'The fork was kept and sharpened.');
  if (s.extra?.ring) push('Open Eye', 'You can see through it. That was deliberate.');
  if (s.pale > 0.7) push('Bleached Wood', 'Bone-pale, and light for its size.');
  if (s.nature === 'thorns') push('Thorned', 'Still armed.');
  if (s.nature === 'vines') push('Vine-wound', 'The vine stayed on.');

  return out.slice(0, 5);
}

/* ========================================================================= */
/* STATS                                                                     */
/* ========================================================================= */

/**
 * The numbers come from the stick, not from the rarity. A Common greatsword
 * made from a thick oak limb genuinely hits harder than a Legendary wand, and
 * it should: rarity says how unusual a thing is, not how strong.
 */
export function weaponStats(clsId, s, m = null, design = null) {
  const C = WEAPON_CLASSES[clsId] || WEAPON_CLASSES.club;
  m = m || stickMetrics(s);
  const sp = SPECIES[s.species] || SPECIES.oak;
  const mat = s.special ? MATERIALS[s.special] : null;

  const hard = sp.hardness * (mat ? lerp(1, mat.hard, 0.45) : 1);
  const heft = (m.girth * 55 + m.len * 0.34) * hard * C.weight;
  const reach = C.reach * (0.72 + Math.min(1.1, m.len / 2.6) * 0.42);
  const swing = C.swing * (0.72 + heft * 0.20);
  const speed = 1 / swing;
  const bite = (5 + m.girth * 125) * hard * (C.weight * 0.55 + 0.6)
    * (C.build === 'blade' || C.build === 'axe' ? 1.25 : 1);
  const guard = 4 + m.girth * 70 * hard;

  return {
    // round2, not round1: the lightest wands weigh 0.04 and a stat that reads
    // 0.0 looks like a bug even when it is only a very small number
    heft: Math.max(0.02, round2(heft)),
    reach: round2(reach),
    speed: round2(speed),
    bite: Math.round(bite),
    guard: Math.round(guard),
    hands: C.hands,
    swingTime: swing,
    length: round2(m.len * (design ? lerp(0.88, 1.0, design.straighten) : 0.95)),
    material: sp.label,
    special: mat ? mat.label : null,
    tier: s.tier ?? 0,
  };
}

const round1 = v => Math.round(v * 10) / 10;
const round2 = v => Math.round(v * 100) / 100;

/* ========================================================================= */
/* NAMING                                                                    */
/* ========================================================================= */

/*
  A name is built as PREFIX + NOUN, where the prefix is a compound of two real
  syllables drawn from what the weapon is MADE OF, not from a bag of fantasy
  words. "Mossveil Crescent" is a curved sword with moss on it. "Cinderbranch
  Maul" is a maul made from a burnt limb. Nothing here can produce "Rare Sword"
  and nothing here can produce word salad, because both halves are earned.
*/

const HEADS = {
  emberflow: ['Ember', 'Cinder', 'Magma', 'Forge'],
  ember: ['Cinder', 'Ember', 'Smoulder', 'Coal'],
  crystal: ['Crystal', 'Quartz', 'Shard', 'Prism'],
  rime: ['Frost', 'Rime', 'Winter', 'Hoar'],
  amber: ['Amber', 'Resin', 'Honey', 'Sunset'],
  ironvein: ['Iron', 'Ore', 'Deepvein', 'Grey'],
  oldstone: ['Old', 'Stone', 'Elder', 'Barrow'],
  wisplight: ['Wisp', 'Pale', 'Lantern', 'Hollow'],
  foxfire: ['Fox', 'Wisp', 'Dusk', 'Lantern'],
  starlit: ['Star', 'Night', 'Spark', 'Far'],
  runemark: ['Rune', 'Script', 'Mark', 'Old'],
  petrified: ['Stone', 'Long', 'Slow', 'Deep'],
  singing: ['Song', 'Note', 'Reed', 'Hymn'],
  hollow: ['Hollow', 'Empty', 'Breath', 'Low'],
  everdamp: ['Rain', 'Mire', 'Weep', 'Damp'],
  moss: ['Moss', 'Green', 'Verd', 'Velvet'],
  fungal: ['Spore', 'Toadstool', 'Cap', 'Shade'],
  char: ['Cinder', 'Storm', 'Ash', 'Scorch'],
  pale: ['Bone', 'Pale', 'Drift', 'Salt'],
  thorn: ['Thorn', 'Briar', 'Barb', 'Black'],
  fork: ['Antler', 'Fork', 'Stag', 'Branch'],
  curve: ['Crescent', 'Moon', 'Sickle', 'Bow'],
  great: ['Old', 'Great', 'Long', 'Deep'],
  plain: ['Oak', 'Wood', 'Thicket', 'Hedge', 'Hearth', 'Bramble', 'Fern', 'Hollow'],
};

const TAILS = ['root', 'branch', 'wood', 'bark', 'bough', 'veil', 'fall', 'light',
  'thorn', 'reach', 'shade', 'wend', 'bind', 'song', 'grain', 'heart'];

/** The prefix half, chosen from whatever the weapon most obviously IS. */
function namePrefix(s, m, r) {
  const keys = [];
  const want = (k, n = 1) => { for (let i = 0; i < n; i++) keys.push(k); };

  if (s.special) want(s.special, 5);
  if (s.effect) want(s.effect, 4);
  if (s.charred > 0.3) want('char', 3);
  if (s.moss > 0.55) want('moss', 3);
  else if (s.moss > 0.32) want('moss', 1);
  if (s.fungi?.length >= 2) want('fungal', 2);
  if (s.pale > 0.62) want('pale', 2);
  if (s.nature === 'thorns') want('thorn', 2);
  if (m.forks >= 2) want('fork', 2);
  if (m.bend > 1.1) want('curve', 2);
  if (m.len > 2.4 || m.girthN > 0.7) want('great', 2);
  want('plain', 2);

  const head = r.pick(HEADS[r.pick(keys)] || HEADS.plain);
  /* A two-part prefix most of the time, one part sometimes: "Frostwood Lance"
     and "Frost Lance" are both good, and always compounding gets samey. */
  if (r.chance(0.72)) {
    let tail = r.pick(TAILS);
    // never "Thornthorn", never "Stonestone"
    if (head.toLowerCase().includes(tail) || tail.includes(head.toLowerCase())) tail = r.pick(TAILS);
    return head + tail;
  }
  return head;
}

export function weaponName(s, m, C, design, tier, rng = null) {
  const r = rng || makeRng((s.seed ^ 0x4a3e11) >>> 0);
  const noun = r.pick(C.nouns);
  const prefix = namePrefix(s, m, r);
  /* The top two tiers get an epithet, because at that rarity the thing has a
     reputation and a reputation is a clause, not an adjective. */
  if (tier >= 5 && r.chance(0.8)) {
    const epi = r.pick([
      'of the Long Wood', 'of the Quiet Hour', 'that Remembers', 'of the Deep Green',
      'the Unasked', 'of Nine Winters', 'that Was Found', 'of the Turning Year',
    ]);
    return `${prefix} ${noun} ${epi}`;
  }
  return `${prefix} ${noun}`;
}

/* ========================================================================= */
/* FLAVOUR                                                                   */
/* ========================================================================= */

/** What the Stickwright says when he hands it over. */
export function forgeBlurb(s, m, C, rng = null) {
  const r = rng || makeRng((s.seed ^ 0xb10b) >>> 0);
  const bits = [];
  if (m.bend > 1.1) bits.push('I did not take the bend out. You would not have thanked me.');
  if (m.straightN > 0.85 && m.len > 1.5) bits.push('Straight as that? You do not plane it. You leave it alone.');
  if (s.special) bits.push(`Had to work around the ${MATERIALS[s.special].label.toLowerCase()}. Worth it.`);
  if (s.moss > 0.55) bits.push('Kept the moss on. Take it out in the rain now and then.');
  if (s.charred > 0.3) bits.push('The burn stays. That is the whole story of the thing.');
  if (m.head) bits.push('You do not carve a burl. You just get out of its way.');
  if (m.forks >= 2) bits.push('Two points where there was one. That is arithmetic, not magic.');
  if (C.build === 'wand') bits.push('Small. Do not let that fool you.');
  if (!bits.length) bits.push('Good honest wood. It will not let you down.');
  return r.pick(bits);
}

/* ========================================================================= */
/* WHAT THE PLAYER IS TOLD BEFOREHAND                                        */
/* ========================================================================= */

/**
 * A HINT, never an answer. The player should walk to the workshop wondering,
 * so this describes the wood back to them and stops there.
 */
export function forgeHint(s) {
  const m = stickMetrics(s);
  const bits = [];
  if (m.len > 2.4) bits.push('a great deal of length');
  else if (m.len < 0.5) bits.push('barely a hand span');
  if (m.girthN > 0.65) bits.push('real weight to it');
  else if (m.slimN > 0.75) bits.push('fine and light');
  if (m.bend > 1.1) bits.push('a serious bend');
  else if (m.straightN > 0.85) bits.push('dead straight');
  if (m.head) bits.push('a head already grown on it');
  if (m.forks >= 2) bits.push('more than one point');
  if (s.special) bits.push('something in the grain that is not wood');
  if (!bits.length) bits.push('nothing obvious, which is its own kind of promise');
  return bits.slice(0, 3).join(', ');
}
