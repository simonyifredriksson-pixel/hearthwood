/* Outpost.js — the eight villages that are not home.
   ===========================================================================
   WHY THIS IS NOT Village.js. The home village is the tutorial: it has the
   Stickwright, the festival, the forge cutscene and a hand-placed workshop,
   and half the game's scripting knows where things are in it. Generalising
   that file into a template would have put all of it at risk to gain
   nothing. So home keeps its bespoke builder and the other eight are built
   here, from a STYLE.

   AND A STYLE IS GEOMETRY, NOT A PALETTE. The brief's rule was that a
   village should look like it belongs where it is, so the style decides:

     WALL      daub panels / dry stone courses / stacked logs / boards /
               cut sandstone — five different ways of making a wall, each
               with its own silhouette at the corners.
     ROOF      thatch, shingle, slate, snow-laden, flat, reed, tile. Pitch
               and overhang come with it: a snow roof is steep with deep
               eaves because snow has to come off it.
     FOOTING   a plinth of stone, or STILTS over water, or TERRACES cut
               into a slope. This is the biggest single difference — a
               village on stilts and a village on terraces do not read as
               the same place with different paint.
     LAYOUT    a ring round a green, a crescent along a shoreline, or two
               rows stacked up a canyon wall.

   Everything is placed relative to the village's own centre and lake, so a
   village works wherever the terrain put it.
*/

import * as THREE from '../../lib/three.module.js?v=1790102737';
import { MeshBuilder, box, hexa, beam, cylinder, lathe, blob, quad, tube, sheet } from '../art/Geo.js?v=1790102737';
import * as P from '../art/PropArt.js?v=1790102737';
import { buildTree } from '../art/TreeGen.js?v=1790102737';
import { buildBush, buildFlower, buildGrassTuft } from '../art/PlantGen.js?v=1790102737';
import { BUILD, GROUND, PLANT, MOSS, BARK, METAL, mixHex, tweak, shade } from '../art/Palette.js?v=1790102737';
import { WORLD } from '../core/Config.js?v=1790102737';
import { makeRng, clamp, clamp01, lerp, TAU, smoothstep } from '../core/Util.js?v=1790102737';

const UP = new THREE.Vector3(0, 1, 0);

/* ========================================================================= */
/* PLANNING                                                                  */
/* ========================================================================= */

/**
 * Work out where everything goes, and tell the TERRAIN about it.
 *
 * Runs before a single terrain vertex exists, because registering the bowl
 * and the lake is what makes the ground under the village flat and the
 * water in front of it wet. Getting this order wrong gives you houses
 * hovering over a hillside — which is the note at the top of Village.js and
 * it is just as true here.
 */
export function planOutpost(T, def) {
  const r = makeRng((WORLD.seed ^ 0x51a7) + def.id.length * 7919 + Math.round(def.x));
  const S = def.style;

  /* --- the bowl --------------------------------------------------------- */
  /* A MOUNTAIN VILLAGE NEEDS A BIGGER, HARDER BOWL.
     The first pass used one radius and softened the flattening wherever
     the village was terraced, and Lastlight came out with sixteen metres
     of mountainside across its green — you could not have walked from one
     side of it to the other. Terracing is a per-house LIFT, not a reason
     to leave the ground alone, so the bowl is firm everywhere and simply
     reaches further where the land is steep. */
  const steep = T.slope(def.x, def.z, 14) > 0.22 || S.terrace > 0;
  const datum = T.addBowl(def.x, def.z, def.core, def.core * (steep ? 2.0 : 1.55),
    def.datum ?? null, 0.95);

  /* --- the water -------------------------------------------------------- */
  let lake = null;
  if (def.water.kind === 'lake') {
    /* the lake sits beside the green rather than under it, on whichever
       side the land already falls away — a lake uphill of a village looks
       like somebody put it there */
    let bestA = 0, bestFall = -Infinity;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      const d = def.core * 0.5 + def.water.r * 0.8;
      const h = T.landHeight(def.x + Math.cos(a) * d, def.z + Math.sin(a) * d);
      if (datum - h > bestFall) { bestFall = datum - h; bestA = a; }
    }
    /* CLOSE ENOUGH TO BE THE VILLAGE'S LAKE.
       The first pass put it a full core-radius clear of the green plus its
       own radius again, which on a big lake is a hundred and fifty metres —
       so the village had a green with nothing in it and its houses were
       strung round water you could not see from the middle. It is the
       village's front garden now. */
    const off = def.core * 0.45 + def.water.r * 0.72;
    const lx = def.x + Math.cos(bestA) * off;
    const lz = def.z + Math.sin(bestA) * off;
    const level = T.addLake(lx, lz, def.water.r, def.water.depth, datum - 1.4);
    lake = { x: lx, z: lz, r: def.water.r, depth: def.water.depth, level, angle: bestA };
  }

  /* --- the lots --------------------------------------------------------- */
  const lots = [];
  const n = S.low ? 11 : 14;
  const layout = S.terrace ? 'terrace' : (lake && (S.jetties || S.stilts) ? 'crescent' : 'ring');

  if (layout === 'crescent' && lake) {
    /* a shoreline village: houses strung along the water's edge, all facing
       it, at a range of distances so the line is not a wall */
    const a0 = lake.angle + Math.PI;           // looking from the lake back at the green
    /* A CRESCENT HAS TO BE TIGHT ENOUGH TO READ AS ONE.
       Spread over a hundred and thirty degrees at a range of distances it
       is not a crescent, it is nine houses that happen to be near the same
       lake — from any viewpoint you could see three of them. Ninety
       degrees of arc and a narrow band of depth gives a shoreline row. */
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1)) - 0.5;
      const a = lake.angle + t * 1.55;
      /* OUTSIDE THE WATER, not on its edge. The lake MESH reaches 1.06 of
         the lake radius and the bed is still near the bottom out to 0.98
         of it, so houses placed at `r + a few metres` stood in the lake —
         Fenmoor came out looking like a flood rather than a fen. */
      const rad = lake.r * (1.14 + (i % 2) * 0.16) + r.range(1, 5);
      const x = lake.x + Math.cos(a) * rad;
      const z = lake.z + Math.sin(a) * rad;
      lots.push({
        x, z, yaw: Math.atan2(lake.x - x, lake.z - z),
        w: r.range(5, 7.5), d: r.range(4.5, 6), storeys: r.pick(S.storeys),
        over: S.stilts > 0 && T.height(x, z) < lake.level + 0.6,
      });
    }
  } else if (layout === 'terrace') {
    /* cut into a slope: two or three shelves, each a row of houses, with
       the rows offset so you can see the one behind */
    const rows = 3;
    for (let row = 0; row < rows; row++) {
      const per = row === 0 ? 6 : 4;
      for (let i = 0; i < per; i++) {
        const t = (i + (row % 2) * 0.5) / per - 0.5;
        const a = (lake ? lake.angle + Math.PI : 0) + t * 1.5;
        const rad = def.core * (0.42 + row * 0.26);
        const x = def.x + Math.cos(a) * rad;
        const z = def.z + Math.sin(a) * rad;
        lots.push({
          x, z, yaw: Math.atan2(def.x - x, def.z - z) + Math.PI,
          w: r.range(4.5, 6.5), d: r.range(4, 5.5), storeys: r.pick(S.storeys),
          lift: row * S.terrace,
        });
      }
    }
  } else {
    /* the ordinary answer: a ring round a green, facing in */
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + r.range(-0.12, 0.12);
      const rad = def.core * r.range(0.50, 0.72);
      const x = def.x + Math.cos(a) * rad;
      const z = def.z + Math.sin(a) * rad;
      lots.push({
        x, z, yaw: Math.atan2(def.x - x, def.z - z),
        w: r.range(5, 7), d: r.range(4.5, 6), storeys: r.pick(S.storeys),
      });
    }
  }

  /* --- AND NOTHING STANDS IN THE WATER ----------------------------------
     The crescent layout works this out for itself, because it is laid out
     FROM the lake. The ring and the terrace are laid out from the green,
     and if the lake happens to sit under the ring — which it does at
     Thornhollow and Coldhollow, by as much as nineteen metres — houses go
     in the lake. Rather than teach each layout about the water, every lot
     is pushed clear at the end: one rule, in one place, that a tenth
     layout added later gets for free.

     Pushed OUTWARD from the lake centre rather than nudged aside, so a
     house keeps the bearing it was given and stays facing the green. */
  if (lake) {
    const keepOut = lake.r * 1.14 + 2.5;
    for (const l of lots) {
      const dx = l.x - lake.x, dz = l.z - lake.z;
      const d = Math.hypot(dx, dz);
      if (d >= keepOut) continue;
      if (d < 1e-3) { l.x = lake.x + keepOut; continue; }   // dead centre
      l.x = lake.x + (dx / d) * keepOut;
      l.z = lake.z + (dz / d) * keepOut;
      /* it moved, so it is looking at the wrong thing now */
      l.yaw = Math.atan2(def.x - l.x, def.z - l.z);
    }
  }

  /* register the pads so the ground flattens under each house */
  for (const l of lots) T.addFlat(l.x, l.z, Math.max(l.w, l.d) * 0.6, undefined);

  /* --- the fishing booth, on the shore ---------------------------------- */
  let booth = null;
  if (lake) {
    const a = lake.angle + Math.PI;            // the bank nearest the green
    const bx = lake.x + Math.cos(a) * (lake.r + 3.4);
    const bz = lake.z + Math.sin(a) * (lake.r + 3.4);
    booth = { x: bx, z: bz, yaw: Math.atan2(lake.x - bx, lake.z - bz) };
    T.addFlat(bx, bz, 3.2, undefined);
  } else {
    /* the home-style answer: find the riverbank */
    booth = { x: def.x + 30, z: def.z, yaw: -Math.PI / 2 };
  }

  /* --- LANES ------------------------------------------------------------
     The outposts had no paths at all. Houses stood on flattened pads in
     open grass, and the difference between that and the home village —
     which has had a path graph since the first day — is most of why the
     later places felt like models rather than settlements. A village is
     a set of routes with buildings along them; without the routes it is
     a collection of sheds.

     Registered with the terrain BEFORE anything is placed, because
     addPath flattens the ground under a lane and everything downstream
     reads heights. Doing it after is how you get a road cut through a
     house that was already standing on the old ground. */
  const paths = [];
  const lane = (ax, az, bx, bz, w) => {
    paths.push({ ax, az, bx, bz, w });
    T.addPath(ax, az, bx, bz, w);
  };

  {
    /* a spine from the green down to the water, which is the walk every
       player makes and therefore the one that has to exist */
    if (lake) {
      const a = lake.angle + Math.PI;
      lane(def.x, def.z,
        lake.x + Math.cos(a) * (lake.r + 4.5), lake.z + Math.sin(a) * (lake.r + 4.5), 3.2);
    }

    /* A STREET, NOT A SUNBURST.
       The first version ran a straight spur from the green to every
       single house, and from above that is a wagon wheel — fourteen
       radial spokes, unmistakably generated. Villages do not work like
       that. They have a lane, and the houses stand along it.

       So: one curved street threaded through the ring the houses sit
       on, wandering a little so it is not a compass arc, and a SHORT
       stub from each house to its nearest point on that street. Most
       houses end up a couple of metres off the lane, which is exactly
       what a village looks like from the air. */
    const ring = lots.length
      ? lots.reduce((s, l) => s + Math.hypot(l.x - def.x, l.z - def.z), 0) / lots.length
      : def.core * 0.55;

    /* the street runs round most of the ring, but not all of it: a
       closed circle reads as a racetrack, and leaving a gap gives the
       village a back. */
    const a0 = (lake ? lake.angle + Math.PI : 0) + r.range(-0.5, 0.5);
    const sweep = r.range(3.9, 5.2);
    const STEPS = 9;
    const street = [];
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const a = a0 + t * sweep;
      /* the wander: two slow sines, so the lane breathes in and out of
         the ring instead of tracing it */
      const rr = ring * (1 + Math.sin(t * 3.1 + 0.7) * 0.10 + Math.sin(t * 7.3) * 0.045);
      street.push([def.x + Math.cos(a) * rr, def.z + Math.sin(a) * rr]);
    }
    for (let i = 0; i < street.length - 1; i++) {
      lane(street[i][0], street[i][1], street[i + 1][0], street[i + 1][1], 2.6);
    }
    /* and one lane in from the green to meet it, so the centre is joined */
    lane(def.x, def.z, street[Math.floor(STEPS * 0.5)][0], street[Math.floor(STEPS * 0.5)][1], 2.4);

    /* THE STUBS. Nearest point on the street, and only if the house is
       not already standing on it — a two-metre path to a lane you are
       already touching is a smear, not a path. */
    for (const l of lots) {
      let best = null, bd = Infinity;
      for (let i = 0; i < street.length - 1; i++) {
        const [ax, az] = street[i], [bx, bz] = street[i + 1];
        const vx = bx - ax, vz = bz - az;
        const len2 = vx * vx + vz * vz || 1;
        const t = clamp(((l.x - ax) * vx + (l.z - az) * vz) / len2, 0, 1);
        const px = ax + vx * t, pz = az + vz * t;
        const d = Math.hypot(l.x - px, l.z - pz);
        if (d < bd) { bd = d; best = [px, pz]; }
      }
      const doorstep = Math.max(l.w, l.d) * 0.55;
      if (!best || bd < doorstep + 0.8) continue;
      const dx = best[0] - l.x, dz = best[1] - l.z;
      const d = Math.hypot(dx, dz) || 1;
      lane(l.x + (dx / d) * doorstep, l.z + (dz / d) * doorstep, best[0], best[1], 1.8);
    }
  }

  /* --- A LANDMARK -------------------------------------------------------
     One large distinctive thing per village, visible over the roofs, so
     each place is recognisable from the approach and from the map. This
     is what turns "another village" into "oh, the one with the tower".
     Chosen from the village's own terrain and style rather than at
     random, so it always belongs where it is standing. */
  const landmark = pickLandmark(def, S, lake, r);
  if (landmark) T.addFlat(landmark.x, landmark.z, 4.0, undefined);

  return { def, style: S, datum, lake, lots, booth, paths, landmark, seed: r.seed() };
}

/**
 * WHAT THIS VILLAGE IS KNOWN FOR, as a building.
 *
 * Driven off the terrain and the architecture, never rolled blind: a
 * lighthouse belongs on a big lake and nowhere else, a watchtower
 * belongs on high stone ground, a drying rack belongs where the fishing
 * is the whole economy. Picking at random would give Stonecrag a
 * fishing shrine and Fenmoor a bell tower, and the point of a landmark
 * is that it tells you something true about the place.
 */
function pickLandmark(def, S, lake, r) {
  const at = (ax, az) => ({ x: ax, z: az });
  /* off the green, far enough not to crowd the centre */
  const ang = r.range(0, TAU);
  const rad = def.core * 0.42;
  const px = def.x + Math.cos(ang) * rad;
  const pz = def.z + Math.sin(ang) * rad;

  if (lake && lake.r >= 48) return { kind: 'lighthouse', ...at(px, pz), h: 9.5 };
  if (S.snow) return { kind: 'bell', ...at(px, pz), h: 7.0 };
  if (S.wall === 'stone') return { kind: 'tower', ...at(px, pz), h: 10.5 };
  if (S.stilts > 0.3) return { kind: 'racks', ...at(px, pz), h: 4.2 };
  if (S.terrace > 0) return { kind: 'shrine', ...at(px, pz), h: 5.0 };
  return { kind: 'greattree', ...at(px, pz), h: 12.0 };
}

/* ========================================================================= */
/* BUILDING                                                                  */
/* ========================================================================= */

export function buildOutpost(T, plan) {
  const def = plan.def, S = plan.style;
  const r = makeRng(plan.seed ^ 0x9e11);

  const cells = [];
  const CELLS = 3;
  const span = def.r * 2.1;
  for (let j = 0; j < CELLS; j++) {
    for (let i = 0; i < CELLS; i++) {
      cells.push({
        solid: new MeshBuilder(), flora: new MeshBuilder(), glow: new MeshBuilder(),
        x0: def.x - def.r * 1.05 + (i * span) / CELLS,
        z0: def.z - def.r * 1.05 + (j * span) / CELLS,
      });
    }
  }
  const cellAt = (x, z) => {
    const i = clamp(Math.floor((x - (def.x - def.r * 1.05)) / (span / CELLS)), 0, CELLS - 1);
    const j = clamp(Math.floor((z - (def.z - def.r * 1.05)) / (span / CELLS)), 0, CELLS - 1);
    return cells[j * CELLS + i];
  };

  const blockers = [], lights = [], npcSpots = [], smokes = [];
  const put = (group, sub, x, z, yaw = 0, yOff = 0, scale = 1) => {
    const c = cellAt(x, z);
    c[group].append(sub, new THREE.Matrix4().compose(
      new THREE.Vector3(x, T.height(x, z) + yOff, z),
      new THREE.Quaternion().setFromAxisAngle(UP, yaw),
      new THREE.Vector3(scale, scale, scale)));
  };

  /* --- the houses -------------------------------------------------------- */
  for (const lot of plan.lots) {
    const sub = new MeshBuilder(), g = new MeshBuilder();
    const info = buildLodge(sub, {
      seed: r.seed(), style: S, w: lot.w, d: lot.d,
      storeys: lot.storeys, glow: g,
      /* STILTS ARE CAPPED. The height is "however far it is down to the
         water", which is fine over a fen and absurd on a mountainside —
         Stillwater's first build had houses on nine-metre posts hanging
         off a cliff like a pier to nowhere. Three metres is a stilt; more
         than that is a scaffold. */
      stilt: clamp(lot.over
        ? Math.max(S.stilts, (plan.lake?.level ?? 0) - T.height(lot.x, lot.z) + 0.6)
        : S.stilts, 0, 3.0),
      lift: lot.lift || 0,
    });
    put('solid', sub, lot.x, lot.z, lot.yaw, lot.lift || 0);
    if (!g.isEmpty) put('glow', g, lot.x, lot.z, lot.yaw, lot.lift || 0);
    blockers.push({ x: lot.x, z: lot.z, r: Math.max(lot.w, lot.d) * 0.48 });
    const base = T.height(lot.x, lot.z) + (lot.lift || 0);
    for (const L of info.lights) {
      const c = Math.cos(lot.yaw), s = Math.sin(lot.yaw);
      lights.push({
        x: lot.x + L.x * c + L.z * s, y: base + L.y, z: lot.z - L.x * s + L.z * c,
        color: S.lantern, intensity: L.i ?? 0.9,
      });
    }
    if (info.chimney) {
      smokes.push({ x: lot.x, y: base + info.chimney, z: lot.z, rate: r.range(0.5, 1.1) });
    }
    /* somebody lives here */
    const c = Math.cos(lot.yaw), s = Math.sin(lot.yaw);
    npcSpots.push({
      x: lot.x + Math.sin(lot.yaw) * (lot.d * 0.5 + 1.4),
      z: lot.z + Math.cos(lot.yaw) * (lot.d * 0.5 + 1.4),
      kind: 'door', yaw: lot.yaw + Math.PI, village: def.id,
    });
  }

  /* --- the fishing booth and its keeper --------------------------------- */
  {
    const sub = new MeshBuilder(), g = new MeshBuilder();
    const tone = boothTone(S);
    const info = P.buildFishStall(sub, { seed: r.seed(), w: 2.9, d: 1.7, tone, glow: g });
    put('solid', sub, plan.booth.x, plan.booth.z, plan.booth.yaw);
    if (!g.isEmpty) put('glow', g, plan.booth.x, plan.booth.z, plan.booth.yaw);
    const c = Math.cos(plan.booth.yaw), s = Math.sin(plan.booth.yaw);
    const L2W = (lx, lz) => [plan.booth.x + lx * c + lz * s, plan.booth.z - lx * s + lz * c];
    for (const b of info.blockers) {
      const [wx, wz] = L2W(b.x, b.z);
      blockers.push({ x: wx, z: wz, r: b.r, low: b.low });
    }
    lights.push({
      x: plan.booth.x, y: T.height(plan.booth.x, plan.booth.z) + info.light.y,
      z: plan.booth.z, color: S.lantern, intensity: 1.3,
    });
    const [sx, sz] = L2W(info.standAt[0], info.standAt[1]);
    const [tx, tz] = L2W(info.talkAt[0], info.talkAt[1]);
    plan.fishery = {
      x: plan.booth.x, z: plan.booth.z, yaw: plan.booth.yaw,
      standAt: [sx, sz], talkAt: [tx, tz],
      water: plan.lake ? [plan.lake.x, plan.lake.z] : [plan.booth.x + 6, plan.booth.z],
      castAt: plan.lake
        ? [lerp(plan.booth.x, plan.lake.x, 0.35), lerp(plan.booth.z, plan.lake.z, 0.35)]
        : [plan.booth.x + 5, plan.booth.z],
      village: def.id,
    };
    npcSpots.push({ x: sx, z: sz, kind: 'fishstall', yaw: plan.booth.yaw, village: def.id });
  }

  /* --- what the biome puts on the ground -------------------------------- */
  dressOutpost(T, plan, put, r, blockers, lights, npcSpots);

  return {
    id: def.id, def, cells, blockers, lights, npcSpots, smokes,
    lake: plan.lake, fishery: plan.fishery, plan,
  };
}

function boothTone(S) {
  return {
    timber: S.wall === 'stone' ? 0x8c8478 : S.wall === 'log' ? 0x6a5334 : BUILD.plankOld,
    post: S.beam, cloth: S.trim, roof: S.roofCols[0], sign: S.lantern, net: 0xbfb48c,
  };
}

/* ========================================================================= */
/* A HOUSE                                                                   */
/* ========================================================================= */

/**
 * One building, in whatever the village is made of.
 *
 * Kept deliberately separate from BuildingGen's `buildHouse`: that one is
 * the home village's timber-framed cottage and it is full of decisions
 * about jetties and shutters that are right for exactly one place. This is
 * the same job written to be told what to be.
 */
export function buildLodge(b, { seed = 1, style, w = 6, d = 5, storeys = 1, glow = null, stilt = 0, lift = 0 } = {}) {
  const r = makeRng(seed ^ 0x10d6e);
  const S = style;
  const lights = [];
  const wallH = S.low ? 2.15 : 2.45;
  let y = 0;

  /* --- STILTS, and the deck they carry ---------------------------------- */
  if (stilt > 0.2) {
    b.color(shade(S.beam, -0.1), 0.07, r);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        beam(b, sx * (w / 2 - 0.3), -stilt - 1.2, sz * (d / 2 - 0.3),
          sx * (w / 2 - 0.3), 0, sz * (d / 2 - 0.3), 0.16, 0.16, [0, 1, 0]);
      }
    }
    // cross bracing, which is what makes stilts read as engineering
    for (const sz of [-1, 1]) {
      beam(b, -(w / 2 - 0.3), -stilt * 0.55, sz * (d / 2 - 0.3),
        (w / 2 - 0.3), -stilt * 0.2, sz * (d / 2 - 0.3), 0.08, 0.08, [0, 1, 0]);
    }
    /* the deck: boards, with a gap you can see the water through */
    const nb = Math.max(6, Math.round(w / 0.3));
    for (let i = 0; i < nb; i++) {
      b.color(tweak(BUILD.plankOld, { l: r.range(0.85, 1.15) }), 0.06, r);
      box(b, lerp(-w / 2 - 0.5, w / 2 + 0.5, (i + 0.5) / nb), -0.06, 0,
        ((w + 1) / nb) * 0.88, 0.09, d + 1.0);
    }
    /* a rail along the front */
    b.color(S.beam, 0.06, r);
    for (const sx of [-1, 1]) beam(b, sx * (w / 2 + 0.45), 0, d / 2 + 0.45, sx * (w / 2 + 0.45), 0.95, d / 2 + 0.45, 0.07, 0.07, [0, 1, 0]);
    beam(b, -(w / 2 + 0.45), 0.9, d / 2 + 0.45, (w / 2 + 0.45), 0.9, d / 2 + 0.45, 0.06, 0.06, [0, 1, 0]);
  }

  /* --- THE PLINTH -------------------------------------------------------- */
  if (S.plinth > 0.05) {
    b.color(mixHex(0x8c8478, GROUND.stone ?? 0x9a948a, 0.4), 0.09, r);
    const n = Math.round((w + d) / 0.55);
    for (let i = 0; i < n; i++) {
      const t = i / n, a = t * TAU;
      const ex = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a));
      const px = ex ? Math.sign(Math.cos(a)) * w / 2 : Math.cos(a) * w * 0.62;
      const pz = ex ? Math.sin(a) * d * 0.62 : Math.sign(Math.sin(a)) * d / 2;
      blob(b, px, S.plinth * r.range(0.3, 0.62), pz, r.range(0.17, 0.27), 2, 5,
        (x, yy, z) => [1.3, 0.75, 1.3]);
    }
    box(b, 0, S.plinth * 0.5, 0, w + 0.12, S.plinth, d + 0.12);
    y += S.plinth;
  }

  /* --- THE WALLS --------------------------------------------------------- */
  for (let s = 0; s < storeys; s++) {
    const h = wallH * (s ? 0.86 : 1);
    const cw = w - s * 0.2, cd = d - s * 0.2;
    const col = r.pick(S.wallCols);
    buildWall(b, r, S, cw, cd, h, y, col, s === 0);
    /* a lit window on the front */
    if (r.chance(0.85)) {
      lights.push({ x: r.range(-cw * 0.2, cw * 0.2), y: y + h * 0.55, z: cd / 2 + 0.2, i: 0.85 });
    }
    y += h;
  }

  /* --- THE ROOF ---------------------------------------------------------- */
  const roof = buildRoof(b, r, S, w, d, y);

  /* --- A CHIMNEY --------------------------------------------------------- */
  let chimney = 0;
  const wantChimney = (S.chimneys ?? (r.chance(0.55) ? 1 : 0));
  if (wantChimney) {
    const cx = w * r.range(0.18, 0.32) * r.sign();
    const ch = y + roof.height + 0.55;
    b.color(S.wall === 'sandstone' ? 0xc89464 : 0x7a7068, 0.08, r);
    for (let i = 0; i < 9; i++) {
      box(b, cx, lerp(y - 0.4, ch, i / 9), -d * 0.22, 0.58, (ch - y + 0.4) / 9 * 1.05, 0.58);
    }
    b.color(0x4a4238, 0.06, r);
    box(b, cx, ch + 0.08, -d * 0.22, 0.7, 0.14, 0.7);
    chimney = ch + 0.2;
  }

  /* --- WHAT THE BIOME HANGS ON IT ---------------------------------------- */
  if (S.awnings) {
    b.color(S.trim, 0.06, r);
    for (let i = 0; i < 4; i++) {
      const t = (i + 0.5) / 4;
      sheet(b, [lerp(-w / 2, w / 2, t - 0.12), y - 0.1, d / 2],
        [lerp(-w / 2, w / 2, t + 0.12), y - 0.1, d / 2],
        [lerp(-w / 2, w / 2, t + 0.12), y - 0.5, d / 2 + 1.1],
        [lerp(-w / 2, w / 2, t - 0.12), y - 0.5, d / 2 + 1.1], 0.02);
    }
  }
  if (S.mossy) {
    b.color(MOSS.deep ?? 0x4a6a34, 0.10, r);
    for (let i = 0; i < Math.round(S.mossy * 16); i++) {
      const a = r.range(0, TAU);
      blob(b, Math.cos(a) * w * 0.5, r.range(0.1, y * 0.8), Math.sin(a) * d * 0.5,
        r.range(0.10, 0.24), 2, 5, (x, yy, z) => [1, 0.4, 1]);
    }
  }
  if (S.ladders) {
    b.color(S.beam, 0.07, r);
    const lx = w / 2 - 0.4;
    for (const sz of [-0.2, 0.2]) {
      beam(b, lx, 0, d / 2 + sz, lx, y + 0.5, d / 2 + sz, 0.06, 0.06, [0, 1, 0]);
    }
    for (let i = 0; i < 7; i++) {
      const ry = 0.3 + (i / 7) * (y + 0.1);
      beam(b, lx, ry, d / 2 - 0.2, lx, ry, d / 2 + 0.2, 0.05, 0.05, [0, 0, 1]);
    }
  }

  /* --- the door ---------------------------------------------------------- */
  {
    const dh = 1.85, dw = 0.95;
    b.color(shade(S.beam, 0.12), 0.06, r);
    box(b, 0, S.plinth + dh / 2, d / 2 + 0.03, dw + 0.16, dh + 0.14, 0.09);
    b.color(S.trim, 0.06, r);
    box(b, 0, S.plinth + dh / 2, d / 2 + 0.08, dw, dh, 0.06);
    b.color(METAL.iron, 0.05, r);
    blob(b, dw * 0.32, S.plinth + dh * 0.5, d / 2 + 0.13, 0.05, 2, 5);
  }

  return { lights, chimney, height: y + roof.height };
}

/* --- walls, five ways ----------------------------------------------------- */

function buildWall(b, r, S, w, d, h, y, col, ground) {
  const faces = [[w, d / 2, 0], [d, w / 2, Math.PI / 2], [w, -d / 2, Math.PI], [d, -w / 2, -Math.PI / 2]];

  if (S.wall === 'log') {
    /* STACKED LOGS with the ends crossing at the corners, which is the
       whole silhouette of a log cabin and is visible from any angle */
    const rows = Math.max(5, Math.round(h / 0.30));
    for (let i = 0; i < rows; i++) {
      const ly = y + (i + 0.5) * (h / rows);
      const rr = (h / rows) * 0.58;
      b.color(tweak(col, { l: r.range(0.86, 1.14) }), 0.07, r);
      const along = i % 2 === 0;
      if (along) {
        for (const sz of [-1, 1]) {
          tube(b, {
            pts: [[-w / 2 - 0.22, ly, sz * d / 2], [w / 2 + 0.22, ly, sz * d / 2]],
            radius: () => rr, radial: 6, capStart: true, capEnd: true, sway: () => 0,
          });
        }
      } else {
        for (const sx of [-1, 1]) {
          tube(b, {
            pts: [[sx * w / 2, ly, -d / 2 - 0.22], [sx * w / 2, ly, d / 2 + 0.22]],
            radius: () => rr, radial: 6, capStart: true, capEnd: true, sway: () => 0,
          });
        }
      }
    }
    /* chinking between the logs */
    b.color(mixHex(col, 0xe8e0c8, 0.55), 0.05, r);
    box(b, 0, y + h / 2, 0, w - 0.06, h, d - 0.06);
    return;
  }

  if (S.wall === 'stone' || S.wall === 'sandstone') {
    /* DRY STONE: courses of blocks with the joints staggered. Sandstone is
       cut square and laid regular; hill stone is rubble and is not. */
    const cut = S.wall === 'sandstone';
    const rows = Math.max(5, Math.round(h / (cut ? 0.34 : 0.28)));
    for (const [along, out, ang] of faces) {
      const ca = Math.cos(ang), sa = Math.sin(ang);
      for (let i = 0; i < rows; i++) {
        const ly = y + (i + 0.5) * (h / rows);
        const per = Math.max(3, Math.round(along / (cut ? 0.5 : 0.42)));
        for (let k = 0; k < per; k++) {
          const t = (k + 0.5 + (i % 2) * 0.5) / per;
          const px = lerp(-along / 2, along / 2, t % 1);
          b.color(tweak(col, { l: r.range(0.84, 1.16) }), cut ? 0.05 : 0.10, r);
          const bw = (along / per) * (cut ? 0.94 : r.range(0.8, 1.0));
          const bh = (h / rows) * (cut ? 0.9 : r.range(0.75, 0.98));
          const X = px * ca + out * sa, Z = -px * sa + out * ca;
          if (cut) box(b, X, ly, Z, Math.abs(ca) > 0.5 ? bw : 0.22, bh, Math.abs(ca) > 0.5 ? 0.22 : bw);
          else blob(b, X, ly, Z, Math.min(bw, bh) * 0.62, 2, 5, (xx, yy, zz) => [1.5, 0.9, 0.7]);
        }
      }
    }
    b.color(shade(col, -0.18), 0.05, r);
    box(b, 0, y + h / 2, 0, w - 0.18, h, d - 0.18);
    return;
  }

  if (S.wall === 'plank') {
    for (const [along, out, ang] of faces) {
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const n = Math.max(4, Math.round(along / 0.26));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const px = lerp(-along / 2, along / 2, t);
        b.color(tweak(col, { l: r.range(0.84, 1.16) }), 0.06, r);
        const X = px * ca + out * sa, Z = -px * sa + out * ca;
        box(b, X, y + h / 2, Z,
          Math.abs(ca) > 0.5 ? (along / n) * 0.9 : 0.07, h,
          Math.abs(ca) > 0.5 ? 0.07 : (along / n) * 0.9);
      }
    }
    b.color(shade(col, -0.2), 0.05, r);
    box(b, 0, y + h / 2, 0, w - 0.1, h, d - 0.1);
    /* corner posts */
    b.color(S.beam, 0.06, r);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      beam(b, sx * w / 2, y, sz * d / 2, sx * w / 2, y + h, sz * d / 2, 0.14, 0.14, [0, 1, 0]);
    }
    return;
  }

  /* DAUB: panels between a timber frame — the home village's look */
  b.color(col, 0.05, r);
  box(b, 0, y + h / 2, 0, w, h, d);
  b.color(S.beam, 0.06, r);
  for (const [along, out, ang] of faces) {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const studs = Math.max(2, Math.round(along / 1.3));
    for (let k = 0; k <= studs; k++) {
      const px = lerp(-along / 2 + 0.1, along / 2 - 0.1, k / studs);
      const X = px * ca + out * sa * 1.01, Z = -px * sa + out * ca * 1.01;
      box(b, X, y + h / 2, Z,
        Math.abs(ca) > 0.5 ? 0.16 : 0.1, h, Math.abs(ca) > 0.5 ? 0.1 : 0.16);
    }
    const X = out * sa * 1.01, Z = out * ca * 1.01;
    box(b, X, y + 0.08, Z, Math.abs(ca) > 0.5 ? along : 0.12, 0.16, Math.abs(ca) > 0.5 ? 0.12 : along);
    box(b, X, y + h - 0.08, Z, Math.abs(ca) > 0.5 ? along : 0.12, 0.16, Math.abs(ca) > 0.5 ? 0.12 : along);
  }
}

/* --- roofs, seven ways ---------------------------------------------------- */

function buildRoof(b, r, S, w, d, y) {
  const kind = S.roof;
  const PITCH = { thatch: 0.62, shingle: 0.52, slate: 0.48, snow: 0.86, flat: 0.06, reed: 0.58, tile: 0.5 }[kind] ?? 0.55;
  const OVER = { thatch: 0.5, shingle: 0.36, slate: 0.3, snow: 0.72, flat: 0.5, reed: 0.55, tile: 0.34 }[kind] ?? 0.4;
  const h = d * PITCH;
  const col = () => tweak(r.pick(S.roofCols), { l: r.range(0.86, 1.14) });

  if (kind === 'flat') {
    /* a canyon roof: a parapet and a usable terrace on top */
    b.color(col(), 0.06, r);
    box(b, 0, y + 0.16, 0, w + OVER * 2, 0.3, d + OVER * 2);
    b.color(shade(S.wallCols[0], -0.1), 0.06, r);
    for (const [aw, ad, ox, oz] of [[w + OVER * 2, 0.2, 0, d / 2 + OVER], [w + OVER * 2, 0.2, 0, -(d / 2 + OVER)],
    [0.2, d + OVER * 2, w / 2 + OVER, 0], [0.2, d + OVER * 2, -(w / 2 + OVER), 0]]) {
      box(b, ox, y + 0.52, oz, aw, 0.44, ad);
    }
    return { height: 0.75 };
  }

  /* a gabled roof: two slopes and two closed ends */
  const hw = w / 2 + OVER, hd = d / 2 + OVER;
  const rows = kind === 'thatch' || kind === 'reed' ? 7 : 9;
  for (const side of [-1, 1]) {
    for (let i = 0; i < rows; i++) {
      const t0 = i / rows, t1 = (i + 1) / rows;
      const z0 = side * lerp(hd, 0, t0), z1 = side * lerp(hd, 0, t1);
      const y0 = y + lerp(0, h, t0), y1 = y + lerp(0, h, t1);
      const sag = (kind === 'thatch' || kind === 'reed') ? Math.sin(t0 * Math.PI) * 0.07 : 0;
      b.color(col(), kind === 'thatch' ? 0.10 : 0.06, r);
      /* a thick slab per course, so the roof has an edge you can see */
      const th = kind === 'snow' ? 0.22 : kind === 'thatch' ? 0.3 : 0.12;
      hexa(b, [
        [-hw, y0 - sag, z0], [hw, y0 - sag, z0], [hw, y0 - sag + th, z0], [-hw, y0 - sag + th, z0],
        [-hw, y1, z1], [hw, y1, z1], [hw, y1 + th, z1], [-hw, y1 + th, z1],
      ]);
    }
  }
  /* the gable ends, filled in */
  b.color(shade(S.wallCols[0], -0.06), 0.05, r);
  for (const sx of [-1, 1]) {
    quad(b, [sx * w / 2, y, -d / 2], [sx * w / 2, y, d / 2], [sx * w / 2, y + h, 0], [sx * w / 2, y + h, 0],
      null, [sx, 0, 0]);
  }
  /* the ridge */
  b.color(shade(S.roofCols[0], -0.16), 0.07, r);
  box(b, 0, y + h + (kind === 'snow' ? 0.18 : 0.09), 0, w + OVER * 2 + 0.1, 0.16, 0.30);

  /* snow lies on top, in a lumpy blanket that overhangs the eaves */
  if (kind === 'snow' || S.snow >= 1) {
    b.color(0xf4f8fc, 0.03, r);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 9; i++) {
        const t = i / 9;
        const z = side * lerp(hd + 0.1, 0, t);
        const yy = y + lerp(0.12, h + 0.2, t);
        for (let k = 0; k <= 6; k++) {
          blob(b, lerp(-hw, hw, k / 6), yy + r.range(0.0, 0.07), z, r.range(0.22, 0.34), 2, 5,
            (x, yv, zv) => [1.4, 0.55, 1.1]);
        }
      }
    }
  }
  return { height: h + 0.3 };
}

/* ========================================================================= */
/* LANDMARKS                                                                 */
/* ========================================================================= */

/**
 * The one thing each village is known for.
 *
 * All six are built from the same primitives the houses use, at roughly
 * twice the height of a roof, so they clear the skyline of the place
 * without turning it into a city. Each one is also a REASON: a
 * lighthouse says the lake is big enough to get lost on, drying racks
 * say the village lives on fish, a watchtower says somebody was worried
 * about something. A landmark that does not explain its village is just
 * a big prop.
 */
function buildLandmark(T, plan, put, r, blockers, lights, npcSpots) {
  const L = plan.landmark, S = plan.style, def = plan.def;
  const b = new MeshBuilder(), g = new MeshBuilder();
  const ground = T.height(L.x, L.z);
  const H = L.h;

  switch (L.kind) {
    case 'lighthouse': {
      /* a tapering stone drum with a lamp room and a gallery */
      b.color(mixHex(S.wallCols[0], 0xffffff, 0.25), 0.07, r);
      lathe(b, [[1.5, 0], [1.35, H * 0.35], [1.05, H * 0.72], [0.98, H * 0.80]], 12);
      /* banded, because a lighthouse without bands is a chimney */
      b.color(shade(S.trim, -0.05), 0.05, r);
      for (let i = 0; i < 3; i++) {
        const y = H * (0.16 + i * 0.22);
        lathe(b, [[1.42 - i * 0.12, y], [1.46 - i * 0.12, y + 0.55], [1.42 - i * 0.12, y + 1.1]], 12);
      }
      b.color(S.beam, 0.06, r);                       // the gallery
      lathe(b, [[1.5, H * 0.80], [1.55, H * 0.84], [1.0, H * 0.86]], 12);
      b.color(0x3a4048, 0.05, r);                     // the lamp room posts
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        beam(b, Math.cos(a) * 0.9, H * 0.86, Math.sin(a) * 0.9,
          Math.cos(a) * 0.9, H * 0.86 + 1.5, Math.sin(a) * 0.9, 0.09, 0.09, [0, 1, 0]);
      }
      b.color(0x2e343a, 0.05, r);                     // the cap
      lathe(b, [[1.25, H * 0.86 + 1.5], [0.9, H * 0.86 + 2.1], [0.1, H * 0.86 + 2.6]], 10);
      b.color(0xfff0b8, 0.03, r);
      blob(b, 0, H * 0.86 + 0.75, 0, 0.62, 3, 9);
      g.color(0xffe08a, 0.05, r);
      blob(g, 0, H * 0.86 + 0.75, 0, 1.05, 3, 9);
      lights.push({ x: L.x, y: ground + H * 0.86 + 0.75, z: L.z, color: 0xffd98a, intensity: 3.4 });
      blockers.push({ x: L.x, z: L.z, r: 1.7 });
      break;
    }
    case 'tower': {
      /* a square stone watchtower with a timber top storey */
      b.color(S.wallCols[1] ?? S.wallCols[0], 0.08, r);
      for (let i = 0; i < 5; i++) {
        const y = i * (H * 0.62 / 5), w = 2.6 - i * 0.10;
        box(b, 0, y + H * 0.062, 0, w, H * 0.124, w);
      }
      b.color(S.beam, 0.07, r);
      box(b, 0, H * 0.70, 0, 3.0, H * 0.16, 3.0);     // the jettied top
      b.color(S.roofCols[0], 0.07, r);
      lathe(b, [[2.4, H * 0.78], [1.4, H * 0.95], [0, H * 1.02]], 4, 0, 0);
      b.color(0x2a2620, 0.05, r);                     // the window slits
      for (const s of [-1, 1]) box(b, s * 1.32, H * 0.40, 0, 0.08, 0.9, 0.34);
      lights.push({ x: L.x, y: ground + H * 0.72, z: L.z, color: BUILD.lanternGlow, intensity: 1.6 });
      blockers.push({ x: L.x, z: L.z, r: 1.8 });
      break;
    }
    case 'bell': {
      /* an open belfry on four legs, for weather and for warnings */
      b.color(S.beam, 0.08, r);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        beam(b, sx * 1.5, 0, sz * 1.5, sx * 0.75, H * 0.66, sz * 0.75, 0.18, 0.18, [0, 1, 0]);
      }
      b.color(shade(S.beam, -0.12), 0.06, r);         // cross-bracing
      for (const s of [-1, 1]) {
        beam(b, s * 1.35, H * 0.22, -1.35, s * 0.95, H * 0.50, 1.35, 0.10, 0.10, [0, 1, 0]);
      }
      b.color(S.roofCols[0], 0.07, r);
      lathe(b, [[1.5, H * 0.66], [0.9, H * 0.86], [0, H * 0.95]], 6, 0, 0);
      b.color(METAL.brass ?? 0xb08a3a, 0.05, r);      // the bell
      lathe(b, [[0.10, H * 0.64], [0.52, H * 0.44], [0.58, H * 0.30], [0.30, H * 0.28]], 10);
      blockers.push({ x: L.x, z: L.z, r: 1.6 });
      npcSpots.push({ x: L.x + 2.2, z: L.z, kind: 'bell', yaw: -Math.PI / 2, village: def.id });
      break;
    }
    case 'racks': {
      /* DRYING RACKS: rows of split fish hung to cure. The clearest
         possible statement that this village lives on the water. */
      b.color(BARK.oak, 0.08, r);
      for (let row = 0; row < 3; row++) {
        const z0 = (row - 1) * 2.4;
        for (const s of [-1, 1]) {
          beam(b, s * 2.6, 0, z0, s * 2.6, H, z0, 0.13, 0.13, [0, 1, 0]);
        }
        b.color(shade(BARK.oak, -0.1), 0.06, r);
        for (let bar = 0; bar < 3; bar++) {
          const y = H * (0.45 + bar * 0.22);
          beam(b, -2.6, y, z0, 2.6, y, z0, 0.07, 0.07, [0, 1, 0]);
          /* the fish, as simple flattened leaves of silver */
          b.color(mixHex(0xc8d4d8, 0xa89a78, r.range(0, 0.5)), 0.09, r);
          for (let k = 0; k < 9; k++) {
            const x = -2.3 + k * 0.58;
            blob(b, x, y - 0.42, z0, 0.19, 2, 6, () => [0.30, 1.9, 0.95]);
          }
          b.color(shade(BARK.oak, -0.1), 0.06, r);
        }
        b.color(BARK.oak, 0.08, r);
      }
      blockers.push({ x: L.x, z: L.z, r: 2.4 });
      npcSpots.push({ x: L.x, z: L.z + 3.4, kind: 'racks', yaw: 0, village: def.id });
      break;
    }
    case 'shrine': {
      /* a little stone shrine on the terrace, with a lantern in it */
      b.color(mixHex(S.wallCols[0], 0x9a9284, 0.5), 0.09, r);
      lathe(b, [[1.9, 0], [1.7, 0.4], [1.5, 0.55]], 8);   // the plinth
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + Math.PI / 4;
        beam(b, Math.cos(a) * 1.0, 0.55, Math.sin(a) * 1.0,
          Math.cos(a) * 1.0, H * 0.72, Math.sin(a) * 1.0, 0.16, 0.16, [0, 1, 0]);
      }
      b.color(S.roofCols[0], 0.07, r);
      lathe(b, [[1.8, H * 0.72], [1.1, H * 0.90], [0, H * 1.0]], 8, 0, 0);
      b.color(0xffe4a8, 0.04, r);
      blob(b, 0, H * 0.46, 0, 0.34, 3, 8);
      g.color(0xffd98a, 0.05, r);
      blob(g, 0, H * 0.46, 0, 0.62, 3, 8);
      lights.push({ x: L.x, y: ground + H * 0.46, z: L.z, color: 0xffd08a, intensity: 2.0, flicker: true });
      blockers.push({ x: L.x, z: L.z, r: 1.5 });
      npcSpots.push({ x: L.x + 2.4, z: L.z + 0.6, kind: 'shrine', yaw: -Math.PI / 2, village: def.id });
      break;
    }
    default: {
      /* THE GREAT TREE. The village grew up round something that was
         already here, which is how most villages actually happen. */
      const sub = new MeshBuilder();
      buildTree(sub, {
        species: (S.treeMix && S.treeMix[0]) || 'oak',
        seed: r.seed(), lod: 0, scale: 1.9, mossy: 0.5,
      });
      b.append(sub, new THREE.Matrix4().makeTranslation(0, 0, 0));
      /* a bench round the trunk, which is what makes it a place rather
         than a big plant */
      b.color(BUILD.plankOld, 0.08, r);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        box(b, Math.cos(a) * 1.9, 0.42, Math.sin(a) * 1.9, 1.1, 0.10, 0.42);
        b.color(shade(BUILD.plankOld, -0.15), 0.06, r);
        box(b, Math.cos(a) * 1.9, 0.20, Math.sin(a) * 1.9, 0.14, 0.40, 0.14);
        b.color(BUILD.plankOld, 0.08, r);
      }
      blockers.push({ x: L.x, z: L.z, r: 1.3 });
      npcSpots.push({ x: L.x + 2.6, z: L.z, kind: 'tree', yaw: -Math.PI / 2, village: def.id });
      break;
    }
  }

  put('solid', b, L.x, L.z, r.range(0, TAU));
  if (!g.isEmpty) put('glow', g, L.x, L.z, 0);
}

/* ========================================================================= */
/* WHAT THE BIOME PUTS ON THE GROUND                                         */
/* ========================================================================= */

function dressOutpost(T, plan, put, r, blockers, lights, npcSpots) {
  const def = plan.def, S = plan.style, lake = plan.lake;

  /* --- THE LANES, laid as trodden ground -------------------------------
     The terrain has already been flattened along them by planOutpost;
     this is the surface you can see. Worn earth with the village's own
     path material scattered over it, narrowing at the ends so a lane
     fades into the grass instead of stopping at a hard line. */
  for (const p of plan.paths || []) {
    const len = Math.hypot(p.bx - p.ax, p.bz - p.az);
    const n = Math.max(2, Math.round(len / 1.1));
    const sub = new MeshBuilder();
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = lerp(p.ax, p.bx, t), z = lerp(p.az, p.bz, t);
      /* taper both ends so the lane is not a stripe with square corners */
      const fade = Math.min(1, Math.min(t, 1 - t) * 5 + 0.25);
      const w = p.w * 0.5 * fade;
      const col = S.path === 'board' ? BUILD.plankOld : GROUND.dirt ?? 0x6b5a42;
      sub.color(tweak(col, { l: r.range(0.88, 1.12) }), 0.07, r);
      const y = T.height(x, z) + 0.02;
      if (S.path === 'board') {
        box(sub, x - def.x, y - T.height(def.x, def.z), z - def.z, w * 2, 0.06, 1.0);
      } else {
        /* a patch of bare earth rather than a plank: two overlapping
           quads per step, jittered, so the edge is ragged */
        for (let k = 0; k < 2; k++) {
          const jx = r.range(-0.25, 0.25), jz = r.range(-0.25, 0.25);
          blob(sub, x - def.x + jx, y - T.height(def.x, def.z) - 0.02, z - def.z + jz,
            w * r.range(0.7, 1.05), 2, 6, () => [1, 0.05, 1]);
        }
      }
    }
    if (!sub.isEmpty) put('solid', sub, def.x, def.z, 0);
  }

  /* --- THE LANDMARK ----------------------------------------------------- */
  if (plan.landmark) buildLandmark(T, plan, put, r, blockers, lights, npcSpots);

  /* --- a centre: a well, a fire, a tree, depending ----------------------- */
  {
    const sub = new MeshBuilder(), g = new MeshBuilder();
    if (S.snow || S.wall === 'stone') {
      const info = P.buildFirePit(sub, { seed: r.seed(), r: 0.75, cauldron: true, glow: g });
      put('solid', sub, def.x, def.z, r.range(0, TAU));
      put('glow', g, def.x, def.z, 0);
      lights.push({ x: def.x, y: T.height(def.x, def.z) + 0.6, z: def.z, color: BUILD.fire, intensity: 2.4, flicker: true });
      blockers.push({ x: def.x, z: def.z, r: 1.0 });
      npcSpots.push({ x: def.x + 1.6, z: def.z, kind: 'fire', yaw: Math.PI * 1.5, village: def.id });
    } else {
      const info = P.buildWell(sub, { seed: r.seed(), r: 0.9 });
      put('solid', sub, def.x, def.z, r.range(0, TAU));
      for (const b of info.blockers) blockers.push({ x: def.x + b.x, z: def.z + b.z, r: b.r });
      npcSpots.push({ x: def.x + 1.7, z: def.z + 0.5, kind: 'well', yaw: Math.PI, village: def.id });
    }
  }

  /* --- JETTIES out over the water --------------------------------------- */
  if (S.jetties && lake) {
    for (let j = 0; j < 3; j++) {
      const a = lake.angle + Math.PI + (j - 1) * 0.55;
      const sx = lake.x + Math.cos(a) * (lake.r + 1.0);
      const sz = lake.z + Math.sin(a) * (lake.r + 1.0);
      const len = r.range(6, 11);
      const sub = new MeshBuilder();
      const dirx = Math.cos(a + Math.PI), dirz = Math.sin(a + Math.PI);
      const n = Math.round(len / 0.55);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        sub.color(tweak(BUILD.plankOld, { l: r.range(0.85, 1.15) }), 0.06, r);
        box(sub, 0, lake.level - T.height(sx, sz) + 0.42, -t * len, 1.5, 0.09, len / n * 0.9);
        if (i % 4 === 0) {
          sub.color(BARK.oak, 0.07, r);
          for (const s of [-0.6, 0.6]) {
            beam(sub, s, lake.level - T.height(sx, sz) - 1.6, -t * len,
              s, lake.level - T.height(sx, sz) + 0.5, -t * len, 0.11, 0.11, [0, 1, 0]);
          }
        }
      }
      put('solid', sub, sx, sz, Math.atan2(dirx, dirz));
      /* a moored boat at the end of one of them */
      if (S.boats && j === 1) {
        const bx = sx + dirx * (len + 1.2), bz = sz + dirz * (len + 1.2);
        const boat = new MeshBuilder();
        buildBoat(boat, r);
        put('solid', boat, bx, bz, Math.atan2(dirx, dirz) + r.range(-0.3, 0.3),
          lake.level - T.height(bx, bz) - 0.12);
      }
      npcSpots.push({ x: sx + dirx * len * 0.6, z: sz + dirz * len * 0.6, kind: 'fish', yaw: a + Math.PI, village: def.id });
    }
  }

  /* --- WALKWAYS between the houses, for anywhere built over water ------- */
  if (S.walkways) {
    for (let i = 0; i < plan.lots.length - 1; i++) {
      const a = plan.lots[i], c = plan.lots[i + 1];
      const dx = c.x - a.x, dz = c.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len > 26) continue;
      const sub = new MeshBuilder();
      const n = Math.round(len / 0.6);
      const lvl = (lake ? lake.level : T.height(a.x, a.z)) + 0.35;
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        sub.color(tweak(BUILD.plankOld, { l: r.range(0.84, 1.16) }), 0.06, r);
        const px = lerp(a.x, c.x, t), pz = lerp(a.z, c.z, t);
        box(sub, px - a.x, lvl - T.height(a.x, a.z), pz - a.z, 1.2, 0.09, len / n * 0.95);
      }
      put('solid', sub, a.x, a.z, 0);
    }
  }

  /* --- fences, and what the village grows ------------------------------- */
  const treeN = S.canopy ? 26 : S.snow ? 14 : 18;
  for (let i = 0; i < treeN; i++) {
    const a = r.range(0, TAU);
    const rad = def.core * r.range(0.95, 1.9);
    const x = def.x + Math.cos(a) * rad, z = def.z + Math.sin(a) * rad;
    if (lake && Math.hypot(x - lake.x, z - lake.z) < lake.r * 1.15) continue;
    const sub = new MeshBuilder();
    const info = buildTree(sub, {
      species: r.pick(S.treeMix), seed: r.seed(), lod: 0,
      scale: r.range(0.7, 1.15), mossy: S.mossy ?? 0.3, snow: S.snow ?? 0,
    });
    put('flora', sub, x, z, r.range(0, TAU));
    blockers.push({ x, z, r: Math.max(0.5, (info.trunkR || 0.3) * 1.5) });
  }

  /* --- the clutter of somewhere lived in -------------------------------- */
  const props = S.snow ? ['woodpile', 'barrel', 'crate', 'firePit']
    : S.wall === 'sandstone' ? ['crate', 'barrel', 'planter', 'sack']
      : ['barrel', 'crate', 'woodpile', 'cart', 'planter', 'trough'];
  for (let i = 0; i < 12; i++) {
    const a = r.range(0, TAU), rad = def.core * r.range(0.25, 0.85);
    const x = def.x + Math.cos(a) * rad, z = def.z + Math.sin(a) * rad;
    if (lake && Math.hypot(x - lake.x, z - lake.z) < lake.r * 1.05) continue;
    const kind = r.pick(props);
    const sub = new MeshBuilder(), g = new MeshBuilder();
    if (kind === 'barrel') P.buildBarrel(sub, { seed: r.seed() });
    else if (kind === 'crate') P.buildCrate(sub, { seed: r.seed() });
    else if (kind === 'woodpile') P.buildWoodpile(sub, { seed: r.seed(), w: r.range(1.4, 2.2), h: r.range(0.8, 1.4), d: 0.7 });
    else if (kind === 'cart') P.buildCart(sub, { seed: r.seed(), loaded: r.chance(0.6) });
    else if (kind === 'planter') P.buildPlanter(sub, { seed: r.seed() });
    else if (kind === 'trough') P.buildTrough(sub, { seed: r.seed(), len: 1.8 });
    else P.buildFirePit(sub, { seed: r.seed(), r: 0.5, glow: g });
    put('solid', sub, x, z, r.range(0, TAU));
    if (!g.isEmpty) put('glow', g, x, z, 0);
    blockers.push({ x, z, r: 0.4, low: true });
  }

  /* --- lanterns, because every one of these places is lived in ---------- */
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.4;
    const rad = def.core * 0.85;
    const x = def.x + Math.cos(a) * rad, z = def.z + Math.sin(a) * rad;
    if (lake && Math.hypot(x - lake.x, z - lake.z) < lake.r * 1.05) continue;
    const sub = new MeshBuilder(), g = new MeshBuilder();
    const L = P.buildLantern(sub, { seed: r.seed(), kind: 'post', h: r.range(2.2, 2.7), glow: g });
    put('solid', sub, x, z, r.range(0, TAU));
    put('glow', g, x, z, 0);
    lights.push({ x, y: T.height(x, z) + L.light.y, z, color: S.lantern, intensity: 1.05 });
    blockers.push({ x, z, r: 0.22 });
  }

  /* --- a signpost with the village's name on it ------------------------- */
  {
    const a = r.range(0, TAU);
    const x = def.x + Math.cos(a) * def.core * 1.05, z = def.z + Math.sin(a) * def.core * 1.05;
    const sub = new MeshBuilder();
    P.buildSign(sub, { seed: r.seed(), kind: 'post', glyph: 'home', h: 2.3, w: 1.2 });
    put('solid', sub, x, z, Math.atan2(def.x - x, def.z - z));
    blockers.push({ x, z, r: 0.3 });
  }
}

/** A small clinker boat, for the lake villages. */
function buildBoat(b, r) {
  const L = 3.2, W = 1.05;
  for (let i = 0; i < 5; i++) {
    const t = i / 5;
    b.color(tweak(i % 2 ? BUILD.plank : BUILD.plankOld, { l: r.range(0.88, 1.12) }), 0.06, r);
    const wid = W * (0.4 + t * 0.6);
    const yy = 0.08 + t * 0.34;
    for (const s of [-1, 1]) {
      tube(b, {
        pts: [[-L * 0.5, yy + 0.1, 0], [-L * 0.2, yy, s * wid * 0.5],
        [L * 0.2, yy, s * wid * 0.5], [L * 0.5, yy + 0.12, 0]],
        radius: () => 0.055, radial: 4, capStart: true, capEnd: true, sway: () => 0,
      });
    }
  }
  b.color(BUILD.plankOld, 0.06, r);
  box(b, 0, 0.1, 0, L * 0.8, 0.06, W * 0.75);
  for (const bx of [-0.6, 0.5]) box(b, bx, 0.3, 0, 0.14, 0.07, W * 0.85);
  b.color(BARK.hazel, 0.07, r);
  tube(b, {
    pts: [[-1.2, 0.36, 0.2], [1.3, 0.42, 0.45]],
    radius: t => 0.035 * (1 - t * 0.4), radial: 5, capStart: true, capEnd: true, sway: () => 0,
  });
}
