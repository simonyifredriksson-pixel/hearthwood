/* PlantGen.js — everything on the forest floor that is not a tree or a stick.
   ===========================================================================
   Ferns, bushes, brambles, grass tufts, flowers, mushrooms, reeds, nettles,
   ivy, clover, and the fallen logs and boulders they grow over.

   These are the things a player walks THROUGH, so they are seen closer than
   anything else in the world and they carry most of the feeling of the place.
   Three rules they all follow:

     - NOTHING IS UPRIGHT AND SYMMETRICAL. Every plant gets a lean, a twist
       and an uneven number of parts. A row of identical vertical stems is the
       most obvious tell that a floor was scattered by a computer.
     - EVERY PART CARRIES A SWAY WEIGHT. A fern frond moves at its tip and not
       at its root; a mushroom does not move at all. Wind that moves the whole
       plant rigidly looks like an earthquake.
     - COLOUR VARIES WITHIN A SINGLE PLANT. One fern is a dozen greens, paler
       at the new growth in the middle and browner at the old outer fronds.
*/

import * as THREE from '../../lib/three.module.js';
import { MeshBuilder, tube, blob, blade, lathe, smoothPath, rotAxis, norm3, perp } from './Geo.js';
import { PLANT, LEAF, MOSS, MUSHROOM, GROUND, BARK, mixHex, tweak, shade } from './Palette.js';
import { orient, lumpWarp } from './TreeGen.js';
import { makeRng, clamp, lerp, TAU, smoothstep } from '../core/Util.js';

/* ========================================================================= */
/* FERN                                                                      */
/* ========================================================================= */

/** A shuttlecock of arching fronds. The single most recognisable thing on a
 *  damp woodland floor, and the plant that most sells "this is a forest". */
export function buildFern(b, { seed = 1, size = 0.55, lod = 0, dry = 0 } = {}) {
  const r = makeRng(seed ^ 0xfe12);
  const n = lod === 0 ? r.int(4, 7) : lod === 1 ? r.int(3, 4) : 2;
  const base = tweak(PLANT.fern, { h: r.range(-0.03, 0.03), l: r.range(0.85, 1.15) });

  /* A fern reads from its PINNAE — the broad, deeply toothed leaflets that
     sweep back toward the base along each side of the frond. Building each
     pinna out of seven little blades made a plant that cost five thousand
     triangles and still looked like a spider plant, because at any normal
     distance the individual leaflets are sub-pixel. One wide blade per side
     per segment, with the toothing carried by its WIDTH function, is a
     twelfth of the cost and reads far better. */
  const serrate = t => {
    const env = Math.sin(t * Math.PI) ** 0.42;              // overall leaf shape
    const teeth = 0.72 + 0.28 * Math.abs(Math.sin(t * 9));  // the deep toothing
    return env * teeth;
  };

  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + r.range(-0.45, 0.45);
    const len = size * r.range(0.75, 1.3);
    const arch = r.range(0.30, 0.75);
    const lean = r.range(0.40, 0.95);
    // outer fronds are older and browner
    const age = i / n;
    const hex = mixHex(
      mixHex(base, PLANT.fernPale, r() * 0.5),
      LEAF.dead, dry * 0.7 + age * 0.14 * r(),
    );

    const segs = lod === 0 ? 5 : 3;
    const pts = [];
    for (let k = 0; k <= segs; k++) {
      const t = k / segs;
      // rises then arches over: this curve IS the fern
      const y = len * (Math.sin(t * 1.35) * 0.95 - arch * t * t * 0.85);
      const rad = len * lean * t;
      pts.push([Math.cos(a) * rad, Math.max(0.005, y), Math.sin(a) * rad]);
    }

    b.color(shade(hex, -0.26), 0.06, r);
    tube(b, {
      pts, radius: t => size * 0.016 * (1 - t * 0.7), radial: 3,
      capStart: false, capEnd: false, sway: t => t * t * 0.9,
    });

    for (let k = 0; k < segs; k++) {
      const t = (k + 0.5) / segs;
      // longest pinnae a third of the way up, shortest at the tip
      const pl = len * 0.42 * Math.sin(Math.pow(1 - t, 0.55) * Math.PI * 0.78) * r.range(0.85, 1.15);
      if (pl < 0.02) continue;
      const p = pts[k];
      const fwd = norm3([
        pts[k + 1][0] - p[0], pts[k + 1][1] - p[1], pts[k + 1][2] - p[2],
      ]);
      const sideAxis = norm3([-Math.sin(a), 0, Math.cos(a)]);
      for (const side of [-1, 1]) {
        const sub = new MeshBuilder();
        sub.color(tweak(hex, { l: r.range(0.86, 1.16) }), 0.08, r);
        blade(sub, {
          len: pl, wid: pl * r.range(0.30, 0.40), segs: lod === 0 ? 3 : 2,
          curl: r.range(0.15, 0.4), cup: 0.22,
          swayBase: 0.45 + t * 0.35, swayTip: 1, widthAt: serrate,
        });
        // swept BACK toward the base of the frond, not straight out sideways
        const d = norm3([
          sideAxis[0] * side * 0.88 - fwd[0] * 0.34 + 0,
          0.22 - fwd[1] * 0.2,
          sideAxis[2] * side * 0.88 - fwd[2] * 0.34,
        ]);
        b.append(sub, orient(p, d, side > 0 ? 0.25 : -0.25));
      }
    }
  }
}

/* ========================================================================= */
/* BUSH                                                                      */
/* ========================================================================= */

/** A rounded mass of small leaves on a tangle of twigs. Used for hedges,
 *  bramble, undergrowth and garden shrubs. */
export function buildBush(b, {
  seed = 1, size = 0.8, lod = 0, hex = PLANT.bush, flower = null, berry = null, thorny = false,
} = {}) {
  const r = makeRng(seed ^ 0xb115);
  const base = tweak(hex, { h: r.range(-0.035, 0.035), l: r.range(0.85, 1.15) });
  const stems = lod === 0 ? r.int(4, 7) : r.int(2, 4);
  const clumps = lod === 0 ? r.int(6, 11) : lod === 1 ? r.int(3, 5) : 2;
  const rings = lod === 0 ? 3 : 2;
  const seg = lod === 0 ? 6 : 5;

  /* twiggy skeleton, visible through the gaps at the bottom */
  if (lod <= 1) {
    for (let i = 0; i < stems; i++) {
      const a = (i / stems) * TAU + r.range(-0.5, 0.5);
      const h = size * r.range(0.6, 1.05);
      const out = size * r.range(0.2, 0.6);
      b.color(mixHex(BARK.hazel, BARK.deadWood, r() * 0.5), 0.1, r);
      tube(b, {
        pts: [[0, 0, 0], [Math.cos(a) * out * 0.4, h * 0.5, Math.sin(a) * out * 0.4],
        [Math.cos(a) * out, h, Math.sin(a) * out]],
        radius: t => size * 0.022 * (1 - t * 0.6), radial: 3,
        capStart: false, capEnd: false, sway: t => t * 0.5,
      });
      if (thorny) {
        for (let k = 0; k < r.int(1, 3); k++) {
          const t = r.range(0.3, 0.9);
          const p = [Math.cos(a) * out * t, h * t, Math.sin(a) * out * t];
          const d = norm3([r.bell(), r.range(-0.2, 0.6), r.bell()]);
          b.color(0x6a5240);
          tube(b, {
            pts: [p, [p[0] + d[0] * size * 0.1, p[1] + d[1] * size * 0.1, p[2] + d[2] * size * 0.1]],
            radius: t2 => size * 0.008 * (1 - t2), radial: 3, capStart: false, capEnd: false, sway: () => 0.5,
          });
        }
      }
    }
  }

  /* the mass of leaf */
  for (let i = 0; i < clumps; i++) {
    const a = r.range(0, TAU);
    const rad = size * r.range(0, 0.62);
    const cx = Math.cos(a) * rad, cz = Math.sin(a) * rad;
    const cy = size * r.range(0.25, 0.85);
    const R = size * r.range(0.24, 0.42);
    const hue = tweak(mixHex(base, LEAF.young, r() * 0.35), { h: r.range(-0.02, 0.02) });
    const lumpy = lumpWarp(r, 3, 0.28);
    const sw = clamp(0.35 + (cy / size) * 0.6, 0, 1);
    blob(b, cx, cy, cz, R, rings, seg,
      (x, y, z) => { const m = lumpy(x, y, z); return [m, m * 0.82, m]; }, sw,
      (x, y, z) => shade(hue, lerp(-0.52, 0.12, Math.pow(y * 0.5 + 0.5, 1.1))));
  }

  /* flowers and berries sit on the outside, where they would catch the sun */
  if (flower && lod === 0) {
    const n = r.int(4, 12);
    for (let i = 0; i < n; i++) {
      const a = r.range(0, TAU), rad = size * r.range(0.35, 0.72);
      const y = size * r.range(0.45, 0.95);
      b.color(flower, 0.10, r);
      blob(b, Math.cos(a) * rad, y, Math.sin(a) * rad, size * r.range(0.035, 0.07), 2, 5, null, 0.8);
    }
  }
  if (berry && lod <= 1) {
    const n = r.int(5, 14);
    for (let i = 0; i < n; i++) {
      const a = r.range(0, TAU), rad = size * r.range(0.35, 0.7);
      const y = size * r.range(0.35, 0.9);
      b.color(berry, 0.12, r);
      blob(b, Math.cos(a) * rad, y, Math.sin(a) * rad, size * r.range(0.022, 0.04), 2, 4, null, 0.8);
    }
  }
}

/* ========================================================================= */
/* GRASS                                                                     */
/* ========================================================================= */

/**
 * A tuft of grass: a handful of tapered blades fanning from one point. These
 * are placed in their thousands, so the whole thing is six triangles a blade
 * and there is no stem geometry at all.
 */
export function buildGrassTuft(b, { seed = 1, size = 0.32, lod = 0, hex = null, dry = 0 } = {}) {
  const r = makeRng(seed ^ 0x9a55);
  const n = lod === 0 ? r.int(4, 8) : r.int(2, 4);
  const base = hex || tweak(GROUND.grass, { h: r.range(-0.04, 0.05), l: r.range(0.9, 1.35), s: 1.1 });
  for (let i = 0; i < n; i++) {
    const a = r.range(0, TAU);
    const h = size * r.range(0.55, 1.5);
    const lean = r.range(0.15, 0.6);
    const hex2 = mixHex(tweak(base, { l: r.range(0.85, 1.2) }), 0xbfae6a, dry * r.range(0.3, 1));
    b.color(hex2, 0.07, r);
    // a single folded blade: two triangles per segment, three segments
    const segs = lod === 0 ? 3 : 2;
    const w = size * r.range(0.035, 0.07);
    let prev = null;
    for (let k = 0; k <= segs; k++) {
      const t = k / segs;
      const y = h * Math.sin(t * 1.2) * (1 - lean * t * t * 0.55);
      const rad = h * lean * t * t;
      const cx = Math.cos(a) * rad, cz = Math.sin(a) * rad;
      const ww = w * (1 - t * 0.92);
      const px = -Math.sin(a) * ww, pz = Math.cos(a) * ww;
      const sw = 0.25 + t * 0.75;
      const row = [
        b.vert(cx - px, y, cz - pz, sw),
        b.vert(cx, y + ww * 0.55, cz, sw),
        b.vert(cx + px, y, cz + pz, sw),
      ];
      if (prev) {
        b.quad(prev[0], prev[1], row[1], row[0]);
        b.quad(prev[1], prev[2], row[2], row[1]);
      }
      prev = row;
    }
  }
}

/* ========================================================================= */
/* FLOWERS                                                                   */
/* ========================================================================= */

/* `head` is the flower's radius in metres, and these numbers are deliberately
   larger than life. A botanically correct 8 mm daisy is two pixels across
   from standing height and the meadow reads as bare grass; at 4 cm it reads
   as a meadow with daisies in it, which is the thing the player is actually
   being told. Cozy games cheat flower scale, and they are right to. */
export const FLOWERS = {
  daisy: { petal: PLANT.flowerWhite, centre: PLANT.flowerYellow, petals: 8, h: [0.14, 0.26], head: 0.048, kind: 'disc' },
  buttercup: { petal: PLANT.flowerYellow, centre: 0xe8c14a, petals: 5, h: [0.16, 0.30], head: 0.040, kind: 'disc' },
  cornflower: { petal: PLANT.flowerBlue, centre: 0x4a5a9a, petals: 7, h: [0.28, 0.52], head: 0.046, kind: 'disc' },
  poppy: { petal: PLANT.flowerRed, centre: 0x2a2018, petals: 4, h: [0.30, 0.58], head: 0.070, kind: 'cup' },
  foxglove: { petal: PLANT.foxglove, centre: 0xe8c8e0, petals: 0, h: [0.60, 1.20], head: 0.055, kind: 'spike' },
  bluebell: { petal: 0x6f6fc0, centre: 0x9a9ad8, petals: 0, h: [0.20, 0.38], head: 0.034, kind: 'bell' },
  heather: { petal: PLANT.heather, centre: 0xc09ab8, petals: 0, h: [0.16, 0.34], head: 0.024, kind: 'spike' },
  clover: { petal: PLANT.cloverFlower, centre: 0xe4e0c8, petals: 0, h: [0.10, 0.18], head: 0.038, kind: 'puff' },
  yarrow: { petal: 0xf0eedc, centre: 0xdcd8b8, petals: 0, h: [0.30, 0.58], head: 0.080, kind: 'flat' },
  campion: { petal: PLANT.flowerPink, centre: 0xf0d0e0, petals: 5, h: [0.24, 0.46], head: 0.038, kind: 'disc' },
  violet: { petal: PLANT.flowerPurple, centre: 0xe8d858, petals: 5, h: [0.09, 0.17], head: 0.030, kind: 'disc' },
  marigold: { petal: PLANT.flowerOrange, centre: 0xb8702a, petals: 9, h: [0.18, 0.34], head: 0.052, kind: 'disc' },
};

export const FLOWER_NAMES = Object.keys(FLOWERS);

export function buildFlower(b, { seed = 1, kind = 'daisy', lod = 0, scale = 1 } = {}) {
  const F = FLOWERS[kind] || FLOWERS.daisy;
  const r = makeRng(seed ^ 0xf10e);
  const n = lod === 0 ? r.int(3, 7) : r.int(1, 3);
  const leafHex = tweak(PLANT.fern, { h: r.range(-0.03, 0.03), l: r.range(0.9, 1.2) });

  /* a few basal leaves, which is what makes a flower look planted rather
     than stuck in the ground like a pin */
  if (lod === 0) {
    for (let i = 0; i < r.int(2, 4); i++) {
      const a = r.range(0, TAU);
      const sub = new MeshBuilder();
      sub.color(leafHex, 0.08, r);
      blade(sub, { len: scale * r.range(0.05, 0.12), wid: scale * r.range(0.015, 0.035), segs: 2, curl: 0.6, cup: 0.3, swayBase: 0.2, swayTip: 0.9 });
      b.append(sub, orient([0, scale * 0.01, 0], [Math.cos(a) * 0.9, 0.42, Math.sin(a) * 0.9], 0));
    }
  }

  for (let i = 0; i < n; i++) {
    const h = scale * lerp(F.h[0], F.h[1], r());
    const a = r.range(0, TAU);
    const lean = r.range(0.04, 0.24);
    const top = [Math.cos(a) * h * lean, h, Math.sin(a) * h * lean];

    b.color(shade(leafHex, -0.12), 0.06, r);
    tube(b, {
      pts: [[0, 0, 0], [top[0] * 0.45, h * 0.55, top[2] * 0.45], top],
      radius: t => scale * 0.0075 * (1 - t * 0.3), radial: 3,
      capStart: false, capEnd: false, sway: t => t * t * 0.95,
    });

    const head = scale * F.head * r.range(0.8, 1.25);
    const petalHex = tweak(F.petal, { h: r.range(-0.02, 0.02), l: r.range(0.92, 1.08) });

    if (F.kind === 'disc' || F.kind === 'cup') {
      const tilt = F.kind === 'cup' ? 0.25 : 0.0;
      for (let p = 0; p < F.petals; p++) {
        const pa = (p / F.petals) * TAU + r.range(-0.12, 0.12);
        const sub = new MeshBuilder();
        sub.color(petalHex, 0.06, r);
        blade(sub, {
          len: head * r.range(1.5, 2.1), wid: head * (F.kind === 'cup' ? 1.3 : 0.75),
          segs: 1, curl: F.kind === 'cup' ? 0.75 : 0.22, cup: 0.35, swayBase: 0.95, swayTip: 1,
          widthAt: t => Math.sin(t * Math.PI) ** 0.5,
        });
        b.append(sub, orient(top, [Math.cos(pa), 0.22 + tilt, Math.sin(pa)], 0));
      }
      b.color(F.centre, 0.05, r);
      blob(b, top[0], top[1] + head * 0.12, top[2], head * 0.55, 2, 6, (x, y) => [1, 0.45, 1], 0.95);
    } else if (F.kind === 'spike') {
      const count = lod === 0 ? r.int(5, 10) : 4;
      for (let p = 0; p < count; p++) {
        const t = p / count;
        const y = top[1] * (0.35 + t * 0.62);
        const pa = t * 6.2 + r.range(-0.3, 0.3);
        const rr = head * (1 - t * 0.5);
        b.color(mixHex(petalHex, F.centre, t * 0.5), 0.07, r);
        blob(b,
          top[0] * (y / top[1]) + Math.cos(pa) * rr * 1.2, y, top[2] * (y / top[1]) + Math.sin(pa) * rr * 1.2,
          rr, 2, 5, (x, y2, z) => [1, 1.6, 1], 0.6 + t * 0.4);
      }
    } else if (F.kind === 'bell') {
      const count = r.int(3, 6);
      for (let p = 0; p < count; p++) {
        const t = p / count;
        const y = top[1] * (0.5 + t * 0.45);
        const pa = t * 5.1 + r.range(-0.4, 0.4);
        b.color(petalHex, 0.07, r);
        const sub = new MeshBuilder();
        sub.curColor = b.curColor;
        lathe(sub, [[0.001, 0], [head * 0.9, -head * 0.6], [head * 1.05, -head * 1.5], [head * 0.7, -head * 1.7]], 5);
        b.append(sub, orient([
          top[0] * (y / top[1]) + Math.cos(pa) * head * 1.1, y, top[2] * (y / top[1]) + Math.sin(pa) * head * 1.1,
        ], [0, 1, 0], 0));
      }
    } else if (F.kind === 'flat') {
      // an umbel: many tiny florets on a flat head
      const count = lod === 0 ? r.int(9, 16) : 6;
      for (let p = 0; p < count; p++) {
        const pa = r.range(0, TAU), rr = head * Math.sqrt(r());
        b.color(p % 3 === 0 ? F.centre : petalHex, 0.05, r);
        blob(b, top[0] + Math.cos(pa) * rr, top[1] + r.range(-0.004, 0.006), top[2] + Math.sin(pa) * rr,
          head * 0.22, 2, 4, (x, y) => [1, 0.5, 1], 0.95);
      }
    } else { // puff
      b.color(petalHex, 0.08, r);
      blob(b, top[0], top[1] + head * 0.5, top[2], head, 3, 6,
        lumpWarp(r, 3, 0.35), 0.95,
        (x, y) => shade(petalHex, lerp(-0.25, 0.1, y * 0.5 + 0.5)));
    }
  }
}

/* ========================================================================= */
/* MUSHROOMS                                                                 */
/* ========================================================================= */

export const SHROOMS = {
  flyAgaric: { cap: MUSHROOM.flyAgaricCap, stem: MUSHROOM.flyAgaricStem, spots: MUSHROOM.flyAgaricSpot, h: [0.07, 0.17], w: 1.15, shape: 'dome' },
  bolete: { cap: MUSHROOM.boleteCap, stem: MUSHROOM.boleteStem, h: [0.06, 0.15], w: 1.3, shape: 'bun' },
  chanterelle: { cap: MUSHROOM.chanterelle, stem: 0xe0bf7a, h: [0.04, 0.10], w: 0.95, shape: 'funnel' },
  inkcap: { cap: MUSHROOM.inkcapCap, stem: MUSHROOM.inkcapStem, h: [0.06, 0.16], w: 0.45, shape: 'bell' },
  puffball: { cap: MUSHROOM.puffball, stem: MUSHROOM.puffball, h: [0.03, 0.09], w: 1.5, shape: 'ball' },
  toadstool: { cap: MUSHROOM.toadstoolPurple, stem: 0xd8cbb0, h: [0.05, 0.12], w: 1.0, shape: 'dome' },
  glowcap: { cap: MUSHROOM.glowCap, stem: MUSHROOM.glowStem, h: [0.05, 0.13], w: 0.9, shape: 'funnel', glow: true },
};

export const SHROOM_NAMES = Object.keys(SHROOMS);

/** A little cluster of mushrooms. `glowB` receives the emissive parts. */
export function buildMushrooms(b, { seed = 1, kind = 'flyAgaric', lod = 0, scale = 1, glow = null } = {}) {
  const M = SHROOMS[kind] || SHROOMS.flyAgaric;
  const r = makeRng(seed ^ 0x5417);
  const n = lod === 0 ? r.int(2, 6) : r.int(1, 3);
  const target = (M.glow && glow) ? glow : b;

  for (let i = 0; i < n; i++) {
    const a = r.range(0, TAU), rad = scale * r.range(0, 0.09);
    const cx = Math.cos(a) * rad, cz = Math.sin(a) * rad;
    const h = scale * lerp(M.h[0], M.h[1], r.pow(1.3));
    const capR = h * M.w * r.range(0.75, 1.2);
    const lean = r.range(0, 0.12);
    const la = r.range(0, TAU);

    const stemHex = tweak(M.stem, { l: r.range(0.9, 1.1) });
    const capHex = tweak(M.cap, { h: r.range(-0.02, 0.02), l: r.range(0.88, 1.12) });

    const sub = new MeshBuilder();
    sub.color(stemHex, 0.05, r);
    lathe(sub, [
      [h * 0.10, 0], [h * 0.075, h * 0.35], [h * 0.07, h * 0.75], [h * 0.085, h],
    ], 6);

    sub.color(capHex, 0.05, r);
    let prof;
    switch (M.shape) {
      case 'bun':
        prof = [[0.001, h + capR * 0.55], [capR * 0.7, h + capR * 0.42], [capR, h + capR * 0.05], [capR * 0.9, h - capR * 0.05]];
        break;
      case 'funnel':
        prof = [[0.001, h - capR * 0.1], [capR * 0.45, h + capR * 0.05], [capR * 0.85, h + capR * 0.35], [capR, h + capR * 0.42]];
        break;
      case 'bell':
        prof = [[0.001, h + capR * 1.5], [capR * 0.55, h + capR * 0.9], [capR, h + capR * 0.1], [capR * 0.95, h - capR * 0.1]];
        break;
      case 'ball':
        prof = [[0.001, h + capR * 1.1], [capR * 0.8, h + capR * 0.75], [capR, h + capR * 0.15], [capR * 0.6, h - capR * 0.1]];
        break;
      default: // dome
        prof = [[0.001, h + capR * 0.7], [capR * 0.6, h + capR * 0.55], [capR, h + capR * 0.08], [capR * 0.92, h - capR * 0.06]];
    }
    lathe(sub, prof, 7);

    // gills, just visible under the rim
    if (lod === 0 && M.shape !== 'ball') {
      sub.color(shade(stemHex, 0.08), 0.04, r);
      lathe(sub, [[capR * 0.15, h - capR * 0.04], [capR * 0.88, h - capR * 0.02]], 7);
    }
    if (M.spots && lod === 0) {
      sub.color(M.spots, 0.04, r);
      for (let k = 0; k < r.int(3, 7); k++) {
        const sa = r.range(0, TAU), sr = capR * r.range(0.15, 0.78);
        blob(sub, Math.cos(sa) * sr, h + capR * (0.6 - (sr / capR) * 0.5), Math.sin(sa) * sr,
          capR * r.range(0.08, 0.15), 2, 4, () => [1, 0.45, 1], 0);
      }
    }

    target.append(sub, orient([cx, 0, cz], [Math.cos(la) * lean, 1, Math.sin(la) * lean], r.range(0, TAU)));
  }
}

/* ========================================================================= */
/* REEDS, NETTLES, IVY, CLOVER                                               */
/* ========================================================================= */

/** Tall thin stems for riverbanks. */
export function buildReeds(b, { seed = 1, size = 1.1, lod = 0 } = {}) {
  const r = makeRng(seed ^ 0x9eed);
  const n = lod === 0 ? r.int(6, 14) : r.int(3, 6);
  const hex = tweak(PLANT.reed, { h: r.range(-0.04, 0.04), l: r.range(0.85, 1.2) });
  for (let i = 0; i < n; i++) {
    const a = r.range(0, TAU), rad = size * r.range(0, 0.18);
    const h = size * r.range(0.55, 1.3);
    const lean = r.range(0.05, 0.35), la = r.range(0, TAU);
    const cx = Math.cos(a) * rad, cz = Math.sin(a) * rad;
    b.color(tweak(hex, { l: r.range(0.9, 1.12) }), 0.06, r);
    const top = [cx + Math.cos(la) * h * lean, h, cz + Math.sin(la) * h * lean];
    tube(b, {
      pts: [[cx, 0, cz], [lerp(cx, top[0], 0.5), h * 0.55, lerp(cz, top[2], 0.5)], top],
      radius: t => size * 0.011 * (1 - t * 0.75), radial: 3,
      capStart: false, capEnd: false, sway: t => t * t * 1.0,
    });
    // a seed head on some of them
    if (r.chance(0.4)) {
      b.color(mixHex(0x8a7048, hex, 0.3), 0.08, r);
      blob(b, top[0], top[1] + size * 0.05, top[2], size * 0.022, 2, 5, (x, y) => [1, 3.2, 1], 1);
    }
    // a couple of long leaves
    if (lod === 0 && r.chance(0.55)) {
      const sub = new MeshBuilder();
      sub.color(shade(hex, -0.1), 0.06, r);
      blade(sub, { len: h * r.range(0.4, 0.8), wid: size * 0.022, segs: 3, curl: 0.85, cup: 0.4, swayBase: 0.3, swayTip: 1 });
      b.append(sub, orient([cx, h * 0.2, cz], [Math.cos(a + 1) * 0.5, 0.86, Math.sin(a + 1) * 0.5], 0));
    }
  }
}

/** Nettles and low leafy weeds. */
export function buildWeed(b, { seed = 1, size = 0.4, lod = 0, hex = PLANT.nettle } = {}) {
  const r = makeRng(seed ^ 0x77ee);
  const stems = lod === 0 ? r.int(2, 4) : 1;
  const base = tweak(hex, { h: r.range(-0.04, 0.04), l: r.range(0.85, 1.15) });
  for (let s = 0; s < stems; s++) {
    const a = r.range(0, TAU), rad = size * r.range(0, 0.15);
    const h = size * r.range(0.6, 1.2);
    const cx = Math.cos(a) * rad, cz = Math.sin(a) * rad;
    b.color(shade(base, -0.15), 0.06, r);
    tube(b, {
      pts: [[cx, 0, cz], [cx, h * 0.5, cz], [cx + r.bell() * h * 0.1, h, cz + r.bell() * h * 0.1]],
      radius: t => size * 0.012 * (1 - t * 0.5), radial: 3, capStart: false, capEnd: false, sway: t => t * 0.9,
    });
    const pairs = lod === 0 ? r.int(2, 4) : 2;
    for (let k = 1; k <= pairs; k++) {
      const t = k / (pairs + 0.5);
      for (const side of [-1, 1]) {
        const sub = new MeshBuilder();
        sub.color(tweak(base, { l: r.range(0.88, 1.15) }), 0.07, r);
        blade(sub, {
          len: size * r.range(0.22, 0.44) * (1 - t * 0.35), wid: size * 0.11, segs: 2,
          curl: 0.35, cup: 0.3, swayBase: 0.4 + t * 0.3, swayTip: 1,
          widthAt: u => Math.sin(u * Math.PI) ** 0.45,
        });
        const ang = a + k * 1.9;
        b.append(sub, orient([cx, h * t, cz], [Math.cos(ang) * side * 0.85, 0.5, Math.sin(ang) * side * 0.85], 0));
      }
    }
  }
}

/** Ground cover: clover, wood sorrel, low creeping leaves. */
export function buildGroundCover(b, { seed = 1, size = 0.3, lod = 0, hex = 0x5f8a3a, flower = null } = {}) {
  const r = makeRng(seed ^ 0xc10e);
  const n = lod === 0 ? r.int(5, 12) : r.int(3, 6);
  for (let i = 0; i < n; i++) {
    const a = r.range(0, TAU), rad = size * Math.sqrt(r()) * 0.9;
    const h = size * r.range(0.05, 0.16);
    const sub = new MeshBuilder();
    sub.color(tweak(hex, { h: r.range(-0.03, 0.04), l: r.range(0.82, 1.2) }), 0.08, r);
    // a trefoil: three little rounded leaflets
    for (let k = 0; k < 3; k++) {
      const bl = new MeshBuilder();
      bl.curColor = sub.curColor;
      blade(bl, {
        len: size * r.range(0.10, 0.18), wid: size * 0.10, segs: 1, curl: 0.15, cup: 0.4,
        swayBase: 0.3, swayTip: 0.8, widthAt: t => Math.sin(t * Math.PI) ** 0.35,
      });
      sub.append(bl, orient([0, 0, 0], [Math.cos(k * 2.094), 0.35, Math.sin(k * 2.094)], 0));
    }
    b.append(sub, orient([Math.cos(a) * rad, h, Math.sin(a) * rad], [r.bell() * 0.2, 1, r.bell() * 0.2], r.range(0, TAU)));
    if (flower && r.chance(0.22)) {
      b.color(flower, 0.06, r);
      blob(b, Math.cos(a) * rad, h + size * 0.07, Math.sin(a) * rad, size * 0.035, 2, 5, lumpWarp(r, 2, 0.3), 0.7);
    }
  }
}

/* ========================================================================= */
/* ROCKS, LOGS AND DEADWOOD                                                  */
/* ========================================================================= */

/** A boulder. Flat-ish facets, moss on the top and shaded side. */
export function buildRock(b, { seed = 1, size = 0.8, lod = 0, mossy = 0.3, hex = GROUND.rock } = {}) {
  const r = makeRng(seed ^ 0x40cc);
  const rings = lod === 0 ? 5 : lod === 1 ? 4 : 3;
  const seg = lod === 0 ? 8 : lod === 1 ? 6 : 5;
  const base = tweak(hex, { h: r.range(-0.02, 0.02), l: r.range(0.82, 1.18) });
  const lumpy = lumpWarp(r, 5, 0.42);
  // `sy` used to reach as low as 0.45, which turned half the boulders into
  // green pancakes lying on the grass. A rock has to have a HEIGHT to read
  // as a rock rather than as a patch of moss.
  const sx = r.range(0.8, 1.35), sy = r.range(0.62, 1.05), sz = r.range(0.8, 1.35);
  const rot = r.range(0, TAU);
  const mossDir = r.range(0, TAU);

  blob(b, 0, 0, 0, size, rings, seg,
    (x, y, z) => {
      const m = lumpy(x, y, z);
      // faceting: push vertices toward a few flat planes so the silhouette
      // has edges. A smooth lump reads as a potato, not as stone.
      const facet = 1 + 0.10 * Math.sign(Math.sin(x * 4 + rot)) * Math.sign(Math.sin(z * 3.7));
      return [m * sx * facet, m * sy, m * sz * facet];
    }, 0,
    (x, y, z) => {
      let c = shade(base, (Math.sin(x * 7 + z * 5) * 0.5) * 0.12 + y * 0.10);
      if (mossy > 0.03) {
        // moss on top and on the shaded flank, never underneath
        const up = clamp(y, 0, 1);
        const side = 0.5 + 0.5 * Math.cos(Math.atan2(z, x) - mossDir);
        // patchy, and never total: bare stone showing through is what makes
        // the moss read as moss instead of as a paint job
        const patch = smoothstep((Math.sin(x * 5.3 + z * 4.1) * 0.5 + 0.5 - 0.45 + mossy * 0.55) * 3);
        const m = clamp((up * 0.85 + side * 0.4 - 0.25) * mossy * 1.8 * patch, 0, 0.72);
        c = mixHex(c, Math.sin(x * 11 + z * 9) > 0 ? MOSS.deep : MOSS.mid, m);
        if (m < 0.2 && mossy > 0.4) c = mixHex(c, MOSS.lichenPale, clamp(0.3 - m, 0, 1) * 0.5);
      }
      return c;
    });

  // a skirt of small stones at the base so it does not look dropped in
  if (lod === 0) {
    for (let i = 0; i < r.int(2, 5); i++) {
      const a = r.range(0, TAU), rad = size * r.range(0.7, 1.15);
      b.color(shade(base, r.range(-0.15, 0.1)), 0.08, r);
      blob(b, Math.cos(a) * rad, -size * sy * 0.55 + size * 0.06, Math.sin(a) * rad,
        size * r.range(0.10, 0.26), 3, 5, lumpWarp(r, 3, 0.4), 0);
    }
  }
}

/**
 * A fallen log: the big landmark of a forest floor, and the thing sticks and
 * mushrooms cluster around. Lies along +X with its centre at the origin.
 */
export function buildFallenLog(b, { seed = 1, len = 4, rad = 0.28, lod = 0, mossy = 0.6, species = 'oak' } = {}) {
  const r = makeRng(seed ^ 0x106e);
  const bark = tweak(species === 'birch' ? BARK.birch : species === 'pine' ? BARK.pine : BARK.oak,
    { h: r.range(-0.03, 0.03), l: r.range(0.8, 1.1) });
  const inner = species === 'birch' ? 0xd8c8a0 : 0xa8865c;
  const segs = lod === 0 ? 12 : lod === 1 ? 8 : 5;
  const radial = lod === 0 ? 8 : lod === 1 ? 6 : 4;
  const bend = r.range(-0.12, 0.12), bend2 = r.range(-0.1, 0.1);
  const rot = r.range(0, TAU);
  const rotten = r.pow(1.5);

  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    pts.push([(t - 0.5) * len, Math.sin(t * Math.PI) * len * bend2 * 0.15, Math.sin(t * 3 + rot) * len * bend * 0.3]);
  }

  tube(b, {
    pts,
    radius: t => rad * (1 - 0.35 * t) * (0.9 + 0.2 * Math.sin(t * 9 + rot)),
    radial,
    color: (t, i, ang) => {
      let c = shade(bark, Math.pow(Math.sin(ang * 5 + t * 12) * 0.5 + 0.5, 2) * -0.25 + 0.06);
      // bark falls off a rotting log in patches
      const strip = smoothstep((Math.sin(t * 7 + ang * 1.3 + rot) * 0.5 + 0.5 - 0.62 + rotten * 0.5) * 4);
      c = mixHex(c, mixHex(inner, BARK.deadWood, rotten * 0.6), strip * (0.3 + rotten * 0.6));
      // moss along the top
      const up = Math.cos(ang - Math.PI * 0.5);
      const m = clamp((up * 0.9 - 0.1) * mossy * 1.7, 0, 0.9) *
        smoothstep((Math.sin(t * 5.1 + 2) * 0.5 + 0.5 - 0.35 + mossy * 0.5) * 3);
      if (m > 0.02) c = mixHex(c, Math.sin(t * 23 + ang * 4) > 0 ? MOSS.deep : MOSS.bright, m);
      return c;
    },
    bump: lod === 0 ? (t, ang) => 1 + 0.06 * (Math.sin(ang * 6 + t * 12) * 0.5 + 0.5) : null,
    squash: t => [1, r.range(0.94, 0.96)],
    capStart: true, capEnd: true, sway: () => 0,
  });

  /* the sawn/broken ends, showing heartwood */
  for (const end of [0, 1]) {
    const p = pts[end === 0 ? 0 : pts.length - 1];
    const dir = end === 0 ? [-1, 0, 0] : [1, 0, 0];
    const rr = rad * (end === 0 ? 1 : 0.65);
    b.color(mixHex(inner, BARK.deadWood, rotten * 0.5), 0.07, r);
    const ring = [];
    for (let i = 0; i < radial; i++) {
      const a = (i / radial) * TAU;
      ring.push(b.vert(p[0] + dir[0] * rr * 0.1, p[1] + Math.cos(a) * rr * 0.92, p[2] + Math.sin(a) * rr * 0.92, 0));
    }
    const c0 = b.vert(p[0] + dir[0] * rr * 0.16, p[1], p[2], 0);
    const mark = b.mark;
    for (let i = 0; i < radial; i++) {
      const j = (i + 1) % radial;
      b.tri(c0, ring[i], ring[j]);
    }
    // the cap is a disc on the end of a log lying along X, so 'outward' is
    // simply away from the log's middle
    b.orientOutward(mark, 0, p[1], p[2]);
  }

  /* brackets, mushrooms and moss cushions along the top */
  if (lod === 0) {
    const nM = Math.round(mossy * r.int(2, 6));
    for (let i = 0; i < nM; i++) {
      const t = r.range(0.08, 0.92);
      const x = (t - 0.5) * len;
      const a = r.range(-1.1, 1.1) + Math.PI * 0.5;
      const rr = rad * (1 - 0.35 * t);
      const sub = new MeshBuilder();
      const R = rr * r.range(0.4, 0.85);
      sub.color(mixHex(MUSHROOM.bracketTop, MUSHROOM.bracketLip, r() * 0.7), 0.06, r);
      let prev = null;
      for (let k = 0; k <= 3; k++) {
        const u = k / 3;
        const row = [];
        for (let j = 0; j <= 6; j++) {
          const aa = -Math.PI * 0.5 + (j / 6) * Math.PI;
          row.push(sub.vert(Math.cos(aa) * R * u, (1 - u * u) * R * 0.2 - u * R * 0.08, Math.sin(aa) * R * u * 0.8, 0));
        }
        if (prev) for (let j = 0; j < 6; j++) sub.quad(prev[j], prev[j + 1], row[j + 1], row[j]);
        prev = row;
      }
      b.append(sub, orient([x, Math.sin(a) * rr, Math.cos(a) * rr], [0, Math.sin(a), Math.cos(a)], 0));
    }
    if (mossy > 0.4) {
      for (let i = 0; i < Math.round(mossy * 20); i++) {
        const t = r.range(0.02, 0.98);
        const a = Math.PI * 0.5 + r.bell() * 1.0;
        const rr = rad * (1 - 0.35 * t);
        b.color(mixHex(MOSS.deep, MOSS.bright, r.pow(1.4)), 0.10, r);
        blob(b, (t - 0.5) * len, Math.sin(a) * rr * 0.98, Math.cos(a) * rr * 0.98,
          rr * r.range(0.10, 0.25), 3, 5, (x, y, z) => [1, 0.45, 1], 0);
      }
    }
  }

  return { len, rad };
}

/** A stump, with roots and often a ring of fungi. */
export function buildStump(b, { seed = 1, rad = 0.4, h = 0.6, lod = 0, mossy = 0.5 } = {}) {
  const r = makeRng(seed ^ 0x57ff);
  const bark = tweak(BARK.oak, { l: r.range(0.8, 1.1) });
  const radial = lod === 0 ? 9 : 6;
  const jag = r.range(0.15, 0.55);

  const pts = [[0, 0, 0], [0, h * 0.55, 0], [r.bell() * h * 0.08, h, r.bell() * h * 0.08]];
  tube(b, {
    pts, radius: t => rad * (1 + 0.5 * Math.exp(-t * 8)) * (1 - t * 0.12), radial,
    color: (t, i, ang) => {
      let c = shade(bark, Math.pow(Math.sin(ang * 6) * 0.5 + 0.5, 2) * -0.28);
      const m = clamp((0.5 + 0.5 * Math.cos(ang - 2.2)) * (1 - t) * mossy * 1.6, 0, 0.7);
      return mixHex(c, MOSS.deep, m);
    },
    capStart: false, capEnd: false, sway: () => 0,
  });

  /* the broken top: concentric growth rings and a jagged rim */
  const top = pts[2];
  const rings = 4;
  let prev = null;
  for (let k = 0; k <= rings; k++) {
    const u = k / rings;
    b.color(mixHex(0xb49468, 0x8a6a44, (k % 2) * 0.55), 0.05, r);
    const row = [];
    for (let i = 0; i < radial; i++) {
      const a = (i / radial) * TAU;
      const rr = rad * 0.98 * u;
      const lift = k === rings ? Math.sin(a * 3 + r.range(0, 1)) * rad * jag * 0.35 : 0;
      row.push(b.vert(top[0] + Math.cos(a) * rr, top[1] + lift + (1 - u) * rad * 0.03, top[2] + Math.sin(a) * rr, 0));
    }
    // rings on the sawn top: settled by orienting them away from a point
    // inside the stump rather than by reasoning about the winding
    if (prev) {
      const m = b.mark;
      for (let i = 0; i < radial; i++) {
        const j = (i + 1) % radial;
        b.quad(prev[i], row[i], row[j], prev[j]);
      }
      b.orientOutward(m, top[0], top[1] - rad * 2, top[2]);
    }
    prev = row;
  }

  for (let i = 0; i < r.int(3, 6); i++) {
    const a = (i / 5) * TAU + r.range(-0.4, 0.4);
    const len = rad * r.range(1.6, 3.2);
    b.color(shade(bark, -0.12), 0.06, r);
    tube(b, {
      pts: [[0, rad * 0.35, 0], [Math.cos(a) * len * 0.5, rad * 0.12, Math.sin(a) * len * 0.5],
      [Math.cos(a) * len, -rad * 0.06, Math.sin(a) * len]],
      radius: t => rad * lerp(0.42, 0.06, t), radial: 4, capStart: false, capEnd: false, sway: () => 0,
    });
  }
  return { rad, h };
}

/** A tangle of loose brash and twigs — fills the gaps between bigger things. */
export function buildBrash(b, { seed = 1, size = 0.7, lod = 0 } = {}) {
  const r = makeRng(seed ^ 0xb7a5);
  const n = lod === 0 ? r.int(4, 9) : r.int(2, 4);
  for (let i = 0; i < n; i++) {
    const a = r.range(0, TAU);
    const len = size * r.range(0.4, 1.3);
    const y = size * r.range(0.01, 0.10);
    const tilt = r.range(-0.2, 0.35);
    const hex = mixHex(BARK.deadWood, r.chance(0.4) ? BARK.oak : BARK.hazel, r());
    b.color(hex, 0.12, r);
    const p0 = [Math.cos(a + 3.1) * len * 0.5, y, Math.sin(a + 3.1) * len * 0.5];
    const p1 = [Math.cos(a) * len * 0.5, y + tilt * len * 0.3, Math.sin(a) * len * 0.5];
    tube(b, {
      pts: [p0, [(p0[0] + p1[0]) / 2, y + r.range(0, 0.05), (p0[2] + p1[2]) / 2], p1],
      radius: t => size * r.range(0.012, 0.03) * (1 - t * 0.5), radial: 3,
      capStart: false, capEnd: false, sway: () => 0,
    });
  }
}
