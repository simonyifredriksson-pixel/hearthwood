/* WeaponArt.js — turning a forged weapon into triangles.
   ===========================================================================
   The rule that decides every choice in this file:

       THE PLAYER MUST LOOK AT THE WEAPON AND THINK "THAT IS THE STICK I
       FOUND."

   Which is why the shaft is not modelled here at all. It is built by
   StickGen from the same spec the stick on the forest floor was built from,
   only straightened a little and stripped a little — so the bend is the same
   bend, the knots are in the same places, the moss is on the same side, and
   the seam of ore runs exactly where it ran. The forge adds a head, a guard,
   a grip and a pommel; it does not replace the wood.

   Everything else comes from the design genome in WeaponData: which head,
   how long the blade, how much curve survived, what metal, what wrap, what
   decoration. There are no weapon templates in this file — there is a set of
   parts and a very large number of ways to combine them.
*/

import * as THREE from '../../lib/three.module.js?v=1790014463';
import { MeshBuilder, tube, blob, lathe, blade as leafBlade, box, quad, tri3, beam } from './Geo.js?v=1790014463';
import { buildStick, orientMatrix } from './StickGen.js?v=1790014463';
import { SPECIES, MATERIALS } from '../data/StickData.js?v=1790014463';
import { WEAPON_CLASSES } from '../data/WeaponData.js?v=1790014463';
import { BARK, METAL, MOSS, MUSHROOM, BUILD, mixHex, tweak, shade } from './Palette.js?v=1790014463';
import { makeRng, clamp, clamp01, lerp, TAU, smoothstep } from '../core/Util.js?v=1790014463';

/* The metal the genome names, resolved to a colour. */
const METAL_HEX = {
  iron: 0x8d9099, steel: 0xb9c0cb, darksteel: 0x4f545e, bronze: 0xb07a3c,
  copper: 0xb5623a, silver: 0xd4d8dd, blackiron: 0x35383d, palegold: 0xd8b463,
  greenbronze: 0x6f9a7e, sunmetal: 0xe8c07a,
};
const metalOf = d => METAL_HEX[d.metal] || METAL.iron;

/* Where the working end starts, as a fraction of the shaft. */
const HEAD_AT = { blade: 0.42, club: 0.62, hammer: 0.86, axe: 0.84, polearm: 0.88, staff: 1, broom: 0.58, wand: 0.86, oddity: 0.72 };

/* ========================================================================= */
/* SHAFT PREPARATION                                                         */
/* ========================================================================= */

/**
 * The stick, worked.
 *
 * Note what is NOT touched: forks that the head is going to use, the moss if
 * the strip was light, the fungi, the inclusions, the coil or braid or ring
 * of a rare form. Those are the reasons this weapon is this weapon.
 */
function workedSpec(spec, d, cls) {
  const s = JSON.parse(JSON.stringify(spec));
  const st = d.straighten, strip = d.strip;

  s.curve *= (1 - st);
  s.wobble *= (1 - st * 0.85);
  s.kinks = st > 0.75 ? 0 : s.kinks;

  s.pale = clamp01(s.pale + strip * 0.75);
  s.wet *= (1 - strip * 0.9);
  s.moss = d.carry.moss;
  s.lichen = d.carry.lichen;
  s.fungi = d.carry.fungi;
  s.charred = d.carry.char;
  s.leaves = 0;
  s.brokenEnd = 'clean';
  s.brokenButt = 'clean';

  /* Twigs come off unless they are the head. Forks stay when the weapon is
     built around them (tines, halberd, antler guard) and go otherwise. */
  const keepForks = cls === 'halberd' || cls === 'spear' || cls === 'polearm' || cls === 'oddity';
  s.twigs = d.build === 'broom' ? s.twigs : [];
  if (!keepForks) s.forks = [];
  else s.forks = s.forks.filter(f => f.at > 0.55);

  s.lum *= lerp(0.94, 1.08, d.polish);
  return s;
}

/* ========================================================================= */
/* MAIN                                                                      */
/* ========================================================================= */

/**
 * Build a weapon, standing along +Y with the butt at the origin.
 *
 * @param {object} w    {cls, design, stick} from forgeWeapon
 * @param {object} opts {lod, glow}
 * @returns {{builder, glow, length, gripY, headY, path, radius}}
 */
export function buildWeapon(w, opts = {}) {
  const b = new MeshBuilder();
  const glow = opts.glow || new MeshBuilder();
  const lod = opts.lod ?? 0;
  const stick = w.stick || w.sticks?.[0];
  const d = w.design;
  const C = WEAPON_CLASSES[w.cls] || WEAPON_CLASSES.club;
  const sp = SPECIES[stick.species] || SPECIES.oak;
  const r = makeRng((d.seed ^ 0x3ea0) >>> 0);

  const spec = workedSpec(stick, d, w.cls);
  const L = spec.length;
  /* A blade starts where the genome's blade length says it starts. The first
     version always began at 42% of the shaft and ignored blade.len entirely,
     which meant a dagger and a greatsword had the same proportions and only
     differed in scale — the one thing the genome exists to prevent. */
  const t0 = d.build === 'blade'
    ? clamp(1 - d.blade.len / L, 0.16, 0.74)
    : (HEAD_AT[d.build] ?? 0.7);

  /* --- the shaft, which IS the stick ------------------------------------ */
  /* A blade is carved out of the top of the branch, so the wood up there has
     to shrink to a tang that the blade can close around. Everything else
     keeps full girth. */
  /* The tang all but vanishes: at a third of full girth it was still a
     visible stick running alongside the blade. It has to survive only as far
     as the shoulder, where the blade closes over it. */
  const radiusMul = d.build === 'blade'
    ? (t => t < t0 ? 1 : lerp(1, 0.10, smoothstep(t0, Math.min(1, t0 + 0.10), t)))
    : null;

  const info = buildStick(spec, b, {
    lod, glow,
    radiusMul,
    noRare: d.build === 'blade' || d.build === 'hammer',
  });
  const R = info.radius, path = info.path;

  /* --- the working end --------------------------------------------------- */
  if (d.build === 'blade') buildBladeAssembly(b, glow, d, spec, sp, path, R, t0, r, lod);
  else if (d.build === 'club') buildClubHead(b, glow, d, spec, sp, path, R, t0, r, lod);
  else if (d.build === 'hammer') buildHammerHead(b, glow, d, spec, sp, path, R, t0, r, lod);
  else if (d.build === 'axe') buildAxeHead(b, glow, d, spec, sp, path, R, t0, r, lod);
  else if (d.build === 'polearm') buildPolearmHead(b, glow, d, spec, sp, path, R, t0, r, lod);
  else if (d.build === 'broom') buildBroomHead(b, glow, d, spec, sp, path, R, t0, L, r, lod);
  else if (d.build === 'wand') buildWandTip(b, glow, d, spec, sp, path, R, t0, r);
  else if (d.build === 'oddity') buildOddity(b, glow, d, spec, sp, path, R, t0, L, r, lod);
  else buildStaffEnds(b, glow, d, spec, sp, path, R, r);

  /* --- the hand end ------------------------------------------------------ */
  const gripLen = clamp(d.grip.len, L * 0.08, L * 0.5);
  const g0 = d.build === 'blade' ? 0.015 / L : L * 0.05 / L;
  const g1 = g0 + gripLen / L;
  if (d.grip.wrap !== 'none') buildGrip(b, glow, path, R, g0, Math.min(g1, t0 - 0.02), d, r);
  buildPommel(b, glow, path, R, d, sp, r);
  if (d.ferrule) buildFerrule(b, path, R, d, r);

  for (let i = 0; i < d.bands; i++) {
    buildBand(b, path, R, lerp(g1 + 0.04, Math.max(g1 + 0.06, t0 - 0.03), d.bands === 1 ? 0.5 : i / (d.bands - 1)), d, r);
  }

  /* --- decoration -------------------------------------------------------- */
  if (d.deco.inlay) buildInlay(b, path, R, d.deco.inlay, g1, t0, r);
  if (d.deco.engraving && lod === 0) buildEngraving(b, path, R, d, g1, t0, r);
  if (d.deco.studs) buildStuds(b, path, R, d, g0, g1, r);
  if (d.deco.charms) buildCharms(b, glow, path, R, L, d, r);

  return {
    builder: b, glow, length: L,
    gripY: (g0 + Math.min(g1, t0 - 0.02)) * 0.5 * L,
    headY: L, radius: R(0.5), path,
  };
}

/* ========================================================================= */
/* SHARED                                                                    */
/* ========================================================================= */

function frameAt(path, t) {
  const n = path.length;
  const u = clamp(t, 0, 1) * (n - 1);
  const i = Math.min(n - 2, Math.floor(u));
  const f = u - i;
  return [
    lerp(path[i][0], path[i + 1][0], f),
    lerp(path[i][1], path[i + 1][1], f),
    lerp(path[i][2], path[i + 1][2], f),
  ];
}

/** The path direction at t, normalised. */
function dirAt(path, t) {
  const a = frameAt(path, clamp(t - 0.01, 0, 0.99));
  const c = frameAt(path, clamp(t + 0.01, 0.01, 1));
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/* ========================================================================= */
/* BLADES                                                                    */
/* ========================================================================= */

/**
 * A blade, carved from the top of the branch.
 *
 * The section is a lens: two faces meeting at a ridge down the middle and at
 * an edge down each side. The whole thing FOLLOWS THE SHAFT'S PATH, so a
 * curved branch makes a curved sword without anyone deciding it should — and
 * `design.blade.curve` adds more of the same bend on top, in the same plane,
 * which is what makes a sabre a sabre.
 */
function buildBladeAssembly(b, glow, d, spec, sp, path, R, t0, r, lod) {
  const B = d.blade;
  const steps = lod === 0 ? 20 : 11;
  const inner = tweak(sp.inner, { l: lerp(0.92, 1.1, d.polish) });
  const metal = metalOf(d);

  /* Is this a wooden blade or a forged one? The forge gives a metal blade to
     anything with real metal in the design; a plain village job stays wood,
     and a wooden edge is the older and better-looking of the two. */
  const steel = d.metal === 'steel' || d.metal === 'silver' || d.metal === 'sunmetal'
    || d.metal === 'darksteel' || d.metal === 'palegold';
  const faceHex = steel ? metal : inner;
  const edgeHex = steel ? shade(metal, 0.18) : shade(inner, 0.14);
  const spineHex = steel ? shade(metal, -0.22) : mixHex(sp.bark, inner, 0.35);

  /* the profile, all of it from the genome */
  const widthAt = u => {
    const belly = clamp01(0.5 + B.belly * 0.4);
    const swell = 1 - Math.pow(Math.abs(u - belly) / Math.max(belly, 1 - belly), 1.7) * 0.42;
    const tipIn = 1 - Math.pow(clamp01((u - (1 - B.taper * 0.45)) / Math.max(0.08, B.taper * 0.45)), 1.35);
    return B.width * swell * Math.max(0.03, tipIn);
  };
  const thickAt = u => B.thick * lerp(1, 0.45, u);

  /* The blade's own extra bend, in the plane the stick already bends in and
     BOUNDED — a deeply hooked branch could reach a curve of 2, which at the
     old coefficient threw the blade tip 60 cm sideways while the shaft went
     on up its own path, so the weapon came out as a V of two diverging
     sticks instead of a sabre. A sabre's belly is a fraction of its length,
     and that is the number this is expressed in. */
  const curve = clamp(B.curve, 0, 1.2);
  const bendOff = u => Math.pow(u, 1.7) * curve * B.len * 0.16;

  const rows = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const t = lerp(t0, 1, u);
    const p = frameAt(path, t);
    rows.push({ u, p: [p[0] + bendOff(u), p[1], p[2]], w: widthAt(u), th: thickAt(u) });
  }

  /* the body */
  for (let i = 0; i < steps; i++) {
    const A = rows[i], Z = rows[i + 1];
    const hole = d.carry.ring && A.u > 0.28 && A.u < 0.60;
    const lanes = hole ? [[-1, -0.42], [0.42, 1]] : [[-1, 1]];
    for (const [l0, l1] of lanes) {
      const mid = (l0 + l1) * 0.5;
      for (const s of [1, -1]) {
        const a0 = [A.p[0] + A.w * l0, A.p[1], A.p[2]];
        const a1 = [A.p[0] + A.w * l1, A.p[1], A.p[2]];
        const z0 = [Z.p[0] + Z.w * l0, Z.p[1], Z.p[2]];
        const z1 = [Z.p[0] + Z.w * l1, Z.p[1], Z.p[2]];
        const ar = [A.p[0] + A.w * mid, A.p[1], A.p[2] + s * A.th];
        const zr = [Z.p[0] + Z.w * mid, Z.p[1], Z.p[2] + s * Z.th];
        /* Outward hints, not hand-wound triangles. Each face of the lens
           points mostly along +/-z with a lean toward its own edge, and
           getting that by hand is how the whole blade ended up inside out
           and therefore INVISIBLE — a blade you can only see from one side
           is not a subtle defect, it is a missing weapon. */
        b.color(mixHex(faceHex, edgeHex, 0.3 + Math.abs(A.u - 0.5) * 0.2), 0.045, r);
        quad(b, a0, z0, zr, ar, 0, [l0 * 0.45, 0, s]);
        quad(b, ar, zr, z1, a1, 0, [l1 * 0.45, 0, s]);
      }
    }
    /* a fuller: a shallow groove down the flat, which is the single detail
       that most makes a blade read as a blade rather than as a plank */
    if (B.edge === 'fuller' && !hole && lod === 0 && A.u < 0.72) {
      for (const s of [1, -1]) {
        const fw = A.w * 0.22;
        b.color(shade(faceHex, -0.16), 0.04, r);
        quad(b,
          [A.p[0] - fw, A.p[1], A.p[2] + s * A.th * (1 - B.fullerDepth * 0.5)],
          [Z.p[0] - fw, Z.p[1], Z.p[2] + s * Z.th * (1 - B.fullerDepth * 0.5)],
          [Z.p[0] + fw, Z.p[1], Z.p[2] + s * Z.th * (1 - B.fullerDepth * 0.5)],
          [A.p[0] + fw, A.p[1], A.p[2] + s * A.th * (1 - B.fullerDepth * 0.5)],
          0, [0, 0, s]);
      }
    }
    /* serrations and scallops are cut into the edge itself */
    if ((B.edge === 'serrated' || B.edge === 'scalloped') && i % 2 === 0 && lod === 0) {
      const bite = B.edge === 'serrated' ? A.w * 0.16 : A.w * 0.09;
      b.color(shade(edgeHex, -0.1), 0.05, r);
      blob(b, A.p[0] + A.w, A.p[1], A.p[2], bite, 2, 4, () => [0.6, 1.4, 0.6], 0);
    }
  }

  /* the tip, whose shape is a genuine choice */
  {
    const A = rows[steps], P = rows[steps - 1];
    b.color(edgeHex, 0.05, r);
    if (B.tip === 'round' || B.tip === 'spatulate') {
      blob(b, A.p[0], A.p[1], A.p[2], Math.max(A.th, A.w) * 0.9, 3, 6, () => [1, 0.7, 1], 0);
    } else if (B.tip === 'hook') {
      const dir = [B.curve > 0 ? 1 : -1, 0.45, 0];
      tube(b, {
        pts: [A.p, [A.p[0] + dir[0] * A.w * 2.2, A.p[1] + A.w * 1.4, A.p[2]],
        [A.p[0] + dir[0] * A.w * 1.2, A.p[1] + A.w * 2.6, A.p[2]]],
        radius: u => A.th * (1.1 - u * 0.9), radial: 4, capStart: false, capEnd: true, sway: () => 0,
      });
    } else if (B.tip === 'clip') {
      tri3(b, [A.p[0] - A.w, A.p[1], A.p[2]], [A.p[0] + A.w, A.p[1], A.p[2]],
        [P.p[0], P.p[1] + B.len * 0.14, P.p[2]], 0, [0, 1, 0]);
      blob(b, A.p[0], A.p[1] + B.len * 0.05, A.p[2], A.th * 1.4, 2, 5, () => [0.7, 2, 0.7], 0);
    } else {
      blob(b, A.p[0], A.p[1] + B.len * 0.03, A.p[2], Math.max(A.th, A.w * 0.45), 3, 5, () => [0.9, 1.6, 0.9], 0);
    }
  }

  /* THE SPINE. On a wooden blade this is a surviving strip of the original
     bark along the back, which is the detail that says "this was a branch".
     On a forged one it is the thickened back of the blade. */
  if (!steel && d.carry.barkLeft > 0.12) {
    b.color(mixHex(sp.bark, spineHex, 0.3), 0.06, r);
    for (let i = 0; i < steps; i += 2) {
      const A = rows[i];
      blob(b, A.p[0] - A.w * 0.97, A.p[1], A.p[2], A.th * 0.75, 2, 5, () => [0.45, 2.4, 0.9], 0);
    }
  }
  if (B.backEdge && steel) {
    b.color(shade(metal, 0.1), 0.04, r);
    for (let i = 0; i < steps; i += 2) {
      const A = rows[i];
      blob(b, A.p[0] - A.w * 0.99, A.p[1], A.p[2], A.th * 0.5, 2, 4, () => [0.5, 2, 0.6], 0);
    }
  }

  buildGuard(b, glow, d, path, R, t0, r);
}

/* --------------------------------------------------------------- guards */

function buildGuard(b, glow, d, path, R, t0, r) {
  const G = d.guard;
  if (!G || G.kind === 'none') return;
  const p = frameAt(path, t0);
  const rr = R(t0);
  const metal = metalOf(d);
  const half = G.span;
  b.color(metal, 0.05, r);

  if (G.kind === 'crossbar') {
    tube(b, {
      pts: [[p[0] - half, p[1] + G.droop * half * 0.3, p[2]],
      [p[0], p[1], p[2]],
      [p[0] + half, p[1] + G.droop * half * 0.3, p[2]]],
      radius: u => G.thick * (0.7 + Math.sin(u * Math.PI) * 0.6), radial: 6,
      squash: () => [1, 0.65], capStart: true, capEnd: true, sway: () => 0,
    });
  } else if (G.kind === 'swept') {
    for (const s of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 8; i++) {
        const u = i / 8;
        pts.push([
          p[0] + s * half * Math.sin(u * 1.9),
          p[1] + half * (1 - Math.cos(u * 2.4)) * 0.75,
          p[2] + Math.sin(u * 3) * G.thick * 1.5,
        ]);
      }
      tube(b, { pts, radius: () => G.thick * 0.6, radial: 4, capStart: true, capEnd: true, sway: () => 0 });
    }
  } else if (G.kind === 'ring') {
    const n = 14;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU;
      pts.push([p[0] + Math.cos(a) * half, p[1] + Math.sin(a) * half * 0.55, p[2] + G.droop * half * 0.2]);
    }
    tube(b, { pts, radius: () => G.thick * 0.55, radial: 4, capStart: false, capEnd: false, sway: () => 0 });
  } else if (G.kind === 'antler') {
    for (const s of [-1, 1]) {
      for (const up of [0.4, 0.95]) {
        tube(b, {
          pts: [[p[0], p[1], p[2]],
          [p[0] + s * half * 0.6, p[1] + half * up * 0.4, p[2]],
          [p[0] + s * half, p[1] + half * up, p[2] + s * G.thick]],
          radius: u => G.thick * (0.9 - u * 0.6), radial: 4, capStart: false, capEnd: true, sway: () => 0,
        });
      }
    }
  } else if (G.kind === 'leaf') {
    for (const s of [-1, 1]) {
      const sub = new MeshBuilder();
      sub.color(metal, 0.05, r);
      leafBlade(sub, { len: half * 1.6, wid: half * 0.55, segs: 2, curl: 0.2, cup: 0.35, swayBase: 0, swayTip: 0 });
      b.append(sub, orientMatrix(p, [s, 0.35, 0], r.range(0, TAU)));
    }
  } else if (G.kind === 'disc') {
    lathe(b, [[rr * 1.1, p[1] - G.thick], [half, p[1] - G.thick * 0.4],
    [half, p[1] + G.thick * 0.4], [rr * 1.1, p[1] + G.thick]], 12, p[0], p[2]);
  } else if (G.kind === 'thorn') {
    const n = r.int(4, 7);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      tube(b, {
        pts: [[p[0], p[1], p[2]],
        [p[0] + Math.cos(a) * half, p[1] - half * 0.45, p[2] + Math.sin(a) * half]],
        radius: u => G.thick * (0.9 - u * 0.8), radial: 3, capStart: false, capEnd: true, sway: () => 0,
      });
    }
  }
}

/* ========================================================================= */
/* HEADS                                                                     */
/* ========================================================================= */

/** A club: the shaft swells rather than gaining a separate head. */
function buildClubHead(b, glow, d, spec, sp, path, R, t0, r, lod) {
  const H = d.head;
  const steps = lod === 0 ? 9 : 5;
  const hex = mixHex(sp.bark, sp.inner, 0.25 + d.strip * 0.4);

  if (H.kind === 'burl' || H.keepBurl) {
    /* a grown head: overlapping lobes, no two the same, which is what a burl
       actually looks like and what a lathe never will */
    const top = frameAt(path, 0.94);
    for (let i = 0; i < H.lumps; i++) {
      const a = (i / H.lumps) * TAU + r.range(-0.4, 0.4);
      const t = lerp(t0 + 0.08, 0.99, r.range(0, 1));
      const p = frameAt(path, t);
      const rr = R(t);
      b.color(tweak(hex, { l: r.range(0.85, 1.15) }), 0.07, r);
      blob(b,
        p[0] + Math.cos(a) * rr * r.range(0.2, 0.9),
        p[1] + r.range(-0.02, 0.02),
        p[2] + Math.sin(a) * rr * r.range(0.2, 0.9),
        H.size * r.range(0.55, 1.0), 3, lod === 0 ? 7 : 5,
        () => [r.range(0.8, 1.2), r.range(0.75, 1.1), r.range(0.8, 1.2)], 0);
    }
  } else if (H.kind === 'knotted') {
    for (let i = 0; i < H.lumps + 3; i++) {
      const t = lerp(t0, 1, i / (H.lumps + 3));
      const a = i * 2.39;
      const p = frameAt(path, t), rr = R(t);
      b.color(tweak(hex, { l: r.range(0.8, 1.2) }), 0.08, r);
      blob(b, p[0] + Math.cos(a) * rr * 0.7, p[1], p[2] + Math.sin(a) * rr * 0.7,
        H.size * r.range(0.3, 0.6), 2, 5, null, 0);
    }
  } else {
    /* a turned taper: the shaft simply gets fatter toward the business end */
    const prof = [];
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const t = lerp(t0, 1, u);
      prof.push([R(t) + H.size * Math.pow(u, 1.6) * (1 - Math.pow(u, 7) * 0.7), frameAt(path, t)[1]]);
    }
    const p0 = frameAt(path, t0);
    b.color(hex, 0.06, r);
    lathe(b, prof, lod === 0 ? 10 : 7, p0[0], p0[2]);
  }

  for (let i = 0; i < H.bands; i++) {
    buildBand(b, path, R, lerp(t0 - 0.05, t0 + 0.06, H.bands === 1 ? 0.5 : i / (H.bands - 1)), d, r);
  }
}

/** A hammer, mace or maul: a real head, mounted across the top of the haft. */
function buildHammerHead(b, glow, d, spec, sp, path, R, t0, r, lod) {
  const H = d.head;
  const p = frameAt(path, t0);
  const top = frameAt(path, 1);
  const rr = R(t0);
  const metal = metalOf(d);
  const sz = H.size;
  const y = lerp(p[1], top[1], 0.55);
  const seg = lod === 0 ? 9 : 6;

  if (H.kind === 'burl' || H.keepBurl) {
    /* the burl that grew on the branch, kept whole, because you do not carve
       a burl — the weapon is the tree's idea and the smith only fits a handle */
    const hex = mixHex(sp.bark, sp.inner, 0.2);
    for (let i = 0; i < H.lumps + 3; i++) {
      const a = (i / (H.lumps + 3)) * TAU;
      const rad = sz * r.range(0.5, 0.95);
      b.color(tweak(hex, { l: r.range(0.82, 1.18) }), 0.07, r);
      blob(b,
        p[0] + Math.cos(a) * sz * r.range(0.1, 0.65),
        y + r.range(-sz * 0.45, sz * 0.45),
        p[2] + Math.sin(a) * sz * r.range(0.1, 0.65),
        rad, 3, seg, () => [r.range(0.85, 1.15), r.range(0.8, 1.1), r.range(0.85, 1.15)], 0);
    }
  } else if (H.kind === 'stone') {
    const hex = 0x8d8a80;
    for (let i = 0; i < H.faces; i++) {
      const a = (i / H.faces) * TAU;
      b.color(tweak(hex, { l: r.range(0.8, 1.2) }), 0.06, r);
      blob(b, p[0] + Math.cos(a) * sz * 0.4, y, p[2] + Math.sin(a) * sz * 0.4,
        sz * r.range(0.6, 0.95), 2, 4, () => [1, r.range(0.7, 1.1), 1], 0);
    }
    b.color(BUILD.rope, 0.06, r);
    for (const yy of [y - sz * 0.6, y + sz * 0.6]) {
      lathe(b, [[sz * 0.75, yy - sz * 0.08], [sz * 0.8, yy + sz * 0.08]], 8, p[0], p[2]);
    }
  } else {
    /* forged: a faceted block, one face flat and the other whatever the
       genome said — a beak, a spike, a drum, or nothing */
    b.color(metal, 0.05, r);
    const faces = H.faces;
    const prof = [
      [sz * 0.30, y - sz * 1.0], [sz * 0.96, y - sz * 0.82],
      [sz * 1.0, y + sz * 0.82], [sz * 0.34, y + sz * 1.0],
    ];
    lathe(b, prof, Math.max(4, faces), p[0], p[2]);
    // the struck face, slightly proud and worn bright
    b.color(shade(metal, 0.16), 0.04, r);
    lathe(b, [[sz * 1.02, y - sz * 0.5], [sz * 1.06, y + sz * 0.5]], Math.max(4, faces), p[0], p[2]);

    if (H.kind === 'beaked' || H.spike) {
      const a = r.range(0, TAU);
      b.color(shade(metal, -0.1), 0.05, r);
      tube(b, {
        pts: [[p[0], y, p[2]],
        [p[0] + Math.cos(a) * sz * 1.5, y + sz * 0.25, p[2] + Math.sin(a) * sz * 1.5],
        [p[0] + Math.cos(a) * sz * 2.3, y + sz * 0.05, p[2] + Math.sin(a) * sz * 2.3]],
        radius: u => sz * (0.45 - u * 0.4), radial: 5, capStart: false, capEnd: true, sway: () => 0,
      });
    }
    if (H.kind === 'drum') {
      b.color(shade(metal, -0.2), 0.05, r);
      lathe(b, [[sz * 1.04, y - sz * 0.12], [sz * 1.1, y + sz * 0.12]], Math.max(6, faces), p[0], p[2]);
    }
  }

  /* the haft runs THROUGH the head and is wedged from the top, which is how
     a hammer is actually put together and reads instantly as one */
  const hex2 = mixHex(sp.bark, sp.inner, 0.5);
  b.color(hex2, 0.06, r);
  box(b, top[0], top[1] + rr * 0.35, top[2], rr * 1.5, rr * 0.9, rr * 1.5);
  b.color(shade(hex2, -0.25), 0.05, r);
  box(b, top[0], top[1] + rr * 0.5, top[2], rr * 0.4, rr * 0.9, rr * 1.6);

  for (let i = 0; i < H.bands; i++) {
    buildBand(b, path, R, t0 - 0.03 - i * 0.05, d, r);
  }
}

/** An axe: a bit on one side, a poll on the other, bound to the haft. */
function buildAxeHead(b, glow, d, spec, sp, path, R, t0, r, lod) {
  const H = d.head;
  const p = frameAt(path, t0);
  const top = frameAt(path, 1);
  const rr = R(t0);
  const metal = metalOf(d);
  const sz = H.size * 1.5;
  const y0 = p[1], y1 = lerp(p[1], top[1], 0.92);
  const side = d.asym >= 0 ? 1 : -1;
  const beard = H.beard;

  /* The bit is a real plate with an edge: two faces meeting at the cutting
     line, swept back to the eye. Built by hand rather than lathed because an
     axe is the one head that is emphatically NOT a solid of revolution. */
  const rows = 7;
  const outer = [], innerPts = [];
  for (let i = 0; i <= rows; i++) {
    const u = i / rows;
    const yy = lerp(y0 - sz * beard * 0.5, y1 + sz * 0.25, u);
    /* the cutting edge bulges out in the middle — a crescent, not a triangle */
    const reach = sz * (H.kind === 'crescent' ? (0.5 + Math.sin(u * Math.PI) * 1.5)
      : H.kind === 'broad' ? (0.7 + Math.sin(u * Math.PI) * 1.1)
        : H.kind === 'bearded' ? (0.35 + Math.pow(1 - u, 1.6) * 1.8)
          : (0.4 + Math.sin(u * Math.PI) * 0.95));
    outer.push([p[0] + side * reach, yy, p[2]]);
    innerPts.push([p[0] + side * rr * 0.6, yy, p[2]]);
  }
  for (let i = 0; i < rows; i++) {
    const th = sz * 0.12 * (1 - i / rows * 0.3);
    for (const s of [1, -1]) {
      b.color(mixHex(metal, shade(metal, s > 0 ? 0.12 : -0.12), 0.5), 0.05, r);
      quad(b,
        [innerPts[i][0], innerPts[i][1], innerPts[i][2] + s * th],
        [innerPts[i + 1][0], innerPts[i + 1][1], innerPts[i + 1][2] + s * th],
        [outer[i + 1][0], outer[i + 1][1], outer[i + 1][2]],
        [outer[i][0], outer[i][1], outer[i][2]],
        0, [0, 0, s]);
      // the back of the eye, so the head is closed
      b.color(shade(metal, -0.25), 0.05, r);
      quad(b,
        [innerPts[i][0] - side * rr * 1.2, innerPts[i][1], innerPts[i][2] + s * th],
        [innerPts[i][0], innerPts[i][1], innerPts[i][2] + s * th],
        [innerPts[i + 1][0], innerPts[i + 1][1], innerPts[i + 1][2] + s * th],
        [innerPts[i + 1][0] - side * rr * 1.2, innerPts[i + 1][1], innerPts[i + 1][2] + s * th],
        0, [0, 0, s]);
    }
    // the bright cutting edge
    b.color(shade(metal, 0.3), 0.03, r);
    blob(b, outer[i][0], outer[i][1], outer[i][2], sz * 0.055, 2, 4, () => [0.5, 1.6, 0.5], 0);
  }
  // the poll behind the eye
  b.color(shade(metal, -0.1), 0.05, r);
  box(b, p[0] - side * rr * 1.1, lerp(y0, y1, 0.5), p[2], rr * 1.5, sz * 0.7, rr * 2.2);

  // lashing
  b.color(BUILD.rope, 0.07, r);
  for (let k = 0; k < 3; k++) {
    buildBand(b, path, R, clamp(t0 - 0.04 + k * 0.03, 0.1, 0.97), d, r, BUILD.rope);
  }
}

/** A spear, glaive or halberd: a point, and sometimes a good deal more. */
function buildPolearmHead(b, glow, d, spec, sp, path, R, t0, r, lod) {
  const P = d.point;
  const p0 = frameAt(path, t0);
  const rr = R(t0);
  const metal = metalOf(d);
  const inner = tweak(sp.inner, { l: 1.02 });
  const steel = d.metal !== 'iron' || r.chance(0.6);
  const hex = steel ? metal : inner;
  const facets = P.kind === 'needle' ? 4 : 6;

  /* the socket that takes the shaft */
  b.color(shade(metal, -0.15), 0.05, r);
  lathe(b, [[rr * 1.16, p0[1] - P.socket * 0.5], [rr * 1.2, p0[1] + P.socket * 0.4],
  [rr * 0.95, p0[1] + P.socket * 0.6]], 8, p0[0], p0[2]);

  if (P.kind === 'leaf' || P.kind === 'broad' || P.kind === 'glaive' || P.kind === 'bill') {
    /* a flat blade rather than a spike: two faces to a central ridge */
    const steps = 8;
    const long = P.len * (P.kind === 'glaive' ? 1.8 : 1);
    const curveSide = P.kind === 'glaive' || P.kind === 'bill' ? (d.asym >= 0 ? 1 : -1) : 0;
    const rows = [];
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const y = p0[1] + P.socket * 0.6 + long * u;
      const w = P.width * Math.sin(Math.pow(u, 0.75) * Math.PI) * (1 - Math.pow(u, 5) * 0.6) + 0.002;
      rows.push({ y, w, x: p0[0] + curveSide * Math.pow(u, 1.8) * long * 0.30, u });
    }
    for (let i = 0; i < steps; i++) {
      const A = rows[i], Z = rows[i + 1];
      const th = P.width * 0.22 * (1 - A.u * 0.6);
      for (const s of [1, -1]) {
        b.color(mixHex(hex, shade(hex, 0.15), 0.4), 0.05, r);
        quad(b,
          [A.x - A.w, A.y, p0[2]], [Z.x - Z.w, Z.y, p0[2]],
          [Z.x, Z.y, p0[2] + s * th], [A.x, A.y, p0[2] + s * th], 0, [-0.45, 0, s]);
        quad(b,
          [A.x, A.y, p0[2] + s * th], [Z.x, Z.y, p0[2] + s * th],
          [Z.x + Z.w, Z.y, p0[2]], [A.x + A.w, A.y, p0[2]], 0, [0.45, 0, s]);
      }
    }
    if (P.kind === 'halberd') { /* the axe cheek is added below */ }
  } else {
    /* a spike: a long faceted point */
    const steps = 6;
    const rows = [];
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      rows.push({
        y: p0[1] + P.socket * 0.6 + P.len * u,
        r: P.width * (1 - Math.pow(u, P.kind === 'needle' ? 1.05 : 1.35)) + 0.0008,
      });
    }
    for (let i = 0; i < steps; i++) {
      const A = rows[i], Z = rows[i + 1];
      for (let f = 0; f < facets; f++) {
        const a0 = (f / facets) * TAU, a1 = ((f + 1) / facets) * TAU;
        b.color(mixHex(hex, shade(hex, -0.12), (f % 2) * 0.6), 0.05, r);
        quad(b,
          [p0[0] + Math.cos(a0) * A.r, A.y, p0[2] + Math.sin(a0) * A.r],
          [p0[0] + Math.cos(a1) * A.r, A.y, p0[2] + Math.sin(a1) * A.r],
          [p0[0] + Math.cos(a1) * Z.r, Z.y, p0[2] + Math.sin(a1) * Z.r],
          [p0[0] + Math.cos(a0) * Z.r, Z.y, p0[2] + Math.sin(a0) * Z.r]);
      }
    }
    // barbs, swept back
    for (let k = 0; k < P.barbs; k++) {
      const a = r.range(0, TAU);
      const y = p0[1] + P.socket * 0.6 + P.len * r.range(0.1, 0.4);
      b.color(shade(hex, -0.08), 0.05, r);
      tube(b, {
        pts: [[p0[0], y, p0[2]],
        [p0[0] + Math.cos(a) * P.width * 2.2, y - P.len * 0.16, p0[2] + Math.sin(a) * P.width * 2.2]],
        radius: u => P.width * 0.32 * (1 - u * 0.85), radial: 3, capStart: false, capEnd: true, sway: () => 0,
      });
    }
  }

  /* a halberd's axe cheek, and the fork's own tines when the wood had them */
  if (P.kind === 'halberd') {
    const side = d.asym >= 0 ? 1 : -1;
    const y = p0[1] + P.len * 0.35;
    const sz = P.width * 3.4;
    b.color(metal, 0.05, r);
    for (const s of [1, -1]) {
      quad(b,
        [p0[0], y - sz * 0.5, p0[2] + s * P.width * 0.2],
        [p0[0], y + sz * 0.5, p0[2] + s * P.width * 0.2],
        [p0[0] + side * sz * 0.9, y + sz * 0.15, p0[2]],
        [p0[0] + side * sz * 1.05, y - sz * 0.35, p0[2]], 0, [0, 0, s]);
    }
    b.color(shade(metal, -0.12), 0.05, r);
    tube(b, {
      pts: [[p0[0], y, p0[2]], [p0[0] - side * sz * 1.1, y + sz * 0.3, p0[2]]],
      radius: u => P.width * 0.4 * (1 - u * 0.8), radial: 4, capStart: false, capEnd: true, sway: () => 0,
    });
  }
  if (P.tines) buildTines(b, spec, sp, path, R, r, P.tines, hex);

  /* the binding below the head that stops the shaft splitting */
  b.color(BUILD.rope, 0.06, r);
  const steps = 26, pts = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const t = lerp(t0 - 0.06, t0 + 0.01, u);
    const q = frameAt(path, t);
    const a = u * 5 * TAU;
    pts.push([q[0] + Math.cos(a) * R(t) * 1.08, q[1], q[2] + Math.sin(a) * R(t) * 1.08]);
  }
  tube(b, { pts, radius: () => rr * 0.13, radial: 3, capStart: true, capEnd: true, sway: () => 0 });
}

/** The forks kept and sharpened. */
function buildTines(b, spec, sp, path, R, r, n, hex) {
  const t0 = 0.80;
  const p0 = frameAt(path, t0);
  const rr = R(t0);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + 0.3;
    const spread = rr * lerp(2.2, 4.6, i % 2);
    const len = spec.length * r.range(0.11, 0.2);
    b.color(hex, 0.06, r);
    tube(b, {
      pts: [p0,
      [p0[0] + Math.cos(a) * spread * 0.45, p0[1] + len * 0.55, p0[2] + Math.sin(a) * spread * 0.45],
      [p0[0] + Math.cos(a) * spread * 0.8, p0[1] + len, p0[2] + Math.sin(a) * spread * 0.8]],
      radius: u => rr * (0.5 - u * 0.44), radial: 4,
      capStart: false, capEnd: true, sway: () => 0,
    });
  }
}

/** A broom: a bound bundle of whips flaring from the shaft. */
function buildBroomHead(b, glow, d, spec, sp, path, R, t0, L, r, lod) {
  const bs = d.carry.bristle || { n: 60, len: 0.32, spread: 0.45 };
  const n = Math.round(bs.n * (lod === 0 ? 1.3 : 0.55));
  const base = frameAt(path, t0);
  const rr = R(t0);

  for (let i = 0; i < n; i++) {
    const a = r.range(0, TAU);
    const spread = bs.spread * r.range(0.3, 1.25);
    const len = L * r.range(0.24, 0.42);
    const start = frameAt(path, lerp(t0, 0.98, r.range(0, 1)));
    const pts = [];
    for (let k = 0; k <= 3; k++) {
      const u = k / 3;
      const flare = Math.pow(u, 1.5) * spread * rr * 7;
      pts.push([start[0] + Math.cos(a) * flare, start[1] - len * u, start[2] + Math.sin(a) * flare]);
    }
    b.color(mixHex(tweak(sp.bark, { l: r.range(0.85, 1.25) }), BARK.deadWood, r.range(0, 0.45)), 0.08, r);
    tube(b, { pts, radius: u => rr * 0.09 * (1 - u * 0.75), radial: 3, capStart: false, capEnd: false, sway: u => u * 0.45 });
  }

  /* three turns of cord, and the Stickwright will tell you three is the one
     that matters */
  const lit = d.carry.effect === 'foxfire' && glow ? glow : b;
  lit.color(d.carry.effect === 'foxfire' ? MUSHROOM.glowCap : BUILD.rope, 0.06, r);
  for (let k = 0; k < 3; k++) {
    const t = t0 + 0.035 + k * 0.045;
    const p = frameAt(path, t);
    const pts = [];
    for (let i = 0; i <= 22; i++) {
      const u = i / 22;
      const ang = u * TAU * 1.06;
      pts.push([p[0] + Math.cos(ang) * R(t) * 1.4, p[1] - u * 0.012, p[2] + Math.sin(ang) * R(t) * 1.4]);
    }
    tube(lit, { pts, radius: () => R(t) * 0.16, radial: 4, capStart: true, capEnd: true, sway: () => 0 });
  }
}

/** A wand: it is nearly all shaft, so the tip has to carry it. */
function buildWandTip(b, glow, d, spec, sp, path, R, t0, r) {
  const p = frameAt(path, 1);
  const rr = R(1);
  const M = d.carry.special ? MATERIALS[d.carry.special] : null;
  const lit = M && M.glow > 0.45 && glow ? glow : b;

  if (M) {
    /* the material the wood found, set into the end — the one place where
       putting it on the tip is honest, because that is where a wand's
       business is */
    lit.color(M.hex, 0.08, r);
    const n = r.int(3, 6);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      lathe(lit, [[rr * 0.5, p[1]], [rr * 0.7, p[1] + rr * 1.1], [0.0005, p[1] + rr * r.range(2.4, 4.0)]],
        5, p[0] + Math.cos(a) * rr * 0.35, p[2] + Math.sin(a) * rr * 0.35);
    }
    // a cage of wire holding it on
    b.color(metalOf(d), 0.05, r);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      tube(b, {
        pts: [[p[0] + Math.cos(a) * rr * 1.1, p[1] - rr * 1.6, p[2] + Math.sin(a) * rr * 1.1],
        [p[0] + Math.cos(a) * rr * 1.3, p[1] + rr * 0.6, p[2] + Math.sin(a) * rr * 1.3]],
        radius: () => rr * 0.13, radial: 3, capStart: true, capEnd: true, sway: () => 0,
      });
    }
  } else {
    /* No strange material in the wood, so the tip has to be made rather than
       found: a turned collar, a carved bud, and a whipping of cord below it.
       A wand is nearly all shaft, so if the tip is a plain ball the whole
       weapon is a stick with a ball on it. */
    const metal = metalOf(d);
    b.color(metal, 0.05, r);
    lathe(b, [[rr * 1.05, p[1] - rr * 2.6], [rr * 1.25, rr * -1.6 + p[1]],
    [rr * 1.1, p[1] - rr * 0.9]], 8, p[0], p[2]);
    b.color(mixHex(sp.inner, sp.bark, 0.25), 0.06, r);
    lathe(b, [[rr * 0.55, p[1] - rr * 0.9], [rr * 1.35, p[1] + rr * 0.5],
    [rr * 1.15, p[1] + rr * 1.7], [rr * 0.45, p[1] + rr * 2.5], [0.0008, p[1] + rr * 3.1]],
      7, p[0], p[2]);
    b.color(BUILD.rope, 0.06, r);
    const pts = [];
    for (let i = 0; i <= 18; i++) {
      const u = i / 18;
      const t = 1 - 0.10 + u * 0.075;
      const q = frameAt(path, clamp(t, 0.02, 0.99));
      const a = u * 3.2 * TAU;
      pts.push([q[0] + Math.cos(a) * R(t) * 1.08, q[1], q[2] + Math.sin(a) * R(t) * 1.08]);
    }
    tube(b, { pts, radius: () => rr * 0.14, radial: 3, capStart: true, capEnd: true, sway: () => 0 });
  }
}

/** A staff or walking stick: shod at the bottom, capped at the top. */
function buildStaffEnds(b, glow, d, spec, sp, path, R, r) {
  const metal = metalOf(d);
  const top = frameAt(path, 1);
  const rr = R(1);
  if (r.chance(0.6)) {
    b.color(metal, 0.05, r);
    lathe(b, [[rr * 1.05, top[1] - rr * 1.6], [rr * 1.15, top[1] - rr * 0.2],
    [rr * 0.85, top[1] + rr * 0.4]], 8, top[0], top[2]);
  } else {
    b.color(mixHex(sp.bark, sp.inner, 0.5), 0.06, r);
    blob(b, top[0], top[1] + rr * 0.3, top[2], rr * r.range(1.3, 1.9), 3, 6, null, 0);
  }
}

/**
 * An oddity. Nobody, including the Stickwright, is entirely sure what these
 * are for. They are assembled out of the same parts as everything else, in
 * combinations the rest of the table would never produce.
 */
function buildOddity(b, glow, d, spec, sp, path, R, t0, L, r, lod) {
  const metal = metalOf(d);
  const p = frameAt(path, t0);
  const top = frameAt(path, 1);
  const rr = R(t0);
  const M = d.carry.special ? MATERIALS[d.carry.special] : null;
  const lit = M && M.glow > 0.45 && glow ? glow : b;

  /* a hoop, off-centre */
  const n = 16, pts = [];
  const rad = rr * r.range(3.5, 7);
  const tilt = r.range(-0.5, 0.5);
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * TAU;
    pts.push([
      top[0] + Math.cos(a) * rad,
      top[1] + Math.sin(a) * rad * 0.65 + rad * 0.7,
      top[2] + Math.sin(a) * rad * tilt,
    ]);
  }
  b.color(metal, 0.05, r);
  tube(b, { pts, radius: () => rr * 0.30, radial: 4, capStart: false, capEnd: false, sway: () => 0 });

  /* things hanging inside it */
  const hang = r.int(2, 5);
  for (let i = 0; i < hang; i++) {
    const a = r.range(0, TAU);
    const drop = rad * r.range(0.4, 1.1);
    const hx = top[0] + Math.cos(a) * rad * r.range(0.2, 0.8);
    const hz = top[2] + Math.sin(a) * rad * 0.2;
    const hy = top[1] + rad * 0.7;
    b.color(BUILD.rope, 0.06, r);
    tube(b, {
      pts: [[hx, hy, hz], [hx, hy - drop, hz]],
      radius: () => rr * 0.07, radial: 3, capStart: false, capEnd: false, sway: u => u * 0.5,
    });
    lit.color(M ? M.hex : mixHex(sp.inner, METAL.bronze, 0.5), 0.07, r);
    blob(lit, hx, hy - drop - rr * 0.4, hz, rr * r.range(0.5, 1.1), 2, 5, null, 0.3);
  }

  /* and a second, smaller arm branching off, because an oddity is never one
     thing */
  if (r.chance(0.7)) {
    const a = r.range(0, TAU);
    const len = L * r.range(0.12, 0.26);
    b.color(mixHex(sp.bark, sp.inner, 0.4), 0.06, r);
    tube(b, {
      pts: [[p[0], p[1], p[2]],
      [p[0] + Math.cos(a) * len * 0.5, p[1] + len * 0.6, p[2] + Math.sin(a) * len * 0.5],
      [p[0] + Math.cos(a) * len * 0.9, p[1] + len, p[2] + Math.sin(a) * len * 0.9]],
      radius: u => rr * (0.7 - u * 0.4), radial: 5, capStart: false, capEnd: true, sway: () => 0,
    });
  }
}

/* ========================================================================= */
/* FITTINGS                                                                  */
/* ========================================================================= */

function buildGrip(b, glow, path, R, t0, t1, d, r) {
  const G = d.grip;
  if (t1 <= t0) return;
  const hex = {
    cord: BUILD.rope, leather: 0x5a3f2a, braid: 0x8a6a45,
    wire: metalOf(d), bark: BARK.deadWood,
  }[G.wrap] || BUILD.rope;
  const tint = tweak(hex, { l: lerp(0.82, 1.18, G.colour) });

  if (G.wrap === 'leather' || G.wrap === 'bark') {
    const pts = [];
    for (let i = 0; i <= 14; i++) pts.push(frameAt(path, lerp(t0, t1, i / 14)));
    b.color(tint, 0.05, r);
    tube(b, {
      pts, radius: u => R(lerp(t0, t1, u)) * 1.12 * lerp(1, G.swell, Math.sin(u * Math.PI)),
      radial: 8,
      color: (u, i, ang) => {
        const seam = Math.abs(((ang * 1.6 + u * 14) % TAU) - Math.PI) < 0.26;
        return seam ? shade(tint, -0.35) : shade(tint, Math.sin(ang * 3) * 0.05);
      },
      capStart: false, capEnd: false, sway: () => 0,
    });
    return;
  }

  /* a real helix. Two bands with a gap, when the genome says so, which is the
     difference between "wrapped" and "wrapped by someone who cared". */
  const spans = G.gap ? [[t0, lerp(t0, t1, 0.42)], [lerp(t0, t1, 0.58), t1]] : [[t0, t1]];
  for (const [a0, a1] of spans) {
    const turns = Math.max(3, Math.round(G.turns * (a1 - a0) / (t1 - t0)));
    const steps = turns * 7;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const t = lerp(a0, a1, u);
      const p = frameAt(path, t);
      const ang = u * turns * TAU;
      const rr = R(t) * 1.06;
      pts.push([p[0] + Math.cos(ang) * rr, p[1], p[2] + Math.sin(ang) * rr]);
    }
    b.color(tint, 0.07, r);
    tube(b, {
      pts, radius: u => R(lerp(a0, a1, u)) * (G.wrap === 'wire' ? 0.09 : G.wrap === 'braid' ? 0.19 : 0.13),
      radial: G.wrap === 'wire' ? 3 : 4, capStart: true, capEnd: true, sway: () => 0,
    });
    if (G.wrap === 'braid') {
      const pts2 = [];
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const t = lerp(a0, a1, u);
        const p = frameAt(path, t);
        const ang = -u * turns * TAU + 1.7;
        const rr = R(t) * 1.06;
        pts2.push([p[0] + Math.cos(ang) * rr, p[1], p[2] + Math.sin(ang) * rr]);
      }
      b.color(shade(tint, -0.2), 0.06, r);
      tube(b, { pts: pts2, radius: u => R(lerp(a0, a1, u)) * 0.15, radial: 4, capStart: true, capEnd: true, sway: () => 0 });
    }
  }
}

function buildPommel(b, glow, path, R, d, sp, r) {
  const kind = d.pommel.kind;
  if (kind === 'none') return;
  const p = frameAt(path, 0);
  /* The butt of a branch is already the thick end, so a pommel scaled by
     1.65x the shaft radius on top of a 1.5x size roll came out as a grapefruit
     on the end of a spear. A pommel is a counterweight you can close a hand
     over, so it is barely wider than the wood it caps. */
  const rr = R(0) * lerp(0.62, 0.92, clamp01((d.pommel.size - 0.75) / 0.75));
  const metal = metalOf(d);

  if (kind === 'knob') {
    b.color(mixHex(sp.bark, sp.inner, 0.4), 0.06, r);
    blob(b, p[0], p[1] - rr * 0.3, p[2], rr * 1.65, 4, 8, () => [1, 0.85, 1], 0);
  } else if (kind === 'cap') {
    b.color(metal, 0.05, r);
    lathe(b, [[rr * 1.15, p[1] + rr * 0.6], [rr * 1.22, p[1] - rr * 0.2],
    [rr * 0.7, p[1] - rr * 0.75], [0.001, p[1] - rr * 0.85]], 9, p[0], p[2]);
  } else if (kind === 'disc') {
    b.color(metal, 0.05, r);
    lathe(b, [[0.001, p[1] - rr * 0.9], [rr * 2.0, p[1] - rr * 0.45],
    [rr * 2.1, p[1] + rr * 0.1], [rr * 0.9, p[1] + rr * 0.5]], 10, p[0], p[2]);
  } else if (kind === 'sphere') {
    b.color(metal, 0.04, r);
    lathe(b, [[0.001, p[1] - rr * 1.5], [rr * 1.1, p[1] - rr * 1.0], [rr * 1.45, p[1] - rr * 0.1],
    [rr * 1.1, p[1] + rr * 0.8], [rr * 0.5, p[1] + rr * 1.0]], 11, p[0], p[2]);
  } else if (kind === 'beak') {
    b.color(metal, 0.05, r);
    const a = r.range(0, TAU);
    tube(b, {
      pts: [[p[0], p[1], p[2]], [p[0] + Math.cos(a) * rr * 1.2, p[1] - rr * 1.1, p[2] + Math.sin(a) * rr * 1.2],
      [p[0] + Math.cos(a) * rr * 2.2, p[1] - rr * 0.9, p[2] + Math.sin(a) * rr * 2.2]],
      radius: u => rr * (0.6 - u * 0.5), radial: 5, capStart: true, capEnd: true, sway: () => 0,
    });
  } else if (kind === 'stone') {
    b.color(0x8d8a80, 0.07, r);
    blob(b, p[0], p[1] - rr * 0.6, p[2], rr * 1.5, 2, 5, () => [1, 0.85, 1.1], 0);
    b.color(BUILD.rope, 0.06, r);
    lathe(b, [[rr * 1.18, p[1] - rr * 0.1], [rr * 1.22, p[1] + rr * 0.35]], 8, p[0], p[2]);
  } else if (kind === 'hook') {
    b.color(mixHex(sp.bark, sp.inner, 0.5), 0.06, r);
    const a = r.range(0, TAU);
    const pts = [];
    for (let i = 0; i <= 7; i++) {
      const u = i / 7;
      pts.push([
        p[0] + Math.cos(a) * rr * 2.4 * Math.sin(u * 2.0),
        p[1] - rr * 0.2 - rr * 2.0 * u * (1 - u * 0.5),
        p[2] + Math.sin(a) * rr * 2.4 * Math.sin(u * 2.0),
      ]);
    }
    tube(b, { pts, radius: () => rr * 0.55, radial: 5, capStart: true, capEnd: true, sway: () => 0 });
  }
}

function buildFerrule(b, path, R, d, r) {
  const p = frameAt(path, 0.03);
  const rr = R(0.03);
  b.color(metalOf(d), 0.05, r);
  lathe(b, [[rr * 1.16, p[1] - rr * 0.6], [rr * 1.20, p[1] + rr * 1.8], [rr * 1.05, p[1] + rr * 2.0]], 9, p[0], p[2]);
}

function buildBand(b, path, R, t, d, r, forceHex = null) {
  const tt = clamp(t, 0.02, 0.98);
  const p = frameAt(path, tt);
  const rr = R(tt);
  b.color(forceHex || metalOf(d), 0.06, r);
  lathe(b, [[rr * 1.14, p[1] - rr * 0.45], [rr * 1.18, p[1] + rr * 0.45]], 9, p[0], p[2]);
}

function buildInlay(b, path, R, kind, t0, t1, r) {
  const hex = { gold: METAL.gold, copper: BUILD.copper, silver: 0xd4d8dd,
    bone: 0xe0d8c0, green: 0x6f9a7e }[kind] || METAL.bronze;
  const a0 = clamp(t0 + 0.03, 0.05, 0.9), a1 = clamp(t1 - 0.02, a0 + 0.08, 0.97);
  const steps = 40, pts = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const t = lerp(a0, a1, u);
    const p = frameAt(path, t);
    const ang = u * 3.2 * TAU;
    const rr = R(t) * 1.01;
    pts.push([p[0] + Math.cos(ang) * rr, p[1], p[2] + Math.sin(ang) * rr]);
  }
  b.color(hex, 0.05, r);
  tube(b, { pts, radius: u => R(lerp(a0, a1, u)) * 0.07, radial: 3, capStart: false, capEnd: false, sway: () => 0 });
}

/** Shallow marks cut into the wood — cheap, and they catch the light. */
function buildEngraving(b, path, R, d, t0, t1, r) {
  const a0 = clamp(t0 + 0.04, 0.05, 0.9), a1 = clamp(t1 - 0.03, a0 + 0.06, 0.96);
  const n = r.int(4, 11);
  const style = d.deco.engraving;
  for (let i = 0; i < n; i++) {
    const t = lerp(a0, a1, n === 1 ? 0.5 : i / (n - 1));
    const p = frameAt(path, t);
    const rr = R(t);
    const ang = style === 'line' ? 0 : i * (style === 'scale' ? 1.1 : 2.39);
    b.color(shade(BARK.deadWood, -0.3), 0.04, r);
    if (style === 'wave' || style === 'knot') {
      const pts = [];
      for (let k = 0; k <= 9; k++) {
        const u = k / 9;
        const a = ang + u * (style === 'knot' ? TAU * 0.8 : 1.6) + Math.sin(u * 6) * 0.5;
        const q = frameAt(path, clamp(t + (u - 0.5) * 0.04, 0.02, 0.98));
        pts.push([q[0] + Math.cos(a) * rr * 1.01, q[1], q[2] + Math.sin(a) * rr * 1.01]);
      }
      tube(b, { pts, radius: () => rr * 0.055, radial: 3, capStart: false, capEnd: false, sway: () => 0 });
    } else {
      blob(b, p[0] + Math.cos(ang) * rr, p[1], p[2] + Math.sin(ang) * rr,
        rr * 0.16, 2, 4, () => [0.5, 1.6, 0.5], 0);
    }
  }
}

function buildStuds(b, path, R, d, t0, t1, r) {
  const metal = metalOf(d);
  for (let i = 0; i < d.deco.studs; i++) {
    const t = lerp(t0, t1, d.deco.studs === 1 ? 0.5 : i / (d.deco.studs - 1));
    const p = frameAt(path, clamp(t, 0.03, 0.97));
    const rr = R(clamp(t, 0.03, 0.97));
    const a = i * 2.39;
    b.color(metal, 0.05, r);
    blob(b, p[0] + Math.cos(a) * rr * 1.05, p[1], p[2] + Math.sin(a) * rr * 1.05,
      rr * 0.22, 2, 5, () => [1, 0.6, 1], 0);
  }
}

/** A few small things tied on: moss, a fungus, a feather, a bead. */
function buildCharms(b, glow, path, R, L, d, r) {
  const t = 0.56;
  const p = frameAt(path, t);
  const rr = R(t);
  const M = d.carry.special ? MATERIALS[d.carry.special] : null;
  for (let i = 0; i < d.deco.charms; i++) {
    const a = (i / d.deco.charms) * TAU + r.range(-0.3, 0.3);
    const drop = r.range(0.06, 0.16);
    const ex = p[0] + Math.cos(a) * rr * 1.3, ez = p[2] + Math.sin(a) * rr * 1.3;
    b.color(BUILD.rope, 0.06, r);
    tube(b, {
      pts: [[p[0], p[1], p[2]], [ex, p[1] - drop, ez]],
      radius: () => rr * 0.07, radial: 3, capStart: false, capEnd: false, sway: () => 0.2,
    });
    const what = r.int(0, M ? 3 : 2);
    if (what === 0) {
      b.color(mixHex(MOSS.deep, MOSS.bright, r()), 0.1, r);
      blob(b, ex, p[1] - drop - rr * 0.4, ez, rr * 0.55, 3, 6, null, 0.3);
    } else if (what === 1) {
      b.color(MUSHROOM.chanterelle, 0.08, r);
      lathe(b, [[0.001, p[1] - drop - rr * 0.2], [rr * 0.6, p[1] - drop - rr * 0.6],
      [rr * 0.5, p[1] - drop - rr * 0.7]], 6, ex, ez);
    } else if (what === 2) {
      const sub = new MeshBuilder();
      sub.color(0xd8cfb4, 0.08, r);
      leafBlade(sub, { len: rr * 3.2, wid: rr * 0.8, segs: 2, curl: 0.35, cup: 0.3, swayBase: 0.2, swayTip: 0.8 });
      b.append(sub, orientMatrix([ex, p[1] - drop, ez], [Math.cos(a) * 0.3, -1, Math.sin(a) * 0.3], r.range(0, TAU)));
    } else {
      const lit = M.glow > 0.45 && glow ? glow : b;
      lit.color(M.hex, 0.07, r);
      blob(lit, ex, p[1] - drop - rr * 0.4, ez, rr * 0.5, 2, 5, null, 0.2);
    }
  }
}

/* ========================================================================= */

/**
 * A ready-to-use THREE.Mesh pair, oriented to sit in a hand: grip at the
 * origin, head along +Y.
 */
export function weaponMeshes(w, mats, opts = {}) {
  const out = buildWeapon(w, opts);
  const geo = out.builder.build({ flat: false });
  geo.translate(0, -out.gripY, 0);
  const meshes = [new THREE.Mesh(geo, mats.item)];
  if (!out.glow.isEmpty) {
    const g = out.glow.build({ flat: false });
    g.translate(0, -out.gripY, 0);
    meshes.push(new THREE.Mesh(g, mats.glow));
  }
  for (const m of meshes) { m.castShadow = true; m.receiveShadow = true; }
  return { meshes, info: out };
}
