/* Combatant.js — the two bits of feedback a fight needs, and no more.
   ===========================================================================
   A FLOATING NUMBER when you connect, and a HEALTH BAR for about a second
   afterwards. That is the whole of it, and the restraint is the design:

     THE BAR IS NOT PERMANENT. A bar hanging over every animal in the wood
     turns a forest into a raid boss list, and the brief says so outright.
     It appears when you land a hit, holds for a second, and fades. If you
     stop hitting something you stop being told about its health, which is
     also when you stop needing to know.

     THE NUMBER IS THE HIT CONFIRMATION. It rises, drifts slightly aside so
     three hits in a row do not stack into an unreadable pile, and fades.
     A charged or third-in-combo blow gets a bigger, warmer number, which
     is the cheapest possible way to teach the combo.

   Both are DOM, positioned by projecting a world point through the camera
   each frame. That is much cheaper than it sounds — there are never more
   than a handful up at once — and it means they are crisp text at any
   resolution rather than a rendered billboard.
*/

import * as THREE from '../../lib/three.module.js?v=1790020991';
import { clamp, clamp01 } from '../core/Util.js?v=1790020991';

const NUM_POOL = 14;
const BAR_POOL = 8;
const BAR_HOLD = 1.0;      // seconds the bar stays up after the last hit
const BAR_FADE = 0.35;

export class Combatant {
  constructor(root, camera) {
    this.camera = camera;
    this.el = document.createElement('div');
    this.el.id = 'combat-fx';
    this.el.className = 'cfx';
    /*
     * SET INLINE, NOT IN THE STYLESHEET, and this is not belt-and-braces.
     *
     * `#ui > * { pointer-events: auto; }` has been in main.css since the
     * HUD was written, and it has ID specificity (1,0,0). A `.cfx` rule
     * saying `pointer-events: none` is (0,1,0) and LOSES. This layer is
     * `position: fixed; inset: 0` — it covers the entire screen — so it
     * quietly became a sheet of glass over the whole game: right-drag to
     * look stopped working, and clicks never reached the canvas so
     * pointer lock could not engage either.
     *
     * An inline style beats any selector, so the component guarantees
     * its own transparency instead of depending on the cascade going its
     * way. Any future full-bleed overlay added under #ui needs the same.
     */
    this.el.style.pointerEvents = 'none';
    root.appendChild(this.el);

    this.nums = [];
    for (let i = 0; i < NUM_POOL; i++) {
      const d = document.createElement('div');
      d.className = 'cfx-num';
      d.style.display = 'none';
      this.el.appendChild(d);
      this.nums.push({ d, life: 0, max: 1, x: 0, y: 0, z: 0, dx: 0 });
    }

    this.bars = [];
    for (let i = 0; i < BAR_POOL; i++) {
      const d = document.createElement('div');
      d.className = 'cfx-bar';
      d.style.display = 'none';
      d.innerHTML = '<span class="cfx-name"></span><i><u></u></i>';
      this.el.appendChild(d);
      this.bars.push({
        d, fill: d.querySelector('u'), name: d.querySelector('.cfx-name'),
        target: null,
      });
    }

    this._v = new THREE.Vector3();
  }

  /** A hit landed. @param at [x,y,z] world */
  damage(at, amount, { crit = false } = {}) {
    const N = this.nums.find(n => n.life <= 0) || this.nums[0];
    N.life = 0.001;
    N.max = crit ? 1.05 : 0.85;
    N.x = at[0]; N.y = at[1]; N.z = at[2];
    /* a fixed sideways drift per number, alternating, so a fast combo
       does not pile three numbers on the same pixel */
    N.dx = (this._flip = !this._flip) ? 26 : -26;
    N.d.textContent = String(amount);
    N.d.className = 'cfx-num' + (crit ? ' crit' : '');
    N.d.style.display = '';
  }

  /**
   * Show (or refresh) a creature's bar. Called every frame while its own
   * `barT` is running, so the bar follows it as it is knocked back.
   */
  track(key, at, hp, maxHp, name, t) {
    let B = this.bars.find(x => x.target === key);
    if (!B) B = this.bars.find(x => x.target === null);
    if (!B) return;
    B.target = key;
    B.at = at;
    B.t = t;
    const f = clamp01(maxHp > 0 ? hp / maxHp : 0);
    B.fill.style.width = `${f * 100}%`;
    B.d.classList.toggle('hurt', f < 0.34);
    if (B.name.textContent !== name) B.name.textContent = name;
    B.d.style.display = '';
  }

  /** Anything not refreshed this frame goes away. */
  update(dt) {
    const cam = this.camera;
    const W = innerWidth, H = innerHeight;

    for (const N of this.nums) {
      if (N.life <= 0) continue;
      N.life += dt;
      const u = N.life / N.max;
      if (u >= 1) { N.life = 0; N.d.style.display = 'none'; continue; }
      const p = this._project(N.x, N.y + u * 0.75, N.z, cam, W, H);
      if (!p) { N.d.style.display = 'none'; continue; }
      N.d.style.display = '';
      /* eases up fast then hangs, which reads as a pop rather than a
         balloon drifting off the top of the screen */
      N.d.style.transform =
        `translate(-50%,-50%) translate(${p.x + N.dx * u}px,${p.y - u * 26}px) scale(${1 + (1 - u) * 0.35})`;
      N.d.style.opacity = String(u < 0.72 ? 1 : 1 - (u - 0.72) / 0.28);
    }

    for (const B of this.bars) {
      if (!B.target) continue;
      /* the owner stopped refreshing it: fade out and release the slot */
      const t = B.t ?? 0;
      if (t <= 0) { B.target = null; B.d.style.display = 'none'; continue; }
      const p = B.at ? this._project(B.at[0], B.at[1], B.at[2], cam, W, H) : null;
      if (!p) { B.d.style.display = 'none'; B.t = t; continue; }
      B.d.style.display = '';
      B.d.style.transform = `translate(-50%,-50%) translate(${p.x}px,${p.y}px)`;
      /* full opacity while it is being hit, fading over the last third */
      B.d.style.opacity = String(t > BAR_FADE ? 1 : t / BAR_FADE);
      B.t = 0;                       // must be re-tracked next frame to survive
    }
  }

  /** @returns {{x,y}|null} screen position, or null if behind the camera. */
  _project(x, y, z, cam, W, H) {
    const v = this._v.set(x, y, z).project(cam);
    if (v.z > 1) return null;                     // behind the near plane
    return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H };
  }

  dispose() { this.el.remove(); }
}
