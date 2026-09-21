/* Terrain.js — the shape of Hearthwood, and every field sampled from it.
   ===========================================================================
   This is the single source of truth about the land. Where the ground is,
   which way it faces, what it is made of, how wet it is, how dark it is under
   the canopy, which trees grow there, how far you are from home — everything
   else in the game asks this object and nobody computes any of it twice.

   THE ONE DESIGN NUMBER: the village is 3% of the map. WORLD.village.radius
   against WORLD.half is the whole premise — a large, detailed, walkable
   village that is nonetheless a speck in the middle of an enormous wood. If
   you change one, change the other, and test_world.mjs will tell you if the
   ratio has drifted.

   HEIGHT is the sum of four things, in descending order of scale:
     1. a mountain ring that closes the map with geography instead of an
        invisible wall,
     2. big landforms — ridges and valleys from warped ridged noise,
     3. rolling woodland hills,
     4. a metre or so of lumpy detail, so nothing is ever a smooth plane.
   Then the river is CARVED (subtracted) and the village bowl is FLATTENED
   (blended toward a datum), in that order, because a river has to be able to
   run through the village.
*/

import { Noise2D, Cellular } from '../core/Noise.js?v=20260921145028';
import { WORLD } from '../core/Config.js?v=20260921145028';
import { clamp, clamp01, lerp, smoothstep, invLerp, TAU, segDist2, hash2 } from '../core/Util.js?v=20260921145028';
import { GROUND, WATER, mixHex, tweak, shade } from '../art/Palette.js?v=20260921145028';

/* ========================================================================= */
/* THE RIVER                                                                 */
/* ========================================================================= */

/* The river is a function of z, not a set of points, so "how far am I from
   the water" is a couple of sines rather than a search. It meanders past the
   east side of the village and leaves the map through the mountains. */
export function riverX(z) {
  return 128 * Math.sin(z * 0.0034) + 58 * Math.sin(z * 0.0091 + 2.1)
    + 26 * Math.sin(z * 0.0223 + 0.7) - 34;
}

/** Signed horizontal distance to the river's centreline, in metres. */
export function riverOffset(x, z) { return x - riverX(z); }

/* --------------------------------------------------------------------------
   THE RIVER PROFILE

   The water surface cannot be a formula in z. The land along 1800 metres of
   valley rises and falls by more than a hundred metres, and a straight-line
   water level put the river ON TOP OF A RIDGE for a third of its length —
   the test caught it as "the land beside the river is below the water", which
   is a lake, not a river.

   So the profile is SAMPLED from the land it runs through, once, at
   construction: take the bare land height along the centreline, smooth it
   over a couple of hundred metres so a single hillock cannot dam the valley,
   then run a downstream pass that forbids the level from ever rising. Water
   that never flows uphill is most of what makes a river look like a river.
-------------------------------------------------------------------------- */

const PROFILE_STEP = 8;
let _profile = null;
let _profZ0 = 0;

export function buildRiverProfile(landHeightAt) {
  const z0 = -WORLD.half - 64, z1 = WORLD.half + 64;
  const n = Math.ceil((z1 - z0) / PROFILE_STEP) + 1;
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const z = z0 + i * PROFILE_STEP;
    raw[i] = landHeightAt(riverX(z), z);
  }

  // wide smoothing: ±200 m, so the profile follows the VALLEY and ignores
  // every bank and boulder along the way
  const half = Math.round(200 / PROFILE_STEP);
  const sm = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let k = -half; k <= half; k++) {
      const j = clamp(i + k, 0, n - 1);
      const w = 1 - Math.abs(k) / (half + 1);
      s += raw[j] * w; c += w;
    }
    sm[i] = s / c;
  }

  // the river runs from whichever end is higher
  const flowsPositive = sm[0] > sm[n - 1];
  const out = new Float32Array(n);
  let run = Infinity;
  for (let k = 0; k < n; k++) {
    const i = flowsPositive ? k : n - 1 - k;
    run = Math.min(run, sm[i]);
    out[i] = run;
  }
  /* The running minimum guarantees the water never flows uphill, but taken
     alone it also strands the river a hundred metres underground wherever
     the land rises again — the mountain ring at both ends of the valley.
     Water you cannot see is not a river, so the level is allowed to creep
     back up toward the land, never more than 10 m below it. The gradient
     is then technically wrong in the two mountain passes; the alternative
     was a river that disappears for a third of the map, and nobody has ever
     stood on a riverbank and checked the gradient. */
  for (let i = 0; i < n; i++) out[i] = Math.max(out[i], sm[i] - 10);

  // smooth the joins the clamp just introduced
  const fin = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let k = -6; k <= 6; k++) { const j = clamp(i + k, 0, n - 1); s += out[j]; c++; }
    fin[i] = s / c - 1.15;   // and it sits a little below the land it cut
  }

  _profile = fin;
  _profZ0 = z0;
  return out;
}

/** The water surface height at a point along the river. */
export function riverLevel(z) {
  if (!_profile) return WORLD.village.datum - 2.35;
  const u = (z - _profZ0) / PROFILE_STEP;
  const i = clamp(Math.floor(u), 0, _profile.length - 2);
  return lerp(_profile[i], _profile[i + 1], clamp01(u - i));
}

/* ========================================================================= */
/* THE WORLD FIELD                                                           */
/* ========================================================================= */

export class Terrain {
  constructor(seed = WORLD.seed) {
    this.seed = seed;
    this.nHill = new Noise2D(seed ^ 0x1111);
    this.nRidge = new Noise2D(seed ^ 0x2222);
    this.nDetail = new Noise2D(seed ^ 0x3333);
    this.nWarp = new Noise2D(seed ^ 0x4444);
    this.nMoist = new Noise2D(seed ^ 0x5555);
    this.nForest = new Noise2D(seed ^ 0x6666);
    this.nSoil = new Noise2D(seed ^ 0x7777);
    this.cGlade = new Cellular(seed ^ 0x8888);
    this.cGrove = new Cellular(seed ^ 0x9999);

    this.V = WORLD.village;
    this.half = WORLD.half;

    /* A small height cache. Scatter placement asks for the same point several
       times (ground, then normal, then again for the item below it), and the
       hit rate on that pattern is high enough to be worth 16k entries. */
    this._hc = new Map();

    /* Village paths are laid out by Village.js and registered here, because
       the ground has to KNOW about them: a path flattens the terrain under
       it, paints it, and stops trees growing on it. */
    this.paths = [];
    this.flats = [];        // building pads: {x, z, r, y}

    // the river profile has to exist before height() is ever called, and it
    // is derived from the BARE land, so it cannot use height() itself
    buildRiverProfile((x, z) => this.landHeight(x, z));
  }

  /**
   * The land before anything is done to it: mountains, landforms, hills and
   * detail, with no river, no village and no roads. Only the river profile
   * uses this, and it must stay free of every later stage or the two become
   * defined in terms of each other.
   */
  landHeight(x, z) {
    const rd = Math.hypot(x, z) / this.half;
    let mountain = 0;
    if (rd > WORLD.mountainStart) {
      const u = smoothstep(invLerp(WORLD.mountainStart, 1.06, rd));
      const rg = this.nRidge.ridged(x * 0.0016, z * 0.0016, 4);
      mountain = u * u * WORLD.mountainAmp * (0.42 + rg * 1.05);
    }
    const wx = this.nWarp.fbm(x * 0.00042, z * 0.00042, 2) * 380;
    const wz = this.nWarp.fbm(x * 0.00042 + 31.7, z * 0.00042 - 12.3, 2) * 380;
    const land = this.nRidge.fbm((x + wx) * 0.00085, (z + wz) * 0.00085, 3) * 46;
    const hills = this.nHill.fbm(x * 0.0034, z * 0.0034, 4) * WORLD.hillAmp * 0.5
      + this.nHill.fbm(x * 0.0091, z * 0.0091, 3) * 7.5;
    const detail = this.nDetail.fbm(x * 0.055, z * 0.055, 2) * 0.62
      + this.nDetail.noise(x * 0.21, z * 0.21) * 0.16;
    return WORLD.village.datum + land + hills + detail + mountain;
  }

  /* ---------------------------------------------------------------- HEIGHT */

  /** Raw height in metres. This is the hot function of the whole game. */
  height(x, z) {
    /* --- 1. the mountain ring ------------------------------------------- */
    const rd = Math.hypot(x, z) / this.half;
    let mountain = 0;
    if (rd > WORLD.mountainStart) {
      const u = smoothstep(invLerp(WORLD.mountainStart, 1.06, rd));
      // ridged noise so the rim is peaks and passes, not a bowl lip
      const rg = this.nRidge.ridged(x * 0.0016, z * 0.0016, 4);
      mountain = u * u * WORLD.mountainAmp * (0.42 + rg * 1.05);
    }

    /* --- 2. big landforms, domain-warped so valleys meander -------------- */
    const wx = this.nWarp.fbm(x * 0.00042, z * 0.00042, 2) * 380;
    const wz = this.nWarp.fbm(x * 0.00042 + 31.7, z * 0.00042 - 12.3, 2) * 380;
    const land = this.nRidge.fbm((x + wx) * 0.00085, (z + wz) * 0.00085, 3) * 46;

    /* --- 3. rolling woodland hills --------------------------------------- */
    const hills = this.nHill.fbm(x * 0.0034, z * 0.0034, 4) * WORLD.hillAmp * 0.5
      + this.nHill.fbm(x * 0.0091, z * 0.0091, 3) * 7.5;

    /* --- 4. the lumpy metre ---------------------------------------------- */
    const detail = this.nDetail.fbm(x * 0.055, z * 0.055, 2) * 0.62
      + this.nDetail.noise(x * 0.21, z * 0.21) * 0.16;

    let h = WORLD.village.datum + land + hills + detail + mountain;

    /* --- the river, carved ----------------------------------------------- */
    const ro = Math.abs(riverOffset(x, z));
    const R = WORLD.river;
    /* --- the valley the river runs in ------------------------------------
       The profile forbids the water from ever flowing uphill, which means
       that where the land rises again — the southern mountains — the water
       line ends up far below the surface and the river simply disappears
       inside a hill. A real river answers that by cutting a valley, so this
       does too: a broad, soft pull-down of everything within 75 m of the
       centreline. It gives the river a valley to run in the whole way
       across the map, and it opens two dramatic passes through the mountain
       ring that double as the natural way out of the world. */
    if (ro < 82) {
      const lvl = riverLevel(z);
      const valley = 1 - smoothstep(invLerp(R.bankWidth * 1.8, 78, ro));
      h = lerp(h, Math.max(lvl + 2.6, h - 30), valley * 0.78);
    }

    if (ro < R.bankWidth * 3.4) {
      const lvl = riverLevel(z);
      // a V of banks with a flat-ish bed: cut hard inside the channel and
      // ease out across the flood plain
      const channel = 1 - smoothstep(invLerp(R.width * 0.4, R.width * 1.5, ro));
      const flood = 1 - smoothstep(invLerp(R.width, R.bankWidth * 3.2, ro));
      // The bed follows the WATER, but the cut is capped: where the river
      // runs through high ground the result should be a ravine, not a
      // kilometre-deep slot down to a water level far below.
      const bed = Math.max(lvl - R.depth * (0.55 + 0.45 * channel), h - 9);
      h = lerp(h, bed, channel * 0.94);
      h = lerp(h, Math.min(h, lvl + 1.5), flood * 0.55);
    }

    /* --- the village bowl, flattened ------------------------------------- */
    const vd = Math.hypot(x - this.V.cx, z - this.V.cz);
    if (vd < this.V.flatten * 1.4) {
      // A hard edge here would look like a crater. The blend runs from full
      // at the core out to nothing well past the fences, and it keeps a
      // little of the underlying hill so the village is not a billiard table.
      const t = 1 - smoothstep(invLerp(this.V.core * 0.55, this.V.flatten * 1.3, vd));
      const gentle = this.nHill.fbm(x * 0.012, z * 0.012, 2) * 1.9;
      h = lerp(h, this.V.datum + gentle, t * 0.93);
    }

    /* --- village paths and building pads --------------------------------- */
    for (const p of this.paths) {
      const d2 = segDist2(x, z, p.ax, p.az, p.bx, p.bz);
      const w = p.w + 1.6;
      if (d2 < w * w) {
        const t = 1 - smoothstep(Math.sqrt(d2) / w);
        h = lerp(h, lerp(p.ay, p.by, pathT(x, z, p)), t * 0.88);
      }
    }
    for (const f of this.flats) {
      const d = Math.hypot(x - f.x, z - f.z);
      if (d < f.r * 1.9) {
        const t = 1 - smoothstep(invLerp(f.r * 0.8, f.r * 1.85, d));
        h = lerp(h, f.y, t * 0.96);
      }
    }

    return h;
  }

  /** Cached height, for the many callers that ask about the same spot twice. */
  heightC(x, z) {
    const k = ((Math.round(x * 4) & 0xffff) << 16) | (Math.round(z * 4) & 0xffff);
    let v = this._hc.get(k);
    if (v === undefined) {
      v = this.height(x, z);
      if (this._hc.size > 30000) this._hc.clear();
      this._hc.set(k, v);
    }
    return v;
  }

  clearCache() { this._hc.clear(); }

  /** Surface normal by central difference. */
  normal(x, z, eps = 0.7) {
    const hL = this.height(x - eps, z), hR = this.height(x + eps, z);
    const hD = this.height(x, z - eps), hU = this.height(x, z + eps);
    const nx = hL - hR, nz = hD - hU, ny = 2 * eps;
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  }

  /** 0 = flat, 1 = vertical.
   *  Uses the CACHED height: this is called several times per terrain vertex
   *  by the field functions, and four exact height() evaluations each time
   *  made colouring a tile the single most expensive thing in the game. */
  slope(x, z, eps = 1.2) {
    const hL = this.heightC(x - eps, z), hR = this.heightC(x + eps, z);
    const hD = this.heightC(x, z - eps), hU = this.heightC(x, z + eps);
    const nx = hL - hR, nz = hD - hU, ny = 2 * eps;
    const l = Math.hypot(nx, ny, nz) || 1;
    return 1 - ny / l;
  }

  /* --------------------------------------------------------------- WATER */

  /** Height of standing water here, or null if there is none. */
  waterAt(x, z) {
    const ro = Math.abs(riverOffset(x, z));
    if (ro < WORLD.river.bankWidth * 1.9) {
      const lvl = riverLevel(z);
      if (this.height(x, z) < lvl) return lvl;
    }
    return null;
  }

  /** 0 at the bank, 1 mid-channel. Drives the water shader's depth tint. */
  riverDepth(x, z) {
    const ro = Math.abs(riverOffset(x, z));
    return clamp01(1 - ro / (WORLD.river.width * 1.35));
  }

  /* --------------------------------------------------------------- FIELDS */

  /** 0 at the village fence, 1 at the far mountains. Gates the rare sticks. */
  remoteness(x, z) {
    const vd = Math.hypot(x - this.V.cx, z - this.V.cz);
    return clamp01(invLerp(this.V.radius * 0.9, this.half * 0.92, vd));
  }

  /** How close to the village core, 1 inside it, 0 outside the fence line. */
  villageness(x, z) {
    const vd = Math.hypot(x - this.V.cx, z - this.V.cz);
    return 1 - smoothstep(invLerp(this.V.core * 0.85, this.V.radius, vd));
  }

  isVillage(x, z) {
    return Math.hypot(x - this.V.cx, z - this.V.cz) < this.V.radius;
  }

  /** Soil moisture, 0 dry to 1 boggy. Rivers, hollows and shade all add. */
  wetness(x, z) {
    const ro = Math.abs(riverOffset(x, z));
    const nearWater = 1 - smoothstep(invLerp(WORLD.river.width, 46, ro));
    const base = this.nMoist.fbm01(x * 0.0021, z * 0.0021, 3);
    const h = this.heightC(x, z);
    // low ground holds water; the higher you climb the drier it gets
    const low = 1 - smoothstep(invLerp(this.V.datum - 4, this.V.datum + 40, h));
    return clamp01(base * 0.55 + nearWater * 0.75 + low * 0.3 - 0.12);
  }

  /** Canopy cover, 0 open sky to 1 deep shade. Drives moss and mushrooms. */
  shade(x, z) {
    return clamp01(this.forestDensity(x, z) * 1.15 - 0.08);
  }

  /**
   * How thick the wood is here, 0..1. The two things that shape it:
   *   - GLADES, from cellular noise, so the forest has real clearings you
   *     come out into rather than a uniform mist of trees;
   *   - the village, which pushes the trees back to a tree line.
   */
  forestDensity(x, z) {
    const vd = Math.hypot(x - this.V.cx, z - this.V.cz);
    // the village clears its own land, with ragged edges
    const edge = this.nForest.fbm(x * 0.012, z * 0.012, 2) * 34;
    // The tree line starts just outside the built-up core, not outside the
    // whole parish: a 200 m meadow buffer made the village look marooned in
    // a field instead of tucked into the wood.
    const clear = smoothstep(invLerp(this.V.core * 0.65, this.V.radius * 0.82 + edge, vd));

    const base = this.nForest.fbm01(x * 0.0026, z * 0.0026, 4);
    const glade = this.cGlade.clearing(x * 0.0055, z * 0.0055);
    const open = smoothstep(invLerp(0.10, 0.42, glade));   // 0 at a glade centre

    // nothing grows in the channel, on cliffs, or above the tree line
    const ro = Math.abs(riverOffset(x, z));
    const bank = smoothstep(invLerp(WORLD.river.width * 0.8, WORLD.river.bankWidth * 1.6, ro));
    const h = this.heightC(x, z);
    const treeline = 1 - smoothstep(invLerp(this.V.datum + 92, this.V.datum + 148, h));
    const cliff = 1 - smoothstep(invLerp(0.42, 0.68, this.slope(x, z, 2.5)));

    return clamp01(clamp01(base * 1.35 - 0.12) * open * clear * bank * treeline * cliff);
  }

  /**
   * Which species dominates here. Groves are cellular, so a wood of birch
   * gives way to a wood of pine over a ridge rather than being stirred
   * together everywhere — which is what real woodland does and what makes a
   * long walk feel like it went somewhere.
   */
  grove(x, z) {
    const c = this.cGrove.at(x * 0.0038, z * 0.0038);
    const wet = this.wetness(x, z);
    const h = this.heightC(x, z);
    const alt = h - this.V.datum;

    // altitude and water override the cell where they are decisive
    if (alt > 78) return c.id % 3 === 0 ? 'birch' : 'pine';
    if (wet > 0.72) return c.id % 2 === 0 ? 'willow' : 'elder';
    const table = ['oak', 'oak', 'hazel', 'birch', 'pine', 'ash', 'rowan', 'hazel', 'willow', 'blackthorn'];
    return table[c.id % table.length];
  }

  /** A stable per-grove seed, so a grove's trees agree with each other. */
  groveId(x, z) { return this.cGrove.at(x * 0.0038, z * 0.0038).id; }

  /* ---------------------------------------------------------- GROUND LOOK */

  /**
   * The colour of the ground at a point, as a hex. Six materials blended by
   * the fields above. This runs per terrain vertex, so it is written to be a
   * chain of cheap mixes rather than anything clever.
   */
  groundColor(x, z, hIn = null, slopeIn = null, F = null) {
    const h = hIn !== null ? hIn : this.heightC(x, z);
    const alt = h - this.V.datum;
    const slope = slopeIn !== null ? slopeIn : this.slope(x, z, 1.8);
    /* These three lookups are several octaves of noise each, and forestDensity
       calls the other two on the way. At one call per terrain vertex they were
       most of the cost of building a tile — and the cost of building a tile is
       a hitch you feel as you walk into new ground. F is the same coarse
       interpolated grid the scatterer uses; these fields vary far more slowly
       than the 2.5 m vertex spacing, so nothing visible is lost.
       pathInfluence below stays EXACT: a path edge has to stay sharp. */
    const wet = F ? F.wetAt(x, z) : this.wetness(x, z);
    const forest = F ? F.forestAt(x, z) : this.forestDensity(x, z);
    const vill = F ? F.villAt(x, z) : this.villageness(x, z);
    // fast enough to vary within a few paces: litter is patchy at the scale
    // of a footstep, not at the scale of a field
    const n1 = this.nSoil.fbm01(x * 0.085, z * 0.085, 3);
    const n2 = this.nSoil.fbm01(x * 0.0062 + 41, z * 0.0062 - 17, 2);

    /* --- grass, which is never one green ---------------------------------- */
    let c = mixHex(GROUND.grass, n2 > 0.5 ? GROUND.grassLush : GROUND.grassDry, Math.abs(n2 - 0.5) * 1.35);
    c = mixHex(c, GROUND.grassLush, clamp01(wet - 0.35) * 0.9);

    /* --- forest floor ------------------------------------------------------
       Under a closed canopy the ground is LITTER, not grass. The first
       version mixed in only a third of the litter colour and left the whole
       wood standing on a bright meadow-green plane, which is the single most
       artificial thing a forest can do — real woodland floor is brown, and
       the few green things on it read as green precisely because the ground
       behind them is not. */
    if (forest > 0.03) {
      const litter = this.grove(x, z) === 'pine' ? GROUND.pineNeedle
        : (n1 > 0.55 ? GROUND.leafLitter2 : GROUND.leafLitter);
      c = mixHex(c, litter, clamp01(forest * 1.5) * (0.64 + n1 * 0.34));
      // moss wants real damp, not merely shade — mixing it in everywhere put
      // the green back that the litter had just taken out
      c = mixHex(c, GROUND.moss, clamp01((wet - 0.45) * forest * 2.2) * 0.75 * n1);
      c = mixHex(c, GROUND.dirtDark, clamp01(forest - 0.3) * 0.45 * (1 - n1));
      c = shade(c, -0.18 * forest);
    }

    /* --- bog and mud in the hollows --------------------------------------- */
    if (wet > 0.66) c = mixHex(c, n1 > 0.5 ? GROUND.mud : GROUND.mudWet, (wet - 0.66) * 2.2);

    /* --- the riverbank: gravel, then sand, then the bed ------------------- */
    const ro = Math.abs(riverOffset(x, z));
    const lvl = riverLevel(z);
    if (ro < WORLD.river.bankWidth * 2.3) {
      const nearness = 1 - smoothstep(invLerp(WORLD.river.width * 0.9, WORLD.river.bankWidth * 2.1, ro));
      c = mixHex(c, n1 > 0.45 ? GROUND.gravel : GROUND.sand, nearness * 0.85);
      if (h < lvl + 0.35) c = mixHex(c, GROUND.streamBed ?? WATER.streamBed, 0.6);
    }

    /* --- rock wherever the ground is too steep to hold soil --------------- */
    if (slope > 0.22) {
      const bare = smoothstep(invLerp(0.22, 0.58, slope));
      const rock = n1 > 0.5 ? GROUND.rock : (n2 > 0.5 ? GROUND.rockWarm : GROUND.rockDark);
      c = mixHex(c, rock, bare * 0.92);
      c = mixHex(c, GROUND.dirt, bare * (1 - bare) * 1.3);
    }

    /* --- high ground: thin soil, then bare stone, then snow --------------- */
    if (alt > 70) {
      c = mixHex(c, GROUND.rock, smoothstep(invLerp(70, 120, alt)) * 0.75);
      c = mixHex(c, GROUND.snow, smoothstep(invLerp(128, 168, alt)) * (0.55 + n1 * 0.45));
    }

    /* --- village: trodden earth, not a lawn --------------------------------
       The first version lightened the turf inside the village, which made the
       whole settlement a flat billiard-green. What a village floor actually
       is, is WEAR: bare scuffed earth around every doorway and along every
       line people walk, with tufts of grass surviving in between. */
    if (vill > 0.02) {
      let wear = this.pathInfluence(x, z) * 0.55;
      for (const f of this.flats) {
        const d = Math.hypot(x - f.x, z - f.z);
        if (d > f.r * 2.6) continue;
        wear = Math.max(wear, (1 - smoothstep(invLerp(f.r * 0.9, f.r * 2.5, d))) * 0.85);
      }
      wear = clamp01(wear * (0.62 + n1 * 0.6));
      c = mixHex(c, n2 > 0.5 ? GROUND.dirt : GROUND.path, wear * 0.8);
      // the turf that survives between the worn patches is cropped short and
      // a little yellower than the wood's
      c = mixHex(c, tweak(GROUND.grassDry, { l: 0.96 }), vill * (1 - wear) * 0.34);
    }
    const pd = this.pathInfluence(x, z);
    if (pd > 0.01) {
      const stone = n1 > 0.52 ? GROUND.pathStone : GROUND.path;
      c = mixHex(c, stone, pd * 0.92);
    }

    /* --- and a last coarse variation so nothing is ever flat -------------- */
    return shade(c, (n1 - 0.5) * 0.16 + (n2 - 0.5) * 0.10);
  }

  /** 0..1, how much a village path claims this point. */
  pathInfluence(x, z) {
    let best = 0;
    for (const p of this.paths) {
      const d2 = segDist2(x, z, p.ax, p.az, p.bx, p.bz);
      const w = p.w;
      if (d2 > w * w * 2.2) continue;
      const d = Math.sqrt(d2);
      // a hard-edged middle with a scuffed, blurry margin, like a real path
      const t = 1 - smoothstep(invLerp(w * 0.55, w * 1.32, d));
      if (t > best) best = t;
    }
    return best;
  }

  /** What the player's feet are on — drives footstep sounds and dust. */
  surfaceAt(x, z) {
    const w = this.waterAt(x, z);
    if (w !== null) return 'water';
    if (this.pathInfluence(x, z) > 0.45) return 'stone';
    const wet = this.wetness(x, z);
    if (wet > 0.74) return 'mud';
    if (this.slope(x, z, 1.8) > 0.42) return 'stone';
    if (this.forestDensity(x, z) > 0.35) return 'leaves';
    return 'grass';
  }

  /* ------------------------------------------------------- REGISTRATION */

  /** Village.js calls these BEFORE any terrain mesh is built. */
  addPath(ax, az, bx, bz, w) {
    this.paths.push({
      ax, az, bx, bz, w,
      ay: this.height(ax, az), by: this.height(bx, bz),
      len: Math.hypot(bx - ax, bz - az),
    });
    this._hc.clear();
  }

  addFlat(x, z, r, y) {
    this.flats.push({ x, z, r, y: y ?? this.height(x, z) });
    this._hc.clear();
  }

  /** Re-level every registered path onto the CURRENT terrain. Called once
   *  after all pads exist, so a path that crosses a building pad does not
   *  hover a metre above it. */
  settlePaths() {
    for (const p of this.paths) {
      p.ay = this.heightNoPaths(p.ax, p.az);
      p.by = this.heightNoPaths(p.bx, p.bz);
    }
    this._hc.clear();
  }

  /** Height with paths excluded — used when levelling the paths themselves,
   *  which would otherwise be defined in terms of each other. */
  heightNoPaths(x, z) {
    const saved = this.paths;
    this.paths = EMPTY;
    const h = this.height(x, z);
    this.paths = saved;
    return h;
  }
}

const EMPTY = [];

/** Parameter along a path segment, clamped to [0,1]. */
function pathT(x, z, p) {
  const vx = p.bx - p.ax, vz = p.bz - p.az;
  const l2 = vx * vx + vz * vz;
  if (l2 < 1e-9) return 0;
  return clamp01(((x - p.ax) * vx + (z - p.az) * vz) / l2);
}
