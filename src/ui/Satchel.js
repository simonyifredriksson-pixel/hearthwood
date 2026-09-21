/* Satchel.js — what you are carrying.
   ===========================================================================
   A list of sticks and a rack of finished weapons, with a live 3D view of
   whatever is selected. The 3D view is the point: a stick's name and its
   numbers tell you almost nothing compared to turning the actual object over
   and seeing that it has three little brackets growing out of one side.
*/

import * as THREE from '../../lib/three.module.js?v=20260921163240';
import { MeshBuilder } from '../art/Geo.js?v=20260921163240';
import { buildStick } from '../art/StickGen.js?v=20260921163240';
import { buildWeapon } from '../art/WeaponArt.js?v=20260921163240';
import { MATS } from '../art/Materials.js?v=20260921163240';

import { stickBlurb, stickValue, SPECIES as WOOD } from '../data/StickData.js?v=20260921163240';
import { RARITY } from '../art/Palette.js?v=20260921163240';
import { ic } from './Icons.js?v=20260921163240';
import { makeScreen, stickRow, stickDetail } from './UI.js?v=20260921163240';
import { esc, clamp, clamp01, damp, TAU } from '../core/Util.js?v=20260921163240';

/* ========================================================================= */
/* A REUSABLE TURNTABLE                                                      */
/* ========================================================================= */

/**
 * A tiny 3D viewport that shows one generated object, slowly turning. Shared
 * by the satchel and the workshop.
 */
export class Turntable {
  /**
   * It owns its own small renderer and canvas. Sharing the game's renderer
   * and scissoring a rectangle out of the main canvas does not work here:
   * the screens are opaque DOM panels sitting ON TOP of that canvas, so
   * there is nothing to show through. A second, tiny WebGL context is the
   * simple answer and costs almost nothing at 380×300.
   */
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tt-canvas';
    this.renderer = null;          // created on first attach, lazily
    this.slot = null;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 40);
    const key = new THREE.DirectionalLight(0xfff0d8, 2.5);
    key.position.set(2.2, 3.4, 2.8);
    const rim = new THREE.DirectionalLight(0xa8c8ff, 1.0);
    rim.position.set(-2.6, 1.2, -2.2);
    const amb = new THREE.HemisphereLight(0x9ab4d8, 0x4a4030, 1.0);
    this.scene.add(key, rim, amb);
    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);
    this.t = 0;
    this.meshes = [];
    this.radius = 1;
    this.centre = new THREE.Vector3();
    this.userYaw = 0;
    this.dragging = false;
  }

  clear() {
    for (const m of this.meshes) { this.pivot.remove(m); m.geometry.dispose(); }
    this.meshes.length = 0;
  }

  /** Show a stick. */
  showStick(spec) {
    this.clear();
    if (!spec) return;
    const b = new MeshBuilder(), g = new MeshBuilder();
    buildStick(spec, b, { lod: 0, glow: g });
    this._add(b.build({ flat: false }), MATS.item);
    if (!g.isEmpty) this._add(g.build({ flat: false }), MATS.glow);
    this._frame();
  }

  /** Show a finished weapon. */
  showWeapon(weapon) {
    this.clear();
    if (!weapon || !weapon.design || !weapon.stick) return;
    const glow = new MeshBuilder();
    const out = buildWeapon(weapon, { lod: 0, glow });
    this._add(out.builder.build({ flat: false }), MATS.item);
    if (!glow.isEmpty) this._add(glow.build({ flat: false }), MATS.glow);
    this._frame();
  }

  _add(geo, mat) {
    const m = new THREE.Mesh(geo, mat);
    this.pivot.add(m);
    this.meshes.push(m);
  }

  _frame() {
    const box = new THREE.Box3();
    for (const m of this.meshes) { m.geometry.computeBoundingBox(); box.expandByObject(m); }
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    // re-centre the geometry on the pivot so it turns about itself and does
    // not swing around the origin like a hammer thrower
    for (const m of this.meshes) m.position.sub(c);
    this.radius = Math.max(0.12, size.length() * 0.5);
    this.centre.set(0, 0, 0);
  }

  /** Put the viewport into whichever `.tt-slot` is currently on screen. */
  attach(slotEl) {
    this.slot = slotEl || null;
    if (!this.slot) return;
    if (!this.renderer) {
      try {
        this.renderer = new THREE.WebGLRenderer({
          canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'low-power',
        });
        this.renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
      } catch (e) {
        console.warn('[turntable] no second WebGL context available', e);
        this.renderer = null;
        return;
      }
    }
    if (this.canvas.parentElement !== this.slot) this.slot.appendChild(this.canvas);
  }

  render(dt) {
    if (!this.renderer || !this.slot || !this.meshes.length) return false;
    const w = this.slot.clientWidth, h = this.slot.clientHeight;
    if (w < 8 || h < 8) return false;
    this.t += dt;
    this.pivot.rotation.y = this.userYaw + (this.dragging ? 0 : this.t * 0.32);
    this.pivot.rotation.z = Math.sin(this.t * 0.21) * 0.06;
    this.camera.aspect = Math.max(0.2, w / h);
    const d = this.radius / Math.tan((this.camera.fov * Math.PI) / 360) * 1.25;
    this.camera.position.set(0, this.radius * 0.18, d);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.renderer.render(this.scene, this.camera);
    return true;
  }
}

/* ========================================================================= */
/* THE SCREEN                                                                */
/* ========================================================================= */

export class SatchelScreen {
  constructor(state, ui, turntable) {
    this.state = state;
    this.ui = ui;
    this.tt = turntable;
    this.tab = 'sticks';
    this.sel = null;
    this.closeKey = 'KeyQ';

    this.el = makeScreen('Satchel', '<div class="sat"></div>', { wide: true, kicker: 'what you are carrying' });
    this.el.querySelector('.x').onclick = () => ui.pop();
    this.el.addEventListener('click', e => { if (e.target === this.el) ui.pop(); });
    this.body = this.el.querySelector('.sat');
    this.render();
  }

  onOpen() {
    this.tt.clear();
    if (this.state.sticks.length) this.pick(this.state.sticks[0].uid);
    else if (this.state.weapons.length) { this.tab = 'weapons'; this.pick(this.state.weapons[0].uid); }
    this.render();
  }
  onClose() { this.tt.clear(); }

  pick(uid) {
    this.sel = uid;
    if (this.tab === 'sticks') {
      this.tt.showStick(this.state.stickById(uid));
    } else {
      const w = this.state.weaponById(uid);
      if (w) this.tt.showWeapon(w);
    }
    this.render();
  }

  render() {
    const S = this.state;
    const sticks = S.sticks;
    const weapons = S.weapons;
    const isSticks = this.tab === 'sticks';
    const list = isSticks ? sticks : weapons;

    this.body.innerHTML = `
      <div class="tabs">
        <button class="tab${isSticks ? ' on' : ''}" data-tab="sticks">${ic('stick')} Wood <b>${sticks.length}</b><i>/${S.capacity}</i></button>
        <button class="tab${!isSticks ? ' on' : ''}" data-tab="weapons">${ic('sword')} Made <b>${weapons.length}</b></button>
      </div>
      <div class="sat-cols">
        <div class="sat-list">
          ${list.length ? list.map(x => isSticks
      ? stickRow(x, { selected: x.uid === this.sel })
      : this._weaponRow(x)).join('')
        : `<p class="empty">${isSticks
          ? 'Nothing yet. The wood is full of fallen branches — walk out past the fences and look down.'
          : 'Nothing made yet. Take wood to Old Nissel at the workshop.'}</p>`}
        </div>
        <div class="sat-view">
          <div class="tt-slot" id="tt-slot"></div>
          ${isSticks ? stickDetail(S.stickById(this.sel)) : this._weaponDetail(S.weaponById(this.sel))}
          <div class="sat-actions">${this._actions()}</div>
        </div>
      </div>`;

    this.body.querySelectorAll('.tab').forEach(b => {
      b.onclick = () => {
        this.tab = b.dataset.tab;
        const l = this.tab === 'sticks' ? S.sticks : S.weapons;
        this.sel = l.length ? l[0].uid : null;
        this.pick(this.sel);
      };
    });
    this.body.querySelectorAll('.row').forEach(b => {
      b.onclick = () => this.pick(Number(b.dataset.uid));
    });
    const drop = this.body.querySelector('#act-drop');
    if (drop) drop.onclick = () => {
      S.dropStick(this.sel);
      const l = S.sticks;
      this.sel = l.length ? l[0].uid : null;
      this.pick(this.sel);
    };
    // The viewport is re-attached here rather than by the caller: every
    // render() rebuilds the slot element, so anything that holds on to the
    // old one is holding a node that is no longer in the page.
    this.tt.attach(this.body.querySelector('#tt-slot'));

    const eq = this.body.querySelector('#act-equip');
    if (eq) eq.onclick = () => {
      if (S.equipped === this.sel) S.unequip(); else S.equip(this.sel);
      this.render();
    };
  }

  _actions() {
    const S = this.state;
    if (this.tab === 'sticks') {
      if (!this.sel) return '';
      return `<button class="btn ghost" id="act-drop">${ic('minus')} Put it back</button>`;
    }
    if (!this.sel) return '';
    const on = S.equipped === this.sel;
    return `<button class="btn${on ? ' on' : ''}" id="act-equip">${ic(on ? 'check' : 'paw')} ${on ? 'Carrying' : 'Carry this'}</button>`;
  }

  _weaponRow(w) {
    const t = clamp(w.tier ?? w.stats?.tier ?? 0, 0, RARITY.length - 1);
    const R = RARITY[t];
    const on = this.state.equipped === w.uid;
    return `<button class="row stick-row${w.uid === this.sel ? ' sel' : ''}" data-uid="${w.uid}">
      <span class="swatch" style="--c:${R.css}">${ic('sword')}</span>
      <span class="row-main">
        <b style="color:${t >= 2 ? R.css : 'inherit'}">${esc(w.name)}</b>
        <i>${esc(w.label || w.cls)} · ${R.name} · ${w.stats.length.toFixed(2)} m</i>
      </span>
      <span class="row-tags">${on ? `<em class="lit">carried</em>` : ''}</span>
    </button>`;
  }

  _weaponDetail(w) {
    if (!w) return '<div class="detail empty">Nothing selected.</div>';
    const t = clamp(w.tier ?? w.stats?.tier ?? 0, 0, RARITY.length - 1);
    const R = RARITY[t];
    const st = w.stats;
    const src = w.stick;
    /* Bars rather than bare numbers. "bite 31" tells the player nothing on
       its own; a bar tells them where this weapon sits against every other
       weapon they could be holding, which is the only question they have. */
    const bar = (label, v, max) => `<div class="stat">
      <span>${label}</span>
      <em style="--w:${clamp(v / max, 0, 1) * 100}%"></em>
      <b>${typeof v === 'number' ? (v < 10 ? v.toFixed(2) : Math.round(v)) : v}</b>
    </div>`;
    return `<div class="detail">
      <h3 style="color:${R.css}">${esc(w.name)}</h3>
      <p class="kind"><span style="color:${R.css}">${esc(R.name)}</span> · ${esc(w.label || w.cls)}
        · ${st.hands === 2 ? 'two hands' : 'one hand'}</p>
      ${w.blurb ? `<p class="blurb">&ldquo;${esc(w.blurb)}&rdquo;</p>` : ''}
      <div class="stats">
        ${bar('damage', st.bite, 60)}
        ${bar('speed', st.speed, 3)}
        ${bar('reach', st.reach, 3.2)}
        ${bar('heft', st.heft, 6)}
      </div>
      ${w.traits?.length ? `<ul class="traits">${w.traits.map(tr =>
        `<li><b>${esc(tr.label)}</b><i>${esc(tr.note)}</i></li>`).join('')}</ul>` : ''}
      <dl>
        <dt>length</dt><dd>${st.length.toFixed(2)} m</dd>
        <dt>wood</dt><dd>${esc(st.material)}</dd>
        ${st.special ? `<dt>material</dt><dd>${esc(st.special)}</dd>` : ''}
      </dl>
      ${src ? `<p class="made">from <em>${esc(src.name)}</em> —
        ${src.length.toFixed(2)} m, ${(src.thick * 200).toFixed(0)} mm across,
        ${src.parts?.length || 0} notable ${(src.parts?.length || 0) === 1 ? 'feature' : 'features'}</p>` : ''}
    </div>`;
  }
}
