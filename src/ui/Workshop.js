/* Workshop.js — Old Nissel's bench.
   ===========================================================================
   The crafting screen. Three columns: what she can make, what it needs, and
   a live view of what you are about to get — built from YOUR wood, before
   you commit to it.

   THE PREVIEW IS THE WHOLE DESIGN. Every other crafting screen ever made
   shows you an icon and a stat line; this one shows you the actual object,
   generated from the actual sticks in the slots, turning. Swap the stick and
   the preview changes, because it is the same generator the finished weapon
   will use. That is what makes bringing back an unusual branch feel like it
   mattered.
*/

import { RECIPES, RECIPE_BY_ID, slotAccepts, autoFill, weaponStats, weaponName, recipeNeedText, WEAPON_CLASSES } from '../data/WeaponData.js';
import { stickBlurb } from '../data/StickData.js';
import { RARITY } from '../art/Palette.js';
import { ic } from './Icons.js';
import { makeScreen, stickRow } from './UI.js';
import { esc, clamp, clamp01 } from '../core/Util.js';

export class WorkshopScreen {
  constructor(state, ui, turntable, { onCraft = null, audio = null } = {}) {
    this.state = state;
    this.ui = ui;
    this.tt = turntable;
    this.onCraft = onCraft;
    this.audio = audio;
    this.recipe = null;
    this.slots = [];              // stick uids, one per recipe slot
    this.pickingSlot = -1;
    this.closeKey = 'KeyQ';

    this.el = makeScreen("The Stickwright's Bench", '<div class="shop"></div>', {
      wide: true, kicker: 'Old Nissel, who has done this a very long time',
    });
    this.el.querySelector('.x').onclick = () => ui.pop();
    this.el.addEventListener('click', e => { if (e.target === this.el) ui.pop(); });
    this.body = this.el.querySelector('.shop');
    this.render();
  }

  onOpen() {
    this.tt.clear();
    const first = this._sorted()[0];
    if (first) this.select(first.rec);
    else this.render();
  }
  onClose() { this.tt.clear(); }

  /* ====================================================================== */

  /** Every recipe, with whether the satchel can currently fill it. */
  _sorted() {
    const sticks = this.state.sticks;
    const rows = RECIPES.map(rec => {
      const fill = autoFill(rec, sticks);
      return { rec, can: !!fill, fill, known: this.state.metRecipes.has(rec.id) };
    });
    // things you can make now, first; then by tier, so the exciting ones that
    // you cannot quite make yet sit where you will see them
    rows.sort((a, b) => (b.can - a.can) || (a.rec.tier - b.rec.tier) || a.rec.name.localeCompare(b.rec.name));
    return rows;
  }

  select(rec) {
    this.recipe = rec;
    const fill = autoFill(rec, this.state.sticks);
    this.slots = rec.needs.map((_, i) => (fill ? fill[i].uid : null));
    this.pickingSlot = -1;
    this.preview();
    this.render();
  }

  preview() {
    if (!this.recipe) { this.tt.clear(); return; }
    const sticks = this.slots.map(u => this.state.stickById(u));
    if (sticks.some(s => !s)) { this.tt.clear(); return; }
    this.tt.showWeapon(this.recipe, sticks);
  }

  get ready() {
    return this.recipe && this.slots.every((u, i) => {
      const s = this.state.stickById(u);
      return s && slotAccepts(this.recipe.needs[i], s);
    }) && new Set(this.slots).size === this.slots.length;
  }

  craft() {
    if (!this.ready) return;
    const sticks = this.slots.map(u => this.state.stickById(u));
    const res = this.state.craft(this.recipe, sticks);
    if (!res.ok) return;
    this.audio?.craft();
    this.onCraft?.(res.weapon, this.recipe);
    this.slots = this.recipe.needs.map(() => null);
    const fill = autoFill(this.recipe, this.state.sticks);
    if (fill) this.slots = fill.map(s => s.uid);
    this.preview();
    this.render();
  }

  /* ====================================================================== */

  render() {
    const rows = this._sorted();
    const rec = this.recipe;
    const canCount = rows.filter(r => r.can).length;

    this.body.innerHTML = `
      <div class="shop-cols">
        <div class="shop-list">
          <p class="shop-hint">${canCount
        ? `She can make <b>${canCount}</b> ${canCount === 1 ? 'thing' : 'things'} from what you brought.`
        : 'Nothing in the satchel is any use yet. Go and find some wood.'}</p>
          ${rows.map(r => this._recipeRow(r)).join('')}
        </div>

        <div class="shop-mid">
          ${rec ? this._recipePanel(rec) : '<p class="empty">Pick something.</p>'}
        </div>

        <div class="shop-view">
          <div class="tt-slot" id="tt-slot"></div>
          ${rec ? this._statPanel(rec) : ''}
          <div class="shop-go">
            <button class="btn big${this.ready ? '' : ' off'}" id="do-craft"${this.ready ? '' : ' disabled'}>
              ${ic('hammer')} ${this.ready ? 'Make it' : 'Not yet'}
            </button>
            ${rec && !this.ready ? `<p class="need">needs ${esc(recipeNeedText(rec))}</p>` : ''}
          </div>
        </div>
      </div>

      ${this.pickingSlot >= 0 ? this._pickerHtml() : ''}
    `;

    this.body.querySelectorAll('.rec-row').forEach(b => {
      b.onclick = () => { this.audio?.ui('tick'); this.select(RECIPE_BY_ID[b.dataset.id]); };
    });
    this.body.querySelectorAll('.slot').forEach(b => {
      b.onclick = () => { this.pickingSlot = Number(b.dataset.slot); this.render(); };
    });
    const go = this.body.querySelector('#do-craft');
    if (go) go.onclick = () => this.craft();
    this.body.querySelectorAll('.pick-row').forEach(b => {
      b.onclick = () => {
        const uid = Number(b.dataset.uid);
        // a stick already in another slot swaps out of it rather than being
        // silently used twice
        const other = this.slots.indexOf(uid);
        if (other >= 0 && other !== this.pickingSlot) this.slots[other] = null;
        this.slots[this.pickingSlot] = uid;
        this.pickingSlot = -1;
        this.preview();
        this.render();
      };
    });
    // re-attach after every rebuild — see the note in Satchel.render
    this.tt.attach(this.body.querySelector('#tt-slot'));

    const cancel = this.body.querySelector('#pick-cancel');
    if (cancel) cancel.onclick = () => { this.pickingSlot = -1; this.render(); };
  }

  _recipeRow(r) {
    const rec = r.rec;
    const t = clamp(rec.tier, 0, 4);
    const R = RARITY[t];
    return `<button class="row rec-row${rec === this.recipe ? ' sel' : ''}${r.can ? '' : ' dim'}" data-id="${rec.id}">
      <span class="swatch" style="--c:${R.css}">${ic(iconFor(rec.cls))}</span>
      <span class="row-main">
        <b style="color:${t >= 2 ? R.css : 'inherit'}">${esc(rec.name)}</b>
        <i>${esc(WEAPON_CLASSES[rec.cls]?.label || rec.cls)}${r.can ? '' : ' · ' + esc(recipeNeedText(rec))}</i>
      </span>
      ${r.can ? `<span class="row-tags"><em class="lit">${ic('check')}</em></span>` : ''}
    </button>`;
  }

  _recipePanel(rec) {
    return `<div class="rec-detail">
      <h3>${esc(rec.name)}</h3>
      <p class="blurb">${esc(rec.desc)}</p>
      <blockquote>${ic('paw')}<span>“${esc(rec.line)}”</span><cite>Old Nissel</cite></blockquote>
      <h4>she will need</h4>
      <div class="slots">
        ${rec.needs.map((slot, i) => {
      const s = this.state.stickById(this.slots[i]);
      const ok = s && slotAccepts(slot, s);
      return `<button class="slot${ok ? ' filled' : ''}" data-slot="${i}">
            <span class="slot-label">${esc(slot.label)}</span>
            <span class="slot-pick">${s ? esc(s.name) : 'choose wood'}</span>
            ${ok ? ic('check') : ic('plus')}
          </button>`;
    }).join('')}
      </div>
    </div>`;
  }

  _statPanel(rec) {
    const sticks = this.slots.map(u => this.state.stickById(u));
    if (sticks.some(s => !s)) return '<div class="detail empty">Fill the slots to see it.</div>';
    const st = weaponStats(rec, sticks);
    const bar = (v, max) => `<span style="width:${Math.round(clamp01(v / max) * 100)}%"></span>`;
    return `<div class="detail">
      <h3>${esc(weaponName(rec, sticks))}</h3>
      <dl class="bars">
        <dt>heft</dt><dd>${bar(st.heft, 12)}<u>${st.heft}</u></dd>
        <dt>reach</dt><dd>${bar(st.reach, 3.2)}<u>${st.reach} m</u></dd>
        <dt>speed</dt><dd>${bar(st.speed, 2.6)}<u>${st.speed}</u></dd>
        <dt>bite</dt><dd>${bar(st.bite, 60)}<u>${st.bite}</u></dd>
      </dl>
      <p class="made">${st.hands === 2 ? 'two hands' : 'one hand'} · ${esc(st.material)}</p>
    </div>`;
  }

  _pickerHtml() {
    const slot = this.recipe.needs[this.pickingSlot];
    const good = this.state.sticks.filter(s => slotAccepts(slot, s));
    const bad = this.state.sticks.filter(s => !slotAccepts(slot, s));
    return `<div class="picker">
      <div class="picker-box">
        <header><h3>${esc(slot.label)}</h3><button class="x" id="pick-cancel">${ic('close')}</button></header>
        <div class="picker-list">
          ${good.length ? good.map(s => stickRow(s, { selected: this.slots[this.pickingSlot] === s.uid }).replace('stick-row', 'stick-row pick-row')).join('')
        : '<p class="empty">Nothing in the satchel fits this.</p>'}
          ${bad.length ? `<p class="sep">will not do</p>` + bad.map(s => stickRow(s, { dim: true })).join('') : ''}
        </div>
      </div>
    </div>`;
  }
}

function iconFor(cls) {
  return {
    sword: 'sword', greatsword: 'sword', axe: 'sword',
    hammer: 'hammer', sledge: 'hammer', maul: 'hammer', club: 'hammer',
    broom: 'broom', wand: 'spark', stave: 'stick', spear: 'arrow',
    walkingStick: 'stick',
  }[cls] || 'stick';
}
