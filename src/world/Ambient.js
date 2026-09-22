/* Ambient.js — the small moving things.
   ===========================================================================
   Fireflies, drifting leaves, pollen in the sunbeams, butterflies, birds
   crossing the canopy, chimney smoke, and the gusts that run through the
   wood. None of it is gameplay. All of it is the difference between a place
   and a diorama.

   Everything here is ONE draw call per effect, built from a single points or
   triangle buffer that is rewritten on the CPU each frame. The counts are
   small enough (a few hundred) that this is cheaper than any clever solution
   and infinitely easier to tune.

   THE RULE FOR ALL OF IT: particles live in a box AROUND THE PLAYER and wrap
   when they leave it. Spawning them in world space means you walk out of your
   own atmosphere; wrapping means the air is always full and nothing ever pops
   in at the edge of vision.
*/

import * as THREE from '../../lib/three.module.js?v=1790102737';
import { MeshBuilder, blob, blade } from '../art/Geo.js?v=1790102737';
import { LEAF, BUILD, MUSHROOM, PLANT, mixHex, tweak } from '../art/Palette.js?v=1790102737';
import { makeRng, clamp, clamp01, lerp, TAU, smoothstep } from '../core/Util.js?v=1790102737';
import { windU } from '../art/Materials.js?v=1790102737';

/* ========================================================================= */

export class Ambient {
  constructor(scene, terrain) {
    this.scene = scene;
    this.T = terrain;
    this.rnd = makeRng(0xa8b1e7);
    this.t = 0;
    this.gust = 0;
    this.gustTarget = 0;
    this.nextGust = 2;

    this.group = new THREE.Group();
    this.group.frustumCulled = false;
    scene.add(this.group);

    this._makeMotes();
    this._makeFireflies();
    this._makeLeaves();
    this._makeButterflies();
    this._makeBirds();
    this._makeSmoke();
  }

  /* --------------------------------------------------------------- MOTES */

  /* Dust and pollen. Almost invisible individually; collectively they are
     what makes a shaft of afternoon light look like a shaft of light. */
  _makeMotes() {
    const N = 260;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    this.moteData = [];
    for (let i = 0; i < N; i++) {
      this.moteData.push({
        x: this.rnd.range(-16, 16), y: this.rnd.range(0.2, 7), z: this.rnd.range(-16, 16),
        ph: this.rnd.range(0, TAU), sp: this.rnd.range(0.2, 0.7),
      });
      const w = this.rnd.range(0.7, 1);
      col[i * 3] = w; col[i * 3 + 1] = w * 0.96; col[i * 3 + 2] = w * 0.78;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.moteMat = new THREE.PointsMaterial({
      size: 0.035, vertexColors: true, transparent: true, opacity: 0.5,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: true,
    });
    this.motes = new THREE.Points(g, this.moteMat);
    this.motes.frustumCulled = false;
    this.group.add(this.motes);
  }

  /* ----------------------------------------------------------- FIREFLIES */

  /* Only after dusk, only in the wood and near water, and they BLINK — a
     firefly that glows steadily is a fairy light. */
  _makeFireflies() {
    const N = 90;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    this.flyData = [];
    for (let i = 0; i < N; i++) {
      this.flyData.push({
        x: this.rnd.range(-22, 22), y: this.rnd.range(0.3, 3.4), z: this.rnd.range(-22, 22),
        ph: this.rnd.range(0, TAU), sp: this.rnd.range(0.35, 1.1),
        blinkPh: this.rnd.range(0, TAU), blinkSp: this.rnd.range(0.6, 1.6),
        warm: this.rnd.range(0, 1),
      });
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.flyMat = new THREE.PointsMaterial({
      size: 0.11, vertexColors: true, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: true,
    });
    this.fireflies = new THREE.Points(g, this.flyMat);
    this.fireflies.frustumCulled = false;
    this.group.add(this.fireflies);
  }

  /* -------------------------------------------------------------- LEAVES */

  /* Real geometry, not points: a falling leaf has to TUMBLE, and a point
     cannot. Sixty of them is plenty. */
  _makeLeaves() {
    const N = 60;
    const b = new MeshBuilder();
    const r = this.rnd;
    this.leafData = [];
    for (let i = 0; i < N; i++) {
      const base = b.vertexCount;
      b.color(tweak(r.chance(0.5) ? LEAF.oakAutumn : LEAF.dead, { h: r.range(-0.04, 0.05), l: r.range(0.8, 1.2) }), 0.1, r);
      blade(b, { len: r.range(0.06, 0.13), wid: r.range(0.03, 0.06), segs: 1, curl: 0.4, cup: 0.35, swayBase: 0, swayTip: 0 });
      this.leafData.push({
        base, count: b.vertexCount - base,
        x: r.range(-18, 18), y: r.range(0.5, 11), z: r.range(-18, 18),
        vy: -r.range(0.25, 0.7), spin: r.range(-3, 3), ph: r.range(0, TAU),
        drift: r.range(0.3, 1.1),
      });
    }
    const geo = b.build({ flat: false });
    this.leafGeo = geo;
    this.leafBase = new Float32Array(geo.attributes.position.array);
    this.leaves = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
      vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.95,
    }));
    this.leaves.frustumCulled = false;
    this.group.add(this.leaves);
  }

  /* --------------------------------------------------------- BUTTERFLIES */

  _makeButterflies() {
    const N = 14;
    const b = new MeshBuilder();
    const r = this.rnd;
    this.flutterData = [];
    for (let i = 0; i < N; i++) {
      const base = b.vertexCount;
      const hex = r.pick([0xf2cf54, 0xf6f4e8, 0xe89347, 0x9a72c0, 0xd2503f, 0x7a8fd0]);
      b.color(hex, 0.08, r);
      // two pairs of wings, mirrored
      for (const s of [-1, 1]) {
        const sub = [];
        const W = r.range(0.045, 0.075);
        sub.push(b.vert(0, 0, 0, 0));
        sub.push(b.vert(s * W, 0, W * 0.5, 0));
        sub.push(b.vert(s * W * 0.85, 0, -W * 0.7, 0));
        b.tri(sub[0], sub[1], sub[2]);
        b.tri(sub[0], sub[2], sub[1]);
      }
      this.flutterData.push({
        base, count: b.vertexCount - base,
        x: r.range(-14, 14), y: r.range(0.4, 2.2), z: r.range(-14, 14),
        ph: r.range(0, TAU), sp: r.range(0.5, 1.4), wing: r.range(0, TAU),
        tx: 0, tz: 0, retarget: 0,
      });
    }
    const geo = b.build({ flat: false });
    this.flutterGeo = geo;
    this.flutterBase = new Float32Array(geo.attributes.position.array);
    this.butterflies = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
      vertexColors: true, side: THREE.DoubleSide,
    }));
    this.butterflies.frustumCulled = false;
    this.group.add(this.butterflies);
  }

  /* --------------------------------------------------------------- BIRDS */

  /* Small dark shapes crossing high up. They are never close enough to need
     detail and they do more for "this world is alive" per triangle than
     anything else in the game. */
  _makeBirds() {
    const N = 9;
    const b = new MeshBuilder();
    const r = this.rnd;
    this.birdData = [];
    for (let i = 0; i < N; i++) {
      const base = b.vertexCount;
      b.color(r.chance(0.5) ? 0x2e2c28 : 0x3e3a32, 0.1, r);
      const W = r.range(0.16, 0.3);
      const v = [
        b.vert(0, 0, 0, 0),
        b.vert(-W, 0, -W * 0.35, 0),
        b.vert(W, 0, -W * 0.35, 0),
        b.vert(0, 0, W * 0.5, 0),
      ];
      b.tri(v[0], v[1], v[3]); b.tri(v[0], v[3], v[2]);
      b.tri(v[3], v[1], v[0]); b.tri(v[2], v[3], v[0]);
      this.birdData.push({
        base, count: b.vertexCount - base,
        a: r.range(0, TAU), rad: r.range(22, 70), y: r.range(14, 34),
        sp: r.range(0.08, 0.2) * r.sign(), flap: r.range(0, TAU), flapSp: r.range(5, 9),
      });
    }
    const geo = b.build({ flat: false });
    this.birdGeo = geo;
    this.birdBase = new Float32Array(geo.attributes.position.array);
    this.birds = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    this.birds.frustumCulled = false;
    this.group.add(this.birds);
  }

  /* --------------------------------------------------------------- SMOKE */

  /* Chimney smoke. Fixed positions (the chimneys), so it does NOT wrap. */
  _makeSmoke() {
    this.smokeSources = [];
    const N = 220;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    this.smokeData = [];
    for (let i = 0; i < N; i++) {
      this.smokeData.push({ src: -1, t: this.rnd.range(0, 1), sp: this.rnd.range(0.45, 0.95), ph: this.rnd.range(0, TAU) });
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.smokeMat = new THREE.PointsMaterial({
      size: 0.75, vertexColors: true, transparent: true, opacity: 0.30,
      depthWrite: false, sizeAttenuation: true, fog: true,
    });
    this.smoke = new THREE.Points(g, this.smokeMat);
    this.smoke.frustumCulled = false;
    this.group.add(this.smoke);
  }

  /** Village.js hands over the chimney positions once the village is built. */
  setSmokeSources(list) {
    this.smokeSources = list || [];
    const per = this.smokeData.length / Math.max(1, this.smokeSources.length);
    this.smokeData.forEach((d, i) => { d.src = Math.floor(i / per) % Math.max(1, this.smokeSources.length); });
  }

  /* ====================================================================== */
  /* UPDATE                                                                 */
  /* ====================================================================== */

  /**
   * @param env  { forest, village, water, open, night } 0..1 at the player
   */
  update(dt, cam, env = {}) {
    this.t += dt;
    const px = cam.x, py = cam.y, pz = cam.z;

    /* --- the wind. Gusts arrive, build and pass. ------------------------- */
    this.nextGust -= dt;
    if (this.nextGust <= 0) {
      this.gustTarget = this.rnd.chance(0.55) ? this.rnd.range(0.4, 1) : this.rnd.range(0, 0.25);
      this.nextGust = this.rnd.range(3.5, 11);
    }
    this.gust = lerp(this.gust, this.gustTarget, 1 - Math.exp(-0.7 * dt));
    windU.uGust.value = this.gust;
    windU.uWind.value = lerp(0.07, 0.17, this.gust);

    const forest = clamp01(env.forest ?? 0.5);
    const night = clamp01(env.night ?? 0);

    this._updateMotes(dt, px, py, pz, forest, night);
    this._updateFireflies(dt, px, py, pz, forest, night, env);
    this._updateLeaves(dt, px, py, pz, forest);
    this._updateButterflies(dt, px, py, pz, night, env);
    this._updateBirds(dt, px, py, pz, night);
    this._updateSmoke(dt, px, pz);
  }

  _wrap(d, px, pz, R) {
    if (d.x - px > R) d.x -= R * 2; else if (d.x - px < -R) d.x += R * 2;
    if (d.z - pz > R) d.z -= R * 2; else if (d.z - pz < -R) d.z += R * 2;
  }

  _updateMotes(dt, px, py, pz, forest, night) {
    const arr = this.motes.geometry.attributes.position.array;
    const R = 17;
    for (let i = 0; i < this.moteData.length; i++) {
      const d = this.moteData[i];
      d.ph += dt * d.sp;
      d.x += Math.sin(d.ph * 0.7) * dt * 0.35 + windU.uWindDir.value.x * dt * 0.5 * this.gust;
      d.z += Math.cos(d.ph * 0.5) * dt * 0.35 + windU.uWindDir.value.y * dt * 0.5 * this.gust;
      d.y += Math.sin(d.ph * 1.3) * dt * 0.18;
      const g = this.T ? this.T.heightC(d.x, d.z) : 0;
      if (d.y < g + 0.15) d.y = g + 0.15;
      if (d.y > g + 8) d.y = g + 0.4;
      this._wrap(d, px, pz, R);
      arr[i * 3] = d.x; arr[i * 3 + 1] = d.y; arr[i * 3 + 2] = d.z;
    }
    this.motes.geometry.attributes.position.needsUpdate = true;
    // they only show where light is actually getting through
    this.moteMat.opacity = lerp(0.18, 0.55, forest) * (1 - night * 0.9);
    this.motes.visible = this.moteMat.opacity > 0.02;
  }

  _updateFireflies(dt, px, py, pz, forest, night, env) {
    const arr = this.fireflies.geometry.attributes.position.array;
    const col = this.fireflies.geometry.attributes.color.array;
    const R = 24;
    const on = night * clamp01(forest * 0.7 + (env.water ?? 0) * 0.6 + 0.25);
    for (let i = 0; i < this.flyData.length; i++) {
      const d = this.flyData[i];
      d.ph += dt * d.sp;
      // a wandering drift, never a straight line and never a circle
      d.x += Math.sin(d.ph * 1.7) * dt * 0.55;
      d.z += Math.cos(d.ph * 1.1 + 1.4) * dt * 0.55;
      d.y += Math.sin(d.ph * 2.3) * dt * 0.30;
      const g = this.T ? this.T.heightC(d.x, d.z) : 0;
      if (d.y < g + 0.25) d.y = g + 0.25;
      if (d.y > g + 3.4) d.y = g + 3.0;
      this._wrap(d, px, pz, R);
      arr[i * 3] = d.x; arr[i * 3 + 1] = d.y; arr[i * 3 + 2] = d.z;

      // the blink: mostly dark, with a slow warm pulse
      const b = Math.pow(clamp01(Math.sin(this.t * d.blinkSp + d.blinkPh) * 0.5 + 0.5), 3.5);
      col[i * 3] = b * 1.0;
      col[i * 3 + 1] = b * lerp(0.95, 0.72, d.warm);
      col[i * 3 + 2] = b * lerp(0.45, 0.20, d.warm);
    }
    this.fireflies.geometry.attributes.position.needsUpdate = true;
    this.fireflies.geometry.attributes.color.needsUpdate = true;
    this.flyMat.opacity = on;
    this.fireflies.visible = on > 0.02;
  }

  _updateLeaves(dt, px, py, pz, forest) {
    const pos = this.leafGeo.attributes.position.array;
    const base = this.leafBase;
    const R = 19;
    const wd = windU.uWindDir.value;
    for (const d of this.leafData) {
      d.ph += dt * 2.2;
      d.y += d.vy * dt;
      d.x += (wd.x * (0.5 + this.gust * 1.6) + Math.sin(d.ph) * d.drift) * dt;
      d.z += (wd.y * (0.5 + this.gust * 1.6) + Math.cos(d.ph * 0.8) * d.drift) * dt;
      const g = this.T ? this.T.heightC(d.x, d.z) : 0;
      if (d.y < g) { d.y = g + this.rnd.range(6, 13); }
      this._wrap(d, px, pz, R);

      // tumble: a leaf spins about two axes at once, and that is the whole
      // reason it reads as a leaf and not as a scrap of paper
      const ca = Math.cos(this.t * d.spin), sa = Math.sin(this.t * d.spin);
      const cb = Math.cos(this.t * d.spin * 0.6 + d.ph), sb = Math.sin(this.t * d.spin * 0.6 + d.ph);
      for (let k = 0; k < d.count; k++) {
        const i = (d.base + k) * 3;
        const x0 = base[i], y0 = base[i + 1], z0 = base[i + 2];
        const x1 = x0 * ca - z0 * sa, z1 = x0 * sa + z0 * ca;
        const y2 = y0 * cb - z1 * sb, z2 = y0 * sb + z1 * cb;
        pos[i] = d.x + x1; pos[i + 1] = d.y + y2; pos[i + 2] = d.z + z2;
      }
    }
    this.leafGeo.attributes.position.needsUpdate = true;
    this.leafGeo.computeBoundingSphere();
    this.leaves.visible = forest > 0.08;
  }

  _updateButterflies(dt, px, py, pz, night, env) {
    const pos = this.flutterGeo.attributes.position.array;
    const base = this.flutterBase;
    const R = 15;
    for (const d of this.flutterData) {
      d.retarget -= dt;
      if (d.retarget <= 0) {
        d.tx = px + this.rnd.range(-12, 12);
        d.tz = pz + this.rnd.range(-12, 12);
        d.retarget = this.rnd.range(1.5, 5);
      }
      // butterflies do not fly in straight lines; they bob violently and
      // arrive roughly where they meant to
      const dx = d.tx - d.x, dz = d.tz - d.z;
      const l = Math.hypot(dx, dz) || 1;
      d.ph += dt * 5;
      d.x += (dx / l) * d.sp * dt + Math.sin(d.ph) * dt * 0.7;
      d.z += (dz / l) * d.sp * dt + Math.cos(d.ph * 1.3) * dt * 0.7;
      const g = this.T ? this.T.heightC(d.x, d.z) : 0;
      d.y = lerp(d.y, g + 0.6 + Math.sin(d.ph * 0.5) * 0.45, 1 - Math.exp(-3 * dt));
      this._wrap(d, px, pz, R);

      d.wing += dt * 22;
      const flap = Math.sin(d.wing) * 0.9;
      const head = Math.atan2(dx, dz);
      const ch = Math.cos(head), sh = Math.sin(head);
      for (let k = 0; k < d.count; k++) {
        const i = (d.base + k) * 3;
        const x0 = base[i], y0 = base[i + 1], z0 = base[i + 2];
        // fold the wings about the body axis
        const fy = Math.abs(x0) * flap;
        const x1 = x0 * Math.cos(flap * 0.6), y1 = y0 + fy;
        const x2 = x1 * ch + z0 * sh, z2 = -x1 * sh + z0 * ch;
        pos[i] = d.x + x2; pos[i + 1] = d.y + y1; pos[i + 2] = d.z + z2;
      }
    }
    this.flutterGeo.attributes.position.needsUpdate = true;
    this.flutterGeo.computeBoundingSphere();
    this.butterflies.visible = night < 0.4 && (env.open ?? 0.5) > 0.1;
  }

  _updateBirds(dt, px, py, pz, night) {
    const pos = this.birdGeo.attributes.position.array;
    const base = this.birdBase;
    for (const d of this.birdData) {
      d.a += dt * d.sp * 0.1;
      d.flap += dt * d.flapSp;
      const x = px + Math.cos(d.a) * d.rad;
      const z = pz + Math.sin(d.a) * d.rad;
      const g = this.T ? this.T.heightC(x, z) : 0;
      const y = Math.max(py, g) + d.y;
      const head = d.a + Math.PI * 0.5 * Math.sign(d.sp);
      const ch = Math.cos(head), sh = Math.sin(head);
      const flap = Math.sin(d.flap) * 0.55;
      for (let k = 0; k < d.count; k++) {
        const i = (d.base + k) * 3;
        const x0 = base[i], y0 = base[i + 1], z0 = base[i + 2];
        const y1 = y0 + Math.abs(x0) * flap;
        const x2 = x0 * ch + z0 * sh, z2 = -x0 * sh + z0 * ch;
        pos[i] = x + x2; pos[i + 1] = y + y1; pos[i + 2] = z + z2;
      }
    }
    this.birdGeo.attributes.position.needsUpdate = true;
    this.birdGeo.computeBoundingSphere();
    this.birds.visible = night < 0.6;
  }

  _updateSmoke(dt, px, pz) {
    if (!this.smokeSources.length) { this.smoke.visible = false; return; }
    const arr = this.smoke.geometry.attributes.position.array;
    const col = this.smoke.geometry.attributes.color.array;
    const wd = windU.uWindDir.value;
    let any = false;
    for (let i = 0; i < this.smokeData.length; i++) {
      const d = this.smokeData[i];
      const src = this.smokeSources[d.src];
      if (!src) { arr[i * 3 + 1] = -9999; continue; }
      const dist = Math.hypot(src.x - px, src.z - pz);
      if (dist > 130) { arr[i * 3 + 1] = -9999; continue; }
      any = true;
      d.t += dt * d.sp * 0.10;
      if (d.t > 1) d.t -= 1;
      const rise = d.t * 9;
      // it leans over with the wind as it rises and spreads as it cools
      const spread = 0.25 + d.t * 2.6;
      arr[i * 3] = src.x + wd.x * rise * (0.25 + this.gust * 0.6) + Math.sin(d.ph + d.t * 5) * spread * 0.4;
      arr[i * 3 + 1] = src.y + rise;
      arr[i * 3 + 2] = src.z + wd.y * rise * (0.25 + this.gust * 0.6) + Math.cos(d.ph + d.t * 4) * spread * 0.4;
      const fade = (1 - d.t) * clamp01(1 - dist / 130);
      const g = lerp(0.78, 0.95, d.t);
      col[i * 3] = g * fade; col[i * 3 + 1] = g * fade * 0.98; col[i * 3 + 2] = g * fade * 0.95;
    }
    this.smoke.geometry.attributes.position.needsUpdate = true;
    this.smoke.geometry.attributes.color.needsUpdate = true;
    this.smoke.visible = any;
  }
}
