/* main.js — Hearthwood.
   ===========================================================================
   Boot, the character choice, and the one loop that drives everything.

   ORDER OF A FRAME, and it matters:
     1. input           — read, once, into one place
     2. camera          — the basis everything else steers by
     3. player          — moves using that basis, so they can never disagree
     4. world           — streams tiles and lights around where the player IS
     5. npcs            — react to where the player ended up
     6. interaction     — decided after everyone has moved, so the prompt is
                          about this frame and not the last one
     7. ui, then render
*/

import * as THREE from '../lib/three.module.js?v=1790014288';
import { input } from './core/Input.js?v=1790014288';
import { CameraRig } from './core/CameraRig.js?v=1790014288';
import { audio } from './core/Audio.js?v=1790014288';
import { bus, EV } from './core/Bus.js?v=1790014288';
import { BUILD, RENDER, WORLD, GAME, PLAYER } from './core/Config.js?v=1790014288';
import { clamp, clamp01, lerp, now, Rolling } from './core/Util.js?v=1790014288';

import { MATS } from './art/Materials.js?v=1790014288';
import { World } from './world/World.js?v=1790014288';
import { Player } from './game/Player.js?v=1790014288';
import { NPCs } from './game/NPCs.js?v=1790014288';
import { GameState } from './game/State.js?v=1790014288';
import { SPECIES } from './game/Anim.js?v=1790014288';
import { weaponMeshes } from './art/WeaponArt.js?v=1790014288';
import { rodMeshes } from './art/RodArt.js?v=1790014288';
import { WEAPON_CLASSES } from './data/WeaponData.js?v=1790014288';
import { RARITY } from './art/Palette.js?v=1790014288';
import { STICKWRIGHT, FISHERMAN } from './data/VillagerData.js?v=1790014288';
import { RARE } from './data/StickData.js?v=1790014288';
import { STARTER_ROD } from './data/RodData.js?v=1790014288';

import { UI } from './ui/UI.js?v=1790014288';
import { Talk } from './ui/Talk.js?v=1790014288';
import { RodShop } from './ui/RodShop.js?v=1790014288';
import { Hotbar } from './ui/Hotbar.js?v=1790014288';
import { MapScreen } from './ui/MapScreen.js?v=1790014288';
import { Fog } from './game/MapData.js?v=1790014288';
import { Effects } from './game/Effects.js?v=1790014288';
import { SatchelScreen, Turntable } from './ui/Satchel.js?v=1790014288';
import { WorkshopScreen, RevealScreen } from './ui/Workshop.js?v=1790014288';
import { ForgeScene } from './game/Forge.js?v=1790014288';
import { Workers } from './game/Workers.js?v=1790014288';
import { Wildlife } from './game/Wildlife.js?v=1790014288';
import { Fishing, FISH_STATE } from './game/Fishing.js?v=1790014288';
import { FishingUI } from './ui/FishingUI.js?v=1790014288';
import { Quest, FESTIVAL_SPEECH } from './game/Quest.js?v=1790014288';
import { CHARGE } from './game/Combat.js?v=1790014288';
import { ic } from './ui/Icons.js?v=1790014288';

/* ========================================================================= */

const canvas = document.getElementById('view');
const bootEl = document.getElementById('boot');
const bootBar = document.getElementById('boot-bar');
const bootText = document.getElementById('boot-text');

const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, powerPreference: 'high-performance', stencil: false,
});
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
/* ACES + the sRGB encode are done by three.js itself. There is deliberately
   no custom post pass: a hand-written composite shader has to remember to do
   the sRGB encode at the end of its fragment shader, and forgetting it makes
   the whole game a gamma too dark in a way that is invisible until somebody
   says "I can't see anything". Letting three.js own the transform removes
   the entire class of bug. */
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(RENDER.fov, innerWidth / innerHeight, RENDER.near, RENDER.far);
const rig = new CameraRig(camera);

input.attach(canvas);

const G = {
  state: null, world: null, player: null, npcs: null, ui: null,
  workers: null, wildlife: null, fishing: null, fishUI: null, quest: null, forge: null,
  talk: null, rodShop: null, hotbar: null, fog: null,
  fx: null, turntable: null,
  /* the cutscene director needs these two by name */
  scene, rig,
  mode: 'boot',            // boot | play
  t: 0, frames: 0,
  target: null,            // what E would act on
  autosave: 0,
  fps: new Rolling(40),
  hintShown: {},
};
globalThis.HEARTHWOOD = G;

/* ========================================================================= */
/* BOOT                                                                      */
/* ========================================================================= */

function setBoot(p, label) {
  if (bootBar) bootBar.style.width = Math.round(clamp01(p) * 100) + '%';
  if (bootText && label) bootText.textContent = label.toUpperCase();
}

async function boot() {
  setBoot(0.02, 'waking the wood');

  G.ui = new UI({ audio });
  G.turntable = new Turntable();

  G.world = new World(scene, { onProgress: (p, l) => setBoot(0.05 + p * 0.85, l) });
  await G.world.build();
  G.world.audio = audio;

  G.npcs = new NPCs(G.world, scene);
  G.npcs.spawn();

  /* the survey crews out in the wood, and the two systems the tutorial
     hands the player on its way through */
  G.workers = new Workers(G.world, scene);
  G.workers.plan(7);
  G.wildlife = new Wildlife(G.world, scene);
  G.fishing = new Fishing({ audio });
  G.fishUI = new FishingUI(document.getElementById('ui'));
  G.audio = audio;
  G.forge = new ForgeScene(G);
  G.fx = new Effects(scene);
  G.talk = new Talk(document.getElementById('ui'), { audio });

  setBoot(0.96, 'lighting the lanterns');
  await new Promise(r => setTimeout(r, 60));

  /* --- warm the pipeline so the first frame is not a two-second hitch --- */
  renderer.compile(scene, camera);

  const saved = GameState.load();
  G.state = saved || new GameState();
  /* the shop needs the purse, so it is built after the save has loaded */
  G.rodShop = new RodShop(document.getElementById('ui'), G.state, {
    audio,
    onBuy: rod => G.ui.toast({
      text: rod.name, sub: 'A better rod. The water will feel different.',
      icon: 'spark', tone: 'rare', ms: 5200,
    }),
  });
  G.fog = new Fog(G.state.explored);
  G.hotbar = new Hotbar(document.getElementById('ui'), G.state, {
    audio,
    onSelect: () => { if (G.player) equipFromState(); },
  });
  if (saved) {
    G.world.takenSticks = new Set(saved.taken);
    G.world.sky.setPhase(saved.dayPhase ?? 0.70);
  }

  setBoot(1, 'ready');
  bootEl.classList.add('gone');
  setTimeout(() => bootEl.remove(), 900);

  /* THERE IS NO CHARACTER SELECT ANY MORE.
     FISH N STICKS has one protagonist — the fox — so the game starts in the
     wood rather than on a menu. A returning save resumes where it stopped;
     a new one begins at the festival. */
  startGame('fox', saved);

  requestAnimationFrame(frame);
}

/* ========================================================================= */
/* START                                                                     */
/* ========================================================================= */

function startGame(species, saved) {
  G.state.species = species;
  G.player = new Player(G.world, species);
  G.player.addTo(scene);

  if (saved?.pos) {
    G.player.x = saved.pos[0];
    G.player.z = saved.pos[2];
    G.player.yaw = saved.pos[3] ?? Math.PI;
  } else {
    /* start on the green, facing the workshop, so the first thing you see is
       a village with somebody in it */
    const a = G.world.village.anchors;
    const p = G.world.plan.plaza;
    G.player.x = p.x + 6;
    G.player.z = p.z + 12;
    if (a?.stickwright) G.player.yaw = Math.atan2(a.stickwright.x - G.player.x, a.stickwright.z - G.player.z);
  }
  G.player.y = G.world.groundAt(G.player.x, G.player.z);

  /* Build the ground you are about to stand on BEFORE handing over control.
     Otherwise the first three seconds are spent watching the wood assemble
     itself around you, which is the worst possible first impression for a
     game whose whole pitch is that the wood is already there. */
  setBoot(0.98, 'growing the near wood');
  G.world.prebuild(G.player.x, G.player.z);

  rig.reset({ x: G.player.x, y: G.player.y, z: G.player.z, yaw: G.player.yaw + Math.PI, preset: 'roam' });
  rig.setProbe((x, z) => G.world.groundAt(x, z));

  /* THE FIRST FORGE FESTIVAL. A returning player resumes wherever they got
     to; a new one starts at the speech. */
  G.quest = new Quest(G);
  G.quest.start(saved ? (saved.questStep || 'done') : null);
  if (G.quest.inSpeech) setTimeout(() => runFestival(), 900);

  G.player.onStep = (surface, rel) => audio.step(surface, SPECIES[species].carryScale, rel);

  if (G.state.equipped) equipFromState();

  G.mode = 'play';
  input.blocked = false;

  G.ui.setSatchel(G.state.sticks.length, G.state.capacity);
  G.ui.setWeapon(G.state.equippedWeapon);

  bus.emit(EV.GAME_START, { species });

  if (!saved) {
    setTimeout(() => G.ui.toast({
      text: `You are ${SPECIES[species].name} the ${SPECIES[species].label.toLowerCase()}.`,
      sub: 'The wood begins past the fences. Look down while you walk.',
      icon: 'paw', ms: 6500,
    }), 900);
    setTimeout(() => G.ui.toast({
      text: 'Old Nissel keeps the workshop on the green.',
      sub: 'Bring her anything interesting you find.',
      icon: 'home', ms: 6500,
    }), 7200);
  }
}

/* ========================================================================= */
/* INTERACTION                                                               */
/* ========================================================================= */

function pickTarget() {
  const P = G.player;
  if (!P || P.busy) return null;

  /* SOMEBODY TO TALK TO BEATS EVERYTHING.
     The fisherman stands behind a booth with crates and barrels round it,
     and a stick on the ground next to the counter used to win the reach
     test — so walking up to sell a creel picked up a twig instead. */
  const npc = G.npcs.nearest(P.x, P.z, PLAYER.npcTalkRange);
  if (npc) return { kind: 'npc', npc, dist: Math.hypot(npc.x - P.x, npc.z - P.z) };

  /* WATER, if the rod is out.
     This is the whole of "go fishing": hold the rod, walk to any water in
     the world, press E. There is no fishing spot, no marked jetty and no
     permission — a lake is a lake. */
  if (G.state.holdingRod && !G.fishing.active) {
    const w = nearWater(P.x, P.z);
    if (w) return { kind: 'water', spot: w, dist: Math.hypot(w.x - P.x, w.z - P.z) };
  }

  const s = G.world.nearestStick(P.x, P.z, P.reach);
  if (s) return { kind: 'stick', stick: s, dist: Math.hypot(s.x - P.x, s.z - P.z) };

  return null;
}

function updatePrompt() {
  const t = G.target;
  if (!t) { G.ui.setPrompt(null); return; }
  if (t.kind === 'stick') {
    const tier = clamp(t.stick.spec.tier ?? 0, 0, RARITY.length - 1);
    G.ui.setPrompt(t.stick.spec.name, {
      key: 'E', icon: 'stick', tone: tier >= 2 ? 'rare' : '',
    });
  } else if (t.kind === 'npc') {
    const n = t.npc;
    G.ui.setPrompt(n.isStickwright ? `Talk to ${n.name}, ${n.title}` : `Talk to ${n.name}`, {
      key: 'E', icon: n.isStickwright ? 'hammer' : 'home',
    });
  } else if (t.kind === 'water') {
    G.ui.setPrompt('Cast a line', { key: 'E', icon: 'drop' });
  }
}

function doInteract() {
  const t = G.target;
  if (!t || !G.player || G.player.busy) return;

  if (t.kind === 'stick') {
    if (G.state.full) {
      audio.denied();
      G.ui.toast({ text: 'The satchel will not take another stick.', icon: 'satchel', tone: 'warn' });
      return;
    }
    const s = t.stick;
    G.player.lookAt = [s.x, s.y + 0.2, s.z];
    G.player.startAction('pick', 0.62, () => {
      const spec = G.world.takeStick(s.key);
      if (!spec) return;
      const res = G.state.addStick(spec, s.key);
      if (!res.ok) return;
      const tier = clamp(spec.tier ?? 0, 0, RARITY.length - 1);
      audio.pickup(tier);
      G.ui.setSatchel(G.state.sticks.length, G.state.capacity);
      if (res.discovery) {
        G.ui.discovery({
          title: spec.name,
          sub: RARE[spec.rare]?.desc?.split('.')[0] + '.',
          tier,
        });
      } else if (tier >= 2) {
        G.ui.toast({ text: spec.name, sub: RARITY[tier].name, icon: 'spark', tone: 'rare' });
      }
      G.player.lookAt = null;
      maybeHint();
    });
  } else if (t.kind === 'npc') {
    talkTo(t.npc);
  } else if (t.kind === 'water') {
    startFishing(t.spot);
  }
}

async function talkTo(npc) {
  G.player.lookAt = [npc.x, npc.y + npc.rig.metrics.eyeHeight, npc.z];
  npc.talkT = Math.max(npc.talkT, 4);
  npc.targetYaw = Math.atan2(G.player.x - npc.x, G.player.z - npc.z);
  audio.voice(npc.voice);

  if (npc.isStickwright) {
    const first = !G.state.metNPCs.has('stickwright');
    G.state.metNPCs.add('stickwright');
    const has = G.state.sticks.length > 0;
    const line = first
      ? 'So. You are the one who has been looking at the ground. Good. ' +
      'Everyone here walks over a hundred stories a day and never once looks down.'
      : (has ? pick(STICKWRIGHT.greet) : pick(STICKWRIGHT.greetEmpty));

    const choice = await G.ui.say(`${npc.name}, ${npc.title}`, line, [
      { id: 'craft', label: has ? 'Show her the wood' : 'Ask what she needs', icon: 'hammer' },
      { id: 'talk', label: 'Ask her about the wood', icon: 'leaf' },
      { id: 'bye', label: 'Leave her to it', icon: 'chevron' },
    ]);

    if (choice === 'craft') {
      if (!has) {
        await G.ui.say(npc.name, 'Wood, child. Any wood. A branch, a twig, a limb — ' +
          'bring it here and I will tell you what is inside it. The far side of the fences ' +
          'is thick with it and none of it is doing anybody any good lying there.');
      } else {
        openWorkshop();
      }
    } else if (choice === 'talk') {
      await G.ui.say(npc.name, pick(STICKWRIGHT.idle));
      audio.voice(npc.voice);
    }
    G.player.lookAt = null;
    return;
  }

  /* --- the Fisherman: buys fish, sells rods ----------------------------
     The busiest conversation in the game, so it does NOT open a screen.
     Four choices, exactly as specified, in a small panel beside him with
     the river still visible behind it. */
  if (npc.isFisherman) {
    const first = !G.state.hasRod;
    G.state.metNPCs.add('fisherman');
    if (!first) { await fishermanShop(npc); G.player.lookAt = null; return; }
    if (first) {
      /* His four opening lines, one box at a time. It is the only place in
         the game that plays a fixed script at the player, and it is four
         lines long for exactly that reason. */
      for (const line of FISHERMAN.first) {
        await G.ui.say(`${npc.name}, ${npc.title}`, line);
      }
      /* THE ROD IS AN ITEM, not a permission flag. It goes into the pack,
         it goes into the paw, and from then on fishing is "hold the rod,
         walk to water" rather than a key you are told about once. */
      G.state.giveRod(STARTER_ROD);
      G.state.holding = 'rod';
      G.quest?.noteRod();
      G.state.save();
      G.ui.toast({
        text: G.state.currentRod.name,
        sub: 'It is in your paws. Find water and press E.',
        icon: 'drop', tone: 'rare', ms: 7000,
      });
      audio.craft?.();
    }
    G.player.lookAt = null;
    return;
  }

  G.state.metNPCs.add(npc.name);
  await G.ui.say(npc.name, G.npcs.line(npc));
  G.player.lookAt = null;
}


/* ========================================================================= */
/* THE FISHERMAN                                                             */
/* ========================================================================= */

const money = n => '$' + Math.round(n).toLocaleString('en-US');

/**
 * Sell fish, buy rods, go away again.
 *
 * A LOOP, not a script. Selling one fish should not throw you out of the
 * conversation to walk back up to him, so the panel comes straight back
 * with the creel one lighter — which is how you clear forty perch without
 * forty separate conversations.
 *
 * The four options and the four replies are exactly as briefed.
 */
async function fishermanShop(npc) {
  const S = G.state;
  const who = npc.name, title = npc.title || 'Fisherman';
  const village = npc.village || 'home';

  for (;;) {
    const n = S.sellableCount;
    const worth = S.sellableValue;
    const best = S.bestInCreel;
    const line = S.fish.length === 0
      ? pick(FISHERMAN.greetEmpty || FISHERMAN.greet)
      : (S.stats.fish > 0 ? pick(FISHERMAN.proud) : pick(FISHERMAN.greet));

    const choice = await G.talk.ask(who, title, line, [
      {
        id: 'one', label: 'I want to sell this', icon: 'drop',
        note: best && !best.fav ? `${best.name} · ${money(S.valueOf(best))}` : null,
        disabled: !n,
      },
      {
        id: 'all', label: 'I want to sell all my fish', icon: 'satchel',
        note: n ? `${n} fish · ${money(worth)}` : 'nothing to sell',
        disabled: !n,
      },
      { id: 'rods', label: 'Can I see your fishing rods?', icon: 'spark' },
      { id: 'bye', label: 'Nevermind', icon: 'chevron' },
    ]);

    if (choice === null || choice === 'bye') {
      G.talk.say(who, title, 'See you later!');
      return;
    }

    if (choice === 'one') {
      /* "this" is whatever is worth most and is not starred — which is what
         a player means when they hold one thing up to a buyer. */
      const pickFish = S.fish.filter(f => !f.fav)
        .sort((a, b) => S.valueOf(b) - S.valueOf(a))[0];
      if (!pickFish) continue;
      const r = S.sellFish(pickFish.uid);
      if (r.ok) {
        audio.pickup?.(2);
        G.ui.toast({
          text: `Sold: ${pickFish.name}`, sub: `+${money(r.coin)}`,
          icon: 'drop', tone: 'rare', ms: 3200,
        });
        G.talk.say(who, title, "Here's your money.");
        S.save();
      }
      await wait(700);
      continue;
    }

    if (choice === 'all') {
      const r = S.sellAllFish();
      if (r.ok) {
        audio.pickup?.(3);
        G.ui.toast({
          text: `Sold ${r.count} fish`, sub: `+${money(r.coin)}` +
            (r.kept ? ` · ${r.kept} kept back` : ''),
          icon: 'satchel', tone: 'rare', ms: 4200,
        });
        G.talk.say(who, title, "Here's your money.");
        S.save();
      }
      await wait(900);
      continue;
    }

    if (choice === 'rods') {
      G.talk.close(null);
      G.talk.say(who, title, 'Take a look at what I have.', { ms: 2600 });
      await G.rodShop.show(village, who);
      S.save();
      continue;
    }
  }
}

const wait = ms => new Promise(r => setTimeout(r, ms));

/* ========================================================================= */
/* THE FIRST FORGE FESTIVAL                                                  */
/* ========================================================================= */

/**
 * The opening.
 *
 * The Elder's speech is the only time the game takes the controls, so it is
 * kept to what it needs: the camera settles on the stage, the lines play one
 * at a time, and any key skips to the end. Thirteen short lines is about
 * forty seconds at a reading pace, and it can be skipped in one press.
 */
async function runFestival() {
  const P = G.player;
  const plaza = G.world.plan.plaza;

  G.ui.banner({
    kicker: 'The First Forge Festival',
    title: 'Every nine years, the wood asks something of you.',
    long: true, ms: 4200,
  });

  // face the stage and hold still
  P.yaw = Math.atan2(plaza.x - P.x, plaza.z - P.z);
  rig.applyPreset('close');

  for (let i = 0; i < FESTIVAL_SPEECH.length; i++) {
    if (!G.quest || G.quest.speechDone) break;
    const line = FESTIVAL_SPEECH[i];
    /* The first box offers a way out. A thirteen-line speech is the right
       length the first time and far too long the second, and a returning
       player who has wiped their save should not have to sit through it. */
    const opts = i === 0
      ? [{ id: 'on', label: 'Listen', icon: 'leaf' },
         { id: 'skip', label: 'Skip the speech', icon: 'chevron' }]
      : null;
    const c = await G.ui.say(line.who, line.text, opts);
    if (c === 'skip') break;
  }

  G.quest?.finishSpeech();
  rig.applyPreset('roam');
  G.ui.banner({
    title: 'Find a stick worthy of you.',
    sub: 'The wood is past the fences. Look down.',
  });
}

/* --- what the systems report back ------------------------------------- */

bus.on(EV.FISH_CAUGHT, ({ fish }) => {
  G.state.addFish(fish);
  G.quest?.noteFish();
  G.state.save();
  G.fishUI.reveal(fish).then(() => {
    G.fishing.reset();
    G.fishing.state = 'idle';
  });
});

bus.on(EV.FISH_LOST, () => {
  setTimeout(() => { if (G.fishing) { G.fishing.reset(); G.fishing.state = 'idle'; } }, 1400);
});

/* A VILLAGE IS PEOPLED THE MOMENT IT IS RAISED.
   The world builds the geometry when the player comes within four hundred
   metres; this puts a fisherman behind its booth and a few residents in
   its doorways at the same instant, so nobody ever walks into an empty
   set of houses. */
bus.on(EV.VILLAGE_FOUND, ({ village, outpost }) => {
  G.npcs?.populate(outpost);
  if (!G.state.seenVillages.has(village.id)) {
    G.state.seenVillages.add(village.id);
    G.state.save();
    G.ui.banner({
      kicker: 'a village',
      title: village.name,
      sub: village.blurb,
      ms: 6200,
    });
    audio.craft?.();
  }
});

bus.on(EV.CAMP_CLEARED, ({ total }) => {
  G.state.stats.scared++;
  G.ui.toast({
    text: 'They have packed up and gone',
    sub: total === 1 ? 'One clearing saved. There are others.' : `${total} clearings saved.`,
    icon: 'leaf', tone: 'rare', ms: 6000,
  });
  G.state.save();
});
/* ========================================================================= */
/* FISHING                                                                   */
/* ========================================================================= */

function startFishing(spot = null) {
  if (!G.state.hasRod || G.fishing.active) return;
  const P = G.player;
  const s = spot || nearWater(P.x, P.z);
  if (!s) {
    G.ui.toast({ text: 'No water within reach.', icon: 'drop', tone: 'warn' });
    return;
  }
  if (!G.state.holdingRod) G.state.holding = 'rod';
  P.yaw = Math.atan2(s.x - P.x, s.z - P.z);
  /* THE ROD IS PART OF THE CAST, not decoration. Its reach caps how deep
     the water counts as, its lure sets how long the wait is, and its luck
     and fortune bias what is down there — so a better rod genuinely changes
     what comes out of the same pond. */
  const rod = G.state.currentRod;
  G.fishing.cast({
    ...s,
    depth: Math.min(s.depth ?? 0.45, rod.reach),
    remoteness: clamp01(Math.hypot(P.x - WORLD.village.cx, P.z - WORLD.village.cz) / 700),
    night: G.world.sky.night,
    rod,
  });
}

/**
 * Is there fishable water near enough to cast into?
 * Samples a ring around the player rather than testing the river's formula,
 * so a pond or a widened bend works too.
 */
function nearWater(x, z) {
  const W = G.world;
  for (let ring = 2.5; ring <= 9; ring += 1.6) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const px = x + Math.cos(a) * ring, pz = z + Math.sin(a) * ring;
      if (W.terrain.waterAt && W.terrain.waterAt(px, pz)) {
        return { x: px, z: pz, depth: 0.45, seed: Math.floor(px * 13 + pz * 7) };
      }
    }
  }
  return null;
}

const pick = arr => arr[Math.floor(Math.random() * arr.length)];

/* ========================================================================= */
/* SCREENS                                                                   */
/* ========================================================================= */

/* THE MAP.
   Opened with M. The fog is revealed by walking, never by opening it, so
   this only ever draws what has already been earned. */
function openMap() {
  if (G.ui.busy || G.forge?.busy) return;
  G.ui.push(new MapScreen(G));
}

function openSatchel() {
  if (G.ui.busy) return;
  const s = new SatchelScreen(G.state, G.ui, G.turntable);
  G.ui.push(s);
  requestAnimationFrame(() => G.turntable.attach(s.el.querySelector('#tt-slot')));
  const reattach = () => G.turntable.attach(s.el.querySelector('#tt-slot'));
  s.el.addEventListener('click', () => requestAnimationFrame(reattach));
}

function openWorkshop() {
  if (G.ui.busy || G.forge?.busy) return;
  const s = new WorkshopScreen(G.state, G.ui, G.turntable, {
    audio,
    onForge: stick => runForge(stick),
  });
  G.ui.push(s);
  requestAnimationFrame(() => G.turntable.attach(s.el.querySelector('#tt-slot')));
  s.el.addEventListener('click', () => requestAnimationFrame(() => G.turntable.attach(s.el.querySelector('#tt-slot'))));
}

/**
 * THE FORGE, END TO END.
 *
 * The shop screen has already closed itself; this runs the cutscene in the
 * world, then puts the card up. `G.state.craft` is handed to the director as
 * a closure rather than being called here, because the director decides WHEN
 * the wood stops being wood.
 */
async function runForge(stick) {
  if (!G.forge || G.forge.busy) return;
  const weapon = await G.forge.play(stick, () => G.state.craft(stick));
  if (!weapon) {
    G.ui.toast({ text: 'She turns it over and hands it back.', icon: 'stick', tone: 'warn' });
    return;
  }

  G.ui.setSatchel(G.state.sticks.length, G.state.capacity);
  if (!G.state.equipped) { G.state.equip(weapon.uid); equipFromState(); }
  G.state.save();
  audio.craft?.();

  const card = new RevealScreen(weapon, G.ui, G.turntable, {
    onDone: () => {
      G.ui.toast({
        text: weapon.name,
        sub: `${weapon.label} · ${RARITY[clamp(weapon.tier, 0, RARITY.length - 1)].name}`,
        icon: 'hammer', tone: 'rare', ms: 5600,
      });
      // still carrying wood? she is right there and the bench is still warm
      if (G.state.sticks.length) setTimeout(openWorkshop, 320);
    },
  });
  G.ui.push(card);
  requestAnimationFrame(() => G.turntable.attach(card.el.querySelector('#tt-slot')));
}

/**
 * Put the right thing in the paw.
 *
 * The rod and the weapon share one hand and one mount point, so this is the
 * single place that decides which of them is in it. Both are built with the
 * grip at the origin and the business end up +Y, so the carry code does not
 * have to care which it is holding.
 */
function equipFromState() {
  const S = G.state;
  if (!G.player) return;

  if (S.holdingRod) {
    const rod = S.currentRod;
    if (G.player.heldRodId !== rod.id) {
      const built = rodMeshes(rod, MATS, { lod: 0 });
      G.player.equip({ ...built, weapon: null, cls: 'rod', rod });
      G.player.heldRodId = rod.id;
    }
    G.ui.setWeapon({ name: rod.name });
    return;
  }

  G.player.heldRodId = null;
  const w = S.equippedWeapon;
  if (!w) { G.player.unequip(); G.ui.setWeapon(null); return; }
  if (!w.design || !w.stick) return;
  const built = weaponMeshes(w, MATS, { lod: 0 });
  G.player.equip({ ...built, weapon: w, cls: w.cls });
  G.ui.setWeapon(w);
}

bus.on(EV.WEAPON_EQUIPPED, () => { if (G.player) equipFromState(); });
bus.on(EV.ROD_CHANGED, () => { if (G.player) equipFromState(); });

/* ========================================================================= */
/* HINTS                                                                     */
/* ========================================================================= */

function maybeHint() {
  const S = G.state;
  if (S.sticks.length === 1 && !G.hintShown.satchel) {
    G.hintShown.satchel = true;
    setTimeout(() => G.ui.toast({
      text: 'Press Q to look through your satchel.', icon: 'satchel', ms: 5200,
    }), 1400);
  }
  if (S.sticks.length === 4 && !G.hintShown.shop) {
    G.hintShown.shop = true;
    setTimeout(() => G.ui.toast({
      text: 'Old Nissel can make something of these.',
      sub: 'Her workshop is on the green.', icon: 'hammer', ms: 5800,
    }), 1400);
  }
}

/* ========================================================================= */
/* THE LOOP                                                                  */
/* ========================================================================= */

let last = now();

function frame() {
  requestAnimationFrame(frame);
  const t = now();
  let dt = (t - last) / 1000;
  last = t;
  // a tab that has been in the background hands back an enormous dt; letting
  // that through teleports the player and detonates every spring in the game
  dt = clamp(dt, 0, 0.1);
  G.t += dt;
  G.frames++;
  G.fps.push(dt);

  if (G.mode !== 'play') { input.endFrame(); return; }

  /* --- 1. input ------------------------------------------------------- */
  /* A CUTSCENE OWNS THE FRAME. It takes the camera, the controls and the
     Stickwright, and the only key it answers to is the one that ends it.
     Everything below the input block still runs — the world keeps streaming
     and the village keeps working, because a village that freezes behind a
     cutscene is a diorama. */
  const cine = !!G.forge?.busy;
  /* one word for 'the player is busy with an interface' — screens, the
     compact talk panel and the rod shop all freeze the fox */
  const uiUp = G.ui.busy || !!G.talk?.busy || !!G.rodShop?.busy;
  /* the compact panels get first refusal on the keyboard, because while one
     is up the number keys mean "pick this option" and nothing else */
  const talking = G.rodShop?.handleKeys() || G.talk?.handleKeys() || false;
  if (!talking && !cine && !G.ui.busy) G.hotbar?.handleKeys(input);
  const uiAte = talking || G.ui.handleKeys();

  if (cine) {
    if (input.rawPressed('Escape', 'Space', 'KeyE')) G.forge.skip();
  } else if (!uiAte) {
    if (input.rawPressed('KeyQ', 'Tab')) openSatchel();
    if (input.rawPressed('KeyM')) openMap();
    if (input.rawPressed('Escape')) { /* nothing open: ignore */ }
    if (input.rawPressed('KeyE')) doInteract();
    /* ATTACK.
       ------------------------------------------------------------------
       TAP for the three-hit string — left, right, then a straight one down
       the middle that hits hardest. HOLD to wind up a heavy attack: every
       two seconds it reaches the next of three stages and gives one short
       bright pulse, and the longer it is held the harder it lands.

       The two share one button, so the rule has to be unambiguous: holding
       past the charge threshold means you meant to charge, and releasing
       before it means you meant to tap. `releaseAttack` does exactly that
       and hands a stage of 0 back to `attack`, which is an ordinary hit. */
    const canFight = G.player?.weapon && !G.fishing.active && !uiUp && G.state.holding !== 'rod';
    if (canFight) {
      if (input.mouseDown || input.down('KeyF')) {
        const stage = G.player.holdAttack(dt);
        if (stage) {
          audio.ui?.('tick');
          G.fx?.chargePulse(G.player.chargeAnchor(), stage, CHARGE[stage - 1].col);
        }
      } else if (G.player.charging) {
        const sw = G.player.releaseAttack();
        if (sw) audio.swing((G.player.weapon.info?.length || 1) * (1 + sw.charge * 0.4));
      } else if (input.rawPressed('KeyF')) {
        const sw = G.player.attack();
        if (sw) audio.swing(G.player.weapon.info?.length || 1);
      }
    } else if (G.player?.charging) {
      G.player.releaseAttack();
    }

    /* FISHING takes the mouse button while it is up. One control does the
       whole minigame: hold to rise, release to sink, and the same press
       strikes the bite. */
    if (G.fishing.active) {
      if (input.mouseDown) G.fishing.press(); else G.fishing.release();
      if (input.rawPressed('Escape', 'KeyQ')) G.fishing.cancel();
    } else if (input.rawPressed('KeyR') && G.state.hasRod) {
      startFishing();
    }
    if (input.rawPressed('KeyV')) {
      rig.applyPreset(rig.presetName === 'vista' ? 'roam' : 'vista');
    }
    if (input.rawPressed('KeyN')) audio.setEnabled(!audio.enabled);
  }

  /* --- 2. camera ------------------------------------------------------- */
  const look = input.lookDelta();
  if (!cine) rig.look(look.x, look.y);
  if (input.mouse.wheel && !cine) rig.zoom(input.mouse.wheel);
  if (uiUp || cine) rig.settleTargets();

  const P = G.player;
  const ax = cine ? { x: 0, y: 0 } : input.moveAxis();
  const mv = rig.moveVector(ax.x, ax.y);
  const idle = !uiUp && !cine && ax.x === 0 && ax.y === 0 && !input.lookActive;

  /* --- 3. player -------------------------------------------------------- */
  P.update(dt, mv, {
    run: input.down('ShiftLeft', 'ShiftRight'),
    jump: !cine && input.rawPressed('Space') && !uiUp,
    frozen: uiUp || cine,
  });
  G.state.stats.walked += Math.hypot(P.vx, P.vz) * dt;

  rig.setFocus(P.x, P.y, P.z);
  rig.setBlockers(G.world.cameraBlockers(P.x, P.z));
  rig.update(dt, { idle });
  /* the director writes the shot AFTER the rig has smoothed, so a cut lands
     on the frame it was asked for rather than a few frames of damping later */
  G.forge?.update(dt);

  /* --- 4. world --------------------------------------------------------- */
  const { sky, env } = G.world.update(dt, P, camera);

  /* --- 5. npcs, crews and the line in the water ------------------------- */
  G.npcs.update(dt, P);
  G.workers.update(dt, P, sky.night);
  G.wildlife.update(dt, P);

  /* a swing that has reached its hit frame startles whatever is in the arc */
  if (P.swingConnects) {
    const sw = P.swing;
    const n = G.workers.strike({ x: P.x, z: P.z, yaw: P.yaw }, sw)
      + G.wildlife.strike({ x: P.x, z: P.z, yaw: P.yaw }, sw);
    if (n) {
      audio.thump?.(0.6 + (sw.charge || 0) * 0.12);
      const f = P.forward;
      G.fx?.hitSpark([P.x + f.x * sw.reach * 0.6, P.y + 0.9, P.z + f.z * sw.reach * 0.6],
        0.7 + (sw.charge || 0) * 0.5 + (sw.combo === 2 ? 0.4 : 0));
    }
  }

  /* the air moving round a sprinting fox */
  G.fx?.sprint(P, dt, P.quad);
  G.fx?.update(dt);

  /* --- THE MAP FILLS IN BY WALKING ------------------------------------
     Revealed here, in the world, rather than when the map is opened: the
     point of the fog is that it is a record of where the player has
     actually been. You can see further from a hilltop in the open than
     from inside a thicket, so the radius follows the canopy. */
  {
    const see = lerp(78, 34, clamp01(env.forest));
    if (G.fog.reveal(P.x, P.z, see) > 0) G.state.explored = G.fog.toJSON();
  }

  G.fishing.update(dt);
  G.fishUI.update(G.fishing);

  /* --- 6. interaction --------------------------------------------------- */
  G.target = (uiUp || cine) ? null : pickTarget();
  updatePrompt();
  highlightTarget(dt);

  /* --- 7. the tutorial -------------------------------------------------- */
  if (G.quest) {
    G.quest.update(dt);
    G.ui.setObjective(cine ? null : G.quest.objective);
    /* THE OBJECTIVE IS A LIGHT STANDING IN THE WORLD.
       Not an arrow pinned to the edge of the screen that swings round as
       you turn — that follows the player and makes the tutorial feel like
       an instruction. A warm column of light at the place itself is
       somewhere to walk to: you see it, you lose it behind a rise, you
       find it again, and that is navigating rather than obeying.

       The on-screen chevron is kept ONLY for when the objective is a long
       way off and out of sight, where a light on the horizon genuinely
       cannot be seen — and even then it is faint. */
    const mk = G.quest.marker;
    if (mk && !uiUp && !cine) {
      const dx = mk.x - P.x, dz = mk.z - P.z;
      const d = Math.hypot(dx, dz);
      G.fx?.beacon(mk.x, G.world.groundAt(mk.x, mk.z), mk.z, d > 2.5);
      let a = Math.atan2(dx, dz) - rig.yaw;
      while (a > Math.PI) a -= Math.PI * 2;
      while (a < -Math.PI) a += Math.PI * 2;
      G.ui.setGuide(d > 90 ? a : null, d, mk.label || '');
    } else {
      G.fx?.hideBeacon();
      G.ui.setGuide(null);
    }
  }

  /* --- 8. ui, audio, save ----------------------------------------------- */
  G.ui.update(dt);
  G.hotbar?.update(dt);
  G.ui.setTime(sky.name, sky.night);
  G.ui.setHomeDistance(Math.hypot(P.x - WORLD.village.cx, P.z - WORLD.village.cz));
  audio.update(dt, {
    forest: env.forest, village: env.village, water: env.water,
    wind: env.wind, open: env.open, night: sky.night,
  });
  renderer.toneMappingExposure = sky.exposure;

  G.autosave += dt;
  if (G.autosave > GAME.autosaveSeconds) {
    G.autosave = 0;
    G.state.pos = [P.x, P.y, P.z, P.yaw];
    G.state.dayPhase = G.world.sky.phase;
    G.state.taken = G.world.takenSticks;
    G.state.questStep = G.quest?.id || null;
    G.state.save();
  }

  if (G.turntable) G.turntable.render(dt);

  renderer.render(scene, camera);
  input.endFrame();
}

/* --- the little lift-and-glow on whatever you are about to pick up ------- */
let hlMesh = null, hlT = 0;
function highlightTarget(dt) {
  const want = G.target?.kind === 'stick' ? G.target.stick.mesh : null;
  if (want !== hlMesh) {
    if (hlMesh) { hlMesh.position.y -= hlT * 0.05; hlMesh.rotation.z -= hlT * 0.0; }
    hlMesh = want;
    hlT = 0;
  }
  if (!hlMesh) return;
  const prev = hlT;
  hlT = Math.min(1, hlT + dt * 6);
  // a couple of centimetres of lift and a slow turn: enough to say "this one"
  // without making the forest floor twitch every time you walk past
  hlMesh.position.y += (hlT - prev) * 0.05;
  hlMesh.rotation.y += dt * 0.5 * hlT;
}

/* ========================================================================= */
/* WINDOW                                                                    */
/* ========================================================================= */

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

/* Pointer lock: click the world to take the mouse, Escape to give it back. */
canvas.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  audio.unlock();
  if (G.mode === 'play' && !G.ui.busy && !input.pointerLocked) input.requestLock();
});
addEventListener('keydown', () => audio.unlock(), { once: true });

addEventListener('beforeunload', () => {
  if (G.state && G.player) {
    G.state.pos = [G.player.x, G.player.y, G.player.z, G.player.yaw];
    G.state.dayPhase = G.world.sky.phase;
    G.state.taken = G.world.takenSticks;
    G.state.questStep = G.quest?.id || null;
    G.state.save();
  }
});

/* ========================================================================= */

boot().catch(err => {
  console.error(err);
  if (bootText) bootText.textContent = 'something went wrong — see the console';
  const p = document.createElement('pre');
  p.style.cssText = 'position:fixed;left:2rem;right:2rem;bottom:2rem;color:#e8c;font:12px monospace;white-space:pre-wrap;z-index:99';
  p.textContent = String(err && err.stack || err);
  document.body.appendChild(p);
});
