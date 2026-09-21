/* BuildingGen.js — the houses of Hearthwood.
   ===========================================================================
   Timber-framed, jettied, thatched or shingled, and no two the same. Every
   building is generated from a seed and a footprint; the village layout
   decides where they stand and how big they are, and this file decides what
   they look like standing there.

   WHAT MAKES A MEDIEVAL VILLAGE LOOK MEDIEVAL, in rough order of importance:

     1. THE ROOF IS MOST OF THE BUILDING. Steep — 45 to 55 degrees — and it
        overhangs the walls by a good half metre all round. A shallow roof
        flush with the wall reads as a modern shed however you paint it.
     2. THE JETTY. The upper floor oversails the lower by 20–40 cm on the
        street side, carried on brackets. It is the single most recognisable
        silhouette of the period and it costs eight triangles.
     3. NOTHING IS PLUMB. Every frame gets a small lean, every post a slight
        twist, every ridge a sag. A village of perfectly rectangular boxes
        looks like a diagram of a village.
     4. THE GROUND STOREY IS DARKER AND HEAVIER. Stone or tarred plinth,
        bigger timbers, smaller windows.
     5. LIFE ON THE OUTSIDE. Log piles, barrels, washing, flower boxes,
        leaning tools. Those belong to PropArt, but the building leaves room
        for them: `buildHouse` returns the anchor points.
*/

import * as THREE from '../../lib/three.module.js?v=1790014861';
import { MeshBuilder, box, hexa, beam, cylinder, lathe, blob, tube, quad, tri3, quadIdx } from './Geo.js?v=1790014861';
import { BUILD, METAL, MOSS, mixHex, tweak, shade } from './Palette.js?v=1790014861';
import { orient, lumpWarp } from './TreeGen.js?v=1790014861';
import { makeRng, clamp, lerp, TAU, smoothstep } from '../core/Util.js?v=1790014861';

/* ========================================================================= */
/* WALL PANELS                                                               */
/* ========================================================================= */

/**
 * One timber-framed wall, in the XY plane of its own local space: it runs
 * from x = -w/2 to +w/2 and y = 0 to h, with the outside facing +Z.
 *
 * The daub is a thin slab set slightly BEHIND the timbers rather than flush
 * with them, so the frame casts a shadow onto the panel. That shadow line is
 * what makes a timber-framed wall read as framed rather than as painted.
 */
export function wallPanel(b, {
  w, h, seed = 1, daub = BUILD.daub, timber = BUILD.beam, thick = 0.16,
  studs = 3, braces = true, sill = true, plate = true, lean = 0,
  windows = [], door = null, stonePlinth = 0,
}) {
  const r = makeRng(seed ^ 0x3a11);
  const t = thick;
  const daubHex = tweak(daub, { h: r.range(-0.012, 0.012), l: r.range(0.94, 1.06) });
  const timberHex = tweak(timber, { l: r.range(0.88, 1.12) });

  /* --- the daub panel, set back --------------------------------------- */
  b.color(daubHex, 0.028, r);
  box(b, 0, h / 2 + stonePlinth / 2, -t * 0.28, w, Math.max(0.01, h - stonePlinth), t * 0.55);

  /* --- stone plinth --------------------------------------------------- */
  if (stonePlinth > 0.01) {
    b.color(BUILD.stone, 0.05, r);
    box(b, 0, stonePlinth / 2, 0, w + 0.05, stonePlinth, t * 0.95);
    // a few proud stones so the course is not a smooth band
    for (let i = 0; i < Math.round(w * 2.5); i++) {
      const x = r.range(-w / 2 + 0.1, w / 2 - 0.1);
      b.color(r.chance(0.5) ? BUILD.stoneDark : BUILD.stoneWarm, 0.07, r);
      blob(b, x, r.range(0.05, stonePlinth - 0.05), t * 0.45,
        r.range(0.05, 0.13), 3, 5, lumpWarp(r, 3, 0.3), 0);
    }
  }

  const y0 = stonePlinth;
  const beamW = 0.12, beamD = t * 0.9;

  /* --- sill and wall plate -------------------------------------------- */
  b.color(timberHex, 0.05, r);
  if (sill) box(b, 0, y0 + beamW / 2, 0, w, beamW, beamD);
  if (plate) box(b, 0, h - beamW / 2, 0, w, beamW * 1.2, beamD);

  /* --- corner posts, slightly heavier than the studs ------------------- */
  for (const s of [-1, 1]) {
    box(b, s * (w / 2 - beamW * 0.75), (y0 + h) / 2, 0, beamW * 1.5, h - y0, beamD);
  }

  /* --- studs, unevenly spaced ------------------------------------------ */
  const n = Math.max(1, studs);
  for (let i = 1; i <= n; i++) {
    const x = lerp(-w / 2, w / 2, i / (n + 1)) + r.range(-0.06, 0.06);
    // skip a stud where a door or window would cut through it
    if (door && Math.abs(x - door.x) < door.w * 0.6) continue;
    if (windows.some(wn => Math.abs(x - wn.x) < wn.w * 0.65)) continue;
    box(b, x, (y0 + h) / 2, 0, beamW * (r.chance(0.3) ? 1.15 : 0.9), h - y0, beamD * 0.92);
  }

  /* --- braces: the diagonals that say "this is a frame" ---------------- */
  if (braces && h > 1.6) {
    for (const s of [-1, 1]) {
      const x0 = s * (w / 2 - beamW * 1.5), y1 = y0 + beamW;
      const x1 = s * (w / 2 - Math.min(w * 0.38, h * 0.55)), y2 = y0 + Math.min(h - y0 - beamW, h * 0.55);
      b.color(shade(timberHex, -0.06), 0.04, r);
      beam(b, x0, y1, t * 0.2, x1, y2, t * 0.2, beamW * 0.85, beamD * 0.8, [0, 0, 1]);
    }
  }

  /* --- openings -------------------------------------------------------- */
  for (const wn of windows) buildWindow(b, wn, t, r, timberHex);
  if (door) buildDoor(b, door, t, r, timberHex);
}

/** A small window: a recess, a frame, mullions, glass, and often shutters. */
function buildWindow(b, wn, t, r, timberHex) {
  const { x, y, w, h } = wn;
  // the reveal: a dark recess so the window is a HOLE, not a sticker
  b.color(0x241c16, 0.05, r);
  box(b, x, y, -t * 0.1, w, h, t * 0.5);

  b.color(wn.lit ? BUILD.glassLit : BUILD.glassDark, 0.05, r);
  box(b, x, y, -t * 0.02, w * 0.92, h * 0.92, t * 0.12);

  b.color(timberHex, 0.05, r);
  const fr = 0.055;
  box(b, x, y + h / 2 + fr / 2, t * 0.12, w + fr * 2, fr, t * 0.5);
  box(b, x, y - h / 2 - fr / 2, t * 0.12, w + fr * 2, fr * 1.4, t * 0.6);   // sill, thicker
  box(b, x - w / 2 - fr / 2, y, t * 0.12, fr, h, t * 0.5);
  box(b, x + w / 2 + fr / 2, y, t * 0.12, fr, h, t * 0.5);
  // mullions
  box(b, x, y, t * 0.1, 0.03, h, t * 0.35);
  if (h > 0.5) box(b, x, y, t * 0.1, w, 0.03, t * 0.35);

  if (wn.shutters) {
    const open = r.range(0.55, 1.3);
    for (const s of [-1, 1]) {
      b.color(wn.shutterHex || BUILD.doorPainted, 0.06, r);
      const cx = x + s * (w / 2 + fr + w * 0.5 * Math.cos(open) * 0.55);
      const sub = new MeshBuilder();
      sub.curColor = b.curColor;
      box(sub, 0, 0, 0, w * 0.55, h * 1.05, 0.04);
      // plank lines
      sub.color(shade(wn.shutterHex || BUILD.doorPainted, -0.2), 0.04, r);
      for (let i = -1; i <= 1; i++) box(sub, i * w * 0.16, 0, 0.022, 0.012, h * 1.0, 0.012);
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(cx, y, t * 0.2 + w * 0.26 * Math.sin(open) * s * 0.5),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -s * open * 0.7),
        new THREE.Vector3(1, 1, 1));
      b.append(sub, m);
    }
  }

  if (wn.box) {
    // a flower box under the sill
    b.color(BUILD.plankOld, 0.06, r);
    box(b, x, y - h / 2 - 0.13, t * 0.32, w * 1.05, 0.16, 0.20);
    for (let i = 0; i < r.int(4, 9); i++) {
      const fx = x + r.range(-w * 0.45, w * 0.45);
      b.color(r.pick([0xd2503f, 0xf2cf54, 0xe098b4, 0x9a72c0, 0xf6f4e8]), 0.09, r);
      blob(b, fx, y - h / 2 - 0.045, t * 0.32 + r.range(-0.05, 0.05), r.range(0.03, 0.055), 2, 5, null, 0.35);
    }
    b.color(0x4e7a2e, 0.1, r);
    for (let i = 0; i < 4; i++) {
      blob(b, x + r.range(-w * 0.45, w * 0.45), y - h / 2 - 0.075, t * 0.34, r.range(0.04, 0.07), 2, 5,
        (px, py) => [1, 0.4, 1], 0.3);
    }
  }
}

function buildDoor(b, d, t, r, timberHex) {
  const { x, w, h } = d;
  b.color(0x1e1812, 0.04, r);
  box(b, x, h / 2, -t * 0.12, w, h, t * 0.5);

  const doorHex = d.hex || (r.chance(0.4) ? BUILD.doorPainted : BUILD.door);
  b.color(doorHex, 0.05, r);
  const ajar = d.ajar || 0;
  const sub = new MeshBuilder();
  sub.curColor = b.curColor;
  box(sub, w / 2, 0, 0, w * 0.96, h * 0.97, 0.06);
  // vertical planks and the iron straps across them
  sub.color(shade(doorHex, -0.22), 0.04, r);
  for (let i = 1; i < 4; i++) box(sub, w * (i / 4), 0, 0.034, 0.016, h * 0.93, 0.016);
  sub.color(METAL.iron, 0.06, r);
  for (const yy of [-h * 0.28, h * 0.28]) box(sub, w / 2, yy, 0.038, w * 0.9, 0.035, 0.02);
  sub.color(METAL.bronze, 0.05, r);
  blob(sub, w * 0.85, 0, 0.05, 0.035, 2, 5, null, 0);

  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x - w / 2, h / 2, t * 0.14),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ajar),
    new THREE.Vector3(1, 1, 1));
  b.append(sub, m);

  // lintel and a worn stone step
  b.color(timberHex, 0.05, r);
  box(b, x, h + 0.06, t * 0.16, w + 0.28, 0.14, t * 0.7);
  b.color(BUILD.stone, 0.06, r);
  box(b, x, 0.045, t * 0.5, w + 0.2, 0.09, 0.42);
}

/* ========================================================================= */
/* ROOFS                                                                     */
/* ========================================================================= */

/**
 * A steep gabled roof over a footprint w × d, with the ridge running along X.
 * `overhang` is how far it oversails the walls — see rule 1 at the top.
 */
export function gableRoof(b, {
  w, d, y, pitch = 0.95, overhang = 0.5, seed = 1, kind = 'thatch',
  sag = 0.06, hipped = false,
}) {
  const r = makeRng(seed ^ 0x40f0);
  const W = w + overhang * 2, D = d + overhang * 2;
  const rise = (D / 2) * Math.tan(pitch);
  const ridgeY = y + rise;

  if (kind === 'thatch') {
    buildThatch(b, { W, D, y, ridgeY, seed, sag, r });
  } else {
    buildTiledRoof(b, { W, D, y, ridgeY, seed, sag, r, kind });
  }

  /* --- the gable ends: the triangle of wall under the slope ------------
     Built as a SLAB with thickness rather than as a single triangle with a
     hand-wound copy behind it. A slab cannot be one-sided, cannot be wound
     the wrong way round, and has a visible edge under the barge board, which
     is what a real gable has. */
  const gableHex = kind === 'thatch' ? BUILD.daubWarm : BUILD.daub;
  const apexY = ridgeY - overhang * Math.tan(pitch) * 0.4;
  for (const s of [-1, 1]) {
    const gx = s * (w / 2);
    const inner = gx - s * 0.10;
    b.color(tweak(gableHex, { l: r.range(0.92, 1.05) }), 0.03, r);
    const yy = y - 0.02;
    const out = [s, 0, 0];
    const A = [gx, yy, -d / 2], C = [gx, yy, d / 2], E = [gx, apexY, 0];
    const A2 = [inner, yy, -d / 2], C2 = [inner, yy, d / 2], E2 = [inner, apexY, 0];
    tri3(b, A, C, E, 0, out);                       // outer face
    tri3(b, A2, C2, E2, 0, [-s, 0, 0]);             // inner face
    quad(b, A, C, C2, A2, 0, [0, -1, 0]);           // the sill edge
    quad(b, C, E, E2, C2, 0, [0, 0.5, 0.86]);       // the two rake edges
    quad(b, E, A, A2, E2, 0, [0, 0.5, -0.86]);
    // barge boards along the gable edge
    b.color(BUILD.beam, 0.05, r);
    for (const sd of [-1, 1]) {
      beam(b, gx, apexY, 0, gx, y - 0.05, sd * D / 2, 0.09, 0.14, [1, 0, 0]);
    }
  }

  return { ridgeY, W, D };
}

/**
 * Thatch. The thing that separates thatch from "a roof painted yellow" is
 * THICKNESS: it is half a metre deep at the eaves, rounded over the ridge,
 * and its bottom edge is a thick soft lip, not a sharp line.
 */
function buildThatch(b, { W, D, y, ridgeY, seed, sag, r }) {
  const cols = 9, rows = 5;
  const depth = 0.30 + r.range(0, 0.12);
  const base = tweak(BUILD.thatch, { h: r.range(-0.015, 0.015), l: r.range(0.92, 1.08) });

  for (const side of [-1, 1]) {
    // surface grid from the ridge down to the eaves
    const grid = [];
    for (let j = 0; j <= rows; j++) {
      const t = j / rows;                       // 0 ridge, 1 eaves
      const row = [];
      for (let i = 0; i <= cols; i++) {
        const u = i / cols;
        const x = lerp(-W / 2, W / 2, u);
        // the ridge sags in the middle, which every old roof does
        const sagY = -Math.sin(u * Math.PI) * sag * (1 - t);
        const z = side * (D / 2) * t;
        // the eaves bell outward a little
        const bell = Math.pow(t, 2.2) * depth * 0.55;
        const yy = lerp(ridgeY, y, Math.pow(t, 0.92)) + sagY - bell * 0.4;
        // a lumpy surface: thatch is combed by hand
        const lump = (Math.sin(u * 17 + j) * 0.5 + Math.sin(u * 7.3 + t * 5) * 0.5) * 0.022;
        b.color(mixHex(base, j === rows ? BUILD.thatchOld : base, t * 0.45), 0.055, r);
        row.push(b.vert(x, yy + lump, z + side * bell, 0));
      }
      grid.push(row);
    }
    /* The slope faces UP and AWAY from the ridge. Deriving the winding from
       the geometry rather than from which side we happen to be building
       means a roof cannot come out inside-out, which is precisely what both
       slopes of every thatched roof in the village were doing. */
    const slope = Math.atan2(Math.max(0.01, ridgeY - y), D / 2);
    const face = [0, Math.cos(slope), side * Math.sin(slope)];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        quadIdx(b, grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i], face);
      }
    }
    // the eaves lip: the thick cut edge of the straw
    const lip = [];
    for (let i = 0; i <= cols; i++) {
      const a = grid[rows][i];
      b.color(BUILD.thatchOld, 0.06, r);
      lip.push(b.vert(b.pos[a * 3], b.pos[a * 3 + 1] - depth, b.pos[a * 3 + 2] - side * depth * 0.25, 0));
    }
    for (let i = 0; i < cols; i++) quadIdx(b, grid[rows][i], grid[rows][i + 1], lip[i + 1], lip[i], [0, 0.35, side]);

    /* THE SOFFIT — the underside of the roof.
       A roof built as a single sheet has no underside, and since the eaves
       oversail the walls by half a metre, anyone standing beside the house
       is looking UP at a surface that does not exist: you see straight
       through the roof into the sky. It reads exactly like "one side of the
       roof is invisible", which is what it was. A roof has a thickness, so
       it gets one. */
    const under = [];
    for (let j = 0; j <= rows; j++) {
      const t = j / rows;
      const row = [];
      for (let i = 0; i <= cols; i++) {
        const a = grid[j][i];
        b.color(shade(BUILD.thatchOld, -0.28), 0.04, r);
        row.push(b.vert(
          b.pos[a * 3],
          b.pos[a * 3 + 1] - depth * lerp(0.42, 1.0, t),
          b.pos[a * 3 + 2] - side * depth * lerp(0, 0.25, t), 0));
      }
      under.push(row);
    }
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        quadIdx(b, under[j][i], under[j][i + 1], under[j + 1][i + 1], under[j + 1][i],
          [0, -Math.cos(slope), -side * Math.sin(slope)]);
      }
    }
    // and close the gap between the soffit and the eaves lip
    for (let i = 0; i < cols; i++) {
      quadIdx(b, under[rows][i], under[rows][i + 1], lip[i + 1], lip[i], [0, -0.5, side * 0.86]);
    }

    /* THE ENDS. The roof oversails the gable, so at x = +/-W/2 there is a cut
       edge between the top surface and the soffit. Leaving it open is a
       hairline of missing roof running down the rake of every building in
       the village, which is subtle, permanent, and exactly what you notice. */
    for (const end of [0, cols]) {
      const ex = end === 0 ? -1 : 1;
      b.color(shade(BUILD.thatchOld, -0.12), 0.05, r);
      for (let j = 0; j < rows; j++) {
        quadIdx(b, grid[j][end], grid[j + 1][end], under[j + 1][end], under[j][end], [ex, 0, 0]);
      }
      quadIdx(b, grid[rows][end], lip[end], under[rows][end], under[rows][end], [ex, 0, 0]);
    }
  }

  /* --- the ridge cap, with its pegged straw bindings ------------------- */
  b.color(BUILD.thatchRidge, 0.05, r);
  const capN = 11;
  const cap = [];
  for (let i = 0; i <= capN; i++) {
    const u = i / capN;
    const x = lerp(-W / 2, W / 2, u);
    const sagY = -Math.sin(u * Math.PI) * sag;
    cap.push([x, ridgeY + sagY + 0.06, 0]);
  }
  tube(b, {
    pts: cap, radius: () => 0.17, radial: 6,
    color: (t, i, ang) => shade(BUILD.thatchRidge, Math.sin(ang * 3 + t * 20) * 0.10),
    capStart: true, capEnd: true, sway: () => 0,
  });
  // the hazel spars pinning the ridge down
  b.color(0x6f5a3c, 0.08, r);
  for (let i = 0; i < Math.round(W * 1.2); i++) {
    const x = lerp(-W / 2 + 0.2, W / 2 - 0.2, i / Math.max(1, Math.round(W * 1.2) - 1));
    beam(b, x, ridgeY + 0.2, -0.22, x, ridgeY + 0.2, 0.22, 0.03, 0.03, [0, 1, 0]);
  }
  // moss on the shaded slope, because a thatch roof is a garden
  if (r.chance(0.6)) {
    const n = r.int(4, 14);
    for (let i = 0; i < n; i++) {
      const x = r.range(-W / 2 + 0.3, W / 2 - 0.3);
      const t = r.range(0.25, 0.9);
      b.color(mixHex(MOSS.deep, MOSS.mid, r()), 0.1, r);
      blob(b, x, lerp(ridgeY, y, t) + 0.02, -(D / 2) * t, r.range(0.06, 0.18), 3, 5,
        (px, py) => [1, 0.3, 1], 0);
    }
  }
}

/** Shingles or clay tiles: flat planes with real overlapping courses. */
function buildTiledRoof(b, { W, D, y, ridgeY, seed, sag, r, kind }) {
  const clay = kind === 'tile';
  const baseHex = clay ? BUILD.tileClay : BUILD.shingle;
  const oldHex = clay ? BUILD.tileClayOld : BUILD.shingleMoss;
  const courses = Math.max(5, Math.round((D / 2) / 0.30));
  const cols = Math.max(4, Math.round(W / 0.75));
  const LIFT = 0.035;
  /* every course oversails the one below it, and the bottom one therefore
     oversails the eaves — the soffit has to reach that far too */
  const over = 0.09 / courses;
  const drop = 0.11;

  for (const side of [-1, 1]) {
    const ang = Math.atan2(ridgeY - y, D / 2);
    const faceDir = [0, Math.cos(ang), side * Math.sin(ang)];
    for (let j = 0; j < courses; j++) {
      const t0 = j / courses, t1 = (j + 1) / courses;
      /* ONE set of column edges per course, shared by neighbours.
         Each slab used to jitter its own left and right edge independently,
         so the right edge of one tile and the left edge of the next landed up
         to 2 cm apart — a full-height slit between every pair of tiles, all
         the way down the roof. From the ground they read as a roof you can
         see daylight through. The ends are pinned to +/-W/2 exactly so the
         gable closure below meets them with nothing in between. */
      const xs = [], yAs = [], yBs = [];
      const ridgeSag = lerp(ridgeY, y, t0), eaveSag = lerp(ridgeY, y, t1 + over);
      for (let i = 0; i <= cols; i++) {
        const x = i === 0 ? -W / 2 : i === cols ? W / 2
          : lerp(-W / 2, W / 2, i / cols) + r.range(-0.01, 0.01);
        xs.push(x);
        /* The sag is evaluated at the edge's OWN x. It used to be evaluated
           once per slab from its left edge and applied to both, so every slab
           sat a millimetre or two off its neighbour and the seam between them
           was open. Sharing the edge is only watertight if the height on that
           edge is shared too. */
        const u = (x + W / 2) / W;
        const s = Math.sin(u * Math.PI) * sag;
        yAs.push(ridgeSag - s * (1 - t0));
        yBs.push(eaveSag - s * (1 - t1));
      }
      const zA = side * (D / 2) * t0, zB = side * (D / 2) * (t1 + over);
      // each course is a thin slab that overhangs the one below it
      for (let i = 0; i < cols; i++) {
        const x0 = xs[i], x1 = xs[i + 1];
        const hex = mixHex(baseHex, oldHex, Math.pow(r(), 1.5) * 0.85);
        b.color(hex, 0.055, r);
        const p = [
          [x0, yAs[i] + LIFT, zA], [x1, yAs[i + 1] + LIFT, zA],
          [x1, yBs[i + 1] + LIFT * 0.4, zB], [x0, yBs[i] + LIFT * 0.4, zB],
        ];
        quad(b, p[0], p[1], p[2], p[3], 0, faceDir);
        // the visible lip of the course below
        const lp = [
          [x0, yBs[i] + LIFT * 0.4, zB], [x1, yBs[i + 1] + LIFT * 0.4, zB],
          [x1, yBs[i + 1], zB], [x0, yBs[i], zB],
        ];
        b.color(shade(hex, -0.3), 0.04, r);
        quad(b, lp[0], lp[1], lp[2], lp[3], 0, [0, 0.4, side]);
      }
    }
  }

  /* The soffit. See the note in buildThatch: a roof with no underside is a
     roof you can see the sky through from under the eaves. */
  for (const side of [-1, 1]) {
    const ang = Math.atan2(ridgeY - y, D / 2);
    /* The eaves line the soffit has to reach is the BOTTOM COURSE's edge, not
       the nominal eaves: the courses each oversail by `over`, so the lowest
       one hangs past y / D/2 and its underside was open sky. */
    const eaveY = lerp(ridgeY, y, 1 + over);
    const eaveZ = side * (D / 2) * (1 + over);
    /* And the gable closure has to reach the top of the TILES, which sit LIFT
       above the bare rafter line it used to be drawn to — a 3.5 cm slit down
       the whole length of both rakes. LIFT is added at BOTH ends rather than
       only at the ridge, because the tile surface is a staircase: it returns
       to full LIFT at the start of every course, so a closure that tapers
       back to the rafter line is under the tiles again by mid-slope. The
       sliver of closure standing proud of the tiles is a barge board, which
       is what a real rake has anyway. */
    b.color(shade(BUILD.beam, 0.10), 0.04, r);
    quad(b, [-W / 2, ridgeY - drop, 0], [W / 2, ridgeY - drop, 0],
      [W / 2, eaveY - drop, eaveZ], [-W / 2, eaveY - drop, eaveZ],
      0, [0, -Math.cos(ang), -side * Math.sin(ang)]);
    // the cut edge of the roof at the eaves
    b.color(shade(clay ? BUILD.tileClayOld : BUILD.shingle, -0.3), 0.04, r);
    quad(b, [-W / 2, eaveY, eaveZ], [W / 2, eaveY, eaveZ],
      [W / 2, eaveY - drop, eaveZ], [-W / 2, eaveY - drop, eaveZ],
      0, [0, -0.3, side]);
    // and the ends, where the roof oversails the gable
    for (const ex of [-1, 1]) {
      quad(b, [ex * W / 2, ridgeY + LIFT, 0], [ex * W / 2, eaveY + LIFT, eaveZ],
        [ex * W / 2, eaveY - drop, eaveZ], [ex * W / 2, ridgeY - drop, 0], 0, [ex, 0, 0]);
    }
  }

  b.color(clay ? BUILD.tileClayOld : BUILD.shingleMoss, 0.05, r);
  const cap = [];
  for (let i = 0; i <= 9; i++) {
    const u = i / 9;
    cap.push([lerp(-W / 2, W / 2, u), ridgeY - Math.sin(u * Math.PI) * sag + 0.04, 0]);
  }
  tube(b, { pts: cap, radius: () => 0.10, radial: 5, capStart: true, capEnd: true, sway: () => 0 });
}

/* ========================================================================= */
/* CHIMNEY                                                                   */
/* ========================================================================= */

export function buildChimney(b, { x, z, y0, y1, seed = 1, w = 0.55, kind = 'stone' }) {
  const r = makeRng(seed ^ 0xc411);
  const hex = kind === 'brick' ? 0x9a5a44 : BUILD.chimney;
  b.color(hex, 0.05, r);
  box(b, x, (y0 + y1) / 2, z, w, y1 - y0, w * 0.85);
  // rough stones so the stack is not a smooth column
  const n = Math.round((y1 - y0) * 7);
  for (let i = 0; i < n; i++) {
    const yy = lerp(y0 + 0.1, y1 - 0.1, i / Math.max(1, n - 1));
    const a = r.range(0, TAU);
    b.color(r.chance(0.5) ? BUILD.stoneDark : BUILD.stoneWarm, 0.07, r);
    blob(b, x + Math.cos(a) * w * 0.45, yy, z + Math.sin(a) * w * 0.42,
      r.range(0.05, 0.11), 3, 5, lumpWarp(r, 3, 0.35), 0);
  }
  // the cap
  b.color(shade(hex, -0.12), 0.05, r);
  box(b, x, y1 + 0.06, z, w * 1.35, 0.12, w * 1.2);
  b.color(0x1a1512, 0.04, r);
  box(b, x, y1 + 0.14, z, w * 0.45, 0.06, w * 0.38);
  return { x, y: y1 + 0.18, z };
}

/* ========================================================================= */
/* WHOLE BUILDINGS                                                           */
/* ========================================================================= */

/**
 * A village house.
 *
 * @returns {{
 *   w:number, d:number, height:number, ridgeY:number,
 *   doorAt:[number,number], smokeAt:[number,number,number]|null,
 *   lights:Array<{x,y,z,c}>, blockers:Array<{x,z,r}>
 * }}
 */
export function buildHouse(b, {
  seed = 1, w = 6, d = 5, storeys = 2, roof = null, lit = false, yawFacing = 0,
  role = 'house',
} = {}) {
  const r = makeRng(seed ^ 0x4075e);
  const storeyH = [2.35, 2.1];
  const jetty = storeys > 1 && r.chance(0.7) ? r.range(0.18, 0.36) : 0;
  const roofKind = roof || r.weighted([
    { k: 'thatch', w: 5 }, { k: 'shingle', w: 3 }, { k: 'tile', w: 2 },
  ], x => x.w).k;
  const daub = r.pick([BUILD.daub, BUILD.daubWarm, BUILD.daubPink, BUILD.daubGreen, BUILD.daub]);
  const timber = r.chance(0.25) ? BUILD.beamPale : BUILD.beam;
  const shutterHex = r.pick([BUILD.doorPainted, BUILD.clothRed, BUILD.clothBlue, BUILD.clothGreen, BUILD.plankOld]);
  const lights = [];
  const blockers = [];

  let y = 0;
  let cw = w, cd = d;

  for (let s = 0; s < storeys; s++) {
    const h = storeyH[Math.min(s, 1)] * r.range(0.94, 1.08);
    const isTop = s === storeys - 1;
    // the jetty: the upper floor oversails the lower
    if (s > 0 && jetty > 0) { cw = w + jetty * 2; cd = d + jetty * 2; }

    const sub = new MeshBuilder();
    for (let face = 0; face < 4; face++) {
      const along = face % 2 === 0 ? cw : cd;
      const out = face % 2 === 0 ? cd / 2 : cw / 2;
      const ang = face * Math.PI / 2;

      const wins = [];
      const nW = Math.max(1, Math.round(along / 2.4));
      for (let i = 0; i < nW; i++) {
        if (r.chance(0.22)) continue;
        const wx = lerp(-along / 2, along / 2, (i + 1) / (nW + 1)) + r.range(-0.12, 0.12);
        const ww = r.range(0.42, 0.68) * (s === 0 ? 0.92 : 1.1);
        wins.push({
          x: wx, y: h * r.range(0.52, 0.64), w: ww, h: ww * r.range(0.9, 1.35),
          lit, shutters: r.chance(0.45), shutterHex,
          box: s > 0 && r.chance(0.35),
        });
        if (lit) {
          const c = Math.cos(ang), sn = Math.sin(ang);
          lights.push({
            x: wx * c + out * sn, y: y + h * 0.58, z: -wx * sn + out * c, c: BUILD.lanternGlow, i: 0.35,
          });
        }
      }

      // the door goes on the front face of the ground floor only
      let door = null;
      if (s === 0 && face === 0) {
        door = {
          x: r.range(-along * 0.22, along * 0.22), w: r.range(0.85, 1.05),
          h: r.range(1.75, 1.95), ajar: r.chance(0.25) ? r.range(0.2, 0.9) : 0,
        };
      }

      const panel = new MeshBuilder();
      wallPanel(panel, {
        w: along, h, seed: seed + face * 31 + s * 7, daub, timber,
        studs: Math.max(1, Math.round(along / 1.5)),
        braces: r.chance(0.8), windows: wins, door,
        stonePlinth: s === 0 ? r.range(0.25, 0.55) : 0,
      });
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(Math.sin(ang) * out, 0, Math.cos(ang) * out),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang),
        new THREE.Vector3(1, 1, 1));
      sub.append(panel, m);
    }

    // a small lean so no wall is truly plumb
    const tilt = r.range(-0.012, 0.012);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(0, y, 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, 0, r.range(-0.012, 0.012))),
      new THREE.Vector3(1, 1, 1));
    b.append(sub, m);

    /* --- jetty brackets -------------------------------------------------- */
    if (s > 0 && jetty > 0) {
      b.color(BUILD.beam, 0.06, r);
      for (const [ax, az, n] of [[1, 0, Math.round(cd / 1.6)], [0, 1, Math.round(cw / 1.6)]]) {
        for (let i = 0; i < n; i++) {
          for (const sgn of [-1, 1]) {
            const along = ax ? cd : cw;
            const t = lerp(-along / 2 + 0.4, along / 2 - 0.4, n === 1 ? 0.5 : i / (n - 1));
            const ox = ax ? sgn * (cw / 2 - jetty * 0.4) : t;
            const oz = ax ? t : sgn * (cd / 2 - jetty * 0.4);
            beam(b, ox * (ax ? 1 : 1), y - 0.05, oz,
              ox * (ax ? 0.82 : 1), y - jetty * 1.5, oz * (ax ? 1 : 0.82),
              0.10, 0.10, [0, 1, 0]);
          }
        }
      }
    }

    y += h;
  }

  /* --- roof ------------------------------------------------------------- */
  const pitch = r.range(0.85, 1.12);
  const overhang = r.range(0.38, 0.62);
  const rf = gableRoof(b, {
    w: cw, d: cd, y, pitch, overhang, seed, kind: roofKind, sag: r.range(0.03, 0.12),
  });

  /* --- chimney ---------------------------------------------------------- */
  let smokeAt = null;
  if (r.chance(0.85)) {
    const cx = r.range(-cw * 0.3, cw * 0.3);
    const cz = r.range(-cd * 0.2, cd * 0.2);
    const top = buildChimney(b, {
      x: cx, z: cz, y0: y - 1.2, y1: rf.ridgeY + r.range(0.35, 0.9), seed,
      w: r.range(0.45, 0.68), kind: r.chance(0.3) ? 'brick' : 'stone',
    });
    smokeAt = [top.x, top.y, top.z];
  }

  /* --- eaves timbers and rafter ends, which read at any distance -------- */
  b.color(BUILD.beam, 0.05, r);
  const nR = Math.max(3, Math.round(cw / 0.8));
  for (let i = 0; i < nR; i++) {
    const x = lerp(-cw / 2 + 0.2, cw / 2 - 0.2, i / (nR - 1));
    for (const s of [-1, 1]) {
      beam(b, x, y + 0.02, s * cd / 2, x, y - 0.12, s * (cd / 2 + overhang * 0.75), 0.07, 0.09, [0, 1, 0]);
    }
  }

  blockers.push({ x: 0, z: 0, r: Math.max(cw, cd) * 0.5 });

  return {
    w: cw, d: cd, height: y, ridgeY: rf.ridgeY,
    doorAt: [0, cd / 2 + 0.6], smokeAt, lights, blockers, roofKind, role,
  };
}

/**
 * An open-fronted workshop: a timber shed with its front wall replaced by a
 * counter and a pair of posts. Everything inside is visible from the street,
 * which is how a medieval shop worked and — conveniently — means the game
 * never needs an interior.
 */
export function buildWorkshop(b, { seed = 1, w = 7, d = 5.5, lit = true } = {}) {
  const r = makeRng(seed ^ 0x5401);
  const h = 2.6;
  const lights = [];

  /* three walls */
  const sub = new MeshBuilder();
  for (const face of [1, 2, 3]) {
    const along = face % 2 === 0 ? w : d;
    const out = face % 2 === 0 ? d / 2 : w / 2;
    const ang = face * Math.PI / 2;
    const wins = [];
    if (face === 2) {
      wins.push({ x: r.range(-1, 1), y: h * 0.6, w: 0.7, h: 0.6, lit, shutters: true, shutterHex: BUILD.plankOld });
    }
    const panel = new MeshBuilder();
    wallPanel(panel, {
      w: along, h, seed: seed + face * 17, daub: BUILD.daubWarm, timber: BUILD.beam,
      studs: Math.max(1, Math.round(along / 1.3)), braces: true, windows: wins,
      stonePlinth: 0.35,
    });
    sub.append(panel, new THREE.Matrix4().compose(
      new THREE.Vector3(Math.sin(ang) * out, 0, Math.cos(ang) * out),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang),
      new THREE.Vector3(1, 1, 1)));
  }
  b.append(sub);

  /* the open front: two heavy posts, a head beam, and the counter */
  b.color(BUILD.beam, 0.06, r);
  for (const s of [-1, 1]) {
    beam(b, s * (w / 2 - 0.12), 0, d / 2, s * (w / 2 - 0.12), h, d / 2, 0.20, 0.20, [0, 1, 0]);
  }
  beam(b, -w / 2, h - 0.12, d / 2, w / 2, h - 0.12, d / 2, 0.24, 0.22, [0, 1, 0]);
  // braces in the corners of the opening
  for (const s of [-1, 1]) {
    beam(b, s * (w / 2 - 0.2), h - 0.9, d / 2, s * (w / 2 - 1.0), h - 0.24, d / 2, 0.12, 0.12, [0, 0, 1]);
  }

  /* the counter — a thick worn plank across the opening, with a gap to get in */
  const gap = r.range(0.9, 1.3);
  const gapAt = r.range(-w * 0.15, w * 0.15);
  b.color(BUILD.plank, 0.07, r);
  for (const s of [-1, 1]) {
    const inner = gapAt + s * gap / 2;
    const outer = s * (w / 2 - 0.12);
    if (Math.abs(outer - inner) < 0.3) continue;
    box(b, (inner + outer) / 2, 0.95, d / 2 - 0.05, Math.abs(outer - inner), 0.11, 0.55);
    b.color(BUILD.plankOld, 0.06, r);
    box(b, (inner + outer) / 2, 0.45, d / 2 - 0.05, Math.abs(outer - inner) * 0.9, 0.7, 0.10);
    b.color(BUILD.plank, 0.07, r);
  }

  const rf = gableRoof(b, {
    w, d, y: h, pitch: r.range(0.8, 1.0), overhang: r.range(0.55, 0.8), seed,
    kind: r.chance(0.6) ? 'shingle' : 'thatch', sag: r.range(0.04, 0.10),
  });

  const smoke = buildChimney(b, {
    x: -w * 0.3, z: -d * 0.25, y0: h - 0.8, y1: rf.ridgeY + 0.5, seed, w: 0.5, kind: 'stone',
  });

  lights.push({ x: 0, y: 1.9, z: d * 0.1, c: BUILD.lanternGlow, i: 1.1 });
  lights.push({ x: -w * 0.3, y: 0.7, z: -d * 0.28, c: BUILD.fire, i: 0.9 });

  return {
    w, d, height: h, ridgeY: rf.ridgeY,
    counterZ: d / 2, counterY: 1.0, gapAt, gap,
    smokeAt: [smoke.x, smoke.y, smoke.z], lights,
    blockers: [{ x: 0, z: -d * 0.1, r: Math.max(w, d) * 0.42 }],
  };
}

/** A barn or store: big, plain, planked, with a wide door. */
export function buildBarn(b, { seed = 1, w = 8, d = 6 } = {}) {
  const r = makeRng(seed ^ 0xba21);
  const h = 3.2;
  const sub = new MeshBuilder();
  for (let face = 0; face < 4; face++) {
    const along = face % 2 === 0 ? w : d;
    const out = face % 2 === 0 ? d / 2 : w / 2;
    const ang = face * Math.PI / 2;
    const panel = new MeshBuilder();
    // vertical boarding rather than daub
    const hex = r.chance(0.5) ? BUILD.plankOld : BUILD.plank;
    panel.color(hex, 0.05, r);
    box(panel, 0, h / 2, -0.06, along, h, 0.12);
    const n = Math.round(along / 0.35);
    for (let i = 0; i < n; i++) {
      panel.color(tweak(hex, { l: r.range(0.82, 1.18) }), 0.04, r);
      box(panel, lerp(-along / 2, along / 2, (i + 0.5) / n), h / 2, 0.01, along / n * 0.88, h, 0.05);
    }
    panel.color(BUILD.beam, 0.05, r);
    box(panel, 0, h - 0.1, 0.04, along, 0.18, 0.14);
    box(panel, 0, 0.1, 0.04, along, 0.18, 0.14);
    if (face === 0) {
      buildDoor(panel, { x: 0, w: 2.2, h: 2.6, hex: BUILD.plankOld, ajar: r.chance(0.5) ? r.range(0.3, 1.1) : 0 }, 0.14, r, BUILD.beam);
    }
    sub.append(panel, new THREE.Matrix4().compose(
      new THREE.Vector3(Math.sin(ang) * out, 0, Math.cos(ang) * out),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang),
      new THREE.Vector3(1, 1, 1)));
  }
  b.append(sub);
  const rf = gableRoof(b, { w, d, y: h, pitch: r.range(0.7, 0.9), overhang: 0.45, seed, kind: 'thatch', sag: 0.14 });
  return { w, d, height: h, ridgeY: rf.ridgeY, lights: [], blockers: [{ x: 0, z: 0, r: Math.max(w, d) * 0.5 }] };
}

/** The mill: a house with a great wheel on one flank. */
export function buildMill(b, { seed = 1, w = 7, d = 6 } = {}) {
  const r = makeRng(seed ^ 0x8111);
  const house = buildHouse(b, { seed, w, d, storeys: 2, roof: 'shingle', lit: true, role: 'mill' });

  /* the wheel */
  const R = 2.3, wheelZ = d / 2 + 0.9, wheelX = w / 2 + 0.55;
  const spokes = 10;
  b.color(BUILD.plankOld, 0.06, r);
  for (const off of [-0.35, 0.35]) {
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * TAU;
      beam(b, wheelX + off, R + 0.3, wheelZ - d / 2 + 1.2,
        wheelX + off, R + 0.3 + Math.sin(a) * R, wheelZ - d / 2 + 1.2 + Math.cos(a) * R,
        0.09, 0.09, [1, 0, 0]);
    }
  }
  // rim and paddles
  for (let i = 0; i < spokes * 2; i++) {
    const a = (i / (spokes * 2)) * TAU;
    const a2 = ((i + 1) / (spokes * 2)) * TAU;
    b.color(BUILD.plank, 0.07, r);
    for (const off of [-0.35, 0.35]) {
      beam(b,
        wheelX + off, R + 0.3 + Math.sin(a) * R, wheelZ - d / 2 + 1.2 + Math.cos(a) * R,
        wheelX + off, R + 0.3 + Math.sin(a2) * R, wheelZ - d / 2 + 1.2 + Math.cos(a2) * R,
        0.08, 0.14, [1, 0, 0]);
    }
    if (i % 2 === 0) {
      b.color(BUILD.plankOld, 0.06, r);
      box(b, wheelX, R + 0.3 + Math.sin(a) * R * 0.88, wheelZ - d / 2 + 1.2 + Math.cos(a) * R * 0.88, 0.8, 0.05, 0.05);
    }
  }
  b.color(METAL.ironDark, 0.05, r);
  cylinder(b, 0, 0, 0, 0, 0.001, 0.001, 3);   // keep the builder's colour state honest
  b.color(BUILD.beam, 0.05, r);
  beam(b, wheelX - 0.6, R + 0.3, wheelZ - d / 2 + 1.2, wheelX + 0.6, R + 0.3, wheelZ - d / 2 + 1.2, 0.16, 0.16, [0, 1, 0]);

  house.wheel = { x: wheelX, y: R + 0.3, z: wheelZ - d / 2 + 1.2, r: R };
  house.blockers.push({ x: wheelX, z: wheelZ - d / 2 + 1.2, r: 1.0 });
  return house;
}
