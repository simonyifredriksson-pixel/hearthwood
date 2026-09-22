/* Geo.js — the geometry toolkit every model in Hearthwood is built from.
   ===========================================================================
   There are no model files in this game. Every tree, house, mushroom, animal
   and stick is triangles written by code into a MeshBuilder, and whole tiles
   of forest are merged into single buffers so a thousand unique plants cost
   one draw call.

   FOUR ATTRIBUTES, and only four:

     position   the usual
     normal     computed at build time — generators never have to get it right
     color      per-vertex RGB. There are no textures on organic geometry, so
                colour variation IS the detail, and it costs nothing to make
                every leaf on every bush a slightly different green.
     sway       0..1, how much the wind moves this vertex. 0 at a trunk base,
                1 at the tip of a fern frond. Wind.js reads it in the vertex
                shader. Storing it per-vertex is what lets a single merged
                mesh contain a rigid rock and a trembling flower.

   SMOOTH vs FLAT is decided at build(), not by the generators: `flat` unwelds
   every triangle and gives it a face normal. Foliage and rock want flat (it
   reads as faceted and hand-carved); trunks, stems and animals want smooth.
*/

import * as THREE from '../../lib/three.module.js?v=1790103247';
import { TAU, clamp, lerp } from '../core/Util.js?v=1790103247';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _n = new THREE.Vector3();

/* --------------------------------------------------------------------------
   COLOUR SPACE. This is not a detail — it is the difference between a forest
   and a washed-out pastel drawing of one.

   three.js treats a `color` vertex ATTRIBUTE as already being in the working
   colour space, which is linear. Palette colours are written as hex, which is
   sRGB, the way a person reads colour. Handing 0x6b5541/255 straight to the
   shader therefore makes every mid-tone far too bright: sRGB 0.42 is linear
   0.15, so the bark comes out nearly three times lighter than intended and
   every colour loses its bite.

   So every hex that enters a buffer goes through this table. 256 entries,
   computed once.
-------------------------------------------------------------------------- */
const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
export const srgb8ToLinear = i => SRGB_TO_LINEAR[i & 255];
export const srgbToLinear = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export const linearToSrgb = c => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/* ========================================================================= */
/* MESH BUILDER                                                              */
/* ========================================================================= */

export class MeshBuilder {
  constructor() {
    this.pos = [];
    this.col = [];
    this.sway = [];
    this.idx = [];
    /** Set by generators; every vertex added picks it up. */
    this.curColor = [1, 1, 1];
    this.curSway = 0;
  }

  get vertexCount() { return this.pos.length / 3; }
  get triCount() { return this.idx.length / 3; }
  get isEmpty() { return this.idx.length === 0; }

  /** Set the current colour from an sRGB hex. Converted to linear on the way in. */
  color(hex, jitter = 0, rnd = null) {
    let r = SRGB_TO_LINEAR[(hex >> 16) & 255];
    let g = SRGB_TO_LINEAR[(hex >> 8) & 255];
    let b = SRGB_TO_LINEAR[hex & 255];
    if (jitter > 0) {
      const f = rnd || Math.random;
      // Jitter each channel independently AND the whole thing together: the
      // first gives hue variation, the second gives light/dark variation, and
      // you need both or a hundred leaves look like one leaf with noise on it.
      const l = 1 + (f() - 0.5) * jitter * 2;
      r = clamp(r * l * (1 + (f() - 0.5) * jitter), 0, 1);
      g = clamp(g * l * (1 + (f() - 0.5) * jitter), 0, 1);
      b = clamp(b * l * (1 + (f() - 0.5) * jitter), 0, 1);
    }
    this.curColor = [r, g, b];
    return this;
  }

  /** Set a colour that is ALREADY linear. */
  colorRGB(r, g, b) { this.curColor = [r, g, b]; return this; }
  swayAmount(s) { this.curSway = s; return this; }

  /** Add a vertex, returning its index. */
  vert(x, y, z, sway = null, col = null) {
    this.pos.push(x, y, z);
    const c = col || this.curColor;
    this.col.push(c[0], c[1], c[2]);
    this.sway.push(sway === null ? this.curSway : sway);
    return this.pos.length / 3 - 1;
  }

  tri(a, b, c) { this.idx.push(a, b, c); return this; }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); return this; }

  /**
   * Append another builder, optionally transformed. This is how a tile of
   * forest is assembled: each plant builds itself at the origin and is then
   * stamped into the tile.
   */
  append(other, mat = null) {
    const base = this.vertexCount;
    const p = other.pos;
    if (mat) {
      const e = mat.elements;
      for (let i = 0; i < p.length; i += 3) {
        const x = p[i], y = p[i + 1], z = p[i + 2];
        const w = e[3] * x + e[7] * y + e[11] * z + e[15] || 1;
        this.pos.push(
          (e[0] * x + e[4] * y + e[8] * z + e[12]) / w,
          (e[1] * x + e[5] * y + e[9] * z + e[13]) / w,
          (e[2] * x + e[6] * y + e[10] * z + e[14]) / w,
        );
      }
    } else {
      for (let i = 0; i < p.length; i++) this.pos.push(p[i]);
    }
    for (let i = 0; i < other.col.length; i++) this.col.push(other.col[i]);
    for (let i = 0; i < other.sway.length; i++) this.sway.push(other.sway[i]);
    for (let i = 0; i < other.idx.length; i++) this.idx.push(other.idx[i] + base);
    return this;
  }

  /** Append a three.js BufferGeometry (used for text-free UI props and helpers). */
  appendGeometry(geo, mat = null, hex = null, sway = 0) {
    const g = geo.index ? geo : geo.toNonIndexed();
    const p = g.attributes.position.array;
    const base = this.vertexCount;
    const hasCol = !!g.attributes.color;
    const ca = hasCol ? g.attributes.color.array : null;
    const e = mat ? mat.elements : null;
    for (let i = 0; i < p.length; i += 3) {
      let x = p[i], y = p[i + 1], z = p[i + 2];
      if (e) {
        const X = e[0] * x + e[4] * y + e[8] * z + e[12];
        const Y = e[1] * x + e[5] * y + e[9] * z + e[13];
        const Z = e[2] * x + e[6] * y + e[10] * z + e[14];
        x = X; y = Y; z = Z;
      }
      this.pos.push(x, y, z);
      if (hex !== null) {
        this.col.push(SRGB_TO_LINEAR[(hex >> 16) & 255], SRGB_TO_LINEAR[(hex >> 8) & 255], SRGB_TO_LINEAR[hex & 255]);
      } else if (hasCol) {
        this.col.push(ca[i], ca[i + 1], ca[i + 2]);
      } else {
        this.col.push(this.curColor[0], this.curColor[1], this.curColor[2]);
      }
      this.sway.push(sway);
    }
    if (g.index) {
      const ia = g.index.array;
      for (let i = 0; i < ia.length; i++) this.idx.push(ia[i] + base);
    } else {
      const n = p.length / 3;
      for (let i = 0; i < n; i++) this.idx.push(base + i);
    }
    return this;
  }

  /** Move every vertex added so far. Used to re-centre a finished model. */
  translate(dx, dy, dz) {
    for (let i = 0; i < this.pos.length; i += 3) {
      this.pos[i] += dx; this.pos[i + 1] += dy; this.pos[i + 2] += dz;
    }
    return this;
  }

  /**
   * Flip every triangle added since `from` whose face normal points TOWARD
   * `centre`, so a lump of geometry ends up facing consistently outward.
   *
   * This is the escape hatch for shapes where getting the winding right by
   * hand is fiddly and getting it wrong is invisible: the top of a plant
   * pot's soil, the ash disc in a fire, the growth rings on a stump. It is
   * only correct for shapes that are convex about `centre`, which is exactly
   * the set of shapes it is used on.
   */
  orientOutward(from, cx = 0, cy = 0, cz = 0, sign = 1) {
    for (let t = from; t < this.idx.length; t += 3) {
      const a = this.idx[t], b2 = this.idx[t + 1], c = this.idx[t + 2];
      const ax = this.pos[a * 3], ay = this.pos[a * 3 + 1], az = this.pos[a * 3 + 2];
      const ux = this.pos[b2 * 3] - ax, uy = this.pos[b2 * 3 + 1] - ay, uz = this.pos[b2 * 3 + 2] - az;
      const vx = this.pos[c * 3] - ax, vy = this.pos[c * 3 + 1] - ay, vz = this.pos[c * 3 + 2] - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const mx = (ax + this.pos[b2 * 3] + this.pos[c * 3]) / 3 - cx;
      const my = (ay + this.pos[b2 * 3 + 1] + this.pos[c * 3 + 1]) / 3 - cy;
      const mz = (az + this.pos[b2 * 3 + 2] + this.pos[c * 3 + 2]) / 3 - cz;
      if ((nx * mx + ny * my + nz * mz) * sign < 0) { this.idx[t + 1] = c; this.idx[t + 2] = b2; }
    }
    return this;
  }

  /** Index into `idx` right now — pass to orientOutward as `from`. */
  get mark() { return this.idx.length; }

  /** Axis-aligned bounds of what has been built. */
  bounds() {
    if (!this.pos.length) return { min: [0, 0, 0], max: [0, 0, 0] };
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < this.pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = this.pos[i + k];
        if (v < mn[k]) mn[k] = v;
        if (v > mx[k]) mx[k] = v;
      }
    }
    return { min: mn, max: mx };
  }

  /**
   * @param {object} o
   * @param {boolean} o.flat  unweld and use face normals (faceted look)
   * @param {number}  o.creaseSmooth  when smooth, blend face normal toward the
   *        averaged one by this much (1 = fully smooth, 0.75 keeps some edge)
   */
  build({ flat = false, creaseSmooth = 1 } = {}) {
    const geo = new THREE.BufferGeometry();
    if (!this.idx.length) {
      geo.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute([], 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute([], 3));
      geo.setAttribute('sway', new THREE.Float32BufferAttribute([], 1));
      return geo;
    }

    if (flat) {
      const n = this.idx.length;
      const P = new Float32Array(n * 3), C = new Float32Array(n * 3);
      const N = new Float32Array(n * 3), S = new Float32Array(n);
      for (let t = 0; t < n; t += 3) {
        const ia = this.idx[t], ib = this.idx[t + 1], ic = this.idx[t + 2];
        _v1.set(this.pos[ia * 3], this.pos[ia * 3 + 1], this.pos[ia * 3 + 2]);
        _v2.set(this.pos[ib * 3], this.pos[ib * 3 + 1], this.pos[ib * 3 + 2]);
        _v3.set(this.pos[ic * 3], this.pos[ic * 3 + 1], this.pos[ic * 3 + 2]);
        _n.copy(_v2).sub(_v1).cross(_v3.clone().sub(_v1));
        if (_n.lengthSq() < 1e-16) _n.set(0, 1, 0); else _n.normalize();
        const src = [ia, ib, ic];
        for (let k = 0; k < 3; k++) {
          const s = src[k], o = (t + k) * 3;
          P[o] = this.pos[s * 3]; P[o + 1] = this.pos[s * 3 + 1]; P[o + 2] = this.pos[s * 3 + 2];
          C[o] = this.col[s * 3]; C[o + 1] = this.col[s * 3 + 1]; C[o + 2] = this.col[s * 3 + 2];
          N[o] = _n.x; N[o + 1] = _n.y; N[o + 2] = _n.z;
          S[t + k] = this.sway[s];
        }
      }
      geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(C, 3));
      geo.setAttribute('sway', new THREE.BufferAttribute(S, 1));
      return geo;
    }

    /* smooth: area-weighted vertex normals (the cross product is already
       proportional to twice the triangle area, so simply NOT normalising it
       before accumulation gives the weighting for free and stops a fan of
       tiny triangles from dominating a big one) */
    const vc = this.vertexCount;
    const N = new Float32Array(vc * 3);
    for (let t = 0; t < this.idx.length; t += 3) {
      const ia = this.idx[t], ib = this.idx[t + 1], ic = this.idx[t + 2];
      _v1.set(this.pos[ia * 3], this.pos[ia * 3 + 1], this.pos[ia * 3 + 2]);
      _v2.set(this.pos[ib * 3], this.pos[ib * 3 + 1], this.pos[ib * 3 + 2]);
      _v3.set(this.pos[ic * 3], this.pos[ic * 3 + 1], this.pos[ic * 3 + 2]);
      _n.copy(_v2).sub(_v1).cross(_v3.sub(_v1));
      for (const s of [ia, ib, ic]) { N[s * 3] += _n.x; N[s * 3 + 1] += _n.y; N[s * 3 + 2] += _n.z; }
    }
    for (let i = 0; i < vc; i++) {
      const x = N[i * 3], y = N[i * 3 + 1], z = N[i * 3 + 2];
      const l = Math.hypot(x, y, z);
      if (l > 1e-9) { N[i * 3] = x / l; N[i * 3 + 1] = y / l; N[i * 3 + 2] = z / l; }
      else { N[i * 3 + 1] = 1; }
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.setAttribute('sway', new THREE.Float32BufferAttribute(this.sway, 1));
    geo.setIndex(vc > 65535
      ? new THREE.Uint32BufferAttribute(this.idx, 1)
      : new THREE.Uint16BufferAttribute(this.idx, 1));
    if (creaseSmooth < 1) geo.userData.creaseSmooth = creaseSmooth;
    return geo;
  }
}

/* ========================================================================= */
/* PRIMITIVES — all of these write into a builder                            */
/* ========================================================================= */

/**
 * A swept tube along a polyline — the single most-used generator in the game.
 * Sticks, branches, trunks, roots, fence rails, stems, tails and limbs are
 * all this function.
 *
 * Frames are carried along the curve by PARALLEL TRANSPORT rather than
 * recomputed from the curvature at each point. A Frenet frame flips its
 * normal wherever a curve has an inflection, and on a crooked branch that is
 * every few centimetres — you get a visible twist and a pinch. Transporting
 * the previous frame forward cannot do that.
 *
 * @param {MeshBuilder} b
 * @param {object} o
 * @param {number[][]} o.pts      [[x,y,z], ...] at least 2
 * @param {function}   o.radius   (t, i) -> metres
 * @param {number}     o.radial   sides around the tube
 * @param {function}   o.color    (t, i, ang) -> hex, optional
 * @param {function}   o.sway     (t, i) -> 0..1, optional
 * @param {boolean}    o.capStart
 * @param {boolean}    o.capEnd
 * @param {function}   o.squash   (t) -> [sx, sy] cross-section scaling, for
 *                                flattened or oval branches
 * @param {function}   o.bump     (t, ang) -> radius multiplier. This is what
 *                                puts bark RIDGES into the silhouette rather
 *                                than only into the colour — at close range
 *                                it is the difference between a branch and a
 *                                brown pipe.
 */
export function tube(b, {
  pts, radius = () => 0.05, radial = 6, color = null, sway = null,
  capStart = true, capEnd = true, squash = null, roll = 0, bump = null,
}) {
  const n = pts.length;
  if (n < 2) return;

  // parallel-transported frames
  const tangents = [], normals = [], binormals = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], c = pts[Math.min(n - 1, i + 1)];
    _v1.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    if (_v1.lengthSq() < 1e-12) _v1.set(0, 1, 0);
    tangents.push(_v1.clone().normalize());
  }
  // seed the first normal with whichever axis is least parallel to the tangent
  {
    const t0 = tangents[0];
    const up = Math.abs(t0.y) < 0.92 ? _v2.set(0, 1, 0) : _v2.set(1, 0, 0);
    const nrm = new THREE.Vector3().crossVectors(up, t0).normalize();
    if (nrm.lengthSq() < 1e-9) nrm.set(1, 0, 0);
    normals.push(nrm);
    binormals.push(new THREE.Vector3().crossVectors(t0, nrm).normalize());
  }
  for (let i = 1; i < n; i++) {
    const prevT = tangents[i - 1], t = tangents[i];
    let nrm = normals[i - 1].clone();
    const axis = new THREE.Vector3().crossVectors(prevT, t);
    const len = axis.length();
    if (len > 1e-8) {
      axis.divideScalar(len);
      const ang = Math.acos(clamp(prevT.dot(t), -1, 1));
      nrm.applyAxisAngle(axis, ang);
    }
    // re-orthogonalise: float error accumulates over a hundred rings
    nrm.sub(t.clone().multiplyScalar(nrm.dot(t)));
    if (nrm.lengthSq() < 1e-12) {
      const up = Math.abs(t.y) < 0.92 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      nrm.crossVectors(up, t);
    }
    nrm.normalize();
    normals.push(nrm);
    binormals.push(new THREE.Vector3().crossVectors(t, nrm).normalize());
  }

  const rings = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const r = radius(t, i);
    const sq = squash ? squash(t, i) : null;
    const sx = sq ? sq[0] : 1, sy = sq ? sq[1] : 1;
    const ring = [];
    const rl = roll ? roll * t : 0;
    for (let a = 0; a < radial; a++) {
      const ang = (a / radial) * TAU + rl;
      const rb = bump ? r * bump(t, ang) : r;
      const ca = Math.cos(ang) * rb * sx, sa = Math.sin(ang) * rb * sy;
      const nx = normals[i], bx = binormals[i];
      const px = pts[i][0] + nx.x * ca + bx.x * sa;
      const py = pts[i][1] + nx.y * ca + bx.y * sa;
      const pz = pts[i][2] + nx.z * ca + bx.z * sa;
      if (color) b.color(color(t, i, ang));
      ring.push(b.vert(px, py, pz, sway ? sway(t, i) : null));
    }
    rings.push(ring);
  }

  for (let i = 0; i < n - 1; i++) {
    for (let a = 0; a < radial; a++) {
      const a2 = (a + 1) % radial;
      b.quad(rings[i][a], rings[i][a2], rings[i + 1][a2], rings[i + 1][a]);
    }
  }

  if (capStart && radial >= 3) {
    if (color) b.color(color(0, 0, 0));
    const c = b.vert(pts[0][0], pts[0][1], pts[0][2], sway ? sway(0, 0) : null);
    for (let a = 0; a < radial; a++) b.tri(c, rings[0][(a + 1) % radial], rings[0][a]);
  }
  if (capEnd && radial >= 3) {
    const L = n - 1;
    if (color) b.color(color(1, L, 0));
    const c = b.vert(pts[L][0], pts[L][1], pts[L][2], sway ? sway(1, L) : null);
    for (let a = 0; a < radial; a++) b.tri(c, rings[L][a], rings[L][(a + 1) % radial]);
  }
  return rings;
}

/** A box, axis-aligned, centred on (x,y,z). */
export function box(b, x, y, z, w, h, d, sway = null) {
  const hx = w / 2, hy = h / 2, hz = d / 2;
  const v = [];
  const pts = [
    [-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz],
    [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz],
  ];
  for (const p of pts) v.push(b.vert(x + p[0], y + p[1], z + p[2], sway));
  b.quad(v[4], v[5], v[6], v[7]);   // +z
  b.quad(v[1], v[0], v[3], v[2]);   // -z
  b.quad(v[5], v[1], v[2], v[6]);   // +x
  b.quad(v[0], v[4], v[7], v[3]);   // -x
  b.quad(v[3], v[7], v[6], v[2]);   // +y
  b.quad(v[0], v[1], v[5], v[4]);   // -y
  return v;
}

/** A box built from 8 explicit corners — for beams, wedges and roof planes. */
export function hexa(b, c, sway = null) {
  const v = c.map(p => b.vert(p[0], p[1], p[2], sway));
  b.quad(v[4], v[5], v[6], v[7]);
  b.quad(v[1], v[0], v[3], v[2]);
  b.quad(v[5], v[1], v[2], v[6]);
  b.quad(v[0], v[4], v[7], v[3]);
  b.quad(v[3], v[7], v[6], v[2]);
  b.quad(v[0], v[1], v[5], v[4]);
  return v;
}

/**
 * A beam from point A to point B with a rectangular cross-section, oriented
 * so its "up" face points along `up`. Every timber in the village is this.
 */
export function beam(b, ax, ay, az, bx, by, bz, w, h, up = [0, 1, 0], sway = null) {
  _v1.set(bx - ax, by - ay, bz - az);
  const len = _v1.length();
  if (len < 1e-6) return;
  _v1.divideScalar(len);
  _v2.set(up[0], up[1], up[2]);
  if (Math.abs(_v1.dot(_v2)) > 0.97) _v2.set(_v1.y === 0 ? 0 : 1, 0, _v1.y === 0 ? 1 : 0);
  /* (side, vert, dir) MUST be right-handed, because hexa() lays its corners
     out in that frame using box()'s winding convention. The first version
     used side = dir x up, which gives a LEFT-handed frame and quietly turned
     every beam in the game inside out — every fence, every rafter, every
     bridge rail, invisible from outside and only visible from within. It
     survived because the test rasteriser was drawing back faces. */
  const side = new THREE.Vector3().crossVectors(_v2, _v1).normalize();
  const vert = new THREE.Vector3().crossVectors(_v1, side).normalize();
  const hw = w / 2, hh = h / 2;
  const corner = (px, py, pz, s, u) => [
    px + side.x * s + vert.x * u,
    py + side.y * s + vert.y * u,
    pz + side.z * s + vert.z * u,
  ];
  hexa(b, [
    corner(ax, ay, az, -hw, -hh), corner(ax, ay, az, hw, -hh),
    corner(ax, ay, az, hw, hh), corner(ax, ay, az, -hw, hh),
    corner(bx, by, bz, -hw, -hh), corner(bx, by, bz, hw, -hh),
    corner(bx, by, bz, hw, hh), corner(bx, by, bz, -hw, hh),
  ], sway);
}

/** A cylinder along +Y from y0 to y1. */
export function cylinder(b, x, z, y0, y1, r0, r1, seg = 8, sway = null, swayTop = null) {
  const bot = [], top = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * TAU;
    bot.push(b.vert(x + Math.cos(a) * r0, y0, z + Math.sin(a) * r0, sway));
    top.push(b.vert(x + Math.cos(a) * r1, y1, z + Math.sin(a) * r1, swayTop === null ? sway : swayTop));
  }
  /* Angle runs anticlockwise in XZ seen from BELOW, so the outward-facing
     winding for the wall is bottom -> top -> top+1 -> bottom+1, and the caps
     are the other way round from what reads naturally. Getting this backwards
     turns every cylinder in the game inside out.
     `y1 < y0` is legal and happens, so the winding follows the direction
     rather than assuming it. */
  const up = y1 >= y0;
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    if (up) b.quad(bot[i], top[i], top[j], bot[j]);
    else b.quad(bot[i], bot[j], top[j], top[i]);
  }
  if (r0 > 1e-5) {
    const c = b.vert(x, y0, z, sway);
    for (let i = 0; i < seg; i++) {
      if (up) b.tri(c, bot[i], bot[(i + 1) % seg]);
      else b.tri(c, bot[(i + 1) % seg], bot[i]);
    }
  }
  if (r1 > 1e-5) {
    const c = b.vert(x, y1, z, swayTop === null ? sway : swayTop);
    for (let i = 0; i < seg; i++) {
      if (up) b.tri(c, top[(i + 1) % seg], top[i]);
      else b.tri(c, top[i], top[(i + 1) % seg]);
    }
  }
  return { bot, top };
}

/** A lathed profile: [[radius, y], ...] revolved around Y. */
export function lathe(b, profile, seg = 10, cx = 0, cz = 0, sway = null, colorAt = null) {
  const rings = [];
  for (let p = 0; p < profile.length; p++) {
    const [r, y] = profile[p];
    const ring = [];
    if (colorAt) b.color(colorAt(p / (profile.length - 1)));
    if (r < 1e-5) {
      ring.push(b.vert(cx, y, cz, sway));
      for (let i = 1; i < seg; i++) ring.push(ring[0]);
    } else {
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * TAU;
        ring.push(b.vert(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r, sway));
      }
    }
    rings.push(ring);
  }
  /* Same handedness trap as cylinder(): the surface faces outward when it
     runs ring -> next ring -> next angle.
     AND the profile may be written either way up — a mushroom cap is authored
     from its tip downward, a barrel from its base upward — so the winding is
     chosen from the profile's actual direction rather than assumed. Leaving
     that assumption implicit is how half the lathed props in the game ended
     up inside out while the other half were fine. */
  /* ONE winding for the whole profile, chosen from its overall direction.
     A lathe is a shell, and a fixed winding makes the normal follow the
     profile — so a pot authored as "up the outside, across the rim, down the
     inside" gets an outward outer wall and an inward inner wall for free.
     Deciding per segment instead forces every segment to face away from the
     axis, which turns the inside of every pot, bucket and well inside out. */
  const up = profile[profile.length - 1][1] >= profile[0][1];
  for (let p = 0; p < rings.length - 1; p++) {
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      const a = rings[p][i], c = rings[p][j], d = rings[p + 1][j], e = rings[p + 1][i];
      if (a === c && d === e) continue;
      if (up) {
        if (a === c) b.tri(a, e, d);
        else if (d === e) b.tri(a, d, c);
        else b.quad(a, e, d, c);
      } else {
        if (a === c) b.tri(a, d, e);
        else if (d === e) b.tri(a, c, d);
        else b.quad(a, c, d, e);
      }
    }
  }
  return rings;
}

/**
 * A deformable low-poly sphere. `warp(x,y,z)` returns a radius multiplier, so
 * one function turns a sphere into a boulder, a bush, a mushroom cap or a
 * belly. Flat-shaded these look carved; smooth-shaded they look soft.
 */
export function blob(b, cx, cy, cz, r, rings = 6, seg = 9, warp = null, sway = null, colorAt = null) {
  const grid = [];
  for (let i = 0; i <= rings; i++) {
    const phi = (i / rings) * Math.PI;
    const row = [];
    const sy = Math.cos(phi), sr = Math.sin(phi);
    for (let j = 0; j < seg; j++) {
      const th = (j / seg) * TAU;
      let ux = Math.cos(th) * sr, uy = sy, uz = Math.sin(th) * sr;
      const m = warp ? warp(ux, uy, uz) : 1;
      const mx = Array.isArray(m) ? m[0] : m;
      const my = Array.isArray(m) ? m[1] : m;
      const mz = Array.isArray(m) ? m[2] : m;
      if (colorAt) b.color(colorAt(ux, uy, uz));
      row.push(b.vert(cx + ux * r * mx, cy + uy * r * my, cz + uz * r * mz, sway));
      if (i === 0 || i === rings) { for (let k = 1; k < seg; k++) row.push(row[0]); break; }
    }
    grid.push(row);
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < seg; j++) {
      const k = (j + 1) % seg;
      const a = grid[i][j], c = grid[i][k], d = grid[i + 1][k], e = grid[i + 1][j];
      if (a === c && d === e) continue;
      if (a === c) b.tri(a, d, e);
      else if (d === e) b.tri(a, c, d);
      else b.quad(a, c, d, e);
    }
  }
  return grid;
}

/**
 * A flat quad in 3D from four corners.
 *
 * `outward` is the direction the quad is MEANT to face. Give it, and the
 * winding is corrected to match; leave it out and the corner order decides,
 * as before. This exists because a roof slope, an awning or a gable end is
 * authored by walking its corners in whatever order reads naturally in the
 * loop that produces them, and remembering the handedness of each of those
 * loops is how you end up with one side of every roof in the village
 * invisible from outside.
 */
export function quad(b, p0, p1, p2, p3, sway = null, outward = null) {
  if (outward) {
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * outward[0] + ny * outward[1] + nz * outward[2] < 0) {
      const t = p1; p1 = p3; p3 = t;
    }
  }
  const a = b.vert(p0[0], p0[1], p0[2], sway);
  const c = b.vert(p1[0], p1[1], p1[2], sway);
  const d = b.vert(p2[0], p2[1], p2[2], sway);
  const e = b.vert(p3[0], p3[1], p3[2], sway);
  b.quad(a, c, d, e);
  return [a, c, d, e];
}

/**
 * The same correction for four vertices that have ALREADY been added — used
 * where a surface is built as a grid of shared vertices and only the faces
 * are being stitched.
 */
export function quadIdx(b, a, c, d, e, outward = null) {
  if (outward) {
    const ax = b.pos[a * 3], ay = b.pos[a * 3 + 1], az = b.pos[a * 3 + 2];
    const ux = b.pos[c * 3] - ax, uy = b.pos[c * 3 + 1] - ay, uz = b.pos[c * 3 + 2] - az;
    const vx = b.pos[d * 3] - ax, vy = b.pos[d * 3 + 1] - ay, vz = b.pos[d * 3 + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * outward[0] + ny * outward[1] + nz * outward[2] < 0) { const t = c; c = e; e = t; }
  }
  b.quad(a, c, d, e);
}

/**
 * A piece of cloth: a quad with real thickness, so it is visible from both
 * sides without needing a double-sided material.
 *
 * Two coplanar quads wound opposite ways does NOT work — they are at exactly
 * the same depth, so the one drawn second loses the depth test and the sheet
 * is one-sided after all. Every hand-made "back face" in this game was that
 * bug. Giving the cloth a centimetre of thickness costs four triangles and
 * removes the whole problem.
 */
export function sheet(b, p0, p1, p2, p3, thick = 0.012, sway = null) {
  const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
  const vx = p3[0] - p0[0], vy = p3[1] - p0[1], vz = p3[2] - p0[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx = (nx / l) * thick; ny = (ny / l) * thick; nz = (nz / l) * thick;
  const off = p => [p[0] - nx, p[1] - ny, p[2] - nz];
  const q0 = off(p0), q1 = off(p1), q2 = off(p2), q3 = off(p3);
  const out = [nx, ny, nz];
  quad(b, p0, p1, p2, p3, sway, out);
  quad(b, q0, q1, q2, q3, sway, [-nx, -ny, -nz]);
  // the four edges, so the sheet has a visible thickness at its border
  quad(b, p0, p1, q1, q0, sway, [uy * nz - uz * ny, uz * nx - ux * nz, ux * ny - uy * nx]);
  quad(b, p2, p3, q3, q2, sway, [-(uy * nz - uz * ny), -(uz * nx - ux * nz), -(ux * ny - uy * nx)]);
  quad(b, p1, p2, q2, q1, sway, [vy * nz - vz * ny, vz * nx - vx * nz, vx * ny - vy * nx]);
  quad(b, p3, p0, q0, q3, sway, [-(vy * nz - vz * ny), -(vz * nx - vx * nz), -(vx * ny - vy * nx)]);
}

/**
 * A closed triangular prism — an ear, a fin, a blade of a weathervane.
 *
 * Ears used to be two coplanar triangles wound opposite ways, which is the
 * same z-fighting trap as the cloth: the second one loses the depth test and
 * the ear is one-sided anyway. A prism has no such problem and it catches the
 * light on its edge, which a zero-thickness ear cannot.
 */
export function wedge(b, base0, base1, tip, thick = 0.01, sway = null) {
  const ux = base1[0] - base0[0], uy = base1[1] - base0[1], uz = base1[2] - base0[2];
  const vx = tip[0] - base0[0], vy = tip[1] - base0[1], vz = tip[2] - base0[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx = (nx / l) * thick; ny = (ny / l) * thick; nz = (nz / l) * thick;
  const A = [base0[0] + nx, base0[1] + ny, base0[2] + nz];
  const B = [base1[0] + nx, base1[1] + ny, base1[2] + nz];
  const T = [tip[0] + nx, tip[1] + ny, tip[2] + nz];
  const A2 = [base0[0] - nx, base0[1] - ny, base0[2] - nz];
  const B2 = [base1[0] - nx, base1[1] - ny, base1[2] - nz];
  const T2 = [tip[0] - nx, tip[1] - ny, tip[2] - nz];
  const cx = (A[0] + B[0] + T[0] + A2[0] + B2[0] + T2[0]) / 6;
  const cy = (A[1] + B[1] + T[1] + A2[1] + B2[1] + T2[1]) / 6;
  const cz = (A[2] + B[2] + T[2] + A2[2] + B2[2] + T2[2]) / 6;
  const m = b.mark;
  b.tri(b.vert(A[0], A[1], A[2], sway), b.vert(B[0], B[1], B[2], sway), b.vert(T[0], T[1], T[2], sway));
  b.tri(b.vert(A2[0], A2[1], A2[2], sway), b.vert(B2[0], B2[1], B2[2], sway), b.vert(T2[0], T2[1], T2[2], sway));
  quad(b, A, B, B2, A2, sway);
  quad(b, B, T, T2, B2, sway);
  quad(b, T, A, A2, T2, sway);
  b.orientOutward(m, cx, cy, cz);
}

/** A triangle whose winding is corrected to face `outward`. */
export function tri3(b, p0, p1, p2, sway = null, outward = null) {
  if (outward) {
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * outward[0] + ny * outward[1] + nz * outward[2] < 0) {
      const t = p1; p1 = p2; p2 = t;
    }
  }
  const a = b.vert(p0[0], p0[1], p0[2], sway);
  const c = b.vert(p1[0], p1[1], p1[2], sway);
  const d = b.vert(p2[0], p2[1], p2[2], sway);
  b.tri(a, c, d);
  return [a, c, d];
}

/**
 * A leaf/petal blade: a tapered, slightly cupped, double-sided shape lying in
 * the XZ plane with its stem at the origin and tip at +Z. Everything green
 * and thin in this game is one of these.
 */
export function blade(b, {
  len = 0.3, wid = 0.08, segs = 3, curl = 0.25, cup = 0.3, swayBase = 0.2, swayTip = 1,
  widthAt = null,
}) {
  const left = [], right = [], mid = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = (widthAt ? widthAt(t) : Math.sin(t * Math.PI) ** 0.7) * wid;
    const y = -curl * t * t * len;
    const z = t * len;
    const sw = lerp(swayBase, swayTip, t);
    mid.push(b.vert(0, y + cup * w, z, sw));
    left.push(b.vert(-w, y, z, sw));
    right.push(b.vert(w, y, z, sw));
  }
  for (let i = 0; i < segs; i++) {
    b.tri(left[i], mid[i], mid[i + 1]);
    b.tri(left[i], mid[i + 1], left[i + 1]);
    b.tri(mid[i], right[i], right[i + 1]);
    b.tri(mid[i], right[i + 1], mid[i + 1]);
    // back faces, so a leaf seen from below is not invisible
    b.tri(mid[i + 1], mid[i], left[i]);
    b.tri(left[i + 1], mid[i + 1], left[i]);
    b.tri(right[i + 1], right[i], mid[i]);
    b.tri(mid[i + 1], right[i + 1], mid[i]);
  }
  return { left, right, mid };
}

/* ========================================================================= */
/* TRANSFORM HELPERS                                                         */
/* ========================================================================= */

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

/** Build a transform matrix without allocating one per call at build time. */
export function mat(x = 0, y = 0, z = 0, ry = 0, s = 1, rx = 0, rz = 0) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(s, s, s);
  return _m.compose(_p, _q, _s).clone();
}

export function matS(x, y, z, ry, sx, sy, sz, rx = 0, rz = 0) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  return _m.compose(_p, _q, _s).clone();
}

/* ========================================================================= */
/* CURVES                                                                    */
/* ========================================================================= */

/**
 * Resample a polyline to `n` evenly spaced points with Catmull-Rom smoothing.
 * Sticks are authored as half a dozen control points and drawn as thirty, so
 * a bend is a bend and not a corner.
 */
export function smoothPath(pts, n) {
  if (pts.length < 2) return pts.slice();
  const out = [];
  const get = i => pts[clamp(i, 0, pts.length - 1)];
  const segs = pts.length - 1;
  for (let k = 0; k < n; k++) {
    const u = (k / (n - 1)) * segs;
    const i = Math.min(segs - 1, Math.floor(u));
    const t = u - i;
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const t2 = t * t, t3 = t2 * t;
    const c = [];
    for (let a = 0; a < 3; a++) {
      c.push(0.5 * ((2 * p1[a]) + (-p0[a] + p2[a]) * t +
        (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 +
        (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3));
    }
    out.push(c);
  }
  return out;
}

/** Total length of a polyline. */
export function pathLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) {
    L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
  }
  return L;
}

/** Point and tangent at arc-length fraction `t` along a polyline. */
export function pathAt(pts, t) {
  const total = pathLength(pts);
  let want = clamp(t, 0, 1) * total, acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
    if (acc + d >= want || i === pts.length - 1) {
      const f = d > 1e-9 ? (want - acc) / d : 0;
      const p = [
        lerp(pts[i - 1][0], pts[i][0], f),
        lerp(pts[i - 1][1], pts[i][1], f),
        lerp(pts[i - 1][2], pts[i][2], f),
      ];
      const tan = [pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]];
      const l = Math.hypot(tan[0], tan[1], tan[2]) || 1;
      return { p, tan: [tan[0] / l, tan[1] / l, tan[2] / l] };
    }
    acc += d;
  }
  return { p: pts[pts.length - 1].slice(), tan: [0, 1, 0] };
}

/** Rotate a 3-vector about an arbitrary axis (Rodrigues). */
export function rotAxis(v, axis, ang) {
  const [ax, ay, az] = axis;
  const c = Math.cos(ang), s = Math.sin(ang);
  const d = ax * v[0] + ay * v[1] + az * v[2];
  return [
    v[0] * c + (ay * v[2] - az * v[1]) * s + ax * d * (1 - c),
    v[1] * c + (az * v[0] - ax * v[2]) * s + ay * d * (1 - c),
    v[2] * c + (ax * v[1] - ay * v[0]) * s + az * d * (1 - c),
  ];
}

/** Any unit vector perpendicular to `v`. */
export function perp(v) {
  const a = Math.abs(v[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const x = a[1] * v[2] - a[2] * v[1];
  const y = a[2] * v[0] - a[0] * v[2];
  const z = a[0] * v[1] - a[1] * v[0];
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

export const norm3 = v => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
