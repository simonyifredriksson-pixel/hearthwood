/* Village.js — laying out Hearthwood itself.
   ===========================================================================
   The village is the 3% of the map that is not forest, and the whole design
   depends on it feeling like a real, dense, lived-in place while being a
   speck on the map. So it is laid out the way a real village was: a road
   through a valley, a green where the road widens, lanes coming off it, and
   houses crowded along the lanes with their gardens behind them.

   ORDER MATTERS HERE and it is easy to get wrong:

     1. Lay out the path graph.
     2. Register the paths and the building pads with the Terrain, so the
        ground FLATTENS under them.
     3. Settle the paths onto the flattened ground.
     4. Only then place anything, because everything is placed at
        terrain.height(), and every height read before step 3 is a lie.

   Doing step 4 before step 2 is how you get a village of houses hovering
   half a metre above their own foundations.
*/

import * as THREE from '../../lib/three.module.js?v=1790055608';
import { MeshBuilder, box, beam, cylinder, blob, quad, tube } from '../art/Geo.js?v=1790055608';
import { buildHouse, buildWorkshop, buildBarn, buildMill } from '../art/BuildingGen.js?v=1790055608';
import * as P from '../art/PropArt.js?v=1790055608';
import { buildTree } from '../art/TreeGen.js?v=1790055608';
import { buildBush, buildFlower, buildGrassTuft, buildGroundCover } from '../art/PlantGen.js?v=1790055608';
import { BUILD, GROUND, PLANT, MOSS, BARK, METAL, mixHex, tweak, shade } from '../art/Palette.js?v=1790055608';
import { WORLD } from '../core/Config.js?v=1790055608';
import { makeRng, clamp, lerp, TAU, segDist, smoothstep } from '../core/Util.js?v=1790055608';
import { riverX, riverLevel } from './Terrain.js?v=1790055608';

const UP = new THREE.Vector3(0, 1, 0);

/* ========================================================================= */
/* THE PLAN                                                                  */
/* ========================================================================= */

/**
 * Work out where everything goes. This runs BEFORE any terrain mesh exists,
 * and its whole job is to register paths and pads with the Terrain so the
 * ground can be flattened under them.
 */
export function planVillage(T, seed = WORLD.seed ^ 0x1a6e) {
  const r = makeRng(seed);
  const V = WORLD.village;
  const cx = V.cx, cz = V.cz;

  const plan = {
    centre: [cx, cz],
    paths: [],        // {ax,az,bx,bz,w}
    lots: [],         // {x,z,yaw,kind,w,d,...}
    props: [],        // {x,z,yaw,kind,...}
    bridges: [],
    plaza: { x: cx, z: cz, r: 15 },
    landmarks: {},
  };

  /* --------------------------------------------------------- THE STREET */

  /* The high street runs roughly north–south through the green, bending as
     it follows the valley. Straight roads are Roman; this is not Rome. */
  const streetPts = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    streetPts.push([
      cx + Math.sin(t * 2.6 + 0.4) * 24 - 10 + (t - 0.5) * 12,
      cz - 92 + t * 184,
    ]);
  }
  addChain(plan, streetPts, 4.6);

  /* The lane to the river and the bridge */
  const riverZ = cz + 6;
  const bx = riverX(riverZ);
  const bridgeEnd = [bx + 16, riverZ - 2];
  addChain(plan, [
    [cx + 6, cz + 4], [cx + 26, cz + 2], [cx + 46, cz + 4], [bx - 11, riverZ - 1],
  ], 3.4);
  plan.bridges.push({
    ax: bx - 10.5, az: riverZ - 1, bx: bx + 10.5, bz: riverZ - 1,
    y: riverLevel(riverZ) + 1.35, w: 2.2,
  });
  addChain(plan, [[bx + 10.5, riverZ - 1], [bx + 26, riverZ + 4], [bx + 42, riverZ + 16]], 2.8);

  /* Two side lanes off the street, west into the gardens */
  addChain(plan, [[cx - 8, cz - 34], [cx - 28, cz - 40], [cx - 50, cz - 34]], 2.9);
  addChain(plan, [[cx - 12, cz + 38], [cx - 34, cz + 46], [cx - 52, cz + 60]], 2.9);
  /* and one east to the mill */
  const millZ = cz - 34;
  const mx = riverX(millZ);
  addChain(plan, [[cx + 4, cz - 26], [cx + 22, cz - 32], [mx - 12, millZ - 2]], 3.0);

  /* a farm track running south to the fields */
  addChain(plan, [[cx + 2, cz + 84], [cx + 14, cz + 108], [cx + 6, cz + 132]], 2.6);

  /* register with the terrain so the ground learns about the roads */
  for (const p of plan.paths) T.addPath(p.ax, p.az, p.bx, p.bz, p.w);

  /* ------------------------------------------------------------- PLAZA */

  T.addFlat(cx, cz, 17, undefined);

  /* ---------------------------------------------------------- BUILDINGS */

  /* Buildings are placed ALONG the street and lanes, alternating sides, set
     back a little and facing the road. That one rule is what makes a set of
     boxes read as a street rather than as a car park. */
  const placed = [];
  const tryLot = (x, z, yaw, w, d, kind, extra = {}) => {
    // keep off the paths, the river and each other
    for (const p of plan.paths) {
      if (segDist(x, z, p.ax, p.az, p.bx, p.bz) < p.w * 0.5 + Math.max(w, d) * 0.5 + 0.7) return false;
    }
    if (Math.abs(x - riverX(z)) < WORLD.river.bankWidth * 1.35) return false;
    for (const o of placed) {
      if (Math.hypot(x - o.x, z - o.z) < (Math.max(w, d) + Math.max(o.w, o.d)) * 0.62 + 1.6) return false;
    }
    if (Math.hypot(x - cx, z - cz) < plan.plaza.r + Math.max(w, d) * 0.5 - 1) return false;
    const lot = { x, z, yaw, w, d, kind, ...extra };
    plan.lots.push(lot);
    placed.push(lot);
    T.addFlat(x, z, Math.max(w, d) * 0.62, undefined);
    return true;
  };

  /* --------------------------------------------------- THE STICKWRIGHT ---
     ON THE GREEN, and placed before anything else.

     She is the building the whole game routes through — the player is told
     to find her in the first two minutes and comes back to her after every
     walk in the wood — so she is not a lot on a lane somewhere. The workshop
     stands on the edge of the plaza facing in across the green, which makes
     it the first roof you see from anywhere in the village and means the
     walk back from the forest always ends by looking at it.

     Placed by hand rather than through tryLot, because tryLot's whole job is
     to keep buildings OFF the green, and this one belongs on it. */
  {
    const W = 8.5, D = 6.8;
    const ring = plan.plaza.r + D * 0.5 + 1.2;
    let done = false;
    // try the north edge first, then work round: the north side faces the
    // sun for most of the day, which is where you would put a workshop
    for (let k = 0; k < 16 && !done; k++) {
      const a = -Math.PI * 0.5 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.42;
      const x = cx + Math.cos(a) * ring;
      const z = cz + Math.sin(a) * ring;
      if (Math.abs(x - riverX(z)) < WORLD.river.bankWidth * 1.25) continue;
      // facing back across the green
      const yaw = Math.atan2(cx - x, cz - z);
      const lot = { x, z, yaw, w: W, d: D, kind: 'workshop', name: 'stickwright' };
      plan.lots.push(lot);
      placed.push(lot);
      T.addFlat(x, z, Math.max(W, D) * 0.66, undefined);
      plan.landmarks.stickwright = { x, z, yaw };
      done = true;
    }
    if (!done) console.warn('[village] could not place the stickwright on the green');
  }

  /* the rest of the named buildings, which do go out along the street */
  const named = [
    { kind: 'house', w: 7, d: 6, at: 0.66, side: 1, name: 'inn', off: 22, storeys: 2, sign: 'jug' },
    { kind: 'house', w: 6, d: 5.5, at: 0.36, side: 1, name: 'baker', off: 21, sign: 'loaf' },
    { kind: 'house', w: 6.5, d: 5.5, at: 0.31, side: -1, name: 'smith', off: 22, sign: 'hammer' },
    { kind: 'house', w: 6, d: 5, at: 0.73, side: -1, name: 'store', off: 20, sign: 'jug' },
  ];
  for (const nb of named) {
    /* The named buildings are the ones the player is TOLD to find, so they
       cannot be allowed to silently fail to place — which is exactly what
       happened when the workshop's first offset fell inside the green and
       the Stickwright quietly ceased to exist. Walk the offset outward and
       nudge along the street until something takes. */
    let done = false;
    for (let attempt = 0; attempt < 24 && !done; attempt++) {
      const at = clamp(nb.at + (attempt % 6 - 2.5) * 0.035, 0.06, 0.94);
      const off = nb.off + Math.floor(attempt / 6) * 5.5;
      const pt = alongChain(streetPts, at);
      const nrm = chainNormal(streetPts, at);
      const x = pt[0] + nrm[0] * off * nb.side;
      const z = pt[1] + nrm[1] * off * nb.side;
      const yaw = Math.atan2(-nrm[0] * nb.side, -nrm[1] * nb.side);
      if (tryLot(x, z, yaw, nb.w, nb.d, nb.kind, { name: nb.name, storeys: nb.storeys, sign: nb.sign })) {
        plan.landmarks[nb.name] = { x, z, yaw };
        done = true;
      }
    }
    if (!done) console.warn('[village] could not place', nb.name);
  }

  /* the mill, on the river */
  {
    const x = mx - 9.5, z = millZ;
    const yaw = Math.PI * 0.5;
    if (tryLot(x, z, yaw, 7, 6, 'mill', { name: 'mill' })) plan.landmarks.mill = { x, z, yaw };
  }

  /* then ordinary houses down the street and the lanes */
  const lanes = plan.paths.filter(p => p.w >= 2.6);
  let tries = 0;
  while (placed.length < 34 && tries < 900) {
    tries++;
    const p = r.pick(lanes);
    const t = r.range(0.08, 0.92);
    const px = lerp(p.ax, p.bx, t), pz = lerp(p.az, p.bz, t);
    const dx = p.bx - p.ax, dz = p.bz - p.az;
    const L = Math.hypot(dx, dz) || 1;
    const nx = -dz / L, nz = dx / L;
    const side = r.sign();
    const off = r.range(6.5, 11.5);
    const x = px + nx * off * side, z = pz + nz * off * side;
    if (Math.hypot(x - cx, z - cz) > V.core * 1.15) continue;
    const yaw = Math.atan2(-nx * side, -nz * side) + r.range(-0.12, 0.12);
    const w = r.range(4.6, 7.4), d = r.range(4.2, 6.2);
    tryLot(x, z, yaw, w, d, 'house', {
      storeys: r.chance(0.55) ? 2 : 1,
      sign: r.chance(0.12) ? r.pick(['boot', 'fish', 'leaf', 'arrow', 'home']) : null,
    });
  }

  /* outlying farm buildings, beyond the core but inside the fence line */
  const farmSpots = [
    [cx + 20, cz + 112], [cx - 6, cz + 124], [cx + 34, cz + 96],
    [cx - 64, cz - 62], [cx - 78, cz + 22],
  ];
  for (const [fx, fz] of farmSpots) {
    const yaw = r.range(0, TAU);
    tryLot(fx + r.range(-6, 6), fz + r.range(-6, 6), yaw, 8, 6, 'barn', { name: 'farm' });
  }

  /* --------------------------------------------------- settle the ground */

  T.settlePaths();
  T.clearCache();

  return plan;
}

function addChain(plan, pts, w) {
  for (let i = 0; i < pts.length - 1; i++) {
    plan.paths.push({ ax: pts[i][0], az: pts[i][1], bx: pts[i + 1][0], bz: pts[i + 1][1], w });
  }
}

function alongChain(pts, t) {
  const u = clamp(t, 0, 0.999) * (pts.length - 1);
  const i = Math.floor(u), f = u - i;
  return [lerp(pts[i][0], pts[i + 1][0], f), lerp(pts[i][1], pts[i + 1][1], f)];
}

function chainNormal(pts, t) {
  const u = clamp(t, 0, 0.999) * (pts.length - 1);
  const i = Math.floor(u);
  const dx = pts[i + 1][0] - pts[i][0], dz = pts[i + 1][1] - pts[i][1];
  const L = Math.hypot(dx, dz) || 1;
  return [-dz / L, dx / L];
}

/* ========================================================================= */
/* BUILDING IT                                                               */
/* ========================================================================= */

/**
 * Build the village geometry. Returns merged builders grouped into a 3×3
 * spatial grid so frustum culling can throw away the half of the village
 * that is behind you.
 *
 * @returns {{
 *   cells: Array<{key, solid, flora, glow, cx, cz}>,
 *   lights: Array, blockers: Array, anchors: object, npcSpots: Array
 * }}
 */
export function buildVillage(T, plan, seed = WORLD.seed ^ 0x2b71) {
  const r = makeRng(seed);
  const V = WORLD.village;
  const CELLS = 3;
  const span = V.radius * 2.1;
  const cells = [];
  for (let j = 0; j < CELLS; j++) {
    for (let i = 0; i < CELLS; i++) {
      cells.push({
        key: `${i},${j}`,
        solid: new MeshBuilder(), flora: new MeshBuilder(), glow: new MeshBuilder(),
        x0: V.cx - V.radius * 1.05 + (i * span) / CELLS,
        z0: V.cz - V.radius * 1.05 + (j * span) / CELLS,
        size: span / CELLS,
      });
    }
  }
  const cellAt = (x, z) => {
    const i = clamp(Math.floor((x - (V.cx - V.radius * 1.05)) / (span / CELLS)), 0, CELLS - 1);
    const j = clamp(Math.floor((z - (V.cz - V.radius * 1.05)) / (span / CELLS)), 0, CELLS - 1);
    return cells[j * CELLS + i];
  };

  const lights = [];
  const blockers = [];
  const anchors = {};
  const npcSpots = [];
  const smokes = [];

  /** Stamp a sub-builder into the right cell at a world position. */
  const put = (group, sub, x, z, yaw = 0, yOff = 0, tilt = 0, scale = 1) => {
    const c = cellAt(x, z);
    const y = T.height(x, z) + yOff;
    let q;
    if (tilt > 0) {
      const nrm = T.normal(x, z, 1.4);
      const up = new THREE.Vector3(lerp(0, nrm[0], tilt), lerp(1, nrm[1], tilt), lerp(0, nrm[2], tilt)).normalize();
      q = new THREE.Quaternion().setFromUnitVectors(UP, up)
        .multiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw));
    } else {
      q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    }
    c[group].append(sub, new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z), q, new THREE.Vector3(scale, scale, scale)));
  };

  const addLights = (list, x, z, yaw, yBase) => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (const L of list) {
      lights.push({
        x: x + L.x * c + L.z * s, y: yBase + L.y, z: z - L.x * s + L.z * c,
        color: L.c, intensity: L.i ?? 1, flicker: !!L.flicker,
      });
    }
  };
  const addBlockers = (list, x, z, yaw) => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (const B of list) {
      blockers.push({ x: x + B.x * c + B.z * s, z: z - B.x * s + B.z * c, r: B.r, soft: B.soft, low: B.low });
    }
  };

  /* ------------------------------------------------------------- PATHS */

  buildPaths(T, plan, cells, cellAt, r);

  /* ----------------------------------------------------------- BRIDGES */

  for (const br of plan.bridges) {
    const c = cellAt((br.ax + br.bx) / 2, (br.az + br.bz) / 2);
    P.buildBridge(c.solid, { ...br, seed: r.seed() });
    // a bridge is walkable, so it must NOT be a blocker; the walk surface is
    // handled by Player.js reading `bridges`
  }

  /* --------------------------------------------------------- BUILDINGS */

  for (const lot of plan.lots) {
    const sub = new MeshBuilder();
    const glowSub = new MeshBuilder();
    const s = r.seed();
    let info;
    if (lot.kind === 'workshop') {
      info = buildWorkshop(sub, { seed: s, w: lot.w, d: lot.d, lit: true });
    } else if (lot.kind === 'barn') {
      info = buildBarn(sub, { seed: s, w: lot.w, d: lot.d });
    } else if (lot.kind === 'mill') {
      info = buildMill(sub, { seed: s, w: lot.w, d: lot.d });
    } else {
      info = buildHouse(sub, {
        seed: s, w: lot.w, d: lot.d, storeys: lot.storeys || (r.chance(0.5) ? 2 : 1),
        lit: true, role: lot.name || 'house',
      });
    }
    const y = T.height(lot.x, lot.z);
    put('solid', sub, lot.x, lot.z, lot.yaw);
    if (!glowSub.isEmpty) put('glow', glowSub, lot.x, lot.z, lot.yaw);
    addLights(info.lights || [], lot.x, lot.z, lot.yaw, y);
    addBlockers(info.blockers || [], lot.x, lot.z, lot.yaw);
    if (info.smokeAt) {
      const c = Math.cos(lot.yaw), sn = Math.sin(lot.yaw);
      smokes.push({
        x: lot.x + info.smokeAt[0] * c + info.smokeAt[2] * sn,
        y: y + info.smokeAt[1],
        z: lot.z - info.smokeAt[0] * sn + info.smokeAt[2] * c,
      });
    }

    /* the doorstep, in world space — NPCs stand and sit here */
    const dc = Math.cos(lot.yaw), ds = Math.sin(lot.yaw);
    const dx = lot.x + (info.doorAt ? info.doorAt[0] : 0) * dc + (info.doorAt ? info.doorAt[1] : lot.d / 2 + 0.8) * ds;
    const dz = lot.z - (info.doorAt ? info.doorAt[0] : 0) * ds + (info.doorAt ? info.doorAt[1] : lot.d / 2 + 0.8) * dc;
    lot.door = [dx, dz];
    npcSpots.push({ x: dx, z: dz, kind: 'door', yaw: lot.yaw });

    if (lot.name) anchors[lot.name] = { ...lot, info, y };

    /* the shop sign */
    if (lot.sign) {
      const sg = new MeshBuilder();
      P.buildSign(sg, { seed: r.seed(), kind: 'hanging', glyph: lot.sign, h: 2.5 });
      const sx = lot.x + (lot.w * 0.4) * dc + (lot.d / 2 + 0.4) * ds;
      const sz = lot.z - (lot.w * 0.4) * ds + (lot.d / 2 + 0.4) * dc;
      put('solid', sg, sx, sz, lot.yaw + Math.PI);
      blockers.push({ x: sx, z: sz, r: 0.25 });
    }

    /* what lives around a house: this is where "lived in" comes from */
    dressLot(T, lot, info, put, r, blockers, lights, npcSpots);
  }

  /* ------------------------------------------------------------- PLAZA */

  dressPlaza(T, plan, put, r, blockers, lights, npcSpots, anchors);

  /* --------------------------------------------------------- WORKSHOP */

  if (anchors.stickwright) {
    dressWorkshop(T, anchors.stickwright, put, r, blockers, lights, npcSpots);
  }

  /* ------------------------------------------------------- FARM & EDGE */

  dressOutskirts(T, plan, put, r, blockers, lights, npcSpots);

  /* ------------------------------------------------------ THE FISHERY */

  dressFishery(T, plan, put, r, blockers, lights, npcSpots, anchors);

  return { cells, lights, blockers, anchors, npcSpots, smokes, plan };
}

/* ========================================================================= */
/* PATH SURFACES                                                             */
/* ========================================================================= */

/** Cobbles and stepping stones laid ON the path, over the painted ground. */
function buildPaths(T, plan, cells, cellAt, r) {
  for (const p of plan.paths) {
    const len = Math.hypot(p.bx - p.ax, p.bz - p.az);
    const dx = (p.bx - p.ax) / len, dz = (p.bz - p.az) / len;
    const nx = -dz, nz = dx;
    const steps = Math.round(len / 0.55);
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const x0 = p.ax + dx * len * t, z0 = p.az + dz * len * t;
      const across = Math.max(1, Math.round(p.w / 0.5));
      for (let k = 0; k < across; k++) {
        if (r.chance(0.28)) continue;
        const u = ((k + 0.5) / across - 0.5) * p.w * 0.94;
        const x = x0 + nx * u + r.range(-0.1, 0.1);
        const z = z0 + nz * u + r.range(-0.1, 0.1);
        const c = cellAt(x, z);
        const y = T.height(x, z);
        const s = r.range(0.11, 0.24);
        c.solid.color(
          r.chance(0.18) ? BUILD.stoneWarm : r.chance(0.5) ? GROUND.pathStone : shade(GROUND.pathStone, -0.12),
          0.09, r);
        blob(c.solid, x, y + s * 0.18, z, s, 3, 5,
          (px, py, pz) => [1.1, 0.34, 1.1], 0);
      }
    }
  }
}

/* ========================================================================= */
/* DRESSING                                                                  */
/* ========================================================================= */

/** Everything that lives around one house. */
function dressLot(T, lot, info, put, r, blockers, lights, npcSpots) {
  const yaw = lot.yaw;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  /** local (right, forward) -> world, where forward is the way the house faces */
  const L2W = (lx, lz) => [lot.x + lx * c + lz * s, lot.z - lx * s + lz * c];

  const front = lot.d / 2 + 1.0;
  const back = -lot.d / 2 - 1.4;
  const side = lot.w / 2 + 1.2;

  /* --- by the door ------------------------------------------------------ */
  if (r.chance(0.7)) {
    const sub = new MeshBuilder();
    P.buildPlanter(sub, { seed: r.seed(), R: r.range(0.26, 0.38) });
    const [x, z] = L2W(r.range(-lot.w * 0.35, lot.w * 0.35), front - 0.35);
    put('flora', sub, x, z, r.range(0, TAU), 0, 0.5);
  }
  if (r.chance(0.5)) {
    const sub = new MeshBuilder();
    P.buildBench(sub, { seed: r.seed(), len: r.range(1.3, 1.9) });
    const [x, z] = L2W(r.range(-lot.w * 0.3, lot.w * 0.3), front - 0.2);
    put('solid', sub, x, z, yaw + Math.PI + r.range(-0.2, 0.2), 0, 0.4);
    blockers.push({ x, z, r: 0.5, low: true });
    npcSpots.push({ x, z, kind: 'sit', yaw: yaw + Math.PI });
  }
  if (r.chance(0.45)) {
    const sub = new MeshBuilder();
    const g = new MeshBuilder();
    const L = P.buildLantern(sub, { seed: r.seed(), kind: 'post', h: r.range(2.0, 2.5), glow: g });
    const [x, z] = L2W(side * r.sign() * 0.8, front - 0.5);
    put('solid', sub, x, z, r.range(0, TAU));
    put('glow', g, x, z, 0);
    lights.push({ x, y: T.height(x, z) + L.light.y, z, color: L.light.c, intensity: 0.9 });
    blockers.push({ x, z, r: 0.2 });
  }

  /* --- at the side and behind ------------------------------------------- */
  if (r.chance(0.65)) {
    const sub = new MeshBuilder();
    P.buildWoodpile(sub, { seed: r.seed(), w: r.range(1.2, 2.4), h: r.range(0.7, 1.4), d: 0.65, neat: r.range(0.4, 0.95) });
    const [x, z] = L2W(side * r.sign(), r.range(-lot.d * 0.2, lot.d * 0.2));
    put('solid', sub, x, z, yaw + Math.PI / 2 + r.range(-0.3, 0.3), 0, 0.3);
    blockers.push({ x, z, r: 0.8, low: true });
  }
  for (let i = 0; i < r.int(0, 3); i++) {
    const sub = new MeshBuilder();
    const k = r.int(0, 2);
    if (k === 0) P.buildBarrel(sub, { seed: r.seed(), h: r.range(0.6, 0.95), R: r.range(0.24, 0.32), open: r.chance(0.3) });
    else if (k === 1) P.buildCrate(sub, { seed: r.seed(), s: r.range(0.35, 0.6) });
    else P.buildSack(sub, { seed: r.seed(), s: r.range(0.3, 0.45) });
    const [x, z] = L2W(r.range(-side, side), r.chance(0.5) ? front - 0.6 : back + 0.5);
    put('solid', sub, x, z, r.range(0, TAU), 0, 0.5);
    blockers.push({ x, z, r: 0.35, low: true });
  }
  if (r.chance(0.35)) {
    const sub = new MeshBuilder();
    P.buildWashingLine(sub, { seed: r.seed(), len: r.range(3.2, 5.5), h: r.range(1.9, 2.2) });
    const [x, z] = L2W(r.range(-1, 1), back - r.range(0.5, 2.5));
    put('solid', sub, x, z, yaw + r.range(-0.4, 0.4));
  }

  /* --- the garden behind ------------------------------------------------- */
  if (r.chance(0.6)) {
    const [gx, gz] = L2W(0, back - r.range(2.5, 5));
    const gw = lot.w * r.range(0.8, 1.3), gd = r.range(3.5, 6);
    // a fence round it
    const kind = r.pick(['picket', 'wattle', 'rail', 'wattle']);
    const corners = [
      L2W(-gw / 2, back - 0.5), L2W(gw / 2, back - 0.5),
      L2W(gw / 2, back - 0.5 - gd), L2W(-gw / 2, back - 0.5 - gd),
    ];
    const fb = new MeshBuilder();
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b2 = corners[(i + 1) % 4];
      P.buildFence(fb, {
        ax: a[0] - gx, az: a[1] - gz, bx: b2[0] - gx, bz: b2[1] - gz,
        seed: r.seed(), kind, h: kind === 'picket' ? 0.9 : 1.1,
        groundAt: (lx, lz) => T.height(gx + lx, gz + lz) - T.height(gx, gz),
      });
    }
    put('solid', fb, gx, gz, 0);

    const beds = r.int(1, 3);
    for (let i = 0; i < beds; i++) {
      const sub = new MeshBuilder();
      P.buildVegBed(sub, {
        seed: r.seed(), w: r.range(1.4, 2.4), d: r.range(0.9, 1.5),
        crop: r.pick(['cabbage', 'carrot', 'bean', 'herb']),
      });
      const [x, z] = L2W(r.range(-gw * 0.3, gw * 0.3), back - 1.5 - i * 1.8 - r.range(0, 0.6));
      put('flora', sub, x, z, yaw + r.range(-0.2, 0.2), 0, 0.4);
      blockers.push({ x, z, r: 0.8, soft: true });
    }
    if (r.chance(0.3)) {
      const sub = new MeshBuilder();
      P.buildBeehives(sub, { seed: r.seed(), n: r.int(2, 4) });
      const [x, z] = L2W(r.range(-gw * 0.35, gw * 0.35), back - gd - r.range(0, 1));
      put('solid', sub, x, z, yaw + Math.PI, 0, 0.3);
    }
    // a fruit tree or two in the garden
    for (let i = 0; i < r.int(0, 2); i++) {
      const sub = new MeshBuilder();
      buildTree(sub, {
        species: r.pick(['applewood', 'rowan', 'elder', 'hazel']), seed: r.seed(), lod: 0,
        scale: r.range(0.4, 0.95), mossy: 0.3,
      });
      const [x, z] = L2W(r.range(-gw * 0.45, gw * 0.45), back - r.range(1.5, gd));
      put('flora', sub, x, z, r.range(0, TAU), 0, 0.15);
      blockers.push({ x, z, r: 0.35 });
    }
  }

  /* --- flowers and long grass against the walls -------------------------- */
  for (let i = 0; i < r.int(3, 9); i++) {
    const sub = new MeshBuilder();
    if (r.chance(0.55)) {
      buildFlower(sub, { seed: r.seed(), kind: r.pick(['daisy', 'marigold', 'campion', 'buttercup', 'violet']), scale: r.range(0.8, 1.3) });
    } else {
      buildGrassTuft(sub, { seed: r.seed(), size: r.range(0.25, 0.5) });
    }
    const a = r.range(0, TAU), rr = r.range(Math.max(lot.w, lot.d) * 0.55, Math.max(lot.w, lot.d) * 0.75);
    put('flora', sub, lot.x + Math.cos(a) * rr, lot.z + Math.sin(a) * rr, r.range(0, TAU), 0, 0.4);
  }
}

/* ------------------------------------------------------------------ plaza */

function dressPlaza(T, plan, put, r, blockers, lights, npcSpots, anchors) {
  const { x: px, z: pz, r: R } = plan.plaza;

  /* the well, dead centre — the heart of any village */
  {
    const sub = new MeshBuilder();
    const info = P.buildWell(sub, { seed: r.seed(), r: 0.95 });
    put('solid', sub, px, pz, r.range(0, TAU));
    for (const b of info.blockers) blockers.push({ x: px + b.x, z: pz + b.z, r: b.r });
    anchors.well = { x: px, z: pz, y: T.height(px, pz) };
    npcSpots.push({ x: px + 1.8, z: pz + 0.6, kind: 'well', yaw: Math.PI });
  }

  /* the great tree of the green: every village has one */
  {
    const a = r.range(0, TAU);
    const tx = px + Math.cos(a) * R * 0.62, tz = pz + Math.sin(a) * R * 0.62;
    const sub = new MeshBuilder();
    const info = buildTree(sub, { species: 'oak', seed: r.seed(), lod: 0, scale: 0.95, mossy: 0.45 });
    put('flora', sub, tx, tz, r.range(0, TAU));
    blockers.push({ x: tx, z: tz, r: Math.max(0.6, info.trunkR * 1.6) });
    anchors.greatTree = { x: tx, z: tz };
    // a bench ring under it
    for (let i = 0; i < 3; i++) {
      const ba = a + Math.PI + (i - 1) * 0.9;
      const bx = tx + Math.cos(ba) * 2.2, bz = tz + Math.sin(ba) * 2.2;
      const bs = new MeshBuilder();
      P.buildBench(bs, { seed: r.seed(), len: 1.6 });
      put('solid', bs, bx, bz, Math.atan2(tx - bx, tz - bz), 0, 0.4);
      blockers.push({ x: bx, z: bz, r: 0.5, low: true });
      npcSpots.push({ x: bx, z: bz, kind: 'sit', yaw: Math.atan2(tx - bx, tz - bz) });
    }
  }

  /* KEEP THE FRONT OF THE WORKSHOP CLEAR.
     The Stickwright now stands on the green, and the market ring runs right
     across her frontage — so the walk up to the counter, which is the most
     repeated walk in the game, was through a stall and behind a chest-high
     pot. Everything the plaza scatters checks this first. */
  const shop = plan.landmarks.stickwright;
  const clearOfShop = (x, z, pad = 0) => {
    if (!shop) return true;
    /* Two tests, because one was not enough. The corridor test alone let the
       cook fire sit INSIDE the shed — it was off the centre line but well
       within the building — so the first thing the player saw through the
       open front of the workshop was a cauldron on a tripod. */
    if (Math.hypot(x - shop.x, z - shop.z) < 9.5 + pad) return false;
    // and the approach: the corridor between the green's centre and her door
    const ax = shop.x - px, az = shop.z - pz;
    const len = Math.hypot(ax, az) || 1;
    const t = clamp(((x - px) * ax + (z - pz) * az) / (len * len), 0, 1);
    const cxp = px + ax * t, czp = pz + az * t;
    return Math.hypot(x - cxp, z - czp) > 4.6 + pad || t < 0.18;
  };

  /* the market: a row of stalls round the edge of the green */
  const stallN = r.int(4, 6);
  const goods = r.shuffle(['produce', 'bread', 'cloth', 'pots', 'produce', 'bread']);
  for (let i = 0; i < stallN; i++) {
    const a = (i / stallN) * TAU + r.range(-0.2, 0.2) + 0.6;
    const rr = R * r.range(0.72, 0.92);
    const x = px + Math.cos(a) * rr, z = pz + Math.sin(a) * rr;
    if (!clearOfShop(x, z, 1.6)) continue;
    const sub = new MeshBuilder();
    const info = P.buildStall(sub, { seed: r.seed(), w: r.range(2.2, 3.1), d: r.range(1.3, 1.8), goods: goods[i % goods.length] });
    const yaw = Math.atan2(px - x, pz - z);
    put('flora', sub, x, z, yaw, 0, 0.3);
    for (const b of info.blockers) blockers.push({ x, z, r: b.r });
    // the stallholder stands behind their own stall
    npcSpots.push({
      x: x + Math.sin(yaw + Math.PI) * 1.0, z: z + Math.cos(yaw + Math.PI) * 1.0,
      kind: 'stall', yaw,
    });
  }

  /* a fire pit with a cauldron, and lanterns on posts round the green */
  {
    const a = r.range(0, TAU);
    let fx = px + Math.cos(a) * R * 0.45, fz = pz + Math.sin(a) * R * 0.45;
    // nudge the cook fire round the green until it is off her doorstep
    for (let k = 0; k < 10 && !clearOfShop(fx, fz, 1.2); k++) {
      const a2 = a + (k + 1) * 0.72;
      fx = px + Math.cos(a2) * R * 0.45; fz = pz + Math.sin(a2) * R * 0.45;
    }
    const sub = new MeshBuilder(), g = new MeshBuilder();
    const info = P.buildFirePit(sub, { seed: r.seed(), r: 0.65, glow: g, cauldron: true });
    put('solid', sub, fx, fz, r.range(0, TAU));
    put('glow', g, fx, fz, 0);
    lights.push({ x: fx, y: T.height(fx, fz) + 0.5, z: fz, color: BUILD.fire, intensity: 2.2, flicker: true });
    blockers.push({ x: fx, z: fz, r: 0.9 });
    npcSpots.push({ x: fx + 1.4, z: fz, kind: 'fire', yaw: Math.PI * 1.5 });
  }

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.3;
    const x = px + Math.cos(a) * R * 1.02, z = pz + Math.sin(a) * R * 1.02;
    if (!clearOfShop(x, z, 0.4)) continue;
    const sub = new MeshBuilder(), g = new MeshBuilder();
    const L = P.buildLantern(sub, { seed: r.seed(), kind: 'post', h: r.range(2.3, 2.7), glow: g });
    put('solid', sub, x, z, r.range(0, TAU));
    put('glow', g, x, z, 0);
    lights.push({ x, y: T.height(x, z) + L.light.y, z, color: L.light.c, intensity: 1.0 });
    blockers.push({ x, z, r: 0.22 });
  }

  /* a trough, a cart, a couple of crates: the clutter of a working square */
  {
    const a = r.range(0, TAU);
    const sub = new MeshBuilder();
    P.buildTrough(sub, { seed: r.seed(), len: 1.8 });
    const x = px + Math.cos(a) * R * 0.85, z = pz + Math.sin(a) * R * 0.85;
    if (clearOfShop(x, z, 0.8)) {
      put('solid', sub, x, z, r.range(0, TAU), 0, 0.3);
      blockers.push({ x, z, r: 1.0 });
    }
  }
  for (let i = 0; i < r.int(1, 3); i++) {
    const a = r.range(0, TAU);
    const sub = new MeshBuilder();
    const info = P.buildCart(sub, { seed: r.seed(), loaded: r.chance(0.7) });
    const x = px + Math.cos(a) * R * r.range(0.7, 1.0), z = pz + Math.sin(a) * R * r.range(0.7, 1.0);
    if (!clearOfShop(x, z, 1.2)) continue;
    put('solid', sub, x, z, r.range(0, TAU), 0, 0.3);
    for (const b of info.blockers) blockers.push({ x, z, r: b.r });
  }

  /* the village signpost at the road's edge */
  {
    const sub = new MeshBuilder();
    P.buildSign(sub, { seed: r.seed(), kind: 'post', glyph: 'home', h: 2.1, w: 1.0 });
    const x = px + r.range(-R, R) * 0.9, z = pz + R * 1.05;
    if (clearOfShop(x, z, 0.5)) {
      put('solid', sub, x, z, r.range(0, TAU));
      blockers.push({ x, z, r: 0.3 });
    }
  }
}

/* -------------------------------------------------------------- workshop */

function dressWorkshop(T, a, put, r, blockers, lights, npcSpots) {
  const { x, z, yaw, info } = a;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const L2W = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];

  /* THE PROPS ARE SCALED TO THE PEOPLE WHO USE THEM.
     ----------------------------------------------------------------------
     Every prop in PropArt is drawn at human scale, because that is the size
     a bench, an anvil and a grindstone are. The Stickwright is a hare one
     metre twenty-five tall with her shoulder at eighty-one centimetres, and
     a bench with a ninety-four centimetre top puts her work up under her
     chin — which is exactly how it rendered the first time the cutscene was
     pointed at it: a wall of bench with two ears behind it. 0.72 brings the
     working surfaces to 0.68, 0.56 and 0.53, which is where a person that
     size wants them. */
  const TOOL = 0.72;

  /* A FLOOR. The shed had none, and it showed the moment anything was shot
     from inside it: the most important interior in the game was a roof on
     posts standing in a field, with the Stickwright ankle-deep in meadow
     grass. Boards laid front to back, over a sill, with the whole thing
     levelled to the HIGHEST corner of the footprint and given enough
     thickness to bury itself in the low one — a floor that follows the
     ground is not a floor, it is a carpet. */
  {
    const sub = new MeshBuilder();
    const hw = info.w / 2 - 0.12, hd = info.d / 2 - 0.12;
    /* A GRID, NOT THE CORNERS. The first version sampled nine points, found
       a 2 cm rise, laid the boards 2 cm up — and the floor was invisible,
       because the ground between those nine points goes higher than any of
       them and the terrain simply won the depth test. The pad is flattened,
       not flat. Sample it properly and then stand clear of it. */
    let top = -Infinity;
    for (let i = 0; i <= 10; i++) {
      for (let j = 0; j <= 8; j++) {
        const [px, pz] = L2W(-hw + (i / 10) * hw * 2, -hd + (j / 8) * hd * 2);
        top = Math.max(top, T.height(px, pz));
      }
    }
    top += 0.05;                           // a board's thickness of daylight
    const rise = top - T.height(x, z);
    const THICK = 0.30;                    // deep enough to reach the low corner
    const n = Math.max(6, Math.round((hw * 2) / 0.3));
    for (let i = 0; i < n; i++) {
      const bw = (hw * 2) / n;
      const bx = -hw + (i + 0.5) * bw;
      r.chance(0.5)
        ? sub.color(mixHex(BUILD.plank, BARK.oak, r.range(0.0, 0.45)), 0.07, r)
        : sub.color(mixHex(BUILD.plankOld, BUILD.plank, r()), 0.07, r);
      // a hair of gap between boards, and each one sits a millimetre or two
      // proud of its neighbours, which is the whole reason it reads as boards
      const lift = r.range(-0.006, 0.008);
      box(sub, bx, rise + lift - THICK / 2, 0, bw * 0.94, THICK, hd * 2);
    }
    // the sill the boards die into, all the way round
    sub.color(BARK.oak, 0.06, r);
    for (const sx of [-1, 1]) box(sub, sx * hw, rise - 0.055, 0, 0.14, 0.13, hd * 2 + 0.14);
    for (const sz of [-1, 1]) box(sub, 0, rise - 0.055, sz * hd, hw * 2 + 0.14, 0.13, 0.14);
    put('solid', sub, x, z, yaw);
    a.floorY = top;
  }

  /* Everything indoors stands ON the boards, not on the meadow under them.
     It is only a couple of centimetres — until you remember the wood
     shavings are twelve millimetres tall and would have been underground. */
  const onFloor = (px, pz) => a.floorY - T.height(px, pz);

  /* the bench, inside, facing the counter */
  {
    const sub = new MeshBuilder();
    const bi = P.buildWorkbench(sub, { seed: r.seed(), w: 2.6 });
    const [bx, bz] = L2W(0.3, -info.d * 0.18);
    /* FACING HER, not away from her. The bench carries a board of hanging
       tools on one side; turned the other way round it presents the whole
       shop with a blank two-metre slab of plank, which is precisely what
       every cutscene frame came back as. The tools go where the person
       using them can reach. */
    put('solid', sub, bx, bz, yaw, onFloor(bx, bz), 0, TOOL);
    blockers.push({ x: bx, z: bz, r: 1.0 * TOOL });
    /* The forge cutscene stages itself against these. It needs the bench as a
       WORLD position and a working HEIGHT, not as a lot-relative offset,
       because the workshop can be dropped anywhere in the plan and the
       camera marks are computed from the anchor, not from the lot. */
    a.benchAt = [bx, bz];
    /* MEASURED FROM THE BOARDS, not the meadow. Every prop in here is put
       down with an `onFloor` lift, so its top is above `a.floorY`; these
       three anchors were computed from `T.height` instead, which is a few
       centimetres lower. The cutscene lays things on them, and a few
       centimetres is the whole height of a coil of cord — the materials
       beat came back as an empty bench with the lid of a wax pot poking
       through it. */
    a.benchTop = a.floorY + (bi?.topY ?? 0.94) * TOOL;  // 0.88 frame + half the 0.11 top
    // where the Stickwright actually stands
    const [sx, sz] = L2W(0.3, info.d * 0.06);
    npcSpots.push({ x: sx, z: sz, kind: 'stickwright', yaw });
    a.standAt = [sx, sz];
  }

  /* the counter you talk across */
  {
    const [cx2, cz2] = L2W(info.gapAt ?? 0, info.d / 2 + 1.1);
    a.talkAt = [cx2, cz2];
  }

  /* racks of finished work on both side walls */
  for (const side of [-1, 1]) {
    const sub = new MeshBuilder();
    const ri = P.buildWeaponRack(sub, { seed: r.seed(), w: r.range(1.4, 2.0) });
    const [rx, rz] = L2W(side * (info.w / 2 - 0.5), -info.d * 0.12);
    put('solid', sub, rx, rz, yaw + side * Math.PI / 2, onFloor(rx, rz), 0, TOOL);
    blockers.push({ x: rx, z: rz, r: 0.5 * TOOL });
  }

  /* --------------------------------------------------------------------
     THE REST OF THE SHOP.

     This is the building the player comes back to after every walk in the
     wood, and it is the only interior they will ever look at properly. An
     empty shed with a bench in it says the Stickwright turned up this
     morning; an anvil, a furnace, a rack of tools, a bin of offcuts and a
     drift of shavings on the floor say she has been doing this for forty
     years. It is all static dressing and costs nothing to run.
     -------------------------------------------------------------------- */

  /* the anvil, on its own stump, where she can reach it from the bench */
  {
    const sub = new MeshBuilder();
    P.buildAnvil(sub, { seed: r.seed() });
    const [ax, az] = L2W(-info.w * 0.30, -info.d * 0.05);
    put('solid', sub, ax, az, yaw + r.range(-0.4, 0.4), onFloor(ax, az), 0, TOOL);
    blockers.push({ x: ax, z: az, r: 0.42 * TOOL });
    a.anvilAt = [ax, az];
    a.anvilTop = a.floorY + 0.76 * TOOL;          // on the boards, not the meadow
  }

  /* the grindstone, by the opening where the light is */
  {
    const sub = new MeshBuilder();
    P.buildGrindstone(sub, { seed: r.seed() });
    const [gx, gz] = L2W(info.w * 0.30, info.d * 0.16);
    put('solid', sub, gx, gz, yaw + Math.PI / 2 + r.range(-0.3, 0.3), onFloor(gx, gz), 0, TOOL);
    blockers.push({ x: gx, z: gz, r: 0.40 * TOOL });
    a.grindAt = [gx, gz];
    a.grindTop = a.floorY + 1.02 * TOOL;   // the top of the wheel, not the frame
  }

  /* SHAVINGS. A drift of curled offcuts under the bench and round the
     anvil — the cheapest possible detail and the one that most says
     somebody works here rather than poses here. */
  {
    const sub = new MeshBuilder();
    const n = r.int(26, 44);
    for (let i = 0; i < n; i++) {
      const ang = r.range(0, TAU);
      const rad = Math.sqrt(r()) * 1.9;
      const lx = 0.1 + Math.cos(ang) * rad;
      const lz = -info.d * 0.14 + Math.sin(ang) * rad * 0.8;
      sub.color(mixHex(BARK.deadWood, 0xe8d8b0, r.range(0.3, 0.9)), 0.09, r);
      // a shaving is a curl, so it is a short flattened arc not a chip
      const curl = r.range(0.4, 1.5), len = r.range(0.05, 0.13);
      const pts = [];
      for (let k = 0; k <= 3; k++) {
        const u = k / 3;
        pts.push([lx + Math.cos(ang + u * curl) * len * u,
        0.012 + Math.sin(u * 3.1) * 0.012,
        lz + Math.sin(ang + u * curl) * len * u]);
      }
      tube(sub, {
        pts, radius: () => r.range(0.007, 0.016), radial: 3,
        squash: () => [1, 0.35], capStart: false, capEnd: false, sway: () => 0,
      });
    }
    const [sx2, sz2] = L2W(0, 0);
    put('solid', sub, sx2, sz2, yaw, onFloor(sx2, sz2));
  }

  /* STACKS OF STICKS, sorted by length the way any workshop sorts stock —
     the long ones upright in a barrel, the short ones in a crate */
  {
    const sub = new MeshBuilder();
    P.buildBarrel(sub, { seed: r.seed() });
    const [bx2, bz2] = L2W(-info.w * 0.40, -info.d * 0.32);
    put('solid', sub, bx2, bz2, yaw, onFloor(bx2, bz2));
    blockers.push({ x: bx2, z: bz2, r: 0.36 });
    // the staves sticking out of it
    const stx = new MeshBuilder();
    for (let i = 0; i < r.int(5, 9); i++) {
      const ang = r.range(0, TAU), rad = r.range(0, 0.19);
      const lean = r.range(0.06, 0.26), la = r.range(0, TAU);
      stx.color(mixHex(BARK.hazel, BARK.ash, r()), 0.1, r);
      const h = r.range(0.9, 1.7);
      tube(stx, {
        pts: [[Math.cos(ang) * rad, 0.35, Math.sin(ang) * rad],
        [Math.cos(ang) * rad + Math.cos(la) * lean * h, 0.35 + h, Math.sin(ang) * rad + Math.sin(la) * lean * h]],
        radius: t => r.range(0.016, 0.028) * (1 - t * 0.25), radial: 5,
        capStart: true, capEnd: true, sway: () => 0,
      });
    }
    put('solid', stx, bx2, bz2, yaw, onFloor(bx2, bz2));
  }
  {
    const sub = new MeshBuilder();
    P.buildCrate(sub, { seed: r.seed() });
    const [kx, kz] = L2W(info.w * 0.36, -info.d * 0.34);
    put('solid', sub, kx, kz, yaw + r.range(-0.4, 0.4), onFloor(kx, kz));
    blockers.push({ x: kx, z: kz, r: 0.34, low: true });
  }

  /* NOTE: no tool wall here. buildWorkbench already carries one — a plank
     board behind the bench with hammers, rasps and a coil of cord hanging
     off it, which is why the bench measures 2.3 m tall rather than 0.9. A
     second one bolted to the shed wall put two boards of tools a few
     centimetres apart. */

  /* FINISHED WORK, leaning in the corner where it is out of the way */
  {
    const sub = new MeshBuilder();
    for (let i = 0; i < r.int(2, 4); i++) {
      const lx = -info.w * 0.44 + i * 0.09;
      const h = r.range(0.85, 1.35);
      sub.color(mixHex(BARK.ash, BARK.oak, r()), 0.09, r);
      tube(sub, {
        pts: [[lx, 0, -info.d * 0.40], [lx + r.range(-0.05, 0.05), h, -info.d * 0.40 + 0.22]],
        radius: t => r.range(0.018, 0.026) * (1 - t * 0.2), radial: 5,
        capStart: true, capEnd: true, sway: () => 0,
      });
      // a bound grip on each, so they read as finished rather than as stock
      sub.color(BUILD.rope, 0.07, r);
      for (let k = 0; k < 5; k++) {
        const u = 0.18 + k * 0.035;
        blob(sub, lx + r.range(-0.05, 0.05) * u, h * u, -info.d * 0.40 + 0.22 * u,
          0.026, 3, 5, (px, py, pz) => [1, 0.45, 1]);
      }
    }
    const [fx2, fz2] = L2W(0, 0);
    put('solid', sub, fx2, fz2, yaw, onFloor(fx2, fz2));
  }

  /* stacks of branches leaning against the outside wall */
  for (let i = 0; i < r.int(2, 4); i++) {
    const sub = new MeshBuilder();
    P.buildWoodpile(sub, { seed: r.seed(), w: r.range(1.4, 2.2), h: r.range(0.8, 1.5), d: 0.7, neat: r.range(0.3, 0.8) });
    const [wx, wz] = L2W(r.sign() * (info.w / 2 + r.range(0.6, 1.4)), r.range(-info.d * 0.3, info.d * 0.3));
    put('solid', sub, wx, wz, yaw + Math.PI / 2 + r.range(-0.3, 0.3), 0, 0.3);
    blockers.push({ x: wx, z: wz, r: 0.8, low: true });
  }

  /* a lantern hanging at the counter, and the forge-warm interior glow */
  {
    const [lx, lz] = L2W(-info.w * 0.38, info.d / 2 - 0.15);
    const sub = new MeshBuilder(), g = new MeshBuilder();
    P.buildLantern(sub, { seed: r.seed(), kind: 'hang', h: 2.15, glow: g });
    put('solid', sub, lx, lz, 0);
    put('glow', g, lx, lz, 0);
    lights.push({ x: lx, y: T.height(lx, lz) + 2.0, z: lz, color: BUILD.lanternGlow, intensity: 1.5 });
  }
  {
    /* THE HEARTH. Dressing until the cutscene needed somewhere to put the
       heat: it is recorded as an anchor now, because the forging scene
       stages a whole beat against it — she works the bellows here and the
       coals throw the only warm light in the shop. Anything the cutscene
       stands at has to be findable, or the beat gets staged against a
       guess and drifts the next time the shop is laid out. */
    const [fx, fz] = L2W(-info.w * 0.3, -info.d * 0.3);
    const sub = new MeshBuilder(), g = new MeshBuilder();
    P.buildFirePit(sub, { seed: r.seed(), r: 0.42, glow: g });
    put('solid', sub, fx, fz, 0, onFloor(fx, fz));
    put('glow', g, fx, fz, 0, onFloor(fx, fz));
    lights.push({ x: fx, y: T.height(fx, fz) + 0.5, z: fz, color: BUILD.fire, intensity: 1.7, flicker: true });
    a.forgeAt = [fx, fz];
    /* `a.floorY`, NOT `onFloor(...)`: onFloor returns the LIFT needed to
       stand a prop on the boards, not a height above the world, and using
       it here put the cutscene's hearth five and a half metres underground
       — where the camera dutifully went and filmed nothing at all. */
    a.forgeTop = a.floorY + 0.24;                // the top of the coals
  }

  /* the sign over the door */
  {
    const sub = new MeshBuilder();
    P.buildSign(sub, { seed: r.seed(), kind: 'hanging', glyph: 'stick', h: 2.9, w: 1.0 });
    const [sx, sz] = L2W(info.w * 0.45, info.d / 2 + 0.5);
    put('solid', sub, sx, sz, yaw + Math.PI);
    blockers.push({ x: sx, z: sz, r: 0.25 });
  }
}

/* ------------------------------------------------------------- outskirts */

/* ========================================================================= */
/* THE FISHERY                                                               */
/* ========================================================================= */

/**
 * The fisherman's booth on the bank.
 *
 * WHY THE BOOTH EXISTS AT ALL. Fishing is the economy, so the fisherman is
 * the single most-visited NPC in the game, and the first version had him
 * wandering the village like everybody else — which meant arriving with a
 * full creel and then hunting for the one person who would buy it. He has a
 * shop now. He stands behind it, he steps about behind it, and he is where
 * he was the last time you came.
 *
 * The booth is placed by WALKING OUT FROM THE WATER rather than at a fixed
 * coordinate, because the river is carved procedurally and moves whenever
 * the terrain seed does. Find the bank, set the booth back from it, turn it
 * to face the water: that reads as a fishing shop wherever it lands.
 */
function dressFishery(T, plan, put, r, blockers, lights, npcSpots, anchors) {
  const V = WORLD.village;
  const z = V.cz + 34;
  const cx = riverX(z);
  const lvl = riverLevel(z);

  /* find dry ground on the near bank */
  let bank = null;
  for (const side of [1, -1]) {
    for (let d = WORLD.river.width * 0.4; d < WORLD.river.bankWidth * 2.6; d += 0.4) {
      const x = cx + side * d;
      if (T.height(x, z) > lvl + 0.35) { bank = { x, z, side, d }; break; }
    }
    if (bank) break;
  }
  if (!bank) return;

  /* set the booth back from the edge so the player can stand between it and
     the water — that gap is where the fishing actually happens */
  const bx = bank.x + bank.side * 2.6;
  const bz = z;
  const yaw = Math.atan2(cx - bx, 0);          // facing the river

  const sub = new MeshBuilder(), g = new MeshBuilder();
  const info = P.buildFishStall(sub, { seed: r.seed(), w: 2.9, d: 1.7, glow: g });
  put('solid', sub, bx, bz, yaw);
  if (!g.isEmpty) put('glow', g, bx, bz, yaw);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const L2W = (lx, lz) => [bx + lx * c + lz * s, bz - lx * s + lz * c];
  for (const b of info.blockers) {
    const [wx, wz] = L2W(b.x, b.z);
    blockers.push({ x: wx, z: wz, r: b.r });
  }
  lights.push({
    x: bx, y: T.height(bx, bz) + info.light.y, z: bz,
    color: info.light.c, intensity: info.light.i,
  });

  const [sx, sz] = L2W(info.standAt[0], info.standAt[1]);
  const [tx, tz] = L2W(info.talkAt[0], info.talkAt[1]);
  anchors.fishery = {
    x: bx, z: bz, yaw,
    standAt: [sx, sz], talkAt: [tx, tz],
    /* the water the tutorial points at, and the spot the player casts from */
    water: [cx, z],
    castAt: [bank.x - bank.side * 0.6, z],
  };
  npcSpots.push({ x: sx, z: sz, kind: 'fishstall', yaw });

  /* a few barrels and a upturned boat, so the bank reads as somebody's
     place of work rather than as a shed dropped on grass */
  for (let i = 0; i < 3; i++) {
    const a = r.range(0, TAU), rad = r.range(2.2, 4.4);
    const px = bx + Math.cos(a) * rad, pz = bz + Math.sin(a) * rad;
    if (Math.abs(px - riverX(pz)) < WORLD.river.width * 0.6) continue;
    const sb = new MeshBuilder();
    if (r.chance(0.5)) P.buildBarrel(sb, { seed: r.seed() });
    else P.buildCrate(sb, { seed: r.seed() });
    put('solid', sb, px, pz, r.range(0, TAU));
    blockers.push({ x: px, z: pz, r: 0.34, low: true });
  }
}

function dressOutskirts(T, plan, put, r, blockers, lights, npcSpots) {
  const V = WORLD.village;
  const cx = V.cx, cz = V.cz;

  /* an orchard on the south-west slope: rows, because it was planted */
  const ox = cx - 52, oz = cz + 74;
  const rows = 5, cols = 6;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (r.chance(0.10)) continue;
      const x = ox + i * 6.2 + r.range(-0.9, 0.9) + j * 1.4;
      const z = oz + j * 6.0 + r.range(-0.9, 0.9);
      const sub = new MeshBuilder();
      const info = buildTree(sub, {
        species: 'applewood', seed: r.seed(), lod: 0, scale: r.range(0.55, 1.0), mossy: 0.4,
      });
      put('flora', sub, x, z, r.range(0, TAU), 0, 0.12);
      blockers.push({ x, z, r: Math.max(0.35, info.trunkR * 1.6) });
    }
  }

  /* fields of vegetables and a haystack or two, south of the village */
  for (let f = 0; f < 5; f++) {
    const fx = cx + r.range(-10, 46), fz = cz + r.range(88, 140);
    for (let i = 0; i < r.int(3, 7); i++) {
      const sub = new MeshBuilder();
      P.buildVegBed(sub, {
        seed: r.seed(), w: r.range(2.0, 3.4), d: r.range(1.1, 1.7),
        crop: r.pick(['cabbage', 'carrot', 'bean', 'herb']),
      });
      const x = fx + r.range(-6, 6), z = fz + i * 2.2 + r.range(-0.5, 0.5);
      put('flora', sub, x, z, r.range(-0.2, 0.2), 0, 0.4);
    }
    if (r.chance(0.55)) {
      const sub = new MeshBuilder();
      P.buildHaystack(sub, { seed: r.seed(), R: r.range(0.9, 1.5), h: r.range(1.5, 2.3) });
      const x = fx + r.range(-9, 9), z = fz + r.range(-6, 6);
      put('flora', sub, x, z, r.range(0, TAU), 0, 0.25);
      blockers.push({ x, z, r: 1.2 });
    }
    if (r.chance(0.45)) {
      const sub = new MeshBuilder();
      P.buildScarecrow(sub, { seed: r.seed(), h: r.range(1.6, 2.0) });
      const x = fx + r.range(-8, 8), z = fz + r.range(-6, 6);
      put('solid', sub, x, z, r.range(0, TAU), 0, 0.2);
      blockers.push({ x, z, r: 0.3 });
    }
  }

  /* the fence line that tells you where the village ends and the wood begins */
  const segs = 44;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * TAU, a1 = ((i + 1) / segs) * TAU;
    // ragged: the fence is not a perfect circle and it has gaps
    if (r.chance(0.30)) continue;
    const rr0 = V.radius * r.range(0.86, 1.0);
    const rr1 = V.radius * r.range(0.86, 1.0);
    const ax = cx + Math.cos(a0) * rr0, az = cz + Math.sin(a0) * rr0;
    const bx = cx + Math.cos(a1) * rr1, bz = cz + Math.sin(a1) * rr1;
    // never fence across the river or a road
    if (Math.abs(ax - riverX(az)) < 22 || Math.abs(bx - riverX(bz)) < 22) continue;
    let onPath = false;
    for (const p of plan.paths) {
      if (segDist((ax + bx) / 2, (az + bz) / 2, p.ax, p.az, p.bx, p.bz) < p.w * 1.4) onPath = true;
    }
    if (onPath) continue;
    const mid = [(ax + bx) / 2, (az + bz) / 2];
    const fb = new MeshBuilder();
    P.buildFence(fb, {
      ax: ax - mid[0], az: az - mid[1], bx: bx - mid[0], bz: bz - mid[1],
      seed: r.seed(), kind: r.pick(['rail', 'rail', 'wattle', 'stone']), h: r.range(0.9, 1.2),
      groundAt: (lx, lz) => T.height(mid[0] + lx, mid[1] + lz) - T.height(mid[0], mid[1]),
    });
    put('solid', fb, mid[0], mid[1], 0);
  }

  /* gates where the roads leave */
  for (const p of plan.paths) {
    const d = Math.hypot(p.bx - cx, p.bz - cz);
    if (d < V.radius * 0.72 || d > V.radius * 1.1) continue;
    const sub = new MeshBuilder();
    P.buildGate(sub, { seed: r.seed(), w: p.w + 0.6, h: 1.15 });
    const yaw = Math.atan2(p.bx - p.ax, p.bz - p.az);
    put('solid', sub, p.bx, p.bz, yaw);
  }
}
