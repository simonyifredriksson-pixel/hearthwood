/* Workshop.js — the Stickwright.
   ===========================================================================
   There is no recipe list here, and that is the entire design.

   The old screen asked the player to pick a WEAPON and then go and find wood
   that qualified. This one asks them to pick a STICK — any stick, every stick
   works — and then find out what it turned into. Everything on screen serves
   that: the left column is the wood you are carrying, the right column is the
   piece of wood itself, turning, with everything the Stickwright can tell you
   about it. What it will BECOME is the one thing nobody says, because the
   moment the player knows that, the whole system collapses back into a menu.

   The forge sequence afterwards is not a loading bar with a hat on. Nissel
   takes the stick, turns it over, taps it on the bench, finds the thing about
   it that is interesting, draws something nobody is allowed to see, and gets
   to work. Then the room goes quiet and dark and you find out.
*/

import { forgeHint } from '../data/WeaponData.js?v=20260920201841';
import { stickBlurb, SPECIES, MATERIALS, EFFECTS, BARKS } from '../data/StickData.js?v=20260920201841';
import { RARITY } from '../art/Palette.js?v=20260920201841';
import { ic } from './Icons.js?v=20260920201841';
import { makeScreen } from './UI.js?v=20260920201841';
import { esc, clamp } from '../core/Util.js?v=20260920201841';

/* The stages of the forge, in order, with how long each one holds. */
const STAGES = [
  { id: 'examine', ms: 3400 },
  { id: 'draw', ms: 2600 },
  { id: 'forge', ms: 5200 },
  { id: 'reveal', ms: 0 },
];

/* What Nissel says while she is examining it. Chosen from the stick, so she
   is always commenting on the thing in her hands. */
function examineLines(s) {
  const out = [];
  const bend = s.curve + s.wobble * 0.5 + s.kinks * 0.35;
  out.push('She turns it over. Twice.');
  if (s.special && MATERIALS[s.special]) out.push(`She stops. &ldquo;Well now. There is ${MATERIALS[s.special].label.toLowerCase()} in this.&rdquo;`);
  else if (s.effect && EFFECTS[s.effect]) out.push(`She holds it up to the light and says nothing for a while.`);
  else if (bend > 1.2) out.push('&ldquo;That is a proper bend. I am not taking that out.&rdquo;');
  else if (bend < 0.2 && s.length > 1.4) out.push('&ldquo;Straight. Properly straight. Do you know how rare that is?&rdquo;');
  else if (s.thick > 0.06) out.push('&ldquo;Heavy. There is a lot of tree in here.&rdquo;');
  else if (s.length < 0.5) out.push('&ldquo;Small. Small is not the same as no use.&rdquo;');
  else out.push('&ldquo;Mm. Honest wood.&rdquo;');
  out.push('She taps it once on the bench and listens to it.');
  if (s.moss > 0.5) out.push('&ldquo;The moss stays. Do not argue with me about the moss.&rdquo;');
  else if ((s.fungi || []).length >= 2) out.push('She looks at the little brackets and decides to leave them.');
  else if (s.charred > 0.3) out.push('&ldquo;This one has been hit by weather. Good.&rdquo;');
  else out.push('She nods, and reaches for the apron.');
  return out;
}

const DRAW_LINES = [
  'She pulls a sheet of parchment across the bench.',
  'The pencil moves. You cannot see the page from here.',
  '&ldquo;Not yet,&rdquo; she says, without looking up.',
];

const FORGE_LINES = [
  'The bench is cleared. The fire is brought up.',
  'She heats it, and the shop smells of hot iron.',
  'A mould is packed, opened, packed again.',
  'Hammer. Hammer. A spray of sparks across the floor.',
  'She carves. The shavings curl and fall.',
  'The handle goes on, and is bound, and is bound again.',
  'Then a long time with a cloth, and no talking at all.',
];

export class WorkshopScreen {
  constructor(state, ui, turntable, { onCraft = null, audio = null } = {}) {
    this.state = state;
    this.ui = ui;
    this.tt = turntable;
    this.onCraft = onCraft;
    this.audio = audio;
    this.sel = null;            // uid of the stick being inspected
    this.stage = null;          // null when browsing; a STAGES id while forging
    this.stageT = 0;
    this.line = 0;
    this.result = null;
    this.closeKey = 'KeyQ';

    this.el = makeScreen('STICKWRIGHT', '<div class="shop"></div>', {
      wide: true, kicker: 'Bring me something interesting…',
    });
    this.el.querySelector('.x').onclick = () => { if (!this.stage) ui.pop(); };
    this.el.addEventListener('click', e => { if (e.target === this.el && !this.stage) ui.pop(); });
    this.body = this.el.querySelector('.shop');
    this.render();
  }

  onOpen() {
    this.tt.clear();
    this.stage = null;
    this.result = null;
    const first = this.state.sticks[0];
    if (first) this.select(first.uid); else this.render();
  }
  onClose() { this.tt.clear(); }

  /** The screen is modal while the forge is running. */
  get busy() { return !!this.stage && this.stage !== 'reveal'; }

  /* ====================================================================== */
  /* BROWSING                                                               */
  /* ====================================================================== */

  select(uid) {
    this.sel = uid;
    const s = this.state.stickById(uid);
    this.tt.showStick(s);
    this.render();
  }

  render() {
    if (this.stage) return this._renderForge();
    const S = this.state;
    const sel = S.stickById(this.sel);

    this.body.innerHTML = `
      <div class="shop-cols">
        <div class="shop-list">
          <h4>${ic('stick')} What you are carrying <b>${S.sticks.length}</b></h4>
          <div class="rows">
            ${S.sticks.length
        ? S.sticks.map(s => this._stickRow(s)).join('')
        : `<p class="empty">Nothing in the satchel. Every branch on the forest
             floor is worth something here &mdash; go and look down.</p>`}
          </div>
        </div>
        <div class="shop-view">
          <div class="tt-slot" id="tt-slot"></div>
          ${sel ? this._inspect(sel) : '<div class="detail empty">Pick up a piece of wood.</div>'}
          <div class="shop-go">
            ${sel ? `<button class="btn big" id="act-forge">${ic('hammer')} Put it on the bench</button>`
        : ''}
          </div>
        </div>
      </div>`;

    this.body.querySelectorAll('.row').forEach(b => {
      b.onclick = () => { this.audio?.ui('tick'); this.select(Number(b.dataset.uid)); };
    });
    const go = this.body.querySelector('#act-forge');
    if (go) go.onclick = () => this.beginForge();
    this.tt.attach(this.body.querySelector('#tt-slot'));
  }

  _stickRow(s) {
    const t = clamp(s.tier ?? 0, 0, RARITY.length - 1);
    const R = RARITY[t];
    const n = (s.parts || []).length;
    return `<button class="row stick-row${s.uid === this.sel ? ' sel' : ''}" data-uid="${s.uid}">
      <span class="swatch" style="--c:${R.css}">${ic('stick')}</span>
      <span class="row-main">
        <b style="color:${t >= 2 ? R.css : 'inherit'}">${esc(s.name)}</b>
        <i>${s.length.toFixed(2)} m &middot; ${(s.thick * 200).toFixed(0)} mm
           &middot; <span style="color:${R.css}">${esc(R.name)}</span></i>
      </span>
      <span class="row-tags">${n ? `<em class="lit">${n}</em>` : ''}</span>
    </button>`;
  }

  /**
   * Everything the Stickwright can say about a stick, and nothing she cannot.
   *
   * Note what is absent: the weapon. `forgeHint` describes the WOOD — how
   * long, how heavy, how bent — and the player has to make of that what they
   * will. Printing "this will become a sabre" would turn the best moment in
   * the game into a transaction.
   */
  _inspect(s) {
    const t = clamp(s.tier ?? 0, 0, RARITY.length - 1);
    const R = RARITY[t];
    const sp = SPECIES[s.species] || SPECIES.oak;
    const bend = s.curve + s.wobble * 0.5 + s.kinks * 0.35;
    const shape = bend < 0.22 ? 'dead straight' : bend < 0.6 ? 'a gentle lean'
      : bend < 1.1 ? 'a real curve' : bend < 1.6 ? 'a strong bend' : 'a hook';
    const parts = s.parts || [];

    return `<div class="detail inspect">
      <h3 style="color:${R.css}">${esc(s.name)}</h3>
      <p class="kind"><span style="color:${R.css}">${esc(R.name)}</span>
        &middot; ${esc(sp.label)} &middot; ${parts.length || 'no'}
        notable ${parts.length === 1 ? 'feature' : 'features'}</p>
      <p class="blurb">${esc(stickBlurb(s))}</p>

      <div class="measures">
        <span><b>${s.length.toFixed(2)} m</b><i>length</i></span>
        <span><b>${(s.thick * 200).toFixed(0)} mm</b><i>across</i></span>
        <span><b>${esc(shape)}</b><i>shape</i></span>
        <span><b>${esc(BARKS[s.bark]?.label.replace(/ bark$/, '') || 'bark')}</b><i>surface</i></span>
      </div>

      ${parts.length ? `<ul class="parts">
        ${parts.map(c => `<li class="p-${esc(c.slot)}">
          <b>${esc(c.label)}</b>${c.note ? `<i>${c.note}</i>` : ''}
        </li>`).join('')}
      </ul>` : `<p class="plain">Nothing unusual about it. Most wood is like
        this, and most wood still becomes something.</p>`}

      <p class="hint">${ic('spark')} She weighs it and says: &ldquo;${esc(forgeHint(s))}.&rdquo;</p>
    </div>`;
  }

  /* ====================================================================== */
  /* THE FORGE                                                              */
  /* ====================================================================== */

  beginForge() {
    const s = this.state.stickById(this.sel);
    if (!s || this.stage) return;
    this.source = s;
    this.lines = examineLines(s);
    this.stage = 'examine';
    this.stageT = 0;
    this.line = 0;
    this.audio?.ui('tick');
    this.ui.setModal?.(true);
    this._renderForge();
  }

  /** Driven from the main loop, so the sequence runs on real time. */
  update(dt) {
    if (!this.stage || this.stage === 'reveal') return;
    this.stageT += dt;
    const cur = STAGES.find(x => x.id === this.stage);
    const lines = this.stage === 'examine' ? this.lines
      : this.stage === 'draw' ? DRAW_LINES : FORGE_LINES;
    const want = Math.min(lines.length - 1, Math.floor(this.stageT / (cur.ms / 1000) * lines.length));
    if (want !== this.line) { this.line = want; this._paintLine(); }
    if (this.stage === 'forge') this._sparks();

    if (this.stageT * 1000 >= cur.ms) {
      const i = STAGES.indexOf(cur);
      this.stage = STAGES[i + 1].id;
      this.stageT = 0;
      this.line = 0;
      if (this.stage === 'forge') this.audio?.craft?.();
      if (this.stage === 'reveal') this._finish();
      this._renderForge();
    }
  }

  _finish() {
    /* The weapon is made HERE, at the reveal, not at the start — so nothing
       anywhere can leak the answer into the earlier stages. */
    const res = this.state.craft(this.source);
    if (!res.ok) { this.stage = null; this.ui.setModal?.(false); this.render(); return; }
    this.result = res.weapon;
    this.audio?.craft?.();
    this.tt.showWeapon(res.weapon);
    this.onCraft?.(res.weapon);
  }

  _paintLine() {
    const el = this.body.querySelector('.forge-line');
    if (!el) return;
    const lines = this.stage === 'examine' ? this.lines
      : this.stage === 'draw' ? DRAW_LINES : FORGE_LINES;
    el.innerHTML = lines[this.line] || '';
    el.classList.remove('in');
    void el.offsetWidth;                   // restart the fade
    el.classList.add('in');
  }

  _sparks() {
    const box = this.body.querySelector('.forge-sparks');
    if (!box || Math.random() > 0.55) return;
    const s = document.createElement('i');
    s.style.setProperty('--x', `${Math.random() * 100}%`);
    s.style.setProperty('--dx', `${(Math.random() - 0.5) * 120}px`);
    s.style.setProperty('--d', `${0.5 + Math.random() * 0.6}s`);
    box.appendChild(s);
    setTimeout(() => s.remove(), 1200);
  }

  _renderForge() {
    if (this.stage === 'reveal') return this._renderReveal();

    const label = { examine: 'She looks at it', draw: 'She draws', forge: 'She works' }[this.stage];
    this.body.innerHTML = `
      <div class="forge stage-${this.stage}">
        <div class="forge-art">
          ${this.stage === 'examine' ? `<div class="tt-slot" id="tt-slot"></div>` : ''}
          ${this.stage === 'draw' ? DRAW_SVG : ''}
          ${this.stage === 'forge' ? `${ANVIL_SVG}<div class="forge-sparks"></div>` : ''}
        </div>
        <div class="forge-text">
          <span class="forge-stage">${esc(label)}</span>
          <p class="forge-line in"></p>
        </div>
      </div>`;
    this._paintLine();
    if (this.stage === 'examine') this.tt.attach(this.body.querySelector('#tt-slot'));
    else this.tt.attach(null);
  }

  _renderReveal() {
    const w = this.result;
    if (!w) { this.stage = null; this.render(); return; }
    const t = clamp(w.tier, 0, RARITY.length - 1);
    const R = RARITY[t];
    const st = w.stats;
    this.body.innerHTML = `
      <div class="reveal tier-${t}" style="--rare:${R.css}">
        <div class="tt-slot big" id="tt-slot"></div>
        <div class="reveal-card">
          <h3>${esc(w.name)}</h3>
          <p class="reveal-kind">${esc((w.label || w.cls).toUpperCase())}</p>
          <p class="reveal-rare">${esc(R.name)}</p>
          ${w.traits?.length ? `<ul class="reveal-traits">
            ${w.traits.map(tr => `<li>&bull; ${esc(tr.label)}</li>`).join('')}
          </ul>` : ''}
          <div class="reveal-stats">
            <span><b>${st.bite}</b><i>damage</i></span>
            <span><b>${st.speed.toFixed(2)}</b><i>speed</i></span>
            <span><b>${st.reach.toFixed(2)}</b><i>reach</i></span>
            <span><b>${st.heft.toFixed(2)}</b><i>heft</i></span>
          </div>
          ${w.blurb ? `<p class="reveal-say">&ldquo;${esc(w.blurb)}&rdquo;</p>` : ''}
          <button class="btn big" id="act-done">${ic('check')} Take it</button>
        </div>
      </div>`;
    this.tt.attach(this.body.querySelector('#tt-slot'));
    const done = this.body.querySelector('#act-done');
    if (done) done.onclick = () => {
      this.stage = null;
      this.result = null;
      this.ui.setModal?.(false);
      const next = this.state.sticks[0];
      this.sel = next ? next.uid : null;
      if (next) this.tt.showStick(next); else this.tt.clear();
      this.render();
    };
  }
}

/* ========================================================================= */
/* THE TWO DRAWINGS                                                          */
/* ========================================================================= */

/**
 * ONE blueprint animation, for everything.
 *
 * The parchment is turned away from the camera and the pen draws a line that
 * is not the shape of anything. This is deliberate and it is the only honest
 * way to do it: a real drawing of the weapon would show the player the
 * answer three seconds early and throw away the reveal, and drawing a
 * different sheet for each of twenty-two weapons would be twenty-two chances
 * to leak it. Nobody sees the page. That is the joke, and Nissel is in on it.
 */
const DRAW_SVG = `
<svg class="draw-svg" viewBox="0 0 320 200" aria-hidden="true">
  <defs>
    <linearGradient id="pg" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0" stop-color="#e9dcbc"/><stop offset="1" stop-color="#bda87e"/>
    </linearGradient>
  </defs>
  <g transform="translate(160 108) rotate(-14) skewX(-26) scale(1 0.42)">
    <rect x="-96" y="-84" width="192" height="168" rx="4" fill="url(#pg)"
          stroke="#8a7550" stroke-width="2"/>
    <path class="draw-ink" d="M-64 46 C -30 10, -44 -28, -6 -50 S 52 -30, 66 6"
          fill="none" stroke="#4a3a24" stroke-width="3" stroke-linecap="round"/>
    <path class="draw-ink d2" d="M-52 62 L 48 62" fill="none" stroke="#6a5638"
          stroke-width="2" stroke-dasharray="6 7" stroke-linecap="round"/>
  </g>
  <g class="draw-hand">
    <rect x="-3" y="-44" width="6" height="52" rx="3" fill="#6b4a2c"/>
    <path d="M-3 8 L 3 8 L 0 18 Z" fill="#2c2018"/>
  </g>
</svg>`;

/** The bench, the fire and an anvil. The sparks are DOM, not SVG. */
const ANVIL_SVG = `
<svg class="anvil-svg" viewBox="0 0 320 200" aria-hidden="true">
  <rect x="18" y="150" width="284" height="14" rx="3" fill="#5a422a"/>
  <g class="forge-glow">
    <ellipse cx="74" cy="132" rx="34" ry="14" fill="#ff8a3a" opacity="0.45"/>
    <ellipse cx="74" cy="132" rx="19" ry="8" fill="#ffd27a" opacity="0.7"/>
  </g>
  <path d="M188 150 L188 128 L176 120 L206 110 L252 110 L262 120 L250 128 L250 150 Z"
        fill="#4c5058" stroke="#33363c" stroke-width="2"/>
  <rect x="196" y="150" width="46" height="12" fill="#3b3e44"/>
  <g class="forge-hammer">
    <rect x="-4" y="-56" width="8" height="58" rx="4" fill="#7a5632"/>
    <rect x="-16" y="-70" width="32" height="20" rx="4" fill="#4c5058" stroke="#2f3238" stroke-width="2"/>
  </g>
  <rect class="forge-work" x="196" y="100" width="54" height="8" rx="4" fill="#ffb15a"/>
</svg>`;
