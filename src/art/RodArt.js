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

import * as THREE from '../../lib/three.module.js?v=1790102737';
import { MeshBuilder, tube, blob, box, lathe, cylinder } from './Geo.js?v=1790102737';
import { BUILD, BARK, METAL, mixHex, tweak, shade } from './Palette.js?v=1790102737';
import { makeRng, clamp, lerp, TAU } from '../core/Util.js?v=1790102737';

/*
 * WHY THE FIRST VERSION OF THIS FILE FAILED ITS OWN BRIEF.
 *
 * The header below used to claim ten rods that were not each other in a
 * different colour. The genome really did change the material, the reel
 * type, the grip and the extras — and the contact sheet still came back
 * as ten identical hairlines in ten colours, because every DIMENSION in
 * the builder was a constant. Every rod had a 19 mm shaft, a 34 cm grip
 * of the same radius, a reel at y = 0.44 and a 3 cm butt, so the only
 * things that varied were too small to see from further away than a
 * hand's breadth.
 *
 * Silhouette is what tells rods apart, and on something two metres long
 * and two centimetres thick the silhouette is almost entirely the BUTT
 * END: how thick the blank is, how long and what shape the handle is,
 * and how big the reel hanging off it is. So all of those are genome now,
 * with an archetype per shaft material supplying the defaults, and the
 * top rods get a `flair` — a piece of distinctive hardware that shows up
 * in outline from across a room.
 */
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
 * THE BUILD OF THE ROD, which is what you actually recognise.
 *
 *   girth    radius of the blank at the butt. A cut hazel switch is a
 *            twig; a deep-water boat rod is as thick as a broom handle,
 *            and that difference alone separates half the rack.
 *   gripLen  how much of the bottom is handle.
 *   gripR    how fat the handle is.
 *   shape    'plain' a parallel handle
 *            'swell' a belly in the middle, the classic cork grip
 *            'pistol' short, with a thumb shelf — one-handed rods
 *            'spey'  long and straight, for two hands
 *   reelR    the spool radius. A centrepin is a saucer, a big-game reel
 *            is a dinner plate, and that is the loudest single shape on
 *            the whole object.
 *   reelY    how far up the handle it is clamped.
 */
const BUILDS = {
  hazel: { girth: 0.011, gripLen: 0.20, gripR: 0.022, shape: 'plain', reelR: 0.00, reelY: 0.26 },
  willow: { girth: 0.013, gripLen: 0.26, gripR: 0.026, shape: 'plain', reelR: 0.055, reelY: 0.30 },
  ash: { girth: 0.018, gripLen: 0.34, gripR: 0.032, shape: 'swell', reelR: 0.080, reelY: 0.38 },
  cane: { girth: 0.016, gripLen: 0.30, gripR: 0.029, shape: 'swell', reelR: 0.075, reelY: 0.35 },
  steel: { girth: 0.023, gripLen: 0.30, gripR: 0.034, shape: 'pistol', reelR: 0.095, reelY: 0.31 },
  bone: { girth: 0.032, gripLen: 0.62, gripR: 0.041, shape: 'spey', reelR: 0.145, reelY: 0.44 },
  stormwood: { girth: 0.020, gripLen: 0.36, gripR: 0.033, shape: 'swell', reelR: 0.098, reelY: 0.40 },
  gilt: { girth: 0.019, gripLen: 0.32, gripR: 0.031, shape: 'pistol', reelR: 0.105, reelY: 0.36 },
  rib: { girth: 0.036, gripLen: 0.66, gripR: 0.045, shape: 'spey', reelR: 0.155, reelY: 0.47 },
  glass: { girth: 0.017, gripLen: 0.40, gripR: 0.030, shape: 'spey', reelR: 0.110, reelY: 0.42 },
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

  /* the build, overridable per rod for the ones that want to be odd */
  const D = { ...(BUILDS[A.shaft] || BUILDS.hazel), ...(A.build || {}) };
  const GIRTH = D.girth;
  const gripTop = D.gripLen;
  const reelY = D.reelY;
  /* how far out from the axis the blank is at height t*L, for hanging
     hardware on a rod that bends */
  const bendAt = t => Math.pow(Math.max(0, t - 0.35) / 0.65, 2) * A.bend * L;
  const radAt = t => lerp(GIRTH, GIRTH * (1 - A.taper), t);

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
    radius: radAt,
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

  /* --- THE GRIP ---------------------------------------------------------
     THE HANDLE IS HALF THE SILHOUETTE. A hazel switch has twenty
     centimetres of whipped cord; a deep-water rod has two thirds of a
     metre of shaped cork with a fore-grip above the reel. Four profiles,
     all built from the same lathe, all genuinely different in outline. */
  {
    const gR = D.gripR;
    const GC = {
      cord: { col: BUILD.rope, wraps: 18 },
      leather: { col: 0x5a3f28, wraps: 0, check: true },
      cork: { col: 0xd8bc86, wraps: 0, speckle: true },
      wrapcord: { col: A.wrap, wraps: 24 },
      double: { col: 0x4a3524, wraps: 0, check: true },
    }[A.grip] || { col: BUILD.rope, wraps: 14 };

    /* the profile, as [radius, height] pairs up the handle */
    let prof;
    if (D.shape === 'pistol') {
      /* short, with a swell at the top your thumb sits behind */
      prof = [[gR * 0.62, 0.012], [gR * 1.02, 0.045], [gR * 0.86, gripTop * 0.52],
      [gR * 1.12, gripTop * 0.86], [gR * 0.70, gripTop], [GIRTH * 1.15, gripTop + 0.022]];
    } else if (D.shape === 'spey') {
      /* long and near-parallel: a handle for two hands */
      prof = [[gR * 0.72, 0.012], [gR, 0.05], [gR * 0.98, gripTop * 0.45],
      [gR, gripTop * 0.9], [gR * 0.80, gripTop], [GIRTH * 1.15, gripTop + 0.026]];
    } else if (D.shape === 'swell') {
      /* the classic cork: narrow at both ends, bellied in the middle */
      prof = [[gR * 0.66, 0.012], [gR * 0.92, 0.05], [gR * 1.08, gripTop * 0.45],
      [gR * 0.92, gripTop * 0.82], [gR * 0.68, gripTop], [GIRTH * 1.15, gripTop + 0.020]];
    } else {
      prof = [[gR * 0.80, 0.012], [gR, 0.045], [gR, gripTop * 0.9],
      [gR * 0.82, gripTop], [GIRTH * 1.2, gripTop + 0.016]];
    }
    b.color(GC.col, 0.07, r);
    lathe(b, prof, 10);

    if (GC.wraps) {
      for (let i = 0; i < GC.wraps; i++) {
        const t = 0.03 + (i / GC.wraps) * (gripTop - 0.06);
        const rr = gR * 1.03;
        b.color(tweak(GC.col, { l: r.range(0.86, 1.14) }), 0.05, r);
        lathe(b, [[rr, t], [rr + 0.002, t + 0.007], [rr, t + 0.014]], 8);
      }
    }
    /* cork is speckled, and the speckle is most of what says "cork" */
    if (GC.speckle && lod === 0) {
      for (let i = 0; i < 26; i++) {
        const t = r.range(0.03, gripTop - 0.02);
        const a = r.range(0, TAU);
        b.color(shade(GC.col, -0.30), 0.10, r);
        blob(b, Math.cos(a) * gR * 0.98, t, Math.sin(a) * gR * 0.98, r.range(0.003, 0.006), 2, 4);
      }
    }
    /* a leather grip is cross-checked rather than wrapped */
    if (GC.check && lod === 0) {
      b.color(shade(GC.col, -0.28), 0.06, r);
      for (let i = 0; i < 10; i++) {
        const t = 0.04 + (i / 10) * (gripTop - 0.08);
        lathe(b, [[gR * 1.01, t], [gR * 1.02, t + 0.004], [gR * 1.01, t + 0.008]], 8);
      }
    }

    /* the winding check where the handle meets the blank: a small bright
       ring that reads as a joint rather than a colour change */
    b.color(METAL.brass ?? 0xb08a3a, 0.04, r);
    lathe(b, [[GIRTH * 1.22, gripTop + 0.018], [GIRTH * 1.30, gripTop + 0.028],
    [GIRTH * 1.16, gripTop + 0.040]], 9);

    /* A FORE-GRIP above the reel, on the rods meant for two hands. */
    if (A.grip === 'double' || D.shape === 'spey') {
      const f0 = reelY + D.reelR * 0.55 + 0.05;
      b.color(0xd8bc86, 0.06, r);
      lathe(b, [[radAt(f0 / L) * 1.1, f0], [gR * 0.78, f0 + 0.04],
      [gR * 0.74, f0 + 0.20], [radAt((f0 + 0.24) / L) * 1.1, f0 + 0.24]], 9);
    }
  }

  /* --- THE BUTT ---------------------------------------------------------
     Scaled off the handle rather than fixed, so a big rod gets a big butt
     cap — a 4 cm knob on a 9 cm grip looked like a doorknob on a broom. */
  {
    const B = A.butt;
    const u = D.gripR;
    if (B === 'knob') { b.color(shade(A.wrap, -0.2), 0.06, r); blob(b, 0, 0.018, 0, u * 1.35, 3, 8); }
    else if (B === 'brass') {
      b.color(0xb08a3a, 0.05, r);
      lathe(b, [[u * 0.9, 0], [u * 1.25, 0.016], [u * 1.18, 0.034], [u * 0.85, 0.050]], 10);
    } else if (B === 'weight') {
      /* a counterweight: heavy, squat, and obviously lead */
      b.color(METAL.iron, 0.05, r);
      lathe(b, [[u * 1.05, 0], [u * 1.45, 0.030], [u * 1.42, 0.072], [u * 0.95, 0.098]], 10);
      b.color(shade(METAL.iron, 0.14), 0.04, r);
      lathe(b, [[u * 1.48, 0.040], [u * 1.52, 0.050], [u * 1.48, 0.060]], 10);
    } else if (B === 'spike') {
      /* a gimbal spike, for bracing against a boat or a belt */
      b.color(METAL.steel, 0.05, r);
      lathe(b, [[u * 1.0, 0.030], [u * 0.85, 0.005], [u * 0.30, -0.055], [0.003, -0.115]], 8);
      b.color(shade(METAL.steel, -0.2), 0.05, r);
      lathe(b, [[u * 1.12, 0.026], [u * 1.16, 0.040], [u * 1.02, 0.052]], 9);
    } else if (B === 'cap') {
      b.color(0x6a5a3a, 0.06, r);
      lathe(b, [[u * 1.02, 0], [u * 1.12, 0.014], [u * 1.02, 0.034]], 9);
    } else if (B === 'jewel') {
      b.color(0xd8ac48, 0.05, r);
      lathe(b, [[u * 0.95, 0], [u * 1.30, 0.020], [u * 1.22, 0.042], [u * 0.80, 0.062]], 11);
      /* claws holding the stone, which is what makes it read as SET
         rather than as a bead glued on the end */
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU;
        b.color(0xe8c468, 0.04, r);
        blob(b, Math.cos(a) * u * 0.72, 0.050, Math.sin(a) * u * 0.72, u * 0.20, 2, 4);
      }
      b.color(0x6ad8e8, 0.04, r); blob(b, 0, 0.042, 0, u * 0.62, 3, 8);
      g.color(0x8fe8ff, 0.06, r); blob(g, 0, 0.042, 0, u * 0.86, 2, 6);
    } else {
      b.color(shade(M.col, -0.2), 0.06, r);
      lathe(b, [[u * 0.86, 0], [u * 0.94, 0.018]], 8);
    }
  }

  /* --- THE REEL ---------------------------------------------------------
     SIX REELS, and the size of them is the loudest thing on the rod.
     They all used to be a disc of one of five radii with the same little
     crank; a centrepin and a big-game winch are not the same object at
     two scales, so each now has its own cage, its own foot and its own
     handle. The spool is laid ACROSS the rod: `lathe` builds around Y,
     so it is built upright and then rotated onto Z. */
  if (A.reel !== 'none') {
    const R = D.reelR || 0.08;
    const ry = reelY, rz = GIRTH + R * 0.34 + 0.012;
    const gold = A.reel === 'ornate';
    const body = gold ? 0xd8ac48 : METAL.iron;
    const bright = gold ? 0xe8c468 : shade(METAL.iron, 0.14);

    /* THE FOOT. A reel does not float beside a rod: it is clamped to it
       by a seat with two bands, and that little assembly is what makes
       the whole thing look bolted on rather than magnetised. */
    b.color(shade(body, -0.15), 0.05, r);
    box(b, 0, ry, rz * 0.45, R * 0.42, 0.055, rz * 0.9);
    b.color(bright, 0.05, r);
    for (const dy of [-0.032, 0.032]) {
      lathe(b, [[GIRTH * 1.30, ry + dy - 0.007], [GIRTH * 1.42, ry + dy],
      [GIRTH * 1.30, ry + dy + 0.007]], 9);
    }

    const sub = new MeshBuilder();
    if (A.reel === 'peg') {
      /* the simplest thing that holds line: a wooden bobbin on a pin */
      sub.color(0x8a6a42, 0.07, r);
      lathe(sub, [[R * 0.42, -0.026], [R, -0.020], [R * 0.60, -0.010],
      [R * 0.60, 0.010], [R, 0.020], [R * 0.42, 0.026]], 8);
    } else if (A.reel === 'big') {
      /* A BIG-GAME WINCH: a deep drum with a caged frame and crossbars
         you can see through, which is the whole look of the thing. */
      sub.color(body, 0.05, r);
      lathe(sub, [[R * 0.30, -0.055], [R, -0.046], [R * 0.72, -0.030],
      [R * 0.72, 0.030], [R, 0.046], [R * 0.30, 0.055]], 14);
      sub.color(bright, 0.05, r);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        box(sub, Math.cos(a) * R * 0.88, 0, Math.sin(a) * R * 0.88, 0.012, 0.096, 0.012);
      }
    } else if (A.reel === 'geared') {
      /* a machined winch: a shallow spool, a gear plate and a star drag */
      sub.color(body, 0.05, r);
      lathe(sub, [[R * 0.34, -0.030], [R, -0.024], [R * 0.68, -0.012],
      [R * 0.68, 0.012], [R, 0.024], [R * 0.34, 0.030]], 13);
      sub.color(bright, 0.04, r);
      lathe(sub, [[R * 0.52, 0.030], [R * 0.56, 0.040], [R * 0.20, 0.046]], 11);
      for (let i = 0; i < 9; i++) {          // the gear teeth, just visible
        const a = (i / 9) * TAU;
        box(sub, Math.cos(a) * R * 0.56, 0.038, Math.sin(a) * R * 0.56, 0.009, 0.010, 0.009);
      }
    } else if (A.reel === 'ornate') {
      /* a jeweller's centrepin: a wide thin plate with pierced spokes */
      sub.color(body, 0.04, r);
      lathe(sub, [[R * 0.22, -0.018], [R, -0.013], [R * 0.90, 0],
      [R, 0.013], [R * 0.22, 0.018]], 16);
      sub.color(bright, 0.04, r);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        box(sub, Math.cos(a) * R * 0.58, 0, Math.sin(a) * R * 0.58, 0.010, 0.030, 0.010);
        blob(sub, Math.cos(a) * R * 0.92, 0, Math.sin(a) * R * 0.92, 0.010, 2, 5);
      }
    } else {
      /* a plain drum */
      sub.color(body, 0.06, r);
      lathe(sub, [[R * 0.32, -0.024], [R, -0.018], [R * 0.70, -0.008],
      [R * 0.70, 0.008], [R, 0.018], [R * 0.32, 0.024]], 12);
    }

    /* the line wound on it, which every reel has */
    sub.color(A.lineCol, 0.05, r);
    const half = A.reel === 'big' ? 0.026 : A.reel === 'peg' ? 0.009 : 0.010;
    lathe(sub, [[R * 0.70, -half], [R * 0.70, half]], 12);

    b.append(sub, new THREE.Matrix4().compose(
      new THREE.Vector3(0, ry, rz),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2),
      new THREE.Vector3(1, 1, 1)));

    /* THE CRANK, out on the near face where a paw would reach it. A big
       reel gets a long arm and a fat knob; a peg reel gets a stub. */
    const armLen = R * (A.reel === 'big' ? 0.95 : A.reel === 'peg' ? 0.5 : 0.78);
    const zOut = rz + (A.reel === 'big' ? 0.058 : 0.030);
    b.color(shade(body, -0.1), 0.05, r);
    tube(b, {
      pts: [[0, ry, zOut], [armLen, ry + armLen * 0.30, zOut + 0.006]],
      radius: () => (A.reel === 'big' ? 0.0125 : 0.0085), radial: 5,
      capStart: true, capEnd: true, sway: () => 0,
    });
    b.color(0x6a4a2a, 0.06, r);
    blob(b, armLen, ry + armLen * 0.30, zOut + 0.020,
      A.reel === 'big' ? 0.026 : 0.017, 3, 7);
    /* and a counterbalance opposite it, so the crank reads as a crank */
    if (A.reel === 'geared' || A.reel === 'big' || A.reel === 'ornate') {
      b.color(shade(body, -0.05), 0.05, r);
      blob(b, -armLen * 0.55, ry - armLen * 0.18, zOut, 0.013, 2, 6);
    }
  }

  /* --- LINE GUIDES, and the line itself --------------------------------- */
  /* GUIDES GET SMALLER UP THE ROD, which is both true and the thing that
     makes a row of them read as a set rather than as beads. The first one
     off the reel is the big stripping guide. */
  const guides = [];
  const gStart = (reelY + (D.reelR || 0.05) + 0.10) / L;
  for (let i = 0; i < A.guides; i++) {
    const t = lerp(gStart, 0.97, A.guides === 1 ? 0.5 : i / (A.guides - 1));
    const bend = bendAt(t);
    const rr = radAt(t);
    const ring = lerp(0.026, 0.008, i / Math.max(1, A.guides - 1)) * (1 + GIRTH * 8);
    b.color(METAL.steel, 0.05, r);
    /* the foot whipped to the blank, then the ring standing off it */
    lathe(b, [[rr * 1.15, t * L - 0.012], [rr * 1.25, t * L], [rr * 1.15, t * L + 0.012]], 7, bend, 0);
    lathe(b, [[rr + ring * 0.25, t * L], [rr + ring, t * L + 0.006],
    [rr + ring * 0.88, t * L + 0.016]], 8, bend, 0);
    guides.push([bend + rr + ring * 0.7, t * L + 0.010, 0]);
  }
  /* the line runs from the reel through every guide to the tip: one tube,
     so it actually follows the rod's bend instead of floating beside it */
  if (guides.length) {
    b.color(A.lineCol, 0.03, r);
    tube(b, {
      pts: [[0.01, reelY, GIRTH + (D.reelR || 0.05) * 0.34 + 0.012], ...guides, [bendAt(1), L, 0]],
      radius: () => 0.0035, radial: 3, capStart: false, capEnd: false, sway: () => 0,
    });
  }

  /* --- FLAIR: the thing you recognise from across the room -------------
     Only the rods that have earned it. A legendary rod that is a good
     rod in nicer materials is not memorable; it needs one piece of
     hardware nothing else has. */
  if (A.flair && lod === 0) buildFlair(b, g, A, D, L, bendAt, radAt, r);

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

/* ========================================================================= */
/* FLAIR                                                                     */
/* ========================================================================= */

/**
 * One distinctive fitting per high rod, chosen so it changes the
 * OUTLINE — a glow or a gold paint job disappears at any distance, and
 * the point of the top of the rack is that another player can tell what
 * you are carrying without asking.
 */
function buildFlair(b, g, A, D, L, bendAt, radAt, r) {
  switch (A.flair) {
    case 'outriggers': {
      /* two short spars braced off the butt section, like a deep-water
         rod rigged for something that fights back */
      for (const side of [-1, 1]) {
        const y0 = D.reelY + 0.16, y1 = y0 + 0.42;
        b.color(METAL.iron, 0.05, r);
        tube(b, {
          pts: [[bendAt(y0 / L), y0, 0], [bendAt(y1 / L) + side * 0.10, y1, side * 0.055]],
          radius: t => lerp(0.009, 0.004, t), radial: 4,
          capStart: true, capEnd: true, sway: () => 0,
        });
        b.color(shade(METAL.iron, 0.2), 0.05, r);
        blob(b, bendAt(y1 / L) + side * 0.10, y1, side * 0.055, 0.011, 2, 5);
      }
      break;
    }
    case 'lantern': {
      /* a little glass lamp hung under the tip, for night water */
      const t = 0.86, y = t * L, x = bendAt(t);
      b.color(METAL.brass ?? 0xb08a3a, 0.05, r);
      tube(b, {
        pts: [[x, y, 0], [x + 0.02, y - 0.07, 0]],
        radius: () => 0.004, radial: 4, capStart: false, capEnd: false, sway: () => 0,
      });
      b.color(0x8a6a2a, 0.05, r);
      lathe(b, [[0.022, y - 0.075], [0.026, y - 0.090], [0.024, y - 0.130], [0.014, y - 0.146]], 8, x + 0.02, 0);
      b.color(0xfff0b4, 0.03, r);
      blob(b, x + 0.02, y - 0.110, 0, 0.017, 3, 7);
      g.color(A.glow || 0xffd24a, 0.05, r);
      blob(g, x + 0.02, y - 0.110, 0, 0.040, 3, 7);
      break;
    }
    case 'twintip': {
      /* the blank splits near the top and carries two tips */
      const t0 = 0.72;
      for (const side of [-1, 1]) {
        const pts = [];
        for (let i = 0; i <= 6; i++) {
          const u = i / 6;
          const t = lerp(t0, 1, u);
          pts.push([bendAt(t) + side * u * u * 0.075, t * L, 0]);
        }
        b.color(shade(0xd8cca8, side > 0 ? 0.05 : -0.05), 0.06, r);
        tube(b, {
          pts, radius: t => lerp(radAt(t0) * 0.72, 0.004, t),
          radial: 5, capStart: false, capEnd: true, sway: () => 0,
        });
      }
      /* a collar where it divides, so it reads as made rather than broken */
      b.color(METAL.brass ?? 0xb08a3a, 0.04, r);
      lathe(b, [[radAt(t0) * 1.2, t0 * L - 0.02], [radAt(t0) * 1.5, t0 * L],
      [radAt(t0) * 1.2, t0 * L + 0.02]], 9, bendAt(t0), 0);
      break;
    }
    case 'ribbons': {
      /* trailing silks, which move on nothing but say "ceremonial" */
      for (let i = 0; i < 3; i++) {
        const t = 0.58 + i * 0.13, y = t * L, x = bendAt(t);
        const pts = [];
        for (let k = 0; k <= 5; k++) {
          const u = k / 5;
          pts.push([x + Math.sin(u * 3 + i) * 0.03, y - u * 0.24, Math.cos(u * 2.2 + i) * 0.025]);
        }
        b.color(A.tipCol, 0.08, r);
        tube(b, {
          pts, radius: t => lerp(0.006, 0.001, t), radial: 3,
          capStart: false, capEnd: false, sway: () => 0,
        });
      }
      break;
    }
    case 'finial': {
      /* a carved crown at the tip, and a stone in it */
      const y = L, x = bendAt(1);
      b.color(0xd8ac48, 0.04, r);
      lathe(b, [[0.010, y - 0.05], [0.026, y - 0.028], [0.020, y - 0.010], [0.026, y + 0.006]], 10, x, 0);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        b.color(0xe8c468, 0.04, r);
        blob(b, x + Math.cos(a) * 0.020, y + 0.014, Math.sin(a) * 0.020, 0.007, 2, 4);
      }
      b.color(A.glow || 0x9fe4ff, 0.03, r);
      blob(b, x, y + 0.014, 0, 0.014, 3, 7);
      g.color(A.glow || 0x9fe4ff, 0.05, r);
      blob(g, x, y + 0.014, 0, 0.038, 3, 7);
      break;
    }
    default: break;
  }
}

/** A rod as three.js meshes, mounted the same way a weapon is. */
export function rodMeshes(rod, mats, opts = {}) {
  const out = buildRod(rod, opts);
  const meshes = [new THREE.Mesh(out.builder.build({ flat: false }), mats.item)];
  if (!out.glow.isEmpty) meshes.push(new THREE.Mesh(out.glow.build({ flat: false }), mats.glow));
  for (const m of meshes) { m.castShadow = true; m.receiveShadow = true; }
  return { meshes, info: out };
}
