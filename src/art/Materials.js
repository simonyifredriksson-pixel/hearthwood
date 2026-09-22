/* Materials.js — the handful of materials the whole world shares.
   ===========================================================================
   Hearthwood uses vertex colours for nearly everything, so there are very few
   materials: sharing them is what lets a merged tile of forest — a thousand
   unique plants — draw in one call.

   THE WIND is injected here rather than baked into geometry. Every vertex
   carries a `sway` weight (0 at a trunk base, 1 at the tip of a frond) and
   the vertex shader pushes it around with two out-of-phase waves plus a slow
   gust envelope. Because the phase comes from WORLD position, a gust travels
   across the wood instead of every plant nodding in unison — which is the
   single tell that separates "alive" from "animated".
*/

import * as THREE from '../../lib/three.module.js?v=1790085618';
import { SKY } from './Palette.js?v=1790085618';

/** Shared uniforms. One object, updated once a frame, read by every material. */
export const windU = {
  uTime: { value: 0 },
  uWind: { value: 0.11 },        // metres of sway at weight 1
  uGust: { value: 0 },           // 0..1 slow envelope, set by Ambient
  uWindDir: { value: new THREE.Vector2(0.86, 0.51) },
};

/** Fog-ish tint applied to distant geometry so nothing pops out of the haze. */
export const fogU = {
  uHorizon: { value: new THREE.Color(SKY.haze) },
};

const WIND_PARS = /* glsl */`
  attribute float sway;
  uniform float uTime;
  uniform float uWind;
  uniform float uGust;
  uniform vec2  uWindDir;
  varying float vSway;
`;

const WIND_BEGIN = /* glsl */`
  vSway = sway;
  #ifdef USE_INSTANCING
    vec3 wpos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  #else
    vec3 wpos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  #endif

  // Phase from world position: a gust is a WAVE crossing the wood, not a
  // global multiplier. The two frequencies are deliberately not harmonically
  // related, so the motion never settles into a visible loop.
  float ph = dot(wpos.xz, uWindDir) * 0.22;
  float gust = 0.55 + 0.45 * sin(uTime * 0.19 + ph * 0.35) * (0.4 + 0.6 * uGust);

  // sway^1.6 rather than sway: the stiff part of a plant should barely move
  // at all, and a linear falloff makes everything look rubbery.
  float w = pow(clamp(sway, 0.0, 1.0), 1.6) * uWind * gust;

  float s1 = sin(uTime * 1.35 + ph);
  float s2 = sin(uTime * 2.31 + ph * 1.7 + 1.3);
  transformed.x += (uWindDir.x * s1 + uWindDir.y * s2 * 0.4) * w;
  transformed.z += (uWindDir.y * s1 + -uWindDir.x * s2 * 0.4) * w;
  // Foliage dips as it is pushed — without this a bending branch stretches.
  transformed.y -= abs(s1) * w * 0.28;
`;

/** Add the wind to any three.js material that has a `begin_vertex` chunk. */
export function applyWind(material, { scale = 1 } = {}) {
  material.onBeforeCompile = shader => {
    shader.uniforms.uTime = windU.uTime;
    shader.uniforms.uWind = windU.uWind;
    shader.uniforms.uGust = windU.uGust;
    shader.uniforms.uWindDir = windU.uWindDir;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + WIND_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' +
        WIND_BEGIN.replace(/uWind\b/g, `(uWind * ${scale.toFixed(3)})`));
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vSway;');
    material.userData.shader = shader;
  };
  material.customProgramCacheKey = () => 'hw-wind-' + scale.toFixed(3);
  return material;
}

/* ========================================================================= */

function lambert(opts) {
  return new THREE.MeshLambertMaterial({ vertexColors: true, ...opts });
}

/**
 * The material set. Built once, after the renderer exists (so the shadow and
 * fog defines are correct), and handed out by name.
 */
export class MaterialSet {
  constructor() {
    /* --- solid, unmoving things: rock, stone, timber, walls, roofs ------- */
    this.solid = lambert({ name: 'solid' });

    /* --- wood that is part of a plant: trunks and branches. It sways, but
           only a very little, and only at the top. ------------------------ */
    this.trunk = applyWind(lambert({ name: 'trunk' }), { scale: 0.45 });

    /* --- leaves, ferns, grass, flowers. Double-sided because a leaf has no
           inside, and alphaTest-free because there are no textures. ------- */
    this.foliage = applyWind(lambert({ name: 'foliage', side: THREE.DoubleSide }), { scale: 1 });

    /* --- grass gets a stronger wind and no shadow casting (a field of grass
           casting shadows is a lot of fill rate for a mottling nobody sees) */
    this.grass = applyWind(lambert({ name: 'grass', side: THREE.DoubleSide }), { scale: 1.5 });

    /* --- characters: no wind, smooth shading, a hint of sheen ----------- */
    this.character = new THREE.MeshPhongMaterial({
      name: 'character', vertexColors: true, shininess: 6, specular: 0x1a1a14,
    });

    /* --- carried items and crafted weapons ------------------------------ */
    this.item = new THREE.MeshPhongMaterial({
      name: 'item', vertexColors: true, shininess: 18, specular: 0x2a2620,
    });

    /* --- metal: brighter highlight, used sparingly ---------------------- */
    this.metal = new THREE.MeshPhongMaterial({
      name: 'metal', vertexColors: true, shininess: 58, specular: 0x9a9a96,
    });

    /* --- anything that emits its own light: lantern panes, fire, glowing
           fungi, firefly sprites. Unlit on purpose. ----------------------- */
    this.glow = new THREE.MeshBasicMaterial({
      name: 'glow', vertexColors: true, fog: true, toneMapped: true,
    });
    this.glowSoft = new THREE.MeshBasicMaterial({
      name: 'glowSoft', vertexColors: true, transparent: true, opacity: 0.55,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });

    /* --- window glass with a warm interior ------------------------------ */
    this.glass = new THREE.MeshPhongMaterial({
      name: 'glass', vertexColors: true, shininess: 90, specular: 0xffffff,
      transparent: true, opacity: 0.82,
    });

    /* --- cloth: awnings, banners, washing. Two-sided, matte. ------------ */
    this.cloth = lambert({ name: 'cloth', side: THREE.DoubleSide });
    /* awnings and flags catch the wind properly */
    this.clothWind = applyWind(lambert({ name: 'clothWind', side: THREE.DoubleSide }), { scale: 0.7 });

    /* --- smoke, dust, pollen -------------------------------------------- */
    this.particle = new THREE.MeshBasicMaterial({
      name: 'particle', vertexColors: true, transparent: true, opacity: 0.5,
      depthWrite: false, side: THREE.DoubleSide,
    });

    this.all = [
      this.solid, this.trunk, this.foliage, this.grass, this.character,
      this.item, this.metal, this.glow, this.glowSoft, this.glass,
      this.cloth, this.clothWind, this.particle,
    ];
  }

  dispose() { for (const m of this.all) m.dispose(); }
}

export const MATS = new MaterialSet();

/* ========================================================================= */
/* TERRAIN                                                                   */
/* ========================================================================= */

/**
 * The ground. Vertex colours carry the biome blend (grass / moss / dirt /
 * mud / stone / sand), and a procedural detail pattern in the fragment
 * shader breaks up the large flat facets that vertex colouring alone leaves.
 *
 * The detail is generated in the shader rather than sampled from a texture
 * for one reason worth the cost: it needs to tile over 1800 metres without a
 * visible repeat, and any texture small enough to ship in a source file will
 * repeat every few metres and turn the whole valley into graph paper.
 */
export function makeTerrainMaterial() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, name: 'terrain' });
  mat.onBeforeCompile = shader => {
    shader.uniforms.uTime = windU.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */`
        #include <common>
        varying vec3 vWorld;
      `)
      .replace('#include <begin_vertex>', /* glsl */`
        #include <begin_vertex>
        vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */`
        #include <common>
        varying vec3 vWorld;

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
          float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }
      `)
      .replace('#include <color_fragment>', /* glsl */`
        #include <color_fragment>
        // Three octaves at deliberately irrational spacings. Close up this is
        // clods and tufts; from a distance it is the mottling that stops a
        // hillside reading as a single flat wash of green.
        float d1 = vnoise(vWorld.xz * 1.37);
        float d2 = vnoise(vWorld.xz * 0.41 + 17.3);
        float d3 = vnoise(vWorld.xz * 6.10 + 41.7);
        float det = (d1 - 0.5) * 0.17 + (d2 - 0.5) * 0.20 + (d3 - 0.5) * 0.07;
        diffuseColor.rgb *= 1.0 + det;
        // and a faint warm/cool drift across the whole valley, so no two
        // hillsides are quite the same colour
        diffuseColor.rgb *= vec3(1.0 + (d2 - 0.5) * 0.09, 1.0, 1.0 - (d2 - 0.5) * 0.07);
      `);
    mat.userData.shader = shader;
  };
  mat.customProgramCacheKey = () => 'hw-terrain';
  return mat;
}

/* ========================================================================= */
/* WATER                                                                     */
/* ========================================================================= */

/**
 * Streams and the millpond. Cheap and stylised: two scrolling wave sets, a
 * shore fade so the water meets the bank softly instead of with a hard line,
 * and a Fresnel-ish tilt toward the sky colour at grazing angles.
 */
export function makeWaterMaterial(shallow, deep, sky) {
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true, transparent: true, opacity: 0.86, name: 'water',
    depthWrite: false,
  });
  mat.onBeforeCompile = shader => {
    shader.uniforms.uTime = windU.uTime;
    shader.uniforms.uShallow = { value: new THREE.Color(shallow) };
    shader.uniforms.uDeep = { value: new THREE.Color(deep) };
    shader.uniforms.uSky = { value: new THREE.Color(sky) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */`
        #include <common>
        uniform float uTime;
        varying vec3 vWorld;
        varying vec3 vViewDirW;
      `)
      .replace('#include <begin_vertex>', /* glsl */`
        #include <begin_vertex>
        vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
        // Two crossing ripple sets. The amplitude is tiny — 2 cm — because
        // water that visibly heaves reads as an ocean, and this is a brook.
        float r = sin(wp.x * 2.1 + uTime * 1.6) * 0.012
                + sin(wp.z * 3.3 - uTime * 2.1) * 0.010
                + sin((wp.x + wp.z) * 1.1 + uTime * 0.9) * 0.008;
        transformed.y += r;
        vWorld = wp + vec3(0.0, r, 0.0);
        vViewDirW = normalize(cameraPosition - vWorld);
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */`
        #include <common>
        uniform float uTime;
        uniform vec3 uShallow;
        uniform vec3 uDeep;
        uniform vec3 uSky;
        varying vec3 vWorld;
        varying vec3 vViewDirW;
      `)
      .replace('#include <color_fragment>', /* glsl */`
        #include <color_fragment>
        // vertex colour red channel carries depth: 0 at the bank, 1 mid-stream
        float depth = diffuseColor.r;
        vec3 base = mix(uShallow, uDeep, smoothstep(0.1, 0.85, depth));

        // moving highlight: bright where the two wave sets crest together
        float w = sin(vWorld.x * 4.3 + uTime * 2.2) * sin(vWorld.z * 5.1 - uTime * 1.7);
        base += vec3(0.10, 0.12, 0.11) * smoothstep(0.55, 1.0, w);

        // grazing angles pick up the sky — this is what makes it read as a
        // surface rather than as coloured glass
        float fres = pow(1.0 - clamp(vViewDirW.y, 0.0, 1.0), 3.0);
        base = mix(base, uSky, fres * 0.55);

        diffuseColor.rgb = base;
        diffuseColor.a = mix(0.62, 0.93, smoothstep(0.0, 0.5, depth));
      `);
    mat.userData.shader = shader;
  };
  mat.customProgramCacheKey = () => 'hw-water';
  return mat;
}

/** Call once a frame. */
export function updateWind(t, gust) {
  windU.uTime.value = t;
  windU.uGust.value = gust;
}
