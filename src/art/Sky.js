/* Sky.js — the light of Hearthwood.
   ===========================================================================
   A gradient dome, a sun, a moon, drifting cloud, stars after dusk, and the
   whole lighting rig that hangs off them. The day runs slowly — sixteen real
   minutes — and it starts in the middle of a golden afternoon, because that
   is the hour this game is about.

   THE DAY CYCLE EARNS ITS KEEP rather than being decoration: it is what makes
   the lanterns worth lighting, the windows worth glowing, and the fireflies
   worth having. A game where it is always noon has nothing to come home to.

   Everything is driven by ONE number, `phase`, running 0..1 over a day:
     0.00  midnight     0.25  dawn
     0.50  noon         0.75  dusk
   Every colour and intensity below is a curve on that number, so there is
   exactly one place to change how any hour of the day looks.
*/

import * as THREE from '../../lib/three.module.js?v=1790014463';
import { MeshBuilder, blob } from './Geo.js?v=1790014463';
import { SKY, LIGHT, mixHex, tweak, shade } from './Palette.js?v=1790014463';
import { RENDER } from '../core/Config.js?v=1790014463';
import { clamp, clamp01, lerp, smoothstep, invLerp, TAU, makeRng } from '../core/Util.js?v=1790014463';

/**
 * Seconds of real time per in-game day: EIGHT MINUTES OF LIGHT AND EIGHT OF
 * DARK. The keys below are laid out so the sun is up from 0.25 to 0.75 on
 * the nose, which is what makes that an even split rather than a hopeful
 * label — the old cycle was the same sixteen minutes but ten of them were
 * daylight, and the night went past before it had finished arriving.
 */
export const DAY_SECONDS = 16 * 60;

/* ========================================================================= */
/* THE COLOUR OF AN HOUR                                                     */
/* ========================================================================= */

/* Keyed by phase. Between keys everything is interpolated, so a sunset is a
   continuous slide rather than a set of states. */
const KEYS = [
  {
    p: 0.00, name: 'night',
    zenith: 0x141e3e, mid: 0x243358, horizon: 0x3a4468, haze: 0x384264,
    sun: 0x7f92c4, sunI: 0.32, ambSky: 0x4a5a92, ambGround: 0x2a3042, ambI: 0.74,
    fillI: 0.22, exposure: 1.40, fogMul: 1.4, star: 1,
  },
  {
    p: 0.15, name: 'small hours',
    zenith: 0x121c3a, mid: 0x223056, horizon: 0x384266, haze: 0x364062,
    sun: 0x8298c8, sunI: 0.34, ambSky: 0x4c5c96, ambGround: 0x2c3246, ambI: 0.78,
    fillI: 0.23, exposure: 1.42, fogMul: 1.4, star: 1,
  },
  {
    p: 0.25, name: 'first light',
    zenith: 0x2a3d70, mid: 0x6a6a8e, horizon: 0xc08a72, haze: 0xa8879a,
    sun: 0xd89a72, sunI: 0.55, ambSky: 0x6a6f96, ambGround: 0x3a3a38, ambI: 0.72,
    fillI: 0.18, exposure: 1.15, fogMul: 2.1, star: 0.35,
  },
  {
    p: 0.33, name: 'morning',
    zenith: 0x4a7ec0, mid: 0x9ab8d8, horizon: 0xf0d2a8, haze: 0xe8d4b4,
    sun: 0xffdcaa, sunI: 1.55, ambSky: 0x9ab4d8, ambGround: 0x6a6a48, ambI: 1.05,
    fillI: 0.26, exposure: 1.00, fogMul: 1.5, star: 0,
  },
  {
    p: 0.50, name: 'noon',
    zenith: 0x3f7ac8, mid: 0x8fb6dd, horizon: 0xdbe2cc, haze: 0xe4e6d4,
    sun: 0xfff4da, sunI: 2.15, ambSky: 0xa8c4e8, ambGround: 0x6e7346, ambI: 1.12,
    fillI: 0.30, exposure: 0.95, fogMul: 1.0, star: 0,
  },
  {
    p: 0.64, name: 'afternoon',
    zenith: 0x4a84c4, mid: 0x9dbcd8, horizon: 0xe8ddbc, haze: 0xe8dfc4,
    sun: 0xffeab8, sunI: 1.95, ambSky: 0xa4c0e4, ambGround: 0x746e42, ambI: 1.08,
    fillI: 0.30, exposure: 0.98, fogMul: 1.1, star: 0,
  },
  {
    p: 0.71, name: 'gold',
    zenith: 0x53709e, mid: 0xb49a94, horizon: 0xf4b878, haze: 0xeec098,
    sun: 0xffc07a, sunI: 1.70, ambSky: 0x9a9ec0, ambGround: 0x7a6238, ambI: 0.95,
    fillI: 0.26, exposure: 1.02, fogMul: 1.5, star: 0,
  },
  {
    p: 0.75, name: 'dusk',
    zenith: 0x2d3f70, mid: 0x6a5a86, horizon: 0xe08a58, haze: 0xb88a86,
    sun: 0xf08a50, sunI: 0.72, ambSky: 0x6a6f9c, ambGround: 0x4a3f38, ambI: 0.72,
    fillI: 0.18, exposure: 1.12, fogMul: 2.0, star: 0.25,
  },
  {
    p: 0.84, name: 'gloaming',
    zenith: 0x162040, mid: 0x2a3358, horizon: 0x5a4a6a, haze: 0x453f5c,
    sun: 0x7a6a94, sunI: 0.26, ambSky: 0x43507e, ambGround: 0x26262e, ambI: 0.52,
    fillI: 0.12, exposure: 1.24, fogMul: 1.8, star: 0.8,
  },
  {
    p: 0.92, name: 'nightfall',
    zenith: 0x141e3e, mid: 0x243358, horizon: 0x3a4468, haze: 0x384264,
    sun: 0x7f92c4, sunI: 0.32, ambSky: 0x4a5a92, ambGround: 0x2a3042, ambI: 0.74,
    fillI: 0.22, exposure: 1.40, fogMul: 1.4, star: 1,
  },
  {
    p: 1.00, name: 'night',
    zenith: 0x141e3e, mid: 0x243358, horizon: 0x3a4468, haze: 0x384264,
    sun: 0x7f92c4, sunI: 0.32, ambSky: 0x4a5a92, ambGround: 0x2a3042, ambI: 0.74,
    fillI: 0.22, exposure: 1.40, fogMul: 1.4, star: 1,
  },
];

/** The full lighting description for a moment in the day. */
export function skyAt(phase) {
  const p = ((phase % 1) + 1) % 1;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].p <= p) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = smoothstep(invLerp(a.p, b.p, p));
  return {
    phase: p,
    name: t < 0.5 ? a.name : b.name,
    zenith: mixHex(a.zenith, b.zenith, t),
    mid: mixHex(a.mid, b.mid, t),
    horizon: mixHex(a.horizon, b.horizon, t),
    haze: mixHex(a.haze, b.haze, t),
    sun: mixHex(a.sun, b.sun, t),
    sunI: lerp(a.sunI, b.sunI, t),
    ambSky: mixHex(a.ambSky, b.ambSky, t),
    ambGround: mixHex(a.ambGround, b.ambGround, t),
    ambI: lerp(a.ambI, b.ambI, t),
    fillI: lerp(a.fillI, b.fillI, t),
    exposure: lerp(a.exposure, b.exposure, t),
    fogMul: lerp(a.fogMul, b.fogMul, t),
    star: lerp(a.star, b.star, t),
    /** 0 in full day, 1 in full night. Drives lanterns and fireflies. */
    night: clamp01(smoothstep(invLerp(0.75, 0.88, p)) + smoothstep(invLerp(0.30, 0.20, p))),
  };
}

/** Where the sun is. It rises in the east and sets in the west, tilted so it
 *  never passes straight overhead — an overhead sun kills every shadow. */
export function sunDirection(phase) {
  const a = (phase - 0.25) * TAU;
  const tilt = 0.38;
  return new THREE.Vector3(
    Math.cos(a) * Math.cos(tilt) * 0.8 + Math.sin(tilt) * 0.25,
    Math.sin(a),
    Math.cos(a) * Math.sin(tilt) + 0.22,
  ).normalize();
}

/* ========================================================================= */
/* THE DOME                                                                  */
/* ========================================================================= */

export class Sky {
  constructor(scene, { radius = 1200 } = {}) {
    this.scene = scene;
    this.radius = radius;
    this.phase = 0.70;                    // a golden afternoon, to start
    this.paused = false;

    /* --- the gradient dome ------------------------------------------------
       A sphere with vertex colours, rendered from the inside with depth
       writing off so it can never occlude anything. The colours are rewritten
       every few frames rather than every frame: nobody can see a sky change
       over two frames, and it is thousands of vertex writes. */
    const geo = new THREE.SphereGeometry(radius, 28, 18);
    const n = geo.attributes.position.count;
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.domeGeo = geo;
    this.dome = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false,
      toneMapped: true,
    }));
    this.dome.renderOrder = -1000;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    /* --- sun and moon ---------------------------------------------------- */
    this.sunDisc = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.030, 14, 10),
      new THREE.MeshBasicMaterial({ color: SKY.sunDisc, fog: false, toneMapped: false }),
    );
    this.sunDisc.frustumCulled = false;
    scene.add(this.sunDisc);

    this.sunGlow = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.085, 14, 10),
      new THREE.MeshBasicMaterial({
        color: SKY.sun, fog: false, transparent: true, opacity: 0.22,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }),
    );
    this.sunGlow.frustumCulled = false;
    scene.add(this.sunGlow);

    this.moon = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.022, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0xe8eaf0, fog: false, toneMapped: false }),
    );
    this.moon.frustumCulled = false;
    scene.add(this.moon);

    /* --- stars ------------------------------------------------------------ */
    {
      const r = makeRng(0x57a25);
      const N = 420;
      const pos = new Float32Array(N * 3);
      const col = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        // only the upper hemisphere, and never near the horizon where the
        // haze would swallow them anyway
        const u = r.range(0.12, 1), th = r.range(0, TAU);
        const s = Math.sqrt(1 - u * u);
        pos[i * 3] = Math.cos(th) * s * radius * 0.96;
        pos[i * 3 + 1] = u * radius * 0.96;
        pos[i * 3 + 2] = Math.sin(th) * s * radius * 0.96;
        const warm = r();
        col[i * 3] = lerp(0.72, 1.0, warm);
        col[i * 3 + 1] = lerp(0.80, 0.96, warm);
        col[i * 3 + 2] = 1.0;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      this.starMat = new THREE.PointsMaterial({
        size: radius * 0.005, vertexColors: true, transparent: true, opacity: 0,
        depthWrite: false, fog: false, sizeAttenuation: true, toneMapped: false,
      });
      this.stars = new THREE.Points(g, this.starMat);
      this.stars.frustumCulled = false;
      scene.add(this.stars);
    }

    /* --- clouds: soft masses that drift and never repeat ----------------- */
    this.clouds = new THREE.Group();
    this.clouds.frustumCulled = false;
    scene.add(this.clouds);
    {
      const r = makeRng(0xc10d5);
      const mat = new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.85,
        depthWrite: false, fog: false, side: THREE.DoubleSide,
      });
      this.cloudMat = mat;
      for (let i = 0; i < 16; i++) {
        const b = new MeshBuilder();
        const lumps = r.int(4, 9);
        const W = r.range(60, 190);
        for (let k = 0; k < lumps; k++) {
          const cx = r.range(-W, W), cy = r.range(-8, 14), cz = r.range(-W * 0.35, W * 0.35);
          const rr = r.range(24, 62) * (1 - Math.abs(cx) / (W * 1.6));
          if (rr < 6) continue;
          b.color(SKY.cloud);
          blob(b, cx, cy, cz, rr, 3, 7,
            (x, y, z) => [1.25, 0.52, 1.0], 0,
            (x, y, z) => mixHex(SKY.cloudShade, SKY.cloud, clamp01(y * 0.6 + 0.62)));
        }
        const m = new THREE.Mesh(b.build({ flat: false }), mat);
        const a = (i / 16) * TAU + r.range(-0.15, 0.15);
        const d = radius * r.range(0.52, 0.80);
        m.position.set(Math.cos(a) * d, radius * r.range(0.16, 0.34), Math.sin(a) * d);
        m.rotation.y = -a + Math.PI / 2;
        m.userData.drift = r.range(0.0006, 0.0022);
        m.userData.angle = a;
        m.userData.dist = d;
        m.userData.h = m.position.y;
        this.clouds.add(m);
      }
    }

    /* --- the lights everything is actually lit by ------------------------- */
    this.sun = new THREE.DirectionalLight(LIGHT.sun, LIGHT.sunIntensity);
    this.sun.castShadow = true;
    const S = RENDER.shadow;
    this.sun.shadow.mapSize.set(S.size, S.size);
    this.sun.shadow.camera.near = S.near;
    this.sun.shadow.camera.far = S.far;
    this.sun.shadow.camera.left = -S.extent;
    this.sun.shadow.camera.right = S.extent;
    this.sun.shadow.camera.top = S.extent;
    this.sun.shadow.camera.bottom = -S.extent;
    this.sun.shadow.bias = S.bias;
    this.sun.shadow.normalBias = S.normalBias;
    this.sunTarget = new THREE.Object3D();
    scene.add(this.sun, this.sunTarget);
    this.sun.target = this.sunTarget;

    this.hemi = new THREE.HemisphereLight(LIGHT.skyAmbient, LIGHT.groundBounce, LIGHT.hemiIntensity);
    scene.add(this.hemi);

    /* a cool fill from the opposite side, so shadowed faces read as shadowed
       rather than as black. Without it every underside is a hole. */
    this.fill = new THREE.DirectionalLight(LIGHT.fill, LIGHT.fillIntensity);
    scene.add(this.fill);

    this.fog = new THREE.FogExp2(SKY.haze, RENDER.fogDensity);
    scene.fog = this.fog;

    this._domeDirty = true;
    this._t = 0;
    this.state = skyAt(this.phase);
  }

  /** Jump to a time of day. 0.7 is late afternoon. */
  setPhase(p) { this.phase = ((p % 1) + 1) % 1; this._domeDirty = true; }

  update(dt, camera) {
    this._t += dt;
    if (!this.paused) {
      this.phase = (this.phase + dt / DAY_SECONDS) % 1;
      // the dome only needs repainting when the colour has actually moved
      if (Math.floor(this._t * 3) !== this._lastPaint) { this._domeDirty = true; this._lastPaint = Math.floor(this._t * 3); }
    }
    const S = skyAt(this.phase);
    this.state = S;

    /* the whole sky follows the camera, so it is always infinitely far away */
    const cp = camera.position;
    this.dome.position.copy(cp);
    this.clouds.position.set(cp.x, 0, cp.z);
    this.stars.position.copy(cp);

    if (this._domeDirty) { this._paintDome(S); this._domeDirty = false; }

    /* --- sun, moon, stars -------------------------------------------------- */
    const dir = sunDirection(this.phase);
    this.sunDisc.position.copy(cp).addScaledVector(dir, this.radius * 0.92);
    this.sunGlow.position.copy(this.sunDisc.position);
    this.sunDisc.material.color.setHex(S.sun);
    this.sunGlow.material.color.setHex(S.sun);
    this.sunGlow.material.opacity = lerp(0.10, 0.34, clamp01(1 - Math.abs(dir.y) * 1.6));
    this.sunDisc.visible = dir.y > -0.12;
    this.sunGlow.visible = this.sunDisc.visible;

    this.moon.position.copy(cp).addScaledVector(dir, -this.radius * 0.92);
    this.moon.visible = dir.y < 0.1;
    this.starMat.opacity = S.star * 0.9;
    this.stars.visible = S.star > 0.01;

    for (const c of this.clouds.children) {
      c.userData.angle += c.userData.drift * dt;
      const a = c.userData.angle;
      c.position.set(Math.cos(a) * c.userData.dist, c.userData.h, Math.sin(a) * c.userData.dist);
      c.rotation.y = -a + Math.PI / 2;
    }
    this.cloudMat.opacity = lerp(0.25, 0.9, clamp01(S.sunI * 0.6));

    /* --- the lights -------------------------------------------------------- */
    // the sun sits above the player so the shadow camera can be tight
    this.sun.position.copy(cp).addScaledVector(dir, 120);
    this.sunTarget.position.copy(cp);
    this.sunTarget.updateMatrixWorld();
    this.sun.color.setHex(S.sun);
    // it fades out as it touches the horizon rather than snapping off
    this.sun.intensity = S.sunI * clamp01(dir.y * 4 + 0.35);
    this.sun.visible = this.sun.intensity > 0.01;

    this.hemi.color.setHex(S.ambSky);
    this.hemi.groundColor.setHex(S.ambGround);
    this.hemi.intensity = S.ambI;

    this.fill.position.copy(cp).addScaledVector(dir, -80).add(new THREE.Vector3(0, 90, 0));
    this.fill.color.setHex(S.ambSky);
    this.fill.intensity = S.fillI;

    this.fog.color.setHex(S.haze);
    this.fog.density = RENDER.fogDensity * S.fogMul;

    return S;
  }

  _paintDome(S) {
    const pos = this.domeGeo.attributes.position;
    const col = this.domeGeo.attributes.color;
    const R = this.radius;
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / R;                 // -1 .. 1
      let hex;
      if (y > 0) {
        // horizon -> mid -> zenith, with the band nearest the horizon much
        // tighter than the one above it, which is how real sky is stacked
        const t = Math.pow(clamp01(y), 0.45);
        hex = t < 0.45
          ? mixHex(S.horizon, S.mid, t / 0.45)
          : mixHex(S.mid, S.zenith, (t - 0.45) / 0.55);
      } else {
        hex = mixHex(S.horizon, shade(S.horizon, -0.35), clamp01(-y * 2.2));
      }
      c.setHex(hex, THREE.SRGBColorSpace);
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  }

  dispose() {
    this.domeGeo.dispose();
    this.dome.material.dispose();
  }
}
