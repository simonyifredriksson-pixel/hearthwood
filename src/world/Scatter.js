/* Scatter.js — deciding what grows where, and building it.
   ===========================================================================
   Every plant, rock, log and mushroom in Hearthwood is placed by this file.
   Nothing is authored by hand and nothing is random at runtime: the contents
   of a square metre of forest are a pure function of its coordinates, so the
   wood is the same wood every time you walk back through it, and a tile can
   be thrown away and rebuilt without anything changing.

   PLACEMENT is a jittered grid, one grid per layer. For each cell, hash the
   cell coordinates to get a deterministic generator, jitter a point inside
   the cell, ask the terrain how dense this layer should be there, and keep
   the point if the roll succeeds. A jittered grid gives near-Poisson spacing
   for a fraction of the cost of real Poisson sampling, and — crucially — it
   is O(1) per cell with no global state, so tiles can be built in any order.

   THE LAYER SPACINGS are the important numbers. They set how the forest
   FEELS underfoot far more than any colour does: 9 m between big trees is a
   wood you walk through, 4 m is a thicket you push through.

   OUTPUT is merged geometry. A tile of forest with four hundred individually
   generated plants in it draws in two calls.
*/

import * as THREE from '../../lib/three.module.js?v=1790055608';
import { MeshBuilder } from '../art/Geo.js?v=1790055608';
import { buildTree, TREES, orient } from '../art/TreeGen.js?v=1790055608';
import {
  buildFern, buildBush, buildGrassTuft, buildFlower, buildMushrooms, buildReeds,
  buildWeed, buildGroundCover, buildRock, buildFallenLog, buildStump, buildBrash,
  FLOWER_NAMES, SHROOM_NAMES,
} from '../art/PlantGen.js';
import { PLANT, GROUND, LEAF, mixHex, tweak } from '../art/Palette.js?v=1790055608';
import { WORLD, GAME } from '../core/Config.js?v=1790055608';
import { makeRng, hash2, clamp, clamp01, lerp, TAU, smoothstep, invLerp } from '../core/Util.js?v=1790055608';
import { riverX, riverLevel } from './Terrain.js?v=1790055608';

/* ========================================================================= */
/* LAYERS                                                                    */
/* ========================================================================= */

/* `cell` is the grid spacing in metres — roughly the minimum distance between
   two of this thing. `salt` keeps each layer's hashes independent, so moving
   one layer's spacing does not reshuffle the others.

   THESE NUMBERS ARE A TRIANGLE BUDGET as much as a design choice. The first
   version used 2.9 m for ferns and 2.0 m for flowers, which put six hundred
   ferns and twelve hundred flowers in every hundred-metre tile and cost two
   million triangles for one tile of forest. Undergrowth is the cheapest
   thing to over-place and the most expensive thing to have over-placed. */
const LAYERS = {
  bigTree: { cell: 11.0, salt: 0x101 },
  tree: { cell: 7.0, salt: 0x102 },
  sapling: { cell: 5.0, salt: 0x103 },
  bush: { cell: 5.2, salt: 0x104 },
  fern: { cell: 4.5, salt: 0x105 },
  weed: { cell: 3.4, salt: 0x106 },
  flower: { cell: 3.2, salt: 0x107 },
  cover: { cell: 4.4, salt: 0x108 },
  mushroom: { cell: 6.5, salt: 0x109 },
  rock: { cell: 13.0, salt: 0x10a },
  pebble: { cell: 5.0, salt: 0x10b },
  log: { cell: 24.0, salt: 0x10c },
  stump: { cell: 30.0, salt: 0x10d },
  brash: { cell: 6.0, salt: 0x10e },
  reed: { cell: 3.6, salt: 0x10f },
  grass: { cell: 1.9, salt: 0x110 },
};

/** Which plant LODs a tile detail level uses. */
const DETAIL = [
  { plant: 0, tree: 0, grass: true, layers: null },                       // near
  { plant: 1, tree: 1, grass: false, layers: ['bigTree', 'tree', 'sapling', 'bush', 'fern', 'rock', 'log', 'stump', 'weed', 'reed'] },
  { plant: 2, tree: 2, grass: false, layers: ['bigTree', 'tree', 'bush', 'rock', 'log'] },
  { plant: 2, tree: 3, grass: false, layers: ['bigTree', 'tree'] },       // far silhouettes
];

/* ========================================================================= */
/* FIELD CACHE                                                               */
/* ========================================================================= */

/**
 * The terrain's field functions are expensive — each one is several octaves
 * of noise, and some of them call the others. Placement asks them thousands
 * of times per tile at points a metre apart, which is far finer than the
 * fields actually vary.
 *
 * So each tile samples them onto a coarse grid once and interpolates. This
 * is the single biggest performance decision in the world builder: it took a
 * near tile from 770 ms to well under a hundred.
 */
export class Fields {
  constructor(T, x0, z0, size, step = 4, hStep = 2) {
    this.T = T;
    this.x0 = x0 - step; this.z0 = z0 - step;
    this.step = step;
    this.n = Math.ceil((size + step * 2) / step) + 1;
    const n = this.n;

    this.forest = new Float32Array(n * n);
    this.wet = new Float32Array(n * n);
    this.slope = new Float32Array(n * n);
    this.vill = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = this.x0 + i * step, z = this.z0 + j * step;
        const k = j * n + i;
        this.forest[k] = T.forestDensity(x, z);
        this.wet[k] = T.wetness(x, z);
        this.slope[k] = T.slope(x, z, 2);
        this.vill[k] = T.villageness(x, z);
      }
    }

    /* height is sampled finer, because things stand ON it */
    this.hStep = hStep;
    this.hx0 = x0 - hStep; this.hz0 = z0 - hStep;
    this.hn = Math.ceil((size + hStep * 2) / hStep) + 1;
    this.h = new Float32Array(this.hn * this.hn);
    for (let j = 0; j < this.hn; j++) {
      for (let i = 0; i < this.hn; i++) {
        this.h[j * this.hn + i] = T.height(this.hx0 + i * hStep, this.hz0 + j * hStep);
      }
    }
  }

  _bi(arr, n, ox, oz, step, x, z) {
    const u = (x - ox) / step, v = (z - oz) / step;
    const i = clamp(Math.floor(u), 0, n - 2), j = clamp(Math.floor(v), 0, n - 2);
    const fu = clamp01(u - i), fv = clamp01(v - j);
    const a = arr[j * n + i], b = arr[j * n + i + 1];
    const c = arr[(j + 1) * n + i], d = arr[(j + 1) * n + i + 1];
    return lerp(lerp(a, b, fu), lerp(c, d, fu), fv);
  }

  forestAt(x, z) { return this._bi(this.forest, this.n, this.x0, this.z0, this.step, x, z); }
  wetAt(x, z) { return this._bi(this.wet, this.n, this.x0, this.z0, this.step, x, z); }
  slopeAt(x, z) { return this._bi(this.slope, this.n, this.x0, this.z0, this.step, x, z); }
  villAt(x, z) { return this._bi(this.vill, this.n, this.x0, this.z0, this.step, x, z); }
  heightAt(x, z) { return this._bi(this.h, this.hn, this.hx0, this.hz0, this.hStep, x, z); }

  /** Surface normal from the sampled height grid — no extra terrain calls. */
  normalAt(x, z) {
    const e = this.hStep;
    const nx = this.heightAt(x - e, z) - this.heightAt(x + e, z);
    const nz = this.heightAt(x, z - e) - this.heightAt(x, z + e);
    const ny = 2 * e;
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  }
}

/* ========================================================================= */
/* GLADES                                                                    */
/* ========================================================================= */

/**
 * HOW OPEN IT IS HERE, 0 (a clearing) .. 1 (full thickness).
 *
 * The wood was too tightly packed, but the fix was explicitly NOT to thin
 * it out everywhere — an evenly thinned forest is a car park with trees
 * in it. What was wanted was the same density arranged with gaps:
 *
 *     before   ||||||||||||||||||||
 *     after    |||||  ||||||  |||||  ||||
 *
 * So this is a low-frequency field, sampled at two scales, that mostly
 * sits near 1 and occasionally dives. Where it dives you get a clearing
 * with a soft edge; everywhere else the wood is as thick as it ever was.
 * Big trees are affected less than small ones, because a clearing in real
 * woodland is defined by the absence of canopy rather than by bare earth,
 * and leaving the odd standard in the middle of a glade is what stops it
 * reading as a crop circle.
 *
 * Two octaves at 74 m and 31 m: the first makes the glade, the second
 * stops its edge being a circle.
 */
export function gladeAt(x, z) {
  /* 46 m and 19 m. The first pass used 74 m and opened clearings two
     hundred metres across, which is a meadow with a wood round it — a
     glade you can see the far side of is the right size. */
  const a = smoothNoise(x / 46, z / 46, 0x91ad);
  const b = smoothNoise(x / 19, z / 19, 0x5c0f);
  const n = a * 0.70 + b * 0.30;
  /* THE FLOOR IS 0.34, NOT ZERO. A clearing still keeps a third of its
     trees; what makes it read as a clearing is that the canopy opens,
     not that the ground is swept. And the band is narrow, so only the
     bottom of the noise range opens at all — the brief asked for a
     slight reduction, and the first attempt cut the wood by 29%. */
  return clamp01(0.34 + 0.66 * smoothstep(clamp01((n - 0.20) / 0.24)));
}

/** Value noise with a smooth interpolant, on the shared hash.
 *  `hash2` hands back a raw uint32, NOT a unit float — using it directly
 *  made every sample saturate and the whole field came out flat at 1. */
const U32 = 4294967296;
function smoothNoise(u, v, salt) {
  const i = Math.floor(u), j = Math.floor(v);
  const fu = u - i, fv = v - j;
  const su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv);
  const h = (a, b) => hash2(a, b, salt) / U32;
  return lerp(lerp(h(i, j), h(i + 1, j), su), lerp(h(i, j + 1), h(i + 1, j + 1), su), sv);
}

/* ========================================================================= */
/* SCATTER                                                                   */
/* ========================================================================= */

/**
 * Walk one layer's grid over a rectangle and call `fn` for each accepted
 * point. `chance(x, z, rng)` returns 0..1.
 */
function grid(layer, x0, z0, x1, z1, chance, fn) {
  const L = LAYERS[layer];
  const c = L.cell;
  const i0 = Math.floor(x0 / c), i1 = Math.floor(x1 / c);
  const j0 = Math.floor(z0 / c), j1 = Math.floor(z1 / c);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const h = hash2(i, j, L.salt);
      const r = makeRng(h);
      // jitter inside the cell, but not right to the edge: points that can
      // land on a cell boundary can land arbitrarily close to a neighbour's
      const x = (i + 0.15 + r() * 0.7) * c;
      const z = (j + 0.15 + r() * 0.7) * c;
      if (x < x0 || x >= x1 || z < z0 || z >= z1) continue;
      const p = chance(x, z, r);
      if (p <= 0 || r() > p) continue;
      fn(x, z, r, h);
    }
  }
}

/**
 * Build one tile of world detail.
 *
 * @param {Terrain} T
 * @param {number} tx, tz   tile indices
 * @param {number} detail   0 near .. 3 far
 * @returns {{flora, solid, glow, grass, blockers, count}}
 */
/* A full-detail tile takes about a tenth of a second to generate, and a
   tenth of a second is a hitch you can feel. So the work is split in two and
   the streamer builds each half on a different frame:

     PASS A  the things that have volume and cast shadows — trees, bushes,
             logs, stumps, rocks. `claimed` is built here, so the bushes can
             still thin out under the big canopies.
     PASS B  the floor — ferns, weeds, flowers, ground cover, mushrooms,
             brash, pebbles, reeds and grass.

   Neither half is worth looking at alone, but they arrive one frame apart. */
export const SCATTER_PASS_A = ['bigTree', 'tree', 'sapling', 'bush', 'log', 'stump', 'rock'];
export const SCATTER_PASS_B = ['fern', 'weed', 'flower', 'cover', 'mushroom', 'brash', 'pebble', 'reed'];

export function scatterTile(T, tx, tz, detail, tileSize = WORLD.tile, only = null) {
  const D = DETAIL[clamp(detail, 0, 3)];
  const onlySet = only ? new Set(only) : null;
  const size = tileSize;
  const x0 = tx * size, z0 = tz * size;
  const x1 = x0 + size, z1 = z0 + size;

  const F = new Fields(T, x0, z0, size, detail === 0 ? 4 : 8, detail === 0 ? 2 : 6);

  const flora = new MeshBuilder();
  const solid = new MeshBuilder();
  const glow = new MeshBuilder();
  const grass = new MeshBuilder();
  const blockers = [];
  let count = 0;

  const want = name => (!D.layers || D.layers.includes(name)) && (!onlySet || onlySet.has(name));

  /* Local helper: place a sub-builder at (x, z) on the ground, with a yaw and
     an optional tilt to match the slope. Everything on the floor tilts a
     little with the ground under it — a mushroom standing bolt upright on a
     bank is one of those small wrongnesses you feel without seeing. */
  /**
   * NOTHING GROWS IN A LAKE.
   *
   * The scatterer has always known about the river — every layer checks the
   * distance to the centreline — but lakes did not exist when it was
   * written, so the eight new villages got oaks and pines planted across
   * the middle of their water. One test at the point of placement covers
   * every layer at once, including the ones added later, which is why it
   * lives in `put` rather than in thirteen separate weight functions.
   */
  const inLake = (x, z) => {
    for (const L of T.lakes) {
      if (Math.hypot(x - L.x, z - L.z) > L.r * 1.05) continue;
      if (F.heightAt(x, z) < L.level + 0.35) return true;
    }
    return false;
  };

  const put = (target, sub, x, z, yaw, tiltAmount = 0, yOff = 0, scale = 1) => {
    if (T.lakes.length && inLake(x, z)) return;
    const y = F.heightAt(x, z) + yOff;
    let m;
    if (tiltAmount > 0) {
      const n = F.normalAt(x, z);
      const up = [lerp(0, n[0], tiltAmount), lerp(1, n[1], tiltAmount), lerp(0, n[2], tiltAmount)];
      m = orient([x - x0, y, z - z0], up, yaw);
      if (scale !== 1) m.scale(new THREE.Vector3(scale, scale, scale));
    } else {
      m = new THREE.Matrix4().compose(
        new THREE.Vector3(x - x0, y, z - z0),
        new THREE.Quaternion().setFromAxisAngle(UP, yaw),
        new THREE.Vector3(scale, scale, scale),
      );
    }
    target.append(sub, m);
    count++;
  };

  /* ------------------------------------------------------------- TREES --- */

  /* Big trees first, and they claim ground: everything placed afterwards can
     see the blocker list and keep out from under them, which is how you get
     the open floor under a big canopy that a real wood has. */
  const claimed = [];

  if (want('bigTree')) {
    grid('bigTree', x0, z0, x1, z1, (x, z, r) => {
      const d = F.forestAt(x, z);
      if (d < 0.22) return 0;
      if (F.slopeAt(x, z) > 0.44) return 0;
      /* big trees are the minority even in thick wood, and a glade thins
         them only a little — a standard left in an open patch is what
         makes the patch read as a clearing rather than as a hole */
      return clamp01((d - 0.22) * 1.25) * 0.55 * lerp(0.55, 1, gladeAt(x, z));
    }, (x, z, r, h) => {
      const species = pickSpecies(T, x, z, r, 'big');
      const sub = new MeshBuilder();
      const alt = F.heightAt(x, z) - WORLD.village.datum;
      const info = buildTree(sub, {
        species, seed: h, lod: D.tree,
        scale: r.range(0.55, 1.0) * clamp(1 - alt / 260, 0.5, 1),
        mossy: F.wetAt(x, z) * 0.8 + clamp01(F.forestAt(x, z) * 1.15 - 0.08) * 0.5,
        autumn: autumnAt(T, x, z, r),
      });
      put(flora, sub, x, z, r.range(0, TAU), 0.12);
      blockers.push({ x, z, r: Math.max(0.35, info.trunkR * 1.5) });
      claimed.push({ x, z, r: info.canopyR * 0.5 });
    });
  }

  if (want('tree')) {
    grid('tree', x0, z0, x1, z1, (x, z, r) => {
      const d = F.forestAt(x, z);
      if (d < 0.10) return 0;
      if (F.slopeAt(x, z) > 0.50) return 0;
      /* 0.75 -> 0.66 is the slight overall trim the brief asked for; the
         glade term is what turns that trim into clearings instead of an
         evenly thinner wood everywhere */
      return clamp01(d * 1.15) * 0.66 * gladeAt(x, z) * shadeOut(claimed, x, z, 0.45);
    }, (x, z, r, h) => {
      const species = pickSpecies(T, x, z, r, 'mid');
      const sub = new MeshBuilder();
      const info = buildTree(sub, {
        species, seed: h, lod: D.tree, scale: r.range(0.18, 0.62),
        mossy: F.wetAt(x, z) * 0.8 + clamp01(F.forestAt(x, z) * 1.15 - 0.08) * 0.5,
        autumn: autumnAt(T, x, z, r),
        dead: r.chance(0.035),
      });
      put(flora, sub, x, z, r.range(0, TAU), 0.16);
      blockers.push({ x, z, r: Math.max(0.28, info.trunkR * 1.5) });
    });
  }

  if (want('sapling')) {
    grid('sapling', x0, z0, x1, z1, (x, z, r) => {
      const d = F.forestAt(x, z);
      if (F.slopeAt(x, z) > 0.55) return 0;
      // saplings crowd the EDGES of a wood and the gaps in it, not the deep
      // shade under a closed canopy, where nothing gets enough light
      const edge = 1 - Math.abs(d - 0.42) * 2.2;
      /* AND THEY LOVE A GLADE. Saplings go UP where the canopy opens —
         the light is the whole reason they are there — so the glade term
         is inverted here. A clearing therefore fills with knee-high
         growth rather than becoming bare ground, which is what keeps the
         thinned wood from reading as empty. */
      const open = 1 - gladeAt(x, z);
      return clamp01(edge) * 0.55 * (1 + open * 1.5);
    }, (x, z, r, h) => {
      const species = pickSpecies(T, x, z, r, 'small');
      const sub = new MeshBuilder();
      buildTree(sub, {
        species, seed: h, lod: Math.min(3, D.tree + 1), scale: r.range(0.03, 0.22),
        mossy: F.wetAt(x, z) * 0.5, autumn: autumnAt(T, x, z, r),
      });
      put(flora, sub, x, z, r.range(0, TAU), 0.2);
    });
  }

  /* ------------------------------------------------------ DEAD WOOD ----- */

  if (want('log')) {
    grid('log', x0, z0, x1, z1, (x, z, r) => {
      const d = F.forestAt(x, z);
      if (d < 0.30) return 0;
      if (F.slopeAt(x, z) > 0.35) return 0;
      if (F.villAt(x, z) > 0.2) return 0;
      return clamp01(d - 0.2) * 0.85;
    }, (x, z, r, h) => {
      const sub = new MeshBuilder();
      const len = r.range(2.6, 7.5);
      buildFallenLog(sub, {
        seed: h, len, rad: r.range(0.16, 0.42), lod: D.plant,
        mossy: clamp01(F.wetAt(x, z) * 1.1 + clamp01(F.forestAt(x, z) * 1.15 - 0.08) * 0.5),
        species: T.grove(x, z),
      });
      const yaw = r.range(0, TAU);
      put(solid, sub, x, z, yaw, 0.55, r.range(0.05, 0.16));
      // a fallen log is a wall you walk round, so it needs blockers along it
      for (let k = -1; k <= 1; k++) {
        blockers.push({
          x: x + Math.cos(yaw) * k * len * 0.33,
          z: z - Math.sin(yaw) * k * len * 0.33,
          r: 0.45, low: true,
        });
      }
      claimed.push({ x, z, r: len * 0.4 });
    });
  }

  if (want('stump')) {
    grid('stump', x0, z0, x1, z1, (x, z, r) => {
      const d = F.forestAt(x, z);
      if (d < 0.25) return 0;
      if (F.villAt(x, z) > 0.2) return 0;
      return clamp01(d - 0.15) * 0.6;
    }, (x, z, r, h) => {
      const sub = new MeshBuilder();
      buildStump(sub, {
        seed: h, rad: r.range(0.22, 0.55), h: r.range(0.25, 0.9), lod: D.plant,
        mossy: clamp01(F.wetAt(x, z) + clamp01(F.forestAt(x, z) * 1.15 - 0.08) * 0.6),
      });
      put(solid, sub, x, z, r.range(0, TAU), 0.5);
      blockers.push({ x, z, r: 0.5, low: true });
    });
  }

  if (want('brash')) {
    grid('brash', x0, z0, x1, z1, (x, z, r) => {
      const d = F.forestAt(x, z);
      if (F.villAt(x, z) > 0.3) return 0;
      return clamp01(d - 0.12) * 0.42;
    }, (x, z, r, h) => {
      const sub = new MeshBuilder();
      buildBrash(sub, { seed: h, size: r.range(0.4, 1.1), lod: D.plant });
      put(solid, sub, x, z, r.range(0, TAU), 0.75, 0.01);
    });
  }

  /* ----------------------------------------------------------- STONE ---- */

  if (want('rock')) {
    grid('rock', x0, z0, x1, z1, (x, z, r) => {
      const slope = F.slopeAt(x, z);
      const alt = F.heightAt(x, z) - WORLD.village.datum;
      const bank = Math.abs(x - riverX(z)) < WORLD.river.bankWidth * 2 ? 0.5 : 0;
      // Nothing wild grows or lies inside the village. Rocks, logs and stumps
      // are driven by slope and altitude rather than by canopy, so unlike the
      // trees they do NOT get cleared by the forest mask — which is how a
      // boulder ended up sitting in the middle of the Stickwright's shop.
      const vill = F.villAt(x, z);
      if (vill > 0.25) return 0;
      // rock comes out where the soil is thin: slopes, heights and riverbeds
      return clamp01(slope * 1.6 + alt / 260 + bank - 0.12) * 0.7 * (1 - vill);
    }, (x, z, r, h) => {
      const sub = new MeshBuilder();
      const size = r.range(0.35, 2.4) * (1 + r.pow(3) * 1.8);
      buildRock(sub, {
        seed: h, size, lod: D.plant,
        mossy: clamp01(F.wetAt(x, z) * 0.9 + clamp01(F.forestAt(x, z) * 1.15 - 0.08) * 0.55),
        hex: F.heightAt(x, z) - WORLD.village.datum > 90 ? GROUND.rockDark : GROUND.rock,
      });
      put(solid, sub, x, z, r.range(0, TAU), 0.35, -size * 0.32);
      if (size > 0.7) blockers.push({ x, z, r: size * 0.75 });
    });
  }

  if (want('pebble') && D.plant === 0) {
    grid('pebble', x0, z0, x1, z1, (x, z, r) => {
      const bank = 1 - smoothstep(invLerp(WORLD.river.width, WORLD.river.bankWidth * 2.1, Math.abs(x - riverX(z))));
      return clamp01(F.slopeAt(x, z) * 1.2 + bank * 0.9 - 0.08) * 0.5 * (1 - F.villAt(x, z) * 0.85);
    }, (x, z, r, h) => {
      const sub = new MeshBuilder();
      const size = r.range(0.05, 0.19);
      buildRock(sub, { seed: h, size, lod: 2, mossy: F.wetAt(x, z) * 0.35, hex: GROUND.gravel });
      put(solid, sub, x, z, r.range(0, TAU), 0.8, -size * 0.45);
    });
  }

  /* ------------------------------------------------------ UNDERGROWTH --- */

  if (want('bush')) {
    grid('bush', x0, z0, x1, z1, (x, z, r) => {
      const d = F.forestAt(x, z);
      if (F.slopeAt(x, z) > 0.5) return 0;
      // thickest at the wood's edge, thinner in deep shade and open meadow
      const edge = 1 - Math.abs(d - 0.5) * 1.6;
      return clamp01(edge * 0.9 + d * 0.25) * 0.65 * shadeOut(claimed, x, z, 0.55)
        * (1 - F.villAt(x, z) * 0.9);
    }, (x, z, r, h) => {
      const sub = new MeshBuilder();
      const wet = F.wetAt(x, z);
      const bramble = r.chance(0.28);
      buildBush(sub, {
        seed: h, size: r.range(0.45, 1.5), lod: D.plant,
        hex: bramble ? PLANT.bramble : mixHex(PLANT.bush, PLANT.bushDry, r() * (1 - wet)),
        thorny: bramble,
        berry: bramble && r.chance(0.5) ? 0x2a1a30 : null,
        flower: !bramble && r.chance(0.18) ? [PLANT.flowerWhite, PLANT.flowerYellow, PLANT.flowerPink][r.int(0, 2)] : null,
      });
      put(flora, sub, x, z, r.range(0, TAU), 0.3);
      blockers.push({ x, z, r: 0.5, soft: true });
    });
  }

  if (want('fern')) {
    grid('fern', x0, z0, x1, z1, (x, z, r) => {
      const d = F.forestAt(x, z);
      const wet = F.wetAt(x, z);
      if (F.slopeAt(x, z) > 0.55) return 0;
      // ferns want shade AND damp: the two together, not either alone
      return clamp01(d * 0.9 + wet * 0.5 - 0.18) * 0.75;
    }, (x, z, r, h) => {
      const sub = new MeshBuilder();
      buildFern(sub, {
        seed: h, size: r.range(0.32, 0.95), lod: D.plant,
        dry: clamp01(1 - F.wetAt(x, z) * 1.6) * r(),
      });
      put(flora, sub, x, z, r.range(0, TAU), 0.35);
    });
  }

  if (want('weed')) {
    grid('weed', x0, z0, x1, z1, (x, z, r) => {
      const d = F.forestAt(x, z);
      if (F.slopeAt(x, z) > 0.6) return 0;
      return clamp01(0.55 - d * 0.35 + F.wetAt(x, z) * 0.35) * 0.6;
    }, (x, z, r, h) => {
      const sub = new MeshBuilder();
      buildWeed(sub, {
        seed: h, size: r.range(0.22, 0.6), lod: D.plant,
        hex: r.chance(0.5) ? PLANT.nettle : PLANT.fernPale,
      });
      put(flora, sub, x, z, r.range(0, TAU), 0.4);
    });
  }

  if (want('flower') && D.plant <= 1) {
    grid('flower', x0, z0, x1, z1, (x, z, r) => {
      const d = F.forestAt(x, z);
      const slope = F.slopeAt(x, z);
      if (slope > 0.55) return 0;
      // meadow flowers in the open, woodland flowers in the shade, and a
      // thin scatter everywhere between
      const open = clamp01(1 - d * 1.5);
      const vill = F.villAt(x, z);
      return clamp01(open * 0.55 + d * 0.16 + vill * 0.3) * 0.62;
    }, (x, z, r, h) => {
      const sub = new MeshBuilder();
      buildFlower(sub, {
        seed: h, kind: pickFlower(T, x, z, r), lod: D.plant, scale: r.range(0.75, 1.35),
      });
      put(flora, sub, x, z, r.range(0, TAU), 0.3);
    });
  }

  if (want('cover') && D.plant === 0) {
    grid('cover', x0, z0, x1, z1, (x, z, r) => {
      if (F.slopeAt(x, z) > 0.5) return 0;
      return clamp01(F.forestAt(x, z) * 0.7 + 0.15) * 0.5;
    }, (x, z, r, h) => {
      const sub = new MeshBuilder();
      buildGroundCover(sub, {
        seed: h, size: r.range(0.22, 0.5), lod: D.plant,
        hex: mixHex(0x5f8a3a, LEAF.shade, r() * 0.5),
        flower: r.chance(0.3) ? PLANT.cloverFlower : null,
      });
      put(flora, sub, x, z, r.range(0, TAU), 0.5);
    });
  }

  if (want('mushroom') && D.plant <= 1) {
    grid('mushroom', x0, z0, x1, z1, (x, z, r) => {
      const d = F.forestAt(x, z);
      const wet = F.wetAt(x, z);
      if (d < 0.18) return 0;
      // mushrooms cluster near dead wood, which `claimed` happens to be full
      // of — so a ring of toadstools round a fallen log comes out for free
      const nearWood = nearAny(claimed, x, z, 3.5) ? 1.9 : 1;
      return clamp01(d * 0.5 + wet * 0.55 - 0.22) * 0.5 * nearWood * (1 - F.villAt(x, z) * 0.85);
    }, (x, z, r, h) => {
      const sub = new MeshBuilder();
      const remote = T.remoteness(x, z);
      const kind = (remote > 0.55 && r.chance(0.10)) ? 'glowcap'
        : SHROOM_NAMES[r.int(0, SHROOM_NAMES.length - 2)];
      buildMushrooms(sub, {
        seed: h, kind, lod: D.plant, scale: r.range(0.7, 1.6),
        glow: kind === 'glowcap' ? glow : null,
      });
      put(kind === 'glowcap' ? glow : flora, sub, x, z, r.range(0, TAU), 0.45);
    });
  }

  if (want('reed') && D.plant <= 1) {
    grid('reed', x0, z0, x1, z1, (x, z, r) => {
      const lvl = riverLevel(z);
      const h = F.heightAt(x, z);
      const ro = Math.abs(x - riverX(z));
      // reeds stand in the shallows: just above the waterline, not on dry land
      if (ro > WORLD.river.bankWidth * 1.8) return 0;
      const band = 1 - smoothstep(Math.abs(h - lvl) / 0.85);
      return band * 0.85;
    }, (x, z, r, h) => {
      const sub = new MeshBuilder();
      buildReeds(sub, { seed: h, size: r.range(0.7, 1.6), lod: D.plant });
      put(flora, sub, x, z, r.range(0, TAU), 0.15, -0.1);
    });
  }

  /* ----------------------------------------------------------- GRASS ---- */

  if (D.grass && (!onlySet || onlySet.has('grass'))) {
    grid('grass', x0, z0, x1, z1, (x, z, r) => {
      const slope = F.slopeAt(x, z);
      if (slope > 0.55) return 0;
      const d = F.forestAt(x, z);
      const wet = F.wetAt(x, z);
      const path = T.pathInfluence(x, z);
      // grass thins under a closed canopy and stops dead on a path
      return clamp01((1 - d * 0.75) * (0.55 + wet * 0.5) - path * 1.4) * 0.92;
    }, (x, z, r, h) => {
      const sub = new MeshBuilder();
      const lush = F.wetAt(x, z);
      buildGrassTuft(sub, {
        seed: h, size: r.range(0.16, 0.46) * (0.7 + lush * 0.7), lod: 0,
        dry: clamp01(1 - lush * 2) * r.range(0.3, 1),
      });
      put(grass, sub, x, z, r.range(0, TAU), 0.55);
    });
  }

  return { flora, solid, glow, grass, blockers, count };
}

/* ========================================================================= */
/* CHOICES                                                                   */
/* ========================================================================= */

const UP = new THREE.Vector3(0, 1, 0);

/** Most trees are the grove's species; a minority are not, which is what
 *  stops a wood of oak looking like a plantation. */
function pickSpecies(T, x, z, r, size) {
  const grove = T.grove(x, z);
  const alt = T.height(x, z) - WORLD.village.datum;
  if (r.chance(0.72) && TREES[grove]) {
    if (size === 'big' && (grove === 'hazel' || grove === 'blackthorn')) return r.chance(0.5) ? 'oak' : 'ash';
    return grove;
  }
  if (alt > 90) return r.chance(0.6) ? 'spruce' : 'pine';
  if (size === 'big') return r.pick(['oak', 'ash', 'pine', 'birch', 'oak', 'spruce']);
  if (size === 'small') return r.pick(['hazel', 'rowan', 'blackthorn', 'elder', 'birch', 'hazel']);
  return r.pick(['oak', 'birch', 'hazel', 'rowan', 'pine', 'elder', 'willow']);
}

function pickFlower(T, x, z, r) {
  const d = T.forestDensity(x, z);
  const wet = T.wetness(x, z);
  const alt = T.height(x, z) - WORLD.village.datum;
  if (alt > 70) return r.pick(['heather', 'heather', 'yarrow']);
  if (d > 0.5) return r.pick(['bluebell', 'violet', 'foxglove', 'bluebell']);
  if (wet > 0.6) return r.pick(['campion', 'clover', 'buttercup']);
  return r.pick(['daisy', 'buttercup', 'clover', 'poppy', 'cornflower', 'yarrow', 'marigold', 'daisy']);
}

/** Autumn creeps in from the high ground and the exposed edges first. */
function autumnAt(T, x, z, r) {
  const alt = T.height(x, z) - WORLD.village.datum;
  const exposure = 1 - T.forestDensity(x, z);
  return clamp01((alt / 220 + exposure * 0.22 - 0.06) * r.range(0.5, 1.5)) * 0.65;
}

/** Suppress a layer under things that already claimed ground. */
function shadeOut(claimed, x, z, strength) {
  let f = 1;
  for (const c of claimed) {
    const d = Math.hypot(x - c.x, z - c.z);
    if (d < c.r) f *= lerp(1, 1 - strength, 1 - d / c.r);
  }
  return f;
}

function nearAny(list, x, z, rad) {
  for (const c of list) {
    const dx = x - c.x, dz = z - c.z;
    if (dx * dx + dz * dz < rad * rad) return true;
  }
  return false;
}

/* ========================================================================= */
/* STICKS                                                                    */
/* ========================================================================= */

/* Sticks are NOT part of the merged tile: they are individually pickable, so
   each live one is its own mesh. What lives here is only the decision about
   WHERE they are, which has to be deterministic and cheap enough to run over
   a hundred-metre radius every time the player moves a few steps. */

const STICK_CELL = 5.5;
const STICK_SALT = 0x57ec;

/**
 * Every stick slot whose cell centre falls within `radius` of (cx, cz).
 * @returns {Array<{key:string, x:number, z:number, seed:number, ci:number, cj:number}>}
 */
export function stickSlots(T, cx, cz, radius) {
  const out = [];
  const i0 = Math.floor((cx - radius) / STICK_CELL), i1 = Math.floor((cx + radius) / STICK_CELL);
  const j0 = Math.floor((cz - radius) / STICK_CELL), j1 = Math.floor((cz + radius) / STICK_CELL);
  const r2 = radius * radius;

  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const h = hash2(i, j, STICK_SALT);
      const r = makeRng(h);
      const x = (i + 0.1 + r() * 0.8) * STICK_CELL;
      const z = (j + 0.1 + r() * 0.8) * STICK_CELL;
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz > r2) continue;

      const p = stickChance(T, x, z);
      if (p <= 0 || r() > p) continue;

      out.push({ key: `${i},${j}`, x, z, seed: h, ci: i, cj: j });
    }
  }
  return out;
}

/**
 * How likely a stick is to be lying here. Wood falls from trees, so this is
 * mostly canopy cover — but it is deliberately non-zero in the open, because
 * a player who walks into a meadow and finds NOTHING learns to stop looking.
 */
export function stickChance(T, x, z) {
  const d = T.forestDensity(x, z);
  const slope = T.slope(x, z, 2);
  if (slope > 0.55) return 0;
  const water = T.waterAt(x, z);
  if (water !== null) return 0;
  // the village is swept and the firewood is collected
  const vill = T.villageness(x, z);
  return clamp01(d * 1.15 + 0.12 - vill * 1.3) * 0.88;
}

/** The context a stick rolled at this spot should be rolled with. */
export function stickContext(T, x, z) {
  return {
    remoteness: T.remoteness(x, z),
    wet: T.wetness(x, z),
    shade: T.shade(x, z),
    grove: T.grove(x, z),
    altitude: T.height(x, z) - WORLD.village.datum,
  };
}
