/* FishArt.js — building a fish out of its genome.
   ===========================================================================
   THE RULE: no fish in this game is another fish with the hue turned. Every
   species in FishData carries a body genome, and this file is the machine
   that turns that genome into a mesh — body solid, head, jaw, tail, dorsal,
   pectorals, eyes, and whatever extras the species has (barbels, teeth,
   plates, spines, a lantern on a stalk). Two species that happen to share a
   body solid will still differ in depth, width, head, tail, fins, pattern
   and palette, which is four or five silhouette changes deep.

   HOW A BODY IS BUILT. A fish is a loft: a stack of elliptical rings running
   from the tail root to the nose, each with its own depth and width taken
   from a profile curve chosen by the body type. That single mechanism gives
   an eel, a sunfish and a ray from three profile functions, and it means the
   fins can always be attached by asking the body how deep it is at a given
   point rather than by guessing.

   ORIENTATION, fixed everywhere: **+X is the nose, +Y is up, Z is across.**
   The origin is the middle of the body. Everything that displays a fish —
   the catch card, the inventory, the hotbar, the fisherman's crate — relies
   on that, so do not rotate the mesh here to suit one of them.

   WINDING. Every ring quad is emitted nose-ward-first so the outside faces
   out. An inverted fish is not a shaded-wrong fish, it is an INVISIBLE fish;
   test_faces.mjs renders one of every species with back faces in magenta.
*/

import * as THREE from '../../lib/three.module.js?v=1790014463';
import { MeshBuilder, blob, tube, quad } from './Geo.js?v=1790014463';
import { FISH, MUTATION_BY_ID } from '../data/FishData.js?v=1790014463';
import { mixHex, shade } from './Palette.js?v=1790014463';
import { makeRng, clamp, clamp01, lerp, smoothstep, TAU } from '../core/Util.js?v=1790014463';

/* ========================================================================= */
/* BODY PROFILES                                                             */
/* ========================================================================= */

/**
 * `t` runs 0 at the tail root to 1 at the nose. Each profile returns the
 * body depth at `t` as a fraction of the maximum, so the loft only has to
 * know one number per station.
 *
 * These curves ARE the species silhouettes. A torpedo whose widest point
 * moves from 0.62 to 0.38 stops being a trout and becomes a bream, which is
 * why they are written out rather than parameterised into one formula.
 */
const PROFILE = {
  torpedo: t => Math.pow(Math.sin(Math.pow(t, 0.78) * Math.PI), 0.62) * (0.55 + 0.45 * smoothstep(t * 1.4)),
  deep: t => Math.pow(Math.sin(Math.pow(t, 0.62) * Math.PI), 0.42),
  flat: t => Math.pow(Math.sin(Math.pow(t, 0.55) * Math.PI), 0.36),
  globe: t => Math.pow(Math.sin(Math.pow(t, 0.5) * Math.PI), 0.30),
  eel: t => Math.pow(Math.sin(Math.pow(t, 0.35) * Math.PI), 0.16) * lerp(0.62, 1, smoothstep(t * 2.2)),
  ribbon: t => Math.pow(Math.sin(Math.pow(t, 0.30) * Math.PI), 0.13),
  needle: t => Math.pow(Math.sin(Math.pow(t, 0.92) * Math.PI), 0.80),
  ray: t => Math.pow(Math.sin(Math.pow(t, 0.48) * Math.PI), 0.34),
};

/** Width relative to depth, also along the body — a fish is not an extrusion. */
const WIDTH = {
  torpedo: t => 0.55 + 0.45 * Math.sin(Math.pow(t, 0.8) * Math.PI),
  deep: t => 0.5 + 0.5 * Math.sin(Math.pow(t, 0.7) * Math.PI),
  flat: t => 0.35 + 0.65 * Math.sin(t * Math.PI),
  globe: t => 0.45 + 0.55 * Math.sin(Math.pow(t, 0.55) * Math.PI),
  eel: t => 0.75 + 0.25 * Math.sin(t * Math.PI),
  ribbon: t => 0.8 + 0.2 * Math.sin(t * Math.PI),
  needle: t => 0.6 + 0.4 * Math.sin(Math.pow(t, 0.85) * Math.PI),
  ray: t => 0.30 + 0.70 * Math.sin(t * Math.PI),
};

/** Where the spine sits vertically — a belly-heavy fish is not symmetric. */
const BELLY = {
  torpedo: 0.44, deep: 0.40, flat: 0.48, globe: 0.44,
  eel: 0.50, ribbon: 0.50, needle: 0.46, ray: 0.62,
};

/* ========================================================================= */
/* PATTERNS                                                                  */
/* ========================================================================= */

/**
 * The colour of one point on the skin.
 *
 * @param u  0 tail .. 1 nose
 * @param v  -1 belly .. +1 back
 */
function skinColour(P, u, v, r) {
  const back = P.back, belly = P.belly, accent = P.accent;
  /* every fish is counter-shaded: dark on top, pale underneath. That is the
     single thing that makes a lump of geometry read as a fish at all. */
  const k = clamp01(v * 0.5 + 0.5);
  let c = mixHex(belly, back, Math.pow(k, 0.72));

  switch (P.pattern) {
    case 'stripe': {
      const s = Math.sin(u * 34 + v * 1.2);
      if (s > 0.35) c = mixHex(c, accent, 0.62);
      break;
    }
    case 'band': {
      const s = Math.sin(u * 13.5);
      if (s > 0.55) c = mixHex(c, accent, 0.5);
      break;
    }
    case 'spot': {
      const s = Math.sin(u * 47 + v * 9) * Math.sin(u * 23 - v * 15);
      if (s > 0.62) c = mixHex(c, accent, 0.75);
      break;
    }
    case 'mottle': {
      const s = Math.sin(u * 19 + v * 5) + Math.sin(u * 31 - v * 8) * 0.6;
      c = mixHex(c, accent, clamp01(s * 0.3 + 0.28));
      break;
    }
    case 'net': {
      const s = Math.max(Math.abs(Math.sin(u * 40)), Math.abs(Math.sin(v * 9)));
      if (s > 0.93) c = mixHex(c, accent, 0.7);
      break;
    }
    case 'marble': {
      const s = Math.sin(u * 11 + Math.sin(v * 4) * 2.2);
      if (s > 0.15) c = mixHex(c, accent, 0.85);
      break;
    }
    case 'gradient':
      c = mixHex(c, accent, Math.pow(clamp01(u), 1.7) * 0.6);
      break;
  }
  return c;
}

/* ========================================================================= */
/* THE BUILDER                                                               */
/* ========================================================================= */

/**
 * Build a fish.
 *
 * @param f     a catch record ({id, mutation, len, size, seed}) or a species id
 * @param opts  {lod, glow, length}  length overrides the record's own
 * @returns {{builder, glow, length, height, width}}
 */
export function buildFish(f, opts = {}) {
  const spec = typeof f === 'string' ? FISH[f] : FISH[f.id];
  if (!spec) return { builder: new MeshBuilder(), glow: new MeshBuilder(), length: 0.2, height: 0.08, width: 0.04 };

  const rec = typeof f === 'string' ? { seed: 1, size: 0.5, mutation: null } : f;
  const b = opts.builder || new MeshBuilder();
  const g = opts.glow || new MeshBuilder();
  const lod = clamp(opts.lod ?? 0, 0, 2);
  const r = makeRng((rec.seed ?? 1) ^ 0xf1583);
  const mut = rec.mutation ? MUTATION_BY_ID[rec.mutation] : null;

  const L = opts.length || rec.len || lerp(spec.len[0], spec.len[1], rec.size ?? 0.5);
  const D = L * spec.depthR;                       // body depth
  const W = D * spec.wideR;                        // body width

  /* --- the palette, after the mutation has had its say ----------------- */
  const P = {
    back: mut?.tint ?? spec.cols[0],
    belly: mut?.belly ?? spec.cols[1],
    accent: mut?.accent ?? spec.cols[2],
    pattern: mut && (mut.skin === 'metal' || mut.skin === 'flat' || mut.skin === 'stone')
      ? (mut.skin === 'stone' ? 'mottle' : 'gradient')      // a mutation can overwrite the markings
      : spec.pattern,
  };
  const ex = new Set(spec.extras || []);
  if (mut?.plated) ex.add('plates');
  if (mut?.rime) ex.add('rime');
  if (mut?.stars) ex.add('stars');
  const emissive = mut?.glow ? { hex: mut.glow, amt: mut.glowAmt ?? 0.5 } : null;

  const SEG = lod === 0 ? 22 : lod === 1 ? 14 : 9;   // stations along the body
  const RAD = lod === 0 ? 10 : lod === 1 ? 8 : 6;    // points round each ring

  /* ====================================================================== */
  /* THE BODY                                                               */
  /* ====================================================================== */

  const prof = PROFILE[spec.body] || PROFILE.torpedo;
  const wprof = WIDTH[spec.body] || WIDTH.torpedo;
  const bellyBias = BELLY[spec.body] ?? 0.45;

  /** depth, width and spine height of the body at station u. */
  const at = u => {
    const p = Math.max(0.02, prof(u));
    return {
      d: D * p,
      w: Math.max(0.004, W * p * wprof(u)),
      /* the spine rises towards the head on a deep-bodied fish, which is what
         gives a bream its hunched shoulder and a trout its straight back */
      y: D * (spec.body === 'ray' ? 0 : (prof(u) - prof(0.55)) * 0.14),
    };
  };

  const rings = [];
  for (let i = 0; i <= SEG; i++) {
    const u = i / SEG;
    const x = lerp(-L * 0.5, L * 0.5, u);
    const { d, w, y } = at(u);
    const ring = [];
    for (let k = 0; k < RAD; k++) {
      const a = (k / RAD) * TAU;
      const ca = Math.cos(a), sa = Math.sin(a);
      /* belly fuller than back: ellipse squashed downward, which is a real
         fish and not a lozenge */
      const yy = y + ca * d * (ca < 0 ? bellyBias * 2 : (1 - bellyBias) * 2) * 0.5;
      const zz = sa * w * 0.5;
      b.color(skinColour(P, u, ca, r), mut?.skin === 'glass' ? 0.02 : 0.055, r);
      ring.push(b.vert(x, yy, zz));
    }
    rings.push(ring);
  }
  /* skin the rings. nose-first winding, so the outside faces out. */
  for (let i = 0; i < SEG; i++) {
    for (let k = 0; k < RAD; k++) {
      const k2 = (k + 1) % RAD;
      b.quad(rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]);
    }
  }
  /* close the two ends with a fan rather than leaving a hole */
  for (const [ring, x, dir] of [[rings[0], -L * 0.5, -1], [rings[SEG], L * 0.5, 1]]) {
    b.color(dir > 0 ? P.back : shade(P.back, -0.2), 0.04, r);
    const c = b.vert(x + dir * L * 0.012, at(dir > 0 ? 1 : 0).y, 0);
    for (let k = 0; k < RAD; k++) {
      const k2 = (k + 1) % RAD;
      if (dir > 0) b.tri(c, ring[k], ring[k2]); else b.tri(c, ring[k2], ring[k]);
    }
  }

  /* ====================================================================== */
  /* THE HEAD                                                               */
  /* ====================================================================== */

  const noseX = L * 0.5;
  const headD = at(0.93).d;

  /* the jaw line: a wedge cut forward from the nose, shaped per head type */
  {
    const H = {
      blunt: { len: 0.02, drop: 0.10, wide: 1.0 },
      pointed: { len: 0.07, drop: 0.04, wide: 0.6 },
      beak: { len: 0.14, drop: 0.02, wide: 0.5 },
      wide: { len: 0.01, drop: 0.16, wide: 1.4 },
      whisker: { len: 0.02, drop: 0.20, wide: 1.3 },
      hooked: { len: 0.09, drop: -0.06, wide: 0.9 },
    }[spec.head] || { len: 0.03, drop: 0.08, wide: 1.0 };

    b.color(shade(P.back, -0.10), 0.05, r);
    const tip = b.vert(noseX + L * H.len, at(1).y + headD * H.drop * -1, 0);
    const jaw = [];
    for (let k = 0; k < RAD; k++) {
      const a = (k / RAD) * TAU;
      const yy = at(0.97).y + Math.cos(a) * at(0.97).d * 0.42;
      const zz = Math.sin(a) * at(0.97).w * 0.5 * H.wide;
      b.color(skinColour(P, 1, Math.cos(a), r), 0.05, r);
      jaw.push(b.vert(noseX + L * 0.01, yy, zz));
    }
    for (let k = 0; k < RAD; k++) b.tri(tip, jaw[k], jaw[(k + 1) % RAD]);

    /* the mouth: a dark slot, because a fish without one is a bath toy */
    b.color(0x2a1c18, 0.05, r);
    const mw = at(0.95).w * 0.42, my = at(0.97).y - headD * (H.drop + 0.06);
    quad(b,
      [noseX + L * H.len * 0.85, my, -mw],
      [noseX + L * H.len * 0.85, my, mw],
      [noseX - L * 0.03, my - headD * 0.05, mw * 0.8],
      [noseX - L * 0.03, my - headD * 0.05, -mw * 0.8],
      null, [0, -1, 0]);

    if (ex.has('teeth') && lod === 0) {
      b.color(0xf0ead8, 0.04, r);
      const n = 6;
      for (let i = 0; i < n; i++) {
        const z = lerp(-mw * 0.8, mw * 0.8, (i + 0.5) / n);
        for (const s of [1, -1]) {
          blob(b, noseX + L * H.len * 0.6, my + s * headD * 0.03, z,
            L * 0.012, 2, 4, (x, y, zz) => [0.6, 1.8, 0.6]);
        }
      }
    }
  }

  /* --- eyes. The single biggest readability win on a small model. ------- */
  {
    const eyeU = 0.90, e = at(eyeU);
    const er = Math.max(L * 0.012, e.d * spec.eye * 0.5);
    const ex2 = lerp(-L * 0.5, L * 0.5, eyeU);
    const ey = e.y + e.d * 0.16;
    for (const s of [1, -1]) {
      b.color(mut?.id === 'albino' ? 0xf4dcd8 : 0xf2efe4, 0.03, r);
      blob(b, ex2, ey, s * (e.w * 0.5 + er * 0.22), er, 3, 6);
      b.color(mut?.eye ?? 0x18140f, 0.02, r);
      blob(b, ex2 + er * 0.3, ey, s * (e.w * 0.5 + er * 0.5), er * 0.62, 3, 6);
      if (emissive) {
        g.color(emissive.hex, 0.1, r);
        blob(g, ex2 + er * 0.3, ey, s * (e.w * 0.5 + er * 0.52), er * 0.70, 2, 5);
      }
    }
  }

  /* --- gill plate: one line, and it doubles the sense of anatomy -------- */
  if (lod < 2) {
    const u = 0.76, e = at(u);
    const gx = lerp(-L * 0.5, L * 0.5, u);
    b.color(shade(P.accent, -0.15), 0.06, r);
    for (const s of [1, -1]) {
      for (let k = 0; k < 7; k++) {
        const a = -0.8 + (k / 6) * 2.1;
        const y0 = e.y + Math.cos(a) * e.d * 0.46;
        const z0 = s * (Math.abs(Math.sin(a)) * e.w * 0.5 + 0.0012);
        blob(b, gx, y0, z0, L * 0.008, 2, 4, (x, y, z) => [0.5, 0.5, 0.5]);
      }
    }
  }

  /* ====================================================================== */
  /* FINS                                                                   */
  /* ====================================================================== */

  const finCol = () => b.color(mixHex(P.accent, P.back, 0.35), 0.09, r);

  /** A fin is a flat blade of triangles fanned from a root line. */
  const fin = (x0, y0, x1, y1, z, span, curl = 0, rays = 5) => {
    const pts = [];
    for (let i = 0; i <= rays; i++) {
      const t = i / rays;
      const rx = lerp(x0, x1, t);
      const ry = lerp(y0, y1, t);
      const out = Math.sin(t * Math.PI) * span;
      pts.push([rx, ry, rx, ry + out * Math.cos(curl), out * Math.sin(curl)]);
    }
    for (let i = 0; i < rays; i++) {
      const a = pts[i], c = pts[i + 1];
      quad(b, [a[0], a[1], z], [c[0], c[1], z], [c[2], c[3], z + c[4]], [a[2], a[3], z + a[4]],
        null, [0, 0, 1]);
      quad(b, [c[0], c[1], z], [a[0], a[1], z], [a[2], a[3], z + a[4]], [c[2], c[3], z + c[4]],
        null, [0, 0, -1]);
    }
  };

  /* --- the tail. The most recognisable part of any fish. ---------------- */
  {
    const tx = -L * 0.5, e = at(0.03);
    const s = L * 0.5;
    finCol();
    const T = spec.tail;
    const mk = (pts) => {
      for (let i = 0; i < pts.length - 1; i++) {
        quad(b, [tx, e.y, 0], pts[i], pts[i + 1], pts[i + 1], null, [0, 0, 1]);
        quad(b, [tx, e.y, 0], pts[i + 1], pts[i], pts[i], null, [0, 0, -1]);
      }
    };
    const tails = {
      fork: [[tx - s * 0.34, e.y + s * 0.30, 0], [tx - s * 0.24, e.y + s * 0.07, 0],
      [tx - s * 0.30, e.y - 0.0, 0], [tx - s * 0.24, e.y - s * 0.07, 0],
      [tx - s * 0.34, e.y - s * 0.30, 0]],
      lunate: [[tx - s * 0.46, e.y + s * 0.38, 0], [tx - s * 0.20, e.y + s * 0.08, 0],
      [tx - s * 0.16, e.y, 0], [tx - s * 0.20, e.y - s * 0.08, 0],
      [tx - s * 0.46, e.y - s * 0.38, 0]],
      fan: [[tx - s * 0.26, e.y + s * 0.30, 0], [tx - s * 0.34, e.y + s * 0.16, 0],
      [tx - s * 0.36, e.y, 0], [tx - s * 0.34, e.y - s * 0.16, 0],
      [tx - s * 0.26, e.y - s * 0.30, 0]],
      round: [[tx - s * 0.16, e.y + s * 0.20, 0], [tx - s * 0.24, e.y + s * 0.10, 0],
      [tx - s * 0.26, e.y, 0], [tx - s * 0.24, e.y - s * 0.10, 0],
      [tx - s * 0.16, e.y - s * 0.20, 0]],
      spade: [[tx - s * 0.20, e.y + s * 0.24, 0], [tx - s * 0.30, e.y + s * 0.18, 0],
      [tx - s * 0.32, e.y, 0], [tx - s * 0.30, e.y - s * 0.18, 0],
      [tx - s * 0.20, e.y - s * 0.24, 0]],
      ribbon: [[tx - s * 0.58, e.y + s * 0.30, 0], [tx - s * 0.66, e.y + s * 0.10, 0],
      [tx - s * 0.62, e.y - s * 0.02, 0], [tx - s * 0.50, e.y - s * 0.16, 0],
      [tx - s * 0.30, e.y - s * 0.22, 0]],
      whip: [[tx - s * 0.90, e.y + s * 0.06, 0], [tx - s * 0.70, e.y + s * 0.02, 0],
      [tx - s * 0.50, e.y, 0], [tx - s * 0.30, e.y - s * 0.02, 0],
      [tx - s * 0.16, e.y - s * 0.05, 0]],
    };
    const base = tails[T] || tails.fork;
    mk(base);
    /* the twin-tailed mutation is the whole point of the mutation: a second
       tail, splayed, not a colour swap */
    if (mut?.twinTail) {
      const up = base.map(p => [p[0] - s * 0.06, p[1] + s * 0.16, p[2]]);
      const dn = base.map(p => [p[0] - s * 0.06, p[1] - s * 0.16, p[2]]);
      mk(up); mk(dn);
    }
  }

  /* --- dorsal ----------------------------------------------------------- */
  if (spec.dorsal && spec.dorsal !== 'none') {
    const H = { low: 0.30, tall: 0.75, sail: 1.45, spiny: 0.55, ridge: 0.16 }[spec.dorsal] ?? 0.3;
    const u0 = spec.dorsal === 'ridge' ? 0.14 : 0.34, u1 = spec.dorsal === 'sail' ? 0.86 : 0.70;
    const x0 = lerp(-L * 0.5, L * 0.5, u0), x1 = lerp(-L * 0.5, L * 0.5, u1);
    const y0 = at(u0).y + at(u0).d * 0.48, y1 = at(u1).y + at(u1).d * 0.48;
    finCol();
    fin(x0, y0, x1, y1, 0, at(0.5).d * H, 0, spec.dorsal === 'spiny' ? 7 : 5);
    if (spec.dorsal === 'spiny' && lod === 0) {
      b.color(shade(P.accent, 0.2), 0.06, r);
      for (let i = 0; i < 6; i++) {
        const t = (i + 0.5) / 6;
        const bx = lerp(x0, x1, t), by = lerp(y0, y1, t);
        tube(b, {
          pts: [[bx, by, 0], [bx + L * 0.01, by + at(0.5).d * H * Math.sin(t * Math.PI) * 1.05, 0]],
          radius: tt => L * 0.006 * (1 - tt * 0.8), radial: 4, capStart: false, capEnd: true, sway: () => 0,
        });
      }
    }
  }

  /* --- pectorals and anal ----------------------------------------------- */
  {
    const S = { small: 0.34, long: 0.62, wing: 1.65 }[spec.pect] || 0.4;
    const u = 0.68, e = at(u);
    const px = lerp(-L * 0.5, L * 0.5, u);
    finCol();
    for (const s of [1, -1]) {
      fin(px, e.y - e.d * 0.05, px - L * 0.13, e.y - e.d * 0.16,
        s * (e.w * 0.5), e.d * S, s > 0 ? 1.15 : -1.15, 4);
    }
    /* anal fin, underneath, aft — small but it stops the belly reading flat */
    const au = 0.26, ae = at(au);
    const ax = lerp(-L * 0.5, L * 0.5, au);
    fin(ax, ae.y - ae.d * 0.48, ax - L * 0.10, ae.y - ae.d * 0.46, 0, ae.d * 0.34, Math.PI, 4);
  }

  /* ====================================================================== */
  /* EXTRAS                                                                 */
  /* ====================================================================== */

  if (ex.has('barbels')) {
    b.color(shade(P.belly, -0.12), 0.07, r);
    const n = spec.head === 'whisker' ? 4 : 2;
    const e = at(0.93);
    for (let i = 0; i < n; i++) {
      const s = i % 2 ? 1 : -1;
      const k = Math.floor(i / 2);
      const len = L * (0.16 + k * 0.10);
      tube(b, {
        pts: [
          [noseX - L * 0.02, e.y - e.d * (0.18 + k * 0.14), s * e.w * 0.36],
          [noseX - L * 0.10, e.y - e.d * (0.52 + k * 0.2), s * (e.w * 0.5 + len * 0.3)],
          [noseX - L * 0.20, e.y - e.d * (0.70 + k * 0.2), s * (e.w * 0.5 + len * 0.5)],
        ],
        radius: t => L * 0.008 * (1 - t * 0.8), radial: 4, capStart: false, capEnd: true, sway: () => 0,
      });
    }
  }

  if (ex.has('spines') && lod === 0) {
    b.color(shade(P.back, -0.3), 0.06, r);
    for (let i = 0; i < 7; i++) {
      const u = 0.22 + (i / 7) * 0.5, e = at(u);
      const sx = lerp(-L * 0.5, L * 0.5, u);
      tube(b, {
        pts: [[sx, e.y + e.d * 0.46, 0], [sx - L * 0.02, e.y + e.d * 0.46 + L * 0.055, 0]],
        radius: t => L * 0.007 * (1 - t), radial: 4, capStart: false, capEnd: true, sway: () => 0,
      });
    }
  }

  if (ex.has('plates')) {
    b.color(shade(P.accent, -0.25), 0.08, r);
    for (let i = 0; i < 9; i++) {
      const u = 0.12 + (i / 9) * 0.72, e = at(u);
      const sx = lerp(-L * 0.5, L * 0.5, u);
      for (const s of [1, -1]) {
        blob(b, sx, e.y + e.d * 0.12, s * e.w * 0.48, L * 0.026, 2, 5,
          (x, y, z) => [0.35, 0.9, 1.5]);
      }
    }
  }

  if (ex.has('lantern')) {
    const e = at(0.95);
    b.color(shade(P.back, -0.2), 0.05, r);
    const tipY = e.y + e.d * 0.55 + L * 0.30;
    tube(b, {
      pts: [[noseX - L * 0.06, e.y + e.d * 0.42, 0], [noseX + L * 0.02, tipY * 0.8, 0], [noseX - L * 0.02, tipY, 0]],
      radius: t => L * 0.010 * (1 - t * 0.4), radial: 4, capStart: false, capEnd: false, sway: () => 0,
    });
    b.color(0xfff0b0, 0.05, r);
    blob(b, noseX - L * 0.02, tipY, 0, L * 0.036, 3, 6);
    g.color(mut?.glow ?? 0xffe89a, 0.1, r);
    blob(g, noseX - L * 0.02, tipY, 0, L * 0.052, 2, 6);
  }

  if (ex.has('trailing') && lod === 0) {
    /* long trailing fin filaments — a koi's finery, a deep fish's streamers */
    b.color(mixHex(P.accent, 0xffffff, 0.3), 0.10, r);
    for (let i = 0; i < 5; i++) {
      const u = 0.16 + i * 0.05, e = at(u);
      const sx = lerp(-L * 0.5, L * 0.5, u);
      const s = i % 2 ? 1 : -1;
      tube(b, {
        pts: [[sx, e.y - e.d * 0.3, s * e.w * 0.3],
        [sx - L * 0.18, e.y - e.d * 0.5, s * e.w * 0.6],
        [sx - L * 0.34, e.y - e.d * 0.35, s * e.w * 0.4]],
        radius: t => L * 0.006 * (1 - t * 0.7), radial: 3, capStart: false, capEnd: false, sway: () => 0,
      });
    }
  }

  if (ex.has('rime')) {
    b.color(0xe8f6ff, 0.05, r);
    for (let i = 0; i < 16; i++) {
      const u = r(), e = at(u);
      const a = r.range(0, TAU);
      blob(b, lerp(-L * 0.5, L * 0.5, u), e.y + Math.cos(a) * e.d * 0.5,
        Math.sin(a) * e.w * 0.5, L * r.range(0.008, 0.02), 2, 4);
    }
  }

  if (ex.has('stars')) {
    for (let i = 0; i < 22; i++) {
      const u = r.range(0.1, 0.9), e = at(u);
      const a = r.range(0, TAU);
      const x = lerp(-L * 0.5, L * 0.5, u);
      const y = e.y + Math.cos(a) * e.d * 0.5, z = Math.sin(a) * e.w * 0.52;
      g.color(r.chance(0.3) ? 0xfff4c0 : 0xd8d0ff, 0.1, r);
      blob(g, x, y, z, L * r.range(0.005, 0.012), 2, 4);
    }
  }

  /* the whole-body glow of a Glowing / Ember / Spectral fish */
  if (emissive && emissive.amt > 0.4) {
    g.color(emissive.hex, 0.06, r);
    for (let i = 0; i <= 8; i++) {
      const u = i / 8, e = at(u);
      blob(g, lerp(-L * 0.5, L * 0.5, u), e.y, 0,
        Math.max(e.d, e.w) * 0.62 * emissive.amt, 2, 6);
    }
  }

  const height = D * 1.15 + (spec.dorsal === 'sail' ? D * 1.4 : 0);
  return { builder: b, glow: g, length: L * 1.25, height, width: W * 1.1, spec, mutation: mut };
}

/** A fish as three.js meshes, ready to drop in a scene. */
export function fishMeshes(f, mats, opts = {}) {
  const out = buildFish(f, opts);
  const meshes = [new THREE.Mesh(out.builder.build({ flat: opts.facet ?? false }), mats.item)];
  if (!out.glow.isEmpty) meshes.push(new THREE.Mesh(out.glow.build({ flat: false }), mats.glow));
  for (const m of meshes) { m.castShadow = true; m.receiveShadow = true; }
  return { meshes, info: out };
}
