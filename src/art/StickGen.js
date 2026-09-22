/* StickGen.js — turning a stick spec into triangles.
   ===========================================================================
   Every stick on the forest floor is generated here, individually, from its
   own seed. Nothing is instanced and nothing is reused: if two sticks in
   Hearthwood look the same, it is a bug.

   HOW THE VARIATION IS BUILT, in order of how much a player notices it:

     1. SILHOUETTE.  Length, thickness, taper, curvature, wobble, kinks,
        forks, and the rare forms (a spiral, a burl, a hole, a bristle head).
        This is 90% of "that one is different" and it is all in the path.
     2. SURFACE COLOUR. The bark shader is a function of (t, angle): ridges
        run along the grain, moss grows on ONE side and mostly low down,
        lichen blotches, rain darkens, sun bleaches. Two sticks of the same
        species are never the same brown.
     3. DETAIL GEOMETRY. Knots, bracket fungi, little toadstools, moss
        cushions, clinging leaves, splintered ends. Small, cheap, and the
        reason picking things up is satisfying.

   The path is built by INTEGRATING a direction rather than by evaluating a
   curve, so the arc length is exactly the length that was rolled. A stick
   that says it is 2.1 m long is 2.1 m of wood, however crooked it is.
*/

import * as THREE from '../../lib/three.module.js?v=1790055608';
import { MeshBuilder, tube, blob, blade, lathe, smoothPath, rotAxis, perp, norm3 } from './Geo.js?v=1790055608';
import { BARK, MOSS, MUSHROOM, LEAF, mixHex, tweak, shade } from './Palette.js?v=1790055608';
import { SPECIES, RARE, MATERIALS } from '../data/StickData.js?v=1790055608';
import { makeRng, clamp, lerp, TAU, smoothstep } from '../core/Util.js?v=1790055608';

/* ========================================================================= */
/* LEVELS OF DETAIL                                                          */
/* ========================================================================= */

const LOD = [
  { segs: 26, radial: 7, forks: true, twigs: 1.0, fungi: true, mossGeo: true, knots: true, ends: true },
  { segs: 15, radial: 5, forks: true, twigs: 0.5, fungi: true, mossGeo: false, knots: true, ends: true },
  { segs: 8, radial: 4, forks: false, twigs: 0, fungi: false, mossGeo: false, knots: false, ends: false },
  { segs: 4, radial: 3, forks: false, twigs: 0, fungi: false, mossGeo: false, knots: false, ends: false },
];

/* ========================================================================= */
/* BARK COLOUR                                                               */
/* ========================================================================= */

/**
 * The colour of the wood at a point on the surface. This one function does
 * more for how the forest floor reads than any amount of geometry: it is
 * where the grain, the moss, the lichen, the rain and the sun all live.
 *
 * @param t   0 at the butt, 1 at the tip
 * @param ang radians around the stick
 */
function barkColor(s, sp, t, ang, N) {
  let c = sp.bark;

  /* --- the rare forms that are defined by their WOOD, not their shape ---- */
  if (s.rare === 'heartwood') c = 0x5a3526;        // dark, dense, oiled-looking
  else if (s.rare === 'driftbone') c = 0xcabea0;   // river-bleached, no bark left
  else if (s.rare === 'knotbraid') c = 0xd3c19a;   // peeled pale, like the photo

  /* --- species hue/brightness shift, per individual stick ---------------- */
  c = tweak(c, { h: s.hue, l: s.lum });

  /* --- longitudinal grain. Ridges run ALONG the stick, so the pattern must
         vary fast in `ang` and slowly in `t` — the other way round gives you
         barber-pole stripes, which is wrong and very noticeable. ---------- */
  const ridgeN = 3 + Math.round(sp.ridge * 7);
  const ridge = Math.sin(ang * ridgeN + N(t * 1.7) * 3.4) * 0.5 + 0.5;
  const groove = Math.pow(ridge, 2.2);
  c = shade(c, -0.30 * sp.ridge * groove + 0.09 * sp.ridge * (1 - groove));

  /* --- coarse blotching along the length --------------------------------- */
  c = shade(c, (N(t * 5.3 + ang * 0.6) - 0.5) * 0.17 * sp.grain);

  /* --- bark worn away in patches, showing the pale wood underneath ------- */
  if (s.pale > 0.02) {
    const wear = smoothstep((N(t * 3.1 + 11 + ang * 0.35) - 0.55 + s.pale * 0.75) * 3);
    if (sp.papery) {
      // birch: pale everywhere, with dark horizontal lenticel dashes
      const dash = Math.pow(Math.max(0, Math.sin(t * 46 + ang * 0.4)), 14) *
        (N(t * 9 + ang) > 0.45 ? 1 : 0);
      c = mixHex(c, BARK.birchMark, dash * 0.8);
    } else {
      c = mixHex(c, tweak(sp.inner, { l: 0.96 }), wear * s.pale);
    }
  }

  /* --- rain: darker, and it pools toward the underside ------------------- */
  if (s.wet > 0.02) {
    const under = 0.5 - 0.5 * Math.cos(ang - s.mossSide);
    c = shade(c, -0.34 * s.wet * (0.45 + under * 0.55));
  }

  /* --- moss. One side, mostly the low side, in patches, and it fades out
         toward the thin tip where nothing can get a hold. ----------------- */
  if (s.moss > 0.02) {
    const side = Math.pow(0.5 + 0.5 * Math.cos(ang - s.mossSide), 1.6);
    const low = 1 - smoothstep((t - 0.45) * 1.9);
    const patch = smoothstep((N(t * 4.1 + 31 + Math.cos(ang) * 1.2) - 0.62 + s.moss * 0.85) * 4.2);
    // capped below 1: the wood must always show through somewhere, or a
    // heavily mossed branch turns into a featureless green worm
    const m = clamp(side * lerp(0.35, 1, low) * patch * s.moss * 1.35, 0, 0.82);
    if (m > 0.01) {
      const deep = N(t * 11 + 7) ;
      c = mixHex(c, mixHex(MOSS.deep, MOSS.bright, deep), m);
    }
  }

  /* --- lichen: pale rosettes, and they prefer the dry upper side --------- */
  if (s.lichen > 0.02) {
    const side = Math.pow(0.5 + 0.5 * Math.cos(ang - s.mossSide - Math.PI), 1.2);
    const patch = smoothstep((N(t * 7.7 + 53 + Math.sin(ang * 1.7) * 2) - 0.70 + s.lichen * 0.6) * 6);
    c = mixHex(c, N(t * 13 + 3) > 0.5 ? MOSS.lichenPale : MOSS.lichenMint, patch * s.lichen * 0.8);
  }

  /* --- charred, on one side only ----------------------------------------- */
  if (s.charred > 0.02) {
    const side = Math.pow(0.5 + 0.5 * Math.cos(ang - (s.mossSide + 2.1)), 1.1);
    const flick = N(t * 6.2 + 71) * 0.4 + 0.6;
    c = mixHex(c, BARK.charred, clamp(side * s.charred * flick * 1.4, 0, 1));
  }

  return c;
}

/* A cheap smooth 1-D noise, seeded per stick. Used for grain and blotching:
   a full noise object per stick would be thousands of permutation tables. */
function noise1(seed) {
  const r = makeRng(seed);
  const a = [], f = [], p = [];
  for (let i = 0; i < 5; i++) {
    a.push(r.range(0.35, 1) / (i + 1));
    f.push(r.range(0.7, 1.4) * Math.pow(1.9, i));
    p.push(r.range(0, TAU));
  }
  let norm = 0; for (const x of a) norm += x;
  return x => {
    let v = 0;
    for (let i = 0; i < 5; i++) v += Math.sin(x * f[i] + p[i]) * a[i];
    return v / norm * 0.5 + 0.5;
  };
}

/* ========================================================================= */
/* THE PATH                                                                  */
/* ========================================================================= */

/**
 * Integrate a crooked path of exactly `length` metres, starting at the origin
 * heading up +Y.
 */
function stickPath(s, segs, r) {
  const pts = [[0, 0, 0]];
  let dir = [0, 1, 0];
  const ds = s.length / segs;

  // primary bend: a steady lean in one plane
  const bendDir = [Math.cos(s.curvePlane), 0, Math.sin(s.curvePlane)];
  const bendPer = (s.curve * 1.25) / segs;

  // wobble: two out-of-phase wanderings, so the crookedness has both a big
  // lazy sweep and a small nervous jitter
  const wf1 = r.range(1.4, 3.1), wf2 = r.range(4.5, 9.0);
  const wp1 = r.range(0, TAU), wp2 = r.range(0, TAU);
  const wa1 = s.wobble * 0.55 / segs, wa2 = s.wobble * 0.30 / segs;
  const wPlane1 = r.range(0, TAU), wPlane2 = r.range(0, TAU);

  const kinkAt = [];
  for (let i = 0; i < s.kinks; i++) kinkAt.push({ t: r.range(0.2, 0.85), ang: r.range(0.18, 0.5) * r.sign(), roll: r.range(0, TAU) });

  for (let i = 1; i <= segs; i++) {
    const t = i / segs;

    // steer toward the bend direction
    let axis = cross(dir, bendDir);
    if (len3(axis) > 1e-6) dir = rotAxis(dir, norm3(axis), bendPer);

    // wobble in two fixed planes
    const w1 = Math.sin(t * wf1 * TAU + wp1) * wa1;
    const w2 = Math.sin(t * wf2 * TAU + wp2) * wa2;
    dir = rotAxis(dir, norm3(cross(dir, [Math.cos(wPlane1), 0, Math.sin(wPlane1)])) || [1, 0, 0], w1);
    const ax2 = cross(dir, [Math.cos(wPlane2), 0, Math.sin(wPlane2)]);
    if (len3(ax2) > 1e-6) dir = rotAxis(dir, norm3(ax2), w2);

    // sharp kinks — an old break that healed, or where it hit a rock
    for (const k of kinkAt) {
      if (t > k.t && (i - 1) / segs <= k.t) {
        const ax = cross(dir, [Math.cos(k.roll), 0, Math.sin(k.roll)]);
        if (len3(ax) > 1e-6) dir = rotAxis(dir, norm3(ax), k.ang);
      }
    }

    dir = norm3(dir);
    const p = pts[i - 1];
    pts.push([p[0] + dir[0] * ds, p[1] + dir[1] * ds, p[2] + dir[2] * ds]);
  }
  return pts;
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len3 = a => Math.hypot(a[0], a[1], a[2]);

/* ========================================================================= */
/* RADIUS                                                                    */
/* ========================================================================= */

function radiusFn(s, sp, N, r) {
  const knots = s.knots;
  const braid = s.rare === 'knotbraid' ? s.extra.braid : null;
  const ringFlat = s.rare === 'ringbough' ? s.extra.ring : null;

  return t => {
    // A stick does not taper linearly: it is nearly parallel for most of its
    // length and then runs out quickly. ^1.6 puts the loss at the thin end.
    let rr = s.thick * (1 - s.taper * Math.pow(t, 1.6));

    // organic irregularity: no real branch has a constant diameter
    rr *= 0.92 + N(t * 8.5 + 2) * 0.18;

    // knots: a smooth bulge, not a lump stuck on
    for (const k of knots) {
      const d = (t - k.at) / (0.045 + k.size * 0.03);
      if (Math.abs(d) < 3) rr *= 1 + k.size * 0.55 * Math.exp(-d * d);
    }

    // Inside the braid the shaft IS the core, and the core is thin — the
    // strands supply the volume. Leaving the shaft at full width here is what
    // made the first version a smooth spindle with a wire wrapped round it.
    if (braid) {
      const u = (t - braid.from) / Math.max(0.05, braid.to - braid.from);
      if (u > 0 && u < 1) rr *= lerp(1, 0.54, Math.sin(clamp(u, 0, 1) * Math.PI));
    }

    if (ringFlat) rr *= 1.15;
    return Math.max(0.0032, rr);
  };
}

/* ========================================================================= */
/* MAIN ENTRY                                                                */
/* ========================================================================= */

/**
 * Build a stick into a MeshBuilder, lying along +Y with its butt at the
 * origin.
 *
 * @param {object} spec        from rollStick()
 * @param {MeshBuilder} b      solid geometry goes here
 * @param {object} opts
 * @param {number} opts.lod    0 (full) .. 3 (a few triangles)
 * @param {MeshBuilder} opts.glow  optional; emissive bits (foxfire) go here
 * @param {boolean} opts.noRare    build the plain body only (for weapon shafts)
 * @returns {{length:number, tip:number[], path:number[][], radius:function}}
 */
export function buildStick(spec, b, opts = {}) {
  const s = spec;
  const sp = SPECIES[s.species] || SPECIES.oak;
  const lod = LOD[clamp(opts.lod ?? 0, 0, 3)];
  const r = makeRng(s.seed ^ 0xa11ce);
  const N = noise1(s.seed ^ 0x9a77);
  const glow = opts.glow || null;
  const rare = opts.noRare ? null : s.rare;

  const segs = Math.max(4, Math.round(lod.segs * clamp(s.length / 1.4, 0.55, 1.8)));
  const path = stickPath(s, segs, r);
  /* `radiusMul` is how a weapon carves a tang. The blade has to be built
     AROUND the shaft or the bark shows through its flats, but a blade as
     thick as the branch it came from is not a blade — so the weapon builder
     pinches the shaft down to a tang over the length the blade covers, and
     everything else (moss, fungi, knots, the seam of ore) still follows the
     same path in the same places. */
  const base = radiusFn(s, sp, N, r);
  const rad = opts.radiusMul ? (t => base(t) * opts.radiusMul(t)) : base;
  const radial = lod.radial;

  const colorAt = (t, i, ang) => barkColor(s, sp, t, ang, N);

  /* --- bark relief. The same ridge pattern the colour uses, but pushed into
         the geometry, so a deeply furrowed oak has a lumpy SILHOUETTE and a
         smooth driftbone does not. Skipped below LOD 1 (at that distance a
         ridge is a quarter of a pixel). --------------------------------- */
  const ridgeN = 3 + Math.round(sp.ridge * 7);
  const relief = (s.rare === 'driftbone' || s.rare === 'knotbraid') ? 0 : sp.ridge * 0.11;
  const bump = (radial >= 5 && relief > 0)
    ? (t, ang) => 1 + relief * (Math.sin(ang * ridgeN + N(t * 1.7) * 3.4) * 0.5 + 0.5)
      + (N(t * 14 + ang * 0.7) - 0.5) * 0.07
    : null;

  /* --- cross-section: everything is a bit oval, some things very --------- */
  let squash = null;
  if (rare === 'ringbough') {
    const f = s.extra.ring.flat;
    squash = t => [1 + (1 - f) * 0.35, f];
  } else if (rare === 'lightningsplit') {
    squash = () => [1.05, 0.9];
  } else {
    const ov = r.range(0.86, 1.0), ph = r.range(0, TAU);
    squash = t => [1, ov + (1 - ov) * (Math.sin(t * 3 + ph) * 0.5 + 0.5)];
  }

  /* ---------------------------------------------------------------------- */
  /* THE SHAFT                                                              */
  /* ---------------------------------------------------------------------- */

  if (rare === 'ringbough') {
    buildRingbough(b, s, sp, path, rad, radial, colorAt, squash, bump);
  } else if (rare === 'lightningsplit') {
    buildSplit(b, s, sp, path, rad, radial, colorAt, r, N, bump);
  } else {
    tube(b, {
      pts: path, radius: rad, radial, color: colorAt, squash, bump,
      capStart: s.brokenButt === 'clean', capEnd: s.brokenEnd === 'clean',
      sway: () => 0,
    });
  }

  /* ---------------------------------------------------------------------- */
  /* BROKEN ENDS                                                            */
  /* ---------------------------------------------------------------------- */

  if (lod.ends) {
    buildEnd(b, s, sp, path, rad, radial, r, N, false, s.brokenButt);
    if (rare !== 'maulhead' || s.extra.burl.at !== 1) {
      buildEnd(b, s, sp, path, rad, radial, r, N, true, s.brokenEnd);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* RARE FEATURES                                                          */
  /* ---------------------------------------------------------------------- */

  if (rare === 'serpentcoil') buildCoil(b, s, sp, path, rad, radial, r, N);
  if (rare === 'maulhead') buildBurl(b, s, sp, path, rad, r, N, colorAt);
  if (rare === 'besom') buildBristles(b, s, sp, path, rad, r, lod);
  if (rare === 'knotbraid') buildBraid(b, s, sp, path, rad, radial, r, N);
  if (rare === 'moonpale' && glow) buildFoxfireVeins(glow, s, path, rad, r);
  if (rare === 'driftbone') { /* handled entirely by colour + shape */ }

  /* ---------------------------------------------------------------------- */
  /* BRANCHES                                                               */
  /* ---------------------------------------------------------------------- */

  if (lod.forks) {
    for (const f of s.forks) buildFork(b, s, sp, path, rad, f, radial, r, N, 0, lod, glow);
  }

  if (lod.twigs > 0) {
    const keep = Math.ceil(s.twigs.length * lod.twigs);
    for (let i = 0; i < keep; i++) buildTwig(b, s, sp, path, rad, s.twigs[i], r, N, lod);
  }

  /* ---------------------------------------------------------------------- */
  /* SURFACE DETAIL                                                         */
  /* ---------------------------------------------------------------------- */

  if (lod.knots) buildKnots(b, s, sp, path, rad, r, N);
  if (lod.fungi && s.fungi.length) {
    for (const f of s.fungi) buildFungus(b, glow, s, path, rad, f, r);
  }
  if (lod.mossGeo && s.moss > 0.3) buildMossCushions(b, s, path, rad, r, N);

  /* The special material lives HERE, in the stick builder, rather than in the
     weapon builder — because the weapon's shaft is built by this same
     function. Put the crystal on the stick and it is automatically on the
     blade that stick becomes, in the same places, the same size, growing the
     same way. That is the whole reason a finished weapon is recognisable as
     the thing you picked up. */
  if (s.special && s.inclusions?.length) {
    buildInclusions(b, glow, s, path, rad, r, N, lod);
  }

  return {
    length: s.length,
    path,
    radius: rad,
    tip: path[path.length - 1],
  };
}

/* ========================================================================= */
/* PIECES                                                                    */
/* ========================================================================= */

/** Point and frame at parameter t along the path. */
function frameAt(path, t) {
  const n = path.length;
  const u = clamp(t, 0, 1) * (n - 1);
  const i = Math.min(n - 2, Math.floor(u));
  const f = u - i;
  const p = [
    lerp(path[i][0], path[i + 1][0], f),
    lerp(path[i][1], path[i + 1][1], f),
    lerp(path[i][2], path[i + 1][2], f),
  ];
  const d = norm3([
    path[i + 1][0] - path[i][0],
    path[i + 1][1] - path[i][1],
    path[i + 1][2] - path[i][2],
  ]);
  const a = perp(d);
  const bb = norm3(cross(d, a));
  return { p, d, a, b: bb };
}

/* ========================================================================= */
/* SPECIAL MATERIALS                                                         */
/* ========================================================================= */

/**
 * Whatever got into the wood, given real geometry.
 *
 * Four shapes, because four is enough to make eight materials look like eight
 * different things and a fifth would only be a variation:
 *
 *   shard  — crystal, growing OUT of the grain at an angle, faceted
 *   bead   — amber, a swelling drop that has run and set
 *   crust  — stone and rime, a flat scabbed patch lying ON the surface
 *   seam   — ore and fire, a line running ALONG the shaft, in the wood
 *
 * A glowing material puts its geometry in the glow builder instead, which is
 * the only reason any of this is ever emissive. Nothing here is a halo over
 * the whole stick: if it glows, a specific SOLID OBJECT glows, and it is a
 * thing you could point at.
 */
function buildInclusions(b, glow, s, path, rad, r, N, lod) {
  const M = MATERIALS[s.special];
  if (!M) return;
  const lit = M.glow > 0.45 && glow ? glow : b;
  const hex = M.hex;
  const radial = lod.radial >= 5 ? 5 : 3;

  for (const inc of s.inclusions) {
    const fr = frameAt(path, inc.at);
    const rr = rad(inc.at);
    const roll = inc.roll;
    // out of the shaft, in the rolled direction
    const ox = fr.a[0] * Math.cos(roll) + fr.b[0] * Math.sin(roll);
    const oy = fr.a[1] * Math.cos(roll) + fr.b[1] * Math.sin(roll);
    const oz = fr.a[2] * Math.cos(roll) + fr.b[2] * Math.sin(roll);

    if (M.form === 'shard') {
      /* A cluster of faceted spikes leaning off the shaft. Lathe with a
         hard-edged profile and very few sides is what makes it read as
         crystal rather than as a lump. */
      const n = r.int(2, 4);
      for (let k = 0; k < n; k++) {
        const len = rr * inc.size * r.range(1.6, 4.2);
        const wid = rr * inc.size * r.range(0.22, 0.5);
        const lean = inc.tilt + r.range(-0.5, 0.5);
        const base = [
          fr.p[0] + ox * rr * 0.75, fr.p[1] + oy * rr * 0.75, fr.p[2] + oz * rr * 0.75,
        ];
        const dir = [
          ox + fr.d[0] * lean, oy + fr.d[1] * lean, oz + fr.d[2] * lean,
        ];
        const sub = new MeshBuilder();
        sub.color(hex, 0.10, r);
        lathe(sub, [
          [wid * 0.9, 0], [wid, len * 0.25], [wid * 0.72, len * 0.72], [0.0005, len],
        ], r.chance(0.5) ? 5 : 6, 0, 0);
        lit.append(sub, orientMatrix(base, dir, r.range(0, TAU)));
      }
    } else if (M.form === 'bead') {
      /* A drop that welled out and set. Slightly squashed against the wood,
         and it catches a highlight, which is the whole appeal of amber. */
      const sz = rr * inc.size * r.range(0.6, 1.2);
      lit.color(hex, 0.07, r);
      blob(b === lit ? b : lit,
        fr.p[0] + ox * rr * 0.8, fr.p[1] + oy * rr * 0.8, fr.p[2] + oz * rr * 0.8,
        sz, radial - 1, radial + 1, (x, y, z) => [1.15, 0.8, 1.15], 0);
      // the run below it
      const runN = r.int(1, 3);
      for (let k = 1; k <= runN; k++) {
        const t2 = clamp(inc.at - k * 0.022, 0.02, 0.98);
        const f2 = frameAt(path, t2);
        const r2 = rad(t2);
        lit.color(shade(hex, -0.08), 0.06, r);
        blob(b === lit ? b : lit,
          f2.p[0] + ox * r2 * 0.75, f2.p[1] + oy * r2 * 0.75, f2.p[2] + oz * r2 * 0.75,
          sz * (0.65 - k * 0.14), radial - 1, radial, null, 0);
      }
    } else if (M.form === 'crust') {
      /* A scabbed patch lying flat on the bark — several overlapping plates
         rather than one dome, so the edge is ragged the way a real crust is. */
      const n = r.int(5, 10);
      for (let k = 0; k < n; k++) {
        const t2 = clamp(inc.at + r.range(-1, 1) * inc.len * 0.5, 0.02, 0.98);
        const f2 = frameAt(path, t2);
        const r2 = rad(t2);
        const a2 = roll + r.range(-0.8, 0.8);
        const o2 = [
          f2.a[0] * Math.cos(a2) + f2.b[0] * Math.sin(a2),
          f2.a[1] * Math.cos(a2) + f2.b[1] * Math.sin(a2),
          f2.a[2] * Math.cos(a2) + f2.b[2] * Math.sin(a2),
        ];
        lit.color(tweak(hex, { l: r.range(0.82, 1.18) }), 0.09, r);
        blob(lit,
          f2.p[0] + o2[0] * r2 * 0.92, f2.p[1] + o2[1] * r2 * 0.92, f2.p[2] + o2[2] * r2 * 0.92,
          r2 * inc.size * r.range(0.55, 1.15), 2, radial,
          (x, y, z) => [1.3, 0.35, 1.3], 0);      // flattened against the shaft
      }
    } else {
      /* A seam or a vein: a line running ALONG the wood, half-buried, so it
         has to follow the path rather than sit on one point of it. */
      const t0 = clamp(inc.at - inc.len * 0.5, 0.01, 0.97);
      const t1 = clamp(t0 + inc.len, 0.03, 0.99);
      const steps = 9;
      const pts = [];
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const t2 = lerp(t0, t1, u);
        const f2 = frameAt(path, t2);
        const r2 = rad(t2);
        // it wanders round the shaft as it runs, like grain does
        const a2 = roll + Math.sin(u * 3.1 + inc.tilt * 4) * 0.55;
        pts.push([
          f2.p[0] + (f2.a[0] * Math.cos(a2) + f2.b[0] * Math.sin(a2)) * r2 * 0.94,
          f2.p[1] + (f2.a[1] * Math.cos(a2) + f2.b[1] * Math.sin(a2)) * r2 * 0.94,
          f2.p[2] + (f2.a[2] * Math.cos(a2) + f2.b[2] * Math.sin(a2)) * r2 * 0.94,
        ]);
      }
      lit.color(hex, 0.08, r);
      tube(lit, {
        pts,
        radius: u => rad(lerp(t0, t1, u)) * inc.size * 0.30 * (0.45 + Math.sin(u * Math.PI) * 0.85),
        radial: 4, capStart: true, capEnd: true, sway: () => 0,
        color: u => shade(hex, Math.sin(u * 9) * 0.10),
      });
    }
  }
}

/** A direction that leaves the shaft at angle `ang`, rolled to `roll`. */
function branchDir(fr, ang, roll) {
  const out = [
    fr.a[0] * Math.cos(roll) + fr.b[0] * Math.sin(roll),
    fr.a[1] * Math.cos(roll) + fr.b[1] * Math.sin(roll),
    fr.a[2] * Math.cos(roll) + fr.b[2] * Math.sin(roll),
  ];
  const axis = norm3(cross(fr.d, out));
  return norm3(rotAxis(fr.d, axis, ang));
}

/* ------------------------------------------------------------------ forks */

function buildFork(b, s, sp, path, rad, f, radial, r, N, depth, lod, glow) {
  const fr = frameAt(path, f.at);
  const baseR = rad(f.at) * f.thick;
  if (baseR < 0.0035) return;
  let dir = branchDir(fr, f.ang, f.roll);

  const segs = Math.max(4, Math.round(10 - depth * 3));
  const pts = [fr.p.slice()];
  const ds = f.len / segs;
  // a branch droops as it goes: gravity is the most reliable shape cue there is
  const droop = f.curve * 0.9 + 0.25;
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    const ax = cross(dir, [0, -1, 0]);
    if (len3(ax) > 1e-6) dir = norm3(rotAxis(dir, norm3(ax), -droop / segs));
    const w = Math.sin(t * 7 + f.roll) * 0.10 * s.wobble / segs;
    const ax2 = cross(dir, [Math.cos(f.roll + 1.6), 0, Math.sin(f.roll + 1.6)]);
    if (len3(ax2) > 1e-6) dir = norm3(rotAxis(dir, norm3(ax2), w));
    const p = pts[i - 1];
    pts.push([p[0] + dir[0] * ds, p[1] + dir[1] * ds, p[2] + dir[2] * ds]);
  }

  const smooth = smoothPath(pts, Math.max(5, segs + 2));
  const rN = Math.max(3, radial - 1 - depth);
  tube(b, {
    pts: smooth,
    radius: t => Math.max(0.0028, baseR * (1 - 0.7 * Math.pow(t, 1.4)) * (0.94 + N(t * 9 + f.at * 20) * 0.12)),
    radial: rN,
    color: (t, i, ang) => barkColor(s, sp, lerp(f.at, Math.min(1, f.at + 0.3), t), ang + f.roll, N),
    capStart: false, capEnd: true,
    sway: () => 0,
  });

  // the collar where a branch meets the trunk — a real fork is swollen there
  if (depth === 0) {
    const cR = rad(f.at) * lerp(1.12, 1.35, f.thick);
    b.color(barkColor(s, sp, f.at, f.roll, N), 0.04, r);
    blob(b, fr.p[0], fr.p[1], fr.p[2], cR, 4, 6,
      (x, y, z) => 1 + 0.5 * Math.max(0, x * dir[0] + y * dir[1] + z * dir[2]));
  }

  if (f.sub > 0 && depth < 1) {
    for (let i = 0; i < f.sub; i++) {
      buildFork(b, s, sp, smooth, t => baseR * (1 - 0.7 * t), {
        at: r.range(0.35, 0.8), len: f.len * r.range(0.35, 0.6),
        ang: r.range(0.4, 1.0), roll: r.range(0, TAU),
        thick: r.range(0.45, 0.7), curve: r.range(0.2, 0.7), sub: 0,
      }, radial, r, N, depth + 1, lod, glow);
    }
  }
}

/* ------------------------------------------------------------------ twigs */

function buildTwig(b, s, sp, path, rad, tw, r, N, lod) {
  const fr = frameAt(path, tw.at);
  const baseR = Math.max(0.0022, rad(tw.at) * 0.22);
  let dir = branchDir(fr, tw.ang, tw.roll);
  const segs = 4;
  const pts = [fr.p.slice()];
  const ds = tw.len / segs;
  for (let i = 1; i <= segs; i++) {
    const ax = cross(dir, [0, -1, 0]);
    if (len3(ax) > 1e-6) dir = norm3(rotAxis(dir, norm3(ax), -0.22));
    const p = pts[i - 1];
    pts.push([p[0] + dir[0] * ds, p[1] + dir[1] * ds, p[2] + dir[2] * ds]);
  }
  tube(b, {
    pts, radius: t => baseR * (1 - 0.8 * t), radial: 3,
    color: t => shade(barkColor(s, sp, tw.at, tw.roll, N), -0.05 - t * 0.1),
    capStart: false, capEnd: false, sway: () => 0,
  });

  if (tw.leafy && s.leaves > 0) {
    const tip = pts[pts.length - 1];
    const leafHex = tweak(sp.leaf, { h: (N(tw.at * 7) - 0.5) * 0.06, l: 0.8 + N(tw.at * 3) * 0.5 });
    for (let i = 0; i < tw.leafy; i++) {
      const lt = 0.4 + (i / Math.max(1, tw.leafy)) * 0.6;
      const fr2 = frameAt(pts, lt);
      const d = branchDir(fr2, 1.1, tw.roll + i * 2.1);
      const sub = new MeshBuilder();
      // fallen leaves are past their best: dried at the edges
      sub.color(mixHex(leafHex, LEAF.dead, 0.35 + 0.5 * (1 - s.leaves)), 0.10, r);
      blade(sub, { len: 0.055 + r.range(0, 0.035), wid: 0.022, segs: 2, curl: 0.5, cup: 0.35, swayBase: 0.3, swayTip: 1 });
      const m = orientMatrix(fr2.p, d, r.range(0, TAU));
      b.append(sub, m);
    }
  }
}

/* ------------------------------------------------------------------ knots */

function buildKnots(b, s, sp, path, rad, r, N) {
  for (const k of s.knots) {
    if (k.size < 0.7) continue;
    const fr = frameAt(path, k.at);
    const rr = rad(k.at);
    const dir = branchDir(fr, 1.35, k.roll);
    const px = fr.p[0] + dir[0] * rr * 0.75;
    const py = fr.p[1] + dir[1] * rr * 0.75;
    const pz = fr.p[2] + dir[2] * rr * 0.75;
    const size = rr * (0.42 + k.size * 0.30);
    // the scar of a branch that broke off years ago: a dark ring with a
    // paler, slightly sunken centre
    b.color(shade(barkColor(s, sp, k.at, k.roll, N), -0.34), 0.06, r);
    blob(b, px, py, pz, size, 4, 6, (x, y, z) => {
      const d = x * dir[0] + y * dir[1] + z * dir[2];
      return 1 - 0.45 * Math.max(0, d) + 0.2 * (1 - Math.abs(d));
    });
    b.color(mixHex(sp.inner, BARK.deadWood, 0.4), 0.08, r);
    blob(b, px + dir[0] * size * 0.35, py + dir[1] * size * 0.35, pz + dir[2] * size * 0.35,
      size * 0.48, 3, 5, () => [1, 0.55, 1]);
  }
}

/* ------------------------------------------------------------- broken end */

function buildEnd(b, s, sp, path, rad, radial, r, N, atTip, kind) {
  const t = atTip ? 1 : 0;
  const fr = frameAt(path, atTip ? 0.995 : 0.005);
  const rr = rad(t);
  const dir = atTip ? fr.d : [-fr.d[0], -fr.d[1], -fr.d[2]];
  const p = atTip ? path[path.length - 1] : path[0];
  const inner = tweak(sp.inner, { l: 0.9 + N(t * 5) * 0.3 });

  if (kind === 'clean') {
    // the tube already capped it; just recolour with a growth-ring pattern
    b.color(inner, 0.05, r);
    const rings = [];
    for (let k = 0; k <= 2; k++) rings.push([rr * (1 - k * 0.42), 0]);
    return;
  }

  if (kind === 'rot') {
    // hollowed out — a ring of soft crumbly edge around a dark hole
    b.color(shade(inner, -0.5), 0.1, r);
    const ring = [];
    const cen = b.vert(p[0] - dir[0] * rr * 0.5, p[1] - dir[1] * rr * 0.5, p[2] - dir[2] * rr * 0.5);
    for (let i = 0; i < radial; i++) {
      const a = (i / radial) * TAU;
      const rw = rr * (0.75 + N(i * 2.3 + t * 9) * 0.4);
      ring.push(b.vert(
        p[0] + fr.a[0] * Math.cos(a) * rw + fr.b[0] * Math.sin(a) * rw,
        p[1] + fr.a[1] * Math.cos(a) * rw + fr.b[1] * Math.sin(a) * rw,
        p[2] + fr.a[2] * Math.cos(a) * rw + fr.b[2] * Math.sin(a) * rw));
    }
    for (let i = 0; i < radial; i++) {
      const j = (i + 1) % radial;
      if (atTip) b.tri(cen, ring[i], ring[j]); else b.tri(cen, ring[j], ring[i]);
    }
    return;
  }

  /* snap / splinter / torn — a fan of slivers of wood */
  const nsp = kind === 'splinter' ? r.int(4, 7) : kind === 'torn' ? r.int(3, 5) : r.int(2, 4);
  const maxLen = rr * (kind === 'splinter' ? r.range(5, 11) : kind === 'torn' ? r.range(2.5, 4.5) : r.range(1.2, 2.6));
  for (let i = 0; i < nsp; i++) {
    const a = (i / nsp) * TAU + r.range(-0.4, 0.4);
    const off = rr * r.range(0.25, 0.85);
    const ox = fr.a[0] * Math.cos(a) * off + fr.b[0] * Math.sin(a) * off;
    const oy = fr.a[1] * Math.cos(a) * off + fr.b[1] * Math.sin(a) * off;
    const oz = fr.a[2] * Math.cos(a) * off + fr.b[2] * Math.sin(a) * off;
    const L = maxLen * r.range(0.35, 1);
    const spread = r.range(-0.18, 0.18);
    const sd = norm3([
      dir[0] + fr.a[0] * spread, dir[1] + fr.a[1] * spread, dir[2] + fr.a[2] * spread,
    ]);
    const a0 = [p[0] + ox, p[1] + oy, p[2] + oz];
    const a1 = [a0[0] + sd[0] * L, a0[1] + sd[1] * L, a0[2] + sd[2] * L];
    tube(b, {
      pts: [a0, [lerp(a0[0], a1[0], 0.6), lerp(a0[1], a1[1], 0.6), lerp(a0[2], a1[2], 0.6)], a1],
      radius: tt => Math.max(0.0012, rr * r.range(0.14, 0.3) * (1 - tt * 0.92)),
      radial: 3,
      color: tt => mixHex(inner, sp.bark, 0.15 + tt * 0.25),
      capStart: false, capEnd: false, sway: () => 0,
    });
  }
  // the torn face itself
  b.color(inner, 0.07, r);
  const ring = [];
  const cen = b.vert(p[0] + dir[0] * rr * 0.18, p[1] + dir[1] * rr * 0.18, p[2] + dir[2] * rr * 0.18);
  for (let i = 0; i < radial; i++) {
    const a = (i / radial) * TAU;
    const rw = rr * (0.9 + N(i * 3.1 + 17) * 0.2);
    const jag = dir.map(d => d * rr * (N(i * 5.7 + 3) - 0.4) * 0.8);
    ring.push(b.vert(
      p[0] + fr.a[0] * Math.cos(a) * rw + fr.b[0] * Math.sin(a) * rw + jag[0],
      p[1] + fr.a[1] * Math.cos(a) * rw + fr.b[1] * Math.sin(a) * rw + jag[1],
      p[2] + fr.a[2] * Math.cos(a) * rw + fr.b[2] * Math.sin(a) * rw + jag[2]));
  }
  for (let i = 0; i < radial; i++) {
    const j = (i + 1) % radial;
    if (atTip) b.tri(cen, ring[i], ring[j]); else b.tri(cen, ring[j], ring[i]);
  }
}

/* ------------------------------------------------------------------ fungi */

function buildFungus(b, glow, s, path, rad, f, r) {
  const fr = frameAt(path, f.at);
  const rr = rad(f.at);
  const out = branchDir(fr, 1.5, f.roll);
  const up = [0, 1, 0];
  const px = fr.p[0] + out[0] * rr * 0.9;
  const py = fr.p[1] + out[1] * rr * 0.9;
  const pz = fr.p[2] + out[2] * rr * 0.9;

  if (f.kind === 'bracket') {
    // A shelf fungus: a flattened half-disc growing straight out, with a pale
    // lip and concentric banding on top.
    //
    // The absolute clamp matters more than the ratio. Scaling a fungus purely
    // off the stick radius gave a 27-centimetre bracket on a thick limb,
    // which read as a grey dinner plate nailed to a branch. Real ones are
    // 2–8 cm whatever they are growing on.
    const R = clamp(rr * (0.9 + f.size * 1.2), 0.018, 0.075);
    const sub = new MeshBuilder();
    const band = (t) => mixHex(MUSHROOM.bracketTop, MUSHROOM.bracketLip, Math.pow(t, 2.2) * 0.9);
    const rings = 4;
    const prev = [];
    for (let k = 0; k <= rings; k++) {
      const t = k / rings;
      const rr2 = R * t;
      const row = [];
      sub.color(band(t), 0.05, r);
      for (let i = 0; i <= 7; i++) {
        const a = -Math.PI * 0.5 + (i / 7) * Math.PI;
        const h = (1 - t * t) * R * 0.22 - t * R * 0.10;
        row.push(sub.vert(Math.cos(a) * rr2, h, Math.sin(a) * rr2 * 0.85));
      }
      if (k > 0) for (let i = 0; i < 7; i++) sub.quad(prev[i], prev[i + 1], row[i + 1], row[i]);
      prev.length = 0; prev.push(...row);
    }
    // underside, paler
    sub.color(MUSHROOM.bracketLip, 0.05, r);
    const under = [];
    for (let i = 0; i <= 7; i++) {
      const a = -Math.PI * 0.5 + (i / 7) * Math.PI;
      under.push(sub.vert(Math.cos(a) * R, -R * 0.13, Math.sin(a) * R * 0.85));
    }
    const c0 = sub.vert(0, -R * 0.02, 0);
    for (let i = 0; i < 7; i++) sub.tri(c0, under[i + 1], under[i]);
    b.append(sub, orientMatrix([px, py, pz], out, 0, up));
    return;
  }

  if (f.kind === 'glow') {
    const R = clamp(rr * (0.5 + f.size * 0.7), 0.010, 0.040);
    const target = glow || b;
    target.color(MUSHROOM.glowCap, 0.08, r);
    blob(target, px + out[0] * R * 0.6, py + out[1] * R * 0.6 + R * 0.5, pz + out[2] * R * 0.6,
      R, 3, 6, (x, y) => [1, y > 0 ? 0.65 : 0.35, 1]);
    target.color(MUSHROOM.glowStem, 0.05, r);
    return;
  }

  /* little toadstools and puffballs standing up off the wood. Small: the
     charm is in noticing them, not in being hit by them. */
  const scale = clamp(rr * (0.45 + f.size * 0.55), 0.008, 0.032);
  const sub = new MeshBuilder();
  const capH = scale * (f.kind === 'puffball' ? 1.0 : 0.62);
  const capR = scale * (f.kind === 'inkcap' ? 0.55 : f.kind === 'puffball' ? 0.95 : 0.85);
  const stemH = scale * (f.kind === 'puffball' ? 0.25 : f.kind === 'inkcap' ? 1.5 : 0.9);

  sub.color(f.kind === 'inkcap' ? MUSHROOM.inkcapStem : MUSHROOM.flyAgaricStem, 0.07, r);
  lathe(sub, [[scale * 0.13, 0], [scale * 0.09, stemH * 0.6], [scale * 0.10, stemH]], 5);

  const capHex = f.kind === 'inkcap' ? MUSHROOM.inkcapCap
    : f.kind === 'puffball' ? MUSHROOM.puffball
      : r.chance(0.25) ? MUSHROOM.flyAgaricCap
        : r.chance(0.5) ? MUSHROOM.boleteCap : MUSHROOM.chanterelle;
  sub.color(capHex, 0.08, r);
  const prof = f.kind === 'inkcap'
    ? [[0.001, stemH + capH], [capR * 0.5, stemH + capH * 0.55], [capR, stemH], [capR * 0.92, stemH - capH * 0.15]]
    : [[0.001, stemH + capH], [capR * 0.62, stemH + capH * 0.72], [capR, stemH + capH * 0.22], [capR * 0.95, stemH]];
  lathe(sub, prof, 6);

  // fly agaric gets its spots — three tiny pale domes on the cap
  if (capHex === MUSHROOM.flyAgaricCap) {
    sub.color(MUSHROOM.flyAgaricSpot, 0.05, r);
    for (let i = 0; i < 4; i++) {
      const a = r.range(0, TAU), rr2 = capR * r.range(0.2, 0.75);
      blob(sub, Math.cos(a) * rr2, stemH + capH * (0.62 - (rr2 / capR) * 0.3), Math.sin(a) * rr2,
        capR * 0.13, 2, 4, () => [1, 0.5, 1]);
    }
  }

  b.append(sub, orientMatrix([px, py, pz], out, r.range(0, TAU), up));
}

/* ------------------------------------------------------------ moss geometry */

/** Real moss is fuzzy, and a flat green patch never reads as fuzzy. These are
 *  tiny squashed domes clustered on the mossy side — cheap, and they catch
 *  the light along their edges, which is the whole effect. */
function buildMossCushions(b, s, path, rad, r, N) {
  // Many small cushions, not a few big ones. The first version used blobs up
  // to a whole shaft radius across and they read as bright plastic beads
  // stuck to the wood — moss is a TEXTURE, and a texture needs to be finer
  // than the thing it is growing on.
  const n = Math.round(s.moss * 30 * clamp(s.length, 0.4, 3));
  for (let i = 0; i < n; i++) {
    const t = r.range(0.02, 0.95);
    const low = 1 - smoothstep((t - 0.5) * 2);
    if (r() > low * 0.85 + 0.15) continue;
    const roll = s.mossSide + r.bell() * 1.15;
    const fr = frameAt(path, t);
    const rr = rad(t);
    const out = branchDir(fr, 1.5, roll);
    const size = rr * r.range(0.16, 0.42);
    // deep greens, low jitter: bright moss in sunlight is still a dark colour
    b.color(mixHex(MOSS.deep, MOSS.mid, r.pow(1.6)), 0.09, r);
    blob(b,
      fr.p[0] + out[0] * rr * 0.96, fr.p[1] + out[1] * rr * 0.96, fr.p[2] + out[2] * rr * 0.96,
      size, 3, 6, (x, y, z) => {
        const d = x * out[0] + y * out[1] + z * out[2];
        // pressed flat against the wood, and lumpy on the exposed face
        return (d > 0 ? 0.85 : 0.22) * (0.8 + 0.35 * Math.sin(x * 14) * Math.sin(z * 17));
      });
  }
}

/* ========================================================================= */
/* RARE FORMS                                                                */
/* ========================================================================= */

/** SERPENTCOIL — a vine that strangled the sapling, now grown into it. */
function buildCoil(b, s, sp, path, rad, radial, r, N) {
  const c = s.extra.coil;
  // Enough steps that a 5-turn helix still has ~14 rings per turn; too few
  // and the spiral reads as a chain of sausages.
  const steps = Math.max(48, Math.round(c.turns * 16));
  const pts = [];
  const rads = [];
  // one stable perpendicular basis for the whole helix: recomputing a frame
  // per point makes the vine wobble off the shaft wherever the shaft bends
  const base = frameAt(path, 0.5);
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const t = lerp(c.from, c.to, u);
    const fr = frameAt(path, t);
    const rr = rad(t);
    const vineR = rr * c.thick * (0.8 + 0.3 * Math.sin(u * 9 + 1));
    const a = u * c.turns * TAU * c.dir;
    // The vine sits ON the shaft, not inside it: its centre is one shaft
    // radius plus most of its own radius out. Anything less and the spiral
    // disappears into the wood, which is exactly what it did the first time.
    const off = rr + vineR * 0.82;
    pts.push([
      fr.p[0] + (base.a[0] * Math.cos(a) + base.b[0] * Math.sin(a)) * off,
      fr.p[1] + (base.a[1] * Math.cos(a) + base.b[1] * Math.sin(a)) * off,
      fr.p[2] + (base.a[2] * Math.cos(a) + base.b[2] * Math.sin(a)) * off,
    ]);
    rads.push(vineR);
  }
  const vineHex = mixHex(tweak(sp.bark, { l: 1.22, s: 0.7 }), BARK.deadWood, c.dry * 0.6);
  tube(b, {
    pts, radius: t => rads[clamp(Math.round(t * steps), 0, steps)] * (1 - 0.30 * Math.pow(t, 3)),
    radial: Math.max(5, radial - 1),
    color: (t, i, ang) => {
      // the vine is drier and paler than the host, with its own tight grain
      let col = shade(vineHex, Math.sin(ang * 5 + t * 30) * 0.12);
      if (s.moss > 0.3) col = mixHex(col, MOSS.mid, s.moss * 0.3 * (0.5 + 0.5 * Math.sin(t * 17)));
      return col;
    },
    // the vine is not round: it is flattened where it bit into the tree
    squash: () => [1, 0.78],
    capStart: true, capEnd: true, sway: () => 0,
  });

  /* The other half of what the photograph shows: the HOST remembers. The
     shaft swells between the coils and is pinched underneath them, which is
     why a serpentcoil stave still looks spiral even where the vine has
     rotted away. Built as a second, slightly inset sleeve. */
  const sleeveSteps = steps;
  const sleeve = [];
  for (let i = 0; i <= sleeveSteps; i++) sleeve.push(frameAt(path, lerp(c.from, c.to, i / sleeveSteps)).p);
  tube(b, {
    pts: sleeve,
    radius: u => rad(lerp(c.from, c.to, u)) * 1.02,
    radial: Math.max(6, radial),
    color: (u, i, ang) => {
      const t = lerp(c.from, c.to, u);
      const a = u * c.turns * TAU * c.dir;
      // distance in angle from the vine, wrapped
      let d = Math.abs(((ang - a + Math.PI) % TAU + TAU) % TAU - Math.PI);
      const under = smoothstep((0.75 - d) * 2.2);
      return mixHex(barkColor(s, sp, t, ang, N), BARK.wet, under * 0.35);
    },
    bump: (u, ang) => {
      const a = u * c.turns * TAU * c.dir;
      let d = Math.abs(((ang - a + Math.PI) % TAU + TAU) % TAU - Math.PI);
      // pinched under the vine, swollen on either side of it
      return 1 - 0.14 * smoothstep((0.7 - d) * 2.4) + 0.07 * smoothstep((d - 1.1) * 2.0);
    },
    capStart: false, capEnd: false, sway: () => 0,
  });
}

/**
 * KNOTBRAID — several stems that grew into one another until nobody could say
 * which was which.
 *
 * The first version of this was radius lobes on a single tube, and it came
 * out as a smooth spindle: a fat stick, not a braid. What the real thing has
 * is SEPARATE STRANDS you can follow with your eye as they wind over and
 * under each other, each one swelling between crossings. So the strands are
 * real tubes wound round a thinner core, and the swelling is on the strand.
 */
function buildBraid(b, s, sp, path, rad, radial, r, N) {
  const br = s.extra.braid;
  const steps = Math.max(48, br.lobes * 18);
  const base = frameAt(path, 0.5);
  const strands = br.strands;
  const turns = br.turns;

  for (let k = 0; k < strands; k++) {
    const pts = [];
    const rads = [];
    const phase = (k / strands) * TAU;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const t = lerp(br.from, br.to, u);
      const fr = frameAt(path, t);
      const core = rad(t) * 0.52;
      // each strand fattens and thins as it winds — that pulsing is what
      // reads as "braid" rather than "cable"
      const pulse = 0.72 + 0.46 * (0.5 + 0.5 * Math.sin(u * br.lobes * Math.PI * 2 + phase * 1.7));
      const sr = rad(t) * br.thick * pulse;
      const a = u * turns * TAU * br.dir + phase;
      const off = core + sr * 0.72;
      pts.push([
        fr.p[0] + (base.a[0] * Math.cos(a) + base.b[0] * Math.sin(a)) * off,
        fr.p[1] + (base.a[1] * Math.cos(a) + base.b[1] * Math.sin(a)) * off,
        fr.p[2] + (base.a[2] * Math.cos(a) + base.b[2] * Math.sin(a)) * off,
      ]);
      rads.push(sr);
    }
    tube(b, {
      pts, radius: u => rads[clamp(Math.round(u * steps), 0, steps)] * (1 - 0.35 * Math.pow(Math.abs(u * 2 - 1), 3)),
      radial: Math.max(5, radial),
      color: (u, i, ang) => {
        const t = lerp(br.from, br.to, u);
        let col = barkColor(s, sp, t, ang + phase, N);
        // the dark seam is where two strands press together: the crease runs
        // along the sides of each strand, not around it
        const crease = Math.pow(Math.abs(Math.sin(ang * 0.5 + phase)), 6);
        return mixHex(col, BARK.wet, crease * br.seam * 0.55);
      },
      squash: () => [1, 0.86],
      capStart: true, capEnd: true, sway: () => 0,
    });
  }

  // the thin core the strands are wound around, visible in the gaps
  const corePts = [];
  for (let i = 0; i <= 20; i++) corePts.push(frameAt(path, lerp(br.from, br.to, i / 20)).p);
  tube(b, {
    pts: corePts, radius: u => rad(lerp(br.from, br.to, u)) * 0.55,
    radial: Math.max(5, radial - 1),
    color: (u, i, ang) => shade(barkColor(s, sp, lerp(br.from, br.to, u), ang, N), -0.25),
    capStart: false, capEnd: false, sway: () => 0,
  });
}

/** RINGBOUGH — a fork that healed shut around a hole you can see through. */
function buildRingbough(b, s, sp, path, rad, radial, colorAt, squash, bump) {
  const ring = s.extra.ring;
  const t0 = clamp(ring.at - ring.span * 0.5, 0.06, 0.8);
  const t1 = clamp(ring.at + ring.span * 0.5, t0 + 0.06, 0.94);

  const sub = (a, c) => {
    const n = path.length;
    const out = [];
    const i0 = Math.max(0, Math.floor(a * (n - 1)));
    const i1 = Math.min(n - 1, Math.ceil(c * (n - 1)));
    for (let i = i0; i <= i1; i++) out.push(path[i]);
    if (out.length < 2) out.push(path[Math.min(n - 1, i0 + 1)]);
    return out;
  };

  // lower and upper sections are a normal (flattened) tube, swelling toward
  // the eye the way a healed fork actually does
  const swell = u => 1 + 0.5 * Math.pow(u, 3);
  tube(b, {
    pts: sub(0, t0), radius: t => rad(t * t0) * swell(t), radial, bump,
    color: (t, i, ang) => colorAt(t * t0, i, ang), squash, capStart: false, capEnd: false, sway: () => 0,
  });
  tube(b, {
    pts: sub(t1, 1), radius: t => rad(lerp(t1, 1, t)) * swell(1 - t), radial, bump,
    color: (t, i, ang) => colorAt(lerp(t1, 1, t), i, ang), squash, capStart: false, capEnd: false, sway: () => 0,
  });

  // the two rails that go round the eye
  const steps = 14;
  const base = frameAt(path, ring.at);
  for (const side of [1, -1]) {
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const t = lerp(t0, t1, u);
      const fr = frameAt(path, t);
      const bulge = Math.sin(u * Math.PI) * rad(ring.at) * ring.open * side;
      pts.push([
        fr.p[0] + base.a[0] * bulge,
        fr.p[1] + base.a[1] * bulge,
        fr.p[2] + base.a[2] * bulge,
      ]);
    }
    tube(b, {
      pts,
      radius: u => {
        const t = lerp(t0, t1, u);
        // the rails are thinner than the shaft — the wood split into two —
        // and thinnest where the eye is widest
        return rad(t) * lerp(1.5, 0.46, Math.sin(u * Math.PI));
      },
      radial: Math.max(4, radial - 1),
      color: (u, i, ang) => {
        const t = lerp(t0, t1, u);
        let col = colorAt(t, i, ang);
        // the inside of the eye is smooth healed wood, paler and polished
        const inward = side > 0 ? Math.cos(ang) < -0.2 : Math.cos(ang) > 0.2;
        if (inward) col = mixHex(col, tweak(sp.inner, { l: 1.05 }), 0.55);
        return col;
      },
      squash: () => [1, ring.flat * 1.25],
      capStart: false, capEnd: false, sway: () => 0,
    });
  }
}

/** LIGHTNING-SPLIT — a fissure down one side, charred on the outside and raw
 *  inside, built as two rails with a gap between them. */
function buildSplit(b, s, sp, path, rad, radial, colorAt, r, N, bump) {
  const sp2 = s.extra.split;
  const base = frameAt(path, 0.5);
  const sub = (a, c) => {
    const n = path.length, out = [];
    const i0 = Math.max(0, Math.floor(a * (n - 1))), i1 = Math.min(n - 1, Math.ceil(c * (n - 1)));
    for (let i = i0; i <= i1; i++) out.push(path[i]);
    if (out.length < 2) out.push(path[Math.min(n - 1, i0 + 1)]);
    return out;
  };
  tube(b, { pts: sub(0, sp2.from), radius: t => rad(t * sp2.from), radial, bump, color: (t, i, a) => colorAt(t * sp2.from, i, a), capStart: false, capEnd: false, sway: () => 0 });
  tube(b, { pts: sub(sp2.to, 1), radius: t => rad(lerp(sp2.to, 1, t)), radial, bump, color: (t, i, a) => colorAt(lerp(sp2.to, 1, t), i, a), capStart: false, capEnd: false, sway: () => 0 });

  const steps = 18;
  for (const side of [1, -1]) {
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const t = lerp(sp2.from, sp2.to, u);
      const fr = frameAt(path, t);
      const off = Math.sin(u * Math.PI) * rad(t) * sp2.gap * side;
      pts.push([fr.p[0] + base.a[0] * off, fr.p[1] + base.a[1] * off, fr.p[2] + base.a[2] * off]);
    }
    tube(b, {
      pts,
      radius: u => rad(lerp(sp2.from, sp2.to, u)) * lerp(1, 0.6, Math.sin(u * Math.PI)),
      radial: Math.max(4, radial - 1),
      color: (u, i, ang) => {
        const t = lerp(sp2.from, sp2.to, u);
        const inward = side > 0 ? Math.cos(ang) < -0.1 : Math.cos(ang) > 0.1;
        if (inward) {
          // the exposed face: raw splintered wood, scorched at the edges
          return mixHex(tweak(sp.inner, { l: 1.0 + N(t * 20) * 0.2 }), BARK.charred, 0.15 + N(u * 13) * 0.3);
        }
        return colorAt(t, i, ang);
      },
      squash: () => [0.8, 1.0],
      capStart: false, capEnd: false, sway: () => 0,
    });
  }
}

/** MAULHEAD — a burl the size of a loaf, grown hard on the end of a limb. */
function buildBurl(b, s, sp, path, rad, r, N, colorAt) {
  const bu = s.extra.burl;
  const t = bu.at;
  const fr = frameAt(path, t === 1 ? 0.995 : 0.005);
  const p = t === 1 ? path[path.length - 1] : path[0];
  const rr = rad(t);
  const R = rr * bu.size;
  const axis = t === 1 ? fr.d : [-fr.d[0], -fr.d[1], -fr.d[2]];
  const cx = p[0] + axis[0] * R * 0.45, cy = p[1] + axis[1] * R * 0.45, cz = p[2] + axis[2] * R * 0.45;

  /* A burl is a MASS, not a ball. Three things separate the two, and the
     first version had none of them:
       - it is elongated, either along the limb (a club) or across it (a
         mallet), never spherical;
       - it carries several overlapping bulges with hard shoulders between
         them, because it grew in fits over decades;
       - it has a coarse rind all over, so the silhouette is never a
         clean arc. */
  const lumps = [];
  for (let i = 0; i < bu.lumps; i++) {
    lumps.push({
      d: norm3([r.bell(), r.bell(), r.bell()]),
      amp: r.range(0.22, 0.52), sharp: r.range(1.4, 3.4),
    });
  }
  // the long axis: across the limb for a mallet head, along it for a club
  const cross0 = perp(axis);
  const longAxis = bu.cross ? cross0 : axis;
  const rind = r.range(0.06, 0.13);
  const rp = [r.range(0, TAU), r.range(0, TAU), r.range(0, TAU)];

  const warp = (x, y, z) => {
    let m = 1;
    for (const L of lumps) {
      const d = Math.max(0, x * L.d[0] + y * L.d[1] + z * L.d[2]);
      m += L.amp * Math.pow(d, L.sharp);
    }
    const along = Math.abs(x * longAxis[0] + y * longAxis[1] + z * longAxis[2]);
    m *= lerp(bu.squash, 1.35, along);          // stretched along `longAxis`
    // coarse rind
    m *= 1 + rind * (Math.sin(x * 11 + rp[0]) * Math.sin(y * 9 + rp[1]) * Math.sin(z * 13 + rp[2]));
    return m;
  };

  b.color(colorAt(t, 0, 0), 0, r);
  blob(b, cx, cy, cz, R, 8, 12, warp, 0, (x, y, z) => {
    const ang = Math.atan2(z, x);
    let col = colorAt(t * 0.94 + 0.03, 0, ang);
    // the crown of a burl is usually rubbed bare and pale
    const up = y;
    if (up > 0.35) col = mixHex(col, tweak(sp.inner, { l: 0.92 }), (up - 0.35) * 0.9 * (0.4 + s.pale * 0.6));
    return col;
  });

  // a couple of stub scars where side shoots were
  for (let i = 0; i < r.int(2, 4); i++) {
    const d = norm3([r.bell(), r.bell(), r.bell()]);
    const sr = R * r.range(0.14, 0.26);
    b.color(shade(colorAt(t, 0, i), -0.3), 0.08, r);
    blob(b, cx + d[0] * R * 0.95, cy + d[1] * R * 0.95, cz + d[2] * R * 0.95, sr, 3, 5,
      (x, y, z) => 1 - 0.4 * Math.max(0, x * d[0] + y * d[1] + z * d[2]));
  }
}

/** BESOM — the hundred fine whips at the end of a birch shoot. */
function buildBristles(b, s, sp, path, rad, r, lod) {
  const bs = s.extra.bristle;
  const n = Math.round(bs.n * (lod.twigs > 0.6 ? 1 : 0.45));
  const rr = rad(0.9);
  for (let i = 0; i < n; i++) {
    const t0 = r.range(0.74, 0.99);
    const f2 = frameAt(path, t0);
    const roll = r.range(0, TAU);
    const ang = r.range(0.05, bs.spread);
    let dir = branchDir(f2, ang, roll);
    const L = bs.len * r.range(0.5, 1.35) * s.length;
    const segs = 3;
    const pts = [f2.p.slice()];
    const ds = L / segs;
    for (let k = 1; k <= segs; k++) {
      const ax = cross(dir, [0, -1, 0]);
      if (len3(ax) > 1e-6) dir = norm3(rotAxis(dir, norm3(ax), -0.28 * (k / segs)));
      const p = pts[k - 1];
      pts.push([p[0] + dir[0] * ds, p[1] + dir[1] * ds, p[2] + dir[2] * ds]);
    }
    const hex = mixHex(tweak(sp.bark, { l: r.range(0.85, 1.25) }), BARK.deadWood, r.range(0, 0.4));
    tube(b, {
      pts, radius: t => Math.max(0.0009, rr * 0.075 * (1 - t * 0.9)), radial: 3,
      color: () => hex, capStart: false, capEnd: false,
      // whips move in the wind even lying on the ground
      sway: t => t * 0.5,
    });
  }
}

/** MOONPALE — foxfire in the grain, written into the glow builder. */
function buildFoxfireVeins(glow, s, path, rad, r) {
  const g = s.extra.glow;
  for (let v = 0; v < g.veins; v++) {
    const t0 = r.range(0.05, 0.6), t1 = clamp(t0 + r.range(0.18, 0.45), 0, 0.98);
    const roll = r.range(0, TAU);
    const steps = 10;
    const pts = [];
    const base = frameAt(path, (t0 + t1) / 2);
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const t = lerp(t0, t1, u);
      const fr = frameAt(path, t);
      const a = roll + Math.sin(u * 5) * 0.7;
      const rr = rad(t) * 1.01;
      pts.push([
        fr.p[0] + (base.a[0] * Math.cos(a) + base.b[0] * Math.sin(a)) * rr,
        fr.p[1] + (base.a[1] * Math.cos(a) + base.b[1] * Math.sin(a)) * rr,
        fr.p[2] + (base.a[2] * Math.cos(a) + base.b[2] * Math.sin(a)) * rr,
      ]);
    }
    glow.color(MUSHROOM.glowCap, 0.1, r);
    tube(glow, {
      pts, radius: t => rad(lerp(t0, t1, t)) * 0.30 * Math.sin(t * Math.PI) * g.strength + 0.0025,
      radial: 4, capStart: false, capEnd: false, sway: () => 0,
    });
    // a bright node where two veins meet, which is what makes it read as
    // something living in the wood rather than as painted-on stripes
    if (v % 2 === 0) {
      const mid = pts[Math.floor(pts.length / 2)];
      glow.color(MUSHROOM.glowStem, 0.06, r);
      blob(glow, mid[0], mid[1], mid[2], rad((t0 + t1) / 2) * 0.35 * g.strength + 0.004, 3, 6);
    }
  }
}

/* ========================================================================= */
/* HELPERS                                                                   */
/* ========================================================================= */

const _m4 = new THREE.Matrix4();
const _q4 = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _d3 = new THREE.Vector3();
const _p3 = new THREE.Vector3();
const _s3 = new THREE.Vector3(1, 1, 1);
const _qr = new THREE.Quaternion();

/**
 * A matrix that puts a sub-model built along +Y at `p`, pointing along `dir`,
 * spun by `roll`. Used for every detail that sticks out of a stick.
 */
export function orientMatrix(p, dir, roll = 0, from = null) {
  _d3.set(dir[0], dir[1], dir[2]).normalize();
  _q4.setFromUnitVectors(from ? _up.set(from[0], from[1], from[2]).normalize() : _up.set(0, 1, 0), _d3);
  if (roll) {
    _qr.setFromAxisAngle(_d3, roll);
    _q4.premultiply(_qr);
  }
  _p3.set(p[0], p[1], p[2]);
  _s3.set(1, 1, 1);
  return _m4.compose(_p3, _q4, _s3).clone();
}

/**
 * Build a finished, standalone stick geometry lying along +Y, plus the data
 * the placer needs to lay it on the ground convincingly.
 */
export function stickGeometry(spec, lod = 0, glowBuilder = null) {
  const b = new MeshBuilder();
  const info = buildStick(spec, b, { lod, glow: glowBuilder });
  return { builder: b, info };
}
