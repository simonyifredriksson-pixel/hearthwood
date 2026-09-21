/* Talk.js — talking to somebody without leaving the world.
   ===========================================================================
   THE OLD WAY WAS A FULL-SCREEN SHEET. Every conversation — including "sell
   one fish", which a player does forty times an hour — blacked out the wood,
   the river and the person you were talking to, put a modal in front of it,
   and then took it all away again. It made the busiest interaction in the
   game feel like opening a settings menu.

   This is the replacement, and the rules it follows are:

     THE WORLD STAYS UP. No backdrop, no blur, no dimming. The panel sits to
     one side and everything behind it keeps running, so you are still stood
     on a riverbank talking to a cat.
     IT IS SMALL. A name, a line if there is one, and the choices. Nothing
     is centred, nothing is full width, nothing announces itself.
     THE CHOICES ARE THE INTERFACE. Numbered, hoverable, clickable, and
     driveable from the keyboard with 1-9 / arrows / Enter — because the
     mouse is busy fishing.
     IT NEVER TRAPS YOU. Escape always closes it, every panel has a way out
     in its own list, and closing resolves the promise with null so the
     caller cannot hang waiting for an answer that is not coming.

   `ask()` returns a promise for the chosen option's id. That is the whole
   API; a conversation is a loop over it in the caller, which keeps branching
   dialogue in the place that knows what the branches mean.
*/

import { ic } from './Icons.js?v=1790014288';
import { input } from '../core/Input.js?v=1790014288';
import { esc, clamp } from '../core/Util.js?v=1790014288';

export class Talk {
  constructor(root, { audio = null } = {}) {
    this.root = root || document.body;
    this.audio = audio;
    this.el = null;
    this.open = false;
    this._resolve = null;
    this._opts = [];
    this._sel = 0;
  }

  /** True while a panel is up, so the main loop knows to stop the player. */
  get busy() { return this.open; }

  /**
   * Put a panel up and wait for an answer.
   *
   * @param who      the speaker's name
   * @param title    their trade or role, shown small under the name
   * @param say      a line of dialogue, or '' for a bare menu
   * @param options  [{id, label, icon, note, tone, disabled}]
   * @returns Promise<string|null>
   */
  ask(who, title, say, options) {
    this.close(null);
    return new Promise(resolve => {
      this._resolve = resolve;
      this._opts = options.filter(Boolean);
      this._sel = 0;

      const el = document.createElement('div');
      el.className = 'talk';
      el.innerHTML = `
        <div class="talk-who">
          <b>${esc(who)}</b>${title ? `<i>${esc(title)}</i>` : ''}
        </div>
        ${say ? `<p class="talk-say">${esc(say)}</p>` : ''}
        <ul class="talk-opts">
          ${this._opts.map((o, i) => `
            <li class="talk-opt${o.disabled ? ' off' : ''}${o.tone ? ' ' + o.tone : ''}"
                data-i="${i}" role="button" tabindex="0">
              <span class="to-num">${i + 1}</span>
              ${o.icon ? ic(o.icon) : ''}
              <span class="to-label">${esc(o.label)}</span>
              ${o.note ? `<em class="to-note">${esc(o.note)}</em>` : ''}
            </li>`).join('')}
        </ul>`;
      this.root.appendChild(el);
      this.el = el;
      this.open = true;
      input.blocked = true;
      input.releaseLock();
      this.audio?.ui?.('open');

      el.querySelectorAll('.talk-opt').forEach(li => {
        li.onmouseenter = () => this._highlight(Number(li.dataset.i));
        li.onclick = () => this._choose(Number(li.dataset.i));
      });
      this._highlight(0);
      requestAnimationFrame(() => el.classList.add('in'));
    });
  }

  /** A line with nothing to decide — the fisherman saying "See you later!". */
  say(who, title, line, { ms = 2200 } = {}) {
    this.close(null);
    const el = document.createElement('div');
    el.className = 'talk lone';
    el.innerHTML = `
      <div class="talk-who"><b>${esc(who)}</b>${title ? `<i>${esc(title)}</i>` : ''}</div>
      <p class="talk-say">${esc(line)}</p>`;
    this.root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => {
      el.classList.remove('in');
      setTimeout(() => el.remove(), 260);
    }, ms);
  }

  _highlight(i) {
    if (!this.el) return;
    const n = this._opts.length;
    if (!n) return;
    this._sel = ((i % n) + n) % n;
    this.el.querySelectorAll('.talk-opt').forEach((li, k) => {
      li.classList.toggle('sel', k === this._sel);
    });
  }

  _choose(i) {
    const o = this._opts[i];
    if (!o || o.disabled) { this.audio?.denied?.(); return; }
    this.audio?.ui?.('tick');
    this.close(o.id);
  }

  /** Called from the main loop so the keyboard drives it too. */
  handleKeys() {
    if (!this.open) return false;
    if (input.rawPressed('Escape')) { this.close(null); return true; }
    if (input.rawPressed('ArrowDown', 'KeyS')) this._highlight(this._sel + 1);
    if (input.rawPressed('ArrowUp', 'KeyW')) this._highlight(this._sel - 1);
    if (input.rawPressed('Enter', 'Space', 'KeyE')) { this._choose(this._sel); return true; }
    for (let i = 0; i < Math.min(9, this._opts.length); i++) {
      if (input.rawPressed(`Digit${i + 1}`)) { this._choose(i); return true; }
    }
    return true;      // while a panel is up it eats everything else
  }

  close(value = null) {
    const el = this.el;
    const res = this._resolve;
    this.el = null;
    this._resolve = null;
    this.open = false;
    if (el) {
      el.classList.remove('in');
      setTimeout(() => el.remove(), 240);
    }
    if (res) res(value);
  }
}
