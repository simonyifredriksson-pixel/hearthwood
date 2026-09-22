/* MapData.js — the fog of war, and what is under it.
   ===========================================================================
   The brief was specific: open the map for the first time and ONLY the
   starting village is on it. Everything else is dark, and it stays dark
   until the player has physically walked there.

   HOW THE FOG IS STORED. A bitset over a coarse grid of the world — 12 m
   cells, which is 150 x 150 for an 1800 m map, so 22,500 bits = 2.8 KB
   packed into a Uint32Array. That fits in a save comfortably, survives
   being JSON'd as an array of numbers, and is cheap enough to update every
   frame without thinking about it.

   THE REVEAL IS A DISC, not a cell. Standing still lights a circle around
   you, so a path through the wood reads as a corridor with soft edges
   rather than as a line of squares. The radius is bigger in the open than
   under canopy, because that is how far you can actually see.

   WHAT IS UNDER THE FOG is generated, not authored: the map layer samples
   the same Terrain the game is built from, so the coastline, the river,
   the mountains and the lakes on the map are the real ones.
*/

import { WORLD } from '../core/Config.js?v=1790102737';
import { VILLAGES } from '../data/VillageData.js?v=1790102737';
import { clamp, clamp01, lerp } from '../core/Util.js?v=1790102737';

/** Metres per fog cell. 12 is fine: the map is drawn at a few pixels a cell. */
export const FOG_CELL = 12;
export const FOG_N = Math.ceil((WORLD.half * 2) / FOG_CELL);

export class Fog {
  constructor(packed = null) {
    this.n = FOG_N;
    this.bits = new Uint32Array(Math.ceil((this.n * this.n) / 32));
    if (Array.isArray(packed) && packed.length) {
      const k = Math.min(packed.length, this.bits.length);
      for (let i = 0; i < k; i++) this.bits[i] = packed[i] >>> 0;
    } else {
      /* a brand-new map shows the home village and nothing else */
      const home = VILLAGES[0];
      this.reveal(home.x, home.z, home.core * 1.1);
    }
    this._count = -1;
  }

  _idx(cx, cz) { return cz * this.n + cx; }

  /** Cell coordinates for a world point. */
  cellOf(x, z) {
    return [
      clamp(Math.floor((x + WORLD.half) / FOG_CELL), 0, this.n - 1),
      clamp(Math.floor((z + WORLD.half) / FOG_CELL), 0, this.n - 1),
    ];
  }

  seenCell(cx, cz) {
    if (cx < 0 || cz < 0 || cx >= this.n || cz >= this.n) return false;
    const i = this._idx(cx, cz);
    return (this.bits[i >>> 5] & (1 << (i & 31))) !== 0;
  }

  seen(x, z) { const [cx, cz] = this.cellOf(x, z); return this.seenCell(cx, cz); }

  /**
   * Light a disc. Returns how many NEW cells were revealed, so the caller
   * can decide whether anything is worth saving.
   */
  reveal(x, z, radius) {
    const [cx, cz] = this.cellOf(x, z);
    const rc = Math.ceil(radius / FOG_CELL);
    const r2 = rc * rc;
    let added = 0;
    for (let j = -rc; j <= rc; j++) {
      for (let i = -rc; i <= rc; i++) {
        if (i * i + j * j > r2) continue;
        const ax = cx + i, az = cz + j;
        if (ax < 0 || az < 0 || ax >= this.n || az >= this.n) continue;
        const k = this._idx(ax, az);
        const w = k >>> 5, b = 1 << (k & 31);
        if (this.bits[w] & b) continue;
        this.bits[w] |= b;
        added++;
      }
    }
    if (added) this._count = -1;
    return added;
  }

  /** How much of the world has been walked, 0..1. */
  get explored() {
    if (this._count < 0) {
      let n = 0;
      for (let i = 0; i < this.bits.length; i++) {
        let v = this.bits[i];
        while (v) { v &= v - 1; n++; }
      }
      this._count = n;
    }
    return this._count / (this.n * this.n);
  }

  toJSON() { return Array.from(this.bits); }
}

/* ========================================================================= */
/* WHAT THE MAP DRAWS                                                        */
/* ========================================================================= */

/**
 * The terrain, sampled once into a small image the map can draw instantly.
 *
 * Built lazily the first time the map is opened and then kept: it is a
 * couple of hundred thousand height samples, which is a third of a second
 * once and nothing ever again. Opening a map should be instant, and a map
 * that samples the terrain live is not.
 */
export function buildMapImage(T, size = 260) {
  const px = new Uint8ClampedArray(size * size * 4);
  const step = (WORLD.half * 2) / size;
  const seaish = [];

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = -WORLD.half + (i + 0.5) * step;
      const z = -WORLD.half + (j + 0.5) * step;
      const h = T.height(x, z);
      const water = T.waterAt(x, z);
      const slope = T.slope(x, z, step * 0.5);

      let R, G, B;
      if (water !== null) {
        /* water: deeper is darker, and a lake reads bluer than the river */
        const d = clamp01((water - h) / 6);
        R = 92 - d * 44; G = 142 - d * 50; B = 176 - d * 36;
      } else {
        /* THE MAP HAS TO SHOW THE WOOD.
           The first version painted the whole of the land one pale olive
           and the map was a blank sheet with a river on it — you could not
           tell dense forest from open meadow, which is the single thing a
           player wants from it when deciding where to walk. Forest density
           is sampled from the same field the scatterer uses, so the dark
           green on the map is genuinely where the trees are. */
        const forest = clamp01(T.forestDensity ? T.forestDensity(x, z) : 0);
        const alt = clamp01((h - WORLD.village.datum) / 150);
        const rock = clamp01(slope * 3.0 + alt * 1.1 - 0.72);
        const snow = clamp01((alt - 0.78) * 4.0);

        /* meadow -> woodland. The curve matters: forest density is mostly
           low numbers with a few high ones, so a linear mix paints the
           whole map the colour of a field with a faint stain on it. */
        const f = Math.pow(forest, 0.62);
        R = lerp(212, 78, f);
        G = lerp(204, 112, f);
        B = lerp(152, 64, f);
        /* dry uplands bleach out before they turn to rock, but only a
           little — the first pass washed the entire map out to bone */
        R = lerp(R, 200, alt * 0.20);
        G = lerp(G, 192, alt * 0.20);
        B = lerp(B, 156, alt * 0.20);
        /* bare rock */
        R = lerp(R, 146, rock); G = lerp(G, 140, rock); B = lerp(B, 130, rock);
        /* snow, only on the very tops */
        R = lerp(R, 242, snow); G = lerp(G, 246, snow); B = lerp(B, 250, snow);

        /* HILLSHADE from the north-west. A flat-coloured map is a chart;
           the shading is what makes it read as country. It is deliberately
           strong — more than looks right on a single pixel — because at
           map scale each pixel is twelve metres and the relief is all the
           player has to navigate by. */
        const hx = T.height(x + step, z) - T.height(x - step, z);
        const hz = T.height(x, z + step) - T.height(x, z - step);
        const sh = clamp01(0.5 + (-hx - hz) / (step * 0.55));
        const k = 0.58 + sh * 0.78;
        R *= k; G *= k; B *= k;
      }
      const o = (j * size + i) * 4;
      px[o] = R; px[o + 1] = G; px[o + 2] = B; px[o + 3] = 255;
    }
  }
  return { px, size };
}

/** World point -> map-image pixel. */
export function worldToMap(x, z, size) {
  return [
    ((x + WORLD.half) / (WORLD.half * 2)) * size,
    ((z + WORLD.half) / (WORLD.half * 2)) * size,
  ];
}

/**
 * The things that get a symbol.
 *
 * A marker is only listed once its cell has been walked — the map is a
 * record of where the player has been, not a directory of what exists.
 */
export function mapMarkers(G) {
  const out = [];
  const fog = G.fog;
  for (const v of VILLAGES) {
    if (!fog.seen(v.x, v.z)) continue;
    out.push({ kind: 'village', x: v.x, z: v.z, label: v.name, id: v.id });
    const A = v.id === 'home'
      ? G.world?.anchors?.fishery
      : G.world?.anchors?.[`fishery:${v.id}`];
    if (A) out.push({ kind: 'fishing', x: A.x, z: A.z, label: `${v.name} booth` });
  }
  const sw = G.world?.anchors?.stickwright;
  if (sw && fog.seen(sw.x, sw.z)) {
    out.push({ kind: 'forge', x: sw.x, z: sw.z, label: 'The Stickwright' });
  }
  for (const camp of (G.workers?.camps || [])) {
    if (!fog.seen(camp.x, camp.z) || camp.cleared) continue;
    out.push({ kind: 'camp', x: camp.x, z: camp.z, label: 'a survey camp' });
  }
  return out;
}
