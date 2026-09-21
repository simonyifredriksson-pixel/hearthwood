/* Audio.js — everything you hear, synthesised on the fly.
   ===========================================================================
   There are no sound files in Hearthwood. Every bird, every footstep and
   every note of the music is built out of oscillators and filtered noise at
   runtime, which means the whole game is still one folder of text.

   The design rule for a cozy game: nothing is ever loud, nothing ever starts
   abruptly, and nothing repeats on a period the ear can latch onto. Every
   recurring sound has its interval jittered, and the music never plays the
   same bar twice.

   Browsers refuse to start an AudioContext until the player has interacted
   with the page, so `unlock()` is called from the first real click. Until
   then every call here is a no-op that costs nothing.
*/

import { AUDIO } from './Config.js?v=20260921163240';
import { clamp, lerp, makeRng } from './Util.js?v=20260921163240';

const rnd = makeRng(0x50554e4b);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.enabled = true;
    this.vol = { ...AUDIO };

    this.noiseBuf = null;
    this.beds = {};          // long-running ambience loops
    this.music = null;
    this._nextBird = 0;
    this._nextRustle = 0;
    this._t = 0;

    /* Ambience is driven by "how much of each thing is around me", set every
       frame by the world. A value of 0 means silent, 1 means you are standing
       in it. They cross-fade, so walking from the village into the trees is a
       slow change of texture rather than a cut. */
    this.env = { forest: 0, village: 0, water: 0, wind: 0.35, open: 0, night: 0 };
    this._envSmooth = { ...this.env };
  }

  /* ====================================================================== */
  /* LIFECYCLE                                                               */
  /* ====================================================================== */

  unlock() {
    if (this.ready) return;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    try { this.ctx = new AC(); } catch (e) { this.enabled = false; return; }
    if (this.ctx.state === 'suspended') this.ctx.resume();

    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? this.vol.master : 0;

    // A gentle shelf across everything: nothing in this game should be
    // bright or sharp, and rolling the very top off is most of what makes
    // synthesised audio stop sounding synthetic.
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowshelf';
    this.tone.frequency.value = 220;
    this.tone.gain.value = 2.5;

    this.cut = ctx.createBiquadFilter();
    this.cut.type = 'lowpass';
    this.cut.frequency.value = 9000;
    this.cut.Q.value = 0.5;

    // A short, cheap reverb: woodland has a soft tail and a village square
    // has a longer one. One impulse for both, mixed differently.
    this.rev = ctx.createConvolver();
    this.rev.buffer = this._impulse(2.1, 2.6);
    this.revGain = ctx.createGain();
    this.revGain.gain.value = 0.22;

    this.busSfx = ctx.createGain(); this.busSfx.gain.value = this.vol.sfx;
    this.busAmb = ctx.createGain(); this.busAmb.gain.value = this.vol.ambience;
    this.busMus = ctx.createGain(); this.busMus.gain.value = this.vol.music;

    for (const b of [this.busSfx, this.busAmb, this.busMus]) {
      b.connect(this.tone);
      b.connect(this.revGain);
    }
    this.revGain.connect(this.rev);
    this.rev.connect(this.tone);
    this.tone.connect(this.cut);
    this.cut.connect(this.master);
    this.master.connect(ctx.destination);

    this.noiseBuf = this._noiseBuffer(3.0);
    this.ready = true;

    this._startBeds();
    this._startMusic();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this._ramp(this.master.gain, on ? this.vol.master : 0, 0.3);
  }

  setVolume(kind, v) {
    this.vol[kind] = clamp(v, 0, 1);
    if (!this.ready) return;
    const g = { master: this.master, sfx: this.busSfx, ambience: this.busAmb, music: this.busMus }[kind];
    if (g) this._ramp(g.gain, this.vol[kind], 0.15);
  }

  /* ====================================================================== */
  /* BUILDING BLOCKS                                                         */
  /* ====================================================================== */

  _noiseBuffer(seconds) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // Brownian-ish noise: white noise integrated then normalised. Pure white
    // noise reads as "static"; brown noise reads as "wind" and "water".
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.035 * w) / 1.035;
      d[i] = last * 3.2;
    }
    return buf;
  }

  _impulse(seconds, decay) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        // a little early-reflection sparkle in the first 60 ms, then a smooth tail
        const early = t < 0.03 ? (Math.random() * 2 - 1) * 0.6 : 0;
        d[i] = ((Math.random() * 2 - 1) * Math.pow(1 - t, decay)) * 0.55 + early;
      }
    }
    return buf;
  }

  _ramp(param, to, time = 0.08) {
    const t = this.ctx.currentTime;
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(to, t + time);
  }

  /** A looping filtered-noise voice — the basis of wind, stream and leaves. */
  _noiseVoice({ type = 'bandpass', freq = 500, q = 0.7, gain = 0.1, rate = 1 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g);
    src.start(ctx.currentTime + Math.random() * 0.2);
    return { src, filter: f, gain: g };
  }

  /* ====================================================================== */
  /* AMBIENCE BEDS                                                           */
  /* ====================================================================== */

  _startBeds() {
    const ctx = this.ctx;

    // WIND — two layers at different speeds so the gusts never line up
    this.beds.wind = this._noiseVoice({ type: 'lowpass', freq: 420, q: 0.6, gain: 0.0, rate: 0.55 });
    this.beds.windHi = this._noiseVoice({ type: 'bandpass', freq: 1250, q: 0.8, gain: 0.0, rate: 0.9 });
    // LEAVES — the hiss of a canopy, only audible among trees
    this.beds.leaves = this._noiseVoice({ type: 'bandpass', freq: 3400, q: 0.55, gain: 0.0, rate: 1.35 });
    // WATER — narrow band, faster playback, a brook rather than a river
    this.beds.water = this._noiseVoice({ type: 'bandpass', freq: 1700, q: 1.5, gain: 0.0, rate: 1.7 });
    // VILLAGE — a low murmur, too muddy to make out words
    this.beds.village = this._noiseVoice({ type: 'bandpass', freq: 330, q: 2.2, gain: 0.0, rate: 0.35 });

    for (const k in this.beds) this.beds[k].gain.connect(this.busAmb);

    // slow gust LFO on the wind filter, with an irregular period
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.063;
    const lfoB = ctx.createOscillator(); lfoB.frequency.value = 0.029;
    const lg = ctx.createGain(); lg.gain.value = 160;
    const lgB = ctx.createGain(); lgB.gain.value = 95;
    lfo.connect(lg); lg.connect(this.beds.wind.filter.frequency);
    lfoB.connect(lgB); lgB.connect(this.beds.windHi.filter.frequency);
    lfo.start(); lfoB.start();
    this._gust = { lfo, lfoB };
  }

  /* ====================================================================== */
  /* GENERATIVE MUSIC                                                        */
  /* ====================================================================== */

  /* A slow, sparse, plucked line over a warm pad. Pentatonic, so no interval
     it can pick is dissonant, and the note choice is weighted to walk by
     small steps with the occasional leap — the shape a person humming makes.
     Phrases are separated by real silence; a cozy score is mostly rests. */
  _startMusic() {
    const ctx = this.ctx;
    this.music = {
      root: 0,
      scale: [0, 2, 4, 7, 9],        // major pentatonic
      degree: 2,
      nextNote: ctx.currentTime + 2.5,
      nextChord: ctx.currentTime + 1.0,
      phraseLeft: 5,
      resting: false,
      padGain: ctx.createGain(),
    };
    this.music.padGain.gain.value = 0.0;
    this.music.padGain.connect(this.busMus);
  }

  _pluck(freq, when, vel = 0.5, dur = 2.4) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    // Plucked strings: a fast attack, an exponential body, and a second
    // quieter partial a twelfth up that decays faster. That ratio is most of
    // why this reads as "wooden harp" and not as "sine beep".
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vel, when + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, when + dur);

    const o1 = ctx.createOscillator(); o1.type = 'triangle'; o1.frequency.value = freq;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 3.01;
    const g2 = ctx.createGain(); g2.gain.setValueAtTime(vel * 0.20, when);
    g2.gain.exponentialRampToValueAtTime(0.0004, when + dur * 0.35);

    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(Math.min(7000, freq * 9), when);
    f.frequency.exponentialRampToValueAtTime(Math.max(300, freq * 2.2), when + dur * 0.8);

    o1.connect(g); o2.connect(g2); g2.connect(g);
    g.connect(f); f.connect(this.busMus);
    o1.start(when); o2.start(when);
    o1.stop(when + dur + 0.1); o2.stop(when + dur + 0.1);
  }

  _pad(freqs, when, dur = 9) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.055, when + 2.8);
    g.gain.setValueAtTime(0.055, when + dur - 3.2);
    g.gain.linearRampToValueAtTime(0, when + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 900; f.Q.value = 0.4;
    g.connect(f); f.connect(this.music.padGain);
    this.music.padGain.gain.value = 1;
    for (const fr of freqs) {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = fr;
      // a touch of detune per voice so the chord breathes instead of sitting still
      const d = ctx.createOscillator(); d.type = 'sine'; d.frequency.value = fr * 1.004;
      const dg = ctx.createGain(); dg.gain.value = 0.6;
      o.connect(g); d.connect(dg); dg.connect(g);
      o.start(when); d.start(when);
      o.stop(when + dur + 0.2); d.stop(when + dur + 0.2);
    }
  }

  _updateMusic(t) {
    const m = this.music;
    if (!m) return;

    if (t > m.nextChord) {
      const base = 110 * Math.pow(2, m.root / 12);
      const chords = [[0, 7, 16], [0, 9, 16], [5, 12, 21], [-5, 7, 14]];
      const c = rnd.pick(chords);
      this._pad(c.map(s => base * Math.pow(2, s / 12)), t + 0.05, 11);
      m.nextChord = t + 9.5 + rnd.range(0, 2.5);
    }

    if (t > m.nextNote) {
      if (m.resting) {
        m.resting = false;
        m.phraseLeft = rnd.int(3, 7);
        m.nextNote = t + 0.1;
        return;
      }
      // walk by a small step most of the time, leap occasionally
      const step = rnd.chance(0.72) ? rnd.pick([-1, 1]) : rnd.pick([-3, -2, 2, 3]);
      m.degree = clamp(m.degree + step, -4, 11);
      const oct = Math.floor(m.degree / m.scale.length);
      const idx = ((m.degree % m.scale.length) + m.scale.length) % m.scale.length;
      const semi = m.scale[idx] + oct * 12 + m.root;
      const freq = 261.63 * Math.pow(2, semi / 12);
      this._pluck(freq, t + 0.02, rnd.range(0.10, 0.20), rnd.range(2.0, 3.6));
      // a quiet harmony note now and then, a sixth below
      if (rnd.chance(0.22)) this._pluck(freq * 0.6, t + 0.09, 0.055, 2.4);

      m.phraseLeft--;
      if (m.phraseLeft <= 0) {
        m.resting = true;
        m.nextNote = t + rnd.range(3.5, 7.0);   // real silence between phrases
      } else {
        m.nextNote = t + rnd.pick([0.52, 0.52, 0.78, 1.04, 1.56]);
      }
    }
  }

  /* ====================================================================== */
  /* ONE-SHOTS                                                               */
  /* ====================================================================== */

  /** A short filtered noise burst — the basis of footsteps and rustles. */
  _burst({ freq = 900, q = 1, dur = 0.14, gain = 0.2, type = 'bandpass', rate = 1, bus = null, when = 0 }) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const t = when || ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = rate;
    const off = Math.random() * (this.noiseBuf.duration - dur - 0.05);
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + Math.min(0.012, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f); f.connect(g); g.connect(bus || this.busSfx);
    src.start(t, off, dur + 0.05);
    src.stop(t + dur + 0.06);
  }

  /** A short pitched blip — chimes, UI, pickups. */
  _tone({ freq = 660, dur = 0.3, gain = 0.15, type = 'sine', when = 0, slide = 0, bus = null }) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const t = when || ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * slide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    o.connect(g); g.connect(bus || this.busSfx);
    o.start(t); o.stop(t + dur + 0.05);
  }

  /* ------------------------------------------------------------ the kit */

  /** A footstep. `surface` changes the timbre completely, which is most of
   *  what tells you whether you are on a path, in leaf litter or in a stream. */
  step(surface = 'grass', weight = 1, speed = 1) {
    if (!this.ready || !this.enabled) return;
    const v = 0.055 * weight * lerp(0.7, 1.15, clamp(speed, 0, 1.4));
    switch (surface) {
      case 'stone':
        this._burst({ freq: 2100, q: 1.4, dur: 0.075, gain: v * 1.15, rate: 1.4 });
        this._tone({ freq: rnd.range(150, 210), dur: 0.05, gain: v * 0.35, type: 'triangle', slide: 0.6 });
        break;
      case 'wood':
        this._burst({ freq: 700, q: 2.2, dur: 0.11, gain: v * 1.1, rate: 0.9 });
        this._tone({ freq: rnd.range(90, 135), dur: 0.10, gain: v * 0.5, type: 'sine', slide: 0.7 });
        break;
      case 'leaves':
        this._burst({ freq: 3900, q: 0.5, dur: 0.20, gain: v * 1.25, rate: 1.5 });
        this._burst({ freq: 1400, q: 0.7, dur: 0.13, gain: v * 0.5, rate: 1.1 });
        break;
      case 'water':
        this._burst({ freq: 1500, q: 0.6, dur: 0.24, gain: v * 1.3, rate: 1.7 });
        this._tone({ freq: rnd.range(420, 720), dur: 0.14, gain: v * 0.25, type: 'sine', slide: 1.7 });
        break;
      case 'mud':
        this._burst({ freq: 420, q: 1.1, dur: 0.17, gain: v * 1.1, rate: 0.7 });
        break;
      default: // grass / moss
        this._burst({ freq: 1900, q: 0.6, dur: 0.145, gain: v, rate: 1.25 });
        this._burst({ freq: 480, q: 0.9, dur: 0.09, gain: v * 0.45, rate: 0.8 });
    }
  }

  /** Picking up a stick: a dry wooden knock and a small rising chime. */
  pickup(rarity = 0) {
    if (!this.ready || !this.enabled) return;
    const t = this.ctx.currentTime;
    this._burst({ freq: 900 + rnd.range(-160, 160), q: 3.4, dur: 0.1, gain: 0.16, rate: 1.0, when: t });
    this._tone({ freq: 520, dur: 0.16, gain: 0.05, type: 'triangle', when: t + 0.01, slide: 1.4 });
    // rarer finds get a longer, higher sparkle — the feedback is the reward
    const notes = [[0], [0, 7], [0, 7, 12], [0, 7, 12, 16]][clamp(rarity, 0, 3)];
    notes.forEach((s, i) => {
      this._tone({ freq: 784 * Math.pow(2, s / 12), dur: 0.5 + i * 0.16, gain: 0.052, type: 'sine', when: t + 0.05 + i * 0.075 });
    });
  }

  /** The satchel is full — a soft dull thud, never a buzzer. */
  denied() {
    this._burst({ freq: 260, q: 2.5, dur: 0.16, gain: 0.11, rate: 0.7 });
  }

  /** The Stickwright's workbench: a rasp, then the weapon settling. */
  craft() {
    if (!this.ready || !this.enabled) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 5; i++) {
      this._burst({ freq: 1700 + i * 190, q: 1.1, dur: 0.16, gain: 0.085, rate: 1.2, when: t + i * 0.135 });
    }
    this._burst({ freq: 560, q: 2.5, dur: 0.22, gain: 0.15, rate: 0.9, when: t + 0.76 });
    [0, 4, 7, 12].forEach((s, i) => this._tone({
      freq: 392 * Math.pow(2, s / 12), dur: 1.5, gain: 0.07, type: 'triangle', when: t + 0.8 + i * 0.085,
    }));
  }

  /** A weapon swing — air, then wood. */
  swing(weight = 1) {
    if (!this.ready || !this.enabled) return;
    const t = this.ctx.currentTime;
    this._burst({ freq: 700 / weight, q: 0.8, dur: 0.24 * weight, gain: 0.09 * weight, rate: 1.4 / weight, when: t });
  }

  /** Soft UI tick. */
  ui(kind = 'tick') {
    const map = {
      tick: { freq: 1180, dur: 0.055, gain: 0.05, type: 'sine' },
      open: { freq: 520, dur: 0.22, gain: 0.06, type: 'triangle', slide: 1.5 },
      close: { freq: 700, dur: 0.18, gain: 0.05, type: 'triangle', slide: 0.6 },
      good: { freq: 880, dur: 0.3, gain: 0.07, type: 'sine', slide: 1.26 },
    };
    this._tone(map[kind] || map.tick);
  }

  /** Someone said something — a wordless two-note lilt, per speaker pitch. */
  voice(pitch = 1) {
    if (!this.ready || !this.enabled) return;
    const t = this.ctx.currentTime;
    const f = 300 * pitch;
    const n = rnd.int(2, 3);
    for (let i = 0; i < n; i++) {
      this._tone({
        freq: f * rnd.range(0.85, 1.35), dur: 0.1, gain: 0.035, type: 'triangle',
        when: t + i * 0.105, slide: rnd.range(0.85, 1.2),
      });
    }
  }

  /** A single bird call, scheduled from the ambience update. */
  _bird() {
    if (!this.ready || !this.enabled) return;
    const t = this.ctx.currentTime;
    const base = rnd.range(1800, 3400);
    const kind = rnd.int(0, 3);
    if (kind === 0) {            // two-note whistle
      this._tone({ freq: base, dur: 0.16, gain: 0.028, type: 'sine', when: t, slide: 1.18 });
      this._tone({ freq: base * 1.2, dur: 0.2, gain: 0.024, type: 'sine', when: t + 0.22, slide: 0.88 });
    } else if (kind === 1) {     // quick trill
      for (let i = 0; i < rnd.int(3, 6); i++) {
        this._tone({ freq: base * rnd.range(0.92, 1.1), dur: 0.055, gain: 0.02, type: 'sine', when: t + i * 0.062 });
      }
    } else if (kind === 2) {     // a long descending call
      this._tone({ freq: base * 1.3, dur: 0.5, gain: 0.022, type: 'sine', when: t, slide: 0.62 });
    } else {                     // a soft dove-like coo, low and round
      this._tone({ freq: rnd.range(420, 520), dur: 0.34, gain: 0.03, type: 'sine', when: t, slide: 0.92 });
      this._tone({ freq: rnd.range(400, 470), dur: 0.42, gain: 0.026, type: 'sine', when: t + 0.42, slide: 0.9 });
    }
  }

  /** A cricket, for dusk. */
  _cricket() {
    if (!this.ready || !this.enabled) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      this._burst({ freq: 4600, q: 22, dur: 0.035, gain: 0.02, rate: 1.6, when: t + i * 0.09 });
    }
  }

  /* ====================================================================== */
  /* PER-FRAME                                                               */
  /* ====================================================================== */

  /** @param env {forest, village, water, wind, open, night} all 0..1 */
  update(dt, env) {
    if (!this.ready || !this.enabled) return;
    this._t += dt;
    const t = this.ctx.currentTime;

    if (env) Object.assign(this.env, env);
    const s = this._envSmooth;
    for (const k in this.env) s[k] = lerp(s[k], this.env[k], 1 - Math.exp(-1.6 * dt));

    // cross-fade the beds. These numbers are quiet on purpose — ambience you
    // notice is ambience that is too loud.
    this.beds.wind.gain.gain.value = lerp(0.028, 0.10, s.wind) * lerp(1, 1.5, s.open);
    this.beds.windHi.gain.gain.value = lerp(0.006, 0.05, s.wind) * lerp(0.4, 1, s.open);
    this.beds.leaves.gain.gain.value = 0.062 * s.forest * lerp(0.45, 1.25, s.wind);
    this.beds.water.gain.gain.value = 0.16 * s.water;
    this.beds.village.gain.gain.value = 0.055 * s.village * (1 - s.night * 0.75);

    // Birds: common by day in the wood, rarer in the open, silent at night.
    // The interval is randomised every time so it never forms a rhythm.
    const birdRate = (0.55 + s.forest * 1.5 + s.village * 0.5) * (1 - s.night * 0.9);
    if (this._t > this._nextBird) {
      if (birdRate > 0.15) this._bird();
      this._nextBird = this._t + rnd.range(1.2, 7.5) / Math.max(0.18, birdRate);
    }
    if (s.night > 0.35 && this._t > this._nextRustle) {
      this._cricket();
      this._nextRustle = this._t + rnd.range(0.8, 3.2);
    }

    // the whole mix gets darker at night, like the air has thickened
    this.cut.frequency.value = lerp(9000, 5200, s.night);
    this.revGain.gain.value = lerp(0.16, 0.30, s.open) * lerp(1, 0.75, s.village);

    this._updateMusic(t);
  }
}

export const audio = new AudioEngine();
