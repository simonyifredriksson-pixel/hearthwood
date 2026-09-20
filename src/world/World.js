/* World.js — everything that exists, and what is currently loaded.
   ===========================================================================
   Owns the terrain, the village, the sky, the water, the atmosphere and the
   tile streamer. The rest of the game asks this object where the ground is,
   what is in the way, and what the air is like here.

   STREAMING is budgeted, not scheduled. Every frame the streamer is given a
   few milliseconds and does as much as it can: it builds the nearest missing
   tile first, then the next, and stops the moment the budget is gone. That
   keeps the frame rate flat while you walk, at the cost of detail arriving a
   little behind you — which is invisible, because it arrives behind you.

   THE LIGHT POOL exists because the village has four hundred lit windows,
   lanterns and fires, and WebGL can afford about eight. A fixed pool of real
   lights is reassigned each frame to the nearest sources and cross-faded, so
   walking down a street lights the lanterns you are next to and quietly
   releases the ones behind you.
*/

import * as THREE from '../../lib/three.module.js?v=20260920201841';
import { Terrain, riverX, riverLevel } from './Terrain.js?v=20260920201841';
import {
  buildTerrainTile, buildRiverMesh, buildRiverEdge, lodForDistance, detailForDistance,
} from './TerrainMesh.js?v=20260920201841';
import { scatterTile, stickSlots, stickContext, SCATTER_PASS_A, SCATTER_PASS_B } from './Scatter.js?v=20260920201841';
import { planVillage, buildVillage } from './Village.js?v=20260920201841';
import { Sky } from '../art/Sky.js?v=20260920201841';
import { Ambient } from './Ambient.js?v=20260920201841';
import { MATS, makeTerrainMaterial, makeWaterMaterial, updateWind } from '../art/Materials.js?v=20260920201841';
import { WATER, SKY } from '../art/Palette.js?v=20260920201841';
import { WORLD, RENDER } from '../core/Config.js?v=20260920201841';
import { rollStick } from '../data/StickData.js?v=20260920201841';
import { buildStick } from '../art/StickGen.js?v=20260920201841';
import { MeshBuilder } from '../art/Geo.js?v=20260920201841';
import { clamp, clamp01, lerp, now, Budget, TAU } from '../core/Util.js?v=20260920201841';

/** A far block is exactly 2x2 near tiles — see _rebuildWishlist. */
export const FAR_BLOCK = WORLD.tile * 2;
const FAR_RES = 16;
/**
 * Far blocks sit a hand's width below true ground.
 *
 * For the few frames while a block's near tiles are still arriving, both
 * resolutions are drawn over the same square. At 8 m spacing against 2.5 m
 * they interpenetrate, and you get a shimmering patchwork. Dropping the whole
 * far block — ground AND its trees, so it stays internally consistent — makes
 * the near mesh win that argument everywhere, every time. Nothing is ever
 * closer than a block away when it is the visible ground, and at that range
 * 30 cm is nothing.
 */
const FAR_DROP = 0.3;
/** How many far blocks out from the player get full near tiles. */
const NEAR_BLOCKS = 1;

const UP = new THREE.Vector3(0, 1, 0);

/* ========================================================================= */

export class World {
  constructor(scene, { onProgress = null } = {}) {
    this.scene = scene;
    this.onProgress = onProgress;

    this.terrain = new Terrain();
    this.T = this.terrain;

    this.matTerrain = makeTerrainMaterial();
    this.matWater = makeWaterMaterial(WATER.shallow, WATER.deep, SKY.mid);

    /* --- containers, one per kind so material state changes cluster ----- */
    this.gTerrain = new THREE.Group(); this.gTerrain.name = 'terrain';
    this.gDetail = new THREE.Group(); this.gDetail.name = 'detail';
    this.gVillage = new THREE.Group(); this.gVillage.name = 'village';
    this.gSticks = new THREE.Group(); this.gSticks.name = 'sticks';
    this.gWater = new THREE.Group(); this.gWater.name = 'water';
    scene.add(this.gTerrain, this.gDetail, this.gVillage, this.gSticks, this.gWater);

    this.tiles = new Map();        // key -> {tx,tz,lod,detail,meshes,blockers}
    this.blocks = new Map();       // key -> {bx,bz,meshes}  (the far ring)
    this.budget = new Budget(RENDER.tileBudgetMs);
    this.pending = [];
    this.farQueue = [];
    this.gFar = new THREE.Group(); this.gFar.name = 'far';
    scene.add(this.gFar);

    this.sky = new Sky(scene);
    this.ambient = new Ambient(scene, this.terrain);

    /* --- sticks ---------------------------------------------------------- */
    this.sticks = new Map();       // key -> {key, x, z, spec, mesh, glowMesh}
    this.takenSticks = new Set();  // keys already picked up
    this.stickBudget = new Budget(2.5);
    this._stickScanX = 1e9; this._stickScanZ = 1e9;
    this._stickSlots = null;

    /* --- lights ---------------------------------------------------------- */
    this.lightSources = [];
    this.lightPool = [];
    for (let i = 0; i < 9; i++) {
      const l = new THREE.PointLight(0xffbe63, 0, 17, 1.7);
      l.visible = false;
      scene.add(l);
      this.lightPool.push({ light: l, src: null, level: 0 });
    }

    this.blockers = [];            // static village blockers
    this.built = false;
    this._lastBlockX = 99999;
    this._lastBlockZ = 99999;
    this.activeBlocks = null;
  }

  /* ====================================================================== */
  /* BUILD                                                                  */
  /* ====================================================================== */

  /**
   * Drain the tile queue completely. Called once, while the loading screen
   * is still up, so the player's first second is not spent watching the wood
   * assemble itself around them.
   */
  prebuild(px, pz, maxMs = 3500) {
    this._rebuildWishlist(px, pz, Math.floor(px / FAR_BLOCK), Math.floor(pz / FAR_BLOCK));
    this._lastBlockX = Math.floor(px / FAR_BLOCK);
    this._lastBlockZ = Math.floor(pz / FAR_BLOCK);
    const t0 = now();
    while (this.pending.length && now() - t0 < maxMs) this._buildTile(this.pending.shift());
    while (this.farQueue.length && now() - t0 < maxMs * 1.6) this._buildFarBlock(this.farQueue.shift());
    this._hideCoveredBlocks();
    this._updateSticks(px, pz);
    return this.pending.length;
  }

  /** Build everything that is not streamed. Yields between stages so the
   *  loading bar can actually move. */
  async build() {
    const step = async (pct, label, fn) => {
      this.onProgress?.(pct, label);
      await new Promise(r => setTimeout(r, 0));
      return fn();
    };

    await step(0.06, 'shaping the valley', () => { /* terrain built in ctor */ });

    this.plan = await step(0.14, 'laying out Hearthwood', () => planVillage(this.terrain));

    const V = await step(0.30, 'raising the village', () => buildVillage(this.terrain, this.plan));
    this.village = V;

    await step(0.62, 'thatching the roofs', () => {
      for (const c of V.cells) {
        const add = (builder, mat, cast) => {
          if (builder.isEmpty) return;
          const m = new THREE.Mesh(builder.build({ flat: false }), mat);
          m.castShadow = cast; m.receiveShadow = true;
          m.geometry.computeBoundingSphere();
          this.gVillage.add(m);
        };
        add(c.solid, MATS.solid, true);
        add(c.flora, MATS.foliage, true);
        add(c.glow, MATS.glow, false);
      }
      this.blockers = V.blockers;
      this.lightSources = V.lights;
      this.ambient.setSmokeSources(V.smokes);
      this.anchors = V.anchors;
      this.npcSpots = V.npcSpots;
    });

    await step(0.78, 'letting the river in', () => {
      const w = new THREE.Mesh(buildRiverMesh(this.terrain), this.matWater);
      w.receiveShadow = false;
      w.renderOrder = 5;
      this.gWater.add(w);
      const e = new THREE.Mesh(buildRiverEdge(this.terrain), MATS.solid);
      e.receiveShadow = true;
      this.gWater.add(e);
    });

    await step(0.86, 'planting the wood', () => {
      /* THE FAR RING is built out of BLOCKS, not tiles, and this is a draw
         call decision rather than a detail one. At 64 m a tile, the far half
         of an 1800 m map is nearly eight hundred tiles; even at two meshes
         each that is sixteen hundred draw calls for scenery nobody can make
         out. One 256 m block carries sixteen tiles' worth of ground and
         silhouette in two meshes, and at that distance it is identical. */
      const half = Math.ceil(WORLD.half / FAR_BLOCK) + 1;
      for (let j = -half; j <= half; j++) {
        for (let i = -half; i <= half; i++) {
          const cx = (i + 0.5) * FAR_BLOCK, cz = (j + 0.5) * FAR_BLOCK;
          if (Math.abs(cx) > WORLD.half + FAR_BLOCK || Math.abs(cz) > WORLD.half + FAR_BLOCK) continue;
          const d = Math.hypot(cx - WORLD.village.cx, cz - WORLD.village.cz);
          this.farQueue.push({ bx: i, bz: j, dist: d });
        }
      }
      this.farQueue.sort((a, b) => a.dist - b.dist);
    });

    this.built = true;
    this.onProgress?.(1, 'ready');
    return this;
  }

  /* ====================================================================== */
  /* QUERIES                                                                */
  /* ====================================================================== */

  height(x, z) { return this.terrain.height(x, z); }
  normal(x, z) { return this.terrain.normal(x, z); }

  /** Is this point on a bridge deck? Bridges are the one place the walkable
   *  surface is not the terrain. */
  bridgeAt(x, z) {
    if (!this.plan) return null;
    for (const br of this.plan.bridges) {
      const dx = br.bx - br.ax, dz = br.bz - br.az;
      const L2 = dx * dx + dz * dz;
      const t = clamp01(((x - br.ax) * dx + (z - br.az) * dz) / L2);
      const cx = br.ax + dx * t, cz = br.az + dz * t;
      const off = Math.hypot(x - cx, z - cz);
      if (off > br.w * 0.55) continue;
      return br.y + Math.sin(t * Math.PI) * 0.28 + 0.06;
    }
    return null;
  }

  /** The height the player's feet should be at. */
  groundAt(x, z) {
    const b = this.bridgeAt(x, z);
    const h = this.terrain.height(x, z);
    if (b !== null && b > h - 0.6) return b;
    return h;
  }

  /** Everything solid near a point, for collision. */
  blockersNear(x, z, radius, out = []) {
    out.length = 0;
    const r2 = radius * radius;
    for (const b of this.blockers) {
      const dx = b.x - x, dz = b.z - z;
      if (dx * dx + dz * dz < r2) out.push(b);
    }
    const tr = Math.ceil(radius / WORLD.tile);
    const ti = Math.floor(x / WORLD.tile), tj = Math.floor(z / WORLD.tile);
    for (let j = tj - tr; j <= tj + tr; j++) {
      for (let i = ti - tr; i <= ti + tr; i++) {
        const t = this.tiles.get(`${i},${j}`);
        if (!t || !t.blockers) continue;
        for (const b of t.blockers) {
          const dx = b.x - x, dz = b.z - z;
          if (dx * dx + dz * dz < r2) out.push(b);
        }
      }
    }
    return out;
  }

  /** What the air is like here, for the ambience mix and the particles. */
  envAt(x, z) {
    const T = this.terrain;
    const forest = T.forestDensity(x, z);
    const vill = T.villageness(x, z);
    const ro = Math.abs(x - riverX(z));
    const water = clamp01(1 - ro / 34);
    const h = T.heightC(x, z);
    return {
      forest, village: vill, water,
      open: clamp01(1 - forest * 1.3),
      wind: clamp01(0.25 + (h - WORLD.village.datum) / 180 + (1 - forest) * 0.35),
      night: this.sky.state.night,
    };
  }

  /* ====================================================================== */
  /* STREAMING                                                              */
  /* ====================================================================== */

  update(dt, player, camera) {
    const px = player.x, pz = player.z;

    updateWind(this.sky ? this.sky._t : 0, this.ambient.gust);
    const sky = this.sky.update(dt, camera);
    const env = this.envAt(px, pz);
    this.ambient.update(dt, { x: px, y: player.y, z: pz }, env);
    this._updateLights(dt, px, pz);

    /* --- decide what should be loaded, but only when we have moved ------ */
    const bi = Math.floor(px / FAR_BLOCK), bj = Math.floor(pz / FAR_BLOCK);
    if (bi !== this._lastBlockX || bj !== this._lastBlockZ) {
      this._lastBlockX = bi; this._lastBlockZ = bj;
      this._rebuildWishlist(px, pz, bi, bj);
    }

    /* --- spend the frame's building budget ------------------------------ */
    this.budget.begin(RENDER.tileBudgetMs);
    while (this.pending.length && this.budget.ok()) {
      const job = this.pending.shift();
      this._buildTile(job);
    }
    // the far ring fills in afterwards, so the ground under your feet always
    // wins the budget over a hillside two kilometres away
    while (this.farQueue.length && this.budget.ok()) {
      this._buildFarBlock(this.farQueue.shift());
    }
    this._hideCoveredBlocks();

    this._updateSticks(px, pz);
    return { sky, env };
  }

  /**
   * THE NEAR SET IS A WHOLE NUMBER OF FAR BLOCKS, and that is the entire
   * trick that makes the two resolutions coexist.
   *
   * A far block is 2×2 near tiles. The detailed ring is every tile inside
   * the 3×3 block neighbourhood around the player — 36 tiles, always aligned
   * to the block grid — and exactly those 9 blocks are switched off. So the
   * two grids TILE each other perfectly: no overlap to z-fight, no gap to
   * see through, and no per-frame decision about which one wins.
   *
   * The alternative, a radius of tiles against a radius of blocks, leaves a
   * ragged boundary where blocks poke through near tiles that were built
   * from a finer height field. That artefact is visible from a long way off
   * and there is no offset or render order that reliably hides it.
   */
  _rebuildWishlist(px, pz, bi, bj) {
    const TPB = FAR_BLOCK / WORLD.tile;        // near tiles per far block
    const want = new Map();
    const activeBlocks = new Set();

    for (let dj = -NEAR_BLOCKS; dj <= NEAR_BLOCKS; dj++) {
      for (let di = -NEAR_BLOCKS; di <= NEAR_BLOCKS; di++) {
        const B = { bx: bi + di, bz: bj + dj };
        activeBlocks.add(`${B.bx},${B.bz}`);
        for (let tj = 0; tj < TPB; tj++) {
          for (let ti = 0; ti < TPB; ti++) {
            const x = B.bx * TPB + ti, z = B.bz * TPB + tj;
            const cx = (x + 0.5) * WORLD.tile, cz = (z + 0.5) * WORLD.tile;
            const d = Math.hypot(cx - px, cz - pz);
            want.set(`${x},${z}`, {
              tx: x, tz: z, lod: lodForDistance(d), detail: detailForDistance(d), dist: d,
            });
          }
        }
      }
    }
    this.activeBlocks = activeBlocks;
    this.wantTiles = want;

    for (const [key] of this.tiles) if (!want.has(key)) this._dropTile(key);

    /* Queue only the parts that are actually MISSING.
       Re-queueing 'bulk' and 'floor' for a tile that already had them added a
       second copy of every tree and every blade of grass to the same tile,
       every time the player crossed a block boundary. Nothing was ever
       removed, so the scene grew without limit and the frame rate fell away
       as you walked. That was the lag. */
    const jobs = [];
    for (const [key, w] of want) {
      const have = this.tiles.get(key);
      const stale = have && (have.lod !== w.lod || have.detail !== w.detail);
      if (stale) { this._dropTile(key); }
      const rec = stale ? null : have;
      if (!rec) {
        jobs.push({ ...w, part: 'terrain', prio: 0 });
        jobs.push({ ...w, part: 'bulk', prio: 1 });
        jobs.push({ ...w, part: 'floor', prio: 2 });
        continue;
      }
      if (!rec.parts.terrain) jobs.push({ ...w, part: 'terrain', prio: 0 });
      if (!rec.parts.bulk) jobs.push({ ...w, part: 'bulk', prio: 1 });
      if (!rec.parts.floor) jobs.push({ ...w, part: 'floor', prio: 2 });
    }
    jobs.sort((a, b) => (a.prio - b.prio) || (a.dist - b.dist));
    this.pending = jobs;

    /* GROUND IS NOT OPTIONAL, so the tiles closest to the player get their
       terrain right now rather than dribbled out over the next second.
       It is deliberately a time budget and not "all of them": a block
       crossing can want a dozen new tiles, and building the lot in one frame
       is a visible stutter. The rest is safe to stream because a far block
       stays switched on until all four of its tiles have ground under them
       (_blockCovered) and sits just below the near mesh (FAR_DROP), so the
       worst a late tile costs you is a moment of coarse ground — never a
       hole, and never a flickering fight between the two resolutions. */
    const t0 = now();
    const keep = [];
    for (const j of this.pending) {
      if (j.part === 'terrain' && now() - t0 < 24) this._buildTile(j);
      else keep.push(j);
    }
    this.pending = keep;
  }

  /** True once every near tile inside this far block has its ground. */
  _blockCovered(key) {
    const TPB = FAR_BLOCK / WORLD.tile;
    const [bx, bz] = key.split(',').map(Number);
    for (let tj = 0; tj < TPB; tj++) {
      for (let ti = 0; ti < TPB; ti++) {
        const rec = this.tiles.get(`${bx * TPB + ti},${bz * TPB + tj}`);
        if (!rec || !rec.parts.terrain) return false;
      }
    }
    return true;
  }

  /**
   * One job is one PART of a tile, not a whole tile. A full-detail tile takes
   * about a tenth of a second to generate, and the budget can only stop
   * BETWEEN jobs — so a job that big is a hitch you feel every time you cross
   * into new ground, however small the budget is. Three parts, three frames,
   * no hitch.
   */
  _buildTile(job) {
    const key = `${job.tx},${job.tz}`;
    const offset = new THREE.Vector3(job.tx * WORLD.tile, 0, job.tz * WORLD.tile);
    let rec = this.tiles.get(key);

    if (job.part === 'terrain') {
      if (rec) this._dropTile(key);
      const g = buildTerrainTile(this.terrain, job.tx, job.tz, job.lod);
      const tm = new THREE.Mesh(g, this.matTerrain);
      tm.position.copy(offset);
      tm.receiveShadow = true;
      tm.castShadow = false;
      this.gTerrain.add(tm);
      this.tiles.set(key, {
        ...job, meshes: [tm], blockers: [],
        parts: { terrain: true, bulk: false, floor: false },
      });
      return;
    }

    /* Its terrain was dropped out from under it between this job being queued
       and it running — the wishlist will requeue the lot, so drop this job.
       Without this guard `rec` is undefined, `add()` throws on the first
       mesh, and the exception takes the whole of update() with it: streaming
       stops dead and the ground simply stops arriving as you walk. */
    if (!rec || !rec.parts) return;
    if (rec.parts[job.part]) return;   // already built: never add it twice

    const add = (builder, mat, cast) => {
      if (builder.isEmpty) return;
      const geo = builder.build({ flat: false });
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(offset);
      m.castShadow = cast;
      m.receiveShadow = true;
      this.gDetail.add(m);
      rec.meshes.push(m);
    };

    if (job.part === 'bulk') {
      const s = scatterTile(this.terrain, job.tx, job.tz, job.detail, WORLD.tile, SCATTER_PASS_A);
      // only the closest band casts shadows: the shadow pass redraws every
      // caster, and a mid-distance tile's contribution to a 62 m shadow box
      // is almost always nothing at all
      add(s.solid, MATS.solid, job.detail === 0);
      add(s.flora, MATS.foliage, job.detail === 0);
      rec.blockers = s.blockers;
      rec.parts.bulk = true;
    } else {
      const s = scatterTile(this.terrain, job.tx, job.tz, job.detail, WORLD.tile,
        job.detail === 0 ? SCATTER_PASS_B.concat('grass') : SCATTER_PASS_B);
      add(s.solid, MATS.solid, false);
      add(s.flora, MATS.foliage, false);
      add(s.glow, MATS.glowSoft, false);
      // grass never casts a shadow: a very large amount of fill rate for a
      // mottling the ground's own detail already provides
      if (job.detail === 0) add(s.grass, MATS.grass, false);
      rec.parts.floor = true;
    }
  }

  /** One 256 m block of far scenery: ground plus silhouettes, two meshes. */
  _buildFarBlock(job) {
    const key = `${job.bx},${job.bz}`;
    if (this.blocks.has(key)) return;
    const offset = new THREE.Vector3(job.bx * FAR_BLOCK, -FAR_DROP, job.bz * FAR_BLOCK);
    const meshes = [];

    const g = buildTerrainTile(this.terrain, job.bx, job.bz, 3, FAR_BLOCK, FAR_RES);
    const tm = new THREE.Mesh(g, this.matTerrain);
    tm.position.copy(offset);
    tm.receiveShadow = false;
    this.gFar.add(tm);
    meshes.push(tm);

    const s = scatterTile(this.terrain, job.bx, job.bz, 3, FAR_BLOCK);
    if (!s.flora.isEmpty) {
      const geo = s.flora.build({ flat: false });
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, MATS.foliage);
      m.position.copy(offset);
      this.gFar.add(m);
      meshes.push(m);
    }
    this.blocks.set(key, { ...job, meshes, visible: true });
    if (this.activeBlocks && this.activeBlocks.has(key)) {
      for (const m of meshes) m.visible = false;
      this.blocks.get(key).visible = false;
    }
  }

  /**
   * Switch off exactly the blocks the detailed ring has taken over — but
   * ONLY once the near tiles that replace them actually exist. Hiding a
   * block the instant it becomes 'active' leaves a square hole in the world
   * for as long as the near tiles take to build, which is what 'the ground
   * is invisible' was.
   */
  _hideCoveredBlocks() {
    if (!this.activeBlocks) return;
    for (const [key, b] of this.blocks) {
      const vis = !(this.activeBlocks.has(key) && this._blockCovered(key));
      if (b.visible !== vis) {
        b.visible = vis;
        for (const m of b.meshes) m.visible = vis;
      }
    }
  }

  _dropTile(key) {
    const t = this.tiles.get(key);
    if (!t) return;
    for (const m of t.meshes) {
      m.parent?.remove(m);
      m.geometry.dispose();
    }
    this.tiles.delete(key);
  }

  /* ====================================================================== */
  /* STICKS                                                                 */
  /* ====================================================================== */

  /** Sticks are individually pickable, so each live one is its own mesh. */
  _updateSticks(px, pz) {
    const R = RENDER.stickRadius;
    /* Rescanning the slot grid is not free — every candidate cell asks the
       terrain four separate field questions — and the answer cannot change
       until the player has actually moved. Four metres of travel is about a
       tenth of the radius, which is far inside the margin. */
    const moved = Math.hypot(px - this._stickScanX, pz - this._stickScanZ);
    if (moved < 4 && this._stickSlots) {
      // still reconcile, in case something was taken since the last scan
      this._reconcileSticks(this._stickSlots);
      return;
    }
    this._stickScanX = px; this._stickScanZ = pz;
    const slots = stickSlots(this.terrain, px, pz, R);
    this._stickSlots = slots;
    this._reconcileSticks(slots);
  }

  _reconcileSticks(slots) {
    const live = new Set();

    this.stickBudget.begin(2.5);
    for (const slot of slots) {
      live.add(slot.key);
      if (this.takenSticks.has(slot.key)) continue;
      if (this.sticks.has(slot.key)) continue;
      if (!this.stickBudget.ok()) continue;
      this._spawnStick(slot);
    }

    for (const [key, s] of this.sticks) {
      if (live.has(key)) continue;
      this._despawnStick(key);
    }
  }

  _spawnStick(slot) {
    const spec = rollStick(slot.seed, stickContext(this.terrain, slot.x, slot.z));
    const b = new MeshBuilder();
    const glow = new MeshBuilder();
    // lod 1 for the body: a stick you can pick up is at most a couple of
    // metres away, but there can be a hundred of them on screen at once
    buildStick(spec, b, { lod: spec.rare ? 0 : 1, glow });
    const geo = b.build({ flat: false });

    /* lay it on the ground: rotate +Y to +Z, drop, tilt to the slope */
    const yaw = (slot.seed % 1000) / 1000 * TAU;
    const nrm = this.terrain.normal(slot.x, slot.z, 1.0);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, new THREE.Vector3(nrm[0], nrm[1], nrm[2]))
      .multiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));

    const mesh = new THREE.Mesh(geo, MATS.item);
    mesh.quaternion.copy(q);
    mesh.position.set(slot.x, this.terrain.height(slot.x, slot.z), slot.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.updateMatrixWorld();

    // settle it so no part of it is underground
    geo.computeBoundingBox();
    const bb = geo.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
    const drop = bb.min.y - mesh.position.y;
    mesh.position.y -= drop - 0.01;
    mesh.updateMatrixWorld();

    mesh.userData.stickKey = slot.key;
    this.gSticks.add(mesh);

    const rec = { key: slot.key, x: slot.x, z: slot.z, y: mesh.position.y, spec, mesh, glowMesh: null };
    if (!glow.isEmpty) {
      const gm = new THREE.Mesh(glow.build({ flat: false }), MATS.glow);
      gm.quaternion.copy(mesh.quaternion);
      gm.position.copy(mesh.position);
      this.gSticks.add(gm);
      rec.glowMesh = gm;
    }
    this.sticks.set(slot.key, rec);
  }

  _despawnStick(key) {
    const s = this.sticks.get(key);
    if (!s) return;
    s.mesh.parent?.remove(s.mesh);
    s.mesh.geometry.dispose();
    if (s.glowMesh) { s.glowMesh.parent?.remove(s.glowMesh); s.glowMesh.geometry.dispose(); }
    this.sticks.delete(key);
  }

  /** Take a stick out of the world for good. */
  takeStick(key) {
    const s = this.sticks.get(key);
    if (!s) return null;
    this.takenSticks.add(key);
    this._despawnStick(key);
    return s.spec;
  }

  /** The nearest stick within `range`, or null. */
  nearestStick(x, z, range) {
    let best = null, bestD = range * range;
    for (const s of this.sticks.values()) {
      const dx = s.x - x, dz = s.z - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  /* ====================================================================== */
  /* LIGHTS                                                                 */
  /* ====================================================================== */

  /**
   * Assign the pool to the nearest sources, fading in and out. A light that
   * simply snaps on when you get close is worse than no light at all.
   */
  _updateLights(dt, px, pz) {
    if (!this.lightSources.length) return;
    const night = this.sky.state.night;
    const on = clamp01(night * 1.4);

    /* the nearest N sources, cheaply: a partial selection, not a sort */
    const K = this.lightPool.length;
    const best = [];
    for (const s of this.lightSources) {
      const dx = s.x - px, dz = s.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 > 55 * 55) continue;
      if (best.length < K) { best.push({ s, d2 }); if (best.length === K) best.sort((a, b) => a.d2 - b.d2); }
      else if (d2 < best[K - 1].d2) { best[K - 1] = { s, d2 }; best.sort((a, b) => a.d2 - b.d2); }
    }

    const claimed = new Set(best.map(b => b.s));
    /* keep a slot on its current source if it is still in the best set */
    for (const slot of this.lightPool) {
      if (slot.src && !claimed.has(slot.src)) slot.src = null;
    }
    for (const b of best) {
      if (this.lightPool.some(s => s.src === b.s)) continue;
      const free = this.lightPool.find(s => !s.src && s.level < 0.05);
      if (free) free.src = b.s;
    }

    for (const slot of this.lightPool) {
      const want = slot.src ? 1 : 0;
      slot.level = lerp(slot.level, want, 1 - Math.exp(-3.5 * dt));
      if (slot.level < 0.01 && !slot.src) { slot.light.visible = false; continue; }
      if (slot.src) {
        slot.light.position.set(slot.src.x, slot.src.y, slot.src.z);
        slot.light.color.setHex(slot.src.color);
        const flick = slot.src.flicker ? 0.82 + Math.sin(this.sky._t * 11 + slot.src.x) * 0.10 + Math.sin(this.sky._t * 23.3 + slot.src.z) * 0.08 : 1;
        slot.light.intensity = slot.level * (slot.src.intensity ?? 1) * 7 * lerp(0.25, 1, on) * flick;
        slot.light.distance = slot.src.flicker ? 13 : 11;
        slot.light.visible = true;
      } else {
        slot.light.intensity *= 0.8;
        slot.light.visible = slot.light.intensity > 0.02;
      }
    }
  }

  /** Discs the camera boom must not end up inside. */
  cameraBlockers(x, z, out = []) {
    this.blockersNear(x, z, 9, out);
    return out.filter(b => !b.soft && !b.low);
  }
}
