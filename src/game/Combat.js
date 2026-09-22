/* Combat.js — how a weapon is held, and what happens when you swing it.
   ===========================================================================
   The old code mounted every weapon with one line:

       m.rotation.set(-0.35, 0, 0.22);

   which is why a dagger, a war hammer and a three-metre halberd all sat in
   the paw at the same jaunty angle, and why none of them looked like they
   weighed anything. A greatsword is not a dagger held further out; it is a
   different object with a different centre of mass, carried differently,
   swung differently and recovered from differently.

   So this file is two tables and the code that reads them:

     CARRY   where the weapon sits in the hand AT REST, plus the rest pose of
             both arms — including where the off hand goes on a two-hander,
             which is the single detail that makes a heavy weapon look heavy.
     ATTACKS what a swing IS for that family: an overhead smash, a flat
             slash, a thrust, a long sweep. Different arcs, different
             timings, different body rotation, different recovery.

   Neither table is per-weapon. There are twenty-two weapon classes and
   thousands of generated weapons, and hand-authoring a pose for each is both
   impossible and pointless — what matters is the FAMILY and how heavy it is.
*/

import { WEAPON_CLASSES } from '../data/WeaponData.js?v=1790100127';
import { clamp, clamp01, lerp, smoothstep } from '../core/Util.js?v=1790100127';

/* ========================================================================= */
/* CARRY                                                                     */
/* ========================================================================= */

/**
 * `rot` is the weapon's rotation in the grip. The mesh arrives with its grip
 * at the origin and its head along +Y, so this is purely "which way does it
 * lean".
 *
 * `main` / `off` are the arms: `sx` shoulder pitch, `sz` shoulder outward,
 * `ex` elbow bend. `off` is only used when the weapon takes two hands, and
 * `offZ` is how far across the body the supporting paw reaches.
 */
const REST = {
  /* --- one-handed blades: relaxed, point up and a little forward -------- */
  blade1: {
    rot: [-0.30, 0.02, 0.26], pos: [0, 0, 0],
    main: { sx: -0.18, sz: 0.16, ex: -0.52 },
  },
  /* --- two-handed blades: across the body, both paws on the grip -------- */
  blade2: {
    rot: [-0.52, 0.18, 0.42], pos: [0, 0, 0],
    main: { sx: -0.42, sz: 0.10, ex: -0.75 },
    off: { sx: -0.58, sz: -0.34, ex: -1.05 }, offZ: 0.62,
  },
  /* --- clubs and one-handed hammers: shaft near upright, head up ------- */
  club: {
    rot: [-0.14, 0, 0.15], pos: [0, 0, 0],
    main: { sx: -0.10, sz: 0.14, ex: -0.45 },
  },
  /* --- mauls and sledges: SHOULDERED. Nobody carries fifteen kilos of
         iron out at arm's length, and resting it on the shoulder is what
         reads as weight without needing a single extra triangle. --------- */
  heavy: {
    rot: [0.92, 0.20, 0.30], pos: [0, 0.02, -0.02],
    main: { sx: -1.05, sz: 0.24, ex: -1.25 },
    off: { sx: -0.35, sz: -0.20, ex: -0.85 }, offZ: 0.40,
  },
  /* --- axes: head canted out so the bit reads in silhouette ------------ */
  axe1: {
    rot: [-0.22, -0.10, 0.20], pos: [0, 0, 0],
    main: { sx: -0.14, sz: 0.16, ex: -0.48 },
  },
  axe2: {
    rot: [-0.62, 0.14, 0.38], pos: [0, 0, 0],
    main: { sx: -0.55, sz: 0.12, ex: -0.90 },
    off: { sx: -0.52, sz: -0.30, ex: -1.00 }, offZ: 0.55,
  },
  /* --- polearms: carried sloped, point up and forward, both hands ------ */
  pole: {
    rot: [-0.72, 0.04, 0.14], pos: [0, 0.04, 0],
    main: { sx: -0.30, sz: 0.12, ex: -0.55 },
    off: { sx: -0.85, sz: -0.22, ex: -0.70 }, offZ: 0.70,
  },
  /* --- staves and walking sticks: nearly vertical, butt near the ground - */
  staff: {
    rot: [-0.06, 0, 0.07], pos: [0, -0.02, 0],
    main: { sx: -0.06, sz: 0.12, ex: -0.30 },
  },
  broom: {
    rot: [-0.26, 0.05, 0.11], pos: [0, 0, 0],
    main: { sx: -0.16, sz: 0.13, ex: -0.42 },
  },
  /* --- wands: small, held lightly, tip forward ------------------------- */
  wand: {
    rot: [-0.62, 0, 0.30], pos: [0, 0, 0],
    main: { sx: -0.34, sz: 0.20, ex: -0.80 },
  },
  oddity: {
    rot: [-0.38, 0.22, 0.24], pos: [0, 0, 0],
    main: { sx: -0.24, sz: 0.18, ex: -0.60 },
  },
};

/** Which rest pose each weapon class uses. */
/* --- THINGS THAT ARE NOT WEAPONS ------------------------------------------
   A rod and a fish both end up in the same paw as a sword and both looked
   wrong being carried like one: the rod was held out like a sabre instead
   of sloped up over the shoulder, and a fish held at a blade's angle hangs
   nose-down like something being taken to a bin. */
REST.rod = {
  /* sloped up and across, the way anybody carries a rod between casts */
  rot: [-0.62, 0.10, 0.30], pos: [0, 0, 0],
  main: { sx: -0.34, sz: 0.18, ex: -0.62 },
  off: { sx: -0.30, sz: -0.26, ex: -0.70 }, offZ: 0.30,
};
REST.fish = {
  /* HELD UP AND OUT, by the tail, turned so its flank faces outward.
     The whole point of carrying a fish is showing it to somebody, so it
     is presented rather than transported — and it is turned broadside,
     because a fish seen end-on is a shape nobody can read. */
  rot: [-1.15, 0.55, 0.18], pos: [0, 0.02, 0.03],
  main: { sx: -1.05, sz: 0.30, ex: -0.72 },
};

const CARRY_OF = {
  dagger: 'blade1', shortsword: 'blade1', sword: 'blade1', sabre: 'blade1', rapier: 'blade1',
  longsword: 'blade2', greatsword: 'blade2',
  club: 'club', mace: 'club', warhammer: 'club',
  maul: 'heavy', sledge: 'heavy',
  axe: 'axe1', battleaxe: 'axe2',
  spear: 'pole', polearm: 'pole', halberd: 'pole',
  staff: 'staff', walkingStick: 'staff',
  broom: 'broom', wand: 'wand', oddity: 'oddity',
  rod: 'rod', fish: 'fish',
};

export function carryFor(cls) {
  return REST[CARRY_OF[cls] || 'club'] || REST.club;
}

/* ========================================================================= */
/* ATTACKS                                                                   */
/* ========================================================================= */

/**
 * An attack is described as a few numbers rather than as keyframes, because
 * the same description has to work on a frog and on a fox — two skeletons
 * with different arm lengths and very different body shapes.
 *
 *   wind    fraction of the move spent winding up
 *   strike  fraction spent on the strike itself (short — that IS the impact)
 *   sx/sz   how far the shoulder travels, in radians, over the strike
 *   twist   how much the torso rotates into it
 *   lunge   how far the body leans forward
 *   hitAt   when in the move the hit lands, as a fraction
 */
export const ATTACKS = {
  slash: {
    label: 'slash', wind: 0.34, strike: 0.20, sx: -1.75, sz: -0.62,
    twist: 0.44, lunge: 0.14, hitAt: 0.47, arc: 1.5, reachMul: 1.0,
  },
  thrust: {
    label: 'thrust', wind: 0.40, strike: 0.14, sx: -0.55, sz: -0.12,
    twist: 0.22, lunge: 0.42, hitAt: 0.50, arc: 0.5, reachMul: 1.35,
  },
  smash: {
    label: 'smash', wind: 0.44, strike: 0.18, sx: -2.35, sz: -0.30,
    twist: 0.26, lunge: 0.20, hitAt: 0.58, arc: 0.9, reachMul: 0.92,
  },
  sweep: {
    label: 'sweep', wind: 0.32, strike: 0.26, sx: -1.30, sz: -1.05,
    twist: 0.66, lunge: 0.10, hitAt: 0.48, arc: 2.2, reachMul: 1.12,
  },
  flick: {
    label: 'flick', wind: 0.26, strike: 0.16, sx: -1.05, sz: -0.35,
    twist: 0.28, lunge: 0.06, hitAt: 0.42, arc: 0.9, reachMul: 0.8,
  },
};

/* ========================================================================= */
/* THE COMBO                                                                 */
/* ========================================================================= */

/**
 * THREE HITS, AND THE THIRD IS THE ONE THAT MATTERS.
 *
 *   1. across the body from the LEFT
 *   2. back across it from the RIGHT
 *   3. straight down the middle, harder and slower than either
 *
 * `mirror` flips the whole swing, which is what makes the second hit read as
 * a backhand rather than as the first one played again. `damage` and `push`
 * climb, and step three costs a longer recovery — so mashing is not free and
 * finishing the string is a decision, not a reflex.
 *
 * The chain is dropped if the player waits longer than `COMBO_WINDOW`, which
 * is generous on purpose: this is a cozy game, not a fighting game.
 */
export const COMBO = [
  { step: 0, mirror: false, damage: 1.00, push: 1.00, speed: 1.00, recover: 0.16, arcMul: 1.00, label: 'left' },
  { step: 1, mirror: true, damage: 1.15, push: 1.10, speed: 0.95, recover: 0.18, arcMul: 1.05, label: 'right' },
  { step: 2, mirror: false, damage: 1.70, push: 1.85, speed: 0.80, recover: 0.38, arcMul: 0.80, label: 'finisher', straight: true },
];

/** How long after a swing the next one still counts as part of the string. */
export const COMBO_WINDOW = 0.95;

/* ========================================================================= */
/* THE HEAVY ATTACK                                                          */
/* ========================================================================= */

/**
 * Hold the button and the weapon winds up in three stages, two seconds each.
 * Every stage lands with a small bright pulse — a *glimpse*, not a firework:
 * the brief was specific that it should read as "charged", not as an
 * explosion going off in a cozy wood.
 *
 * Releasing before the first stage is an ordinary combo hit, so holding is
 * never a punishment for a slow finger.
 */
export const CHARGE_STAGE_SECONDS = 2.0;
export const CHARGE = [
  { stage: 1, damage: 2.4, push: 2.2, arcMul: 1.15, reachMul: 1.10, flash: 0.45, col: 0xffe9a8 },
  { stage: 2, damage: 4.2, push: 3.2, arcMul: 1.30, reachMul: 1.20, flash: 0.70, col: 0xffd06a },
  { stage: 3, damage: 7.5, push: 4.6, arcMul: 1.55, reachMul: 1.35, flash: 1.00, col: 0xffa63c },
];

/** Which stage a given hold time has reached. 0 = not charged yet. */
export function chargeStage(held) {
  return clamp(Math.floor(held / CHARGE_STAGE_SECONDS), 0, CHARGE.length);
}
/** Progress 0..1 through the CURRENT stage, for the ring on the HUD. */
export function chargeProgress(held) {
  const s = chargeStage(held);
  if (s >= CHARGE.length) return 1;
  return clamp01((held - s * CHARGE_STAGE_SECONDS) / CHARGE_STAGE_SECONDS);
}

const ATTACK_OF = {
  dagger: 'thrust', rapier: 'thrust', spear: 'thrust',
  shortsword: 'slash', sword: 'slash', sabre: 'slash', longsword: 'slash',
  axe: 'slash',
  greatsword: 'sweep', polearm: 'sweep', halberd: 'sweep', staff: 'sweep',
  battleaxe: 'sweep', broom: 'sweep',
  club: 'smash', mace: 'smash', warhammer: 'smash', maul: 'smash', sledge: 'smash',
  walkingStick: 'flick', wand: 'flick', oddity: 'flick',
};

export function attackFor(cls) {
  return ATTACKS[ATTACK_OF[cls] || 'slash'];
}

/**
 * How long one swing takes, and how far it reaches.
 * Both come off the weapon's own generated stats, so a heavy stick genuinely
 * makes a slower weapon than a light one — the numbers the forge rolled are
 * the numbers the combat uses.
 */
export function swingOf(weapon, { combo = 0, charge = 0 } = {}) {
  const cls = weapon?.cls || 'club';
  const C = WEAPON_CLASSES[cls] || WEAPON_CLASSES.club;
  const base = attackFor(cls);
  const st = weapon?.stats || {};

  /* --- which move is this? -------------------------------------------- */
  const ch = charge > 0 ? CHARGE[clamp(charge, 1, CHARGE.length) - 1] : null;
  const K = ch ? null : COMBO[clamp(combo, 0, COMBO.length - 1)];

  /* The finisher and every charged hit come straight down the middle
     whatever the weapon's usual arc is — that is what makes the last hit of
     the string feel like a different move rather than a louder one. */
  const A = (K?.straight || ch)
    ? { ...base, ...ATTACKS[ATTACK_OF[cls] === 'thrust' ? 'thrust' : 'smash'], label: ch ? 'heavy' : 'finisher' }
    : base;

  const speed = ch ? 0.72 : K.speed;
  const dmgMul = ch ? ch.damage : K.damage;
  const pushMul = ch ? ch.push : K.push;
  const arcMul = ch ? ch.arcMul : K.arcMul;

  return {
    cls, attack: A,
    combo: ch ? -1 : K.step,
    charge, chargeDef: ch,
    mirror: !ch && K.mirror,
    duration: clamp((st.swingTime ?? C.swing) / speed, 0.26, 2.2),
    recover: ch ? 0.45 : K.recover,
    reach: (st.reach ?? C.reach) * A.reachMul * (ch ? ch.reachMul : 1),
    arc: A.arc * arcMul,
    hands: C.hands,
    heft: st.heft ?? 1,
    /* the number that actually lands. `bite` is what the forge rolled for
       this specific weapon, so a better stick still makes a better hit. */
    damage: Math.round((st.bite ?? 6) * dmgMul),
    push: (0.9 + (st.heft ?? 1) * 0.5) * pushMul,
    label: ch ? `heavy ${ch.stage}` : K.label,
  };
}

/* ========================================================================= */
/* THE CARRY POSE                                                            */
/* ========================================================================= */

/**
 * Fold the weapon's rest pose into the arms, ON TOP of whatever the gait
 * already did.
 *
 * `weight` fades the whole thing in, so drawing a weapon does not snap the
 * arms; and the main arm keeps a little of its walk swing, because an arm
 * that is perfectly rigid while the legs move reads as a mannequin carrying
 * a prop rather than as someone holding something.
 */
export function applyCarry(rig, cls, weight = 1, bob = 0) {
  const p = rig.parts;
  if (!p?.arms?.length) return;
  const C = carryFor(cls);
  const main = p.arms[1], off = p.arms[0];
  const w = clamp01(weight);

  main.shoulder.rotation.x = lerp(main.shoulder.rotation.x, C.main.sx + bob * 0.10, w);
  main.shoulder.rotation.z = lerp(main.shoulder.rotation.z, main.side * C.main.sz, w);
  main.elbow.rotation.x = lerp(main.elbow.rotation.x, C.main.ex, w);

  if (C.off) {
    /* THE SUPPORTING HAND. Two-handed weapons look wrong the instant the
       spare paw is left swinging at the character's side — it is the thing
       that says "this is heavy" more than any amount of lean. */
    off.shoulder.rotation.x = lerp(off.shoulder.rotation.x, C.off.sx + bob * 0.06, w);
    off.shoulder.rotation.z = lerp(off.shoulder.rotation.z, off.side * C.off.sz, w);
    off.elbow.rotation.x = lerp(off.elbow.rotation.x, C.off.ex, w);
  }
}

/**
 * The swing itself, driven from the attack description.
 *
 * The shape is always wind → strike → recover with the strike much shorter
 * than the wind-up, because that asymmetry IS the impact: a swing that takes
 * as long to arrive as it took to prepare looks like stirring soup.
 */
export function applyAttack(rig, cls, t, weight = 1, swing = null) {
  const p = rig.parts;
  if (!p?.arms?.length) return 0;
  const A = swing?.attack || attackFor(cls);
  const C = carryFor(cls);
  const main = p.arms[1], off = p.arms[0];
  const w = clamp01(weight);

  /* MIRRORING IS WHAT MAKES THE SECOND HIT A SECOND HIT.
     The backhand is the same description played with the horizontal
     components negated: the shoulder opens the other way, the torso winds
     the other way, the weapon travels right-to-left. Playing the first
     swing twice and calling it a combo is the thing this avoids. */
  const mir = swing?.mirror ? -1 : 1;
  /* the finisher and the charged blows come down the centre line, so the
     sideways component is damped right out and the lunge is doubled */
  const centre = swing && (swing.combo === 2 || swing.charge > 0);
  const lat = centre ? 0.25 : 1;
  const lunge = A.lunge * (centre ? 2.0 : 1);

  const wind = smoothstep(clamp01(t / A.wind));
  const strike = smoothstep(clamp01((t - A.wind) / A.strike));
  const rec = smoothstep(clamp01((t - A.wind - A.strike) / Math.max(0.08, 1 - A.wind - A.strike)));
  // +1 while winding, sweeping to -1 through the strike, easing back to 0
  const s = wind - strike * 1.85 + rec * 0.85;

  main.shoulder.rotation.x = lerp(main.shoulder.rotation.x, C.main.sx + s * A.sx, w);
  main.shoulder.rotation.z = lerp(main.shoulder.rotation.z,
    main.side * (C.main.sz + s * A.sz * mir * lat), w);
  main.elbow.rotation.x = lerp(main.elbow.rotation.x,
    C.main.ex + (1 - strike) * -0.55 + strike * 0.45, w);

  if (C.off) {
    off.shoulder.rotation.x = lerp(off.shoulder.rotation.x, C.off.sx + s * A.sx * 0.72, w);
    off.shoulder.rotation.z = lerp(off.shoulder.rotation.z,
      off.side * (C.off.sz + s * A.sz * 0.5 * mir * lat), w);
    off.elbow.rotation.x = lerp(off.elbow.rotation.x, C.off.ex + s * 0.30, w);
  }

  /* the body goes with it: a swing that is only an arm is a swing with no
     weight behind it */
  const side = main.side * mir;
  p.torso.rotation.y = (p.torso.rotation.y || 0) - s * A.twist * side * lat * w;
  p.hip.rotation.y = (p.hip.rotation.y || 0) - s * A.twist * 0.42 * side * lat * w;
  p.hip.rotation.x = (p.hip.rotation.x || 0) + (wind * -0.10 + strike * lunge) * w;
  if (p.head) p.head.rotation.y += s * A.twist * 0.30 * side * lat * w;

  return strike - rec;   // >0 while the blow is actually out
}

/**
 * The wind-up pose while the heavy attack is charging.
 *
 * Held over the shoulder, sinking a little lower with each stage, with the
 * whole body coiling. It is a HOLD, not a loop — the only motion is a fine
 * tremor that grows as the charge does, which is what sells "this is about
 * to go off" without anything actually moving.
 */
export function applyCharge(rig, cls, held, stage, t) {
  const p = rig.parts;
  if (!p?.arms?.length) return;
  const C = carryFor(cls);
  const main = p.arms[1], off = p.arms[0];
  const k = clamp01(held / (CHARGE_STAGE_SECONDS * CHARGE.length));
  const shake = stage * 0.006 * (1 + Math.sin(t * 46) * 0.6);

  main.shoulder.rotation.x = C.main.sx - 1.35 - k * 0.55 + shake;
  main.shoulder.rotation.z = main.side * (C.main.sz + 0.42 + k * 0.20);
  main.elbow.rotation.x = C.main.ex - 0.85 - k * 0.35 - shake;
  if (C.off) {
    off.shoulder.rotation.x = C.off.sx - 0.75 - k * 0.35;
    off.shoulder.rotation.z = off.side * (C.off.sz - 0.25);
    off.elbow.rotation.x = C.off.ex - 0.55;
  }
  p.torso.rotation.y = (p.torso.rotation.y || 0) + 0.34 * main.side * (0.5 + k * 0.7);
  p.hip.rotation.x = (p.hip.rotation.x || 0) - 0.10 - k * 0.12;
  if (p.head) p.head.rotation.x = (p.head.rotation.x || 0) - 0.12 * k;
}

/* ========================================================================= */
/* WHAT THE SWING HITS                                                       */
/* ========================================================================= */

/**
 * Everything inside the arc, nearest first.
 *
 * A cone rather than a sphere, because a sweep that catches something
 * directly behind the player reads as a bug even when the numbers say the
 * distance was fine.
 *
 * @param {{x,z,yaw}} from     where the swing came from
 * @param {Array} targets      anything with .x and .z
 * @param {{reach,arc}} swing  from swingOf()
 */
export function targetsInArc(from, targets, swing) {
  const out = [];
  for (const t of targets) {
    if (t.down || t.fleeing) continue;
    const dx = t.x - from.x, dz = t.z - from.z;
    const d = Math.hypot(dx, dz);
    if (d > swing.reach + (t.radius || 0.4)) continue;
    let a = Math.atan2(dx, dz) - from.yaw;
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    if (Math.abs(a) > swing.arc * 0.5) continue;
    out.push({ target: t, dist: d, angle: a });
  }
  return out.sort((a, b) => a.dist - b.dist);
}
