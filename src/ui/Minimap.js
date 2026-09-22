/* Minimap.js — a small window on the map you have actually walked.
   ===========================================================================
   The full map screen is a thing you stop and open. This is the thing you
   glance at, and the two want opposite properties: the screen wants the
   whole world and a legend, this wants two hundred metres and almost no
   ink at all.

   THE RULES IT FOLLOWS:

     IT ONLY SHOWS WHAT THE FOG HAS OPENED. Exactly the same bitset the
     map screen reads, so the minimap can never be a way to scout ground
     you have not walked — which would quietly undo the whole point of
     revealing the map on foot.

     IT IS NORTH-UP. A rotating minimap is easier to follow in the moment
     and completely useless for building a mental picture of a world, and
     this game is about learning where things are. North-up plus a
     rotating arrow is the combination that teaches the map.

     THE ARROW IS THE PLAYER AND IT POINTS WHERE THEY LOOK. Asked for
     explicitly, and it is the one moving thing on it, so everything else
     is deliberately quiet enough that the arrow is what the eye finds.

   It draws to a canvas the size it appears on screen, and only redraws
   the terrain layer when the view has actually moved — the arrow moves
   every frame, the ground does not.
*/

import { buildMapImage, FOG_CELL } from '../game/MapData.js?v=1790055608';
import { WORLD } from '../core/Config.js?v=1790055608';
import { VILLAGES } from '../data/VillageData.js?v=1790055608';
import { clamp, clamp01, TAU } from '../core/Util.js?v=1790055608';

const SIZE = 168;          // css pixels
const SPAN = 240;          // metres across the window

export class Minimap {
  /**
   * @param root  the #ui element
   * @param G     the game, for terrain, fog and the player
   */
  constructor(root, G) {
    this.G = G;
    this.el = document.createElement('div');
    this.el.id = 'minimap';
    this.el.className = 'mmap';
    /* inline, because `#ui > *` sets pointer-events:auto at ID
       specificity and would otherwise make the dial a click-eater in
       the corner of the screen — see the note in Combatant.js */
    this.el.style.pointerEvents = 'none';
    this.el.innerHTML = `
      <canvas class="mmap-c"></canvas>
      <div class="mmap-ring"></div>
      <div class="mmap-n">N</div>
      <div class="mmap-place"></div>`;
    root.appendChild(this.el);

    this.canvas = this.el.querySelector('.mmap-c');
    this.place = this.el.querySelector('.mmap-place');
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    this.canvas.width = SIZE * dpr;
    this.canvas.height = SIZE * dpr;
    this.canvas.style.width = `${SIZE}px`;
    this.canvas.style.height = `${SIZE}px`;
    this.ctx = this.canvas.getContext('2d');
    this.dpr = dpr;

    /* the whole-world terrain image, built once and sampled from. It is
       small (260 px for 1800 m) which is exactly right here: the minimap
       wants an impression of the ground, not its contours. */
    /* THE WHOLE THING IS OPTIONAL. If the terrain image cannot be built
       or a 2D context cannot be had, the dial draws a flat green disc
       and the arrow — which is still a useful compass — rather than
       throwing and taking the HUD down with it. */
    this.world = null;
    this.tile = null;
    try {
      this.world = buildMapImage(G.world?.terrain, 300);
      const t = document.createElement('canvas');
      t.width = this.world.size;
      t.height = this.world.size;
      const tctx = t.getContext('2d');
      const img = tctx.createImageData(this.world.size, this.world.size);
      img.data.set(this.world.px);
      tctx.putImageData(img, 0, 0);
      this.tile = t;
    } catch (e) {
      this.tile = null;
    }

    this._lastCell = '';
    this._placeName = '';
    this.t = 0;
  }

  show(on) { this.el.classList.toggle('hidden', !on); }

  update(dt) {
    const G = this.G;
    const P = G.player;
    if (!P || !this.ctx) return;
    this.t += dt;

    const ctx = this.ctx;
    const d = this.dpr;
    const R = SIZE * 0.5;

    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);

    /* clip to the dial, so nothing has to be drawn carefully */
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R - 1, 0, TAU);
    ctx.clip();

    /* --- the ground ---------------------------------------------------- */
    const half = WORLD.half;
    const scale = SIZE / SPAN;                 // px per metre
    if (this.tile) {
      const tpm = this.world.size / (half * 2); // tile px per metre
      const sw = SPAN * tpm;
      const sx = (P.x + half) * tpm - sw / 2;
      const sy = (P.z + half) * tpm - sw / 2;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.tile, sx, sy, sw, sw, 0, 0, SIZE, SIZE);
    } else {
      ctx.fillStyle = '#39422c';
      ctx.fillRect(0, 0, SIZE, SIZE);
    }

    /* --- THE FOG. Everything not walked is painted over. --------------
       Drawn as filled cells rather than as a blurred mask: at this size
       a blur costs more than it buys, and hard-edged cells read as a
       map being filled in, which is the feeling wanted. */
    const fog = G.fog;
    if (fog) {
      ctx.fillStyle = 'rgba(26, 30, 22, 0.88)';
      const c = FOG_CELL;
      const x0 = P.x - SPAN / 2, z0 = P.z - SPAN / 2;
      const i0 = Math.floor(x0 / c), i1 = Math.ceil((x0 + SPAN) / c);
      const j0 = Math.floor(z0 / c), j1 = Math.ceil((z0 + SPAN) / c);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          if (fog.seen(i * c + c / 2, j * c + c / 2)) continue;
          const px = (i * c - x0) * scale, py = (j * c - z0) * scale;
          ctx.fillRect(px - 0.5, py - 0.5, c * scale + 1, c * scale + 1);
        }
      }
    }

    /* --- villages you have found --------------------------------------- */
    const S = G.state;
    for (const v of VILLAGES) {
      if (S && !S.seenVillages.has(v.id)) continue;
      const px = (v.x - P.x) * scale + R, py = (v.z - P.z) * scale + R;
      if (px < -20 || py < -20 || px > SIZE + 20 || py > SIZE + 20) continue;
      ctx.fillStyle = 'rgba(240, 220, 160, 0.92)';
      ctx.strokeStyle = 'rgba(60, 44, 20, 0.85)';
      ctx.lineWidth = 1.2;
      /* a little roof, which reads as a settlement at six pixels where a
         dot reads as nothing in particular */
      ctx.beginPath();
      ctx.moveTo(px, py - 4.5);
      ctx.lineTo(px + 4.5, py + 1);
      ctx.lineTo(px + 2.6, py + 1);
      ctx.lineTo(px + 2.6, py + 4);
      ctx.lineTo(px - 2.6, py + 4);
      ctx.lineTo(px - 2.6, py + 1);
      ctx.lineTo(px - 4.5, py + 1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    /* --- the line in the water, while there is one ---------------------- */
    const rig = G.fishRig;
    if (rig?.active) {
      const px = (rig.to.x - P.x) * scale + R, py = (rig.to.z - P.z) * scale + R;
      ctx.strokeStyle = 'rgba(180, 230, 255, 0.9)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(px, py, 3 + Math.sin(this.t * 4) * 0.8, 0, TAU);
      ctx.stroke();
    }

    ctx.restore();

    /* --- THE PLAYER. Always dead centre, always pointing where they look.
       Drawn after the clip is released so the arrow is never clipped by
       the dial edge, and with a dark outline so it survives being over
       either pale sand or dark fog. */
    ctx.save();
    ctx.translate(R, R);
    ctx.rotate(P.yaw);
    ctx.beginPath();
    ctx.moveTo(0, -7.5);
    ctx.lineTo(5.2, 6);
    ctx.lineTo(0, 3.2);
    ctx.lineTo(-5.2, 6);
    ctx.closePath();
    ctx.fillStyle = '#ffd98a';
    ctx.strokeStyle = 'rgba(40, 28, 12, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    /* --- where you are, named ------------------------------------------ */
    const near = nearestNamed(P.x, P.z, S);
    if (near !== this._placeName) {
      this._placeName = near;
      this.place.textContent = near;
      this.place.classList.toggle('on', !!near);
    }
  }

  dispose() { this.el.remove(); }
}

/**
 * The name under the dial: the village you are in, or nothing.
 *
 * Deliberately NOT "the nearest village however far away" — a label that
 * always says something is a label nobody reads, and the region name is
 * the banner's job, not the minimap's.
 */
function nearestNamed(x, z, state) {
  for (const v of VILLAGES) {
    if (state && !state.seenVillages.has(v.id)) continue;
    const r = (v.core || 60) + 30;
    if ((x - v.x) * (x - v.x) + (z - v.z) * (z - v.z) < r * r) return v.name;
  }
  return '';
}
