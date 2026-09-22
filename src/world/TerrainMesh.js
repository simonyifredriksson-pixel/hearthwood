/* TerrainMesh.js — turning the height field into tiles you can see.
   ===========================================================================
   The map is 1800 m across, which is far too much ground to hold at walking
   resolution. So it is cut into 100 m tiles and each tile is built at a
   resolution chosen by how far away it is, from 2.5 m steps under your feet
   down to 20 m steps on the far mountains.

   CRACKS between neighbouring tiles at different resolutions are the classic
   failure of this scheme: you get a hairline of sky along every seam. The fix
   here is a SKIRT — a vertical rim dropped from each tile edge. It is not
   clever, it never needs neighbour bookkeeping, and because it hangs straight
   down under the surface it is invisible from any angle a player can reach.

   Water is a separate, much simpler mesh: a flat strip following the river,
   with its vertex red channel carrying depth for the shader.
*/

import * as THREE from '../../lib/three.module.js?v=1790085618';
import { MeshBuilder, quadIdx } from '../art/Geo.js?v=1790085618';
import { WORLD } from '../core/Config.js?v=1790085618';
import { riverX, riverLevel } from './Terrain.js?v=1790085618';
import { WATER, mixHex } from '../art/Palette.js?v=1790085618';
import { Fields } from './Scatter.js?v=1790085618';
import { clamp, clamp01, lerp, invLerp } from '../core/Util.js?v=1790085618';

/** Vertices along a tile edge, by LOD. LOD 0 is 2.5 m steps. */
export const TILE_RES = [26, 14, 8, 4];

/** Distance (m) from the player at which each LOD takes over. */
export const LOD_DIST = [80, 165, 999, Infinity];

/** How much DETAIL a tile gets — deliberately a tighter set of bands than the
 *  terrain LOD. Terrain is cheap per square metre and can afford to be fine a
 *  long way out; a tile of full-detail undergrowth is two hundred times the
 *  cost of the terrain under it, so band 0 has to stay small. */
export const DETAIL_DIST = [72, 150, 999, Infinity];
export function detailForDistance(d) {
  for (let i = 0; i < DETAIL_DIST.length; i++) if (d < DETAIL_DIST[i]) return i;
  return DETAIL_DIST.length - 1;
}

export function lodForDistance(d) {
  for (let i = 0; i < LOD_DIST.length; i++) if (d < LOD_DIST[i]) return i;
  return LOD_DIST.length - 1;
}

/**
 * Build one terrain tile.
 * @param {Terrain} T
 * @param {number} tx, tz  tile indices (world x = tx * WORLD.tile)
 * @param {number} lod
 */
export function buildTerrainTile(T, tx, tz, lod, tileSize = WORLD.tile, resOverride = 0) {
  const size = tileSize;
  const res = resOverride || TILE_RES[clamp(lod, 0, TILE_RES.length - 1)];
  const step = size / res;
  const x0 = tx * size, z0 = tz * size;

  const n = res + 1;
  const H = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      H[j * n + i] = T.height(x0 + i * step, z0 + j * step);
    }
  }

  // one coarse field grid for the whole tile, shared by every vertex colour
  const F = new Fields(T, x0, z0, size, size >= 128 ? 16 : 4, size);

  const b = new MeshBuilder();
  const idx = new Int32Array(n * n);

  for (let j = 0; j < n; j++) {
    const z = z0 + j * step;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * step;
      const h = H[j * n + i];

      /* slope from the grid we already have, not from four fresh height
         evaluations — this is the difference between a tile costing 4 ms and
         costing 40 */
      const hl = H[j * n + Math.max(0, i - 1)];
      const hr = H[j * n + Math.min(n - 1, i + 1)];
      const hd = H[Math.max(0, j - 1) * n + i];
      const hu = H[Math.min(n - 1, j + 1) * n + i];
      const dx = (hl - hr) / (2 * step), dz = (hd - hu) / (2 * step);
      const slope = 1 - 1 / Math.sqrt(1 + dx * dx + dz * dz);

      b.color(T.groundColor(x, z, h, slope, F));
      idx[j * n + i] = b.vert(x - x0, h, z - z0, 0);
    }
  }

  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const a = idx[j * n + i], c = idx[j * n + i + 1];
      const d = idx[(j + 1) * n + i + 1], e = idx[(j + 1) * n + i];
      // split the quad along its SHORTER diagonal: on a ridge the other
      // choice puts a visible chevron along every crest
      const ha = b.pos[a * 3 + 1], hc = b.pos[c * 3 + 1];
      const hd2 = b.pos[d * 3 + 1], he = b.pos[e * 3 + 1];
      /* THE GROUND MUST FACE UP.
         The corners run a=(i,j) c=(i+1,j) d=(i+1,j+1) e=(i,j+1), which is
         CLOCKWISE seen from above — so tri(a,c,d) has its normal pointing
         into the earth. With a FrontSide material that is not a shading
         artefact, it is a world with no floor: every interior triangle is
         culled and the only ground left is the skirt, which survives purely
         because it is deliberately drawn with both windings. Each quad is
         wound the other way round here. */
      if (Math.abs(ha - hd2) <= Math.abs(hc - he)) {
        b.tri(a, d, c); b.tri(a, e, d);
      } else {
        b.tri(a, e, c); b.tri(c, e, d);
      }
    }
  }

  /* --- the skirt ------------------------------------------------------- */
  const DROP = lod === 0 ? 2.2 : lod === 1 ? 4.5 : 9;
  const rim = (getIdx, count) => {
    for (let k = 0; k < count - 1; k++) {
      const a = getIdx(k), c = getIdx(k + 1);
      b.colorRGB(b.col[a * 3] * 0.8, b.col[a * 3 + 1] * 0.8, b.col[a * 3 + 2] * 0.8);
      const a2 = b.vert(b.pos[a * 3], b.pos[a * 3 + 1] - DROP, b.pos[a * 3 + 2], 0);
      const c2 = b.vert(b.pos[c * 3], b.pos[c * 3 + 1] - DROP, b.pos[c * 3 + 2], 0);
      b.quad(a, c, c2, a2);
      b.quad(a2, c2, c, a);   // both windings: a skirt seen from inside a
    }                          // valley must not vanish
  };
  rim(k => idx[0 * n + k], n);
  rim(k => idx[res * n + k], n);
  rim(k => idx[k * n + 0], n);
  rim(k => idx[k * n + res], n);

  const geo = b.build({ flat: false });
  geo.computeBoundingSphere();
  return geo;
}

/* ========================================================================= */
/* WATER                                                                     */
/* ========================================================================= */

/**
 * The river surface: a ribbon following the centreline. Built once for the
 * whole map, because it is only a few thousand triangles and a river that
 * streams in and out as you walk is a river that visibly appears.
 *
 * The vertex RED channel is the depth the shader tints by, GREEN and BLUE
 * are unused. That is a slightly odd contract but it means water needs no
 * extra attribute and can share the standard vertex format.
 */
export function buildRiverMesh(T) {
  const b = new MeshBuilder();
  const R = WORLD.river;
  const zStep = 5;
  const halfW = R.bankWidth * 1.32;
  const across = 7;

  let prev = null;
  for (let z = -WORLD.half - 20; z <= WORLD.half + 20; z += zStep) {
    const cx = riverX(z);
    const lvl = riverLevel(z);
    const row = [];
    for (let i = 0; i <= across; i++) {
      const u = (i / across) * 2 - 1;                 // -1 .. 1 across
      const x = cx + u * halfW;
      // depth 1 mid-channel, 0 at the outer edge
      const depth = clamp01(1 - Math.abs(u) * 1.22);
      b.colorRGB(depth, 0.25, 0.25);
      row.push(b.vert(x, lvl, z, 0));
    }
    if (prev) {
      /* Wound so the surface faces the SKY. The water material is FrontSide
         like everything else, so the obvious ordering — across the previous
         row and back along this one — points the river at the riverbed and
         you see straight through to it. Same fault the terrain had. */
      for (let i = 0; i < across; i++) b.quad(prev[i], row[i], row[i + 1], prev[i + 1]);
    }
    prev = row;
  }

  const geo = b.build({ flat: false });
  geo.computeBoundingSphere();
  return geo;
}

/**
 * A lake surface: a fan of rings out to the shoreline.
 *
 * Built as rings rather than a grid so the edge is a circle rather than a
 * staircase, and the depth tint in the vertex colour runs from the middle
 * outwards — which is what makes a lake read as having a bottom. Wound to
 * face the SKY; the same winding trap as the river and the terrain, and it
 * would be invisible the other way round.
 */
export function buildLakeMesh(L) {
  const b = new MeshBuilder();
  const rings = 9, seg = 34;
  let prev = null;
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const rad = L.r * 1.06 * t;
    const depth = clamp01(1 - t * 1.12);
    const row = [];
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      b.colorRGB(depth, 0.25, 0.25);
      row.push(b.vert(L.x + Math.cos(a) * rad, L.level, L.z + Math.sin(a) * rad, 0));
    }
    if (prev) {
      for (let k = 0; k < seg; k++) b.quad(prev[k], prev[k + 1], row[k + 1], row[k]);
    }
    prev = row;
  }
  const geo = b.build({ flat: false });
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Foam and pebbles where the water meets the bank — the single cheapest thing
 * that stops a river looking like a sheet of glass laid on the ground.
 */
export function buildRiverEdge(T) {
  const b = new MeshBuilder();
  const zStep = 3.5;
  for (let z = -WORLD.half; z <= WORLD.half; z += zStep) {
    const cx = riverX(z);
    const lvl = riverLevel(z);
    for (const side of [-1, 1]) {
      // walk outward until the bank rises above the water line
      let edge = WORLD.river.width;
      for (let d = WORLD.river.width * 0.5; d < WORLD.river.bankWidth * 2; d += 0.6) {
        if (T.height(cx + side * d, z) > lvl) { edge = d; break; }
        edge = d;
      }
      const x = cx + side * edge;
      const jitter = ((z * 37.1) % 1) * 0.8;
      const w = 1.1 + jitter;
      b.color(mixHex(WATER.foam, 0xd8d2bc, 0.4 + jitter * 0.3), 0.08);
      const y = lvl + 0.035;
      /* The winding of this quad FLIPS WITH `side`, because the x extent is
         mirrored, so writing it out by hand gives foam facing the sky on one
         bank and facing the riverbed on the other. Stating the outward
         direction and letting quadIdx work out the order is the only version
         of this that cannot be half wrong. */
      quadIdx(b,
        b.vert(x - side * w, y, z - zStep * 0.5, 0),
        b.vert(x + side * w * 0.5, y, z - zStep * 0.5, 0),
        b.vert(x + side * w * 0.5, y, z + zStep * 0.5, 0),
        b.vert(x - side * w, y, z + zStep * 0.5, 0),
        [0, 1, 0]);
    }
  }
  return b.build({ flat: true });
}
