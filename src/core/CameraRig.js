/* CameraRig.js — THE camera.
   ===========================================================================
   This is the only thing in Hearthwood that writes `camera.position` or
   `camera.rotation`, and the only thing that decides which way "forward" is.
   If you are adding a camera behaviour, add it here; do not compute a camera
   anywhere else. test_camera.mjs greps the source and fails if anything does.

   CONVENTIONS (pinned by the test — change these and it fails)

     yaw     0 looks along +Z. forward = (sin yaw, cos yaw) on the XZ plane.
             Mouse RIGHT decreases yaw, which turns the view to the right.
     pitch   radians ABOVE the focus. 0 is level, positive looks DOWN from
             above. Clamped well short of vertical so the view can never flip.
     right   = (-forward.z, forward.x). This is genuinely screen-right for a
             three.js camera looking along `forward` with +Y up, so movement
             and the view can never disagree — they are computed from the same
             yaw, in the same place, on the same frame.

   ORIENTATION is set as explicit Euler angles in YXZ order rather than with
   lookAt(). lookAt() has to pick an up vector, and near-vertical angles make
   that choice unstable — which is where "the camera suddenly flipped" comes
   from. Setting yaw and pitch directly makes roll structurally impossible:
   rotation.z is always exactly 0.

   SMOOTHING is one stage, and only one. Input moves the *target* angles
   instantly; the rendered angles chase the target with a fast critical damp;
   the position is then computed exactly from the smoothed angles and never
   damped again on top. Two smoothing stages in series is what makes a camera
   feel like it is swimming.
*/

import { clamp, damp, angleDelta, TAU } from './Util.js?v=1790014288';

/* Presets are starting points, not modes — the player can always override any
   of them with the mouse. Hearthwood is a walking game, so all three sit
   further back and lower than a combat camera would: you are meant to be
   looking at the WOOD, with your animal in it, not at the back of a head. */
export const CAM_PRESETS = {
  /** The everyday exploring view. */
  roam: {
    dist: 6.2, minDist: 1.6, maxDist: 15,
    pitch: 0.21, minPitch: -0.34, maxPitch: 1.16,
    focusHeight: 1.05, lead: 0.02, shoulder: 0.52,
    focusRate: 13, angleRate: 24, distRate: 10,
  },
  /** Closer in, for picking things up and for the workshop. */
  close: {
    dist: 3.4, minDist: 1.4, maxDist: 9,
    pitch: 0.30, minPitch: -0.20, maxPitch: 1.10,
    focusHeight: 0.95, lead: 0, shoulder: 0.62,
    focusRate: 16, angleRate: 24, distRate: 12,
  },
  /** Pulled back and up — for looking out over the valley. */
  vista: {
    dist: 13.5, minDist: 6, maxDist: 34,
    pitch: 0.44, minPitch: -0.10, maxPitch: 1.22,
    focusHeight: 1.4, lead: 0.10, shoulder: 0,
    focusRate: 9, angleRate: 22, distRate: 9,
  },
  /** Character select and cutscene-ish framing — no shoulder offset. */
  portrait: {
    dist: 4.4, minDist: 2.2, maxDist: 8,
    pitch: 0.12, minPitch: -0.24, maxPitch: 0.9,
    focusHeight: 0.92, lead: 0, shoulder: 0,
    focusRate: 18, angleRate: 20, distRate: 12,
  },
};

/** Never let the camera approach vertical: 1.34 rad is 77 degrees. */
const HARD_MIN_PITCH = -0.55;
const HARD_MAX_PITCH = 1.34;
/** Below this, a smoothed value snaps to its target rather than creeping. */
const SNAP = 1e-5;
const CENTRE = { x: 0, y: 0 };

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.camera.rotation.order = 'YXZ';

    /* target angles — what input writes to */
    this.yaw = 0;
    this.pitch = 0.21;
    this.dist = 6.2;

    /* smoothed angles — what the camera is actually drawn with */
    this.curYaw = 0;
    this.curPitch = 0.21;
    this.curDist = 6.2;

    this.focus = { x: 0, y: 0, z: 0 };
    this.curFocus = { x: 0, y: 0, z: 0 };

    this.preset = CAM_PRESETS.roam;
    this.presetName = 'roam';

    this.sensitivity = 1;
    this.invertY = false;

    /** Ground height lookup, so the boom never dives under the terrain. */
    this.probe = null;
    /** Solid things the boom must not end up inside, as discs on XZ. */
    this.blockers = null;
    this.minClearance = 0.85;

    /* A gentle idle drift, only while the player is standing still and not
       touching the mouse. It is tiny — a couple of centimetres — but it is the
       difference between "paused game" and "a place that is still there". */
    this.breathe = 0;
    this.t = 0;

    /* A CUTSCENE SHOT: an explicit eye and an explicit look-at, set by a
       director and cleared when it finishes. It lives here rather than in the
       director because this file is the only thing in the game allowed to
       write the camera, and a cutscene that reached past it would be the
       first crack in that rule. While a shot is set the orbit boom is not
       computed at all; the angles are still derived from the shot, so
       rotation.z stays zero and the view still cannot roll or flip. */
    this.shot = null;
  }

  /* ====================================================================== */
  /* SETUP                                                                   */
  /* ====================================================================== */

  applyPreset(name, instant = false) {
    const p = CAM_PRESETS[name] || CAM_PRESETS.roam;
    this.preset = p;
    this.presetName = name;
    this.dist = clamp(p.dist, p.minDist, p.maxDist);
    this.pitch = clamp(p.pitch, this._minPitch(), this._maxPitch());
    if (instant) { this.curDist = this.dist; this.curPitch = this.pitch; }
  }

  reset({ x = 0, y = 0, z = 0, yaw = 0, preset = null } = {}) {
    if (preset) this.applyPreset(preset, true);
    this.yaw = this.curYaw = yaw;
    this.pitch = this.curPitch = clamp(this.preset.pitch, this._minPitch(), this._maxPitch());
    this.dist = this.curDist = this.preset.dist;
    this.focus.x = this.curFocus.x = x;
    this.focus.y = this.curFocus.y = y;
    this.focus.z = this.curFocus.z = z;
    this._writeTransform();
  }

  setFocus(x, y, z) { this.focus.x = x; this.focus.y = y; this.focus.z = z; }

  /**
   * Take the camera for a cutscene.
   *
   * @param eye     [x,y,z] where the camera is
   * @param target  [x,y,z] what it is pointing at
   *
   * Call it every frame of the cutscene — the director owns the easing, not
   * the rig, because a beat that eases into place and then dollies through
   * the beat cannot be expressed as "damp towards a pose".
   */
  /**
   * @param fov  optional focal length for this shot, in degrees. A cutscene
   *             that films every beat on the same lens is a slideshow of one
   *             camera moved around; choosing between a wide that takes in
   *             the whole shed and a long lens that puts the player's nose
   *             in her hands is most of what makes a set of shots read as
   *             having been DIRECTED. Omit it to keep the gameplay lens.
   */
  setShot(eye, target, fov = 0) {
    this.shot = { eye, target };
    if (fov > 0) {
      if (this._fov0 == null) this._fov0 = this.camera.fov;
      if (Math.abs(this.camera.fov - fov) > 1e-3) {
        this.camera.fov = fov;
        this.camera.updateProjectionMatrix();
      }
    }
    /* written NOW, not on the next update(): the director runs after the rig
       has already updated this frame, and a shot that waited would put every
       cut one frame late — which is exactly one frame of the previous camera
       in the new beat, and it reads as a flicker. */
    this._writeTransform();
  }

  /**
   * Hand the camera back.
   *
   * The orbit state is re-derived from where the cutscene left off, so the
   * player does not get snapped round to the angle they were standing at
   * twenty seconds ago the instant the last beat ends.
   */
  clearShot() {
    if (!this.shot) return;
    /* put the gameplay lens back, or the player spends the rest of the
       session looking through whatever the last beat was framed on */
    if (this._fov0 != null) {
      this.camera.fov = this._fov0;
      this.camera.updateProjectionMatrix();
      this._fov0 = null;
    }
    const [ex, ey, ez] = this.shot.eye;
    const [tx, ty, tz] = this.shot.target;
    const dx = tx - ex, dy = ty - ey, dz = tz - ez;
    const horiz = Math.hypot(dx, dz) || 1e-4;
    this.shot = null;
    this.yaw = this.curYaw = Math.atan2(dx, dz);
    this.pitch = this.curPitch = clamp(Math.atan2(-dy, horiz), this._minPitch(), this._maxPitch());
    this.dist = this.curDist = clamp(Math.hypot(dx, dy, dz), this.preset.minDist, this.preset.maxDist);
  }
  setProbe(fn) { this.probe = typeof fn === 'function' ? fn : null; }
  setBlockers(list) { this.blockers = (list && list.length) ? list : null; }

  _minPitch() { return Math.max(HARD_MIN_PITCH, this.preset.minPitch); }
  _maxPitch() { return Math.min(HARD_MAX_PITCH, this.preset.maxPitch); }

  /* ====================================================================== */
  /* INPUT                                                                   */
  /* ====================================================================== */

  /** Feed a look delta in device pixels. The ONLY way orientation changes. */
  look(dx, dy) {
    if (!dx && !dy) return;
    if (!isFinite(dx) || !isFinite(dy)) return;
    // Defence in depth: Input clamps too, but a trackpad driver spike must
    // never be able to whip the view round even if it arrives some other way.
    dx = clamp(dx, -260, 260);
    dy = clamp(dy, -260, 260);
    const s = 0.0021 * this.sensitivity;
    this.yaw -= dx * s;
    this.pitch += (this.invertY ? -dy : dy) * s;
    this.pitch = clamp(this.pitch, this._minPitch(), this._maxPitch());
    if (this.yaw > Math.PI) { this.yaw -= TAU; this.curYaw -= TAU; }
    else if (this.yaw < -Math.PI) { this.yaw += TAU; this.curYaw += TAU; }
    this.breathe = 0;
  }

  /** Wheel notches: positive zooms out. */
  zoom(notches) {
    if (!notches) return;
    const p = this.preset;
    const step = Math.max(0.55, this.dist * 0.17);
    this.dist = clamp(this.dist + notches * step, p.minDist, p.maxDist);
  }

  /** Cancel in-flight rotation the moment a menu opens. */
  settleTargets() {
    this.yaw = this.curYaw;
    this.pitch = this.curPitch;
    this.dist = this.curDist;
  }

  /* ====================================================================== */
  /* BASIS — movement and the view come from the SAME yaw                    */
  /* ====================================================================== */

  get forward() { return { x: Math.sin(this.curYaw), z: Math.cos(this.curYaw) }; }
  get right() { return { x: -Math.cos(this.curYaw), z: Math.sin(this.curYaw) }; }

  /**
   * Turn a WASD input vector into world movement.
   * @param ix  -1 = A, +1 = D
   * @param iy  -1 = S, +1 = W
   */
  moveVector(ix, iy) {
    if (!ix && !iy) return { x: 0, z: 0 };
    const f = this.forward, r = this.right;
    let x = f.x * iy + r.x * ix;
    let z = f.z * iy + r.z * ix;
    const l = Math.hypot(x, z);
    if (l > 1e-6) { x /= l; z /= l; }
    return { x, z };
  }

  /** The yaw a character faces to be looking the way the camera looks. */
  get facingYaw() {
    const f = this.forward;
    return Math.atan2(f.z, f.x);
  }

  /* ====================================================================== */
  /* UPDATE                                                                  */
  /* ====================================================================== */

  update(dt, { idle = false } = {}) {
    this.t += dt;
    const p = this.preset;

    /* Exponential approach never actually ARRIVES, so without the snap the
       camera would creep by a millionth of a radian forever and "the camera
       does not drift" would be quietly false. */
    const dYaw = angleDelta(this.curYaw, this.yaw);
    this.curYaw = Math.abs(dYaw) < SNAP ? this.yaw
      : this.curYaw + dYaw * (1 - Math.exp(-p.angleRate * dt));
    this.curPitch = Math.abs(this.pitch - this.curPitch) < SNAP ? this.pitch
      : damp(this.curPitch, this.pitch, p.angleRate, dt);
    this.curDist = Math.abs(this.dist - this.curDist) < SNAP ? this.dist
      : damp(this.curDist, this.dist, p.distRate, dt);

    for (const k of ['x', 'y', 'z']) {
      this.curFocus[k] = Math.abs(this.focus[k] - this.curFocus[k]) < SNAP
        ? this.focus[k] : damp(this.curFocus[k], this.focus[k], p.focusRate, dt);
    }

    // idle breathing fades in over a couple of seconds of stillness and is
    // cancelled instantly by any look input
    this.breathe = idle ? Math.min(1, this.breathe + dt * 0.45) : Math.max(0, this.breathe - dt * 4);

    this._writeTransform();
  }

  _writeTransform() {
    const p = this.preset;
    const cam = this.camera;

    /* --- a cutscene shot short-circuits the whole boom ------------------- */
    if (this.shot) {
      const [ex, ey, ez] = this.shot.eye;
      const [tx, ty, tz] = this.shot.target;
      const dx = tx - ex, dy = ty - ey, dz = tz - ez;
      const horiz = Math.hypot(dx, dz) || 1e-4;
      cam.position.set(ex, ey, ez);
      cam.rotation.y = Math.atan2(dx, dz) + Math.PI;
      cam.rotation.x = clamp(Math.atan2(dy, horiz), -HARD_MAX_PITCH, HARD_MAX_PITCH);
      cam.rotation.z = 0;
      cam.updateMatrixWorld(true);
      return;
    }

    const sinP = Math.sin(this.curPitch), cosP = Math.cos(this.curPitch);
    const f = { x: Math.sin(this.curYaw), z: Math.cos(this.curYaw) };

    const lead = p.lead * this.curDist;

    /* Shoulder offset. The aim point AND the camera slide the same distance
       along screen-right, so the view stays parallel and the character simply
       sits off to one side. Offsetting only the camera would swing the aim
       across the character. */
    const sh = p.shoulder || 0;
    const rx = -Math.cos(this.curYaw), rz = Math.sin(this.curYaw);

    const ax = this.curFocus.x + f.x * lead + rx * sh;
    const ay = this.curFocus.y + p.focusHeight;
    const az = this.curFocus.z + f.z * lead + rz * sh;

    let horiz = this.curDist * cosP;
    let vert = this.curDist * sinP;

    /* Keep the boom out of solid things. Shortening it is far less jarring
       than clipping through a wall — and a camera inside a tree trunk is just
       a brown screen. */
    if (this.blockers) {
      for (let i = 0; i < 8; i++) {
        const px = ax - f.x * horiz, pz = az - f.z * horiz;
        let bad = false;
        for (const o of this.blockers) {
          const dx = px - o.x, dz = pz - o.z;
          if (dx * dx + dz * dz < o.r * o.r) { bad = true; break; }
        }
        if (!bad) break;
        horiz *= 0.76; vert *= 0.76;
        if (horiz < 0.8) break;
      }
    }

    let px = ax - f.x * horiz;
    let py = ay + vert;
    let pz = az - f.z * horiz;

    if (this.probe) {
      const g = this.probe(px, pz);
      if (isFinite(g) && py < g + this.minClearance) py = g + this.minClearance;
    }

    if (this.breathe > 0.001) {
      const b = this.breathe * 0.035;
      const t = this.t;
      px += Math.sin(t * 0.37) * b;
      py += Math.sin(t * 0.53 + 1.1) * b * 0.8;
      pz += Math.cos(t * 0.31) * b;
    }

    cam.position.set(px, py, pz);

    // Explicit orientation. rotation.z is never written, so there is no roll;
    // pitch is clamped short of vertical, so there is no flip.
    cam.rotation.y = this.curYaw + Math.PI;
    cam.rotation.x = -this.curPitch;
    cam.rotation.z = 0;
    cam.updateMatrixWorld(true);
  }

  /** A ray through the centre of the screen. */
  centreRay(raycaster) {
    raycaster.setFromCamera(CENTRE, this.camera);
    return raycaster;
  }
}
