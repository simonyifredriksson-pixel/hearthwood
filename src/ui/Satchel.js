/* Satchel.js — what you are carrying.
   ===========================================================================
   Four categories — the creel, the wood, the weapons and the rods — with a
   live 3D view of whatever is selected. The 3D view is the point: a stick's
   name and its numbers tell you almost nothing compared to turning the
   actual object over and seeing that it has three little brackets growing
   out of one side, and a fish's name tells you nothing at all compared to
   seeing that this one is white and has two tails.

   WHY ONE SCREEN AND NOT FOUR. Everything here answers the same two
   questions — what have I got, and what is it worth — and a player who has
   to remember that fish live behind C and rods behind R is a player who
   has been given filing rather than an inventory. One screen, one key, a
   row of tabs, and the sort control applies to all of them.
*/

import * as THREE from '../../lib/three.module.js?v=1790014463';
import { MeshBuilder } from '../art/Geo.js?v=1790014463';
import { buildStick } from '../art/StickGen.js?v=1790014463';
import { buildWeapon } from '../art/WeaponArt.js?v=1790014463';
import { buildFish } from '../art/FishArt.js?v=1790014463';
import { buildRod } from '../art/RodArt.js?v=1790014463';
import { MATS } from '../art/Materials.js?v=1790014463';

import { stickBlurb, stickValue, SPECIES as WOOD } from '../data/StickData.js?v=1790014463';
import {
  catchValue, fishTitle, rarityOf, MUTATION_BY_ID, FISH,
} from '../data/FishData.js';
import { RODS, ROD_STATS, rodOf } from '../data/RodData.js?v=1790014463';
import { VILLAGE_BY_ID } from '../data/VillageData.js?v=1790014463';
import { RARITY, onPaper } from '../art/Palette.js?v=1790014463';
import { ic } from './Icons.js?v=1790014463';
import { makeScreen, stickRow, stickDetail } from './UI.js?v=1790014463';
import { esc, clamp, clamp01, damp, TAU } from '../core/Util.js?v=1790014463';

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

  /**
   * Show a caught fish.
   *
   * THE SAME MESH THE WATER GAVE YOU. It would be much easier to draw a
   * fish icon in the inventory, and it would also throw away the entire
   * reason the fish are generated: an Albino Gulper is only worth four
   * times as much if you can SEE that it is white and enormous. The art
   * builder takes the catch record straight, so the thing turning in the
   * panel is the thing that was on the end of the line, mutation and all.
   */
  showFish(f) {
    this.clear();
    if (!f) return;
    const out = buildFish(f, { lod: 0 });
    this._add(out.builder.build({ flat: false }), MATS.item);
    if (!out.glow.isEmpty) this._add(out.glow.build({ flat: false }), MATS.glow);
    this._frame();
  }

  /** Show a rod, owned or merely coveted. */
  showRod(rod) {
    this.clear();
    if (!rod) return;
    const out = buildRod(rod, { lod: 0 });
    this._add(out.builder.build({ flat: false }), MATS.item);
    if (!out.glow.isEmpty) this._add(out.glow.build({ flat: false }), MATS.glow);
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

/* --- PLAIN WORDS FOR NUMBERS --------------------------------------------
   The generator thinks in 0..1. Nobody else does. "depth 0.82" is a debug
   readout; "deep down" is a fact about a fish. */
const DEPTH_WORD = d =>
  d == null ? 'anywhere' : d < 0.2 ? 'right at the surface' : d < 0.45 ? 'in the shallows'
    : d < 0.7 ? 'mid-water' : d < 0.88 ? 'deep down' : 'on the bottom';

const FIGHT_WORD = f =>
  f == null ? 'unknown' : f < 0.5 ? 'comes in easily' : f < 0.75 ? 'puts up a fight'
    : f < 0.9 ? 'hard work' : 'a battle';

const VILLAGE_NAME = id => VILLAGE_BY_ID[id]?.name || 'a fishing booth';

/* Rarity colours are picked to glow on a dark HUD. This whole screen is
   parchment, so every one of them goes through onPaper first: INK for
   text, CHIP for the little swatch, which can afford to be lighter
   because it carries a tinted background of its own. */
const INK = c => onPaper(c, 0.20);
const CHIP = c => onPaper(c, 0.34);

/* --- THE TABS ------------------------------------------------------------
   Order is deliberate: the creel first, because FISH N STICKS is a fishing
   game and the creel is the one that changes every minute. */
const TABS = [
  { id: 'fish', icon: 'fish', label: 'Creel' },
  { id: 'sticks', icon: 'stick', label: 'Wood' },
  { id: 'weapons', icon: 'sword', label: 'Made' },
  { id: 'rods', icon: 'rod', label: 'Rods' },
];

/* --- SORTING -------------------------------------------------------------
   One vocabulary across all four tabs. Not every key means something in
   every tab — a rod has no length worth sorting on — so each tab declares
   which of them it offers and the control only ever shows those. A sort
   menu with four greyed-out entries is a menu that lies about what it can
   do. */
const SORTS = {
  found: { label: 'Newest', of: () => 0 },              // list order, reversed
  value: { label: 'Worth', of: (x, ctx) => ctx.value(x) },
  rarity: { label: 'Rarity', of: (x, ctx) => ctx.rank(x) },
  size: { label: 'Size', of: (x) => x.len ?? x.length ?? x.stats?.length ?? 0 },
  name: { label: 'Name', of: () => 0, alpha: true },
};

export class SatchelScreen {
  constructor(state, ui, turntable) {
    this.state = state;
    this.ui = ui;
    this.tt = turntable;
    this.tab = 'fish';
    this.sel = null;
    this.sort = 'found';
    this.closeKey = 'KeyQ';
    /* Rows animate in on a stagger, but ONLY when the list actually
       changes — re-rendering after a click used to replay the whole
       cascade, which made selecting a fish feel like the screen had
       been reopened. */
    this._lastSig = '';
    this._flash = null;

    this.el = makeScreen('Satchel', '<div class="sat"></div>', { wide: true, kicker: 'what you are carrying' });
    this.el.querySelector('.x').onclick = () => ui.pop();
    this.el.addEventListener('click', e => { if (e.target === this.el) ui.pop(); });
    this.body = this.el.querySelector('.sat');
    this.render();
  }

  onOpen() {
    this.tt.clear();
    /* Open on whichever tab has something in it, in tab order, so a new
       player does not land on an empty creel and conclude the game is
       broken. */
    const S = this.state;
    const first = TABS.find(t => this._listFor(t.id).length) || TABS[0];
    this.tab = first.id;
    this._lastSig = '';
    const l = this._sorted();
    this.pick(l.length ? this._uid(l[0]) : null);
  }
  onClose() { this.tt.clear(); }

  /* ====================================================================== */
  /* THE FOUR LISTS                                                         */
  /* ====================================================================== */

  /** Every category is a plain array; the rods tab lists the CATALOGUE, not
   *  the ones you own, so the panel doubles as the thing you plan against. */
  _listFor(tab) {
    const S = this.state;
    if (tab === 'fish') return S.fish;
    if (tab === 'sticks') return S.sticks;
    if (tab === 'weapons') return S.weapons;
    return RODS.filter(r => S.ownsRod(r.id) || r.tier <= this._rodTier() + 1);
  }

  /** How far up the rod ladder you have climbed — you can see one rung past
   *  the best you own, and no further, so the list is a next step and not a
   *  spoiler for the endgame. */
  _rodTier() {
    let t = 0;
    for (const id of this.state.rods) t = Math.max(t, rodOf(id).tier);
    return t;
  }

  /** The uid a row is keyed by. Rods have string ids; everything else has a
   *  numeric uid, and the two must never be compared with ===. */
  _uid(x) { return this.tab === 'rods' ? x.id : x.uid; }

  _byUid(uid) {
    return this._listFor(this.tab).find(x => this._uid(x) === uid) || null;
  }

  /** Which sort keys this tab actually offers. */
  _sortKeys() {
    if (this.tab === 'fish') return ['found', 'value', 'rarity', 'size', 'name'];
    if (this.tab === 'sticks') return ['found', 'value', 'rarity', 'size', 'name'];
    if (this.tab === 'weapons') return ['found', 'rarity', 'size', 'name'];
    return ['value', 'name'];
  }

  /** Worth, in coin, of one row — the number the sort and the footer use. */
  _value(x) {
    if (this.tab === 'fish') return catchValue(x);
    if (this.tab === 'sticks') return stickValue(x);
    if (this.tab === 'rods') return x.price;
    return Math.round((x.stats?.bite || 0) * 3);   // weapons are not for sale
  }

  /** A comparable rarity rank. Fish run 0..8, everything else 0..6, so this
   *  is only ever compared WITHIN a tab. */
  _rank(x) {
    if (this.tab === 'fish') return rarityOf(x.rarity).index;
    if (this.tab === 'rods') return x.tier;
    return clamp(x.tier ?? x.stats?.tier ?? 0, 0, RARITY.length - 1);
  }

  _name(x) {
    if (this.tab === 'fish') return fishTitle(x);
    return x.name || '';
  }

  _sorted() {
    const list = this._listFor(this.tab).slice();
    const key = this._sortKeys().includes(this.sort) ? this.sort : this._sortKeys()[0];
    const S = SORTS[key];
    const ctx = { value: x => this._value(x), rank: x => this._rank(x) };

    if (key === 'found') return list.reverse();        // newest first

    /* FAVOURITES FLOAT, and they float under EVERY sort — including the
       alphabetical one, which used to have its own early return and so
       quietly buried a starred fish under the letter A. If starring means
       "keep this where I can see it" then it cannot mean that under four
       sorts out of five. */
    const fav = (a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0);
    if (S.alpha) return list.sort((a, b) => fav(a, b) || this._name(a).localeCompare(this._name(b)));
    /* Rods ASCEND. Everywhere else the best thing goes on top, because the
       question is "what have I got"; the rod list is a ladder and the
       question is "what is next", so it reads bottom-rung upward and the
       one you cannot afford yet sits at the end where it belongs. */
    const dir = this.tab === 'rods' ? -1 : 1;
    return list.sort((a, b) => fav(a, b) || dir * (S.of(b, ctx) - S.of(a, ctx)));
  }

  /* ====================================================================== */
  /* SELECTION                                                              */
  /* ====================================================================== */

  pick(uid) {
    this.sel = uid;
    const x = this._byUid(uid);
    if (!x) this.tt.clear();
    else if (this.tab === 'fish') this.tt.showFish(x);
    else if (this.tab === 'sticks') this.tt.showStick(x);
    else if (this.tab === 'weapons') this.tt.showWeapon(x);
    else this.tt.showRod(x);
    this.render();
  }

  _goTab(id) {
    if (this.tab === id) return;
    this.tab = id;
    this._lastSig = '';
    const l = this._sorted();
    this.pick(l.length ? this._uid(l[0]) : null);
  }

  /* ====================================================================== */
  /* RENDER                                                                 */
  /* ====================================================================== */

  render() {
    const S = this.state;
    const list = this._sorted();
    const sig = `${this.tab}|${this.sort}|${list.map(x => this._uid(x)).join(',')}`;
    const fresh = sig !== this._lastSig;     // only cascade when the list moved
    this._lastSig = sig;

    this.body.innerHTML = `
      <div class="tabs">
        ${TABS.map(t => {
      const n = this._listFor(t.id).length;
      const cap = t.id === 'sticks' ? `<i>/${S.capacity}</i>`
        : t.id === 'rods' ? `<i>/${RODS.length}</i>` : '';
      return `<button class="tab${this.tab === t.id ? ' on' : ''}" data-tab="${t.id}">
          ${ic(t.icon)} ${t.label} <b>${n}</b>${cap}</button>`;
    }).join('')}
        <span class="tab-gap"></span>
        <span class="purse" title="what is in the purse">${ic('coin')} <b>${S.coin.toLocaleString()}</b></span>
      </div>

      <div class="sat-bar">
        <span class="sat-sum">${this._summary()}</span>
        <span class="sat-sort">${ic('sort')}
          ${this._sortKeys().map(k =>
      `<button class="sk${this.sort === k ? ' on' : ''}" data-sort="${k}">${SORTS[k].label}</button>`).join('')}
        </span>
      </div>

      <div class="sat-cols">
        <div class="sat-list${fresh ? ' cascade' : ''}">
          ${list.length ? list.map((x, i) => this._row(x, i)).join('') : this._emptyNote()}
        </div>
        <div class="sat-view">
          <div class="tt-slot" id="tt-slot"></div>
          ${this._detail()}
          <div class="sat-actions">${this._actions()}</div>
        </div>
      </div>`;

    this._wire();
  }

  _wire() {
    const S = this.state;
    this.body.querySelectorAll('.tab').forEach(b => {
      b.onclick = () => this._goTab(b.dataset.tab);
    });
    this.body.querySelectorAll('.sk').forEach(b => {
      b.onclick = () => { this.sort = b.dataset.sort; this._lastSig = ''; this.render(); };
    });
    this.body.querySelectorAll('.row').forEach(b => {
      const uid = this.tab === 'rods' ? b.dataset.uid : Number(b.dataset.uid);
      b.onclick = () => this.pick(uid);
      /* RIGHT-CLICK TO STAR, the same gesture as the hotbar. Two places
         that do the same thing should do it the same way, and a player
         who learned it on the hotbar should not have to learn it twice. */
      if (this.tab === 'fish') b.oncontextmenu = e => {
        e.preventDefault();
        S.toggleFavourite(uid);
        this._lastSig = '';           // favourites float, so the list moves
        this.render();
      };
    });
    // The viewport is re-attached here rather than by the caller: every
    // render() rebuilds the slot element, so anything that holds on to the
    // old one is holding a node that is no longer in the page.
    this.tt.attach(this.body.querySelector('#tt-slot'));

    const on = (id, fn) => { const b = this.body.querySelector(id); if (b) b.onclick = fn; };

    on('#act-equip', () => {
      if (S.equipped === this.sel) S.unequip(); else S.equip(this.sel);
      this.render();
    });
    on('#act-drop', () => {
      S.dropStick(this.sel);
      const l = this._sorted();
      this._lastSig = '';
      this.pick(l.length ? this._uid(l[0]) : null);
    });
    on('#act-fav', () => {
      S.toggleFavourite(this.sel);
      this._lastSig = '';
      this.render();
    });
    on('#act-release', () => {
      /* dropFish already refuses a favourite; the button is hidden in that
         case too, but the guard is what makes it true */
      S.dropFish(this.sel);
      const l = this._sorted();
      this._lastSig = '';
      this.pick(l.length ? this._uid(l[0]) : null);
    });
    on('#act-rod', () => { S.equipRod(this.sel); this.render(); });
  }

  /** The line under the tabs: how much this category is worth, and the one
   *  caveat that matters (how much of the creel is off limits). */
  _summary() {
    const S = this.state;
    if (this.tab === 'fish') {
      const n = S.fish.length, starred = n - S.sellableCount;
      if (!n) return 'The creel is empty.';
      return `<b>${n}</b> in the creel, worth <b class="coin">${S.creelValue.toLocaleString()}</b>`
        + (starred ? ` &middot; <em class="fav">${starred} kept back</em>` : '');
    }
    if (this.tab === 'sticks') {
      if (!S.sticks.length) return 'The satchel is empty.';
      return `<b>${S.sticks.length}</b> of <b>${S.capacity}</b>, worth <b class="coin">${S.satchelValue.toLocaleString()}</b>`;
    }
    if (this.tab === 'weapons') {
      if (!S.weapons.length) return 'Nothing made yet.';
      const best = S.weapons.reduce((a, w) => this._rank(w) > this._rank(a) ? w : a);
      return `<b>${S.weapons.length}</b> made &middot; finest is <b>${esc(best.name)}</b>`;
    }
    return `<b>${S.rods.length}</b> of <b>${RODS.length}</b> rods &middot; carrying <b>${esc(S.currentRod.name)}</b>`;
  }

  _emptyNote() {
    const notes = {
      fish: 'Nothing in the creel. Take the rod out with <kbd>R</kbd> and find any water — every lake in the wood has something in it.',
      sticks: 'Nothing yet. The wood is full of fallen branches — walk out past the fences and look down.',
      weapons: 'Nothing made yet. Take wood to the Stickwright at the workshop.',
      rods: 'No rods. Any Fisherman will sell you one.',
    };
    return `<p class="empty">${notes[this.tab]}</p>`;
  }

  _row(x, i) {
    /* The stagger is a CSS custom property rather than a per-row animation,
       and it stops counting at twelve: a creel of sixty fish should not take
       three seconds to finish arriving. */
    const d = `style="--i:${Math.min(i, 12)}"`;
    if (this.tab === 'fish') return this._fishRow(x, d);
    if (this.tab === 'sticks') return stickRow(x, { selected: x.uid === this.sel })
      .replace('<button ', `<button ${d} `);
    if (this.tab === 'weapons') return this._weaponRow(x, d);
    return this._rodRow(x, d);
  }

  _detail() {
    const x = this._byUid(this.sel);
    if (this.tab === 'fish') return this._fishDetail(x);
    if (this.tab === 'sticks') return stickDetail(x);
    if (this.tab === 'weapons') return this._weaponDetail(x);
    return this._rodDetail(x);
  }

  _actions() {
    const S = this.state;
    const x = this._byUid(this.sel);
    if (!x) return '';

    if (this.tab === 'fish') {
      return `<button class="btn${x.fav ? ' on' : ''}" id="act-fav">${ic('star')} ${x.fav ? 'Kept back' : 'Keep this one'}</button>`
        + (x.fav ? '' : `<button class="btn ghost" id="act-release">${ic('drop')} Put it back</button>`);
    }
    if (this.tab === 'sticks') {
      return `<button class="btn ghost" id="act-drop">${ic('minus')} Put it back</button>`;
    }
    if (this.tab === 'weapons') {
      const on = S.equipped === x.uid;
      return `<button class="btn${on ? ' on' : ''}" id="act-equip">${ic(on ? 'check' : 'paw')} ${on ? 'Carrying' : 'Carry this'}</button>`;
    }
    if (!S.ownsRod(x.id)) {
      /* The panel above already says the price and where. What this line
         adds is the only thing the price does not: whether the purse can
         stand it today, and how far off it is if not. */
      const short = x.price - S.coin;
      return short <= 0
        ? `<p class="act-note can">${ic('coin')} You can afford this one.</p>`
        : `<p class="act-note">${ic('coin')} ${short.toLocaleString()} more to go.</p>`;
    }
    const on = S.rod === x.id;
    return `<button class="btn${on ? ' on' : ''}" id="act-rod">${ic(on ? 'check' : 'rod')} ${on ? 'In the creel bag' : 'Use this rod'}</button>`;
  }

  /* ====================================================================== */
  /* FISH                                                                   */
  /* ====================================================================== */

  _fishRow(f, d) {
    const R = rarityOf(f.rarity);
    const M = f.mutation ? MUTATION_BY_ID[f.mutation] : null;
    const v = catchValue(f);
    return `<button ${d} class="row fish-row${f.uid === this.sel ? ' sel' : ''}${f.fav ? ' fav' : ''}" data-uid="${f.uid}">
      <span class="swatch" style="--c:${CHIP(R.css)}">${ic('fish')}</span>
      <span class="row-main">
        <b style="color:${INK(R.css)}">${esc(fishTitle(f))}</b>
        <i>${esc(R.name)} &middot; ${f.len.toFixed(2)} m${M ? ` &middot; <u style="color:${INK(M.css || R.css)}">${esc(M.name)}</u>` : ''}</i>
      </span>
      <span class="row-tags">
        ${f.fav ? `<em class="star" title="kept back — cannot be sold">${ic('star')}</em>` : ''}
        <em class="coin">${v.toLocaleString()}</em>
      </span>
    </button>`;
  }

  _fishDetail(f) {
    if (!f) return '<div class="detail empty">Nothing selected.</div>';
    const R = rarityOf(f.rarity);
    const M = f.mutation ? MUTATION_BY_ID[f.mutation] : null;
    const spec = FISH[f.id];
    const v = catchValue(f);
    /* WHERE THE MONEY COMES FROM, spelled out. A player looking at a fish
       worth 4,800 wants to know which part of it was the 4,800 — otherwise
       the number is a slot machine and there is nothing to learn. */
    const base = spec ? Math.round(v / (R.mult * (M?.mult || 1))) : null;
    const size = clamp01(f.size ?? 0.5);
    const grade = size > 0.92 ? 'a monster of its kind' : size > 0.72 ? 'a big one'
      : size > 0.34 ? 'about average' : size > 0.12 ? 'on the small side' : 'a tiddler';

    return `<div class="detail">
      <h3 style="color:${INK(R.css)}">${esc(fishTitle(f))}</h3>
      <p class="kind"><span style="color:${INK(R.css)}">${esc(R.name)}</span>
        ${M ? ` &middot; <span style="color:${INK(M.css || R.css)}">${esc(M.name)}</span>` : ''}
        ${f.fav ? ` &middot; <span class="fav">kept back</span>` : ''}</p>
      ${M ? `<p class="blurb">&ldquo;${esc(M.desc)}&rdquo;</p>`
        : spec?.blurb ? `<p class="blurb">&ldquo;${esc(spec.blurb)}&rdquo;</p>` : ''}

      <div class="measures">
        <span><b>${f.len.toFixed(2)} m</b><i>length</i></span>
        <span><b>${esc(grade)}</b><i>for the species</i></span>
        ${spec ? `<span><b>${esc(DEPTH_WORD(spec.depth))}</b><i>sits</i></span>` : ''}
        ${spec ? `<span><b>${esc(FIGHT_WORD(spec.fight))}</b><i>on the line</i></span>` : ''}
      </div>

      <div class="worth">
        <span class="worth-big">${ic('coin')}<b>${v.toLocaleString()}</b></span>
        <ul class="worth-parts">
          ${base != null ? `<li><i>base</i><b>${base.toLocaleString()}</b></li>` : ''}
          <li><i>${esc(R.name)}</i><b>&times;${R.mult}</b></li>
          ${M ? `<li><i>${esc(M.name)}</i><b>&times;${M.mult}</b></li>` : ''}
        </ul>
      </div>
      ${f.fav ? `<p class="made fav-note">${ic('star')} Starred. No fisherman will take this one, and
        <em>sell everything</em> will step around it.</p>` : ''}
    </div>`;
  }

  /* ====================================================================== */
  /* RODS                                                                   */
  /* ====================================================================== */

  _rodRow(r, d) {
    const S = this.state;
    const owned = S.ownsRod(r.id);
    const held = S.rod === r.id;
    const R = RARITY[clamp(r.tier, 0, RARITY.length - 1)];
    return `<button ${d} class="row rod-row${r.id === this.sel ? ' sel' : ''}${owned ? '' : ' locked'}" data-uid="${r.id}">
      <span class="swatch" style="--c:${CHIP(R.css)}">${ic('rod')}</span>
      <span class="row-main">
        <b style="color:${INK(R.css)}">${esc(r.name)}</b>
        <i>${owned ? (held ? 'in the creel bag' : 'owned') : `${r.price.toLocaleString()} coin`}</i>
      </span>
      <span class="row-tags">${held ? `<em class="lit">${ic('check')}</em>` : ''}</span>
    </button>`;
  }

  _rodDetail(r) {
    if (!r) return '<div class="detail empty">Nothing selected.</div>';
    const S = this.state;
    const cur = S.currentRod;
    const R = RARITY[clamp(r.tier, 0, RARITY.length - 1)];
    const owned = S.ownsRod(r.id);
    /* AGAINST WHAT YOU ARE HOLDING, not in the abstract. The only question
       a rod raises is "is this better than mine", so the bars carry the
       delta and the numbers are never shown alone. */
    const bar = (st) => {
      const v = r[st.key] ?? 0, c = cur[st.key] ?? 0;
      const dv = v - c;
      const max = Math.max(1, v, c) * 1.15;
      const same = r.id === S.rod;
      return `<div class="stat rod-stat${same ? ' same' : ''}" title="${esc(st.hint)}">
        <span>${esc(st.label)}</span>
        <em style="--w:${clamp01(v / max) * 100}%;--now:${clamp01(c / max) * 100}%"></em>
        <b class="${dv > 0.001 ? 'up' : dv < -0.001 ? 'down' : ''}">${
        r.id === S.rod ? '—' : dv > 0.001 ? `+${dv.toFixed(2)}` : dv < -0.001 ? dv.toFixed(2) : '='}</b>
      </div>`;
    };
    return `<div class="detail">
      <h3 style="color:${INK(R.css)}">${esc(r.name)}</h3>
      <p class="kind"><span style="color:${INK(R.css)}">${esc(R.name)}</span>
        &middot; ${owned ? (S.rod === r.id ? 'carrying this one' : 'owned') : 'not yet yours'}</p>
      ${r.blurb ? `<p class="blurb">&ldquo;${esc(r.blurb)}&rdquo;</p>` : ''}
      <div class="stats">${ROD_STATS.map(bar).join('')}</div>
      ${owned ? '' : `<p class="made">Sold by the Fisherman at
        <em>${esc(VILLAGE_NAME(r.at))}</em> for <b class="coin">${r.price.toLocaleString()}</b>.</p>`}
    </div>`;
  }

  /* ====================================================================== */
  /* WEAPONS                                                                */
  /* ====================================================================== */

  _weaponRow(w, d = '') {
    const t = clamp(w.tier ?? w.stats?.tier ?? 0, 0, RARITY.length - 1);
    const R = RARITY[t];
    const on = this.state.equipped === w.uid;
    return `<button ${d} class="row stick-row${w.uid === this.sel ? ' sel' : ''}" data-uid="${w.uid}">
      <span class="swatch" style="--c:${CHIP(R.css)}">${ic('sword')}</span>
      <span class="row-main">
        <b style="color:${INK(R.css)}">${esc(w.name)}</b>
        <i>${esc(w.label || w.cls)} &middot; ${esc(R.name)} &middot; ${w.stats.length.toFixed(2)} m</i>
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
      <h3 style="color:${INK(R.css)}">${esc(w.name)}</h3>
      <p class="kind"><span style="color:${INK(R.css)}">${esc(R.name)}</span> · ${esc(w.label || w.cls)}
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
