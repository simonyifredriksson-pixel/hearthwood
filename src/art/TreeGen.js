/* TreeGen.js — every tree in the wood, grown from a seed.
   ===========================================================================
   Nine species, each with its own way of standing. A player should be able to
   tell a birch from an oak at a hundred metres by SHAPE alone, with the
   colour turned off — that is the test this file is written against, and
   render_trees.mjs draws exactly that check.

   WHAT MAKES A CANOPY LOOK LIKE FOLIAGE AND NOT LIKE BROCCOLI

   The failure mode of procedural trees is a brown stick with green balls on
   it. Four things fix it, and all four are cheap:

     1. CLUMPS, NOT A BALL. Foliage hangs in masses at the ends of branches,
        with real gaps between them that you can see sky through.
     2. LIGHT FROM ABOVE, BAKED IN. Every leaf clump is lighter on top and
        markedly darker underneath, painted into the vertex colours. Real
        light cannot do this for a mass that has no interior geometry, and
        without it a canopy reads as flat cut-out.
     3. HUE SPREAD, NOT JUST VALUE. Neighbouring clumps differ in hue by a
        few degrees. A canopy that varies only in lightness looks like one
        colour with noise on it.
     4. A BROKEN EDGE. At close range a scatter of individual leaf blades
        around the outside of each clump breaks the silhouette, which is what
        stops the mass reading as a sphere.
*/

import * as THREE from '../../lib/three.module.js?v=1790055608';
import { MeshBuilder, tube, blob, blade, cylinder, smoothPath, rotAxis, perp, norm3 } from './Geo.js?v=1790055608';
import { BARK, LEAF, MOSS, MUSHROOM, mixHex, tweak, shade } from './Palette.js?v=1790055608';
import { makeRng, clamp, lerp, TAU, smoothstep } from '../core/Util.js?v=1790055608';

/* ========================================================================= */
/* SPECIES                                                                   */
/* ========================================================================= */

/* Read these as a description of a tree's POSTURE. `spread` against `height`
   is the silhouette; `branchStart` is how much bare trunk there is; `droop`
   is whether the branches reach up or hang down. */
/* `clumpR` is a FRACTION OF TREE HEIGHT, and it is the number this file is
   most sensitive to. At 0.30 a sixteen-metre oak grows five-metre balls of
   leaf and the whole wood turns into broccoli; the readable range is
   0.06–0.12, which on the same oak is a metre and a half — about the size of
   a real mass of oak leaves on the end of a real oak branch. */
export const TREES = {
  oak: {
    label: 'Oak', bark: BARK.oak, leaf: LEAF.oak, leaf2: LEAF.shade,
    h: [7, 19], trunk: 0.035, taper: 0.60, lean: 0.10,
    branchStart: 0.40, branches: [4, 6], subBranch: 2, branchAng: [0.55, 1.15],
    spread: 0.62, droop: 0.12, clumpsPerTip: [1, 3], clumpR: 0.115, clumpSquash: 0.70,
    crown: 'broad', roots: 5, mossy: 0.7, autumn: LEAF.oakAutumn,
  },
  ash: {
    label: 'Ash', bark: BARK.ash, leaf: LEAF.rowan, leaf2: LEAF.young,
    h: [9, 22], trunk: 0.026, taper: 0.72, lean: 0.06,
    branchStart: 0.50, branches: [4, 6], subBranch: 2, branchAng: [0.52, 0.98],
    spread: 0.66, droop: -0.02, clumpsPerTip: [1, 3], clumpR: 0.090, clumpSquash: 0.85,
    crown: 'upright', roots: 4, mossy: 0.5, autumn: 0xd6c05a,
  },
  birch: {
    label: 'Birch', bark: BARK.birch, leaf: LEAF.birch, leaf2: LEAF.young,
    h: [8, 17], trunk: 0.018, taper: 0.66, lean: 0.14,
    branchStart: 0.44, branches: [4, 6], subBranch: 1, branchAng: [0.45, 0.95],
    spread: 0.55, droop: 0.34, clumpsPerTip: [1, 3], clumpR: 0.078, clumpSquash: 1.15,
    crown: 'airy', roots: 3, mossy: 0.2, papery: true, autumn: 0xe0c054,
  },
  pine: {
    label: 'Pine', bark: BARK.pine, leaf: LEAF.pine, leaf2: LEAF.pineBlue,
    h: [11, 27], trunk: 0.026, taper: 0.82, lean: 0.04,
    branchStart: 0.42, branches: [6, 9], subBranch: 0, branchAng: [1.05, 1.42],
    spread: 0.60, droop: 0.22, clumpsPerTip: [1, 1], clumpR: 0.0, clumpSquash: 1,
    crown: 'conifer', roots: 4, mossy: 0.45, evergreen: true,
  },
  spruce: {
    label: 'Spruce', bark: BARK.pineDark, leaf: LEAF.pineBlue, leaf2: LEAF.pine,
    h: [12, 30], trunk: 0.023, taper: 0.88, lean: 0.02,
    branchStart: 0.12, branches: [8, 13], subBranch: 0, branchAng: [1.15, 1.48],
    spread: 0.48, droop: 0.34, clumpsPerTip: [1, 1], clumpR: 0.0, clumpSquash: 1,
    crown: 'conifer', roots: 3, mossy: 0.55, evergreen: true,
  },
  willow: {
    label: 'Willow', bark: BARK.willow, leaf: LEAF.willow, leaf2: LEAF.young,
    h: [6, 13], trunk: 0.042, taper: 0.55, lean: 0.22,
    branchStart: 0.30, branches: [6, 9], subBranch: 1, branchAng: [0.85, 1.30],
    spread: 0.90, droop: 0.42, clumpsPerTip: [1, 1], clumpR: 0.040, clumpSquash: 1.1,
    crown: 'weeping', roots: 6, mossy: 0.85, autumn: 0xc8c268, clumpBudget: 0.5,
  },
  hazel: {
    label: 'Hazel', bark: BARK.hazel, leaf: LEAF.hazel, leaf2: LEAF.young,
    h: [3.5, 7], trunk: 0.020, taper: 0.5, lean: 0.3,
    branchStart: 0.10, branches: [3, 5], subBranch: 1, branchAng: [0.25, 0.65],
    spread: 0.62, droop: 0.15, clumpsPerTip: [1, 3], clumpR: 0.135, clumpSquash: 0.95,
    crown: 'coppice', roots: 2, mossy: 0.4, multiStem: [3, 5], autumn: 0xd2b45a,
  },
  rowan: {
    label: 'Rowan', bark: BARK.rowan, leaf: LEAF.rowan, leaf2: LEAF.young,
    h: [4, 9], trunk: 0.022, taper: 0.6, lean: 0.16,
    branchStart: 0.44, branches: [3, 5], subBranch: 1, branchAng: [0.55, 1.05],
    spread: 0.60, droop: 0.05, clumpsPerTip: [1, 3], clumpR: 0.135, clumpSquash: 0.85,
    crown: 'broad', roots: 3, mossy: 0.35, berries: 0xc4402c, autumn: 0xd07a3a,
  },
  blackthorn: {
    label: 'Blackthorn', bark: 0x453a32, leaf: LEAF.shade, leaf2: LEAF.beech,
    h: [2.2, 4.5], trunk: 0.024, taper: 0.45, lean: 0.4,
    branchStart: 0.10, branches: [4, 6], subBranch: 1, branchAng: [0.5, 1.2],
    spread: 0.72, droop: 0.1, clumpsPerTip: [1, 3], clumpR: 0.160, clumpSquash: 0.9,
    crown: 'thicket', roots: 2, mossy: 0.3, thorns: true, multiStem: [2, 3],
  },
  elder: {
    label: 'Elder', bark: BARK.elder, leaf: LEAF.beech, leaf2: LEAF.young,
    h: [3, 6.5], trunk: 0.028, taper: 0.5, lean: 0.28,
    branchStart: 0.24, branches: [3, 5], subBranch: 1, branchAng: [0.6, 1.15],
    spread: 0.72, droop: 0.18, clumpsPerTip: [1, 3], clumpR: 0.165, clumpSquash: 0.8,
    crown: 'broad', roots: 2, mossy: 0.6, flowers: 0xf2f0e2, multiStem: [2, 3],
  },
  applewood: {
    label: 'Apple', bark: 0x6f5a44, leaf: LEAF.maple, leaf2: LEAF.young,
    h: [3.5, 6], trunk: 0.040, taper: 0.5, lean: 0.34,
    branchStart: 0.30, branches: [4, 6], subBranch: 1, branchAng: [0.7, 1.3],
    spread: 0.78, droop: 0.2, clumpsPerTip: [1, 3], clumpR: 0.180, clumpSquash: 0.78,
    crown: 'orchard', roots: 3, mossy: 0.55, berries: 0xc8543a, autumn: 0xd4a44a,
  },
};

export const TREE_NAMES = Object.keys(TREES);

/* ========================================================================= */
/* LOD                                                                       */
/* ========================================================================= */

/* `maxClumps` is a hard triangle budget, not a suggestion. A tree with a
   deep branch recursion produces dozens of tips, and putting foliage on every
   one of them is how a single oak reached eighteen thousand triangles. The
   tips are shuffled before the budget is applied, so which ones get leaves
   varies per tree instead of always being the first branches grown. */
const TLOD = [
  { trunkSeg: 8, radial: 6, sub: true, clumpRings: 3, clumpSeg: 6, maxClumps: 30, blades: true, roots: true, moss: true, detail: 1 },
  { trunkSeg: 5, radial: 4, sub: true, clumpRings: 2, clumpSeg: 5, maxClumps: 14, blades: false, roots: false, moss: false, detail: 0.4 },
  { trunkSeg: 3, radial: 4, sub: false, clumpRings: 2, clumpSeg: 4, maxClumps: 5, blades: false, roots: false, moss: false, detail: 0.2 },
  { trunkSeg: 3, radial: 3, sub: false, clumpRings: 2, clumpSeg: 4, maxClumps: 3, blades: false, roots: false, moss: false, detail: 0.1 },
];

/* ========================================================================= */
/* MAIN                                                                      */
/* ========================================================================= */

/**
 * Grow a tree into a builder, standing at the origin on the +Y axis.
 *
 * @param {MeshBuilder} b
 * @param {object} o
 * @param {string} o.species   key of TREES
 * @param {number} o.seed
 * @param {number} o.lod       0 (close) .. 3 (far)
 * @param {number} o.scale     0..1 within the species height range, or a
 *                             metre height if `absolute` is set
 * @param {number} o.autumn    0..1 how far the leaves have turned
 * @param {number} o.mossy     0..1 override for local dampness
 * @param {boolean} o.dead     a standing dead tree: no leaves, pale wood
 * @returns {{height:number, trunkR:number, canopyR:number, canopyY:number}}
 */
export function buildTree(b, o = {}) {
  const S = TREES[o.species] || TREES.oak;
  const r = makeRng((o.seed ?? 1) ^ 0x7d3e);
  const L = TLOD[clamp(o.lod ?? 0, 0, 3)];
  const dead = !!o.dead;

  const sizeT = o.scale !== undefined ? clamp(o.scale, 0, 1) : r.pow(1.6);
  const H = o.absolute ? o.scale : lerp(S.h[0], S.h[1], sizeT);
  const autumn = dead ? 0 : clamp(o.autumn ?? 0, 0, 1);
  const mossy = clamp((o.mossy ?? 0.4) * S.mossy, 0, 1);

  /* --- per-tree colour identity ----------------------------------------- */
  const hueShift = r.range(-0.028, 0.028);
  const barkHex = dead
    ? mixHex(tweak(S.bark, { s: 0.35, l: 1.25 }), BARK.deadWood, 0.6)
    : tweak(S.bark, { h: hueShift * 0.5, l: r.range(0.86, 1.14) });
  const leafBase = mixHex(
    tweak(S.leaf, { h: hueShift, l: r.range(0.88, 1.12) }),
    S.autumn || LEAF.dead, autumn,
  );
  const leafAlt = mixHex(tweak(S.leaf2, { h: hueShift }), S.autumn || LEAF.dead, autumn * 0.85);

  /* --- stems ------------------------------------------------------------- */
  const stems = [];
  if (S.multiStem && r.chance(0.8)) {
    const n = r.int(S.multiStem[0], S.multiStem[1]);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + r.range(-0.4, 0.4);
      const off = H * 0.035 * r.range(0.5, 1.5);
      stems.push({
        x: Math.cos(a) * off, z: Math.sin(a) * off,
        h: H * r.range(0.72, 1.0), lean: r.range(0.12, 0.45), leanAng: a + r.range(-0.6, 0.6),
        r: S.trunk * H * r.range(0.6, 1.0),
      });
    }
  } else {
    stems.push({ x: 0, z: 0, h: H, lean: S.lean * r.range(0.4, 1.4), leanAng: r.range(0, TAU), r: S.trunk * H });
  }

  let canopyR = 0, canopyY = 0, trunkR = 0;

  for (const st of stems) {
    const res = growStem(b, {
      S, L, r, st, H: st.h, barkHex, leafBase, leafAlt, mossy, dead, autumn,
      lod: o.lod ?? 0, hueShift,
      // a coppiced hazel has five stems and must not therefore cost five
      // times as much as an oak
      stemShare: 1 / Math.max(1, Math.pow(stems.length, 0.72)),
    });
    canopyR = Math.max(canopyR, res.canopyR + Math.hypot(st.x, st.z));
    canopyY = Math.max(canopyY, res.canopyY);
    trunkR = Math.max(trunkR, st.r);
  }

  /* --- roots and the flare where the trunk meets the ground ------------- */
  if (L.roots && S.roots && !S.multiStem) {
    buildRoots(b, stems[0], S, barkHex, r, L, mossy);
  }

  return { height: H, trunkR, canopyR: canopyR || H * 0.3, canopyY: canopyY || H * 0.7 };
}

/* ========================================================================= */
/* ONE STEM                                                                  */
/* ========================================================================= */

function growStem(b, ctx) {
  const { S, L, r, st, H, barkHex, mossy, dead } = ctx;
  const segs = Math.max(3, Math.round(L.trunkSeg * lerp(0.7, 1.3, H / S.h[1])));

  /* --- the trunk path ---------------------------------------------------- */
  const lean = [Math.cos(st.leanAng) * st.lean, 0, Math.sin(st.leanAng) * st.lean];
  const swayF = r.range(1.2, 2.6), swayP = r.range(0, TAU);
  const swayA = H * 0.016 * r.range(0.4, 1.6);
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    pts.push([
      st.x + lean[0] * H * t * t + Math.sin(t * swayF * TAU + swayP) * swayA,
      H * t,
      st.z + lean[2] * H * t * t + Math.cos(t * swayF * TAU + swayP * 1.3) * swayA,
    ]);
  }

  /* --- the trunk --------------------------------------------------------- */
  const R0 = st.r;
  const trunkRadius = t => {
    // a flare at the base that dies away fast: this one curve is most of what
    // makes a trunk look rooted rather than pushed into the ground like a pole
    const flare = 1 + 0.55 * Math.exp(-t * 26);
    return Math.max(0.012, R0 * (1 - S.taper * Math.pow(t, 0.85)) * flare);
  };
  const ridgeN = S.papery ? 0 : 5;
  tube(b, {
    pts, radius: trunkRadius, radial: L.radial,
    color: (t, i, ang) => trunkColor(ctx, t, ang),
    bump: L.radial >= 5 && !S.papery
      ? (t, ang) => 1 + 0.055 * (Math.sin(ang * 6 + t * 9) * 0.5 + 0.5)
      : null,
    capStart: false, capEnd: true,
    // the whole tree leans in a gust, very slightly, from a third of the way up
    sway: t => Math.max(0, (t - 0.3) / 0.7) * 0.28,
  });

  /* --- branches ---------------------------------------------------------- */
  let canopyR = 0, canopyY = H * 0.6;

  if (S.crown === 'conifer') {
    canopyR = buildConifer(b, ctx, pts, trunkRadius, H);
    canopyY = H * 0.55;
  } else {
    const nB = r.int(S.branches[0], S.branches[1]);
    const tips = [];
    for (let i = 0; i < nB; i++) {
      // Branches spiral up the trunk at the golden angle rather than being
      // placed at random: real trees do this and random placement leaves
      // visible bald patches on one side.
      const roll = i * 2.3999 + r.range(-0.3, 0.3);
      const at = lerp(S.branchStart, 0.96, i / Math.max(1, nB - 1)) + r.range(-0.05, 0.05);
      const ang = lerp(S.branchAng[1], S.branchAng[0], i / Math.max(1, nB - 1)) * r.range(0.85, 1.15);
      buildBranch(b, ctx, pts, trunkRadius, {
        at: clamp(at, 0.05, 0.97), roll, ang,
        len: H * S.spread * lerp(0.42, 0.20, i / Math.max(1, nB - 1)) * r.range(0.75, 1.25),
        thick: r.range(0.36, 0.56), depth: 0,
      }, tips);
    }
    // a crown tuft at the very top, or the tree looks decapitated
    if (!dead) {
      const top = pts[pts.length - 1];
      tips.push({ p: top, d: [0, 1, 0], w: 0.9 });
    }
    for (const tip of tips) {
      canopyR = Math.max(canopyR, Math.hypot(tip.p[0] - st.x, tip.p[2] - st.z));
      canopyY = Math.max(canopyY, tip.p[1]);
    }
    if (!dead) {
      const budget = Math.max(2, Math.round(L.maxClumps * (ctx.stemShare ?? 1) * (S.clumpBudget ?? 1)));
      const chosen = tips.length > budget ? r.shuffle(tips).slice(0, budget) : tips;
      if (S.crown === 'weeping') {
        for (const tip of chosen) buildWeepingStrands(b, ctx, tip);
      }
      for (const tip of chosen) buildClump(b, ctx, tip);
    }
  }

  /* --- moss up the north side, and a bracket fungus or two --------------- */
  if (L.moss && mossy > 0.25) buildTrunkMoss(b, ctx, pts, trunkRadius, H);
  if (L.detail >= 1 && r.chance(mossy * 0.45 + (dead ? 0.4 : 0))) {
    buildTrunkBracket(b, ctx, pts, trunkRadius, r);
  }

  return { canopyR: canopyR + S.clumpR * H * 0.5, canopyY };
}

/** Bark colour: species base, ridged grain, moss low on the shaded side. */
function trunkColor(ctx, t, ang) {
  const { S, barkHex, mossy, r } = ctx;
  let c = barkHex;
  if (S.papery) {
    // birch: pale with dark lenticel dashes and a dark base
    const dash = Math.pow(Math.max(0, Math.sin(t * 90 + Math.cos(ang * 2) * 3)), 12);
    c = mixHex(c, BARK.birchMark, dash * 0.75);
    c = mixHex(c, 0x6b6156, Math.pow(1 - t, 6) * 0.8);
  } else {
    const groove = Math.pow(Math.sin(ang * 6 + t * 9) * 0.5 + 0.5, 2.0);
    c = shade(c, -0.26 * groove + 0.08 * (1 - groove));
    c = shade(c, (Math.sin(t * 31 + ang * 2.2) * 0.5) * 0.10);
  }
  if (mossy > 0.05) {
    // moss climbs the shaded side from the ground up, and stops
    const side = Math.pow(0.5 + 0.5 * Math.cos(ang - 2.4), 2.0);
    const low = Math.pow(clamp(1 - t * 3.4, 0, 1), 0.7);
    const m = clamp(side * low * mossy * 1.5, 0, 0.75);
    if (m > 0.02) c = mixHex(c, Math.sin(t * 40 + ang * 3) > 0 ? MOSS.deep : MOSS.mid, m);
  }
  return c;
}

/* ------------------------------------------------------------- branches */

function buildBranch(b, ctx, trunkPts, trunkRadius, spec, tips) {
  const { S, L, r } = ctx;
  const fr = frameOn(trunkPts, spec.at);
  const baseR = trunkRadius(spec.at) * spec.thick;
  if (baseR < 0.010 || spec.len < 0.25) {
    tips.push({ p: fr.p, d: fr.d, w: 0.5 });
    return;
  }

  let dir = outDir(fr, spec.ang, spec.roll);
  const segs = Math.max(3, 6 - spec.depth);
  const ds = spec.len / segs;
  const pts = [fr.p.slice()];
  // Branches curve UP as they go out on most trees and DOWN on weeping ones.
  // A straight branch is the other half of why bad procedural trees look bad.
  const bendPer = (S.droop * 1.3 - 0.35) / segs;
  for (let i = 1; i <= segs; i++) {
    const ax = cr(dir, [0, -1, 0]);
    if (l3(ax) > 1e-6) dir = norm3(rotAxis(dir, norm3(ax), bendPer));
    const wob = Math.sin(i * 2.1 + spec.roll * 3) * 0.09;
    const ax2 = cr(dir, [Math.cos(spec.roll + 1.57), 0, Math.sin(spec.roll + 1.57)]);
    if (l3(ax2) > 1e-6) dir = norm3(rotAxis(dir, norm3(ax2), wob));
    const p = pts[i - 1];
    pts.push([p[0] + dir[0] * ds, p[1] + dir[1] * ds, p[2] + dir[2] * ds]);
  }

  const smooth = smoothPath(pts, segs + 2);
  tube(b, {
    pts: smooth,
    radius: t => Math.max(0.008, baseR * (1 - 0.72 * Math.pow(t, 1.3))),
    radial: Math.max(3, L.radial - 3 - spec.depth),
    color: (t, i, ang) => trunkColor(ctx, clamp(spec.at + t * 0.25, 0, 1), ang + spec.roll),
    capStart: false, capEnd: false,
    sway: t => clamp(0.3 + t * 0.45 + spec.depth * 0.15, 0, 1),
  });

  /* --- thorns, for the blackthorn ---------------------------------------- */
  if (S.thorns && L.detail >= 1) {
    for (let i = 0; i < r.int(2, 5); i++) {
      const t = r.range(0.2, 0.95);
      const f2 = frameOn(smooth, t);
      const d = outDir(f2, 1.3, r.range(0, TAU));
      const tl = baseR * r.range(2.2, 4.5);
      b.color(shade(ctx.barkHex, -0.35));
      tube(b, {
        pts: [f2.p, [f2.p[0] + d[0] * tl, f2.p[1] + d[1] * tl, f2.p[2] + d[2] * tl]],
        radius: t2 => baseR * 0.22 * (1 - t2), radial: 3, capStart: false, capEnd: false,
        sway: () => 0.5,
      });
    }
  }

  const sub = L.sub ? (S.subBranch || 0) - spec.depth : 0;
  if (sub > 0 && spec.depth < 2) {
    const n = r.int(1, 2 + sub);
    for (let i = 0; i < n; i++) {
      buildBranch(b, ctx, smooth, t => baseR * (1 - 0.72 * Math.pow(t, 1.3)), {
        at: r.range(0.4, 0.95), roll: r.range(0, TAU),
        ang: r.range(0.3, 0.9), len: spec.len * r.range(0.35, 0.62),
        thick: r.range(0.5, 0.75), depth: spec.depth + 1,
      }, tips);
    }
  } else {
    const end = smooth[smooth.length - 1];
    const d = norm3([
      end[0] - smooth[smooth.length - 2][0],
      end[1] - smooth[smooth.length - 2][1],
      end[2] - smooth[smooth.length - 2][2],
    ]);
    tips.push({ p: end, d, w: 1 });
    // weeping species hang strands from the branch, not just the tip
    if (S.crown === 'weeping') {
      for (let i = 0; i < r.int(2, 4); i++) {
        const t = r.range(0.35, 0.95);
        const f2 = frameOn(smooth, t);
        tips.push({ p: f2.p, d: [0, -1, 0], w: 0.8, weep: true });
      }
    }
  }
}

/* --------------------------------------------------------------- canopy */

/**
 * One mass of leaves at a branch tip. See the notes at the top of the file:
 * light from above baked in, hue spread between clumps, and a broken edge.
 */
function buildClump(b, ctx, tip) {
  const { S, L, r, leafBase, leafAlt, autumn, hueShift } = ctx;
  if (S.clumpR <= 0) return;

  const n = r.int(S.clumpsPerTip[0], S.clumpsPerTip[1]);
  const baseR = S.clumpR * ctx.H * tip.w;

  for (let k = 0; k < n; k++) {
    const R = baseR * r.range(0.62, 1.15);
    if (R < 0.05) continue;
    const off = R * r.range(0.25, 0.85);
    const a = r.range(0, TAU), e = r.range(-0.5, 0.9);
    const cx = tip.p[0] + tip.d[0] * off * 0.8 + Math.cos(a) * off;
    const cy = tip.p[1] + tip.d[1] * off * 0.8 + e * off * 0.7;
    const cz = tip.p[2] + tip.d[2] * off * 0.8 + Math.sin(a) * off;

    // this clump's own hue, a few degrees away from its neighbours
    const mix = r();
    const hex = mixHex(leafBase, leafAlt, mix * 0.75);
    const clumpHue = tweak(hex, { h: r.range(-0.022, 0.022), l: r.range(0.88, 1.10) });

    const lumpy = lumpWarp(r, 4, 0.30);
    const squash = S.clumpSquash * (S.crown === 'weeping' ? r.range(1.2, 2.0) : r.range(0.85, 1.15));
    const yOff = S.crown === 'weeping' ? -R * 0.5 : 0;
    // sway rises with height in the crown so the top of a tree moves most
    const sw = clamp(0.55 + (cy / ctx.H) * 0.55, 0, 1);

    blob(b, cx, cy + yOff, cz, R, L.clumpRings, L.clumpSeg,
      (x, y, z) => { const m = lumpy(x, y, z); return [m, m * squash, m]; },
      sw,
      (x, y, z) => {
        // Top-lit, baked in. The range matters: a canopy with no dark side
        // reads as a flat cut-out however good the silhouette is, and the
        // underside has to go a LONG way down — a real mass of leaves in
        // shadow is nearly black-green, not "slightly darker green".
        const up = y * 0.5 + 0.5;
        const c = shade(clumpHue, lerp(-0.58, 0.10, Math.pow(up, 1.1)));
        // and a little hue drift within the clump itself
        return tweak(c, { h: (x * 0.014), s: lerp(1.12, 0.86, up) });
      });

    /* --- the broken edge ------------------------------------------------ */
    if (L.blades && R > 0.35) {
      const nb = r.int(2, 4);
      for (let i = 0; i < nb; i++) {
        const th = r.range(0, TAU), ph = Math.acos(r.range(-0.3, 1));
        const d = [Math.sin(ph) * Math.cos(th), Math.cos(ph) * squash, Math.sin(ph) * Math.sin(th)];
        const sub = new MeshBuilder();
        sub.color(tweak(clumpHue, { l: r.range(0.95, 1.20) }), 0.07, r);
        blade(sub, {
          len: R * r.range(0.5, 0.95), wid: R * r.range(0.14, 0.26), segs: 1,
          curl: r.range(0.1, 0.5), cup: 0.3, swayBase: sw, swayTip: 1,
        });
        b.append(sub, orient([cx + d[0] * R * 0.85, cy + yOff + d[1] * R * 0.85, cz + d[2] * R * 0.85], d, r.range(0, TAU)));
      }
    }

    /* --- berries and blossom ------------------------------------------- */
    if (S.berries && L.detail >= 0.5 && r.chance(0.55)) {
      b.color(S.berries, 0.10, r);
      for (let i = 0; i < r.int(3, 8); i++) {
        const th = r.range(0, TAU), ph = Math.acos(r.range(-0.6, 1));
        const d = [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)];
        blob(b, cx + d[0] * R * 0.95, cy + yOff + d[1] * R * 0.9, cz + d[2] * R * 0.95,
          R * r.range(0.07, 0.13), 2, 5, null, sw);
      }
    }
    if (S.flowers && L.detail >= 0.5 && r.chance(0.6)) {
      b.color(S.flowers, 0.05, r);
      for (let i = 0; i < r.int(1, 3); i++) {
        const th = r.range(0, TAU);
        blob(b, cx + Math.cos(th) * R * 0.8, cy + yOff + R * 0.75, cz + Math.sin(th) * R * 0.8,
          R * r.range(0.18, 0.3), 2, 6, (x, y) => [1, 0.35, 1], sw);
      }
    }
  }
}

/* -------------------------------------------------------------- weeping */

/**
 * A willow is not blobs. It is a thousand hanging withies, and the
 * silhouette — a green waterfall with the trunk showing through it — is the
 * whole identity of the species. Blobs on the branch tips gave us a cactus.
 */
function buildWeepingStrands(b, ctx, tip) {
  const { S, L, r, leafBase, leafAlt } = ctx;
  const n = Math.max(2, Math.round(r.int(2, 4) * L.detail + 1));
  for (let i = 0; i < n; i++) {
    const len = ctx.H * r.range(0.22, 0.48);
    const a = r.range(0, TAU), spread = r.range(0, 0.5);
    const sx = tip.p[0] + Math.cos(a) * spread, sz = tip.p[2] + Math.sin(a) * spread;
    const segs = Math.max(3, Math.round(4 * L.detail + 1));
    const pts = [];
    const drift = r.range(-0.35, 0.35), drift2 = r.range(-0.35, 0.35);
    for (let k = 0; k <= segs; k++) {
      const t = k / segs;
      // hangs almost straight, with a slow curl that is different every strand
      pts.push([
        sx + drift * len * t * t + Math.sin(t * 3.4 + a) * len * 0.05,
        tip.p[1] - len * t,
        sz + drift2 * len * t * t + Math.cos(t * 2.8 + a) * len * 0.05,
      ]);
    }
    const hex = tweak(mixHex(leafBase, leafAlt, r()), { h: r.range(-0.02, 0.02), l: r.range(0.85, 1.1) });
    tube(b, {
      pts,
      radius: t => len * r.range(0.012, 0.020) * (1 - t * 0.6),
      radial: 3,
      color: (t) => shade(hex, lerp(0.06, -0.30, t)),
      capStart: false, capEnd: false,
      // a willow's strands are the most wind-sensitive thing in the game
      sway: t => 0.25 + t * 0.75,
    });
  }
}

/* -------------------------------------------------------------- conifer */

/** Conifers are not made of clumps: they are a spire of drooping skirts. */
function buildConifer(b, ctx, trunkPts, trunkRadius, H) {
  const { S, L, r, leafBase, leafAlt } = ctx;
  const tiers = Math.max(4, Math.round(r.int(S.branches[0], S.branches[1]) * lerp(0.7, 1.2, H / S.h[1])));
  const start = S.branchStart;
  let maxR = 0;

  for (let i = 0; i < tiers; i++) {
    const u = i / (tiers - 1);
    const at = lerp(start, 0.97, u);
    // widest a third of the way up, narrowing to the spire
    const env = Math.sin(Math.pow(1 - u, 0.72) * Math.PI * 0.62) * 1.25;
    const R = H * S.spread * 0.30 * env * r.range(0.82, 1.18);
    if (R < 0.08) continue;
    maxR = Math.max(maxR, R);

    const fr = frameOn(trunkPts, at);
    const droop = S.droop * r.range(0.7, 1.3);
    // more, smaller sprays: one big flat ribbon per direction reads as a
    // sheet of green card, and at close range you can see the triangles
    const nSpokes = Math.max(5, Math.round(10 * ctx.L.detail + 3));
    const hex = mixHex(leafBase, leafAlt, r() * 0.8);

    for (let k = 0; k < nSpokes; k++) {
      const a = (k / nSpokes) * TAU + i * 0.9 + r.range(-0.2, 0.2);
      const len = R * r.range(0.75, 1.15);
      const tipY = fr.p[1] - len * droop;
      const sub = new MeshBuilder();
      // a spray: a flattened, tapering, drooping frond
      const segs = L.clumpRings + 1;
      const rows = [];
      for (let s2 = 0; s2 <= segs; s2++) {
        const t = s2 / segs;
        const w = Math.sin((1 - t) * Math.PI * 0.55) * R * 0.34 * (1 - t * 0.35);
        const y = -droop * len * t * t;
        const z = t * len;
        sub.color(shade(tweak(hex, { h: r.range(-0.02, 0.02) }), lerp(0.16, -0.38, t * 0.4 + 0.3)));
        rows.push([
          sub.vert(-w, y, z, 0.25 + t * 0.7),
          sub.vert(0, y + w * 0.45, z, 0.25 + t * 0.7),
          sub.vert(w, y, z, 0.25 + t * 0.7),
        ]);
      }
      for (let s2 = 0; s2 < segs; s2++) {
        const A = rows[s2], B = rows[s2 + 1];
        sub.quad(A[0], A[1], B[1], B[0]);
        sub.quad(A[1], A[2], B[2], B[1]);
        sub.quad(B[0], B[1], A[1], A[0]);
        sub.quad(B[1], B[2], A[2], A[1]);
      }
      const d = [Math.cos(a), 0, Math.sin(a)];
      b.append(sub, orient(fr.p, d, 0));
      // and the woody spoke itself, visible in the gaps
      if (L.detail >= 0.5) {
        b.color(shade(ctx.barkHex, -0.15));
        tube(b, {
          pts: [fr.p, [fr.p[0] + d[0] * len * 0.85, tipY + len * droop * 0.15, fr.p[2] + d[2] * len * 0.85]],
          radius: t => Math.max(0.006, trunkRadius(at) * 0.30 * (1 - t * 0.8)), radial: 3,
          capStart: false, capEnd: false, sway: t => 0.2 + t * 0.4,
        });
      }
    }
  }
  return maxR;
}

/* ---------------------------------------------------------------- roots */

function buildRoots(b, st, S, barkHex, r, L, mossy) {
  const n = S.roots;
  const R0 = st.r;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + r.range(-0.35, 0.35);
    const len = R0 * r.range(5, 12);
    const rise = R0 * r.range(0.8, 2.0);
    const pts = [];
    const segs = 4;
    for (let k = 0; k <= segs; k++) {
      const t = k / segs;
      pts.push([
        st.x + Math.cos(a) * len * t,
        rise * (1 - t) * (1 - t) - R0 * 0.3 * t,
        st.z + Math.sin(a) * len * t,
      ]);
    }
    tube(b, {
      pts, radius: t => Math.max(0.01, R0 * lerp(0.62, 0.10, Math.pow(t, 0.7))),
      radial: Math.max(3, L.radial - 2),
      color: (t, i2, ang) => {
        let c = shade(barkHex, -0.12 - t * 0.1);
        if (mossy > 0.2) {
          const m = clamp((0.5 + 0.5 * Math.cos(ang - 2.4)) * (1 - t) * mossy * 1.4, 0, 0.6);
          c = mixHex(c, MOSS.deep, m);
        }
        return c;
      },
      capStart: false, capEnd: false, sway: () => 0,
    });
  }
}

/* ------------------------------------------------------------- trunk bits */

function buildTrunkMoss(b, ctx, pts, trunkRadius, H) {
  const { r, mossy } = ctx;
  const n = Math.round(mossy * 22);
  for (let i = 0; i < n; i++) {
    const t = Math.pow(r(), 2.2) * 0.45;
    const roll = 2.4 + r.bell() * 1.0;
    const fr = frameOn(pts, t);
    const rr = trunkRadius(t);
    const d = outDir(fr, 1.5, roll);
    const size = rr * r.range(0.12, 0.28);
    b.color(mixHex(MOSS.deep, MOSS.mid, r.pow(1.5)), 0.08, r);
    blob(b, fr.p[0] + d[0] * rr * 0.97, fr.p[1] + d[1] * rr * 0.97, fr.p[2] + d[2] * rr * 0.97,
      size, 3, 5, (x, y, z) => {
        const dd = x * d[0] + y * d[1] + z * d[2];
        return (dd > 0 ? 0.9 : 0.2) * (0.8 + 0.4 * Math.sin(x * 16) * Math.sin(z * 19));
      }, 0);
  }
}

function buildTrunkBracket(b, ctx, pts, trunkRadius, r) {
  const n = r.int(1, 4);
  const t0 = r.range(0.03, 0.4);
  for (let i = 0; i < n; i++) {
    const t = clamp(t0 + i * r.range(0.01, 0.06), 0.02, 0.6);
    const fr = frameOn(pts, t);
    const rr = trunkRadius(t);
    const roll = r.range(0, TAU);
    const d = outDir(fr, 1.5, roll);
    const R = clamp(rr * r.range(0.7, 1.5), 0.05, 0.28);
    const sub = new MeshBuilder();
    const rings = 3;
    let prev = null;
    for (let k = 0; k <= rings; k++) {
      const u = k / rings;
      sub.color(mixHex(MUSHROOM.bracketTop, MUSHROOM.bracketLip, Math.pow(u, 2) * 0.85), 0.05, r);
      const row = [];
      for (let j = 0; j <= 7; j++) {
        const a = -Math.PI * 0.5 + (j / 7) * Math.PI;
        row.push(sub.vert(Math.cos(a) * R * u, (1 - u * u) * R * 0.2 - u * R * 0.10, Math.sin(a) * R * u * 0.8, 0));
      }
      if (prev) for (let j = 0; j < 7; j++) sub.quad(prev[j], prev[j + 1], row[j + 1], row[j]);
      prev = row;
    }
    sub.color(MUSHROOM.bracketLip, 0.04, r);
    const under = [];
    for (let j = 0; j <= 7; j++) {
      const a = -Math.PI * 0.5 + (j / 7) * Math.PI;
      under.push(sub.vert(Math.cos(a) * R, -R * 0.11, Math.sin(a) * R * 0.8, 0));
    }
    const c0 = sub.vert(0, 0, 0, 0);
    for (let j = 0; j < 7; j++) sub.tri(c0, under[j + 1], under[j]);
    b.append(sub, orient([
      fr.p[0] + d[0] * rr * 0.9, fr.p[1] + d[1] * rr * 0.9, fr.p[2] + d[2] * rr * 0.9,
    ], d, 0));
  }
}

/* ========================================================================= */
/* SMALL HELPERS                                                             */
/* ========================================================================= */

const cr = (a, b2) => [a[1] * b2[2] - a[2] * b2[1], a[2] * b2[0] - a[0] * b2[2], a[0] * b2[1] - a[1] * b2[0]];
const l3 = a => Math.hypot(a[0], a[1], a[2]);

function frameOn(path, t) {
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
    path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1], path[i + 1][2] - path[i][2],
  ]);
  const a = perp(d);
  return { p, d, a, b: norm3(cr(d, a)) };
}

function outDir(fr, ang, roll) {
  const out = [
    fr.a[0] * Math.cos(roll) + fr.b[0] * Math.sin(roll),
    fr.a[1] * Math.cos(roll) + fr.b[1] * Math.sin(roll),
    fr.a[2] * Math.cos(roll) + fr.b[2] * Math.sin(roll),
  ];
  const axis = cr(fr.d, out);
  if (l3(axis) < 1e-6) return out;
  return norm3(rotAxis(fr.d, norm3(axis), ang));
}

/** A reusable "make this sphere lumpy" function. */
export function lumpWarp(r, n = 4, amp = 0.3) {
  const lumps = [];
  for (let i = 0; i < n; i++) {
    lumps.push({ d: norm3([r.bell(), r.bell(), r.bell()]), a: r.range(amp * 0.4, amp), s: r.range(1.2, 3.0) });
  }
  return (x, y, z) => {
    let m = 1;
    for (const L of lumps) {
      const d = Math.max(0, x * L.d[0] + y * L.d[1] + z * L.d[2]);
      m += L.a * Math.pow(d, L.s);
    }
    return m;
  };
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qr = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

export function orient(p, dir, roll = 0) {
  _d.set(dir[0], dir[1], dir[2]).normalize();
  _up.set(0, 1, 0);
  _q.setFromUnitVectors(_up, _d);
  if (roll) { _qr.setFromAxisAngle(_d, roll); _q.premultiply(_qr); }
  _p.set(p[0], p[1], p[2]);
  _s.set(1, 1, 1);
  return _m.compose(_p, _q, _s).clone();
}
