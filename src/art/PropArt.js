/* PropArt.js — the things that make a village look lived in.
   ===========================================================================
   Wells, fences, gates, lanterns, benches, signs, market stalls, carts,
   barrels, crates, sacks, firewood, washing lines, beehives, haystacks,
   planters, troughs, bridges, fire pits, and the Stickwright's whole bench.

   Buildings tell you a place was BUILT. Props tell you it is LIVED IN, and
   they are the cheaper half of that job by a wide margin: a leaning rake, a
   half-stacked woodpile and a washing line do more for a street than another
   house does.

   Everything here builds at the origin, standing on y = 0, facing +Z, and is
   stamped into a tile by Village.js.
*/

import * as THREE from '../../lib/three.module.js?v=1790020991';
import { MeshBuilder, box, hexa, beam, cylinder, lathe, blob, tube, quad, blade, sheet } from './Geo.js?v=1790020991';
import { BUILD, METAL, MOSS, PLANT, LEAF, BARK, GROUND, mixHex, tweak, shade } from './Palette.js?v=1790020991';
import { orient, lumpWarp } from './TreeGen.js?v=1790020991';
import { makeRng, clamp, lerp, TAU } from '../core/Util.js?v=1790020991';

const UP = new THREE.Vector3(0, 1, 0);
const mat = (x, y, z, ry = 0, s = 1) => new THREE.Matrix4().compose(
  new THREE.Vector3(x, y, z),
  new THREE.Quaternion().setFromAxisAngle(UP, ry),
  new THREE.Vector3(s, s, s));

/* ========================================================================= */
/* FENCES AND GATES                                                          */
/* ========================================================================= */

/** A run of fence between two points. `kind` changes the whole character. */
export function buildFence(b, { ax, az, bx, bz, seed = 1, kind = 'rail', h = 1.0, groundAt = null }) {
  const r = makeRng(seed ^ 0xfe0c);
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 0.4) return;
  const dx = (bx - ax) / len, dz = (bz - az) / len;
  const spacing = kind === 'picket' ? 1.5 : kind === 'wattle' ? 1.2 : 1.9;
  const n = Math.max(1, Math.round(len / spacing));
  const gy = groundAt || (() => 0);

  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = ax + dx * len * t, z = az + dz * len * t;
    const y = gy(x, z);
    const ph = h * r.range(0.9, 1.1);
    b.color(mixHex(BARK.hazel, BUILD.plankOld, r()), 0.08, r);
    // every post leans a little differently — a fence of plumb posts is the
    // most obviously machine-made thing you can put in a field
    const lx = r.range(-0.05, 0.05), lz = r.range(-0.05, 0.05);
    beam(b, x, y, z, x + lx * ph, y + ph, z + lz * ph, 0.09, 0.09, [0, 1, 0]);
  }

  if (kind === 'rail') {
    for (const frac of [0.38, 0.78]) {
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n;
        const x0 = ax + dx * len * t0, z0 = az + dz * len * t0;
        const x1 = ax + dx * len * t1, z1 = az + dz * len * t1;
        b.color(mixHex(BUILD.plankOld, BARK.hazel, r()), 0.09, r);
        beam(b, x0, gy(x0, z0) + h * frac, z0, x1, gy(x1, z1) + h * frac * r.range(0.96, 1.04), z1,
          0.07, 0.10, [0, 1, 0]);
      }
    }
  } else if (kind === 'picket') {
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const x0 = ax + dx * len * t0, z0 = az + dz * len * t0;
      const x1 = ax + dx * len * t1, z1 = az + dz * len * t1;
      b.color(BUILD.plankPale, 0.07, r);
      beam(b, x0, gy(x0, z0) + h * 0.62, z0, x1, gy(x1, z1) + h * 0.62, z1, 0.05, 0.07, [0, 1, 0]);
      const m = Math.max(2, Math.round(spacing / 0.22));
      for (let k = 0; k < m; k++) {
        const u = (k + 0.5) / m;
        const px = lerp(x0, x1, u), pz = lerp(z0, z1, u);
        const ph = h * r.range(0.78, 0.95);
        b.color(tweak(BUILD.plankPale, { l: r.range(0.85, 1.12) }), 0.05, r);
        beam(b, px, gy(px, pz), pz, px + r.range(-0.03, 0.03), gy(px, pz) + ph, pz, 0.055, 0.03, [0, 1, 0]);
      }
    }
  } else if (kind === 'wattle') {
    // woven hazel: horizontal withies threaded between the uprights
    const rows = 7;
    for (let k = 0; k < rows; k++) {
      const yy = h * (0.1 + 0.82 * k / (rows - 1));
      const pts = [];
      const steps = Math.max(6, Math.round(len * 2));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = ax + dx * len * t, z = az + dz * len * t;
        const weave = Math.sin(t * n * Math.PI + k * Math.PI) * 0.055;
        pts.push([x - dz * weave, gy(x, z) + yy + Math.sin(t * 9 + k) * 0.012, z + dx * weave]);
      }
      b.color(mixHex(BARK.hazel, BARK.deadWood, r() * 0.6), 0.10, r);
      tube(b, { pts, radius: () => 0.025, radial: 3, capStart: false, capEnd: false, sway: () => 0 });
    }
  } else if (kind === 'stone') {
    const steps = Math.max(3, Math.round(len * 2.2));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = ax + dx * len * t, z = az + dz * len * t;
      const y = gy(x, z);
      for (let k = 0; k < 3; k++) {
        b.color(r.chance(0.5) ? BUILD.stone : BUILD.stoneWarm, 0.08, r);
        const s = r.range(0.14, 0.26);
        blob(b, x + r.range(-0.12, 0.12), y + 0.1 + k * 0.22, z + r.range(-0.12, 0.12),
          s, 3, 5, lumpWarp(r, 3, 0.35), 0);
      }
    }
  }
}

/** A five-bar gate, usually standing open. */
export function buildGate(b, { seed = 1, w = 2.2, h = 1.15 } = {}) {
  const r = makeRng(seed ^ 0x6a7e);
  const open = r.chance(0.5) ? r.range(0.4, 1.2) : 0;
  b.color(BARK.oak, 0.06, r);
  for (const s of [-1, 1]) beam(b, s * w / 2, 0, 0, s * w / 2, h * 1.25, 0, 0.13, 0.13, [0, 1, 0]);
  const sub = new MeshBuilder();
  sub.color(BUILD.plankOld, 0.07, r);
  for (let i = 0; i < 5; i++) {
    const y = h * (0.12 + 0.82 * i / 4);
    box(sub, w / 2, y, 0, w * 0.96, 0.07, 0.05);
  }
  beam(sub, 0.05, h * 0.12, 0, w * 0.95, h * 0.94, 0, 0.07, 0.05, [0, 0, 1]);
  box(sub, w / 2, h * 0.53, 0, 0.08, h * 0.84, 0.05);
  b.append(sub, new THREE.Matrix4().compose(
    new THREE.Vector3(-w / 2, 0, 0),
    new THREE.Quaternion().setFromAxisAngle(UP, -open),
    new THREE.Vector3(1, 1, 1)));
}

/* ========================================================================= */
/* THE WELL                                                                  */
/* ========================================================================= */

export function buildWell(b, { seed = 1, r: R = 0.9 } = {}) {
  const r = makeRng(seed ^ 0x3e11);
  /* the drum: courses of rough stone */
  for (let k = 0; k < 4; k++) {
    const y = 0.12 + k * 0.21;
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + k * 0.4;
      b.color(r.chance(0.5) ? BUILD.stone : BUILD.stoneWarm, 0.09, r);
      blob(b, Math.cos(a) * R, y, Math.sin(a) * R, r.range(0.16, 0.26), 3, 5, lumpWarp(r, 3, 0.35), 0);
    }
  }
  /* the coping and the dark water below it */
  b.color(BUILD.stoneDark, 0.05, r);
  lathe(b, [[R * 0.78, 0.86], [R * 1.12, 0.90], [R * 1.12, 0.98], [R * 0.78, 0.99]], 14);
  // discs seen from above: authored outer-to-inner so the lathe winds up
  b.color(0x121a1c, 0.03, r);
  { const m = b.mark; lathe(b, [[R * 0.76, 0.42], [0.001, 0.40]], 12); b.orientOutward(m, 0, -1, 0); }
  b.color(0x2f4a4e, 0.05, r);
  { const m = b.mark; lathe(b, [[R * 0.7, 0.45], [0.001, 0.46]], 12); b.orientOutward(m, 0, -1, 0); }

  /* moss in the joints */
  for (let i = 0; i < 10; i++) {
    const a = r.range(0, TAU);
    b.color(mixHex(MOSS.deep, MOSS.mid, r()), 0.09, r);
    blob(b, Math.cos(a) * R * 1.02, r.range(0.12, 0.8), Math.sin(a) * R * 1.02, r.range(0.05, 0.11), 3, 5, null, 0);
  }

  /* posts, a little pitched roof, a windlass and a bucket */
  b.color(BARK.oak, 0.06, r);
  for (const s of [-1, 1]) beam(b, s * R * 0.85, 0.9, 0, s * R * 0.85, 2.25, 0, 0.12, 0.12, [0, 1, 0]);
  beam(b, -R * 0.85, 2.2, 0, R * 0.85, 2.2, 0, 0.12, 0.12, [0, 1, 0]);

  b.color(BUILD.shingle, 0.06, r);
  for (const s of [-1, 1]) {
    // The reverse of quad(a,b,c,d) is quad(a,d,c,b), NOT quad(b,a,d,c) —
    // the latter is a different pair of triangles and leaves the surface
    // one-sided with two stray faces. That mistake is in every hand-made
    // back face below, so they are all written the same way now.
    sheet(b, [-R * 1.2, 2.24, 0], [R * 1.2, 2.24, 0], [R * 1.2, 1.95, s * R * 1.25], [-R * 1.2, 1.95, s * R * 1.25], 0.05);
  }
  b.color(BUILD.shingleMoss, 0.05, r);
  box(b, 0, 2.28, 0, R * 2.5, 0.08, 0.14);

  /* the windlass */
  b.color(BARK.oak, 0.05, r);
  cylinder(b, 0, 0, 1.72, 1.72, 0.001, 0.001, 3);
  const sub = new MeshBuilder();
  sub.color(BARK.oak, 0.05, r);
  cylinder(sub, 0, 0, -R * 0.8, R * 0.8, 0.075, 0.075, 7);
  b.append(sub, new THREE.Matrix4().compose(
    new THREE.Vector3(0, 1.72, 0),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2),
    new THREE.Vector3(1, 1, 1)));
  b.color(METAL.iron, 0.05, r);
  beam(b, R * 0.85, 1.72, 0, R * 1.15, 1.72, 0, 0.04, 0.04, [0, 1, 0]);
  beam(b, R * 1.15, 1.72, 0, R * 1.15, 1.45, 0, 0.04, 0.04, [0, 0, 1]);

  /* rope and bucket */
  const bucketY = r.range(0.95, 1.45);
  b.color(BUILD.rope, 0.06, r);
  tube(b, { pts: [[0, 1.68, 0], [0, bucketY + 0.28, 0]], radius: () => 0.018, radial: 3, capStart: false, capEnd: false, sway: () => 0 });
  buildBucket(b, { seed, y: bucketY, scale: 1 });
  return { blockers: [{ x: 0, z: 0, r: R * 1.25 }], lights: [] };
}

export function buildBucket(b, { seed = 1, y = 0, scale = 1 } = {}) {
  const r = makeRng(seed ^ 0xbc7e);
  const R = 0.17 * scale;
  b.color(BUILD.plank, 0.07, r);
  lathe(b, [[R * 0.8, y], [R, y + 0.26 * scale], [R * 0.93, y + 0.27 * scale], [R * 0.74, y + 0.01 * scale]], 9);
  b.color(METAL.iron, 0.05, r);
  for (const yy of [0.06, 0.21]) lathe(b, [[R * 0.98, y + yy * scale], [R * 1.0, y + (yy + 0.03) * scale]], 9);
  b.color(METAL.ironDark, 0.05, r);
  const arc = [];
  for (let i = 0; i <= 6; i++) {
    const a = Math.PI * (i / 6);
    arc.push([Math.cos(a) * R, y + 0.27 * scale + Math.sin(a) * R * 0.9, 0]);
  }
  tube(b, { pts: arc, radius: () => 0.012 * scale, radial: 3, capStart: false, capEnd: false, sway: () => 0 });
}

/* ========================================================================= */
/* LIGHT                                                                     */
/* ========================================================================= */

/** A lantern on a post, on a bracket, or hanging. Returns its light source. */
export function buildLantern(b, { seed = 1, kind = 'post', h = 2.3, glow = null } = {}) {
  const r = makeRng(seed ^ 0x1a47);
  let y = h;
  if (kind === 'post') {
    b.color(mixHex(BARK.oak, BUILD.plankOld, r()), 0.07, r);
    beam(b, 0, 0, 0, r.range(-0.04, 0.04), h, r.range(-0.04, 0.04), 0.09, 0.09, [0, 1, 0]);
    b.color(METAL.iron, 0.05, r);
    beam(b, 0, h, 0, 0, h + 0.18, 0.26, 0.03, 0.03, [0, 0, 1]);
    y = h + 0.12;
    b.color(METAL.iron, 0.05, r);
    tube(b, { pts: [[0, h + 0.18, 0.26], [0, h + 0.02, 0.26]], radius: () => 0.01, radial: 3, capStart: false, capEnd: false, sway: () => 0 });
  }
  const cx = kind === 'post' ? 0 : 0, cz = kind === 'post' ? 0.26 : 0;
  const top = kind === 'post' ? h + 0.02 : h;

  /* the lantern body: an iron cage with warm panes */
  b.color(METAL.ironDark, 0.05, r);
  const S = 0.11;
  for (const [ox, oz] of [[-S, -S], [S, -S], [S, S], [-S, S]]) {
    beam(b, cx + ox, top - 0.30, cz + oz, cx + ox, top, cz + oz, 0.018, 0.018, [0, 1, 0]);
  }
  box(b, cx, top - 0.32, cz, S * 2.3, 0.035, S * 2.3);
  b.color(METAL.iron, 0.05, r);
  lathe(b, [[S * 1.9, top + 0.005], [S * 1.2, top + 0.09], [0.001, top + 0.14]], 4, cx, cz);
  b.color(METAL.ironDark, 0.05, r);
  blob(b, cx, top + 0.18, cz, 0.022, 2, 4, null, 0);

  const target = glow || b;
  target.color(BUILD.lanternGlow, 0.05, r);
  box(target, cx, top - 0.16, cz, S * 1.75, 0.26, S * 1.75);
  target.color(BUILD.fireHot, 0.04, r);
  blob(target, cx, top - 0.19, cz, 0.045, 2, 5, (x, y2) => [1, 1.5, 1], 0);

  return { light: { x: cx, y: top - 0.16, z: cz, c: BUILD.lanternGlow, i: 1.0 } };
}

/** A fire: a ring of stones, logs, flames and an ember glow. */
export function buildFirePit(b, { seed = 1, r: R = 0.6, glow = null, cauldron = false } = {}) {
  const r = makeRng(seed ^ 0xf17e);
  const n = r.int(8, 13);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + r.range(-0.2, 0.2);
    b.color(r.chance(0.5) ? BUILD.stoneDark : BUILD.stone, 0.08, r);
    blob(b, Math.cos(a) * R, r.range(0.05, 0.13), Math.sin(a) * R,
      r.range(0.11, 0.21), 3, 5, lumpWarp(r, 3, 0.35), 0);
  }
  b.color(0x241c16, 0.06, r);
  { const m = b.mark; lathe(b, [[R * 0.85, 0.01], [0.001, 0.02]], 10); b.orientOutward(m, 0, -1, 0); }
  // charred logs leaning into the middle
  for (let i = 0; i < r.int(3, 5); i++) {
    const a = r.range(0, TAU);
    b.color(mixHex(BARK.charred, BARK.oak, r() * 0.5), 0.09, r);
    tube(b, {
      pts: [[Math.cos(a) * R * 0.85, 0.06, Math.sin(a) * R * 0.85], [Math.cos(a) * R * 0.1, 0.22, Math.sin(a) * R * 0.1]],
      radius: t => 0.055 * (1 - t * 0.3), radial: 4, capStart: true, capEnd: true, sway: () => 0,
    });
  }
  const target = glow || b;
  target.color(BUILD.ember, 0.1, r);
  { const m = target.mark; lathe(target, [[R * 0.55, 0.05], [0.001, 0.09]], 8); target.orientOutward(m, 0, -1, 0); }
  for (let i = 0; i < 5; i++) {
    const a = r.range(0, TAU), rr = r.range(0, R * 0.4);
    target.color(i % 2 ? BUILD.fire : BUILD.fireHot, 0.08, r);
    blob(target, Math.cos(a) * rr, r.range(0.12, 0.42), Math.sin(a) * rr,
      r.range(0.07, 0.17), 3, 5, (x, y) => [1, 2.6, 1], 0.4);
  }

  if (cauldron) {
    b.color(METAL.iron, 0.05, r);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      beam(b, Math.cos(a) * R * 0.8, 0.05, Math.sin(a) * R * 0.8, 0, 1.15, 0, 0.035, 0.035, [0, 1, 0]);
    }
    b.color(METAL.ironDark, 0.05, r);
    lathe(b, [[0.001, 0.52], [0.30, 0.60], [0.34, 0.86], [0.31, 0.88], [0.27, 0.62]], 10);
  }

  return { light: { x: 0, y: 0.35, z: 0, c: BUILD.fire, i: 1.6, flicker: true } };
}

/* ========================================================================= */
/* FURNITURE AND CONTAINERS                                                  */
/* ========================================================================= */

export function buildBench(b, { seed = 1, len = 1.7 } = {}) {
  const r = makeRng(seed ^ 0xbe1c);
  const hex = mixHex(BUILD.plank, BUILD.plankOld, r());
  b.color(hex, 0.07, r);
  box(b, 0, 0.44, 0, len, 0.08, 0.38);
  for (const s of [-1, 1]) {
    b.color(shade(hex, -0.1), 0.05, r);
    box(b, s * (len / 2 - 0.16), 0.21, 0, 0.11, 0.42, 0.34);
  }
  if (r.chance(0.5)) {
    b.color(hex, 0.07, r);
    box(b, 0, 0.74, -0.16, len, 0.11, 0.06);
    for (const s of [-1, 1]) box(b, s * (len / 2 - 0.16), 0.60, -0.16, 0.08, 0.34, 0.07);
  }
  if (r.chance(0.4)) {
    b.color(mixHex(MOSS.deep, MOSS.mid, r()), 0.09, r);
    for (let i = 0; i < 4; i++) {
      blob(b, r.range(-len / 2, len / 2), 0.05, r.range(-0.18, 0.18), r.range(0.03, 0.07), 2, 4, null, 0);
    }
  }
}

export function buildBarrel(b, { seed = 1, h = 0.8, R = 0.28, open = false } = {}) {
  const r = makeRng(seed ^ 0xba44);
  const hex = mixHex(BUILD.plank, BUILD.plankOld, r());
  b.color(hex, 0.07, r);
  const bulge = R * 1.16;
  lathe(b, [[R * 0.86, 0], [bulge, h * 0.35], [bulge, h * 0.65], [R * 0.86, h]], 11);
  if (!open) { b.color(shade(hex, -0.08), 0.05, r); lathe(b, [[0.001, h + 0.01], [R * 0.86, h]], 11); }
  else {
    b.color(0x2a2620, 0.04, r); lathe(b, [[0.001, h * 0.25], [R * 0.82, h * 0.22]], 10);
  }
  b.color(METAL.iron, 0.05, r);
  for (const t of [0.1, 0.5, 0.9]) {
    const rr = lerp(R * 0.86, bulge, Math.sin(t * Math.PI));
    lathe(b, [[rr * 1.02, h * t - 0.025], [rr * 1.03, h * t + 0.025]], 11);
  }
}

export function buildCrate(b, { seed = 1, s = 0.5 } = {}) {
  const r = makeRng(seed ^ 0xc4a7);
  const hex = mixHex(BUILD.plank, BUILD.plankPale, r());
  b.color(hex, 0.07, r);
  box(b, 0, s / 2, 0, s, s, s * r.range(0.85, 1.15));
  b.color(shade(hex, -0.18), 0.05, r);
  for (const [ax, az] of [[1, 0], [0, 1]]) {
    for (const sg of [-1, 1]) {
      box(b, ax * sg * s * 0.5, s * 0.22, az * sg * s * 0.5, ax ? 0.03 : s * 0.96, 0.05, az ? 0.03 : s * 0.96);
      box(b, ax * sg * s * 0.5, s * 0.78, az * sg * s * 0.5, ax ? 0.03 : s * 0.96, 0.05, az ? 0.03 : s * 0.96);
    }
  }
}

export function buildSack(b, { seed = 1, s = 0.42 } = {}) {
  const r = makeRng(seed ^ 0x5ac4);
  b.color(mixHex(BUILD.cloth, 0xbfae8a, r()), 0.07, r);
  const lumpy = lumpWarp(r, 3, 0.25);
  blob(b, 0, s * 0.55, 0, s, 4, 7,
    (x, y, z) => { const m = lumpy(x, y, z); return [m * 0.85, m * (y > 0.4 ? 0.8 : 1.05), m * 0.85]; }, 0);
  b.color(BUILD.rope, 0.06, r);
  lathe(b, [[s * 0.30, s * 1.16], [s * 0.26, s * 1.22]], 7);
  b.color(mixHex(BUILD.cloth, 0xbfae8a, r()), 0.07, r);
  lathe(b, [[s * 0.28, s * 1.2], [s * 0.34, s * 1.42], [0.001, s * 1.46]], 7);
}

/** A stack of split firewood. Nothing says "winter is coming" like this. */
export function buildWoodpile(b, { seed = 1, w = 1.8, h = 1.1, d = 0.7, neat = 0.7 } = {}) {
  const r = makeRng(seed ^ 0x0d51);
  const logR = 0.075;
  const rows = Math.max(2, Math.round(h / (logR * 2.1)));
  const cols = Math.max(2, Math.round(w / (logR * 2.1)));
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (r.chance(0.06)) continue;
      const jitter = (1 - neat) * 0.4;
      const x = lerp(-w / 2 + logR, w / 2 - logR, cols === 1 ? 0.5 : i / (cols - 1)) + r.range(-jitter, jitter) * logR * 2;
      const y = logR + j * logR * 2.02 + r.range(-jitter, jitter) * logR;
      const len = d * r.range(0.85, 1.05);
      const hex = mixHex(BARK.oak, BARK.hazel, r());
      b.color(hex, 0.09, r);
      const sub = new MeshBuilder();
      sub.curColor = b.curColor;
      cylinder(sub, 0, 0, -len / 2, len / 2, logR * r.range(0.8, 1.1), logR * r.range(0.8, 1.1), 6);
      // the split face, paler
      sub.color(mixHex(0xc4a878, hex, 0.3), 0.07, r);
      lathe(sub, [[0.001, len / 2 + 0.005], [logR * 0.9, len / 2]], 6);
      b.append(sub, new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, 0),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, r.range(-0.06, 0.06) * (1 - neat), 0)),
        new THREE.Vector3(1, 1, 1)));
    }
  }
}

/* ========================================================================= */
/* MARKET                                                                    */
/* ========================================================================= */

/** A market stall: trestle, goods, and a striped awning that catches the wind. */
/**
 * THE FISHING BOOTH.
 *
 * Every fisherman in the game stands behind one of these. It exists so the
 * player can find them: a fisherman who wanders the village is a fisherman
 * you have to hunt for with a full creel, and the whole economy runs through
 * these people. The booth says "sell here" from across the water.
 *
 * Built from the waterside up — plank counter on driftwood posts, a slatted
 * roof, crates of the day's catch, a rack of rods for sale, a barrel, a net
 * hung to dry and a lantern for the night shift. `tone` shifts the timber
 * and cloth so a booth in a snow village is not the booth in a swamp.
 */
export function buildFishStall(b, { seed = 1, w = 2.9, d = 1.7, tone = null, glow = null } = {}) {
  const r = makeRng(seed ^ 0x5f15);
  const h = 0.86;
  const T = tone || {};
  const timber = T.timber ?? BUILD.plankOld;
  const post = T.post ?? BARK.oak;
  const cloth = T.cloth ?? BUILD.clothBlue;
  const blockers = [];

  /* --- the counter ------------------------------------------------------ */
  b.color(timber, 0.08, r);
  box(b, 0, h, 0, w, 0.09, d);
  // planked top, so it reads as boards and not as a slab
  const nb = Math.max(4, Math.round(w / 0.28));
  for (let i = 0; i < nb; i++) {
    b.color(tweak(timber, { l: r.range(0.86, 1.14) }), 0.05, r);
    box(b, lerp(-w / 2, w / 2, (i + 0.5) / nb), h + 0.05, 0, (w / nb) * 0.9, 0.03, d * 0.98);
  }
  b.color(post, 0.07, r);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    beam(b, sx * (w / 2 - 0.13), -0.1, sz * (d / 2 - 0.13),
      sx * (w / 2 - 0.16), h - 0.03, sz * (d / 2 - 0.16), 0.09, 0.09, [0, 1, 0]);
  }
  // a front board with a painted fish on it
  b.color(tweak(timber, { l: 0.88 }), 0.05, r);
  box(b, 0, h * 0.52, d / 2 + 0.02, w * 0.96, h * 0.72, 0.05);
  b.color(T.sign ?? 0xd8c088, 0.05, r);
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    blob(b, lerp(-w * 0.16, w * 0.16, t), h * 0.52, d / 2 + 0.055,
      0.055 * Math.sin(t * Math.PI) + 0.02, 2, 5, (x, y, z) => [1, 1, 0.35]);
  }
  blob(b, w * 0.20, h * 0.52, d / 2 + 0.055, 0.05, 2, 4, (x, y, z) => [1.6, 1.1, 0.35]);

  /* --- the roof: four posts and slats, not cloth. It has to survive rain. */
  const ah = 2.15;
  b.color(post, 0.07, r);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    beam(b, sx * w / 2, 0, sz * d / 2, sx * w / 2, ah - (sz > 0 ? 0.22 : 0), sz * d / 2, 0.07, 0.07, [0, 1, 0]);
  }
  beam(b, -w / 2, ah, -d / 2, w / 2, ah, -d / 2, 0.07, 0.09, [0, 1, 0]);
  beam(b, -w / 2, ah - 0.22, d / 2, w / 2, ah - 0.22, d / 2, 0.07, 0.09, [0, 1, 0]);
  const slats = Math.max(5, Math.round(w / 0.22));
  for (let i = 0; i < slats; i++) {
    b.color(tweak(T.roof ?? BUILD.plank, { l: r.range(0.82, 1.16) }), 0.05, r);
    const x = lerp(-w / 2 - 0.1, w / 2 + 0.1, (i + 0.5) / slats);
    hexa(b, [
      [x - w / slats * 0.42, ah, -d / 2 - 0.14], [x + w / slats * 0.42, ah, -d / 2 - 0.14],
      [x + w / slats * 0.42, ah + 0.05, -d / 2 - 0.14], [x - w / slats * 0.42, ah + 0.05, -d / 2 - 0.14],
      [x - w / slats * 0.42, ah - 0.22, d / 2 + 0.20], [x + w / slats * 0.42, ah - 0.22, d / 2 + 0.20],
      [x + w / slats * 0.42, ah - 0.17, d / 2 + 0.20], [x - w / slats * 0.42, ah - 0.17, d / 2 + 0.20],
    ]);
  }
  // a valance of cloth along the front edge
  b.color(cloth, 0.05, r);
  const vc = 9;
  for (let i = 0; i < vc; i++) {
    const x0 = lerp(-w / 2 - 0.08, w / 2 + 0.08, i / vc);
    const x1 = lerp(-w / 2 - 0.08, w / 2 + 0.08, (i + 1) / vc);
    const dip = 0.10 + (i % 2) * 0.05;
    sheet(b, [x0, ah - 0.22, d / 2 + 0.20], [x1, ah - 0.22, d / 2 + 0.20],
      [x1, ah - 0.22 - dip, d / 2 + 0.16], [x0, ah - 0.22 - dip, d / 2 + 0.16], 0.014);
  }

  /* --- the day's catch, in crates on the counter ------------------------ */
  for (const sx of [-1, 1]) {
    const cx = sx * w * 0.30;
    b.color(BUILD.plank, 0.07, r);
    box(b, cx, h + 0.16, -d * 0.06, 0.52, 0.20, 0.42);
    b.color(tweak(BUILD.plank, { l: 0.8 }), 0.05, r);
    box(b, cx, h + 0.27, -d * 0.06, 0.54, 0.03, 0.44);
    // silver backs just showing over the rim
    for (let i = 0; i < 4; i++) {
      b.color(mixHex(0x9aa8b0, 0xd8e0e4, r()), 0.07, r);
      const a = r.range(-0.5, 0.5);
      tube(b, {
        pts: [[cx - 0.18 + i * 0.11, h + 0.28, -d * 0.06 - 0.12 + r.range(-0.05, 0.05)],
        [cx - 0.12 + i * 0.11 + Math.sin(a) * 0.1, h + 0.30, -d * 0.06 + 0.12]],
        radius: t => 0.035 * Math.sin(Math.max(0.05, t) * Math.PI) + 0.012, radial: 5,
        capStart: true, capEnd: true, sway: () => 0,
      });
    }
  }
  /* THE COUNTER BLOCKS, THE FRONT DOES NOT.
     One disc over the whole booth walled off the side the customer stands
     on. These are three small discs along the counter line, set back, so
     the player can walk right up to it and cannot walk through it. */
  for (const t of [-0.34, 0, 0.34]) {
    blockers.push({ x: w * t, z: -d * 0.12, r: w * 0.24 });
  }

  /* --- a rack of rods for sale, standing at the end --------------------- */
  {
    const rx = -w / 2 - 0.34;
    b.color(post, 0.06, r);
    beam(b, rx, 0, -0.3, rx, 1.35, -0.3, 0.06, 0.06, [0, 1, 0]);
    beam(b, rx, 0, 0.3, rx, 1.35, 0.3, 0.06, 0.06, [0, 1, 0]);
    beam(b, rx, 1.3, -0.3, rx, 1.3, 0.3, 0.05, 0.05, [0, 1, 0]);
    for (let i = 0; i < 4; i++) {
      const z = lerp(-0.24, 0.24, i / 3);
      b.color(mixHex(BARK.hazel, BARK.ash, r()), 0.08, r);
      tube(b, {
        pts: [[rx + 0.04, 0.05, z], [rx - 0.10, 0.9, z], [rx - 0.20, 1.72, z]],
        radius: t => 0.020 * (1 - t * 0.65), radial: 5, capStart: true, capEnd: true, sway: () => 0,
      });
      b.color(BUILD.rope, 0.05, r);
      blob(b, rx - 0.06, 0.62, z, 0.032, 2, 5);
    }
    blockers.push({ x: rx, z: 0, r: 0.28, low: true });
  }

  /* --- a barrel, a net and a lantern ------------------------------------ */
  {
    const bx = w / 2 + 0.38;
    b.color(BUILD.plank, 0.07, r);
    lathe(b, [[0.20, 0], [0.26, 0.2], [0.26, 0.5], [0.21, 0.72], [0.19, 0.74]], 10, bx, 0.28);
    b.color(METAL.iron, 0.05, r);
    for (const y of [0.16, 0.56]) lathe(b, [[0.268, y], [0.268, y + 0.05]], 10, bx, 0.28);
    blockers.push({ x: bx, z: 0.28, r: 0.28, low: true });

    // a net hung from the back rail to dry
    b.color(T.net ?? 0xbfb48c, 0.06, r);
    for (let i = 0; i <= 8; i++) {
      const x = lerp(-w * 0.34, w * 0.34, i / 8);
      tube(b, {
        pts: [[x, ah - 0.06, -d / 2 - 0.02], [x * 0.94, ah - 0.55 - Math.sin(i / 8 * Math.PI) * 0.22, -d / 2 - 0.10]],
        radius: () => 0.008, radial: 3, capStart: false, capEnd: false, sway: () => 0,
      });
    }
    for (let j = 1; j <= 3; j++) {
      const y = ah - 0.06 - j * 0.16;
      tube(b, {
        pts: [[-w * 0.34, y - Math.sin(j / 4 * Math.PI) * 0.05, -d / 2 - 0.05],
        [0, y - 0.10, -d / 2 - 0.09], [w * 0.34, y - Math.sin(j / 4 * Math.PI) * 0.05, -d / 2 - 0.05]],
        radius: () => 0.007, radial: 3, capStart: false, capEnd: false, sway: () => 0,
      });
    }
  }
  {
    const L = buildLantern(b, { seed: r.seed(), kind: 'hang', h: ah - 0.12, glow });
    // buildLantern draws at the origin; shift it to the corner post
    void L;
  }

  return {
    blockers,
    /* where the fisherman stands, and where the player stands to talk */
    standAt: [0, -d / 2 - 0.55],
    talkAt: [0, d / 2 + 0.95],
    counterY: h + 0.06,
    light: { x: 0, y: ah - 0.30, z: 0, c: BUILD.lanternGlow, i: 1.2 },
  };
}
export function buildStall(b, { seed = 1, w = 2.6, d = 1.5, goods = 'produce' } = {}) {
  const r = makeRng(seed ^ 0x5741);
  const h = 0.92;

  b.color(BUILD.plankOld, 0.07, r);
  box(b, 0, h, 0, w, 0.08, d);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      beam(b, sx * (w / 2 - 0.15), 0, sz * (d / 2 - 0.15),
        sx * (w / 2 - 0.22), h - 0.04, sz * (d / 2 - 0.2), 0.08, 0.08, [0, 1, 0]);
    }
  }
  // a cloth skirt at the front
  b.color(r.pick([BUILD.clothRed, BUILD.clothBlue, BUILD.clothGreen, BUILD.clothCream]), 0.05, r);
  sheet(b, [-w / 2, h - 0.04, d / 2], [w / 2, h - 0.04, d / 2], [w / 2, 0.06, d / 2 + 0.03], [-w / 2, 0.06, d / 2 + 0.03]);

  /* the awning: four poles and a striped, sagging cloth */
  const ah = 2.25;
  b.color(BARK.hazel, 0.07, r);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      beam(b, sx * w / 2, 0, sz * d / 2, sx * w / 2, ah - (sz > 0 ? 0.25 : 0), sz * d / 2, 0.06, 0.06, [0, 1, 0]);
    }
  }
  const stripeA = r.pick([BUILD.clothRed, BUILD.clothBlue, BUILD.clothGreen, BUILD.clothGold]);
  const stripeB = BUILD.clothCream;
  const cols = 8, rows = 3;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const u0 = i / cols, u1 = (i + 1) / cols, v0 = j / rows, v1 = (j + 1) / rows;
      const yAt = (u, v) => ah - v * 0.25 - Math.sin(u * Math.PI) * 0.13 - Math.sin(v * Math.PI) * 0.06;
      b.color(i % 2 ? stripeA : stripeB, 0.04, r);
      const p = [
        [lerp(-w / 2, w / 2, u0) * 1.08, yAt(u0, v0), lerp(-d / 2, d / 2, v0) * 1.35],
        [lerp(-w / 2, w / 2, u1) * 1.08, yAt(u1, v0), lerp(-d / 2, d / 2, v0) * 1.35],
        [lerp(-w / 2, w / 2, u1) * 1.08, yAt(u1, v1), lerp(-d / 2, d / 2, v1) * 1.35],
        [lerp(-w / 2, w / 2, u0) * 1.08, yAt(u0, v1), lerp(-d / 2, d / 2, v1) * 1.35],
      ];
      sheet(b, p[0], p[1], p[2], p[3], 0.018);
    }
  }

  /* the goods on the table */
  const top = h + 0.04;
  if (goods === 'produce') {
    for (let i = 0; i < r.int(4, 8); i++) {
      const x = r.range(-w * 0.4, w * 0.4), z = r.range(-d * 0.28, d * 0.28);
      const hex = r.pick([0xc4402c, 0xd28a2a, 0x7a9a3a, 0xb8703a, 0x9a5a7a, 0xd2b44a]);
      const n = r.int(3, 7);
      for (let k = 0; k < n; k++) {
        b.color(hex, 0.12, r);
        const a = r.range(0, TAU), rr = r.range(0, 0.1);
        blob(b, x + Math.cos(a) * rr, top + 0.045 + (k > 3 ? 0.06 : 0), z + Math.sin(a) * rr,
          r.range(0.035, 0.065), 3, 5, lumpWarp(r, 2, 0.2), 0);
      }
    }
  } else if (goods === 'bread') {
    for (let i = 0; i < r.int(5, 10); i++) {
      b.color(mixHex(0xbf8f4a, 0xd8b06a, r()), 0.09, r);
      blob(b, r.range(-w * 0.42, w * 0.42), top + 0.05, r.range(-d * 0.25, d * 0.25),
        r.range(0.07, 0.12), 3, 6, (x, y, z) => [1.35, 0.62, 0.85], 0);
    }
  } else if (goods === 'cloth') {
    for (let i = 0; i < r.int(3, 6); i++) {
      b.color(r.pick([BUILD.clothRed, BUILD.clothBlue, BUILD.clothGreen, BUILD.clothGold, BUILD.clothCream]), 0.07, r);
      box(b, r.range(-w * 0.38, w * 0.38), top + 0.05, r.range(-d * 0.2, d * 0.2),
        r.range(0.22, 0.4), 0.09, r.range(0.2, 0.35));
    }
  } else if (goods === 'pots') {
    for (let i = 0; i < r.int(4, 8); i++) {
      const x = r.range(-w * 0.4, w * 0.4), z = r.range(-d * 0.25, d * 0.25);
      const s = r.range(0.7, 1.3);
      b.color(mixHex(BUILD.tileClay, 0x8a5a3a, r()), 0.08, r);
      lathe(b, [[0.06 * s, top], [0.11 * s, top + 0.09 * s], [0.085 * s, top + 0.17 * s], [0.10 * s, top + 0.19 * s]], 8, x, z);
    }
  }

  return { blockers: [{ x: 0, z: 0, r: Math.max(w, d) * 0.45 }] };
}

/** A hand cart, usually tipped up on its shafts. */
export function buildCart(b, { seed = 1, loaded = true } = {}) {
  const r = makeRng(seed ^ 0xca27);
  const w = 1.1, len = 1.7, bedY = 0.62;
  b.color(BUILD.plankOld, 0.07, r);
  box(b, 0, bedY, 0, w, 0.07, len);
  for (const s of [-1, 1]) box(b, s * w / 2, bedY + 0.16, 0, 0.05, 0.3, len);
  box(b, 0, bedY + 0.16, -len / 2, w, 0.3, 0.05);
  // shafts
  b.color(BARK.oak, 0.06, r);
  for (const s of [-1, 1]) {
    beam(b, s * w * 0.35, bedY - 0.02, len / 2, s * w * 0.4, bedY + 0.22, len / 2 + 1.1, 0.06, 0.06, [0, 1, 0]);
  }
  // wheels
  for (const s of [-1, 1]) {
    const sub = new MeshBuilder();
    const R = 0.42;
    sub.color(BUILD.plankOld, 0.06, r);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      beam(sub, 0, 0, 0, Math.sin(a) * R, Math.cos(a) * R, 0, 0.045, 0.05, [0, 0, 1]);
    }
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU, a2 = ((i + 1) / 16) * TAU;
      sub.color(i % 2 ? BUILD.plankOld : METAL.ironRust, 0.06, r);
      beam(sub, Math.sin(a) * R, Math.cos(a) * R, 0, Math.sin(a2) * R, Math.cos(a2) * R, 0, 0.05, 0.08, [0, 0, 1]);
    }
    sub.color(METAL.ironDark, 0.05, r);
    cylinder(sub, 0, 0, -0.05, 0.05, 0.06, 0.06, 6);
    b.append(sub, new THREE.Matrix4().compose(
      new THREE.Vector3(s * (w / 2 + 0.07), 0.42, 0),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2),
      new THREE.Vector3(1, 1, 1)));
  }
  if (loaded) {
    const what = r.int(0, 2);
    for (let i = 0; i < r.int(3, 6); i++) {
      const sub = new MeshBuilder();
      if (what === 0) buildSack(sub, { seed: seed + i * 11, s: r.range(0.16, 0.24) });
      else if (what === 1) buildCrate(sub, { seed: seed + i * 11, s: r.range(0.22, 0.34) });
      else buildBarrel(sub, { seed: seed + i * 11, h: 0.4, R: 0.15 });
      b.append(sub, mat(r.range(-w * 0.25, w * 0.25), bedY + 0.04, r.range(-len * 0.3, len * 0.3), r.range(0, TAU)));
    }
  }
  return { blockers: [{ x: 0, z: 0, r: 1.0 }] };
}

/* ========================================================================= */
/* SIGNS                                                                     */
/* ========================================================================= */

/**
 * A hanging or standing wooden sign. The "writing" is a carved pictogram in
 * a darker wood, because real readable text would need a texture and a
 * pictogram is what a medieval shop sign actually was.
 */
export function buildSign(b, { seed = 1, kind = 'hanging', glyph = 'stick', h = 2.2, w = 0.8 } = {}) {
  const r = makeRng(seed ^ 0x516e);
  const boardY = kind === 'hanging' ? h - 0.55 : h - 0.35;

  if (kind === 'hanging') {
    b.color(BARK.oak, 0.06, r);
    beam(b, 0, 0, 0, 0, h, 0, 0.11, 0.11, [0, 1, 0]);
    beam(b, 0, h - 0.05, 0, 0, h - 0.05, w * 0.85, 0.09, 0.09, [0, 1, 0]);
    beam(b, 0, h - 0.45, 0, 0, h - 0.06, w * 0.45, 0.06, 0.06, [0, 0, 1]);
    b.color(METAL.iron, 0.05, r);
    for (const s of [-1, 1]) {
      tube(b, {
        pts: [[s * w * 0.3, h - 0.06, w * 0.8], [s * w * 0.3, boardY + 0.24, w * 0.8]],
        radius: () => 0.012, radial: 3, capStart: false, capEnd: false, sway: () => 0,
      });
    }
  } else {
    b.color(mixHex(BARK.oak, BUILD.plankOld, r()), 0.07, r);
    for (const s of [-1, 1]) beam(b, s * w * 0.42, 0, 0, s * w * 0.42, boardY + 0.3, 0, 0.07, 0.07, [0, 1, 0]);
  }

  /* the board */
  const cz = kind === 'hanging' ? w * 0.8 : 0;
  const hex = mixHex(BUILD.plank, BUILD.plankOld, r());
  b.color(hex, 0.06, r);
  box(b, 0, boardY, cz, w, 0.48, 0.05);
  b.color(shade(hex, -0.2), 0.04, r);
  box(b, 0, boardY, cz + 0.026, w * 0.95, 0.43, 0.01);
  b.color(mixHex(hex, 0x3a2c1e, 0.75), 0.04, r);
  drawGlyph(b, glyph, 0, boardY, cz + 0.034, Math.min(w * 0.7, 0.36));

  return { blockers: [{ x: 0, z: 0, r: 0.25 }] };
}

/** Carved pictograms. Blocky on purpose — they are cut with a chisel. */
function drawGlyph(b, glyph, cx, cy, cz, s) {
  const bar = (x, y, w, h) => box(b, cx + x * s, cy + y * s, cz, w * s, h * s, 0.012);
  switch (glyph) {
    case 'stick':                       // a branch with a fork
      bar(-0.1, 0, 0.75, 0.10);
      bar(0.28, 0.16, 0.30, 0.08);
      bar(0.28, -0.16, 0.30, 0.08);
      break;
    case 'hammer':
      bar(0, -0.12, 0.10, 0.55);
      bar(0, 0.22, 0.55, 0.20);
      break;
    case 'loaf':
      bar(0, 0, 0.66, 0.28);
      bar(0, 0.16, 0.50, 0.12);
      break;
    case 'jug':
      bar(0, -0.05, 0.36, 0.48);
      bar(0.26, 0.02, 0.14, 0.24);
      bar(0, 0.26, 0.18, 0.14);
      break;
    case 'leaf':
      bar(0, 0, 0.44, 0.24);
      bar(0, -0.2, 0.06, 0.2);
      break;
    case 'boot':
      bar(-0.05, 0.06, 0.24, 0.5);
      bar(0.1, -0.18, 0.55, 0.16);
      break;
    case 'fish':
      bar(-0.04, 0, 0.55, 0.26);
      bar(0.32, 0, 0.2, 0.42);
      break;
    case 'arrow':
      bar(0, 0, 0.7, 0.08);
      bar(0.28, 0, 0.18, 0.26);
      break;
    case 'home':
      bar(0, -0.12, 0.6, 0.34);
      bar(0, 0.16, 0.7, 0.10);
      break;
    default:
      bar(0, 0, 0.5, 0.12);
  }
}

/* ========================================================================= */
/* GARDEN AND FARM                                                           */
/* ========================================================================= */

/** A raised bed of vegetables. */
export function buildVegBed(b, { seed = 1, w = 2.2, d = 1.3, crop = 'cabbage' } = {}) {
  const r = makeRng(seed ^ 0x7e94);
  b.color(BUILD.plankOld, 0.07, r);
  for (const [ax, az] of [[1, 0], [0, 1]]) {
    for (const s of [-1, 1]) {
      box(b, ax * s * w / 2, 0.11, az * s * d / 2, ax ? 0.06 : w, 0.22, az ? 0.06 : d);
    }
  }
  b.color(GROUND.farmSoil, 0.06, r);
  box(b, 0, 0.09, 0, w - 0.1, 0.17, d - 0.1);

  const rows = Math.max(2, Math.round(d / 0.42));
  const cols = Math.max(2, Math.round(w / 0.42));
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (r.chance(0.12)) continue;
      const x = lerp(-w / 2 + 0.25, w / 2 - 0.25, cols === 1 ? 0.5 : i / (cols - 1));
      const z = lerp(-d / 2 + 0.25, d / 2 - 0.25, rows === 1 ? 0.5 : j / (rows - 1));
      const y = 0.18;
      if (crop === 'cabbage') {
        b.color(mixHex(0x7a9a4a, 0x5f8a3a, r()), 0.09, r);
        blob(b, x, y + 0.09, z, r.range(0.10, 0.16), 3, 6, lumpWarp(r, 3, 0.3), 0.2);
      } else if (crop === 'carrot') {
        b.color(0x4e7a2e, 0.1, r);
        for (let k = 0; k < 5; k++) {
          const sub = new MeshBuilder();
          sub.curColor = b.curColor;
          blade(sub, { len: r.range(0.14, 0.24), wid: 0.03, segs: 2, curl: 0.5, cup: 0.3, swayBase: 0.2, swayTip: 1 });
          b.append(sub, orient([x, y, z], [r.bell() * 0.6, 1, r.bell() * 0.6], r.range(0, TAU)));
        }
      } else if (crop === 'bean') {
        // a wigwam of canes with beans climbing it
        b.color(BARK.hazel, 0.08, r);
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * TAU;
          beam(b, x + Math.cos(a) * 0.14, y, z + Math.sin(a) * 0.14, x, y + 0.85, z, 0.015, 0.015, [0, 1, 0]);
        }
        b.color(0x4a7a2e, 0.1, r);
        for (let k = 0; k < 7; k++) {
          const a = r.range(0, TAU), t = r.range(0.2, 0.95);
          blob(b, x + Math.cos(a) * 0.12 * (1 - t), y + 0.85 * t, z + Math.sin(a) * 0.12 * (1 - t),
            r.range(0.04, 0.07), 2, 5, null, 0.4 + t * 0.5);
        }
      } else {
        b.color(mixHex(PLANT.fern, 0x8a9a4a, r()), 0.1, r);
        for (let k = 0; k < 4; k++) {
          const sub = new MeshBuilder();
          sub.curColor = b.curColor;
          blade(sub, { len: r.range(0.1, 0.2), wid: 0.05, segs: 1, curl: 0.4, cup: 0.3, swayBase: 0.2, swayTip: 0.9 });
          b.append(sub, orient([x, y, z], [r.bell() * 0.8, 1, r.bell() * 0.8], r.range(0, TAU)));
        }
      }
    }
  }
}

/** A haystack. Round, thatched on top, roped down. */
export function buildHaystack(b, { seed = 1, R = 1.2, h = 1.9 } = {}) {
  const r = makeRng(seed ^ 0x4a45);
  const hex = mixHex(BUILD.thatch, BUILD.thatchOld, r() * 0.6);
  b.color(hex, 0.06, r);
  lathe(b, [
    [R * 0.9, 0], [R, h * 0.3], [R * 0.95, h * 0.62], [R * 0.6, h * 0.85], [0.001, h],
  ], 12, 0, 0, 0, t => shade(hex, (0.5 - t) * 0.22));
  // straw texture: a scatter of little tufts round the flanks
  for (let i = 0; i < 28; i++) {
    const a = r.range(0, TAU), t = r.range(0.05, 0.8);
    const rr = lerp(R * 0.9, R * 0.6, t);
    b.color(tweak(hex, { l: r.range(0.8, 1.2) }), 0.08, r);
    blob(b, Math.cos(a) * rr, h * t, Math.sin(a) * rr, r.range(0.05, 0.12), 2, 4, null, 0.1);
  }
  b.color(BUILD.rope, 0.05, r);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI;
    const pts = [];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      const ang = a;
      const u = t * Math.PI;
      pts.push([Math.cos(ang) * Math.cos(u - Math.PI / 2) * R * 0.98, h * (0.08 + t * 0.84), Math.sin(ang) * Math.cos(u - Math.PI / 2) * R * 0.98]);
    }
    tube(b, { pts, radius: () => 0.015, radial: 3, capStart: false, capEnd: false, sway: () => 0 });
  }
  return { blockers: [{ x: 0, z: 0, r: R }] };
}

/** A scarecrow: two sticks, a sack head, and somebody's old coat. */
export function buildScarecrow(b, { seed = 1, h = 1.8 } = {}) {
  const r = makeRng(seed ^ 0x5ca2);
  b.color(BARK.hazel, 0.08, r);
  beam(b, 0, 0, 0, r.range(-0.06, 0.06), h, r.range(-0.06, 0.06), 0.06, 0.06, [0, 1, 0]);
  const armY = h * 0.72, armL = 0.62;
  beam(b, -armL, armY + r.range(-0.06, 0.06), 0, armL, armY, 0, 0.05, 0.05, [0, 1, 0]);
  b.color(r.pick([BUILD.clothRed, BUILD.clothBlue, BUILD.clothGreen, BUILD.cloth]), 0.07, r);
  // a coat: a flat-ish sheet draped over the crossbar
  const cw = armL * 2, ch = 0.75;
  for (let i = 0; i < 5; i++) {
    const u0 = i / 5, u1 = (i + 1) / 5;
    const x0 = lerp(-cw / 2, cw / 2, u0), x1 = lerp(-cw / 2, cw / 2, u1);
    const sagA = Math.sin(u0 * Math.PI) * 0.1, sagB = Math.sin(u1 * Math.PI) * 0.1;
    sheet(b, [x0, armY + 0.06, 0.02], [x1, armY + 0.06, 0.02],
      [x1, armY - ch - sagB, 0.06], [x0, armY - ch - sagA, 0.06], 0.015);
  }
  const sub = new MeshBuilder();
  buildSack(sub, { seed, s: 0.17 });
  b.append(sub, mat(0, h - 0.34, 0, r.range(0, TAU)));
  b.color(BUILD.thatch, 0.07, r);
  lathe(b, [[0.001, h + 0.10], [0.14, h + 0.04], [0.30, h - 0.02], [0.28, h - 0.04]], 8);
  return { blockers: [{ x: 0, z: 0, r: 0.3 }] };
}

/** A washing line strung between two poles. */
export function buildWashingLine(b, { seed = 1, len = 4.5, h = 2.0 } = {}) {
  const r = makeRng(seed ^ 0xa5b1);
  b.color(BARK.hazel, 0.08, r);
  for (const s of [-1, 1]) beam(b, s * len / 2, 0, 0, s * len / 2, h, 0, 0.07, 0.07, [0, 1, 0]);
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push([lerp(-len / 2, len / 2, t), h - Math.sin(t * Math.PI) * 0.22, 0]);
  }
  b.color(BUILD.rope, 0.05, r);
  tube(b, { pts, radius: () => 0.010, radial: 3, capStart: false, capEnd: false, sway: () => 0.1 });

  const n = r.int(3, 7);
  for (let i = 0; i < n; i++) {
    const t = r.range(0.12, 0.88);
    const x = lerp(-len / 2, len / 2, t);
    const y = h - Math.sin(t * Math.PI) * 0.22;
    const cw = r.range(0.30, 0.58), ch = r.range(0.35, 0.75);
    b.color(r.pick([BUILD.clothCream, BUILD.clothRed, BUILD.clothBlue, BUILD.clothGreen, BUILD.cloth]), 0.07, r);
    // hanging cloth, swaying from the top
    const cols = 4, rows = 3;
    for (let a = 0; a < cols; a++) {
      for (let c = 0; c < rows; c++) {
        const u0 = a / cols, u1 = (a + 1) / cols, v0 = c / rows, v1 = (c + 1) / rows;
        const wob = (u, v) => Math.sin(u * 5 + v * 3 + i) * 0.03 * v;
        const P = (u, v) => [x + lerp(-cw / 2, cw / 2, u), y - 0.02 - v * ch, wob(u, v)];
        sheet(b, P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1), 0.01);
        // sway grows toward the bottom of the cloth
        for (let k = b.sway.length - 8; k < b.sway.length; k++) if (k >= 0) b.sway[k] = 0.25 + v1 * 0.6;
      }
    }
  }
  return { blockers: [{ x: -len / 2, z: 0, r: 0.2 }, { x: len / 2, z: 0, r: 0.2 }] };
}

/** Straw skeps on a low bench. */
export function buildBeehives(b, { seed = 1, n = 3 } = {}) {
  const r = makeRng(seed ^ 0xbee5);
  b.color(BUILD.plankOld, 0.07, r);
  box(b, 0, 0.32, 0, n * 0.62 + 0.3, 0.07, 0.6);
  for (const s of [-1, 1]) box(b, s * (n * 0.31 + 0.05), 0.16, 0, 0.08, 0.32, 0.5);
  for (let i = 0; i < n; i++) {
    const x = lerp(-(n - 1) * 0.31, (n - 1) * 0.31, n === 1 ? 0.5 : i / (n - 1));
    const hex = mixHex(BUILD.thatch, BUILD.thatchOld, r() * 0.7);
    b.color(hex, 0.07, r);
    /* ONE solid dome with coil ridges on it, not a stack of separate
       rings: a stack has a gap between every pair of rings and you can see
       the inside of the skep through each one. */
    const prof = [];
    for (let k = 0; k <= 12; k++) {
      const t = k / 12;
      const rr = 0.24 * Math.sqrt(Math.max(0.001, 1 - t * t * 0.985));
      const ridge = 1 + 0.10 * Math.abs(Math.sin(t * Math.PI * 6));
      prof.push([rr * ridge, 0.36 + t * 0.44]);
    }
    lathe(b, prof, 11, x, 0, 0, t => shade(hex, (0.5 - Math.abs(t - 0.5)) * 0.10));
    b.color(0x241c16, 0.04, r);
    box(b, x, 0.42, 0.23, 0.09, 0.035, 0.04);
  }
  return { blockers: [{ x: 0, z: 0, r: n * 0.35 }] };
}

/** A stone trough with water in it. */
export function buildTrough(b, { seed = 1, len = 1.6 } = {}) {
  const r = makeRng(seed ^ 0x77a0);
  b.color(BUILD.stone, 0.07, r);
  box(b, 0, 0.26, 0, len, 0.52, 0.55);
  b.color(0x2a3c3a, 0.04, r);
  box(b, 0, 0.44, 0, len - 0.16, 0.22, 0.4);
  b.color(0x4a7a76, 0.05, r);
  box(b, 0, 0.46, 0, len - 0.2, 0.02, 0.36);
  for (let i = 0; i < 6; i++) {
    b.color(mixHex(MOSS.deep, MOSS.mid, r()), 0.09, r);
    blob(b, r.range(-len / 2, len / 2), r.range(0.03, 0.2), r.range(-0.28, 0.28) * (r.chance(0.5) ? 1 : -1),
      r.range(0.04, 0.09), 2, 5, null, 0);
  }
  return { blockers: [{ x: 0, z: 0, r: Math.max(len, 0.6) * 0.5 }] };
}

/* ========================================================================= */
/* BRIDGE                                                                    */
/* ========================================================================= */

/**
 * A plank bridge over the stream, with handrails and a slight hump. Built
 * from (ax,az) to (bx,bz) at height `y`.
 */
export function buildBridge(b, { ax, az, bx, bz, y, seed = 1, w = 2.0, hump = 0.28, rails = true }) {
  const r = makeRng(seed ^ 0xb21d);
  const len = Math.hypot(bx - ax, bz - az);
  const dx = (bx - ax) / len, dz = (bz - az) / len;
  const px = -dz, pz = dx;
  const steps = Math.max(5, Math.round(len / 0.45));

  const at = (t, off, dy = 0) => [
    ax + dx * len * t + px * off,
    y + Math.sin(t * Math.PI) * hump + dy,
    az + dz * len * t + pz * off,
  ];

  /* the two stringers */
  b.color(BARK.oak, 0.06, r);
  for (const s of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= steps; i++) pts.push(at(i / steps, s * (w / 2 - 0.1), -0.12));
    tube(b, { pts, radius: () => 0.10, radial: 5, capStart: true, capEnd: true, sway: () => 0 });
  }

  /* the deck planks */
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps, t1 = (i + 1) / steps;
    const hex = mixHex(BUILD.plank, BUILD.plankOld, r());
    b.color(hex, 0.09, r);
    const gap = 0.012;
    const p0 = at(t0 + gap, -w / 2), p1 = at(t0 + gap, w / 2);
    const p2 = at(t1 - gap, w / 2), p3 = at(t1 - gap, -w / 2);
    quad(b, p0, p1, p2, p3);
    // the plank's thickness, so the deck has an edge
    const d0 = [p0[0], p0[1] - 0.05, p0[2]], d1 = [p1[0], p1[1] - 0.05, p1[2]];
    const d2 = [p2[0], p2[1] - 0.05, p2[2]], d3 = [p3[0], p3[1] - 0.05, p3[2]];
    b.color(shade(hex, -0.25), 0.05, r);
    quad(b, p1, p0, d0, d1);
    quad(b, p3, p2, d2, d3);
    quad(b, p0, p3, d3, d0);
    quad(b, p2, p1, d1, d2);
  }

  /* handrails */
  if (rails) {
    for (const s of [-1, 1]) {
      const n = Math.max(2, Math.round(len / 1.3));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const p = at(t, s * w / 2);
        b.color(mixHex(BARK.hazel, BUILD.plankOld, r()), 0.08, r);
        beam(b, p[0], p[1], p[2], p[0] + r.range(-0.03, 0.03), p[1] + 0.95, p[2] + r.range(-0.03, 0.03), 0.08, 0.08, [0, 1, 0]);
      }
      const pts = [];
      for (let i = 0; i <= steps; i++) {
        const p = at(i / steps, s * w / 2, 0.92);
        pts.push(p);
      }
      b.color(BUILD.plankOld, 0.07, r);
      tube(b, { pts, radius: () => 0.055, radial: 5, capStart: true, capEnd: true, sway: () => 0 });
      const pts2 = pts.map(p => [p[0], p[1] - 0.42, p[2]]);
      b.color(BARK.hazel, 0.08, r);
      tube(b, { pts: pts2, radius: () => 0.035, radial: 4, capStart: false, capEnd: false, sway: () => 0 });
    }
  }

  /* stone abutments at each end */
  for (const t of [0, 1]) {
    const p = at(t, 0, -0.35);
    for (let i = 0; i < 7; i++) {
      const a = r.range(0, TAU);
      b.color(r.chance(0.5) ? BUILD.stone : BUILD.stoneDark, 0.08, r);
      blob(b, p[0] + Math.cos(a) * w * 0.4, p[1] + r.range(-0.2, 0.25), p[2] + Math.sin(a) * w * 0.4,
        r.range(0.16, 0.30), 3, 5, lumpWarp(r, 3, 0.35), 0);
    }
  }
}

/* ========================================================================= */
/* THE STICKWRIGHT'S BENCH                                                   */
/* ========================================================================= */

/**
 * The workbench, tool wall, shaving horse, weapon rack and heap of branches
 * that make the Stickwright's shop a place somebody actually works.
 */
export function buildWorkbench(b, { seed = 1, w = 2.4, glow = null } = {}) {
  const r = makeRng(seed ^ 0x8e4c);
  const h = 0.88;

  /* the bench */
  b.color(BARK.oak, 0.07, r);
  box(b, 0, h, 0, w, 0.11, 0.8);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      beam(b, sx * (w / 2 - 0.16), 0, sz * 0.3, sx * (w / 2 - 0.16), h - 0.05, sz * 0.3, 0.11, 0.11, [0, 1, 0]);
    }
  }
  beam(b, -w / 2 + 0.16, 0.3, -0.3, w / 2 - 0.16, 0.3, -0.3, 0.07, 0.07, [0, 1, 0]);
  beam(b, -w / 2 + 0.16, 0.3, 0.3, w / 2 - 0.16, 0.3, 0.3, 0.07, 0.07, [0, 1, 0]);

  /* a wooden vice at one end */
  b.color(BUILD.plankOld, 0.06, r);
  box(b, -w / 2 + 0.3, h - 0.14, 0.44, 0.34, 0.26, 0.09);
  b.color(METAL.iron, 0.05, r);
  cylinder(b, -w / 2 + 0.3, 0.46, h - 0.14, h - 0.02, 0.02, 0.02, 5);

  /* tools lying on the bench */
  const tools = r.int(3, 6);
  for (let i = 0; i < tools; i++) {
    const x = r.range(-w * 0.4, w * 0.4), z = r.range(-0.28, 0.28);
    const a = r.range(0, TAU);
    const kind = r.int(0, 3);
    const sub = new MeshBuilder();
    if (kind === 0) {           // a drawknife
      sub.color(METAL.steel, 0.05, r);
      box(sub, 0, 0.012, 0, 0.30, 0.018, 0.05);
      sub.color(BARK.oak, 0.07, r);
      for (const s of [-1, 1]) box(sub, s * 0.19, 0.03, 0, 0.09, 0.05, 0.05);
    } else if (kind === 1) {    // a chisel
      sub.color(BARK.oak, 0.07, r);
      cylinder(sub, 0, 0, 0.008, 0.14, 0.022, 0.016, 6);
      sub.color(METAL.steel, 0.05, r);
      cylinder(sub, 0, 0, 0.14, 0.26, 0.010, 0.012, 5);
    } else if (kind === 2) {    // a mallet
      sub.color(BARK.oak, 0.07, r);
      cylinder(sub, 0, 0, 0.01, 0.26, 0.018, 0.016, 6);
      sub.color(mixHex(BARK.oak, BARK.deadWood, 0.4), 0.06, r);
      box(sub, 0, 0.30, 0, 0.09, 0.16, 0.09);
    } else {                    // wood shavings
      sub.color(mixHex(0xd8bf90, 0xbfa070, r()), 0.10, r);
      for (let k = 0; k < r.int(3, 7); k++) {
        const pts = [];
        for (let m = 0; m <= 5; m++) {
          const t = m / 5;
          pts.push([Math.sin(t * 7) * 0.05, 0.01 + t * 0.02, t * 0.14]);
        }
        const bl = new MeshBuilder();
        bl.curColor = sub.curColor;
        tube(bl, { pts, radius: () => 0.012, radial: 3, squash: () => [1, 0.22], capStart: false, capEnd: false, sway: () => 0 });
        sub.append(bl, mat(r.range(-0.1, 0.1), 0, r.range(-0.1, 0.1), r.range(0, TAU)));
      }
    }
    b.append(sub, mat(x, h + 0.055, z, a));
  }

  /* the tool wall behind: a board with things hanging off it */
  b.color(BUILD.plankOld, 0.06, r);
  box(b, 0, h + 0.75, -0.55, w * 1.1, 1.3, 0.05);
  const hang = r.int(5, 9);
  for (let i = 0; i < hang; i++) {
    const x = lerp(-w * 0.48, w * 0.48, (i + 0.5) / hang) + r.range(-0.05, 0.05);
    const y = h + r.range(0.35, 1.2);
    b.color(METAL.iron, 0.05, r);
    box(b, x, y + 0.06, -0.5, 0.02, 0.10, 0.04);
    const kind = r.int(0, 4);
    if (kind === 0) {
      b.color(METAL.steel, 0.05, r); box(b, x, y - 0.12, -0.5, 0.05, 0.22, 0.02);
      b.color(BARK.oak, 0.07, r); box(b, x, y - 0.30, -0.5, 0.035, 0.16, 0.035);
    } else if (kind === 1) {
      b.color(BUILD.rope, 0.06, r);
      lathe(b, [[0.06, y - 0.02], [0.07, y - 0.1], [0.055, y - 0.16]], 6, x, -0.5);
    } else if (kind === 2) {
      b.color(BARK.hazel, 0.09, r);
      for (let k = 0; k < 5; k++) {
        cylinder(b, x + r.range(-0.04, 0.04), -0.5, y - 0.34, y - 0.01, 0.012, 0.010, 3);
      }
    } else if (kind === 3) {
      b.color(0x4e7a2e, 0.1, r);   // a bunch of drying herbs, hung upside down
      for (let k = 0; k < 6; k++) {
        const sub = new MeshBuilder();
        sub.curColor = b.curColor;
        blade(sub, { len: r.range(0.1, 0.2), wid: 0.025, segs: 2, curl: 0.3, cup: 0.3, swayBase: 0, swayTip: 0.3 });
        b.append(sub, orient([x, y - 0.03, -0.48], [r.bell() * 0.5, -1, r.bell() * 0.5], r.range(0, TAU)));
      }
    } else {
      b.color(METAL.ironRust, 0.06, r);
      cylinder(b, x, -0.5, y - 0.2, y - 0.02, 0.04, 0.05, 6);
    }
  }

  /* the stack of branches waiting to be worked */
  const pile = r.int(7, 14);
  for (let i = 0; i < pile; i++) {
    const a = r.range(-0.5, 0.5);
    const len = r.range(0.8, 1.9);
    b.color(mixHex(BARK.hazel, BARK.oak, r()), 0.10, r);
    tube(b, {
      pts: [[-len / 2, 0.03 + i * 0.045, 0], [len / 2, 0.03 + i * 0.045 + r.range(-0.03, 0.03), 0]],
      radius: t => r.range(0.012, 0.03) * (1 - t * 0.3), radial: 4,
      capStart: true, capEnd: true, sway: () => 0,
    });
  }

  /* wood shavings on the floor — the signature of a wood shop */
  for (let i = 0; i < 24; i++) {
    const a = r.range(0, TAU), rr = r.range(0.3, 1.6);
    b.color(mixHex(0xd8bf90, 0xbfa070, r()), 0.12, r);
    const sub = new MeshBuilder();
    sub.curColor = b.curColor;
    const pts = [];
    for (let m = 0; m <= 4; m++) { const t = m / 4; pts.push([Math.sin(t * 6) * 0.04, 0.004, t * 0.11]); }
    tube(sub, { pts, radius: () => 0.010, radial: 3, squash: () => [1, 0.2], capStart: false, capEnd: false, sway: () => 0 });
    b.append(sub, mat(Math.cos(a) * rr, 0, Math.sin(a) * rr, r.range(0, TAU)));
  }

  return { blockers: [{ x: 0, z: 0, r: 1.1 }] };
}

/** A rack of finished wooden weapons, leaning in a row. */
export function buildWeaponRack(b, { seed = 1, w = 1.8, weapons = null } = {}) {
  const r = makeRng(seed ^ 0x2ac4);
  b.color(BARK.oak, 0.07, r);
  for (const s of [-1, 1]) beam(b, s * w / 2, 0, 0, s * w / 2, 1.5, 0, 0.09, 0.09, [0, 1, 0]);
  beam(b, -w / 2, 1.42, 0, w / 2, 1.42, 0, 0.08, 0.10, [0, 1, 0]);
  beam(b, -w / 2, 0.18, 0, w / 2, 0.18, 0, 0.08, 0.10, [0, 1, 0]);
  b.color(BUILD.plankOld, 0.06, r);
  box(b, 0, 0.06, 0, w, 0.12, 0.34);

  const n = r.int(4, 7);
  for (let i = 0; i < n; i++) {
    const x = lerp(-w * 0.42, w * 0.42, (i + 0.5) / n);
    const len = r.range(1.0, 1.9);
    const lean = r.range(-0.12, 0.12);
    b.color(mixHex(BARK.hazel, BARK.oak, r()), 0.10, r);
    tube(b, {
      pts: [[x, 0.1, r.range(-0.05, 0.05)], [x + lean * len, 0.1 + len, r.range(-0.08, 0.02)]],
      radius: t => r.range(0.018, 0.032) * (1 - t * 0.25), radial: 5,
      capStart: true, capEnd: true, sway: () => 0,
    });
    // a bound grip
    b.color(BUILD.rope, 0.07, r);
    cylinder(b, x + lean * len * 0.45, 0, 0.1 + len * 0.42, 0.1 + len * 0.55, 0.030, 0.030, 6);
  }
  return { blockers: [{ x: 0, z: 0, r: w * 0.4 }] };
}

/** An anvil on a block, for the blacksmith. */
export function buildAnvil(b, { seed = 1 } = {}) {
  const r = makeRng(seed ^ 0xa4b1);
  b.color(mixHex(BARK.oak, BARK.deadWood, 0.3), 0.07, r);
  cylinder(b, 0, 0, 0, 0.48, 0.28, 0.26, 9);
  b.color(METAL.ironDark, 0.05, r);
  box(b, 0, 0.56, 0, 0.44, 0.16, 0.22);
  box(b, 0, 0.66, 0, 0.62, 0.09, 0.20);
  b.color(METAL.iron, 0.04, r);
  box(b, 0, 0.71, 0, 0.60, 0.03, 0.19);
  // the horn
  const sub = new MeshBuilder();
  sub.curColor = b.curColor;
  cylinder(sub, 0, 0, 0, 0.26, 0.085, 0.02, 7);
  b.append(sub, new THREE.Matrix4().compose(
    new THREE.Vector3(0.30, 0.68, 0),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2),
    new THREE.Vector3(1, 1, 1)));
  return { blockers: [{ x: 0, z: 0, r: 0.4 }] };
}

/** A grindstone on a frame. */
export function buildGrindstone(b, { seed = 1 } = {}) {
  const r = makeRng(seed ^ 0x62d5);
  b.color(BUILD.plankOld, 0.07, r);
  for (const s of [-1, 1]) {
    beam(b, s * 0.3, 0, -0.25, s * 0.28, 0.72, 0, 0.07, 0.07, [0, 1, 0]);
    beam(b, s * 0.3, 0, 0.25, s * 0.28, 0.72, 0, 0.07, 0.07, [0, 1, 0]);
  }
  const sub = new MeshBuilder();
  sub.color(BUILD.stone, 0.06, r);
  cylinder(sub, 0, 0, -0.045, 0.045, 0.3, 0.3, 14);
  sub.color(METAL.iron, 0.05, r);
  cylinder(sub, 0, 0, -0.34, 0.34, 0.022, 0.022, 5);
  b.append(sub, new THREE.Matrix4().compose(
    new THREE.Vector3(0, 0.72, 0),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2),
    new THREE.Vector3(1, 1, 1)));
  return { blockers: [{ x: 0, z: 0, r: 0.42 }] };
}

/** A planter or flower tub by a door. */
export function buildPlanter(b, { seed = 1, R = 0.32 } = {}) {
  const r = makeRng(seed ^ 0x914a);
  const half = r.chance(0.5);

  /* A POT HAS NO INSIDE, because it is full of soil.
     Modelling the inner wall means a surface whose correct facing reverses
     half way along the profile, and every attempt to state that reversal
     left a ring of inside-out geometry around the rim. The soil disc sits
     just under the rim and seals it, so the inside never existed and never
     needed to. */
  const rimY = 0.355, soilY = 0.315;
  const shellHex = half ? BUILD.plankOld : mixHex(BUILD.tileClay, 0x8a5a3a, r());
  b.color(shellHex, 0.07, r);
  if (half) {
    lathe(b, [[R * 0.8, 0], [R, 0.34], [R * 0.96, rimY]], 10);
    b.color(METAL.ironRust, 0.05, r);
    lathe(b, [[R * 1.01, 0.28], [R * 1.02, 0.32]], 10);
  } else {
    lathe(b, [[R * 0.62, 0], [R * 0.95, 0.32], [R, 0.36], [R * 0.96, rimY]], 10);
  }

  // the rim, and the soil that seals the pot: both discs, both stated
  b.color(shade(shellHex, -0.14), 0.05, r);
  { const m = b.mark; lathe(b, [[R * 0.96, rimY], [R * 0.84, rimY - 0.004]], 10); b.orientOutward(m, 0, -1, 0); }
  b.color(GROUND.farmSoil, 0.06, r);
  { const m = b.mark; lathe(b, [[R * 0.86, soilY], [0.001, soilY - 0.02]], 9); b.orientOutward(m, 0, -1, 0); }

  for (let i = 0; i < r.int(5, 11); i++) {
    const a = r.range(0, TAU), rr = r.range(0, R * 0.75);
    b.color(r.pick([0xd2503f, 0xf2cf54, 0xe098b4, 0x9a72c0, 0xf6f4e8, 0xe89347]), 0.10, r);
    blob(b, Math.cos(a) * rr, soilY + r.range(0.03, 0.17), Math.sin(a) * rr,
      r.range(0.03, 0.055), 2, 5, null, 0.4);
  }  b.color(0x4e7a2e, 0.10, r);
  for (let i = 0; i < 6; i++) {
    const sub = new MeshBuilder();
    sub.curColor = b.curColor;
    blade(sub, { len: r.range(0.1, 0.2), wid: 0.05, segs: 2, curl: 0.6, cup: 0.3, swayBase: 0.2, swayTip: 0.9 });
    const a = r.range(0, TAU);
    b.append(sub, orient([Math.cos(a) * R * 0.5, 0.33, Math.sin(a) * R * 0.5],
      [Math.cos(a) * 0.6, 0.8, Math.sin(a) * 0.6], 0));
  }
}
