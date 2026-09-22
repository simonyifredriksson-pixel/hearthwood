/* HumanArt.js — the people who do not know the village is here.
   ===========================================================================
   The construction workers are the only humans in Hearthwood and they have
   one job in the art direction: TO BE THE WRONG SCALE. Every animal in this
   game stands about a metre tall. A worker is nearly two. Standing one next
   to a fox is the entire premise of the game in a single silhouette — this
   is not a fight the villagers can win by being braver, and the forest only
   stays secret because nobody has looked properly yet.

   They are NOT villains and must not be drawn as villains. No scowls, no
   weapons, no menace. They are people in hi-vis doing a job they were told
   to do, and when a small animal comes at them out of the undergrowth with a
   stick they are startled, not hurt. Everything here is built to support
   "alarmed" as the strongest expression it can reach.

   Same rig contract as the animals — hip, torso, neck, head, arms, legs,
   grip — so the same animator and the same carry code work on them.
*/

import * as THREE from '../../lib/three.module.js?v=1790100127';
import { MeshBuilder, tube, blob, lathe, box, quad, cylinder } from './Geo.js?v=1790100127';
import { BUILD, CLOTH, METAL, mixHex, tweak, shade } from './Palette.js?v=1790100127';
import { MATS } from './Materials.js?v=1790100127';
import { makeRng, clamp, lerp, TAU } from '../core/Util.js?v=1790100127';

function joint(parent, x, y, z, name) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.name = name;
  parent.add(g);
  return g;
}

function attach(node, b, mat = null) {
  if (b.isEmpty) return null;
  const m = new THREE.Mesh(b.build({ flat: false }), mat || MATS.character);
  m.castShadow = true; m.receiveShadow = true;
  node.add(m);
  return m;
}

function limb(b, len, r0, r1, hex, segs = 3) {
  const pts = [];
  for (let i = 0; i <= segs; i++) pts.push([0, -len * (i / segs), 0]);
  b.color(hex);
  tube(b, { pts, radius: t => lerp(r0, r1, t), radial: 7, capStart: true, capEnd: true, sway: () => 0 });
}

/* Hi-vis is hi-vis: it is the one genuinely saturated colour in Hearthwood,
   and it is deliberately jarring against a palette of moss and bark. */
export const WORKER_KIT = {
  vest: 0xe8d23a, vestBand: 0xf2f2ee,
  hat: 0xe8862a, hatDark: 0xc26a1e,
  shirt: 0x6a8ea8, shirtDark: 0x51718a,
  trouser: 0x6d6a60, trouserDark: 0x585549,
  boot: 0x4a3a2c,
  skin: [0xe8bd9a, 0xd8a074, 0xa8734e, 0x7a5236, 0xf0cdb0],
  hair: [0x3a2a1e, 0x6a4a2e, 0x9a7a4a, 0x2a2420, 0xb08a5a],
};

/**
 * One construction worker.
 *
 * @param {object} o  {seed, kit}
 * @returns the usual rig: {root, parts, metrics}
 */
export function buildWorker({ seed = 1, kit = null } = {}) {
  const r = makeRng(seed ^ 0x77a1);
  const K = kit || WORKER_KIT;
  const skin = r.pick(K.skin);
  const hair = r.pick(K.hair);
  const S = 1.0;
  const H = r.range(0.95, 1.06);        // not everybody is the same height
  const root = new THREE.Group();

  const hip = joint(root, 0, 0.92 * H, 0, 'hip');

  /* --- torso: a boxy hi-vis vest over a work shirt ---------------------- */
  const torso = joint(hip, 0, 0, 0, 'torso');
  {
    const b = new MeshBuilder();
    b.color(K.shirt);
    blob(b, 0, 0.16 * H, 0, 0.20 * H, 7, 10, (x, y, z) => {
      const chest = clamp(y * 0.9 + 0.5, 0, 1);
      return [lerp(0.90, 1.12, chest), 1.28, lerp(0.62, 0.72, chest)];
    }, 0, (x, y, z) => (y < -0.5 ? K.shirtDark : K.shirt));
    // the vest, open at the front
    b.color(K.vest);
    blob(b, 0, 0.15 * H, 0, 0.212 * H, 7, 10, (x, y, z) => {
      const open = clamp(z * 2.6 - Math.abs(x) * 3.4 - 0.72, 0, 1);
      const s = 1 - open * 0.92;
      const top = lerp(1, 0.52, clamp((y - 0.44) / 0.56, 0, 1));
      return [1.09 * s * top, 1.16, 0.72 * s * top];
    });
    // two retro-reflective bands
    b.color(K.vestBand);
    for (const yy of [0.085, 0.195]) {
      blob(b, 0, yy * H, 0, 0.216 * H, 7, 10, (x, y, z) => {
        const open = clamp(z * 2.6 - Math.abs(x) * 3.4 - 0.72, 0, 1);
        const s = 1 - open * 0.92;
        return [1.10 * s, 0.13, 0.73 * s];
      });
    }
    attach(torso, b);
  }

  const neck = joint(torso, 0, 0.375 * H, 0, 'neck');
  {
    const b = new MeshBuilder();
    b.color(skin);
    limb(b, -0.085 * H, 0.054 * H, 0.050 * H, skin, 2);
    attach(neck, b);
  }

  /* --- the head, under a hard hat --------------------------------------- */
  const head = joint(neck, 0, 0.125 * H, 0, 'head');
  {
    const b = new MeshBuilder();
    b.color(skin);
    blob(b, 0, 0, 0, 0.098 * H, 7, 10, (x, y, z) => [0.94, 1.10, 0.96]);
    // jaw
    blob(b, 0, -0.052 * H, 0.016 * H, 0.072 * H, 5, 8, (x, y, z) => [0.94, 0.82, 1.0]);
    // hair at the back and sides, under the hat brim
    b.color(hair);
    blob(b, 0, 0.016 * H, -0.018 * H, 0.100 * H, 6, 9, (x, y, z) => [0.98, 0.92, 0.94]);
    // a plain, slightly surprised face: two dot eyes and a small mouth. Any
    // more detail than this and a human face in a world of animals starts
    // looking like an intruder from another game.
    b.color(0x2a211c);
    for (const s of [-1, 1]) {
      blob(b, s * 0.036 * H, 0.008 * H, 0.088 * H, 0.0135 * H, 3, 5, (x, y, z) => [1, 1.15, 0.6]);
    }
    b.color(mixHex(skin, 0x8a4a40, 0.5));
    blob(b, 0, -0.040 * H, 0.086 * H, 0.020 * H, 3, 5, (x, y, z) => [1.3, 0.55, 0.5]);
    // the nose
    b.color(shade(skin, -0.06));
    blob(b, 0, -0.012 * H, 0.098 * H, 0.018 * H, 3, 5, (x, y, z) => [0.9, 1.1, 1.0]);

    /* THE HARD HAT. The most recognisable object a human can be wearing at
       fifty metres through trees, which is exactly the range at which the
       player needs to know something is wrong. */
    b.color(K.hat);
    blob(b, 0, 0.062 * H, -0.004 * H, 0.112 * H, 7, 10, (x, y, z) => [1.0, 0.78, 1.0]);
    // the brim
    b.color(K.hatDark);
    lathe(b, [
      [0.108 * H, 0.052 * H], [0.138 * H, 0.044 * H], [0.140 * H, 0.032 * H], [0.106 * H, 0.038 * H],
    ], 12, 0, 0);
    // the ridge along the crown
    b.color(K.hatDark);
    blob(b, 0, 0.128 * H, -0.004 * H, 0.030 * H, 4, 6, (x, y, z) => [0.35, 0.7, 1.5]);
    attach(head, b);
  }

  /* --- arms ------------------------------------------------------------- */
  const arms = [];
  for (const side of [-1, 1]) {
    const sh = joint(torso, side * 0.155 * H, 0.275 * H, 0, 'shoulder');
    const b1 = new MeshBuilder();
    limb(b1, 0.175 * H, 0.052 * H, 0.044 * H, K.shirt);
    attach(sh, b1);
    const el = joint(sh, 0, -0.175 * H, 0, 'elbow');
    const b2 = new MeshBuilder();
    limb(b2, 0.165 * H, 0.044 * H, 0.038 * H, skin);
    attach(el, b2);
    const hand = joint(el, 0, -0.165 * H, 0, 'hand');
    const b3 = new MeshBuilder();
    b3.color(r.chance(0.6) ? 0x8a6a4a : skin);     // work gloves, sometimes
    blob(b3, 0, -0.030 * H, 0.008 * H, 0.046 * H, 4, 7, (x, y, z) => [0.85, 1.05, 1.15]);
    attach(hand, b3);
    arms.push({ shoulder: sh, elbow: el, hand, side });
  }

  /* --- legs ------------------------------------------------------------- */
  const legs = [];
  for (const side of [-1, 1]) {
    const hipJ = joint(hip, side * 0.088 * H, -0.02 * H, 0, 'legHip');
    const b1 = new MeshBuilder();
    limb(b1, 0.235 * H, 0.072 * H, 0.058 * H, K.trouser);
    attach(hipJ, b1);
    const knee = joint(hipJ, 0, -0.235 * H, 0, 'knee');
    const b2 = new MeshBuilder();
    limb(b2, 0.225 * H, 0.058 * H, 0.048 * H, K.trouserDark);
    attach(knee, b2);
    const foot = joint(knee, 0, -0.225 * H, 0, 'foot');
    const b3 = new MeshBuilder();
    b3.color(K.boot);
    blob(b3, 0, -0.022 * H, 0.030 * H, 0.062 * H, 4, 7, (x, y, z) => [0.86, 0.60, 1.30]);
    attach(foot, b3);
    // the animator's digitigrade rig expects a hock; humans have none, so it
    // is an empty pass-through and the same pose code still runs
    const hock = foot;
    legs.push({ hip: hipJ, knee, hock, ankle: foot, side });
  }

  const grip = joint(arms[1].hand, 0.004 * H, -0.042 * H, 0.020 * H, 'grip');

  return {
    root, species: 'human',
    parts: { hip, torso, neck, head, earL: null, earR: null, arms, legs, tail: [], grip },
    metrics: {
      height: 1.82 * H, radius: 0.34, eyeHeight: 1.62 * H, hipHeight: 0.92 * H,
      scale: H, legLen: 0.46 * H, armLen: 0.34 * H,
    },
  };
}

/* ========================================================================= */
/* WHAT THEY BROUGHT WITH THEM                                               */
/* ========================================================================= */

/**
 * The tools and markers. These are the things the player actually sees from
 * a distance and reads as "something is wrong in the wood" — more than the
 * workers themselves, because a survey stake with orange tape on it is
 * unmistakably not part of a forest.
 */
export function buildWorkerProp(kind, { seed = 1 } = {}) {
  const b = new MeshBuilder();
  const r = makeRng(seed ^ 0x9e11);

  if (kind === 'axe') {
    b.color(0x6a4e32);
    tube(b, {
      pts: [[0, 0, 0], [0, 0.34, 0.01], [0, 0.66, 0.015]],
      radius: t => lerp(0.020, 0.016, t), radial: 6, capStart: true, capEnd: true, sway: () => 0,
    });
    b.color(METAL.iron);
    blob(b, 0.03, 0.70, 0.015, 0.058, 4, 6, (x, y, z) => [1.5, 0.9, 0.4]);
    b.color(shade(METAL.iron, 0.2));
    blob(b, 0.075, 0.70, 0.015, 0.030, 3, 5, (x, y, z) => [0.7, 1.4, 0.4]);
  } else if (kind === 'saw') {
    b.color(0xd8d4cc);
    box(b, 0, 0.30, 0, 0.055, 0.44, 0.006);
    b.color(0xc4302a);
    box(b, 0, 0.055, 0, 0.055, 0.11, 0.030);
  } else if (kind === 'clipboard') {
    b.color(0x8a6a44);
    box(b, 0, 0, 0, 0.19, 0.26, 0.008);
    b.color(0xf2efe2);
    box(b, 0, 0.012, 0.006, 0.165, 0.215, 0.003);
    b.color(0x4a4a4a);
    box(b, 0, 0.115, 0.010, 0.07, 0.022, 0.008);
  } else if (kind === 'stake') {
    /* A SURVEY STAKE. Orange tape on a peg: the single clearest signal in
       the game that humans have been here and intend to come back. */
    b.color(0xbfa878);
    tube(b, {
      pts: [[0, 0, 0], [0, 0.42, 0], [0, 0.78, 0]],
      radius: () => 0.021, radial: 5, capStart: true, capEnd: true, sway: () => 0,
    });
    b.color(0xe8862a);
    for (let i = 0; i < 3; i++) {
      const y = 0.58 + i * 0.055;
      lathe(b, [[0.026, y - 0.016], [0.028, y + 0.016]], 7, 0, 0);
    }
    // a length of tape trailing off the top, which moves in the wind
    b.color(0xf2a03a);
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      blob(b, 0.03 + t * 0.14, 0.76 - t * 0.10 + Math.sin(t * 4) * 0.02, t * 0.05,
        0.016, 2, 4, (x, y, z) => [1.4, 0.35, 0.6], 0.3 + t * 0.7);
    }
  } else if (kind === 'toolbox') {
    b.color(0xc4302a);
    box(b, 0, 0.09, 0, 0.36, 0.18, 0.18);
    b.color(0x3a3a3a);
    box(b, 0, 0.20, 0, 0.09, 0.05, 0.022);
  } else if (kind === 'cone') {
    b.color(0xe8642a);
    lathe(b, [[0.001, 0.42], [0.06, 0.16], [0.10, 0.02], [0.14, 0.0]], 10, 0, 0);
    b.color(0xf2f2ee);
    lathe(b, [[0.082, 0.20], [0.076, 0.27]], 10, 0, 0);
  }
  return b;
}
