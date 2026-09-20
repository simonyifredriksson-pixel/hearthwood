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

import * as THREE from '../../lib/three.module.js?v=20260920201841';
import { MeshBuilder, tube, blob, lathe, blade, box, quad, wedge } from './Geo.js?v=20260920201841';
import { FUR, BUILD, mixHex, tweak, shade } from './Palette.js?v=20260920201841';
import { MATS } from './Materials.js?v=20260920201841';
import { makeRng, clamp, lerp, TAU } from '../core/Util.js?v=20260920201841';

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

/**
 * THE CUTE EYE, and it is most of the job.
 *
 * A realistic eye is a white ball with a small coloured iris in it, and at
 * this scale that reads as a bead — tiny dark dot in a field of white, which
 * is the single biggest reason the old characters looked uncanny. A cute eye
 * is almost ENTIRELY pupil: a big soft dark dome, a warm rim where the iris
 * catches light round the edge, and two specular highlights at different
 * sizes. The second highlight is what sells it; one highlight reads as
 * plastic, two reads as wet.
 */
function cuteEye(b, { x, y, z, r, iris, side = 1, tilt = 0, lid = 0 }) {
  // the dark of the eye, very slightly oval and leaning with the face
  b.color(0x1b1410);
  blob(b, x, y, z, r, 6, 10, (px, py, pz) => [0.92, 1.0, 0.55]);
  // a warm ring of iris colour, only visible round the lower edge
  b.color(iris);
  blob(b, x, y - r * 0.16, z + r * 0.10, r * 0.78, 5, 8, (px, py, pz) => [0.9, 0.72, 0.42]);
  b.color(0x120d0a);
  blob(b, x, y - r * 0.04, z + r * 0.30, r * 0.62, 5, 8, (px, py, pz) => [0.92, 0.95, 0.38]);
  // the big highlight, up and toward the nose
  b.color(0xffffff);
  blob(b, x - side * r * 0.30, y + r * 0.34, z + r * 0.50, r * 0.27, 4, 6, (px, py, pz) => [1, 0.95, 0.45]);
  // and a small one low and outboard
  blob(b, x + side * r * 0.34, y - r * 0.36, z + r * 0.46, r * 0.13, 3, 5, (px, py, pz) => [1, 0.95, 0.45]);
  // a soft brow shadow so the eye sits IN the face rather than on it
  if (lid > 0) {
    b.color(shade(iris, -0.5));
    blob(b, x, y + r * 0.82, z + r * 0.18, r * 0.72, 4, 7, (px, py, pz) => [1.0, 0.3 * lid, 0.5]);
  }
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

  /* --- the body: a wide round pear, and NOT the head ---------------------
     The old frog was one enormous wedge that was simultaneously body, neck
     and skull, which is anatomically right and characterfully hopeless —
     there was no face to read, only a front end. Separating a distinct round
     head from a smaller round body is the same move that fixed the fox. The
     frog stays broader than it is deep, which is still what tells it apart
     from every other silhouette in the game. */
  const hip = joint(root, 0, 0.245 * S, 0, 'hip');
  const torso = joint(hip, 0, 0.02 * S, 0, 'torso');
  {
    const b = new MeshBuilder();
    b.color(P.body);
    blob(b, 0, 0.055 * S, 0, 0.196 * S, 7, 11, (x, y, z) => {
      const bellyOut = y < -0.1 ? 1.10 : 1.0;
      return [1.24 * bellyOut, 1.00 + Math.max(0, y) * 0.10, 1.00 * bellyOut];
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

    /* A KNITTED WAISTCOAT AND A SCARF.
       The frog's shape is the opposite of the fox's, so it cannot wear the
       same jumper — a garment with sleeves on a body with no shoulders looks
       like a sack. An open waistcoat follows the belly and leaves the frog
       silhouette completely intact, and the scarf does the work the fox's
       ruff does: it puts a band of warm colour up under the chin. */
    /* A BIB COLLAR, on the FRONT only.
       A garment that wraps this body has to be enormous — the frog is nearly
       0.4 m across and 0.3 m deep, so a scarf big enough to go round it is
       bigger than its head, and one sized by eye ends up buried inside the
       belly, which is exactly what the first attempt did. Dressing only the
       surface the camera sees solves it and costs a fifth of the triangles. */
    const FC = P.cloth || { vest: 0xd98f5c, vestDark: 0xb0713f, scarf: 0xd4685e };
    b.color(FC.scarf);
    for (let i = 0; i < 9; i++) {
      const u = (i / 8 - 0.5);
      const a = u * 2.4;
      // follow the front of the chest, sitting just proud of it
      blob(b,
        Math.sin(a) * 0.196 * S,
        (0.238 - Math.abs(u) * 0.040) * S,
        Math.cos(a) * 0.168 * S + 0.010 * S,
        0.040 * S, 3, 6, (x, y, z) => [1.0, 0.8, 1.0]);
    }
    // the knot and its two short ends
    b.color(shade(FC.scarf, -0.12));
    blob(b, 0.026 * S, 0.208 * S, 0.186 * S, 0.034 * S, 4, 6, (x, y, z) => [1, 1, 0.8]);
    for (let i = 0; i < 3; i++) {
      blob(b, (0.036 + i * 0.010) * S, (0.166 - i * 0.034) * S, (0.182 - i * 0.010) * S,
        0.027 * S, 3, 5, (x, y, z) => [0.9, 1.1, 0.6]);
    }
    attach(torso, b);
  }

  /* --- the head: a wide wedge with a mouth line that goes ear to ear ---- */
  const head = joint(torso, 0, 0.286 * S, 0.020 * S, 'head');
  {
    const b = new MeshBuilder();
    b.color(P.body);
    blob(b, 0, 0, 0.030 * S, 0.205 * S, 7, 11, (x, y, z) => {
      // flat on top, broad, and it juts forward into a blunt snout
      const snout = Math.max(0, z) * 0.26;
      return [1.20 + snout * 0.06, 0.74 - Math.max(0, y) * 0.06, 1.00 + snout];
    }, 0, (x, y, z) => {
      const t = clamp(y * 1.3 + 0.1, -1, 1);
      return t > 0 ? mixHex(P.body, P.back, t * 1.2) : mixHex(P.body, P.belly, -t * 1.1);
    });
    /* THE SMILE. The old mouth was a dark crease running the full width of
       the skull — anatomically a frog, and the single most unsettling thing
       on the character, because a mouth that wide on a face reads as a
       grimace however you light it. This is a short curve that turns UP at
       the corners and stops well short of the eyes. */
    b.color(0x4a6b38);
    const segs = 11;
    for (let i = 0; i <= segs; i++) {
      const u = (i / segs) * 2 - 1;
      const ang = u * 0.92;
      const x = Math.sin(ang) * 0.132 * S;
      const z = (Math.cos(ang) * 0.075 + 0.168) * S;
      // the corners lift, the middle sits low: a smile, not a line
      const y = (-0.062 + Math.pow(Math.abs(u), 1.8) * 0.032) * S;
      blob(b, x, y, z, 0.0175 * S, 3, 5, (px, py, pz) => [1, 0.72, 0.72]);
    }
    // a pale chin under the smile, which gives the face a bottom half
    b.color(mixHex(P.belly, P.body, 0.25));
    blob(b, 0, -0.098 * S, 0.126 * S, 0.116 * S, 5, 8, (x, y, z) => [1.28, 0.56, 0.92]);
    // two little cheek blushes
    b.color(mixHex(P.belly, 0xe89a8a, 0.55));
    for (const s of [-1, 1]) {
      blob(b, s * 0.166 * S, -0.034 * S, 0.140 * S, 0.046 * S, 3, 6, (x, y, z) => [1.2, 0.75, 0.35]);
    }
    // nostrils, small
    b.color(shade(P.back, -0.3));
    for (const s of [-1, 1]) blob(b, s * 0.040 * S, -0.014 * S, 0.226 * S, 0.012 * S, 3, 5);

    /* A LITTLE KNITTED CAP, pulled down between the eye domes.
       The one place on a frog with room for a garment is the back of the
       skull, and a hat there does more for "villager" than any amount of
       body clothing would — it also breaks up the long flat top of the head,
       which was the last thing making the silhouette read as an animal. */
    const HC = (P.cloth && P.cloth.hat) || 0xc96f68;
    b.color(HC);
    blob(b, 0, 0.112 * S, -0.055 * S, 0.162 * S, 6, 9, (x, y, z) => [1.12, 0.66, 1.02]);
    b.color(shade(HC, -0.18));
    // the turned-up brim
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      blob(b, Math.sin(a) * 0.168 * S, 0.062 * S, -0.055 * S + Math.cos(a) * 0.150 * S,
        0.034 * S, 3, 5, (x, y, z) => [1, 0.85, 1]);
    }
    // and a bobble
    b.color(mixHex(HC, 0xffffff, 0.45));
    blob(b, 0, 0.196 * S, -0.085 * S, 0.042 * S, 4, 6);
    attach(head, b);
  }

  /* --- the eyes: on TOP, in their own domes, and ROUND ------------------
     Eyes on top of the skull is the frog's structural signature and it
     stays. What changes is the pupil: a horizontal slot is a reptile, and a
     reptile is not cute at any size. */
  const eyeL = joint(head, -0.132 * S, 0.046 * S, 0.092 * S, 'eyeL');
  const eyeR = joint(head, 0.132 * S, 0.046 * S, 0.092 * S, 'eyeR');
  for (const [jn, side] of [[eyeL, -1], [eyeR, 1]]) {
    const b = new MeshBuilder();
    // the mound the eye sits in
    b.color(mixHex(P.body, P.back, 0.35));
    blob(b, 0, -0.040 * S, 0, 0.104 * S, 5, 8, (x, y, z) => [1.06, 0.98, 1.06]);
    // a warm eyelid ridge over the top
    b.color(mixHex(P.body, P.eye, 0.35));
    blob(b, 0, 0.030 * S, -0.006 * S, 0.088 * S, 5, 8, (x, y, z) => [1.02, 0.60, 1.0]);
    cuteEye(b, {
      x: 0, y: 0.004 * S, z: 0.044 * S, r: 0.068 * S,
      iris: P.eye, side, lid: 0,
    });
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
      height: 0.80, radius: 0.30, eyeHeight: 0.62, hipHeight: 0.30,
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
  const C = P.cloth || { shirt: 0xe8c46a, shirtDark: 0xcfa348, trouser: 0x8fbfc9, strap: 0x5a4632 };

  const hip = joint(root, 0, 0.345 * S, 0, 'hip');

  /* --- torso: a small soft pear, and DELIBERATELY not much of the animal --
     The head carries this character. A realistic fox torso is roughly three
     head-lengths; here it is barely one, which is the whole difference
     between "animal standing up" and "someone you want to talk to". */
  const torso = joint(hip, 0, 0.0, 0, 'torso');
  {
    const b = new MeshBuilder();
    blob(b, 0, 0.075 * S, 0.005 * S, 0.155 * S, 8, 11, (x, y, z) => {
      const chest = clamp(y * 1.1 + 0.5, 0, 1);
      const w = lerp(0.92, 1.0, chest);
      return [w, 1.12, w * 0.95];
    }, 0, (x, y, z) => {
      const front = clamp(z * 1.4 - Math.abs(x) * 1.3 - y * 0.4 + 0.25, 0, 1);
      return mixHex(P.body, P.belly, front * 0.9);
    });
    /* the knitted jumper — cozy clothing is half of why the reference reads
       as a character rather than as wildlife */
    b.color(C.shirt);
    /* A jumper is the body shape plus a few millimetres, narrowing to a
       collar. Squashing the TOP of the blob flat — which is what the first
       attempt did — does not make a garment, it makes a bucket with the
       character sitting in it. */
    blob(b, 0, 0.078 * S, 0.005 * S, 0.170 * S, 8, 11, (x, y, z) => {
      // it only starts closing in near the very top, so the jumper covers
      // the chest instead of sitting round the waist like a tube
      const s = lerp(1.0, 0.44, clamp((y - 0.52) / 0.48, 0, 1));
      return [s * 1.02, 1.12, s * 0.97];
    }, 0, (x, y, z) => (y < -0.66 ? C.shirtDark : C.shirt));
    // the ribbed hem
    b.color(C.shirtDark);
    blob(b, 0, -0.072 * S, 0.005 * S, 0.158 * S, 7, 10, (x, y, z) => [1.02, 0.20, 1.0]);
    // two braces over the shoulders
    b.color(C.strap);
    for (const s of [-1, 1]) {
      tube(b, {
        pts: [[s * 0.055 * S, -0.06 * S, 0.135 * S], [s * 0.072 * S, 0.10 * S, 0.115 * S],
        [s * 0.085 * S, 0.165 * S, 0.02 * S], [s * 0.07 * S, 0.09 * S, -0.125 * S]],
        radius: () => 0.013 * S, radial: 4, squash: () => [1, 0.45],
        capStart: true, capEnd: true, sway: () => 0,
      });
    }
    /* a small white ruff peeking out at the collar. The first version was
       seven fat blobs in a ring and read as a surgical collar — the ruff has
       to be a hint of fur above the neckline, not a garment of its own */
    b.color(P.belly);
    for (let i = 0; i < 5; i++) {
      const a = (i / 4 - 0.5) * 1.9;
      blob(b, Math.sin(a) * 0.054 * S, 0.163 * S, 0.048 * S + Math.cos(a) * 0.022 * S,
        0.030 * S, 4, 6, (x, y, z) => [1.0, 0.8, 0.9]);
    }
    attach(torso, b);
  }

  /* --- barely any neck: the head sits right down on the shoulders -------- */
  const neck = joint(torso, 0, 0.175 * S, 0.012 * S, 'neck');

  /* --- THE HEAD, which is the character ---------------------------------- */
  const head = joint(neck, 0, 0.145 * S, 0.0, 'head');
  {
    const b = new MeshBuilder();
    // a big soft skull, a touch wider than tall
    b.color(P.body);
    blob(b, 0, 0, 0, 0.175 * S, 9, 12, (x, y, z) => [1.06, 0.96, 1.0], 0,
      (x, y, z) => {
        // pale muzzle mask sweeping up the front of the face into the cheeks
        const mask = clamp(z * 1.5 - Math.abs(x) * 0.7 - y * 1.7 - 0.12, 0, 1);
        return mixHex(P.body, P.belly, clamp(mask * 1.6, 0, 1));
      });
    /* CHEEK RUFFS. Two soft tufts at the jawline. They widen the face at the
       bottom, which is what stops a round head reading as a ball. */
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const t = i / 2;
        b.color(mixHex(P.belly, P.body, 0.1 + t * 0.25));
        blob(b, s * (0.135 + t * 0.028) * S, (-0.035 - t * 0.022) * S, (0.03 - t * 0.045) * S,
          (0.062 - t * 0.012) * S, 4, 7, (x, y, z) => [1.0, 0.95, 0.85]);
      }
    }
    /* THE SNOOT: short, round and low. Not a snout — a snout is the single
       most uncanny thing you can put on a stylised animal face. */
    b.color(P.belly);
    blob(b, 0, -0.052 * S, 0.128 * S, 0.072 * S, 6, 9, (x, y, z) => [1.15, 0.86, 0.92]);
    // the little dark nose, a rounded triangle
    b.color(0x3a2b26);
    blob(b, 0, -0.030 * S, 0.188 * S, 0.026 * S, 4, 7, (x, y, z) => [1.3, 0.85, 0.7]);
    // a soft closed smile
    b.color(shade(P.belly, -0.34));
    for (let i = 0; i < 5; i++) {
      const t = (i / 4 - 0.5);
      blob(b, t * 0.042 * S, (-0.072 - Math.abs(t) * 0.012) * S, (0.172 - Math.abs(t) * 0.02) * S,
        0.0075 * S, 3, 4, (x, y, z) => [1, 0.7, 0.7]);
    }
    // the pale brow spots the reference has above each eye
    b.color(mixHex(P.belly, 0xffffff, 0.35));
    for (const s of [-1, 1]) {
      blob(b, s * 0.062 * S, 0.088 * S, 0.128 * S, 0.022 * S, 3, 5, (x, y, z) => [1.3, 0.9, 0.5]);
    }
    attach(head, b);

    const eb = new MeshBuilder();
    for (const s of [-1, 1]) {
      cuteEye(eb, {
        x: s * 0.079 * S, y: 0.012 * S, z: 0.139 * S, r: 0.050 * S,
        iris: P.eye, side: s, lid: 0.55,
      });
    }
    attach(head, eb);
  }

  /* --- ears: big rounded triangles, set wide ---------------------------- */
  const earL = joint(head, -0.098 * S, 0.128 * S, -0.012 * S, 'earL');
  const earR = joint(head, 0.098 * S, 0.128 * S, -0.012 * S, 'earR');
  for (const [jn, side] of [[earL, -1], [earR, 1]]) {
    const b = new MeshBuilder();
    /* Broad and short, not tall and thin. A narrow ear on a big round head
       reads as an antenna; widening the base until it is nearly as wide as
       it is tall is what turns it back into an ear. */
    const H = 0.128 * S, W = 0.115 * S;
    b.color(P.body);
    const tip = [side * 0.012 * S, H, -0.010 * S];
    wedge(b, [-W / 2, 0, 0], [W / 2, 0, 0], tip, 0.040 * S);
    // a fat rounded tip, so there is no sharp point in the silhouette at all
    blob(b, side * 0.010 * S, H * 0.90, -0.009 * S, 0.034 * S, 4, 7, (x, y, z) => [1.05, 1.0, 0.85]);
    // and soften the two shoulders of the triangle
    for (const q of [-1, 1]) {
      blob(b, q * W * 0.42, H * 0.10, 0, 0.030 * S, 3, 6, (x, y, z) => [1, 1, 0.8]);
    }
    b.color(mixHex(P.belly, 0xe8bfae, 0.45));
    wedge(b, [-W * 0.30, 0.018 * S, 0.026 * S], [W * 0.30, 0.018 * S, 0.026 * S],
      [side * 0.010 * S, H * 0.72, 0.018 * S], 0.010 * S);
    blob(b, side * 0.008 * S, H * 0.40, 0.024 * S, 0.026 * S, 3, 6, (x, y, z) => [1.15, 1.5, 0.35]);
    attach(jn, b);
  }

  /* --- the tail: five segments, and it is huge -------------------------- */
  const tail = [];
  {
    let parent = joint(hip, 0, 0.03 * S, -0.135 * S, 'tailBase');
    tail.push(parent);
    // four segments, not five: on a body this short a five-segment brush is
    // half a metre of tail on a one-metre character and it reads as a plank
    const segs = 4;
    for (let i = 0; i < segs; i++) {
      const t = i / segs;
      const b = new MeshBuilder();
      const len = 0.088 * S;
      // fatter and shorter than a real brush: it reads as a cushion, and a
      // cushion is cute where a plume is handsome
      const rad = lerp(0.092, 0.062, t) * S * (1 + Math.sin(t * Math.PI) * 0.42);
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

  /* --- arms: short, soft, and they end in MITTENS ------------------------
     Separated fingers are for hands you can see the knuckles of. At this
     scale they read as twigs, so the paw is one rounded mitten with a thumb
     bump — which is also far easier to close convincingly round a weapon. */
  const arms = [];
  for (const side of [-1, 1]) {
    const sh = joint(torso, side * 0.135 * S, 0.135 * S, 0.01 * S, 'shoulder');
    const b1 = new MeshBuilder();
    b1.color(C.shirt);
    limb(b1, 0.105 * S, 0.052 * S, 0.046 * S, C.shirt, { squashZ: 1.0, segs: 3 });
    // the cuff of the sleeve
    b1.color(C.shirtDark);
    blob(b1, 0, -0.105 * S, 0, 0.049 * S, 4, 7, (x, y, z) => [1, 0.34, 1]);
    attach(sh, b1);
    const el = joint(sh, 0, -0.105 * S, 0, 'elbow');
    const b2 = new MeshBuilder();
    limb(b2, 0.082 * S, 0.042 * S, 0.038 * S, mixHex(P.body, P.sock, 0.5), { segs: 3 });
    attach(el, b2);
    const hand = joint(el, 0, -0.082 * S, 0, 'hand');
    const b3 = new MeshBuilder();
    b3.color(P.sock);
    // the mitten
    blob(b3, 0, -0.030 * S, 0.006 * S, 0.048 * S, 5, 8, (x, y, z) => [0.92, 1.1, 1.05]);
    // a thumb pad on the inboard side, so the paw has a front and a back
    blob(b3, -side * 0.034 * S, -0.024 * S, 0.012 * S, 0.023 * S, 3, 5, (x, y, z) => [1, 1.1, 1]);
    attach(hand, b3);
    arms.push({ shoulder: sh, elbow: el, hand, side });
  }

  /* --- legs: short and chunky, in little boots --------------------------
     The hock joint stays in the rig so the animator's digitigrade spring
     still works, but the segments are short enough that the leg reads as a
     stubby boot rather than as a hind leg. */
  const legs = [];
  for (const side of [-1, 1]) {
    const hipJ = joint(hip, side * 0.082 * S, -0.028 * S, -0.005 * S, 'legHip');
    const b1 = new MeshBuilder();
    b1.color(C.trouser);
    blob(b1, 0, -0.058 * S, -0.002 * S, 0.072 * S, 5, 8, (x, y, z) => [0.95, 1.18, 1.05]);
    attach(hipJ, b1);
    const knee = joint(hipJ, 0, -0.105 * S, 0, 'knee');
    const b2 = new MeshBuilder();
    b2.color(C.trouser);
    limb(b2, 0.058 * S, 0.056 * S, 0.048 * S, C.trouser, { segs: 3 });
    // the turn-up at the bottom of the shorts
    b2.color(shade(C.trouser, -0.16));
    blob(b2, 0, -0.058 * S, 0, 0.052 * S, 4, 7, (x, y, z) => [1, 0.3, 1]);
    attach(knee, b2);
    const hock = joint(knee, 0, -0.058 * S, 0, 'hock');
    const b3 = new MeshBuilder();
    limb(b3, 0.052 * S, 0.042 * S, 0.040 * S, P.sock, { segs: 3 });
    attach(hock, b3);
    const foot = joint(hock, 0, -0.052 * S, 0, 'foot');
    const b4 = new MeshBuilder();
    b4.color(P.sock);
    // a rounded boot, wider than it is tall, with a slight toe
    blob(b4, 0, -0.012 * S, 0.020 * S, 0.050 * S, 5, 8, (x, y, z) => [0.94, 0.72, 1.18]);
    b4.color(shade(P.sock, -0.22));
    blob(b4, 0, -0.030 * S, 0.022 * S, 0.048 * S, 4, 6, (x, y, z) => [0.96, 0.3, 1.14]);
    attach(foot, b4);
    legs.push({ hip: hipJ, knee, hock, ankle: foot, side });
  }

  const grip = joint(arms[1].hand, 0.004 * S, -0.038 * S, 0.028 * S, 'grip');

  return {
    root,
    species: 'fox',
    parts: { hip, torso, neck, head, earL, earR, arms, legs, tail, grip },
    metrics: {
      height: 1.02, radius: 0.24, eyeHeight: 0.68, hipHeight: 0.345,
      scale: 1, legLen: 0.275, armLen: 0.19,
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
