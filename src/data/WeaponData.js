/* WeaponData.js — what the Stickwright can make, and out of what.
   ===========================================================================
   A recipe is a REQUIREMENT ON A STICK, not a shopping list of abstract
   resources. "Needs a long straight stout branch" is something the player can
   go and look for; "needs 4 wood" is not. Every recipe here reads as a
   sentence about a piece of wood, and the satchel highlights the sticks that
   satisfy it.

   THE PROGRESSION IS DISCOVERY, NOT LEVELS. Nothing unlocks with experience.
   A recipe becomes available the moment you own wood that could make it, and
   the rare stick forms — the spiral, the burl, the ringbough — are the keys
   to the best of them. The reward for walking four hundred metres deeper into
   the wood is that you come back holding something nobody has seen before.
*/

import { hasTag, SPECIES, RARE } from './StickData.js';
import { listJoin } from '../core/Util.js';

/* ========================================================================= */
/* CLASSES                                                                   */
/* ========================================================================= */

/* The feel of each family. `swing` is seconds for a full swing, `reach` is
   metres, and `weight` drives how much the camera and the character lean. */
export const WEAPON_CLASSES = {
  stave: { label: 'Stave', swing: 0.62, reach: 2.1, weight: 0.5, hands: 2 },
  spear: { label: 'Spear', swing: 0.48, reach: 2.8, weight: 0.45, hands: 2 },
  club: { label: 'Club', swing: 0.70, reach: 1.4, weight: 0.8, hands: 1 },
  maul: { label: 'Maul', swing: 1.05, reach: 1.9, weight: 1.5, hands: 2 },
  hammer: { label: 'Hammer', swing: 0.85, reach: 1.5, weight: 1.1, hands: 1 },
  sledge: { label: 'Sledge', swing: 1.25, reach: 2.2, weight: 1.8, hands: 2 },
  sword: { label: 'Sword', swing: 0.50, reach: 1.6, weight: 0.7, hands: 1 },
  greatsword: { label: 'Greatsword', swing: 0.95, reach: 2.4, weight: 1.6, hands: 2 },
  broom: { label: 'Broom', swing: 0.58, reach: 2.0, weight: 0.55, hands: 2 },
  wand: { label: 'Wand', swing: 0.35, reach: 0.9, weight: 0.2, hands: 1 },
  axe: { label: 'Axe', swing: 0.78, reach: 1.5, weight: 1.0, hands: 1 },
  walkingStick: { label: 'Walking Stick', swing: 0.60, reach: 1.5, weight: 0.4, hands: 1 },
};

/* ========================================================================= */
/* RECIPES                                                                   */
/* ========================================================================= */

/**
 * `needs` is a list of slots. Each slot is {tags:[...], any:[...], not:[...],
 * label} and is matched against ONE stick. The order of slots is the order
 * the player fills them.
 *
 * `build` is read by WeaponArt: which crafted parts to add and how.
 */
export const RECIPES = [
  /* ---------------------------------------------------------- the basics */
  {
    id: 'walking_stick', name: 'Walking Stick', cls: 'walkingStick', tier: 0,
    needs: [{ label: 'a sound stick', tags: [], any: ['medium', 'long'], not: ['slender'] }],
    build: { grip: 'cord', pommel: 'knob', straighten: 0.35, strip: 0.25 },
    desc: 'Trimmed, smoothed and given a cord grip. It will not win a war, but ' +
      'it will get you up a hill and it will knock an apple down.',
    line: 'Everyone should have one. Everyone.',
  },
  {
    id: 'forest_stave', name: 'Forest Stave', cls: 'stave', tier: 1,
    needs: [{ label: 'a long straight stick', tags: ['long', 'straight'] }],
    build: { grip: 'leather', pommel: 'cap', ferrule: true, straighten: 0.7, strip: 0.5 },
    desc: 'A true stave: straight enough to sight along, bound at the middle ' +
      'and shod at both ends.',
    line: 'Straight wood is rarer than you would think. Hold on to this one.',
  },
  {
    id: 'cudgel', name: 'Cudgel', cls: 'club', tier: 1,
    needs: [{ label: 'a short stout stick', tags: ['stout'], any: ['short', 'medium'] }],
    build: { grip: 'cord', taper: 'club', strip: 0.6 },
    desc: 'Heavy at one end and comfortable at the other. That is the entire ' +
      'design, and it has not needed improving in ten thousand years.',
    line: 'Nothing clever about it. That is rather the point.',
  },
  {
    id: 'wooden_spear', name: 'Wooden Spear', cls: 'spear', tier: 1,
    needs: [{ label: 'a long slender straight stick', tags: ['long', 'straight'], any: ['slender', 'sound'] }],
    build: { grip: 'cord', head: 'point', straighten: 0.85, strip: 0.75, fireHarden: true },
    desc: 'Sharpened, fire-hardened and bound below the point so it does not ' +
      'split when it bites.',
    line: 'Fire-hardened. Takes a whole evening and it is worth every minute.',
  },

  /* --------------------------------------------------------- the carvings */
  {
    id: 'wooden_sword', name: 'Carved Sword', cls: 'sword', tier: 2,
    needs: [{ label: 'a straight, sound stick of some length', tags: ['straight'], any: ['medium', 'long'], not: ['slender'] }],
    build: { blade: 'sword', guard: 'crossbar', grip: 'leather', pommel: 'disc', straighten: 0.9, strip: 1 },
    desc: 'Split down the grain, planed flat and given an edge you can feel ' +
      'without cutting yourself on it.',
    line: 'Wood remembers being a tree. Carve WITH it, never across it.',
  },
  {
    id: 'greatsword', name: 'Woodsman\'s Greatsword', cls: 'greatsword', tier: 3,
    needs: [{ label: 'a great straight limb', tags: ['great', 'straight'], any: ['stout', 'massive'] }],
    build: { blade: 'great', guard: 'longbar', grip: 'wrapped', pommel: 'heavy', straighten: 0.95, strip: 1 },
    desc: 'Two-handed, shoulder to floor, and heavier than it looks. It takes ' +
      'a limb the size of your leg to get a blade this long out of one piece.',
    line: 'Now THAT is a piece of wood. Give me three days.',
  },
  {
    id: 'heart_greatsword', name: 'Heartwood Greatsword', cls: 'greatsword', tier: 4,
    needs: [{ label: 'a heartwood core', tags: ['rare:heartwood'] }],
    build: {
      blade: 'great', guard: 'longbar', grip: 'wrapped', pommel: 'heavy',
      straighten: 1, strip: 1, dark: true, inlay: 'gold',
    },
    desc: 'The unrotted heart of a fallen giant. It rings when you knock it and ' +
      'it does not care what the weather is doing.',
    line: 'Sixty winters of rot could not touch this. Nor will anything else.',
  },

  /* ------------------------------------------------------------ the heavy */
  {
    id: 'woodhammer', name: 'Woodhammer', cls: 'hammer', tier: 2,
    needs: [
      { label: 'a burl-headed limb', tags: ['heavy-head'] },
    ],
    build: { head: 'burl', grip: 'cord', bands: 2, strip: 0.5 },
    desc: 'A burl grown hard as iron, left exactly where it grew, with the limb ' +
      'below it trimmed into a handle.',
    line: 'You do not carve a maulhead. You just get out of its way.',
  },
  {
    id: 'sledge', name: 'Forest Sledge', cls: 'sledge', tier: 3,
    needs: [
      { label: 'a burl-headed limb', tags: ['heavy-head'] },
      { label: 'a long straight haft', tags: ['long', 'straight'] },
    ],
    build: { head: 'burl', haft: 1, grip: 'wrapped', bands: 3, wedge: true, strip: 0.8 },
    desc: 'The burl socketed onto a haft as long as you are tall and wedged ' +
      'home. Two hands, a wide stance, and a great deal of patience.',
    line: 'One burl, one haft, one wedge. Swing from the hips, not the arms.',
  },
  {
    id: 'knot_maul', name: 'Knotbraid Maul', cls: 'maul', tier: 3,
    needs: [{ label: 'a knotbraid limb', tags: ['rare:knotbraid'] }],
    build: { taper: 'club', grip: 'wrapped', bands: 2, strip: 1, polish: true },
    desc: 'Three stems fused into one rope of bone-pale wood. The lumps are not ' +
      'a flaw — they are where it hits.',
    line: 'Peel it, oil it, and never ask it a question twice.',
  },

  /* ------------------------------------------------------- the magic ones */
  {
    id: 'besom', name: 'Besom Broom', cls: 'broom', tier: 2,
    needs: [{ label: 'a bristled besom-bunch', tags: ['bristled'] }],
    build: { bristles: true, bind: 'cord', grip: 'cord', straighten: 0.6, strip: 0.4 },
    desc: 'Bound tight below the head with three turns of cord. Sweeps a floor. ' +
      'Sweeps a good deal else, if you ask it nicely.',
    line: 'Bind it with three turns, not two. Three is the one that matters.',
  },
  {
    id: 'witch_broom', name: 'Witchwood Broom', cls: 'broom', tier: 4,
    needs: [
      { label: 'a bristled besom-bunch', tags: ['bristled'] },
      { label: 'something with foxfire or deep moss in it', tags: [], any: ['glowing', 'verdant', 'foxfire'] },
    ],
    build: {
      bristles: true, bind: 'braid', grip: 'wrapped', glow: true,
      charms: true, straighten: 0.6, strip: 0.4,
    },
    desc: 'The same broom, bound with foxfire in the cord. It hums very faintly ' +
      'on the way home and the cat will not go near it.',
    line: 'Do not ask me what it does. Ask it. It will not answer, but ask.',
  },
  {
    id: 'serpent_stave', name: 'Serpentcoil Stave', cls: 'stave', tier: 3,
    needs: [{ label: 'a serpentcoil stave', tags: ['rare:serpentcoil'] }],
    build: { grip: 'leather', ferrule: true, pommel: 'cap', strip: 0.55, polish: true, inlay: 'copper' },
    desc: 'The vine that strangled the sapling is still wound round it, grown ' +
      'into the grain. Polished, the spiral runs the whole length.',
    line: 'Two trees fighting for thirty years. Now they are one thing.',
  },
  {
    id: 'ring_blade', name: 'Ringbough Warblade', cls: 'sword', tier: 3,
    needs: [{ label: 'a ringbough with an open eye', tags: ['holed'] }],
    build: { blade: 'ring', guard: 'none', grip: 'wrapped', keepHole: true, strip: 1, polish: true },
    desc: 'Flattened and edged on both sides, with the healed eye left open ' +
      'through the middle of the blade. It whistles.',
    line: 'Leave the hole. Everyone asks. LEAVE the hole.',
  },
  {
    id: 'moss_stave', name: 'Mossbound Stave', cls: 'stave', tier: 2,
    needs: [{ label: 'a long, deeply mossed stick', tags: ['mossy'], any: ['long', 'medium'] }],
    build: { grip: 'braid', keepMoss: true, pommel: 'knob', straighten: 0.5, strip: 0.2 },
    desc: 'The moss is left on and fed. It keeps growing, very slowly, for as ' +
      'long as somebody carries it out into the rain.',
    line: 'Take it outside when it rains. It will thank you in its own way.',
  },
  {
    id: 'toadstool_wand', name: 'Toadstool Wand', cls: 'wand', tier: 2,
    needs: [{ label: 'a short stick with fungi on it', tags: ['fungal'], any: ['short', 'medium'] }],
    build: { grip: 'cord', keepFungi: true, pommel: 'knob', strip: 0.3, polish: true },
    desc: 'Barely longer than your forearm, with its little brackets still ' +
      'clinging on. They have not stopped growing.',
    line: 'Careful. Those are alive, and they have opinions.',
  },
  {
    id: 'foxfire_wand', name: 'Foxfire Wand', cls: 'wand', tier: 4,
    needs: [{ label: 'something the foxfire got into', tags: ['glowing'] }],
    build: { grip: 'braid', keepFungi: true, glow: true, pommel: 'cap', strip: 0.2, polish: true },
    desc: 'Pale as a bone in daylight. After dusk you can read by it, if you are ' +
      'the sort of person who reads after dusk in a wood.',
    line: 'Keep it in the satchel until dark. Then take it out. Go on.',
  },
  {
    id: 'storm_shard', name: 'Storm-struck Cleaver', cls: 'axe', tier: 4,
    needs: [{ label: 'a lightning-split shard', tags: ['charred', 'split'] }],
    build: { blade: 'cleave', guard: 'none', grip: 'wrapped', bands: 2, keepChar: true, strip: 0.7 },
    desc: 'Struck, split and thrown clear of the tree. Black down one side, raw ' +
      'down the other, and still faintly of the storm.',
    line: 'The tree took the strike so this would not have to. Respect that.',
  },
  {
    id: 'antler_fork', name: 'Antlerwood Fork', cls: 'spear', tier: 3,
    needs: [{ label: 'an antlerwood fork', tags: ['rare:antler'] }],
    build: { head: 'tines', grip: 'leather', bands: 2, strip: 0.8, polish: true },
    desc: 'Forked and forked again. Every tine sharpened, and it catches things ' +
      'a single point would slide straight past.',
    line: 'Four points. Four chances. That is arithmetic, not magic.',
  },
  {
    id: 'drift_stave', name: 'Driftbone Stave', cls: 'stave', tier: 2,
    needs: [{ label: 'a river-bleached branch', tags: ['rare:driftbone'] }],
    build: { grip: 'leather', pommel: 'cap', ferrule: true, straighten: 0.55, strip: 1, polish: true },
    desc: 'The river stripped it, the sun bleached it and the current sanded it ' +
      'smooth. Half the weight of anything else this long.',
    line: 'The water did most of my job for me. Do not tell anyone.',
  },
  {
    id: 'thorn_club', name: 'Blackthorn Shillelagh', cls: 'club', tier: 2,
    needs: [{ label: 'a knotted blackthorn stick', tags: ['wood:blackthorn'], any: ['stout', 'knotted', 'thorned'] }],
    build: { taper: 'club', grip: 'leather', polish: true, strip: 0.35, dark: true },
    desc: 'Cured in the chimney until it went black, then oiled. Blackthorn ' +
      'grows knots where it is hit, which tells you what it is for.',
    line: 'Up the chimney for a month. That is not a joke, that is the method.',
  },
];

export const RECIPE_BY_ID = Object.fromEntries(RECIPES.map(r => [r.id, r]));

/* ========================================================================= */
/* MATCHING                                                                  */
/* ========================================================================= */

/** Does this stick satisfy this slot? */
export function slotAccepts(slot, stick) {
  if (!stick) return false;
  const tags = stick.tags || [];
  if (slot.tags) for (const t of slot.tags) if (!tags.includes(t)) return false;
  if (slot.any && slot.any.length) {
    if (!slot.any.some(t => tags.includes(t))) return false;
  }
  if (slot.not) for (const t of slot.not) if (tags.includes(t)) return false;
  return true;
}

/** Every recipe at least one stick in the satchel could start. */
export function availableRecipes(sticks) {
  return RECIPES.filter(rec => rec.needs.every((slot, i) => {
    // a stick may only fill one slot, so check there are enough distinct ones
    const pool = sticks.filter(s => slotAccepts(slot, s));
    return pool.length >= countSlotsLike(rec, slot);
  }));
}

function countSlotsLike(rec, slot) {
  return rec.needs.filter(s => s.label === slot.label).length;
}

/** The first valid assignment of sticks to a recipe's slots, or null. */
export function autoFill(recipe, sticks) {
  const used = new Set();
  const out = [];
  for (const slot of recipe.needs) {
    // prefer the BEST stick that fits, not the first: a player who has a
    // storied limb and a twig should get the limb offered
    const cand = sticks
      .filter(s => !used.has(s.uid) && slotAccepts(slot, s))
      .sort((a, b) => (b.tier - a.tier) || (b.length - a.length));
    if (!cand.length) return null;
    used.add(cand[0].uid);
    out.push(cand[0]);
  }
  return out;
}

/** A readable sentence describing what a recipe wants. */
export function recipeNeedText(recipe) {
  return listJoin(recipe.needs.map(s => s.label), 'and');
}

/* ========================================================================= */
/* STATS                                                                     */
/* ========================================================================= */

/**
 * A weapon's numbers come from the STICK, so two Carved Swords made from
 * different oak are genuinely different swords. There is no combat in this
 * build; these drive the inspect panel and how the thing swings and sits in
 * the hand, which is what the player can actually see.
 */
export function weaponStats(recipe, sticks) {
  const C = WEAPON_CLASSES[recipe.cls];
  const main = sticks[0];
  const sp = SPECIES[main.species] || SPECIES.oak;
  const total = sticks.reduce((s, k) => s + k.length, 0);
  const thick = sticks.reduce((s, k) => Math.max(s, k.thick), 0);

  const heft = (thick * 60 + total * 0.35) * sp.hardness * C.weight;
  const reach = C.reach * (0.75 + Math.min(1.0, total / 2.6) * 0.45);
  const speed = 1 / (C.swing * (0.75 + heft * 0.22));
  const bite = (6 + thick * 130) * sp.hardness * (C.weight * 0.6 + 0.6);

  return {
    heft: Math.round(heft * 10) / 10,
    reach: Math.round(reach * 100) / 100,
    speed: Math.round(speed * 100) / 100,
    bite: Math.round(bite),
    hands: C.hands,
    swingTime: C.swing * (0.75 + heft * 0.22),
    length: total,
    material: sp.label,
    tier: Math.max(recipe.tier, ...sticks.map(s => s.tier || 0)),
  };
}

/**
 * The finished weapon's name. It takes the wood and any rare form from the
 * stick it was made of, so "Oak Carved Sword" and "Storm-struck Ash Cleaver"
 * both come out of the same recipe row.
 */
export function weaponName(recipe, sticks) {
  const main = sticks[0];
  const sp = SPECIES[main.species] || SPECIES.oak;
  if (main.rare && RARE[main.rare] && !recipe.name.includes(RARE[main.rare].label)) {
    return `${sp.label} ${recipe.name}`;
  }
  return `${sp.label} ${recipe.name}`;
}
