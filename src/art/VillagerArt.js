/* VillagerArt.js — the people of Hearthwood.
   ===========================================================================
   The three playable animals each get their own modelling code because the
   player looks at them for hours. The villagers get ONE parametric builder
   with a species table, because you see them from four metres away while they
   are busy doing something else — and a parametric builder that can make
   nineteen recognisable animals is worth far more here than three perfect
   ones would be.

   What the table controls, in order of how much it matters at four metres:

     SIZE      a mouse is knee-high to a badger and that reads instantly
     EARS      round / tall / tufted / none — the fastest species cue there is
     MUZZLE    length and colour
     TAIL      bush / rope / stub / none
     MARKINGS  the badger's stripes, the hedgehog's spines, the otter's bib
     CLOTHES   a smock, an apron, a hood, a hat — which also says their JOB

   They are built standing, arms down, and posed by NPCs.js.
*/

import * as THREE from '../../lib/three.module.js?v=1790085618';
import { MeshBuilder, tube, blob, lathe, blade, box, quad, sheet, wedge } from './Geo.js?v=1790085618';
import { FUR, CLOTH, BUILD, METAL, mixHex, tweak, shade } from './Palette.js?v=1790085618';
import { MATS } from './Materials.js?v=1790085618';
import { makeRng, clamp, lerp, TAU } from '../core/Util.js?v=1790085618';

/* ========================================================================= */
/* SPECIES                                                                   */
/* ========================================================================= */

export const VILLAGER_KINDS = {
  rabbit: {
    label: 'rabbit', h: 1.05, build: 0.92, fur: FUR.rabbit, inner: FUR.rabbitIn,
    ear: 'long', earLen: 0.30, earW: 0.055, muzzle: 0.055, tail: 'puff', eye: 0x3a2a22,
  },
  hare: {
    label: 'hare', h: 1.18, build: 0.88, fur: FUR.hare, inner: FUR.hareSilver,
    ear: 'long', earLen: 0.36, earW: 0.050, muzzle: 0.065, tail: 'puff', eye: 0x6a4a2a,
  },
  mouse: {
    label: 'mouse', h: 0.78, build: 0.85, fur: FUR.mouse, inner: FUR.mouseIn,
    ear: 'round', earLen: 0.085, earW: 0.085, muzzle: 0.075, tail: 'rope', eye: 0x1a1210,
  },
  badger: {
    label: 'badger', h: 1.22, build: 1.35, fur: FUR.badger, inner: FUR.badgerWhite,
    ear: 'small', earLen: 0.040, earW: 0.045, muzzle: 0.085, tail: 'stub', eye: 0x1a1512,
    stripes: true,
  },
  hedgehog: {
    label: 'hedgehog', h: 0.82, build: 1.18, fur: FUR.hedgehog, inner: 0xd8c8ac,
    ear: 'small', earLen: 0.030, earW: 0.035, muzzle: 0.090, tail: 'none', eye: 0x1a1210,
    spines: true,
  },
  otter: {
    label: 'otter', h: 1.12, build: 1.0, fur: FUR.otter, inner: FUR.otterIn,
    ear: 'small', earLen: 0.032, earW: 0.040, muzzle: 0.070, tail: 'thick', eye: 0x2a1f18,
  },
  /* The fisherman. Short muzzle, wide-set rounded ears and a long tail —
     the three things that stop a cat reading as a small fox. */
  cat: {
    label: 'cat', h: 1.06, build: 0.94, fur: 0x8a8578, inner: 0xf0e8d8,
    ear: 'tall', earLen: 0.070, earW: 0.062, muzzle: 0.048, tail: 'long', eye: 0x7aa84a,
  },
  squirrel: {
    label: 'squirrel', h: 0.88, build: 0.85, fur: FUR.squirrel, inner: FUR.squirrelIn,
    ear: 'tuft', earLen: 0.075, earW: 0.045, muzzle: 0.055, tail: 'bush', eye: 0x1a1210,
  },
  deer: {
    label: 'deer', h: 1.38, build: 0.92, fur: FUR.deer, inner: FUR.deerIn,
    ear: 'leaf', earLen: 0.12, earW: 0.08, muzzle: 0.11, tail: 'stub', eye: 0x1a1210,
    antlers: true,
  },
  fox: {
    label: 'fox', h: 1.10, build: 0.95, fur: FUR.foxBody, inner: FUR.foxBelly,
    ear: 'tall', earLen: 0.11, earW: 0.06, muzzle: 0.12, tail: 'bush', eye: FUR.foxEye,
  },
  bear: {
    label: 'bear', h: 1.50, build: 1.45, fur: FUR.bearBody, inner: FUR.bearMuzzle,
    ear: 'round', earLen: 0.05, earW: 0.055, muzzle: 0.075, tail: 'stub', eye: FUR.bearEye,
  },
  frog: {
    label: 'frog', h: 0.86, build: 1.25, fur: FUR.frogBody, inner: FUR.frogBelly,
    ear: 'none', earLen: 0, earW: 0, muzzle: 0.05, tail: 'none', eye: FUR.frogEye,
    wideMouth: true,
  },
};

export const VILLAGER_LIST = Object.keys(VILLAGER_KINDS);

/* ========================================================================= */
/* CLOTHES                                                                   */
/* ========================================================================= */

/* Clothing is the other half of the silhouette and it also tells the player
   what somebody does. An apron is a baker, a hood is a forester. */
export const OUTFITS = {
  smock: { body: true, skirt: 0.32, apron: false, hood: false, hat: null },
  apron: { body: true, skirt: 0.28, apron: true, hood: false, hat: null },
  hood: { body: true, skirt: 0.24, apron: false, hood: true, hat: null },
  jerkin: { body: true, skirt: 0.10, apron: false, hood: false, hat: null },
  strawHat: { body: true, skirt: 0.26, apron: true, hood: false, hat: 'straw' },
  cap: { body: true, skirt: 0.18, apron: false, hood: false, hat: 'cap' },
  child: { body: true, skirt: 0.20, apron: false, hood: false, hat: null },
  none: { body: false, skirt: 0, apron: false, hood: false, hat: null },
};

/* ========================================================================= */
/* BUILDER                                                                   */
/* ========================================================================= */

function joint(parent, x, y, z, name) {
  const g = new THREE.Group();
  g.position.set(x, y, z); g.name = name; parent.add(g); return g;
}
function attach(j, b) {
  if (b.isEmpty) return null;
  const m = new THREE.Mesh(b.build({ flat: false }), MATS.character);
  m.castShadow = true; m.receiveShadow = true;
  j.add(m);
  return m;
}

/**
 * @param {object} o
 * @param {string} o.kind     key of VILLAGER_KINDS
 * @param {string} o.outfit   key of OUTFITS
 * @param {number} o.seed
 * @param {number} o.scale    1 adult, ~0.62 child
 * @param {number} o.cloth    hex override
 */
export function buildVillager({ kind = 'rabbit', outfit = 'smock', seed = 1, scale = 1, cloth = null } = {}) {
  const K = VILLAGER_KINDS[kind] || VILLAGER_KINDS.rabbit;
  const O = OUTFITS[outfit] || OUTFITS.smock;
  const r = makeRng(seed ^ 0x7115);
  const H = K.h * scale;
  const B = K.build;
  const root = new THREE.Group();

  const furHex = tweak(K.fur, { h: r.range(-0.02, 0.02), l: r.range(0.88, 1.12) });
  const innerHex = tweak(K.inner, { l: r.range(0.92, 1.08) });
  const clothHex = cloth ?? r.pick(CLOTH);
  const clothB = shade(clothHex, r.range(-0.2, -0.05));

  const hipY = H * 0.42;
  const hip = joint(root, 0, hipY, 0, 'hip');
  const torso = joint(hip, 0, 0, 0, 'torso');

  /* --- torso ------------------------------------------------------------ */
  {
    const b = new MeshBuilder();
    const R = H * 0.15 * B;
    blob(b, 0, H * 0.13, 0, R, 6, 9, (x, y, z) => {
      const chest = clamp(y * 1.2 + 0.4, 0, 1);
      return [lerp(0.86, 1.06, chest) * B, 1.5, lerp(0.82, 1.0, chest)];
    }, 0, (x, y, z) => {
      const front = clamp(z * 1.4 - Math.abs(x) * 1.1, 0, 1);
      return mixHex(furHex, innerHex, front * 0.6 + clamp(-y - 0.2, 0, 1) * 0.3);
    });

    /* the badger's stripes and the hedgehog's spines: species cues that are
       worth a handful of triangles each */
    if (K.spines) {
      const n = 26;
      for (let i = 0; i < n; i++) {
        const a = r.range(0, TAU), u = r.range(-0.2, 0.9);
        const rr = R * Math.sqrt(1 - u * u * 0.6);
        b.color(FUR.hedgehogSpine, 0.12, r);
        const p = [Math.cos(a) * rr * 0.9, H * 0.13 + u * R * 1.4, Math.sin(a) * rr * 0.75 - R * 0.25];
        tube(b, {
          pts: [p, [p[0] * 1.5, p[1] + R * 0.35, p[2] * 1.5 - R * 0.2]],
          radius: t => R * 0.055 * (1 - t), radial: 3, capStart: false, capEnd: false, sway: () => 0,
        });
      }
    }

    if (O.body) {
      /* the clothes: a simple tunic over the torso with a skirt below it */
      b.color(clothHex, 0.04, r);
      blob(b, 0, H * 0.10, 0, R * 1.10, 5, 9, (x, y, z) => {
        const chest = clamp(y * 1.2 + 0.4, 0, 1);
        return [lerp(0.88, 1.06, chest) * B, 1.35, lerp(0.86, 1.02, chest)];
      });
      if (O.skirt > 0.02) {
        const sk = H * O.skirt;
        b.color(clothHex, 0.05, r);
        // the hem turns back under, so a skirt is a shell and not an open
        // cone you can see the inside of from any low angle
        lathe(b, [
          [R * 0.96 * B, -H * 0.02], [R * 1.18 * B, -sk * 0.55], [R * 1.30 * B, -sk],
          [R * 1.22 * B, -sk * 0.97], [R * 1.05 * B, -sk * 0.5],
        ], 11, 0, 0, 0, t => shade(clothHex, -t * 0.22));
      }
      if (O.apron) {
        b.color(mixHex(BUILD.clothCream, 0xd8cfb0, r()), 0.05, r);
        const w = R * 1.0 * B;
        sheet(b, [-w, H * 0.18, R * 0.92], [w, H * 0.18, R * 0.92],
          [w * 1.25, -H * O.skirt * 0.95, R * 1.0], [-w * 1.25, -H * O.skirt * 0.95, R * 1.0], 0.01);
      }
      // a belt
      b.color(0x4a3628, 0.05, r);
      lathe(b, [[R * 1.10 * B, H * 0.0], [R * 1.13 * B, H * 0.035]], 11);
    }
    attach(torso, b);
  }

  /* --- head -------------------------------------------------------------- */
  const neck = joint(torso, 0, H * 0.27, 0.01 * H, 'neck');
  const head = joint(neck, 0, H * 0.075, 0, 'head');
  {
    const b = new MeshBuilder();
    const R = H * 0.105;
    b.color(furHex);
    blob(b, 0, 0, 0, R, 6, 9, (x, y, z) => [1.0, 0.98, 1.02], 0, (x, y, z) => {
      let c = furHex;
      if (y < -0.3) c = mixHex(c, innerHex, clamp(-y * 1.1 - 0.25, 0, 1));
      if (K.stripes) {
        // the badger's face: white with two black bands through the eyes
        const band = Math.abs(Math.abs(x) - 0.45) < 0.16 && z > -0.2;
        c = z > -0.1 ? (band ? 0x231f1c : FUR.badgerWhite) : c;
      }
      return c;
    });

    /* the muzzle */
    const mz = H * K.muzzle;
    b.color(innerHex);
    tube(b, {
      pts: [[0, -R * 0.15, R * 0.5], [0, -R * 0.28, R * 0.5 + mz]],
      radius: t => lerp(R * 0.55, R * 0.28, t), radial: 7,
      squash: () => [1, 0.85],
      color: (t, i, ang) => mixHex(innerHex, furHex, clamp(-Math.cos(ang - Math.PI * 0.5) * 0.7, 0, 0.5)),
      capStart: false, capEnd: true, sway: () => 0,
    });
    b.color(0x1a1310);
    blob(b, 0, -R * 0.26, R * 0.5 + mz + R * 0.05, R * 0.14, 3, 6, (x, y, z) => [1.3, 0.8, 0.7]);
    if (K.wideMouth) {
      b.color(shade(furHex, -0.35));
      for (const s of [-1, 1]) blob(b, s * R * 0.5, -R * 0.35, R * 0.55, R * 0.16, 3, 5, (x, y, z) => [1.4, 0.3, 0.9]);
    }

    /* eyes */
    for (const s of [-1, 1]) {
      b.color(0xf0e8d4);
      blob(b, s * R * 0.44, R * 0.16, R * 0.66, R * 0.20, 4, 7, (x, y, z) => [1, 0.92, 0.7]);
      b.color(K.eye);
      blob(b, s * R * 0.44, R * 0.16, R * 0.78, R * 0.13, 3, 6, (x, y, z) => [1, 1, 0.5]);
      b.color(0x100c08);
      blob(b, s * R * 0.44, R * 0.16, R * 0.84, R * 0.07, 3, 5, (x, y, z) => [1, 1.1, 0.5]);
      b.color(0xffffff);
      blob(b, s * R * 0.44 - R * 0.05, R * 0.22, R * 0.88, R * 0.035, 2, 4);
    }
    attach(head, b);
  }

  /* --- ears --------------------------------------------------------------- */
  const ears = [];
  if (K.ear !== 'none') {
    const R = H * 0.105;
    for (const side of [-1, 1]) {
      const j = joint(head, side * R * (K.ear === 'long' ? 0.35 : 0.72), R * 0.72, -R * 0.08, 'ear');
      const b = new MeshBuilder();
      const L = H * K.earLen, W = H * K.earW;
      b.color(furHex);
      if (K.ear === 'long') {
        tube(b, {
          pts: [[0, 0, 0], [side * L * 0.1, L * 0.55, -L * 0.05], [side * L * 0.22, L, -L * 0.1]],
          radius: t => W * (0.7 + Math.sin(t * Math.PI) * 0.5), radial: 6,
          squash: () => [1, 0.42],
          color: (t, i, ang) => Math.cos(ang) > 0.35 ? mixHex(innerHex, 0xd8a8a0, 0.35) : furHex,
          capStart: false, capEnd: true, sway: () => 0,
        });
      } else if (K.ear === 'tall' || K.ear === 'tuft' || K.ear === 'leaf') {
        const tip = [side * L * 0.25, L, -L * 0.1];
        const wid = K.ear === 'leaf' ? W * 1.5 : W;
        wedge(b, [-wid, 0, 0], [wid, 0, 0], tip, W * 0.22);
        b.color(mixHex(innerHex, 0xd8b8a8, 0.3));
        wedge(b, [-wid * 0.6, W * 0.2, W * 0.16], [wid * 0.6, W * 0.2, W * 0.16],
          [side * L * 0.22, L * 0.82, W * 0.1], W * 0.05);
        if (K.ear === 'tuft') {
          b.color(shade(furHex, -0.2));
          for (let i = 0; i < 4; i++) {
            const a = r.range(-0.5, 0.5);
            tube(b, {
              pts: [[side * L * 0.2, L * 0.9, 0], [side * L * 0.3 + a * W, L * 1.45, a * W]],
              radius: t => W * 0.22 * (1 - t), radial: 3, capStart: false, capEnd: false, sway: () => 0,
            });
          }
        }
      } else {
        blob(b, 0, L * 0.4, 0, Math.max(W, L), 4, 7, (x, y, z) => [1, 1.05, 0.45]);
        b.color(mixHex(innerHex, 0xd8b8a8, 0.3));
        blob(b, 0, L * 0.4, W * 0.35, Math.max(W, L) * 0.6, 3, 6, (x, y, z) => [1, 1, 0.3]);
      }
      attach(j, b);
      ears.push(j);
    }
  }

  if (K.antlers) {
    const R = H * 0.105;
    for (const side of [-1, 1]) {
      const b = new MeshBuilder();
      b.color(0xbfa882, 0.06, r);
      const L = H * 0.22;
      tube(b, {
        pts: [[side * R * 0.4, R * 0.7, 0], [side * R * 0.7, R * 0.7 + L * 0.6, -L * 0.1], [side * R * 1.0, R * 0.7 + L, -L * 0.2]],
        radius: t => R * 0.09 * (1 - t * 0.5), radial: 4, capStart: false, capEnd: true, sway: () => 0,
      });
      for (let i = 0; i < 2; i++) {
        const t = 0.4 + i * 0.35;
        tube(b, {
          pts: [[side * R * (0.4 + 0.6 * t), R * 0.7 + L * t, -L * 0.15 * t],
          [side * R * (0.4 + 0.6 * t) + side * R * 0.5, R * 0.7 + L * t + L * 0.35, -L * 0.3]],
          radius: u => R * 0.06 * (1 - u), radial: 3, capStart: false, capEnd: true, sway: () => 0,
        });
      }
      attach(head, b);
    }
  }

  /* --- hat / hood --------------------------------------------------------- */
  if (O.hood) {
    const b = new MeshBuilder();
    const R = H * 0.105;
    b.color(clothB, 0.05, r);
    blob(b, 0, R * 0.12, -R * 0.12, R * 1.22, 5, 9, (x, y, z) => [1.0, 0.95, 1.05 + Math.max(0, -z) * 0.35]);
    // the opening, cut as a darker recess rather than real geometry
    b.color(shade(clothB, -0.45), 0.04, r);
    blob(b, 0, R * 0.1, R * 0.85, R * 0.72, 4, 7, (x, y, z) => [1, 1, 0.3]);
    attach(head, b);
  } else if (O.hat === 'straw') {
    const b = new MeshBuilder();
    const R = H * 0.105;
    b.color(BUILD.thatch, 0.06, r);
    lathe(b, [[0.001, R * 1.35], [R * 0.75, R * 1.15], [R * 0.85, R * 0.75], [R * 1.9, R * 0.55], [R * 1.85, R * 0.48]], 12, 0, 0);
    b.color(r.pick(CLOTH), 0.05, r);
    lathe(b, [[R * 0.88, R * 0.78], [R * 0.90, R * 0.92]], 12, 0, 0);
    attach(head, b);
  } else if (O.hat === 'cap') {
    const b = new MeshBuilder();
    const R = H * 0.105;
    b.color(clothB, 0.05, r);
    blob(b, 0, R * 0.55, 0, R * 0.95, 4, 8, (x, y, z) => [1, 0.62, 1]);
    b.color(shade(clothB, -0.18), 0.04, r);
    blob(b, 0, R * 0.4, R * 0.7, R * 0.55, 3, 6, (x, y, z) => [1.3, 0.25, 0.9]);
    attach(head, b);
  }

  /* --- arms --------------------------------------------------------------- */
  const arms = [];
  for (const side of [-1, 1]) {
    const R = H * 0.15 * B;
    const sh = joint(torso, side * R * 1.02, H * 0.225, 0, 'shoulder');
    const b1 = new MeshBuilder();
    limbSeg(b1, H * 0.165, H * 0.040, H * 0.030, O.body ? clothHex : furHex);
    attach(sh, b1);
    const el = joint(sh, 0, -H * 0.165, 0, 'elbow');
    const b2 = new MeshBuilder();
    limbSeg(b2, H * 0.145, H * 0.030, H * 0.026, furHex);
    attach(el, b2);
    const hand = joint(el, 0, -H * 0.145, 0, 'hand');
    const b3 = new MeshBuilder();
    b3.color(innerHex, 0.05, r);
    blob(b3, 0, -H * 0.022, H * 0.008, H * 0.032, 4, 6, (x, y, z) => [0.9, 0.95, 1.15]);
    attach(hand, b3);
    arms.push({ shoulder: sh, elbow: el, hand, side });
  }

  /* --- legs --------------------------------------------------------------- */
  const legs = [];
  for (const side of [-1, 1]) {
    const hj = joint(hip, side * H * 0.055 * B, -H * 0.02, 0, 'legHip');
    const b1 = new MeshBuilder();
    limbSeg(b1, H * 0.19, H * 0.050, H * 0.038, furHex);
    attach(hj, b1);
    const knee = joint(hj, 0, -H * 0.19, 0, 'knee');
    const b2 = new MeshBuilder();
    limbSeg(b2, H * 0.17, H * 0.038, H * 0.030, furHex);
    attach(knee, b2);
    const ankle = joint(knee, 0, -H * 0.17, 0, 'ankle');
    const b3 = new MeshBuilder();
    b3.color(shade(furHex, -0.2), 0.05, r);
    blob(b3, 0, H * 0.015, H * 0.022, H * 0.042, 4, 7, (x, y, z) => [0.85, 0.45, 1.5]);
    attach(ankle, b3);
    legs.push({ hip: hj, knee, ankle, side });
  }

  /* --- tail ---------------------------------------------------------------- */
  const tail = [];
  if (K.tail !== 'none') {
    const t0 = joint(hip, 0, H * 0.02, -H * 0.09 * B, 'tail');
    const b = new MeshBuilder();
    b.color(furHex, 0.05, r);
    if (K.tail === 'puff') {
      blob(b, 0, 0, -H * 0.03, H * 0.05, 4, 7);
      b.color(innerHex, 0.05, r);
      blob(b, 0, 0, -H * 0.05, H * 0.035, 3, 6);
    } else if (K.tail === 'rope') {
      tube(b, {
        pts: [[0, 0, 0], [0, -H * 0.04, -H * 0.12], [H * 0.02, -H * 0.10, -H * 0.20]],
        radius: t => H * 0.016 * (1 - t * 0.55), radial: 5,
        color: () => mixHex(furHex, 0xc8a898, 0.4), capStart: false, capEnd: true, sway: () => 0,
      });
    } else if (K.tail === 'bush') {
      for (let i = 0; i < 4; i++) {
        const t = i / 3;
        b.color(mixHex(furHex, innerHex, t * 0.5), 0.05, r);
        blob(b, 0, -H * 0.02 * t, -H * (0.04 + t * 0.14), H * (0.055 - t * 0.012), 4, 7);
      }
    } else if (K.tail === 'thick') {
      tube(b, {
        pts: [[0, 0, 0], [0, -H * 0.05, -H * 0.14], [0, -H * 0.13, -H * 0.24]],
        radius: t => H * 0.038 * (1 - t * 0.7), radial: 6,
        squash: () => [1, 0.75], capStart: false, capEnd: true, sway: () => 0,
      });
    } else {
      blob(b, 0, 0, -H * 0.02, H * 0.035, 3, 6, (x, y, z) => [1, 0.9, 1.2]);
    }
    attach(t0, b);
    tail.push(t0);
  }

  const grip = joint(arms[1].hand, 0, -H * 0.03, H * 0.03, 'grip');

  return {
    root, species: kind, kind,
    parts: { hip, torso, neck, head, arms, legs, tail, ears, grip },
    metrics: { height: H, radius: H * 0.2 * B, eyeHeight: H * 0.80, hipHeight: hipY },
  };
}

function limbSeg(b, len, r0, r1, hex) {
  const pts = [];
  for (let i = 0; i <= 3; i++) pts.push([0, -len * (i / 3), 0]);
  b.color(hex);
  tube(b, { pts, radius: t => lerp(r0, r1, t), radial: 6, capStart: true, capEnd: true, sway: () => 0 });
}

/* ========================================================================= */
/* LIVESTOCK                                                                 */
/* ========================================================================= */

/** Chickens, cats, ducks and goats — four-legged, small, and always busy. */
export function buildCritter({ kind = 'chicken', seed = 1 } = {}) {
  const r = makeRng(seed ^ 0xc217);
  const root = new THREE.Group();
  const body = joint(root, 0, 0, 0, 'body');
  const b = new MeshBuilder();

  if (kind === 'chicken') {
    const H = 0.32;
    b.color(tweak(FUR.chicken, { l: r.range(0.8, 1.1) }), 0.05, r);
    blob(b, 0, H * 0.55, 0, H * 0.30, 5, 8, (x, y, z) => [0.85, 0.95, 1.15]);
    blob(b, 0, H * 0.95, H * 0.10, H * 0.15, 4, 7);
    b.color(FUR.chickenComb, 0.06, r);
    blob(b, 0, H * 1.10, H * 0.09, H * 0.055, 3, 5, (x, y, z) => [0.4, 1.3, 1]);
    b.color(0xd8a840, 0.05, r);
    blob(b, 0, H * 0.93, H * 0.22, H * 0.04, 3, 5, (x, y, z) => [0.8, 0.7, 1.6]);
    b.color(0x141210);
    for (const s of [-1, 1]) blob(b, s * H * 0.07, H * 0.99, H * 0.16, H * 0.022, 3, 5);
    b.color(0xd8a840, 0.05, r);
    for (const s of [-1, 1]) {
      tube(b, {
        pts: [[s * H * 0.08, H * 0.32, 0], [s * H * 0.08, 0, H * 0.02]],
        radius: () => H * 0.022, radial: 4, capStart: false, capEnd: true, sway: () => 0,
      });
    }
    b.color(tweak(FUR.chicken, { l: 0.85 }), 0.05, r);
    blob(b, 0, H * 0.72, -H * 0.28, H * 0.13, 3, 6, (x, y, z) => [0.35, 1.5, 1]);
    root.userData.h = H;
  } else if (kind === 'cat') {
    const H = 0.34;
    const fur = tweak(FUR.cat, { h: r.range(-0.03, 0.05), l: r.range(0.7, 1.2) });
    b.color(fur, 0.05, r);
    blob(b, 0, H * 0.62, 0, H * 0.24, 5, 8, (x, y, z) => [0.78, 0.82, 1.55]);
    blob(b, 0, H * 0.80, H * 0.34, H * 0.15, 4, 7);
    for (const s of [-1, 1]) {
      wedge(b, [s * H * 0.02, H * 0.90, H * 0.34], [s * H * 0.17, H * 0.90, H * 0.30],
        [s * H * 0.10, H * 1.05, H * 0.30], H * 0.018);
    }
    b.color(0x9ac47a, 0.05, r);
    for (const s of [-1, 1]) blob(b, s * H * 0.06, H * 0.83, H * 0.46, H * 0.030, 3, 5);
    b.color(fur, 0.05, r);
    for (const s of [-1, 1]) {
      for (const f of [-1, 1]) {
        tube(b, {
          pts: [[s * H * 0.12, H * 0.45, f * H * 0.28], [s * H * 0.12, 0, f * H * 0.30]],
          radius: () => H * 0.035, radial: 4, capStart: false, capEnd: true, sway: () => 0,
        });
      }
    }
    tube(b, {
      pts: [[0, H * 0.68, -H * 0.36], [0, H * 0.95, -H * 0.55], [0, H * 1.15, -H * 0.48]],
      radius: t => H * 0.045 * (1 - t * 0.3), radial: 5, capStart: false, capEnd: true, sway: () => 0,
    });
    root.userData.h = H;
  } else { // duck
    const H = 0.28;
    b.color(tweak(FUR.duck, { l: r.range(0.85, 1.15) }), 0.05, r);
    blob(b, 0, H * 0.50, 0, H * 0.28, 5, 8, (x, y, z) => [0.85, 0.8, 1.35]);
    blob(b, 0, H * 0.82, H * 0.18, H * 0.13, 4, 7);
    b.color(0xd8a840, 0.05, r);
    blob(b, 0, H * 0.78, H * 0.32, H * 0.07, 3, 6, (x, y, z) => [1.1, 0.4, 1.5]);
    b.color(0x141210);
    for (const s of [-1, 1]) blob(b, s * H * 0.06, H * 0.88, H * 0.24, H * 0.020, 3, 5);
    root.userData.h = H;
  }

  attach(body, b);
  return { root, body, kind, metrics: { height: root.userData.h || 0.3, radius: 0.16 } };
}
