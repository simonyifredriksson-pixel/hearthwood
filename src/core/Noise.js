/* Noise.js — the shape of the land.
   ===========================================================================
   Everything about the terrain, where forests thicken, where mud gives way to
   moss, and how dense the undergrowth is comes out of these functions. They
   are all deterministic from a seed, so Hearthwood is the same world every
   time you load it — the same crooked oak on the same hill.

   Gradient (Perlin-style) noise rather than value noise, because value noise
   has a visible grid: hills line up with the axes and you can *see* the
   lattice in a wide shot of the forest. Gradient noise costs a few more
   multiplies and has no such tell.
*/

import { lerp, smootherstep } from './Util.js?v=1790102737';

const GRAD2 = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071],
  [0.9239, 0.3827], [-0.9239, 0.3827], [0.9239, -0.3827], [-0.9239, -0.3827],
  [0.3827, 0.9239], [-0.3827, 0.9239], [0.3827, -0.9239], [-0.3827, -0.9239],
];

export class Noise2D {
  constructor(seed = 1337) {
    // a 512-entry permutation, doubled so index wrapping is a mask not a mod
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    let s = (seed >>> 0) || 1;
    const rnd = () => {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
    for (let i = 255; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0;
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  /** Gradient noise in roughly [-1, 1]. */
  noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const P = this.perm;

    const g00 = GRAD2[P[(P[X] + Y) & 255] & 15];
    const g10 = GRAD2[P[(P[X + 1] + Y) & 255] & 15];
    const g01 = GRAD2[P[(P[X] + Y + 1) & 255] & 15];
    const g11 = GRAD2[P[(P[X + 1] + Y + 1) & 255] & 15];

    const n00 = g00[0] * xf + g00[1] * yf;
    const n10 = g10[0] * (xf - 1) + g10[1] * yf;
    const n01 = g01[0] * xf + g01[1] * (yf - 1);
    const n11 = g11[0] * (xf - 1) + g11[1] * (yf - 1);

    const u = smootherstep(xf), v = smootherstep(yf);
    return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) * 1.4;
  }

  /** Same, remapped to [0,1]. */
  n01(x, y) { return this.noise(x, y) * 0.5 + 0.5; }

  /**
   * Fractal sum. `oct` layers, each half the amplitude and roughly double the
   * frequency. The 2.03 lacunarity (rather than exactly 2) keeps successive
   * octaves from lining up their lattices, which otherwise shows as faint
   * diagonal streaks across a big landscape.
   */
  fbm(x, y, oct = 4, gain = 0.5, lac = 2.03) {
    let amp = 1, freq = 1, total = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      total += this.noise(x * freq, y * freq) * amp;
      norm += amp;
      amp *= gain; freq *= lac;
    }
    return total / norm;
  }

  fbm01(x, y, oct = 4, gain = 0.5, lac = 2.03) { return this.fbm(x, y, oct, gain, lac) * 0.5 + 0.5; }

  /**
   * Ridged noise — |n| inverted, which turns the zero-crossings of the noise
   * into sharp crests. This is what makes mountains look like mountains
   * instead of like large soft dunes.
   */
  ridged(x, y, oct = 4, gain = 0.5, lac = 2.03) {
    let amp = 1, freq = 1, total = 0, norm = 0, prev = 1;
    for (let i = 0; i < oct; i++) {
      let n = 1 - Math.abs(this.noise(x * freq, y * freq));
      n *= n;
      n *= prev;          // each octave is masked by the one above it, so
      prev = n;           // detail only appears on the ridges themselves
      total += n * amp;
      norm += amp;
      amp *= gain; freq *= lac;
    }
    return total / norm;
  }

  /**
   * Billowy noise — |n|, which gives rounded lumps. Good for cloud shapes and
   * for the soft swell of old woodland hills.
   */
  billow(x, y, oct = 4) {
    let amp = 1, freq = 1, total = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      total += Math.abs(this.noise(x * freq, y * freq)) * amp;
      norm += amp; amp *= 0.5; freq *= 2.03;
    }
    return total / norm;
  }

  /**
   * Domain warp: look up the noise at a position that has itself been pushed
   * around by noise. This is the single cheapest trick that stops terrain
   * looking like terrain-generator output — valleys start to meander and
   * ridges curl instead of running in straight lines.
   */
  warped(x, y, strength = 0.45, oct = 4) {
    const wx = this.fbm(x + 5.2, y + 1.3, 2);
    const wy = this.fbm(x - 3.7, y + 9.1, 2);
    return this.fbm(x + wx * strength, y + wy * strength, oct);
  }
}

/**
 * Worley / cellular noise — returns distance to the nearest feature point.
 * Used for clearings (a low cell centre becomes a glade), for patches of
 * fern, and for the blotchy way moss actually grows.
 */
export class Cellular {
  constructor(seed = 99) { this.seed = seed >>> 0; }

  _pt(cx, cy) {
    let h = (Math.imul(cx | 0, 0x27d4eb2d) ^ Math.imul(cy | 0, 0x165667b1) ^ this.seed) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0;
    h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0;
    h ^= h >>> 15;
    const ox = (h & 0xffff) / 65536;
    const oy = ((h >>> 16) & 0xffff) / 65536;
    return [cx + ox, cy + oy, h];
  }

  /** @returns {{f1:number, f2:number, id:number}} nearest and second-nearest distance */
  at(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    let f1 = 9e9, f2 = 9e9, id = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const [px, py, h] = this._pt(xi + dx, yi + dy);
        const ddx = px - x, ddy = py - y;
        const d = Math.sqrt(ddx * ddx + ddy * ddy);
        if (d < f1) { f2 = f1; f1 = d; id = h; }
        else if (d < f2) { f2 = d; }
      }
    }
    return { f1, f2, id };
  }

  /** 0 at a cell centre, rising outward — a natural "clearing" mask. */
  clearing(x, y) { return this.at(x, y).f1; }
}
