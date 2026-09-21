/* RodArt.js — building a fishing rod from its genome.
   ===========================================================================
   Ten rods, and the brief was explicit that the later ones must not be the
   early ones in a different colour. They are not: the genome in RodData
   changes the SHAFT MATERIAL (hazel, willow, ash, split cane, sleeved steel,
   bone, storm-struck wood, gilt, a rib, glass), how many pieces it comes in
   and where the ferrules sit, the REEL (none, a peg, a drum, a geared
   winch, a two-handed big reel, an ornate one), how many line guides run up
   it, the GRIP (bare cord, leather, cork, a corded wrap, a double grip),
   the BUTT (plain, a knob, brass, a counterweight, a spike, a jewel) and
   the extras — binding whippings, reinforcing plates, filigree, a spectral
   glow. Two rods that happen to share a reel share nothing else.

   ORIENTATION: **the butt is at the origin and the tip runs up +Y**, which
   is the same convention the weapons use, so the same carry code in the paw
   works for both without a special case.
*/

import * as THREE from '../../lib/three.module.js?v=20260921164117';
import { MeshBuilder, tube, blob, box, lathe, cylinder } from './Geo.js?v=20260921164117';
import { BUILD, BARK, METAL, mixHex, tweak, shade } from './Palette.js?v=20260921164117';
import { makeRng, clamp, lerp, TAU } from '../core/Util.js?v=20260921164117';

/** What the shaft is made of, and how it reads. */
const SHAFT = {
  hazel: { col: 0xa8854e, jitter: 0.10, seg: 7, knots: true },
  willow: { col: 0x9aa05e, jitter: 0.09, seg: 9, knots: false },
  ash: { col: 0xc4a874, jitter: 0.07, seg: 8, knots: true },
  cane: { col: 0xd8c47e, jitter: 0.06, seg: 11, knots: false, facets: 6 },
  steel: { col: 0x3a4048, jitter: 0.04, seg: 6, knots: false, metal: true },
  bone: { col: 0xe4dcc4, jitter: 0.06, seg: 7, knots: false, ridged: true },
  stormwood: { col: 0x4e3f66, jitter: 0.12, seg: 9, knots: true, scorch: true },
  gilt: { col: 0xd8ac48, jitter: 0.05, seg: 8, knots: false, metal: true },
  rib: { col: 0xd8cca8, jitter: 0.08, seg: 9, knots: false, ridged: true },
  glass: { col: 0xbfe0ec, jitter: 0.03, seg: 10, knots: false, metal: true },
};

/**
 * @param rod   an entry from RODS
 * @returns {{builder, glow, length}}
 */
export function buildRod(rod, opts = {}) {
  const A = rod.art;
  const b = opts.builder || new MeshBuilder();
  const g = opts.glow || new MeshBuilder();
  const r = makeRng((rod.id.length * 7919 + A.len * 1000) | 0);
  const M = SHAFT[A.shaft] || SHAFT.hazel;
  const L = A.len;
  const lod = clamp(opts.lod ?? 0, 0, 2);
  const radial = lod === 0 ? (M.facets || 7) : 5;

  /* --- THE SHAFT -------------------------------------------------------
     A rod is a taper with a bend in it, not a stick. The bend is in the
     TOP THIRD only, because that is where a rod actually flexes, and it is
     what makes a cane rod read as springy and a steel one as stiff. */
  const pts = [];
  const N = M.seg;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const bend = Math.pow(Math.max(0, t - 0.35) / 0.65, 2) * A.bend * L;
    pts.push([bend, t * L, 0]);
  }
  b.color(M.col, M.jitter, r);
  tube(b, {
    pts,
    radius: t => lerp(0.019, 0.019 * (1 - A.taper), t),
    radial, capStart: true, capEnd: true, sway: () => 0,
    color: M.scorch ? (t => mixHex(M.col, 0x1a1420, Math.pow(Math.sin(t * 9), 2) * 0.7)) : null,
  });

  /* the knots and grain of a natural shaft */
  if (M.knots && lod === 0) {
    for (let i = 0; i < 4; i++) {
      const t = r.range(0.2, 0.85);
      const bend = Math.pow(Math.max(0, t - 0.35) / 0.65, 2) * A.bend * L;
      b.color(shade(M.col, -0.22), 0.08, r);
      blob(b, bend, t * L, 0, 0.022 * (1 - t * 0.5), 2, 5, (x, y, z) => [1.3, 0.6, 1.3]);
    }
  }
  /* the ridges of bone and rib */
  if (M.ridged && lod === 0) {
    b.color(shade(M.col, -0.12), 0.05, r);
    for (let i = 0; i < 9; i++) {
      const t = 0.1 + (i / 9) * 0.78;
      const bend = Math.pow(Math.max(0, t - 0.35) / 0.65, 2) * A.bend * L;
      lathe(b, [[0.020 * (1 - t * A.taper), t * L], [0.024 * (1 - t * A.taper), t * L + 0.012],
      [0.020 * (1 - t * A.taper), t * L + 0.024]], 6, bend, 0);
    }
  }

  /* --- FERRULES where it comes apart ----------------------------------- */
  for (let j = 1; j <= A.joints; j++) {
    const t = j / (A.joints + 1);
    const bend = Math.pow(Math.max(0, t - 0.35) / 0.65, 2) * A.bend * L;
    b.color(METAL.brass ?? 0xb08a3a, 0.05, r);
    lathe(b, [[0.026, t * L - 0.03], [0.029, t * L - 0.02], [0.029, t * L + 0.02], [0.026, t * L + 0.03]],
      8, bend, 0);
  }

  /* --- BINDING WHIPPINGS ------------------------------------------------ */
  if (A.bindings) {
    for (let i = 0; i < A.bindings; i++) {
      const t = 0.18 + (i / A.bindings) * 0.7;
      const bend = Math.pow(Math.max(0, t - 0.35) / 0.65, 2) * A.bend * L;
      b.color(A.wrap, 0.07, r);
      lathe(b, [[0.023 * (1 - t * A.taper * 0.7), t * L - 0.018],
      [0.025 * (1 - t * A.taper * 0.7), t * L],
      [0.023 * (1 - t * A.taper * 0.7), t * L + 0.018]], 7, bend, 0);
    }
  }

  /* --- REINFORCING PLATES ---------------------------------------------- */
  if (A.plates && lod === 0) {
    b.color(METAL.iron, 0.06, r);
    for (let i = 0; i < 5; i++) {
      const t = 0.14 + (i / 5) * 0.4;
      const bend = Math.pow(Math.max(0, t - 0.35) / 0.65, 2) * A.bend * L;
      box(b, bend + 0.022, t * L, 0, 0.012, 0.06, 0.036);
      box(b, bend - 0.022, t * L, 0, 0.012, 0.06, 0.036);
    }
  }

  /* --- FILIGREE --------------------------------------------------------- */
  if (A.filigree && lod === 0) {
    b.color(0xe8c468, 0.06, r);
    for (let i = 0; i < 16; i++) {
      const t = 0.16 + (i / 16) * 0.62;
      const a = i * 1.4;
      const bend = Math.pow(Math.max(0, t - 0.35) / 0.65, 2) * A.bend * L;
      blob(b, bend + Math.cos(a) * 0.021, t * L, Math.sin(a) * 0.021, 0.008, 2, 4);
    }
  }

  /* --- THE GRIP --------------------------------------------------------- */
  {
    const gTop = A.grip === 'double' ? 0.52 : 0.34;
    const GC = {
      cord: { col: BUILD.rope, wraps: 16 },
      leather: { col: 0x5a3f28, wraps: 0 },
      cork: { col: 0xd8bc86, wraps: 0 },
      wrapcord: { col: A.wrap, wraps: 22 },
      double: { col: 0x4a3524, wraps: 0 },
    }[A.grip] || { col: BUILD.rope, wraps: 14 };

    b.color(GC.col, 0.07, r);
    lathe(b, [[0.020, 0.03], [0.031, 0.07], [0.033, gTop * 0.6], [0.028, gTop], [0.021, gTop + 0.03]], 9);
    if (GC.wraps) {
      for (let i = 0; i < GC.wraps; i++) {
        const t = 0.05 + (i / GC.wraps) * (gTop - 0.08);
        b.color(tweak(GC.col, { l: r.range(0.86, 1.14) }), 0.05, r);
        lathe(b, [[0.032, t], [0.034, t + 0.008], [0.032, t + 0.016]], 8);
      }
    }
    /* a double grip has a second cork above the reel, for two hands */
    if (A.grip === 'double') {
      b.color(0xd8bc86, 0.06, r);
      lathe(b, [[0.021, 0.60], [0.029, 0.64], [0.029, 0.80], [0.020, 0.84]], 9);
    }
  }

  /* --- THE BUTT --------------------------------------------------------- */
  {
    const B = A.butt;
    if (B === 'knob') { b.color(shade(A.wrap, -0.2), 0.06, r); blob(b, 0, 0.02, 0, 0.040, 3, 7); }
    else if (B === 'brass') { b.color(0xb08a3a, 0.05, r); lathe(b, [[0.034, 0], [0.038, 0.02], [0.030, 0.05]], 9); }
    else if (B === 'weight') { b.color(METAL.iron, 0.05, r); lathe(b, [[0.040, 0], [0.044, 0.04], [0.030, 0.09]], 9); }
    else if (B === 'spike') { b.color(METAL.steel, 0.05, r); lathe(b, [[0.030, 0.03], [0.014, -0.02], [0.002, -0.08]], 7); }
    else if (B === 'cap') { b.color(0x6a5a3a, 0.06, r); lathe(b, [[0.032, 0], [0.034, 0.03]], 8); }
    else if (B === 'jewel') {
      b.color(0xd8ac48, 0.05, r); lathe(b, [[0.034, 0], [0.038, 0.025], [0.028, 0.05]], 9);
      b.color(0x6ad8e8, 0.04, r); blob(b, 0, 0.02, 0, 0.020, 2, 6);
      g.color(0x8fe8ff, 0.06, r); blob(g, 0, 0.02, 0, 0.026, 2, 5);
    } else { b.color(shade(M.col, -0.2), 0.06, r); lathe(b, [[0.026, 0], [0.028, 0.02]], 7); }
  }

  /* --- THE REEL --------------------------------------------------------- */
  if (A.reel !== 'none') {
    const R = { peg: 0.055, drum: 0.085, geared: 0.10, big: 0.135, ornate: 0.105 }[A.reel] || 0.08;
    const ry = 0.44, rz = 0.055;
    b.color(A.reel === 'ornate' ? 0xd8ac48 : METAL.iron, 0.06, r);
    /* the seat that clamps it to the shaft */
    box(b, 0, ry + 0.04, 0.02, 0.05, 0.12, 0.05);
    /* the spool, lying across the rod */
    lathe(b, [[R * 0.35, -0.018], [R, -0.012], [R * 0.88, 0], [R, 0.012], [R * 0.35, 0.018]],
      A.reel === 'peg' ? 7 : 12, 0, 0);
    // lathe builds around Y, so rotate the spool onto the Z axis by hand
    const sub = new MeshBuilder();
    sub.color(A.reel === 'ornate' ? 0xe8c468 : shade(METAL.iron, 0.1), 0.06, r);
    lathe(sub, [[R * 0.3, -0.02], [R, -0.014], [R * 0.9, 0], [R, 0.014], [R * 0.3, 0.02]],
      A.reel === 'peg' ? 7 : 12);
    // the wound line
    sub.color(A.lineCol, 0.05, r);
    lathe(sub, [[R * 0.72, -0.011], [R * 0.72, 0.011]], 10);
    b.append(sub, new THREE.Matrix4().compose(
      new THREE.Vector3(0, ry, rz + R * 0.1),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2),
      new THREE.Vector3(1, 1, 1)));
    /* the handle */
    b.color(0x5a3f28, 0.06, r);
    tube(b, {
      pts: [[0, ry, rz + R * 0.1 + 0.02], [R * 0.7, ry + R * 0.4, rz + R * 0.1 + 0.03]],
      radius: () => 0.010, radial: 5, capStart: true, capEnd: false, sway: () => 0,
    });
    b.color(0x8a6a3a, 0.05, r);
    blob(b, R * 0.7, ry + R * 0.4, rz + R * 0.1 + 0.05, 0.020, 2, 6);
  }

  /* --- LINE GUIDES, and the line itself --------------------------------- */
  const guides = [];
  for (let i = 0; i < A.guides; i++) {
    const t = 0.42 + (i / A.guides) * 0.56;
    const bend = Math.pow(Math.max(0, t - 0.35) / 0.65, 2) * A.bend * L;
    const rr = 0.020 * (1 - t * A.taper);
    b.color(METAL.steel, 0.05, r);
    lathe(b, [[rr + 0.004, t * L], [rr + 0.020, t * L + 0.004], [rr + 0.018, t * L + 0.012]], 7, bend, 0);
    guides.push([bend + rr + 0.016, t * L + 0.008, 0]);
  }
  /* the line runs from the reel through every guide to the tip: one tube,
     so it actually follows the rod's bend instead of floating beside it */
  if (guides.length) {
    const tipBend = Math.pow(0.65 / 0.65, 2) * A.bend * L;
    b.color(A.lineCol, 0.03, r);
    tube(b, {
      pts: [[0.04, 0.46, 0.06], ...guides, [tipBend, L, 0]],
      radius: () => 0.0035, radial: 3, capStart: false, capEnd: false, sway: () => 0,
    });
  }

  /* --- the tip, and whatever glows -------------------------------------- */
  {
    const tipBend = Math.pow(1, 2) * A.bend * L;
    b.color(A.tipCol, 0.05, r);
    blob(b, tipBend, L, 0, 0.012, 2, 5);
    if (A.glow) {
      g.color(A.glow, 0.06, r);
      blob(g, tipBend, L, 0, 0.026, 2, 6);
      if (A.spectral) {
        for (let i = 0; i < 7; i++) {
          const t = 0.3 + (i / 7) * 0.68;
          const bend = Math.pow(Math.max(0, t - 0.35) / 0.65, 2) * A.bend * L;
          g.color(A.glow, 0.08, r);
          blob(g, bend, t * L, 0, 0.030, 2, 5);
        }
      }
    }
  }

  return { builder: b, glow: g, length: L };
}

/** A rod as three.js meshes, mounted the same way a weapon is. */
export function rodMeshes(rod, mats, opts = {}) {
  const out = buildRod(rod, opts);
  const meshes = [new THREE.Mesh(out.builder.build({ flat: false }), mats.item)];
  if (!out.glow.isEmpty) meshes.push(new THREE.Mesh(out.glow.build({ flat: false }), mats.glow));
  for (const m of meshes) { m.castShadow = true; m.receiveShadow = true; }
  return { meshes, info: out };
}
