/* AnimalArt.js — the frog, the fox and the bear.
   ===========================================================================
   Three characters, three separate pieces of modelling code. They share a
   RIG CONTRACT (so one animator can find a head or a hand) and nothing else:
   no shared body, no shared proportions, no shared silhouette. If you turned
   all three black and stood them in a row you would still know which was
   which, which is the bar the brief set and the bar this file is written to.

   HOW THEY DIFFER, deliberately and structurally:

     FROG   squat and wide, no neck at all, eyes ON TOP of the skull, huge
            folded hind legs, tiny arms. Widest thing in the game relative to
            its height. It HOPS — it has no walk cycle.
     FOX    the longest and lightest. Narrow chest, long pointed muzzle, tall
            triangular ears, and a tail nearly as long as the body which is
            a third of its visual mass. Digitigrade, so its knees read
            backwards and it stands on its toes.
     BEAR   twice the frog's height and three times its mass. Barrel chest,
            shoulders higher than its head, tiny round ears, short blunt
            muzzle, plantigrade feet the size of dinner plates.

   THE RIG. Every part is a THREE.Group with its geometry as a child, so the
   animator only ever writes rotations and the meshes never need rebuilding.
   Joints are placed where the joint IS, not where the mesh starts — an elbow
   rotated about the shoulder's origin is the classic reason a procedural
   character's arm stretches when it bends.
*/

import * as THREE from '../../lib/three.module.js?v=20260920180429';
import { MeshBuilder, tube, blob, lathe, blade, box, quad, wedge } from './Geo.js?v=20260920180429';
import { FUR, BUILD, mixHex, tweak, shade } from './Palette.js?v=20260920180429';
import { MATS } from './Materials.js?v=20260920180429';
import { makeRng, clamp, lerp, TAU } from '../core/Util.js?v=20260920180429';

/* ========================================================================= */
/* RIG HELPERS                                                               */
/* ========================================================================= */

/** A joint: an empty Group at a point, parented to another. */
function joint(parent, x, y, z, name) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.name = name;
  parent.add(g);
  return g;
}

/** Attach built geometry to a joint. */
function attach(jointNode, builder, mat = null) {
  if (builder.isEmpty) return null;
  const geo = builder.build({ flat: false });
  const mesh = new THREE.Mesh(geo, mat || MATS.character);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  jointNode.add(mesh);
  return mesh;
}

/** A tapered limb segment from the joint origin down to (dx,dy,dz). */
function limb(b, len, r0, r1, hex, { squashZ = 1, segs = 4 } = {}) {
  const pts = [];
  for (let i = 0; i <= segs; i++) pts.push([0, -len * (i / segs), 0]);
  b.color(hex);
  tube(b, {
    pts, radius: t => lerp(r0, r1, t), radial: 7,
    squash: () => [1, squashZ], capStart: true, capEnd: true, sway: () => 0,
  });
}

/** Two eyes, mirrored. `pop` is how far they bulge out of the head. */
function eyes(b, { x, y, z, r, white, iris, pupil, pop = 0.6, squash = 1 }) {
  for (const s of [-1, 1]) {
    b.color(white);
    blob(b, s * x, y, z, r, 5, 8, (px, py, pz) => [1, squash, 1 + pop * Math.max(0, pz)]);
    b.color(iris);
    blob(b, s * x, y, z + r * 0.62 * (1 + pop * 0.4), r * 0.62, 4, 7, (px, py, pz) => [1, squash, 0.45]);
    b.color(pupil);
    blob(b, s * x, y, z + r * 0.80 * (1 + pop * 0.4), r * 0.33, 3, 6, (px, py, pz) => [1, 1.2, 0.4]);
    // the highlight that makes an eye look alive rather than like a bead
    b.color(0xffffff);
    blob(b, s * x - r * 0.22, y + r * 0.26, z + r * 0.86 * (1 + pop * 0.4), r * 0.15, 3, 5);
  }
}

/* ========================================================================= */
/* THE FROG                                                                  */
/* ========================================================================= */

/**
 * Squat, wide, cheerful. Half as tall as the bear and nearly as broad.
 * Everything about the shape says "this thing is about to jump".
 */
export function buildFrog({ seed = 1, palette = null } = {}) {
  const r = makeRng(seed ^ 0xf206);
  const P = palette || {
    body: FUR.frogBody, back: FUR.frogBack, belly: FUR.frogBelly,
    spot: FUR.frogSpot, eye: FUR.frogEye, throat: FUR.frogThroat,
  };
  const S = 1.0;
  const root = new THREE.Group();

  /* --- the body, which is also the chest, the neck and most of the head -- */
  const hip = joint(root, 0, 0.30 * S, 0, 'hip');
  const torso = joint(hip, 0, 0.02 * S, 0, 'torso');
  {
    const b = new MeshBuilder();
    // a wide, low, forward-leaning dome. Note the Z squash is > 1 in X:
    // this animal is broader than it is deep, which nothing else in the
    // game is, and it is most of why it reads as a frog from behind.
    b.color(P.body);
    blob(b, 0, 0.08 * S, 0, 0.30 * S, 7, 11, (x, y, z) => {
      const bellyOut = y < -0.1 ? 1.12 : 1.0;
      return [1.30 * bellyOut, 0.86 + Math.max(0, y) * 0.25, 1.02 * bellyOut];
    }, 0, (x, y, z) => {
      // dark green over the back, pale under the belly, with a hard-ish line
      // between them the way a real frog is countershaded
      const t = clamp(y * 1.25 + 0.15, -1, 1);
      let c = t > 0.05 ? mixHex(P.body, P.back, clamp(t * 1.4, 0, 1))
        : mixHex(P.body, P.belly, clamp(-t * 1.5, 0, 1));
      // blotches, only on the back
      if (t > 0.1) {
        const m = Math.sin(x * 9 + 1.3) * Math.sin(z * 7.5) * Math.sin(y * 6);
        if (m > 0.32) c = mixHex(c, P.spot, 0.85);
      }
      return c;
    });
    attach(torso, b);
  }

  /* --- the head: a wide wedge with a mouth line that goes ear to ear ---- */
  const head = joint(torso, 0, 0.20 * S, 0.06 * S, 'head');
  {
    const b = new MeshBuilder();
    b.color(P.body);
    blob(b, 0, 0, 0.10 * S, 0.235 * S, 7, 11, (x, y, z) => {
      // flat on top, broad, and it juts forward into a blunt snout
      const snout = Math.max(0, z) * 0.55;
      return [1.22 + snout * 0.1, 0.70 - Math.max(0, y) * 0.12, 1.05 + snout];
    }, 0, (x, y, z) => {
      const t = clamp(y * 1.3 + 0.1, -1, 1);
      return t > 0 ? mixHex(P.body, P.back, t * 1.2) : mixHex(P.body, P.belly, -t * 1.1);
    });
    // THE MOUTH: a wide dark crease running right round the front. A frog is
    // a mouth with a body attached and the line has to be enormous.
    b.color(0x2a3d22);
    const segs = 13;
    let prev = null;
    for (let i = 0; i <= segs; i++) {
      const u = (i / segs) * 2 - 1;
      const ang = u * 1.85;
      const x = Math.sin(ang) * 0.30 * S;
      const z = (Math.cos(ang) * 0.28 + 0.06) * S;
      const y = (-0.045 - Math.pow(Math.abs(u), 2.3) * 0.045) * S;
      const row = [
        b.vert(x, y + 0.016 * S, z, 0),
        b.vert(x, y - 0.016 * S, z, 0),
      ];
      if (prev) b.quad(prev[0], row[0], row[1], prev[1]);
      prev = row;
    }
    // nostrils
    b.color(0x27381f);
    for (const s of [-1, 1]) blob(b, s * 0.055 * S, 0.045 * S, 0.30 * S, 0.016 * S, 3, 5);
    attach(head, b);
  }

  /* --- the eyes: on TOP, and enormous ---------------------------------- */
  const eyeL = joint(head, -0.155 * S, 0.150 * S, 0.075 * S, 'eyeL');
  const eyeR = joint(head, 0.155 * S, 0.150 * S, 0.075 * S, 'eyeR');
  for (const [jn, side] of [[eyeL, -1], [eyeR, 1]]) {
    const b = new MeshBuilder();
    // the eye mound: the skull bulges up around the eye
    b.color(mixHex(P.body, P.back, 0.4));
    blob(b, 0, -0.030 * S, 0, 0.112 * S, 5, 8, (x, y, z) => [1.05, 1.0, 1.05]);
    b.color(0xf6f0dc);
    blob(b, 0, 0.018 * S, 0.014 * S, 0.086 * S, 6, 9);
    b.color(P.eye);
    blob(b, 0, 0.026 * S, 0.042 * S, 0.070 * S, 5, 8, (x, y, z) => [1, 1, 0.75]);
    b.color(0x141410);
    // a frog's pupil is a horizontal slot, not a dot
    blob(b, 0, 0.028 * S, 0.075 * S, 0.044 * S, 4, 7, (x, y, z) => [1.25, 0.40, 0.45]);
    b.color(0xffffff);
    blob(b, -side * 0.024 * S, 0.056 * S, 0.086 * S, 0.018 * S, 3, 5);
    attach(jn, b);
  }

  /* --- the throat pouch, which is the whole idle animation -------------- */
  const throat = joint(head, 0, -0.075 * S, 0.11 * S, 'throat');
  {
    const b = new MeshBuilder();
    b.color(P.throat);
    blob(b, 0, 0, 0, 0.115 * S, 5, 9, (x, y, z) => [1.15, 0.72, 1.0]);
    attach(throat, b);
  }

  /* --- arms: short, thin, and the hands are all fingers ----------------- */
  const arms = [];
  for (const side of [-1, 1]) {
    const sh = joint(torso, side * 0.245 * S, 0.06 * S, 0.02 * S, 'shoulder');
    const b1 = new MeshBuilder();
    limb(b1, 0.16 * S, 0.042 * S, 0.033 * S, P.body);
    attach(sh, b1);
    const el = joint(sh, 0, -0.16 * S, 0, 'elbow');
    const b2 = new MeshBuilder();
    limb(b2, 0.14 * S, 0.033 * S, 0.026 * S, mixHex(P.body, P.belly, 0.2));
    attach(el, b2);
    const hand = joint(el, 0, -0.14 * S, 0, 'hand');
    const b3 = new MeshBuilder();
    b3.color(P.belly);
    blob(b3, 0, -0.012 * S, 0.01 * S, 0.033 * S, 4, 6, (x, y, z) => [1, 0.8, 1.1]);
    // four long fingers with round pads on the ends
    for (let f = 0; f < 4; f++) {
      const a = (f - 1.5) * 0.36;
      const len = 0.062 * S * (f === 1 || f === 2 ? 1.15 : 0.9);
      b3.color(P.belly);
      tube(b3, {
        pts: [[0, -0.02 * S, 0.01 * S],
        [Math.sin(a) * len * 0.5, -0.035 * S, 0.01 * S + Math.cos(a) * len * 0.5],
        [Math.sin(a) * len, -0.042 * S, 0.01 * S + Math.cos(a) * len]],
        radius: t => 0.011 * S * (1 - t * 0.2), radial: 4, capStart: false, capEnd: false, sway: () => 0,
      });
      b3.color(mixHex(P.belly, 0xffffff, 0.3));
      blob(b3, Math.sin(a) * len, -0.044 * S, 0.01 * S + Math.cos(a) * len, 0.016 * S, 3, 5);
    }
    attach(hand, b3);
    arms.push({ shoulder: sh, elbow: el, hand, side });
  }

  /* --- legs: folded, powerful, and the reason it is a frog --------------- */
  const legs = [];
  for (const side of [-1, 1]) {
    const hipJ = joint(hip, side * 0.16 * S, -0.02 * S, -0.04 * S, 'hip');
    const b1 = new MeshBuilder();
    // the thigh is a big muscular mass, not a tube
    b1.color(mixHex(P.body, P.back, 0.25));
    blob(b1, 0, -0.10 * S, -0.02 * S, 0.105 * S, 5, 8, (x, y, z) => [0.92, 1.45, 1.05]);
    attach(hipJ, b1);
    const knee = joint(hipJ, 0, -0.20 * S, 0, 'knee');
    const b2 = new MeshBuilder();
    limb(b2, 0.20 * S, 0.062 * S, 0.035 * S, mixHex(P.body, P.belly, 0.15));
    attach(knee, b2);
    const ankle = joint(knee, 0, -0.20 * S, 0, 'ankle');
    const b3 = new MeshBuilder();
    // a big webbed foot: four long toes with webbing stretched between them
    b3.color(P.belly);
    const toeN = 4;
    const tips = [];
    for (let f = 0; f < toeN; f++) {
      const a = (f - (toeN - 1) / 2) * 0.33;
      const len = 0.15 * S * (f === 1 || f === 2 ? 1.1 : 0.85);
      const tip = [Math.sin(a) * len, 0.006 * S, Math.cos(a) * len];
      tips.push(tip);
      tube(b3, {
        pts: [[0, 0.018 * S, 0], [tip[0] * 0.55, 0.012 * S, tip[2] * 0.55], tip],
        radius: t => 0.020 * S * (1 - t * 0.35), radial: 4, capStart: true, capEnd: true, sway: () => 0,
      });
    }
    b3.color(mixHex(P.belly, P.body, 0.35));
    for (let f = 0; f < toeN - 1; f++) {
      quad(b3, [0, 0.014 * S, 0.01 * S],
        [tips[f][0] * 0.95, 0.010 * S, tips[f][2] * 0.95],
        [tips[f + 1][0] * 0.95, 0.010 * S, tips[f + 1][2] * 0.95],
        [0, 0.014 * S, 0.01 * S]);
      quad(b3, [0, 0.014 * S, 0.01 * S],
        [tips[f + 1][0] * 0.95, 0.010 * S, tips[f + 1][2] * 0.95],
        [tips[f][0] * 0.95, 0.010 * S, tips[f][2] * 0.95],
        [0, 0.014 * S, 0.01 * S]);
    }
    b3.color(P.belly);
    blob(b3, 0, 0.018 * S, -0.02 * S, 0.048 * S, 4, 6, (x, y, z) => [1.1, 0.55, 1.2]);
    attach(ankle, b3);
    legs.push({ hip: hipJ, knee, ankle, side });
  }

  /* --- where a weapon goes --------------------------------------------- */
  const grip = joint(arms[1].hand, 0.01 * S, -0.03 * S, 0.03 * S, 'grip');

  return {
    root,
    species: 'frog',
    parts: { hip, torso, head, eyeL, eyeR, throat, arms, legs, grip, tail: [] },
    metrics: {
      height: 0.80, radius: 0.36, eyeHeight: 0.62, hipHeight: 0.30,
      scale: 1, legLen: 0.40, armLen: 0.30,
    },
  };
}

/* ========================================================================= */
/* THE FOX                                                                   */
/* ========================================================================= */

/**
 * Long, light and quick. The tail is a third of the visual mass and the
 * whole animal is built around it: it hangs low, it sweeps when she turns,
 * and it is the first thing you see coming round a tree.
 */
export function buildFox({ seed = 1, palette = null } = {}) {
  const r = makeRng(seed ^ 0xf085);
  const P = palette || {
    body: FUR.foxBody, belly: FUR.foxBelly, tip: FUR.foxTip,
    sock: FUR.foxSock, ear: FUR.foxEar, eye: FUR.foxEye,
  };
  const S = 1.0;
  const root = new THREE.Group();

  const hip = joint(root, 0, 0.52 * S, 0, 'hip');

  /* --- torso: narrow, deep, and it tapers hard to the waist ------------- */
  const torso = joint(hip, 0, 0.0, 0, 'torso');
  {
    const b = new MeshBuilder();
    blob(b, 0, 0.11 * S, 0.01 * S, 0.19 * S, 8, 11, (x, y, z) => {
      // deep chest at the top, narrow waist at the bottom: the opposite of
      // the frog, and the reason the silhouette reads as agile
      const chest = clamp(y * 1.4 + 0.45, 0, 1);
      const w = lerp(0.74, 1.02, chest);
      return [w, 1.55, w * 1.22];
    }, 0, (x, y, z) => {
      // a white bib up the front, fading into the red at the flanks
      const front = clamp(z * 1.5 - Math.abs(x) * 1.6 - y * 0.5 + 0.2, 0, 1);
      const under = clamp(-y * 1.3 - 0.1, 0, 1);
      let c = mixHex(P.body, P.belly, Math.max(front * 0.85, under * 0.7));
      // darker along the spine
      if (y > 0.3) c = mixHex(c, shade(P.body, -0.28), (y - 0.3) * 1.1);
      return c;
    });
    attach(torso, b);
  }

  /* --- a real neck, which the frog does not have ------------------------ */
  const neck = joint(torso, 0, 0.26 * S, 0.055 * S, 'neck');
  {
    const b = new MeshBuilder();
    b.color(mixHex(P.body, P.belly, 0.25));
    limb(b, -0.10 * S, 0.075 * S, 0.068 * S, mixHex(P.body, P.belly, 0.2));
    attach(neck, b);
  }

  /* --- the head: all muzzle -------------------------------------------- */
  const head = joint(neck, 0, 0.11 * S, 0.02 * S, 'head');
  {
    const b = new MeshBuilder();
    b.color(P.body);
    blob(b, 0, 0, 0, 0.098 * S, 7, 10, (x, y, z) => [1.0, 0.95, 1.05], 0,
      (x, y, z) => (y < -0.3 ? mixHex(P.body, P.belly, clamp(-y * 1.2 - 0.2, 0, 1)) : P.body));
    // THE MUZZLE: long, tapering, and it is the whole identity of the species
    b.color(P.body);
    tube(b, {
      pts: [[0, -0.005 * S, 0.06 * S], [0, -0.022 * S, 0.135 * S], [0, -0.034 * S, 0.205 * S]],
      radius: t => lerp(0.072, 0.026, t) * S, radial: 8,
      squash: t => [1, lerp(0.92, 0.80, t)],
      color: (t, i, ang) => {
        // white under the jaw, red over the bridge, dark at the tip
        const under = Math.cos(ang - Math.PI * 0.5);
        let c = under > 0.15 ? mixHex(P.body, P.belly, clamp(under * 1.3, 0, 1)) : P.body;
        if (t > 0.75) c = mixHex(c, 0x2a221e, (t - 0.75) * 3.2);
        return c;
      },
      capStart: false, capEnd: true, sway: () => 0,
    });
    b.color(0x1a1512);
    blob(b, 0, -0.030 * S, 0.222 * S, 0.026 * S, 4, 7, (x, y, z) => [1.25, 0.85, 0.8]);
    // the dark mask around the eyes
    b.color(mixHex(P.body, 0x3a2418, 0.55));
    for (const s of [-1, 1]) {
      blob(b, s * 0.055 * S, 0.018 * S, 0.072 * S, 0.042 * S, 4, 6, (x, y, z) => [1.1, 0.8, 0.5]);
    }
    attach(head, b);
    const eb = new MeshBuilder();
    eyes(eb, {
      x: 0.052 * S, y: 0.022 * S, z: 0.078 * S, r: 0.030 * S,
      white: 0xf2ead6, iris: P.eye, pupil: 0x140f0a, pop: 0.5, squash: 0.88,
    });
    attach(head, eb);
  }

  /* --- ears: tall, triangular, and they move constantly ----------------- */
  const earL = joint(head, -0.058 * S, 0.082 * S, -0.012 * S, 'earL');
  const earR = joint(head, 0.058 * S, 0.082 * S, -0.012 * S, 'earR');
  for (const [jn, side] of [[earL, -1], [earR, 1]]) {
    const b = new MeshBuilder();
    const H = 0.135 * S, W = 0.062 * S;
    b.color(P.body);
    // outer shell
    const tip = [side * 0.018 * S, H, -0.012 * S];
    wedge(b, [-W / 2, 0, 0], [W / 2, 0, 0], tip, 0.0135 * S);
    // the pale inner cup
    b.color(mixHex(P.belly, 0xd8b8a0, 0.4));
    wedge(b, [-W * 0.34, 0.012 * S, 0.016 * S], [W * 0.34, 0.012 * S, 0.016 * S],
      [side * 0.014 * S, H * 0.88, 0.010 * S], 0.004 * S);
    // the black tip every fox has
    b.color(0x2a211c);
    blob(b, side * 0.016 * S, H * 0.92, -0.010 * S, 0.016 * S, 3, 5, (x, y, z) => [1, 1.4, 0.6]);
    attach(jn, b);
  }

  /* --- the tail: five segments, and it is huge -------------------------- */
  const tail = [];
  {
    let parent = joint(hip, 0, 0.04 * S, -0.16 * S, 'tailBase');
    tail.push(parent);
    const segs = 5;
    for (let i = 0; i < segs; i++) {
      const t = i / segs;
      const b = new MeshBuilder();
      const len = 0.115 * S;
      const rad = lerp(0.085, 0.052, t) * S * (1 + Math.sin(t * Math.PI) * 0.35);
      const hex = t > 0.62 ? mixHex(P.body, P.tip, (t - 0.62) * 2.9) : P.body;
      b.color(hex);
      tube(b, {
        pts: [[0, 0, 0], [0, 0, -len * 0.5], [0, 0, -len]],
        radius: u => lerp(rad, rad * 0.92, u), radial: 8,
        color: (u, ii, ang) => {
          const under = Math.cos(ang - Math.PI * 0.5);
          return under > 0.3 ? mixHex(hex, P.belly, clamp((under - 0.3) * 1.1, 0, 0.55)) : hex;
        },
        capStart: false, capEnd: i === segs - 1, sway: () => 0,
      });
      attach(parent, b);
      const next = joint(parent, 0, 0, -len, `tail${i}`);
      tail.push(next);
      parent = next;
    }
  }

  /* --- arms: slim, with small dark paws --------------------------------- */
  const arms = [];
  for (const side of [-1, 1]) {
    const sh = joint(torso, side * 0.125 * S, 0.19 * S, 0.02 * S, 'shoulder');
    const b1 = new MeshBuilder();
    limb(b1, 0.175 * S, 0.048 * S, 0.034 * S, P.body);
    attach(sh, b1);
    const el = joint(sh, 0, -0.175 * S, 0, 'elbow');
    const b2 = new MeshBuilder();
    limb(b2, 0.155 * S, 0.034 * S, 0.026 * S, mixHex(P.body, P.sock, 0.45));
    attach(el, b2);
    const hand = joint(el, 0, -0.155 * S, 0, 'hand');
    const b3 = new MeshBuilder();
    b3.color(P.sock);
    blob(b3, 0, -0.022 * S, 0.012 * S, 0.036 * S, 4, 7, (x, y, z) => [0.9, 0.95, 1.25]);
    for (let f = 0; f < 4; f++) {
      const a = (f - 1.5) * 0.30;
      b3.color(P.sock);
      blob(b3, Math.sin(a) * 0.024 * S, -0.042 * S, 0.028 * S + Math.cos(a) * 0.014 * S,
        0.012 * S, 3, 5, (x, y, z) => [1, 0.9, 1.5]);
    }
    attach(hand, b3);
    arms.push({ shoulder: sh, elbow: el, hand, side });
  }

  /* --- legs: digitigrade, so the hock reads as a backwards knee ---------- */
  const legs = [];
  for (const side of [-1, 1]) {
    const hipJ = joint(hip, side * 0.095 * S, -0.02 * S, -0.02 * S, 'legHip');
    const b1 = new MeshBuilder();
    b1.color(P.body);
    blob(b1, 0, -0.095 * S, -0.005 * S, 0.075 * S, 5, 8, (x, y, z) => [0.95, 1.55, 1.12]);
    attach(hipJ, b1);
    const knee = joint(hipJ, 0, -0.185 * S, 0, 'knee');
    const b2 = new MeshBuilder();
    limb(b2, 0.165 * S, 0.048 * S, 0.028 * S, mixHex(P.body, P.sock, 0.35));
    attach(knee, b2);
    const hock = joint(knee, 0, -0.165 * S, 0, 'hock');
    const b3 = new MeshBuilder();
    limb(b3, 0.10 * S, 0.028 * S, 0.026 * S, P.sock);
    attach(hock, b3);
    const foot = joint(hock, 0, -0.10 * S, 0, 'foot');
    const b4 = new MeshBuilder();
    b4.color(P.sock);
    blob(b4, 0, 0.018 * S, 0.028 * S, 0.042 * S, 4, 7, (x, y, z) => [0.85, 0.55, 1.55]);
    for (let f = 0; f < 4; f++) {
      const a = (f - 1.5) * 0.26;
      blob(b4, Math.sin(a) * 0.026 * S, 0.014 * S, 0.062 * S, 0.013 * S, 3, 5, (x, y, z) => [1, 0.8, 1.4]);
    }
    attach(foot, b4);
    legs.push({ hip: hipJ, knee, hock, ankle: foot, side });
  }

  const grip = joint(arms[1].hand, 0.008 * S, -0.03 * S, 0.035 * S, 'grip');

  return {
    root,
    species: 'fox',
    parts: { hip, torso, neck, head, earL, earR, arms, legs, tail, grip },
    metrics: {
      height: 1.08, radius: 0.26, eyeHeight: 0.92, hipHeight: 0.52,
      scale: 1, legLen: 0.45, armLen: 0.33,
    },
  };
}

/* ========================================================================= */
/* THE BEAR                                                                  */
/* ========================================================================= */

/**
 * Twice the frog's height and three times its mass. The shoulders are the
 * highest point of the animal, higher than the head, which is the single
 * cue that separates a bear from a large person in a coat.
 */
export function buildBear({ seed = 1, palette = null } = {}) {
  const r = makeRng(seed ^ 0xbe42);
  const P = palette || {
    body: FUR.bearBody, belly: FUR.bearBelly, muzzle: FUR.bearMuzzle,
    paw: FUR.bearPaw, eye: FUR.bearEye,
  };
  const S = 1.0;
  const root = new THREE.Group();

  const hip = joint(root, 0, 0.66 * S, 0, 'hip');

  /* --- a barrel of a torso with a pronounced shoulder hump -------------- */
  const torso = joint(hip, 0, 0, 0, 'torso');
  {
    const b = new MeshBuilder();
    blob(b, 0, 0.15 * S, 0, 0.30 * S, 8, 12, (x, y, z) => {
      const hump = Math.max(0, y - 0.25) * 1.1;       // the shoulder mass
      const gut = Math.max(0, -y - 0.15) * 0.5;
      return [1.26 + hump * 0.38 + gut * 0.32, 1.34, 1.04 + hump * 0.25 + gut * 0.35];
    }, 0, (x, y, z) => {
      const front = clamp(z * 1.4 - Math.abs(x) * 1.2 - 0.05, 0, 1);
      let c = mixHex(P.body, P.belly, front * 0.55 + clamp(-y - 0.2, 0, 1) * 0.35);
      if (y > 0.4) c = mixHex(c, shade(P.body, -0.22), (y - 0.4) * 1.3);
      // a pale crescent on the chest, the way many real bears are marked
      const cres = clamp(1 - Math.hypot(x * 1.2, (y - 0.12) * 1.8) * 3.2, 0, 1) * clamp(z * 2, 0, 1);
      c = mixHex(c, mixHex(P.belly, 0xe0cfae, 0.5), cres * 0.75);
      return c;
    });
    attach(torso, b);
  }

  /* --- a short thick neck sunk between the shoulders --------------------- */
  const neck = joint(torso, 0, 0.42 * S, 0.055 * S, 'neck');
  {
    const b = new MeshBuilder();
    b.color(shade(P.body, -0.12));
    blob(b, 0, 0.02 * S, 0, 0.125 * S, 5, 8, (x, y, z) => [1.0, 0.9, 1.05]);
    attach(neck, b);
  }

  /* --- the head: broad, short-muzzled, small-eyed ----------------------- */
  const head = joint(neck, 0, 0.115 * S, 0.025 * S, 'head');
  {
    const b = new MeshBuilder();
    b.color(P.body);
    blob(b, 0, 0, 0, 0.145 * S, 7, 11, (x, y, z) => [1.06, 0.94, 1.0], 0,
      (x, y, z) => (y < -0.35 ? mixHex(P.body, P.muzzle, clamp(-y * 1.1 - 0.3, 0, 1)) : P.body));
    // a short blunt muzzle — barely a third of the fox's
    b.color(P.muzzle);
    tube(b, {
      pts: [[0, -0.028 * S, 0.085 * S], [0, -0.040 * S, 0.135 * S]],
      radius: t => lerp(0.082, 0.062, t) * S, radial: 8,
      squash: () => [1.05, 0.88],
      color: (t, i, ang) => mixHex(P.muzzle, P.body, clamp(Math.cos(ang - Math.PI * 0.5) * -0.6, 0, 0.45)),
      capStart: false, capEnd: true, sway: () => 0,
    });
    b.color(0x1a1310);
    blob(b, 0, -0.030 * S, 0.152 * S, 0.038 * S, 4, 7, (x, y, z) => [1.3, 0.75, 0.7]);
    // the mouth line
    b.color(0x241a14);
    for (const s of [-1, 1]) {
      blob(b, s * 0.030 * S, -0.070 * S, 0.118 * S, 0.020 * S, 3, 5, (x, y, z) => [1.4, 0.35, 1.0]);
    }
    attach(head, b);
    const eb = new MeshBuilder();
    eyes(eb, {
      x: 0.058 * S, y: 0.030 * S, z: 0.112 * S, r: 0.026 * S,
      white: 0xe8dcc4, iris: 0x4a3626, pupil: 0x100c08, pop: 0.35, squash: 0.92,
    });
    attach(head, eb);
  }

  /* --- ears: small, round, and set wide on the sides of the skull -------- */
  const earL = joint(head, -0.115 * S, 0.095 * S, -0.02 * S, 'earL');
  const earR = joint(head, 0.115 * S, 0.095 * S, -0.02 * S, 'earR');
  for (const [jn, side] of [[earL, -1], [earR, 1]]) {
    const b = new MeshBuilder();
    b.color(shade(P.body, -0.1));
    blob(b, 0, 0.01 * S, 0, 0.052 * S, 4, 8, (x, y, z) => [1, 1.05, 0.42]);
    b.color(mixHex(P.muzzle, 0xc09a80, 0.4));
    blob(b, 0, 0.012 * S, 0.016 * S, 0.034 * S, 4, 7, (x, y, z) => [1, 1, 0.3]);
    attach(jn, b);
  }

  /* --- arms: thick, long, with paws the size of the frog's head ---------- */
  const arms = [];
  for (const side of [-1, 1]) {
    const sh = joint(torso, side * 0.325 * S, 0.34 * S, 0.02 * S, 'shoulder');
    const b1 = new MeshBuilder();
    limb(b1, 0.26 * S, 0.105 * S, 0.085 * S, P.body, { squashZ: 0.94 });
    attach(sh, b1);
    const el = joint(sh, 0, -0.26 * S, 0, 'elbow');
    const b2 = new MeshBuilder();
    limb(b2, 0.24 * S, 0.085 * S, 0.068 * S, mixHex(P.body, P.paw, 0.3), { squashZ: 0.94 });
    attach(el, b2);
    const hand = joint(el, 0, -0.24 * S, 0, 'hand');
    const b3 = new MeshBuilder();
    b3.color(P.paw);
    blob(b3, 0, -0.045 * S, 0.012 * S, 0.082 * S, 5, 8, (x, y, z) => [0.95, 0.85, 1.15]);
    // claws
    b3.color(0xd8cdb8);
    for (let f = 0; f < 4; f++) {
      const a = (f - 1.5) * 0.28;
      blob(b3, Math.sin(a) * 0.05 * S, -0.082 * S, 0.062 * S + Math.cos(a) * 0.012 * S,
        0.014 * S, 3, 5, (x, y, z) => [1, 1.6, 0.9]);
    }
    attach(hand, b3);
    arms.push({ shoulder: sh, elbow: el, hand, side });
  }

  /* --- legs: plantigrade, short and enormously thick --------------------- */
  const legs = [];
  for (const side of [-1, 1]) {
    const hipJ = joint(hip, side * 0.165 * S, -0.03 * S, -0.01 * S, 'legHip');
    const b1 = new MeshBuilder();
    b1.color(P.body);
    blob(b1, 0, -0.15 * S, 0, 0.135 * S, 5, 8, (x, y, z) => [1.0, 1.35, 1.1]);
    attach(hipJ, b1);
    const knee = joint(hipJ, 0, -0.30 * S, 0, 'knee');
    const b2 = new MeshBuilder();
    limb(b2, 0.28 * S, 0.095 * S, 0.075 * S, mixHex(P.body, P.paw, 0.25), { squashZ: 0.95 });
    attach(knee, b2);
    const ankle = joint(knee, 0, -0.28 * S, 0, 'ankle');
    const b3 = new MeshBuilder();
    b3.color(P.paw);
    blob(b3, 0, 0.038 * S, 0.048 * S, 0.095 * S, 4, 8, (x, y, z) => [0.92, 0.42, 1.45]);
    b3.color(mixHex(P.paw, P.muzzle, 0.5));
    blob(b3, 0, 0.012 * S, 0.055 * S, 0.055 * S, 3, 6, (x, y, z) => [0.9, 0.22, 1.2]);
    b3.color(0xd8cdb8);
    for (let f = 0; f < 4; f++) {
      const a = (f - 1.5) * 0.26;
      blob(b3, Math.sin(a) * 0.050 * S, 0.020 * S, 0.135 * S, 0.014 * S, 3, 5, (x, y, z) => [1, 0.9, 1.4]);
    }
    attach(ankle, b3);
    legs.push({ hip: hipJ, knee, ankle, side });
  }

  /* --- a stubby tail nobody notices until it wags ------------------------ */
  const tail = [];
  {
    const t0 = joint(hip, 0, 0.02 * S, -0.22 * S, 'tailBase');
    const b = new MeshBuilder();
    b.color(shade(P.body, -0.08));
    blob(b, 0, 0, -0.03 * S, 0.055 * S, 4, 6, (x, y, z) => [1, 0.95, 1.2]);
    attach(t0, b);
    tail.push(t0);
  }

  const grip = joint(arms[1].hand, 0.012 * S, -0.06 * S, 0.05 * S, 'grip');

  return {
    root,
    species: 'bear',
    parts: { hip, torso, neck, head, earL, earR, arms, legs, tail, grip },
    metrics: {
      height: 1.52, radius: 0.50, eyeHeight: 1.32, hipHeight: 0.66,
      scale: 1, legLen: 0.62, armLen: 0.52,
    },
  };
}

/* ========================================================================= */

export const ANIMAL_BUILDERS = { frog: buildFrog, fox: buildFox, bear: buildBear };

export function buildAnimal(species, opts) {
  return (ANIMAL_BUILDERS[species] || buildFox)(opts);
}
