/* MapScreen.js — the map, drawn on parchment.
   ===========================================================================
   It has to do two jobs at once and they pull against each other: be a
   BEAUTIFUL OBJECT — something you are pleased to open — and be READABLE,
   so you can find the village you half remember. The compromise is that
   the terrain is painted properly and everything else is restrained: a
   handful of symbols, one label per place, and nothing at all over the
   parts you have not walked.

   THE FOG IS THE POINT. Unexplored country is not greyed out, it is
   ABSENT — burnt parchment with nothing drawn on it. That is what makes
   the map fill in as a record of a journey rather than as a checklist
   being ticked off, and it is why the reveal is a soft-edged disc: the
   frontier should look like the edge of what you know, not like a tile.

   Drawn to a canvas rather than built out of DOM, because it is a hundred
   thousand fog cells and a painting; the only DOM is the frame round it.
*/

import { buildMapImage, worldToMap, mapMarkers, FOG_CELL } from '../game/MapData.js?v=1790085618';
import { VILLAGES } from '../data/VillageData.js?v=1790085618';
import { makeScreen } from './UI.js?v=1790085618';
import { ic } from './Icons.js?v=1790085618';
import { input } from '../core/Input.js?v=1790085618';
import { esc, clamp, clamp01, lerp } from '../core/Util.js?v=1790085618';
import { WORLD } from '../core/Config.js?v=1790085618';

const SYM = {
  village: { r: 7, fill: '#8a5a28', stroke: '#f0dcae', label: true },
  fishing: { r: 4.5, fill: '#2f6f8c', stroke: '#bfe4f4', label: false },
  forge: { r: 5.5, fill: '#7a3a22', stroke: '#f0c090', label: false },
  camp: { r: 4.5, fill: '#8a6a1a', stroke: '#ffd86a', label: false },
};

export class MapScreen {
  constructor(G) {
    this.G = G;
    this.closeKey = 'KeyM';
    this.el = makeScreen('THE WOOD', '<div class="mapwrap"></div>', {
      wide: true, kicker: 'as far as you have walked',
    });
    this.el.querySelector('.x').onclick = () => G.ui.pop();
    this.el.addEventListener('click', e => { if (e.target === this.el) G.ui.pop(); });
    this.body = this.el.querySelector('.mapwrap');

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'map-canvas';
    this.body.appendChild(this.canvas);

    this.legend = document.createElement('div');
    this.legend.className = 'map-legend';
    this.body.appendChild(this.legend);

    this.tip = document.createElement('div');
    this.tip.className = 'map-tip';
    this.body.appendChild(this.tip);
  }

  get busy() { return false; }

  onOpen() {
    /* the terrain image is built once, on the first open, and kept */
    if (!this.G._mapImage) {
      this.G._mapImage = buildMapImage(this.G.world.terrain, 300);
    }
    this.draw();
  }
  onClose() { }

  onKeys() {
    if (input.rawPressed('KeyM', 'Escape', 'KeyQ')) this.G.ui.pop();
  }

  draw() {
    const G = this.G;
    const img = G._mapImage;
    const fog = G.fog;
    /* a square canvas: the world is square and a stretched map is a lie */
    const S = 860;
    const c = this.canvas;
    c.width = S; c.height = S;
    const ctx = c.getContext('2d');

    /* --- the parchment it is drawn on ---------------------------------- */
    ctx.fillStyle = '#2a2114';
    ctx.fillRect(0, 0, S, S);

    /* --- the land, masked by the fog ------------------------------------ */
    const n = fog.n;
    const cell = S / n;
    const src = document.createElement('canvas');
    src.width = img.size; src.height = img.size;
    const sctx = src.getContext('2d');
    const idata = sctx.createImageData(img.size, img.size);
    idata.data.set(img.px);
    sctx.putImageData(idata, 0, 0);

    /* build the fog as a mask: draw the terrain, then punch out everything
       that has not been walked. Blurring the mask is what gives the
       frontier a soft edge instead of a staircase of squares. */
    const mask = document.createElement('canvas');
    mask.width = n; mask.height = n;
    const mctx = mask.getContext('2d');
    const mdata = mctx.createImageData(n, n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const o = (j * n + i) * 4;
        const on = fog.seenCell(i, j);
        mdata.data[o] = 255; mdata.data[o + 1] = 255; mdata.data[o + 2] = 255;
        mdata.data[o + 3] = on ? 255 : 0;
      }
    }
    mctx.putImageData(mdata, 0, 0);

    ctx.save();
    ctx.filter = 'blur(2px)';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(mask, 0, 0, S, S);
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-in';
    ctx.drawImage(src, 0, 0, S, S);
    ctx.restore();

    /* --- a warm wash and a vignette, so it reads as paper --------------- */
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = 'rgba(214, 178, 110, 0.20)';
    ctx.fillRect(0, 0, S, S);
    ctx.restore();

    /* --- the edge of the known world ------------------------------------ */
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.2, S / 2, S / 2, S * 0.72);
    g.addColorStop(0, '#2e2416');
    g.addColorStop(1, '#1d1710');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    ctx.restore();

    /* --- the river, traced over the top where it is known --------------- */
    /* (the terrain image already carries it; this is the marker layer) */

    /* --- symbols --------------------------------------------------------- */
    const markers = mapMarkers(G);
    const toPx = (x, z) => [
      ((x + WORLD.half) / (WORLD.half * 2)) * S,
      ((z + WORLD.half) / (WORLD.half * 2)) * S,
    ];

    for (const m of markers) {
      const [mx, my] = toPx(m.x, m.z);
      const D = SYM[m.kind] || SYM.fishing;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 5;
      if (m.kind === 'village') {
        /* a little roof, which reads as a settlement at ten pixels */
        ctx.beginPath();
        ctx.moveTo(mx, my - D.r);
        ctx.lineTo(mx + D.r, my);
        ctx.lineTo(mx + D.r * 0.66, my);
        ctx.lineTo(mx + D.r * 0.66, my + D.r * 0.8);
        ctx.lineTo(mx - D.r * 0.66, my + D.r * 0.8);
        ctx.lineTo(mx - D.r * 0.66, my);
        ctx.lineTo(mx - D.r, my);
        ctx.closePath();
      } else if (m.kind === 'fishing') {
        /* a fish */
        ctx.beginPath();
        ctx.ellipse(mx, my, D.r, D.r * 0.6, 0, 0, Math.PI * 2);
        ctx.moveTo(mx - D.r, my);
        ctx.lineTo(mx - D.r * 1.9, my - D.r * 0.6);
        ctx.lineTo(mx - D.r * 1.9, my + D.r * 0.6);
        ctx.closePath();
      } else if (m.kind === 'forge') {
        /* a hammer */
        ctx.beginPath();
        ctx.rect(mx - D.r, my - D.r * 0.9, D.r * 2, D.r * 0.8);
        ctx.rect(mx - D.r * 0.28, my - D.r * 0.1, D.r * 0.56, D.r * 1.7);
      } else {
        /* a tent */
        ctx.beginPath();
        ctx.moveTo(mx, my - D.r);
        ctx.lineTo(mx + D.r, my + D.r * 0.8);
        ctx.lineTo(mx - D.r, my + D.r * 0.8);
        ctx.closePath();
      }
      ctx.fillStyle = D.fill;
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = D.stroke;
      ctx.stroke();
      ctx.restore();

      if (D.label) {
        ctx.save();
        ctx.font = '600 15px "Cormorant Garamond", Georgia, serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = 'rgba(20,14,6,0.85)';
        ctx.strokeText(m.label, mx, my - D.r - 6);
        ctx.fillStyle = '#f4e6c0';
        ctx.fillText(m.label, mx, my - D.r - 6);
        ctx.restore();
      }
    }

    /* --- YOU ------------------------------------------------------------- */
    const P = G.player;
    if (P) {
      const [px, py] = toPx(P.x, P.z);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(-P.yaw + Math.PI);
      ctx.beginPath();
      ctx.moveTo(0, -11);
      ctx.lineTo(7.5, 8);
      ctx.lineTo(0, 4);
      ctx.lineTo(-7.5, 8);
      ctx.closePath();
      ctx.fillStyle = '#e2a049';
      ctx.strokeStyle = '#fff4d8';
      ctx.lineWidth = 2;
      ctx.shadowColor = 'rgba(255, 210, 120, 0.9)';
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    /* --- the frame -------------------------------------------------------- */
    ctx.save();
    ctx.strokeStyle = 'rgba(214, 178, 110, 0.45)';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, S - 6, S - 6);
    ctx.strokeStyle = 'rgba(214, 178, 110, 0.22)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(11, 11, S - 22, S - 22);
    /* a compass rose, top right */
    const rx = S - 58, ry = 58;
    ctx.translate(rx, ry);
    ctx.strokeStyle = 'rgba(240, 220, 174, 0.55)';
    ctx.fillStyle = 'rgba(240, 220, 174, 0.55)';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -26); ctx.lineTo(5, 0); ctx.lineTo(0, 26); ctx.lineTo(-5, 0);
    ctx.closePath(); ctx.fill();
    ctx.font = '700 12px "Alegreya Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', 0, -30);
    ctx.restore();

    /* --- the legend and the tally --------------------------------------- */
    const pct = Math.round(fog.explored * 100);
    const found = VILLAGES.filter(v => fog.seen(v.x, v.z)).length;
    this.legend.innerHTML = `
      <span class="ml-item"><i class="ml-village"></i>village</span>
      <span class="ml-item"><i class="ml-fish"></i>fishing</span>
      <span class="ml-item"><i class="ml-forge"></i>forge</span>
      <span class="ml-item"><i class="ml-camp"></i>survey camp</span>
      <span class="ml-item ml-you"><i class="ml-pin"></i>you</span>
      <span class="ml-spacer"></span>
      <span class="ml-stat"><b>${found}</b>/${VILLAGES.length} villages</span>
      <span class="ml-stat"><b>${pct}%</b> walked</span>`;

    this.tip.textContent = pct < 4
      ? 'The rest of the wood is not on here yet. Walk into it and it will be.'
      : '';
  }
}
