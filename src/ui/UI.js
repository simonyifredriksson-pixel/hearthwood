/* UI.js — the shell: HUD, prompts, toasts, dialogue and the screen stack.
   ===========================================================================
   Hearthwood's interface is deliberately almost absent. You are walking in a
   wood; a wood does not have a minimap, a quest tracker and four resource
   counters along the top. What is on screen at rest is:

     - a small satchel count, bottom left, which fades out when it has not
       changed for a while,
     - one interaction prompt when something is in reach,
     - the occasional line of speech.

   Everything else is a screen you open on purpose.

   ONE RULE ABOUT INPUT: whenever a screen or a conversation is open,
   `input.blocked` is true, which is the single switch that stops the camera
   turning and the character walking. Nothing else needs to know menus exist.
*/

import { ic } from './Icons.js';
import { bus, EV } from '../core/Bus.js';
import { input } from '../core/Input.js';
import { esc, clamp, clamp01, lerp } from '../core/Util.js';
import { RARITY, cssHex } from '../art/Palette.js';
import { stickBlurb, stickValue } from '../data/StickData.js';

export class UI {
  constructor({ audio = null } = {}) {
    this.audio = audio;
    this.root = document.getElementById('ui');
    this.hud = document.getElementById('hud');
    this.toastBox = document.getElementById('toasts');
    this.promptBox = document.getElementById('prompt');
    this.screens = [];
    this.dialogue = null;
    this._promptText = '';
    this._satchelPulse = 0;

    this._buildHud();

    bus.on(EV.TOAST, t => this.toast(t));
    bus.on(EV.SATCHEL_FULL, () => this.toast({
      text: 'Your satchel is full. Take something to the Stickwright.', icon: 'satchel', tone: 'warn',
    }));
  }

  /* ====================================================================== */
  /* HUD                                                                    */
  /* ====================================================================== */

  _buildHud() {
    this.hud.innerHTML = `
      <div class="hud-satchel" id="hud-satchel">
        ${ic('satchel')}<span class="count"><b id="hud-count">0</b><i id="hud-cap">/24</i></span>
      </div>
      <div class="hud-weapon hidden" id="hud-weapon">
        ${ic('sword')}<span id="hud-weapon-name"></span>
      </div>
      <div class="hud-clock" id="hud-clock">${ic('sun')}<span id="hud-time">afternoon</span></div>
      <div class="hud-compass hidden" id="hud-compass">
        ${ic('home')}<span id="hud-dist">0m</span>
      </div>
    `;
    this.elCount = document.getElementById('hud-count');
    this.elCap = document.getElementById('hud-cap');
    this.elSatchel = document.getElementById('hud-satchel');
    this.elWeapon = document.getElementById('hud-weapon');
    this.elWeaponName = document.getElementById('hud-weapon-name');
    this.elTime = document.getElementById('hud-time');
    this.elClock = document.getElementById('hud-clock');
    this.elCompass = document.getElementById('hud-compass');
    this.elDist = document.getElementById('hud-dist');
  }

  setSatchel(n, cap) {
    if (this.elCount.textContent !== String(n)) {
      this.elCount.textContent = n;
      this._satchelPulse = 1;
      this.elSatchel.classList.remove('pulse');
      void this.elSatchel.offsetWidth;          // restart the animation
      this.elSatchel.classList.add('pulse');
    }
    this.elCap.textContent = '/' + cap;
    this.elSatchel.classList.toggle('full', n >= cap);
  }

  setWeapon(w) {
    this.elWeapon.classList.toggle('hidden', !w);
    if (w) this.elWeaponName.textContent = w.name;
  }

  setTime(label, night) {
    this.elTime.textContent = label;
    this.elClock.innerHTML = (night > 0.5 ? ic('moon') : ic('sun')) + `<span id="hud-time">${esc(label)}</span>`;
    this.elTime = document.getElementById('hud-time');
  }

  /** How far home, shown only once you are properly out in the wood. */
  setHomeDistance(d) {
    const show = d > 120;
    this.elCompass.classList.toggle('hidden', !show);
    if (show) this.elDist.textContent = `${Math.round(d)}m`;
  }

  update(dt) {
    if (this._satchelPulse > 0) this._satchelPulse = Math.max(0, this._satchelPulse - dt * 0.5);
    this.elSatchel.style.opacity = String(lerp(0.42, 1, clamp01(this._satchelPulse * 2.2 + 0.2)));
  }

  /* ====================================================================== */
  /* PROMPT                                                                 */
  /* ====================================================================== */

  /**
   * The single line of "press E to …" at the bottom of the screen.
   * @param text  null to hide
   */
  setPrompt(text, { key = 'E', icon = 'stick', tone = '' } = {}) {
    if (text === this._promptText) return;
    this._promptText = text;
    if (!text) { this.promptBox.className = 'hidden'; this.promptBox.innerHTML = ''; return; }
    this.promptBox.className = 'shown ' + tone;
    this.promptBox.innerHTML =
      `<kbd>${esc(key)}</kbd>${ic(icon)}<span>${esc(text)}</span>`;
  }

  /* ====================================================================== */
  /* TOASTS                                                                 */
  /* ====================================================================== */

  toast({ text, sub = '', icon = 'spark', tone = '', ms = 3400 }) {
    const el = document.createElement('div');
    el.className = 'toast ' + tone;
    el.innerHTML = `${ic(icon)}<div><b>${esc(text)}</b>${sub ? `<i>${esc(sub)}</i>` : ''}</div>`;
    this.toastBox.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => {
      el.classList.remove('in');
      setTimeout(() => el.remove(), 420);
    }, ms);
  }

  /** The big one, for finding something genuinely rare. */
  discovery({ title, sub, tier = 3 }) {
    const el = document.createElement('div');
    el.className = 'discovery';
    el.style.setProperty('--rare', RARITY[clamp(tier, 0, 4)].css);
    el.innerHTML = `<span class="d-kicker">a find</span>
      <b>${esc(title)}</b>${sub ? `<i>${esc(sub)}</i>` : ''}`;
    this.toastBox.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => {
      el.classList.remove('in');
      setTimeout(() => el.remove(), 700);
    }, 4200);
  }

  /* ====================================================================== */
  /* DIALOGUE                                                               */
  /* ====================================================================== */

  /**
   * A line of speech with an optional set of replies.
   * @returns a promise resolving to the chosen reply id, or null
   */
  say(speaker, text, options = null) {
    return new Promise(resolve => {
      this.closeDialogue();
      const el = document.createElement('div');
      el.className = 'dialogue';
      el.innerHTML = `
        <div class="d-box">
          <div class="d-who">${esc(speaker)}</div>
          <div class="d-text"></div>
          <div class="d-opts"></div>
          <div class="d-hint">${options ? 'choose' : 'press <kbd>E</kbd> or click to continue'}</div>
        </div>`;
      this.root.appendChild(el);
      this.dialogue = { el, resolve, done: false };
      input.blocked = true;

      /* type the line out. It is the cheapest way to make a village feel
         like it is talking to you rather than displaying at you. */
      const textEl = el.querySelector('.d-text');
      const full = String(text);
      let i = 0;
      const tick = () => {
        if (!this.dialogue || this.dialogue.el !== el) return;
        i = Math.min(full.length, i + 2);
        textEl.textContent = full.slice(0, i);
        if (i < full.length) this._typeTimer = setTimeout(tick, 14);
        else this.dialogue.typed = true;
      };
      tick();

      const finish = id => {
        if (this.dialogue?.done) return;
        if (this.dialogue) this.dialogue.done = true;
        clearTimeout(this._typeTimer);
        el.classList.add('out');
        setTimeout(() => el.remove(), 260);
        this.dialogue = null;
        input.blocked = this.screens.length > 0;
        resolve(id);
      };
      this._finishDialogue = finish;
      this._skipType = () => { clearTimeout(this._typeTimer); textEl.textContent = full; if (this.dialogue) this.dialogue.typed = true; };

      if (options && options.length) {
        const box = el.querySelector('.d-opts');
        options.forEach(o => {
          const b = document.createElement('button');
          b.className = 'd-opt' + (o.disabled ? ' off' : '');
          b.innerHTML = `${o.icon ? ic(o.icon) : ''}<span>${esc(o.label)}</span>`;
          if (o.disabled) b.disabled = true;
          b.onclick = () => { this.audio?.ui('tick'); finish(o.id); };
          box.appendChild(b);
        });
      } else {
        el.onclick = () => {
          if (!this.dialogue?.typed) this._skipType();
          else finish(null);
        };
      }
      requestAnimationFrame(() => el.classList.add('in'));
    });
  }

  closeDialogue() {
    if (this._finishDialogue) { const f = this._finishDialogue; this._finishDialogue = null; f(null); }
  }

  /** Called from the main loop so E and Escape work on dialogue. */
  handleKeys() {
    if (this.dialogue) {
      if (input.rawPressed('KeyE', 'Space', 'Enter')) {
        if (!this.dialogue.typed) this._skipType();
        else this._finishDialogue?.(null);
      } else if (input.rawPressed('Escape')) {
        this._finishDialogue?.(null);
      }
      return true;
    }
    if (this.screens.length) {
      const top = this.screens[this.screens.length - 1];
      if (input.rawPressed('Escape') || (top.closeKey && input.rawPressed(top.closeKey))) {
        this.pop();
        return true;
      }
      top.onKeys?.();
      return true;
    }
    return false;
  }

  /* ====================================================================== */
  /* SCREENS                                                                */
  /* ====================================================================== */

  push(screen) {
    this.screens.push(screen);
    this.root.appendChild(screen.el);
    requestAnimationFrame(() => screen.el.classList.add('in'));
    input.blocked = true;
    input.releaseLock();
    this.audio?.ui('open');
    bus.emit(EV.SCREEN_OPEN, screen);
    screen.onOpen?.();
  }

  pop() {
    const s = this.screens.pop();
    if (!s) return;
    s.el.classList.remove('in');
    setTimeout(() => s.el.remove(), 260);
    s.onClose?.();
    input.blocked = this.screens.length > 0 || !!this.dialogue;
    this.audio?.ui('close');
    bus.emit(EV.SCREEN_CLOSE, s);
  }

  popAll() { while (this.screens.length) this.pop(); }

  get busy() { return this.screens.length > 0 || !!this.dialogue; }
}

/* ========================================================================= */
/* SHARED WIDGETS                                                            */
/* ========================================================================= */

/** A stick as a row in a list. Used by the satchel and the workshop. */
export function stickRow(s, { selected = false, dim = false } = {}) {
  const tier = clamp(s.tier ?? 0, 0, 4);
  const R = RARITY[tier];
  return `<button class="row stick-row${selected ? ' sel' : ''}${dim ? ' dim' : ''}" data-uid="${s.uid}">
    <span class="swatch" style="--c:${R.css}">${ic('stick')}</span>
    <span class="row-main">
      <b style="color:${tier >= 2 ? R.css : 'inherit'}">${esc(s.name)}</b>
      <i>${s.length.toFixed(2)} m · ${(s.thick * 200).toFixed(1)} cm · ${esc(R.name)}</i>
    </span>
    <span class="row-tags">${(s.tags || []).filter(t => !t.startsWith('wood:') && !t.startsWith('rare:')).slice(0, 3).map(t => `<em>${esc(t)}</em>`).join('')}</span>
  </button>`;
}

/** The detail panel for one stick. */
export function stickDetail(s) {
  if (!s) return '<div class="detail empty">Nothing selected.</div>';
  const tier = clamp(s.tier ?? 0, 0, 4);
  const R = RARITY[tier];
  return `<div class="detail">
    <h3 style="color:${R.css}">${esc(s.name)}</h3>
    <p class="blurb">${esc(stickBlurb(s))}</p>
    <dl>
      <dt>length</dt><dd>${s.length.toFixed(2)} m</dd>
      <dt>thickness</dt><dd>${(s.thick * 200).toFixed(1)} cm</dd>
      <dt>wood</dt><dd>${esc(s.species)}</dd>
      <dt>worth</dt><dd>${stickValue(s)}</dd>
    </dl>
    <div class="tags">${(s.tags || []).map(t => `<em>${esc(t.replace(/^(wood|rare):/, ''))}</em>`).join('')}</div>
  </div>`;
}

/** A plain screen shell with a title bar. */
export function makeScreen(title, bodyHtml, { wide = false, kicker = '' } = {}) {
  const el = document.createElement('div');
  el.className = 'screen' + (wide ? ' wide' : '');
  el.innerHTML = `
    <div class="sheet">
      <header>
        ${kicker ? `<span class="kicker">${esc(kicker)}</span>` : ''}
        <h2>${esc(title)}</h2>
        <button class="x" title="close">${ic('close')}</button>
      </header>
      <div class="body">${bodyHtml}</div>
    </div>`;
  return el;
}
