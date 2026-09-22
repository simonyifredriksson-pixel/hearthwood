/* FishingRig.js — the part of fishing that happens in the water.
   ===========================================================================
   Fishing used to be entirely an interface. You pressed E, a bar appeared,
   you played the bar, and a card told you what you had caught. Nothing was
   ever thrown, nothing floated, and the river was scenery you happened to
   be standing next to.

   This is everything that was missing, and it all lives in world space:

     THE BOBBER     a painted cork-and-quill float. It flies on an arc when
                    you cast, lands with a splash, rides the water, ducks
                    when something takes it, and gets dragged about while
                    you are fighting.
     THE LINE       a real curve from the rod tip to the float, sagging
                    under its own weight. A straight line between two
                    points reads as a stick; the sag is what reads as line.
     THE WATER      expanding rings from anything that disturbs it, a boil
                    of bubbles under the float when a fish is on, and a
                    splash on the cast and on the landing.

   WHY THE BUBBLES MATTER MORE THAN THEY LOOK. The brief is explicit that
   the reeling interface must not be the thing that tells you a fish is
   on — the WATER has to. So the boil is not decoration under a UI event;
   it is the event, and the interface is what happens afterwards if the
   player reacts to it. Everything here is therefore tuned to be read at a
   glance from standing height: the rings are wide, the bubbles are big
   enough to see, and the float's duck is a real dip rather than a jitter.

   ONE POOL, NO ALLOCATION. Rings and bubbles are fixed pools of meshes
   whose visibility is toggled; nothing is created or disposed while the
   player is fishing, because the one thing this must never do is hitch in
   the middle of a cast.
*/

import * as THREE from '../../lib/three.module.js?v=1790102737';
import { MeshBuilder, blob, cylinder, quad } from '../art/Geo.js?v=1790102737';
import { MATS } from '../art/Materials.js?v=1790102737';
import { bus, EV } from '../core/Bus.js?v=1790102737';
import { FISH_STATE } from './Fishing.js?v=1790102737';
import { clamp, clamp01, lerp, smoothstep, TAU, makeRng } from '../core/Util.js?v=1790102737';

const RINGS = 7;
const BUBBLES = 18;
const LINE_SEGS = 14;

export class FishingRig {
  /**
   * @param scene   the world scene
   * @param world   for groundAt / waterAt / the water level
   */
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'fishing';
    this.group.visible = false;
    scene.add(this.group);

    this.t = 0;
    this.rnd = makeRng(0xb0bbe7);
    this.active = false;

    /* where the float is, and where it is going */
    this.pos = new THREE.Vector3();
    this.from = new THREE.Vector3();
    this.to = new THREE.Vector3();
    this.waterY = 0;
    this.duck = 0;            // how far under it is being pulled, metres
    this.tipFn = null;        // () => THREE.Vector3, the rod tip in world space

    this._buildBobber();
    this._buildLine();
    this._buildRings();
    this._buildBubbles();

    /* The rig is driven by the same events the minigame emits, rather
       than by polling its state, so the splash happens on the exact frame
       the float lands instead of up to one frame later. */
    this._off = [
      bus.on(EV.FISH_SPLASH, () => this.splash(1)),
      bus.on(EV.FISH_BITING, () => { this.ring(0.5, 0.9); this.duck = 0.0; }),
      bus.on(EV.FISH_HOOKED, () => this.splash(0.7)),
      /* IT GOT AWAY. A single hard ring and a scatter of bubbles as the
         fish turns and goes — enough to read as "that was yours and now
         it is not" without a caption saying so. */
      bus.on(EV.FISH_OFF, () => { this.splash(0.55); this.ring(0.1, 1.5, 1.8); }),
      /* STRUCK AT NOTHING. One small ring where the float is, which is
         exactly what yanking a line out of empty water looks like. */
      bus.on(EV.FISH_EARLY, () => this.ring(0.04, 0.34, 0.8)),
    ];
  }

  /* ====================================================================== */
  /* THE PIECES                                                             */
  /* ====================================================================== */

  /**
   * A float, built the way a real one is: a painted cork body, a collar,
   * and a quill standing out of the top. The quill is most of the read at
   * distance — it is the thing that tilts and dips, and a bare sphere
   * bobbing in the water says nothing at all.
   */
  _buildBobber() {
    const b = new MeshBuilder(), g = new MeshBuilder();
    const r = makeRng(0x30bb);

    b.color(0xd8452f, 0.04, r);                       // the red half
    blob(b, 0, 0.030, 0, 0.052, 4, 10);
    b.color(0xf2efe4, 0.03, r);                       // the white half, below
    blob(b, 0, -0.010, 0, 0.050, 4, 10);
    b.color(0x3a3a38, 0.03, r);                       // the collar
    cylinder(b, 0, 0, 0.008, 0.020, 0.054, 0.054, 10);
    b.color(0xe8dcc0, 0.03, r);                       // the quill
    cylinder(b, 0, 0, 0.060, 0.185, 0.008, 0.005, 6);
    b.color(0xd8452f, 0.03, r);
    cylinder(b, 0, 0, 0.185, 0.215, 0.010, 0.002, 6);
    b.color(0x6a6560, 0.03, r);                       // the eye it ties to
    cylinder(b, 0, 0, -0.060, -0.038, 0.006, 0.006, 6);

    /* a faint warm halo so it stays findable against dark water at dusk */
    g.color(0xffd9a0, 0.02, r);
    blob(g, 0, 0.030, 0, 0.070, 3, 9);

    this.bobber = new THREE.Group();
    this.bobber.add(new THREE.Mesh(b.build({ flat: false }), MATS.item));
    const halo = new THREE.Mesh(g.build({ flat: false }), MATS.glowSoft);
    halo.renderOrder = 2;
    this.bobber.add(halo);
    this._halo = halo;
    this.group.add(this.bobber);
  }

  /**
   * The line is rebuilt every frame from the rod tip to the float, so its
   * geometry is a scratch buffer written in place rather than a new
   * BufferGeometry each time.
   */
  _buildLine() {
    const geo = new THREE.BufferGeometry();
    const n = LINE_SEGS + 1;
    this._linePts = new Float32Array(n * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this._linePts, 3));
    geo.setDrawRange(0, n);
    const mat = new THREE.LineBasicMaterial({
      color: 0xf0ead6, transparent: true, opacity: 0.72, fog: true,
    });
    this.line = new THREE.Line(geo, mat);
    this.line.frustumCulled = false;       // its points move every frame
    this.group.add(this.line);
  }

  /**
   * Expanding rings on the surface. Flat discs rather than tubes: seen
   * from standing height a ring of tube reads as a doughnut lying in the
   * water, and what is wanted is the look of a ripple.
   */
  _buildRings() {
    const b = new MeshBuilder();
    b.color(0xdfeef5, 0.0);
    /* an annulus one unit across, scaled per ring. `quad` here is the free
       function that takes four POINTS — the builder's own `quad` method
       takes four vertex indices, which is a different job entirely. */
    const SEG = 28, INNER = 0.86;
    for (let i = 0; i < SEG; i++) {
      const a0 = (i / SEG) * TAU, a1 = ((i + 1) / SEG) * TAU;
      const p = (rad, a) => [Math.cos(a) * rad, 0, Math.sin(a) * rad];
      quad(b, p(INNER, a0), p(1, a0), p(1, a1), p(INNER, a1), null, [0, 1, 0]);
    }
    const geo = b.build({ flat: false });

    /* EACH RING OWNS ITS MATERIAL. They all fade at their own rate, and
       the shared soft-glow material cannot express seven different
       opacities at once — sharing it meant the newest ring's alpha was
       applied to all of them. Seven clones costs nothing. */
    this.rings = [];
    for (let i = 0; i < RINGS; i++) {
      const mat = MATS.glowSoft.clone();
      mat.opacity = 0;
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.renderOrder = 3;
      this.group.add(m);
      this.rings.push({ m, mat, life: 0, max: 1, r0: 0.1, r1: 1 });
    }
    this._ringGeo = geo;
  }

  /** The boil. Small spheres that rise, wobble and pop at the surface. */
  _buildBubbles() {
    const b = new MeshBuilder();
    b.color(0xe8f4f8, 0.0);
    blob(b, 0, 0, 0, 0.022, 3, 7);
    const geo = b.build({ flat: false });

    /* one shared material for the bubbles: they are small enough that
       scale alone carries the fade, and eighteen clones to animate
       eighteen opacities is not worth the draw-call bookkeeping */
    const mat = MATS.glowSoft.clone();
    mat.opacity = 0.62;

    this.bubbles = [];
    for (let i = 0; i < BUBBLES; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.renderOrder = 3;
      this.group.add(m);
      this.bubbles.push({ m, life: 0, max: 1, vx: 0, vy: 0, vz: 0, wob: 0, drop: false });
    }
    this._bubbleGeo = geo;
    this._bubbleMat = mat;
  }

  /* ====================================================================== */
  /* EFFECTS                                                                */
  /* ====================================================================== */

  /** One expanding ring from the float. */
  ring(from = 0.10, to = 1.10, life = 1.5) {
    const R = this.rings.find(x => !x.m.visible) || this.rings[0];
    R.m.visible = true;
    R.m.position.set(this.pos.x, this.waterY + 0.012, this.pos.z);
    R.life = 0; R.max = life; R.r0 = from; R.r1 = to;
    return R;
  }

  /** A landing: rings plus a scatter of droplets thrown upward. */
  splash(power = 1) {
    this.ring(0.06, 0.85 * power + 0.3, 1.5);
    this.ring(0.04, 0.45 * power + 0.2, 1.0);
    const r = this.rnd;
    let n = 0;
    for (const B of this.bubbles) {
      if (B.m.visible || n >= 9) continue;
      n++;
      const a = r.range(0, TAU), out = r.range(0.25, 0.95) * power;
      B.m.visible = true;
      B.m.position.set(this.pos.x, this.waterY + 0.02, this.pos.z);
      B.vx = Math.cos(a) * out;
      B.vz = Math.sin(a) * out;
      B.vy = r.range(0.9, 2.1) * power;
      B.wob = 0;                         // droplets fall, they do not wobble
      B.life = 0; B.max = r.range(0.35, 0.7);
      B.drop = true;
    }
  }

  /** The boil while a fish is worrying the bait. */
  _boil(strength, dt) {
    this._boilT = (this._boilT || 0) + dt * (0.6 + strength * 2.6);
    if (this._boilT < 0.055) return;
    this._boilT = 0;
    const r = this.rnd;
    const B = this.bubbles.find(x => !x.m.visible);
    if (!B) return;
    const a = r.range(0, TAU), rad = r.range(0.04, 0.34) * (0.5 + strength);
    B.m.visible = true;
    B.m.position.set(
      this.pos.x + Math.cos(a) * rad,
      this.waterY - r.range(0.05, 0.22),
      this.pos.z + Math.sin(a) * rad);
    B.vx = Math.cos(a) * 0.05;
    B.vz = Math.sin(a) * 0.05;
    B.vy = r.range(0.22, 0.55) * (0.6 + strength);
    B.wob = r.range(2.5, 6.0);
    B.life = 0; B.max = r.range(0.5, 1.0);
    B.drop = false;
  }

  /* ====================================================================== */
  /* DRIVING IT                                                             */
  /* ====================================================================== */

  /**
   * Start a cast.
   * @param tipFn  () => THREE.Vector3 for the rod tip, read fresh every
   *               frame — the tip is on the end of a moving arm and a
   *               position captured once would leave the line hanging off
   *               a point in mid-air.
   */
  begin(spot, tipFn) {
    this.active = true;
    this.tipFn = tipFn;
    this.group.visible = true;
    /* `waterAt` IS the surface height — it returns the level of standing
       water here, or null for dry land. Reading it as a boolean and then
       using the ground height would put the float on the riverbed. */
    const W = this.world;
    const lvl = W.terrain?.waterAt?.(spot.x, spot.z);
    this.waterY = Number.isFinite(lvl) ? lvl : (W.groundAt?.(spot.x, spot.z) ?? 0);

    this.to.set(spot.x, this.waterY, spot.z);
    const tip = tipFn ? tipFn() : this.to;
    this.from.copy(tip);
    this.pos.copy(tip);
    this.duck = 0;
    this._boilT = 0;
  }

  end() {
    this.active = false;
    this.group.visible = false;
    this.tipFn = null;
    for (const R of this.rings) R.m.visible = false;
    for (const B of this.bubbles) B.m.visible = false;
  }

  /**
   * @param F  the Fishing instance
   */
  update(dt, F) {
    this.t += dt;

    // pools keep running for a moment after the rod goes away
    this._stepRings(dt);
    this._stepBubbles(dt);

    if (!this.active || !F) return;

    const S = F.state;
    if (S === FISH_STATE.IDLE) return;

    const tip = this.tipFn ? this.tipFn() : null;

    if (S === FISH_STATE.CASTING) {
      /* THE FLIGHT. A ballistic arc from the rod tip to the water, eased
         so it leaves fast and arrives slow — a linear lerp between two
         points reads as a bead on a wire. The arc height scales with the
         distance thrown, which is what makes a long cast look long. */
      const u = F.castT;
      const e = u * u * (3 - 2 * u) * 0.35 + u * 0.65;   // mostly linear, slight ease
      const d = this.from.distanceTo(this.to);
      const lift = clamp(d * 0.28, 0.5, 2.4);
      this.pos.lerpVectors(this.from, this.to, e);
      this.pos.y += Math.sin(e * Math.PI) * lift;
      this.bobber.rotation.z = lerp(-0.9, 0.25, e);       // tumbling nose-down
      this.bobber.rotation.x = Math.sin(e * 9) * 0.25 * (1 - e);
      this.bobber.scale.setScalar(1);
      if (this._halo) this._halo.visible = false;
    } else {
      /* ON THE WATER. A slow bob on two detuned sines so it never reads as
         a loop, plus whatever the fish is doing to it. */
      if (this._halo) this._halo.visible = true;
      const bobAmt = S === FISH_STATE.FIGHT ? 0.045 : 0.018;
      const bob = Math.sin(this.t * 1.7) * bobAmt + Math.sin(this.t * 2.63 + 1.1) * bobAmt * 0.5;

      /* THE DUCK. During the bite it is pulled under in irregular tugs —
         this is the single clearest signal that something is on, and it
         is deliberately big enough to see from standing height. */
      let want = 0;
      if (S === FISH_STATE.BITE) {
        const b = F.boil;
        const tug = Math.max(0, Math.sin(this.t * 7.3)) * Math.max(0, Math.sin(this.t * 2.9));
        want = (0.06 + tug * 0.16) * b;
        this._boil(b, dt);
        if (Math.sin(this.t * 2.9) > 0.985) this.ring(0.05, 0.55, 1.1);
      } else if (S === FISH_STATE.FIGHT) {
        want = 0.05 + Math.abs(Math.sin(this.t * 4.1)) * 0.08;
        this._boil(0.35, dt);
      }
      this.duck = lerp(this.duck, want, 1 - Math.exp(-11 * dt));

      /* while fighting, the float is dragged about the surface */
      let ox = 0, oz = 0;
      if (S === FISH_STATE.FIGHT) {
        const a = this.t * 1.3;
        ox = Math.sin(a) * 0.22 + Math.sin(a * 2.1) * 0.09;
        oz = Math.cos(a * 0.8) * 0.22 + Math.cos(a * 1.9) * 0.08;
      }
      this.pos.set(this.to.x + ox, this.waterY + bob - this.duck, this.to.z + oz);

      /* it leans towards whatever is pulling it */
      const pull = this.duck * 3.2;
      this.bobber.rotation.z = Math.sin(this.t * 1.9) * 0.05 + pull * 0.5;
      this.bobber.rotation.x = Math.cos(this.t * 1.55) * 0.05;
      this.bobber.scale.setScalar(1);
    }

    this.bobber.position.copy(this.pos);
    if (tip) this._drawLine(tip, this.pos, S);
  }

  /**
   * THE SAG IS THE WHOLE THING. A line drawn straight from the tip to the
   * float reads as a wire; real line hangs, and it hangs less the tighter
   * it is being pulled. So the droop is scaled down while fighting, which
   * also makes the fight legible from outside the interface: a taut line
   * means something heavy on the end of it.
   */
  _drawLine(tip, end, state) {
    const p = this._linePts;
    const n = LINE_SEGS;
    const span = tip.distanceTo(end);
    const taut = state === FISH_STATE.FIGHT ? 0.25
      : state === FISH_STATE.BITE ? 0.55
        : state === FISH_STATE.CASTING ? 0.30 : 1;
    const sag = Math.min(0.55, span * 0.10) * taut;

    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const k = i * 3;
      p[k] = lerp(tip.x, end.x, u);
      p[k + 1] = lerp(tip.y, end.y, u) - Math.sin(u * Math.PI) * sag;
      p[k + 2] = lerp(tip.z, end.z, u);
    }
    this.line.geometry.attributes.position.needsUpdate = true;
    this.line.geometry.computeBoundingSphere();
  }

  _stepRings(dt) {
    for (const R of this.rings) {
      if (!R.m.visible) continue;
      R.life += dt;
      const u = R.life / R.max;
      if (u >= 1) { R.m.visible = false; R.mat.opacity = 0; continue; }
      /* expands fast then slows, and fades as it goes — a ring that
         expands linearly and cuts out reads as a shockwave */
      const e = 1 - Math.pow(1 - u, 2.2);
      const rad = lerp(R.r0, R.r1, e);
      R.m.scale.set(rad, 1, rad);
      R.mat.opacity = (1 - u) * (1 - u) * 0.55;
    }
  }

  _stepBubbles(dt) {
    for (const B of this.bubbles) {
      if (!B.m.visible) continue;
      B.life += dt;
      const u = B.life / B.max;
      if (u >= 1) { B.m.visible = false; continue; }
      if (B.drop) {
        B.vy -= 9.0 * dt;                         // droplets are ballistic
      } else {
        B.vy = Math.min(B.vy + 0.5 * dt, 0.9);    // bubbles accelerate gently
        B.m.position.x += Math.sin(this.t * B.wob) * 0.10 * dt;
        B.m.position.z += Math.cos(this.t * B.wob * 0.8) * 0.10 * dt;
      }
      B.m.position.x += B.vx * dt;
      B.m.position.y += B.vy * dt;
      B.m.position.z += B.vz * dt;

      /* a bubble pops AT the surface rather than sailing out of the
         water, which is the tell that separates bubbles from sparks */
      if (!B.drop && B.m.position.y >= this.waterY) {
        B.m.position.y = this.waterY;
        B.life = Math.max(B.life, B.max * 0.82);
        if (this.rnd() < 0.10) this.ring(0.02, 0.16, 0.7);
      }
      const s = B.drop ? 0.55 + (1 - u) * 0.55 : 0.35 + u * 0.95;
      B.m.scale.setScalar(s);
    }
  }

  dispose() {
    for (const off of this._off || []) off?.();
    this.group.parent?.remove(this.group);
    this._ringGeo?.dispose();
    this._bubbleGeo?.dispose();
    for (const R of this.rings || []) R.mat?.dispose();
    this._bubbleMat?.dispose();
    this.line?.geometry.dispose();
    this.bobber?.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
  }
}
