/* WeaponArt.js — the Stickwright's work.
   ===========================================================================
   A weapon is built FROM THE STICK THE PLAYER BROUGHT IN. The same generator
   that made the branch on the forest floor makes the shaft of the stave, with
   the same seed, the same knots and the same moss — only straightened, peeled
   and trimmed as far as the recipe says.

   That is the whole point of the crafting system: you walk back into the
   village with a particular crooked, twice-forked, foxfire-veined limb, and
   what you walk out with is recognisably THAT limb with a blade on it. No
   recipe produces the same object twice, because no two sticks are the same.

   The crafted parts — grips, ferrules, heads, blades, bindings, inlay — are
   added on top, sized off the shaft they are attached to.
*/

import * as THREE from '../../lib/three.module.js';
import { MeshBuilder, tube, blob, lathe, blade as leafBlade, box, quad, beam, cylinder } from './Geo.js';
import { buildStick, orientMatrix } from './StickGen.js';
import { SPECIES } from '../data/StickData.js';
import { WEAPON_CLASSES } from '../data/WeaponData.js';
import { BARK, METAL, MOSS, MUSHROOM, BUILD, mixHex, tweak, shade } from './Palette.js';
import { makeRng, clamp, lerp, TAU, smoothstep } from '../core/Util.js';

/* ========================================================================= */
/* SHAFT PREPARATION                                                         */
/* ========================================================================= */

/**
 * Take the stick the player found and turn it into a worked shaft: straighter,
 * barer, trimmed. Everything the recipe does NOT strip away survives, which
 * is what keeps the weapon recognisable as that stick.
 */
function workedSpec(spec, build, opts = {}) {
  const s = JSON.parse(JSON.stringify(spec));
  const straight = build.straighten ?? 0.6;
  const strip = build.strip ?? 0.5;

  s.curve *= (1 - straight);
  s.wobble *= (1 - straight * 0.85);
  s.kinks = straight > 0.75 ? 0 : s.kinks;

  // peeling: pale goes up, moss and lichen come off unless the recipe keeps
  // them, and rain-dark wood dries out on the bench
  s.pale = clamp(s.pale + strip * 0.9, 0, 1);
  s.wet *= (1 - strip * 0.9);
  if (!build.keepMoss) s.moss *= (1 - strip);
  else s.moss = Math.min(1, s.moss * 1.15);
  s.lichen *= (1 - strip);
  if (!build.keepFungi) s.fungi = strip > 0.5 ? [] : s.fungi;
  if (!build.keepChar) s.charred *= (1 - strip * 0.5);

  // trimmed: twigs and small forks come off, big forks stay if they are the
  // point of the weapon
  s.twigs = build.bristles ? s.twigs : [];
  if (!build.head || build.head !== 'tines') {
    s.forks = s.forks.filter(f => f.len / Math.max(0.2, s.length) > 0.55 && build.keepForks);
  }
  s.leaves = 0;
  s.brokenEnd = 'clean';
  s.brokenButt = 'clean';

  if (build.dark) s.lum *= 0.72;
  if (build.polish) s.lum *= 1.06;

  if (opts.length) {
    const f = opts.length / s.length;
    s.length = opts.length;
    s.thick *= clamp(Math.pow(f, 0.25), 0.7, 1.3);
  }
  if (opts.thickMul) s.thick *= opts.thickMul;
  return s;
}

/* ========================================================================= */
/* MAIN                                                                      */
/* ========================================================================= */

/**
 * Build a finished weapon, standing along +Y with the BUTT at the origin, so
 * the grip is at the bottom and the head at the top.
 *
 * @param {object} recipe  from WeaponData
 * @param {Array}  sticks  the specs that went into it, in slot order
 * @param {object} opts    {lod, glow}
 * @returns {{builder, glow, length, gripY, headY}}
 */
export function buildWeapon(recipe, sticks, opts = {}) {
  const b = new MeshBuilder();
  const glow = opts.glow || new MeshBuilder();
  const B = recipe.build || {};
  const r = makeRng((sticks[0]?.seed ?? 1) ^ 0x3ea0 ^ recipe.id.length * 7919);
  const lod = opts.lod ?? 0;

  const main = sticks[0];
  const sp = SPECIES[main.species] || SPECIES.oak;

  /* --- which stick is the shaft? ---------------------------------------- */
  // For the sledge the burl is slot 0 and the haft is slot 1, so the shaft
  // is not always the first stick. `build.haft` names the slot to use.
  const haftIdx = B.haft ?? 0;
  const haft = sticks[Math.min(haftIdx, sticks.length - 1)] || main;

  const targetLen = weaponLength(recipe, haft);
  const shaftSpec = workedSpec(haft, B, { length: targetLen, thickMul: B.blade ? 1.0 : 1 });

  /* --- the shaft -------------------------------------------------------- */
  const info = buildStick(shaftSpec, b, {
    lod,
    glow: B.glow ? glow : null,
    noRare: !!(B.blade || B.head === 'burl'),
  });
  const R = info.radius;
  const path = info.path;
  const L = shaftSpec.length;

  const shaftHex = () => barkOf(shaftSpec, sp, B);

  /* --- the grip --------------------------------------------------------- */
  const C = WEAPON_CLASSES[recipe.cls] || WEAPON_CLASSES.stave;
  const gripLen = C.hands === 2 ? L * 0.30 : L * 0.20;
  const gripY0 = B.blade ? 0.02 : L * 0.06;
  const gripY1 = gripY0 + gripLen;
  if (B.grip && B.grip !== 'none') {
    buildGrip(b, path, R, gripY0 / L, gripY1 / L, B.grip, r, glow, B.glow);
  }

  /* --- the butt --------------------------------------------------------- */
  if (B.pommel) buildPommel(b, path, R, B.pommel, r, sp);
  if (B.ferrule) buildFerrule(b, path, R, r);

  /* --- the business end -------------------------------------------------- */
  if (B.blade) buildBlade(b, glow, shaftSpec, sp, path, R, B, r, recipe, lod);
  if (B.head === 'point') buildSpearPoint(b, shaftSpec, sp, path, R, B, r);
  if (B.head === 'tines') buildTines(b, shaftSpec, sp, path, R, r, haft);
  if (B.head === 'burl') buildBurlHead(b, sticks, B, path, R, L, r, lod, glow);
  if (B.bristles) buildBroomHead(b, glow, sticks, B, path, R, L, r, lod);

  /* --- bindings and bands ------------------------------------------------ */
  if (B.bands) {
    for (let i = 0; i < B.bands; i++) {
      const t = lerp(0.62, 0.92, B.bands === 1 ? 0.5 : i / (B.bands - 1));
      buildBand(b, path, R, t, r);
    }
  }

  /* --- charms: a little bundle tied below the head ---------------------- */
  if (B.charms) buildCharms(b, glow, path, R, L, r);

  /* --- inlay ------------------------------------------------------------- */
  if (B.inlay) buildInlay(b, path, R, B.inlay, r);

  return {
    builder: b, glow,
    length: L,
    gripY: (gripY0 + gripY1) * 0.5,
    headY: L,
    radius: R(0.5),
    path,
  };
}

/** How long a finished weapon of this class should be. */
function weaponLength(recipe, stick) {
  const want = {
    wand: 0.55, walkingStick: 1.30, club: 0.85, sword: 1.05, axe: 0.95,
    hammer: 0.90, spear: 2.20, stave: 1.85, broom: 1.55, greatsword: 1.70,
    maul: 1.15, sledge: 1.75,
  }[recipe.cls] || 1.4;
  // it can only be as long as the wood, and a shorter stick makes a shorter
  // weapon rather than a stretched one
  return clamp(Math.min(want, stick.length * 0.96), 0.35, stick.length);
}

function barkOf(spec, sp, B) {
  let c = sp.bark;
  if (B.dark) c = shade(c, -0.3);
  return c;
}

/* ========================================================================= */
/* PARTS                                                                     */
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

/** Cord, leather or a braid wound round the shaft. */
function buildGrip(b, path, R, t0, t1, kind, r, glow, glowing) {
  const turns = kind === 'cord' ? 16 : kind === 'braid' ? 11 : 1;
  const hex = kind === 'leather' ? 0x5a3f2a : kind === 'braid' ? 0x8a6a45 : BUILD.rope;

  if (kind === 'leather') {
    // a wrapped sleeve with a visible spiral seam
    const steps = 14;
    const pts = [];
    for (let i = 0; i <= steps; i++) pts.push(frameAt(path, lerp(t0, t1, i / steps)));
    b.color(hex, 0.05, r);
    tube(b, {
      pts, radius: u => R(lerp(t0, t1, u)) * 1.22, radial: 8,
      color: (u, i, ang) => {
        const seam = Math.abs(((ang * 1.6 + u * 14) % TAU) - Math.PI) < 0.28;
        return seam ? shade(hex, -0.35) : shade(hex, Math.sin(ang * 3) * 0.05);
      },
      capStart: false, capEnd: false, sway: () => 0,
    });
    return;
  }

  /* cord and braid are a real helix, which catches the light in bands */
  const steps = turns * 7;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const t = lerp(t0, t1, u);
    const p = frameAt(path, t);
    const a = u * turns * TAU;
    const rr = R(t) * 1.06;
    pts.push([p[0] + Math.cos(a) * rr, p[1], p[2] + Math.sin(a) * rr]);
  }
  const target = (glowing && kind === 'braid') ? glow : b;
  target.color(glowing && kind === 'braid' ? MUSHROOM.glowCap : hex, 0.07, r);
  tube(target, {
    pts, radius: u => R(lerp(t0, t1, u)) * (kind === 'braid' ? 0.19 : 0.13),
    radial: 4, capStart: true, capEnd: true, sway: () => 0,
  });
  if (kind === 'braid') {
    // a second strand going the other way
    const pts2 = [];
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const t = lerp(t0, t1, u);
      const p = frameAt(path, t);
      const a = -u * turns * TAU + 1.7;
      const rr = R(t) * 1.06;
      pts2.push([p[0] + Math.cos(a) * rr, p[1], p[2] + Math.sin(a) * rr]);
    }
    b.color(shade(hex, -0.2), 0.06, r);
    tube(b, { pts: pts2, radius: u => R(lerp(t0, t1, u)) * 0.15, radial: 4, capStart: true, capEnd: true, sway: () => 0 });
  }
}

function buildPommel(b, path, R, kind, r, sp) {
  const p = frameAt(path, 0);
  const rr = R(0);
  if (kind === 'knob') {
    b.color(mixHex(sp.bark, sp.inner, 0.4), 0.06, r);
    blob(b, p[0], p[1] - rr * 0.3, p[2], rr * 1.65, 4, 8, (x, y, z) => [1, 0.85, 1]);
  } else if (kind === 'cap') {
    b.color(METAL.bronze, 0.05, r);
    lathe(b, [[rr * 1.15, p[1] + rr * 0.6], [rr * 1.22, p[1] - rr * 0.2], [rr * 0.7, p[1] - rr * 0.75], [0.001, p[1] - rr * 0.85]],
      9, p[0], p[2]);
  } else if (kind === 'disc') {
    b.color(METAL.iron, 0.05, r);
    lathe(b, [[0.001, p[1] - rr * 0.9], [rr * 2.0, p[1] - rr * 0.45], [rr * 2.1, p[1] + rr * 0.1], [rr * 0.9, p[1] + rr * 0.5]],
      10, p[0], p[2]);
  } else if (kind === 'heavy') {
    b.color(METAL.ironDark, 0.05, r);
    lathe(b, [[0.001, p[1] - rr * 1.5], [rr * 1.7, p[1] - rr * 1.0], [rr * 2.3, p[1] - rr * 0.1],
    [rr * 1.9, p[1] + rr * 0.8], [rr * 0.9, p[1] + rr * 1.1]], 11, p[0], p[2]);
    b.color(METAL.bronze, 0.05, r);
    lathe(b, [[rr * 2.32, p[1] - rr * 0.25], [rr * 2.36, p[1] + rr * 0.15]], 11, p[0], p[2]);
  }
}

function buildFerrule(b, path, R, r) {
  const p = frameAt(path, 0.03);
  const rr = R(0.03);
  b.color(METAL.iron, 0.05, r);
  lathe(b, [[rr * 1.16, p[1] - rr * 0.6], [rr * 1.20, p[1] + rr * 1.8], [rr * 1.05, p[1] + rr * 2.0]], 9, p[0], p[2]);
}

function buildBand(b, path, R, t, r) {
  const p = frameAt(path, t);
  const rr = R(t);
  b.color(r.chance(0.5) ? METAL.iron : METAL.bronze, 0.06, r);
  lathe(b, [[rr * 1.14, p[1] - rr * 0.45], [rr * 1.18, p[1] + rr * 0.45]], 9, p[0], p[2]);
}

function buildInlay(b, path, R, kind, r) {
  const hex = kind === 'gold' ? METAL.gold : kind === 'copper' ? BUILD.copper : METAL.bronze;
  const steps = 40;
  const pts = [];
  const turns = 3.2;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const t = lerp(0.35, 0.92, u);
    const p = frameAt(path, t);
    const a = u * turns * TAU;
    const rr = R(t) * 1.01;
    pts.push([p[0] + Math.cos(a) * rr, p[1], p[2] + Math.sin(a) * rr]);
  }
  b.color(hex, 0.05, r);
  tube(b, { pts, radius: u => R(lerp(0.35, 0.92, u)) * 0.07, radial: 3, capStart: false, capEnd: false, sway: () => 0 });
}

/* ------------------------------------------------------------------ blades */

/**
 * A carved wooden blade. It is SPLIT OUT OF THE SHAFT, not bolted on: the
 * blade section is a flattened continuation of the same wood, tapering to an
 * edge, with the pale split face showing along the flats and the old bark
 * surviving along the spine.
 */
function buildBlade(b, glow, spec, sp, path, R, B, r, recipe, lod) {
  const kind = B.blade;
  const t0 = kind === 'great' ? 0.36 : kind === 'cleave' ? 0.55 : 0.42;
  const steps = lod === 0 ? 16 : 9;
  const inner = tweak(sp.inner, { l: B.dark ? 0.72 : 1.0 });
  const edgeHex = shade(inner, 0.12);

  const widthAt = u => {
    if (kind === 'cleave') {
      // an axe-ish wedge: narrow at the neck, flaring to a broad bit
      return lerp(1.0, 3.4, Math.pow(u, 0.6)) * (1 - Math.pow(u, 6) * 0.5);
    }
    if (kind === 'ring') return lerp(1.5, 2.2, Math.sin(u * Math.PI)) * (1 - Math.pow(u, 5) * 0.8);
    // sword/greatsword: parallel for most of the length, then a long point
    return lerp(1.9, 2.3, Math.sin(u * 2.0)) * (1 - Math.pow(clamp((u - 0.78) / 0.22, 0, 1), 1.4));
  };
  const thickAt = u => lerp(0.42, 0.22, u);

  const ring = kind === 'ring' && B.keepHole;
  const holeU0 = 0.30, holeU1 = 0.62;

  const rows = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const t = lerp(t0, 1, u);
    const p = frameAt(path, t);
    const rr = R(t);
    const w = rr * widthAt(u);
    const th = rr * thickAt(u);
    rows.push({ p, w, th, u });
  }

  const quadStrip = (aw, bw, i, sideSkip = false) => { };

  /* the blade body: a flattened diamond section */
  for (let i = 0; i < steps; i++) {
    const A = rows[i], Bw = rows[i + 1];
    const inHole = ring && A.u > holeU0 && A.u < holeU1;
    const lanes = inHole ? [[-1, -0.45], [0.45, 1]] : [[-1, 1]];
    for (const [l0, l1] of lanes) {
      const pa0 = [A.p[0] + A.w * l0, A.p[1], A.p[2]];
      const pa1 = [A.p[0] + A.w * l1, A.p[1], A.p[2]];
      const pb0 = [Bw.p[0] + Bw.w * l0, Bw.p[1], Bw.p[2]];
      const pb1 = [Bw.p[0] + Bw.w * l1, Bw.p[1], Bw.p[2]];
      // front and back faces, meeting at a ridge down the middle
      for (const s of [1, -1]) {
        const ra = [A.p[0] + A.w * (l0 + l1) * 0.5, A.p[1], A.p[2] + s * A.th];
        const rb = [Bw.p[0] + Bw.w * (l0 + l1) * 0.5, Bw.p[1], Bw.p[2] + s * Bw.th];
        b.color(mixHex(inner, edgeHex, 0.35), 0.05, r);
        if (s > 0) { quad(b, pa0, pb0, rb, ra); quad(b, ra, rb, pb1, pa1); }
        else { quad(b, pb0, pa0, ra, rb); quad(b, rb, ra, pa1, pb1); }
      }
      // the sharpened edges, paler where the plane took the most off
      b.color(edgeHex, 0.04, r);
      for (const [px, qx] of [[l0, l0], [l1, l1]]) {
        const ea = [A.p[0] + A.w * px, A.p[1], A.p[2]];
        const eb = [Bw.p[0] + Bw.w * qx, Bw.p[1], Bw.p[2]];
        blob(b, ea[0], ea[1], ea[2], A.th * 0.25, 2, 4);
      }
    }
  }

  /* the tip */
  {
    const A = rows[steps];
    b.color(edgeHex, 0.05, r);
    blob(b, A.p[0], A.p[1], A.p[2], Math.max(A.th, A.w) * 0.5, 3, 6, (x, y, z) => [1.4, 1.1, 0.5]);
  }

  /* the spine: a strip of the original bark left along the back edge, which
     is what makes it read as carved from a branch rather than milled */
  if (B.strip < 1 || spec.rare) {
    b.color(sp.bark, 0.06, r);
    for (let i = 0; i < steps; i += 2) {
      const A = rows[i];
      blob(b, A.p[0] + A.w * 0.96, A.p[1], A.p[2], A.th * 0.5, 2, 5, (x, y, z) => [0.5, 2.2, 1]);
    }
  }

  /* the guard */
  const g0 = frameAt(path, t0);
  const gr = R(t0);
  if (B.guard === 'crossbar' || B.guard === 'longbar') {
    const half = gr * (B.guard === 'longbar' ? 6.5 : 4.2);
    b.color(METAL.iron, 0.05, r);
    tube(b, {
      pts: [[g0[0] - half, g0[1], g0[2]], [g0[0], g0[1] + gr * 0.25, g0[2]], [g0[0] + half, g0[1], g0[2]]],
      radius: u => gr * (0.32 + Math.sin(u * Math.PI) * 0.25), radial: 6,
      squash: () => [1, 0.7], capStart: true, capEnd: true, sway: () => 0,
    });
    b.color(METAL.bronze, 0.05, r);
    lathe(b, [[gr * 1.3, g0[1] - gr * 0.3], [gr * 1.45, g0[1] + gr * 0.35], [gr * 1.1, g0[1] + gr * 0.5]], 9, g0[0], g0[2]);
  }
}

function buildSpearPoint(b, spec, sp, path, R, B, r) {
  const t0 = 0.86;
  const p0 = frameAt(path, t0);
  const tip = frameAt(path, 1);
  const rr = R(t0);
  const inner = tweak(sp.inner, { l: 1.02 });
  const charred = B.fireHarden ? mixHex(inner, BARK.charred, 0.35) : inner;

  // a long four-sided point, darkened where it was turned in the fire
  const facets = 6;
  const rows = [];
  for (let i = 0; i <= 5; i++) {
    const u = i / 5;
    const p = frameAt(path, lerp(t0, 1, u));
    rows.push({ p, r: rr * (1 - Math.pow(u, 1.25)) * 1.04 });
  }
  for (let i = 0; i < 5; i++) {
    const A = rows[i], C = rows[i + 1];
    for (let f = 0; f < facets; f++) {
      const a0 = (f / facets) * TAU, a1 = ((f + 1) / facets) * TAU;
      b.color(mixHex(inner, charred, Math.pow(i / 5, 1.5)), 0.05, r);
      quad(b,
        [A.p[0] + Math.cos(a0) * A.r, A.p[1], A.p[2] + Math.sin(a0) * A.r],
        [A.p[0] + Math.cos(a1) * A.r, A.p[1], A.p[2] + Math.sin(a1) * A.r],
        [C.p[0] + Math.cos(a1) * C.r, C.p[1], C.p[2] + Math.sin(a1) * C.r],
        [C.p[0] + Math.cos(a0) * C.r, C.p[1], C.p[2] + Math.sin(a0) * C.r]);
    }
  }
  // the binding below the point that stops it splitting
  b.color(BUILD.rope, 0.06, r);
  const steps = 30;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const t = lerp(t0 - 0.06, t0 + 0.02, u);
    const p = frameAt(path, t);
    const a = u * 5 * TAU;
    pts.push([p[0] + Math.cos(a) * R(t) * 1.07, p[1], p[2] + Math.sin(a) * R(t) * 1.07]);
  }
  tube(b, { pts, radius: () => rr * 0.13, radial: 3, capStart: true, capEnd: true, sway: () => 0 });
}

function buildTines(b, spec, sp, path, R, r, srcStick) {
  const t0 = 0.72;
  const n = Math.max(3, Math.min(5, (srcStick.forks?.length || 3) + 1));
  const p0 = frameAt(path, t0);
  const rr = R(t0);
  const inner = tweak(sp.inner, { l: 1.0 });
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + 0.3;
    const spread = rr * lerp(2.4, 5.2, i % 2);
    const len = spec.length * r.range(0.14, 0.24);
    const tipX = p0[0] + Math.cos(a) * spread;
    const tipZ = p0[2] + Math.sin(a) * spread;
    b.color(sp.bark, 0.07, r);
    tube(b, {
      pts: [p0,
      [p0[0] + Math.cos(a) * spread * 0.4, p0[1] + len * 0.55, p0[2] + Math.sin(a) * spread * 0.4],
      [tipX * 0.75 + p0[0] * 0.25, p0[1] + len, tipZ * 0.75 + p0[2] * 0.25]],
      radius: u => rr * (0.52 - u * 0.42),
      radial: 5,
      color: (u) => mixHex(sp.bark, inner, Math.pow(u, 1.6)),
      capStart: false, capEnd: true, sway: () => 0,
    });
  }
  b.color(BUILD.rope, 0.06, r);
  lathe(b, [[rr * 1.12, p0[1] - rr * 0.6], [rr * 1.2, p0[1] + rr * 0.4]], 8, p0[0], p0[2]);
}

/** The maulhead burl, kept exactly as it grew and socketed onto the haft. */
function buildBurlHead(b, sticks, B, path, R, L, r, lod, glow) {
  // the burl comes from whichever stick actually had one
  const src = sticks.find(s => s.rare === 'maulhead') || sticks[0];
  const burlSpec = JSON.parse(JSON.stringify(src));
  burlSpec.length = Math.min(0.42, src.length * 0.3);
  burlSpec.forks = []; burlSpec.twigs = []; burlSpec.fungi = [];
  burlSpec.curve = 0; burlSpec.wobble = 0; burlSpec.kinks = 0;
  burlSpec.pale = clamp(burlSpec.pale + 0.3, 0, 1);
  burlSpec.brokenEnd = 'clean'; burlSpec.brokenButt = 'clean';
  if (burlSpec.extra?.burl) burlSpec.extra.burl.at = 1;

  const sub = new MeshBuilder();
  buildStick(burlSpec, sub, { lod });

  // stand it on the top of the haft, tipped over so the burl reads as a head
  const top = frameAt(path, 0.97);
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(top[0], top[1] - burlSpec.length * 0.55, top[2]),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r.range(0, TAU), 0)),
    new THREE.Vector3(1, 1, 1));
  b.append(sub, m);

  // the wedge driven into the head to lock it on
  if (B.wedge) {
    const rr = R(0.97);
    b.color(mixHex(BARK.oak, BARK.deadWood, 0.4), 0.06, r);
    box(b, top[0], top[1] + rr * 0.4, top[2], rr * 0.5, rr * 1.6, rr * 1.8);
  }
}

/** The broom head: a bound bundle of whips flaring from the shaft's end. */
function buildBroomHead(b, glow, sticks, B, path, R, L, r, lod) {
  const src = sticks.find(s => s.rare === 'besom') || sticks[0];
  const bs = src.extra?.bristle || { n: 60, len: 0.32, spread: 0.45 };
  const n = Math.round(bs.n * (lod === 0 ? 1.4 : 0.6));
  const t0 = 0.60;
  const base = frameAt(path, t0);
  const rr = R(t0);
  const sp = SPECIES[src.species] || SPECIES.birch;

  for (let i = 0; i < n; i++) {
    const a = r.range(0, TAU);
    const spread = bs.spread * r.range(0.3, 1.25);
    const len = L * r.range(0.26, 0.44);
    const start = frameAt(path, lerp(t0, 0.98, r.range(0, 1)));
    const segs = 3;
    const pts = [];
    for (let k = 0; k <= segs; k++) {
      const u = k / segs;
      // bound tight at the top and splaying out toward the tips — the shape
      // of the flare IS the broom
      const flare = Math.pow(u, 1.5) * spread * rr * 7;
      pts.push([
        start[0] + Math.cos(a) * flare,
        start[1] - len * u,
        start[2] + Math.sin(a) * flare,
      ]);
    }
    b.color(mixHex(tweak(sp.bark, { l: r.range(0.85, 1.25) }), BARK.deadWood, r.range(0, 0.45)), 0.08, r);
    tube(b, {
      pts, radius: u => rr * 0.09 * (1 - u * 0.75), radial: 3,
      capStart: false, capEnd: false, sway: u => u * 0.45,
    });
  }

  /* the three turns of cord that bind the head, which the Stickwright will
     tell you is the part that matters */
  const bindTarget = B.bind === 'braid' && B.glow ? glow : b;
  bindTarget.color(B.bind === 'braid' ? MUSHROOM.glowCap : BUILD.rope, 0.06, r);
  for (let k = 0; k < 3; k++) {
    const t = t0 + 0.035 + k * 0.045;
    const p = frameAt(path, t);
    const steps = 22;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const ang = u * TAU * 1.06;
      pts.push([p[0] + Math.cos(ang) * R(t) * 1.4, p[1] - u * 0.012, p[2] + Math.sin(ang) * R(t) * 1.4]);
    }
    tube(bindTarget, { pts, radius: () => R(t) * 0.16, radial: 4, capStart: true, capEnd: true, sway: () => 0 });
  }
}

/** A few small things tied on below the head: moss, a fungus, a feather. */
function buildCharms(b, glow, path, R, L, r) {
  const t = 0.56;
  const p = frameAt(path, t);
  const rr = R(t);
  b.color(BUILD.rope, 0.06, r);
  const n = r.int(2, 4);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + r.range(-0.3, 0.3);
    const drop = r.range(0.06, 0.16);
    const ex = p[0] + Math.cos(a) * rr * 1.3, ez = p[2] + Math.sin(a) * rr * 1.3;
    b.color(BUILD.rope, 0.06, r);
    tube(b, {
      pts: [[p[0], p[1], p[2]], [ex, p[1] - drop, ez]],
      radius: () => rr * 0.07, radial: 3, capStart: false, capEnd: false, sway: () => 0.2,
    });
    const what = r.int(0, 2);
    if (what === 0) {
      b.color(mixHex(MOSS.deep, MOSS.bright, r()), 0.1, r);
      blob(b, ex, p[1] - drop - rr * 0.4, ez, rr * 0.55, 3, 6, null, 0.3);
    } else if (what === 1) {
      b.color(MUSHROOM.chanterelle, 0.08, r);
      lathe(b, [[0.001, p[1] - drop - rr * 0.2], [rr * 0.6, p[1] - drop - rr * 0.6], [rr * 0.5, p[1] - drop - rr * 0.7]], 6, ex, ez);
    } else {
      const sub = new MeshBuilder();
      sub.color(0xd8cfb4, 0.08, r);
      leafBlade(sub, { len: rr * 3.2, wid: rr * 0.8, segs: 2, curl: 0.35, cup: 0.3, swayBase: 0.2, swayTip: 0.8 });
      b.append(sub, orientMatrix([ex, p[1] - drop, ez], [Math.cos(a) * 0.3, -1, Math.sin(a) * 0.3], r.range(0, TAU)));
    }
  }
}

/* ========================================================================= */

/**
 * A ready-to-use THREE.Mesh pair for a weapon, oriented so it sits in a hand:
 * the grip at the origin and the head pointing along +Y.
 */
export function weaponMeshes(recipe, sticks, mats, opts = {}) {
  const out = buildWeapon(recipe, sticks, opts);
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
