/* RodShop.js — the rack behind the fisherman.
   ===========================================================================
   The only shop in FISH N STICKS, and the thing the whole economy points at.
   Two design rules, both of which the first draft got wrong:

     A STAT IS MEANINGLESS ON ITS OWN. "Control 2.30" tells a player nothing.
     "+0.75 Control" against the rod already in their paws tells them whether
     to buy it. Every number on a card is a DELTA, coloured by whether it is
     better or worse, and the rod you own is shown as the baseline rather
     than hidden.
     THE PRICE IS THE PITCH. It is the biggest thing on the card after the
     name, and it goes grey the moment you cannot afford it, so the answer
     to "can I have this" never needs a click to find out.

   It is a side panel, not a full screen, for the same reason Talk.js is:
   the player is standing on a riverbank talking to somebody.
*/

import { rodsAt, rodOf, ROD_STATS, ROD_BY_ID } from '../data/RodData.js?v=20260921164117';
import { ic } from './Icons.js?v=20260921164117';
import { input } from '../core/Input.js?v=20260921164117';
import { esc, clamp } from '../core/Util.js?v=20260921164117';

const money = n => '$' + Math.round(n).toLocaleString('en-US');

export class RodShop {
  constructor(root, state, { audio = null, onBuy = null } = {}) {
    this.root = root || document.body;
    this.state = state;
    this.audio = audio;
    this.onBuy = onBuy;
    this.el = null;
    this.open = false;
    this._resolve = null;
    this._sel = 0;
  }

  get busy() { return this.open; }

  /** @returns a promise that resolves when the player walks away. */
  show(villageId, who = 'Fisherman') {
    this.close();
    this.village = villageId;
    this.who = who;
    return new Promise(resolve => {
      this._resolve = resolve;
      const el = document.createElement('div');
      el.className = 'rodshop';
      this.el = el;
      this.root.appendChild(el);
      this.open = true;
      input.blocked = true;
      input.releaseLock();
      this.audio?.ui?.('open');
      this._render();
      requestAnimationFrame(() => el.classList.add('in'));
    });
  }

  _render() {
    if (!this.el) return;
    const S = this.state;
    const stock = rodsAt(this.village);
    const mine = S.currentRod;

    this.el.innerHTML = `
      <header class="rs-head">
        <div>
          <span class="rs-kicker">${esc(this.who)}&rsquo;s rack</span>
          <b class="rs-title">Fishing Rods</b>
        </div>
        <div class="rs-purse">${ic('spark')}<b>${money(S.coin)}</b></div>
      </header>

      <div class="rs-mine">
        <span>in your paws</span><b>${esc(mine.name)}</b>
      </div>

      <div class="rs-list">
        ${stock.length ? stock.map((r, i) => this._card(r, mine, i)).join('')
        : `<p class="rs-empty">&ldquo;Nothing on the rack today. Try further up
             the valley &mdash; they get fancier the colder it gets.&rdquo;</p>`}
      </div>

      <button class="btn rs-done" id="rs-done">${ic('chevron')} That&rsquo;s all</button>`;

    this.el.querySelectorAll('.rs-card').forEach(c => {
      c.onmouseenter = () => this._highlight(Number(c.dataset.i));
      c.onclick = () => this._buy(c.dataset.id);
    });
    this.el.querySelector('#rs-done').onclick = () => this.close();
    this._highlight(clamp(this._sel, 0, Math.max(0, stock.length - 1)));
  }

  _card(rod, mine, i) {
    const S = this.state;
    const owned = S.ownsRod(rod.id);
    const equipped = mine.id === rod.id;
    const afford = S.coin >= rod.price;

    /* the deltas against what they are already using — the only numbers on
       this card a player can act on */
    const deltas = ROD_STATS.map(st => {
      const d = rod[st.key] - mine[st.key];
      if (Math.abs(d) < 0.005) return '';
      const up = d > 0;
      const shown = st.key === 'band' || st.key === 'reach'
        ? `${up ? '+' : ''}${Math.round(d * 100)}%`
        : `${up ? '+' : ''}${d.toFixed(2)}`;
      return `<span class="rs-d ${up ? 'up' : 'down'}" title="${esc(st.hint)}">
        ${esc(st.label)} <b>${shown}</b></span>`;
    }).filter(Boolean).join('');

    return `
      <article class="rs-card${owned ? ' owned' : ''}${afford || owned ? '' : ' poor'}"
               data-i="${i}" data-id="${rod.id}" role="button" tabindex="0">
        <div class="rs-top">
          <b class="rs-name">${esc(rod.name)}</b>
          <span class="rs-price">${equipped ? 'in use' : owned ? 'owned' : money(rod.price)}</span>
        </div>
        <p class="rs-blurb">${esc(rod.blurb)}</p>
        <div class="rs-stats">${deltas || '<span class="rs-same">the same as yours</span>'}</div>
      </article>`;
  }

  _highlight(i) {
    this._sel = i;
    this.el?.querySelectorAll('.rs-card').forEach((c, k) =>
      c.classList.toggle('sel', k === i));
  }

  _buy(id) {
    const S = this.state;
    const rod = ROD_BY_ID[id];
    if (!rod) return;
    if (S.ownsRod(id)) {
      /* already bought: clicking it swaps to it, which is the obvious thing
         to want and costs nothing to support */
      if (S.currentRod.id !== id) { S.equipRod(id); this.audio?.ui?.('tick'); this._render(); }
      return;
    }
    const res = S.buyRod(id);
    if (!res.ok) {
      this.audio?.denied?.();
      this.el?.querySelector(`.rs-card[data-id="${id}"]`)?.classList.add('shake');
      setTimeout(() => this.el?.querySelector(`.rs-card[data-id="${id}"]`)?.classList.remove('shake'), 400);
      return;
    }
    this.audio?.craft?.();
    this.onBuy?.(res.rod);
    this._render();
  }

  handleKeys() {
    if (!this.open) return false;
    if (input.rawPressed('Escape', 'KeyQ')) { this.close(); return true; }
    const n = this.el?.querySelectorAll('.rs-card').length || 0;
    if (n) {
      if (input.rawPressed('ArrowDown', 'KeyS')) this._highlight((this._sel + 1) % n);
      if (input.rawPressed('ArrowUp', 'KeyW')) this._highlight((this._sel - 1 + n) % n);
      if (input.rawPressed('Enter', 'Space', 'KeyE')) {
        const c = this.el.querySelectorAll('.rs-card')[this._sel];
        if (c) this._buy(c.dataset.id);
      }
    }
    return true;
  }

  close() {
    const el = this.el;
    const res = this._resolve;
    this.el = null; this._resolve = null; this.open = false;
    if (el) { el.classList.remove('in'); setTimeout(() => el.remove(), 240); }
    this.audio?.ui?.('close');
    if (res) res();
  }
}
