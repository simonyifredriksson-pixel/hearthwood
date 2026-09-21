/* VillageData.js — the nine places people live.
   ===========================================================================
   THE RULE THE BRIEF WAS EMPHATIC ABOUT: do not build one village eight more
   times. So a village here is not a position and a name — it is a STYLE, and
   the style is derived from the ground it stands on:

     a swamp gives you a village on stilts over the water;
     a cliff gives you terraces cut into the rock;
     snow gives you steep roofs, heavy logs and a chimney on everything;
     a canyon gives you flat roofs, awnings and sandstone;
     a lake gives you jetties, boathouses and a shoreline crescent.

   Every field below changes geometry, not tint. `wall` picks how a wall is
   built (daub panels, dry stone, stacked logs, board, cut sandstone);
   `roof` picks the roof solid; `stilts` lifts the whole village onto posts
   over water; `terrace` steps it up a slope; `plinth` is how much stone
   footing a building gets before its wall starts. Two villages that share a
   roof share nothing else.

   DISTANCE IS THE DIFFICULTY CURVE. `zone` runs 0 at home to ~1 at the far
   corner and is the single number that drives which fish are in the water,
   which enemies are in the wood, and how good the rods on the rack are.
   The positions are deliberately far apart — the nearest neighbour is four
   hundred metres and the last one is the better part of a kilometre — so
   that the walk between two villages is itself a journey.
*/

import { WORLD } from '../core/Config.js?v=1790014861';

/**
 *   x, z        centre of the green
 *   r           outer edge of village land
 *   core        the built-up part
 *   zone        0..1 — how deep into the world this is
 *   water       {kind:'river'|'lake', r, depth} — what you fish in
 *   style       see the note above
 *   fisher      who keeps the booth
 */
export const VILLAGES = [
  {
    id: 'home', name: 'Thistlebrook', x: WORLD.village.cx, z: WORLD.village.cz,
    r: 176, core: 96, datum: 6.5, zone: 0.00, biome: 'valley',
    blurb: 'A green, a well, a workshop and more fallen wood than anyone knows what to do with.',
    water: { kind: 'river' },
    style: {
      wall: 'daub', roof: 'thatch', storeys: [1, 2], plinth: 0.35, stilts: 0, terrace: 0,
      wallCols: [0xe8dcc0, 0xe4d2b0, 0xdcd8c4, 0xe0c8b4],
      beam: 0x6b5541, roofCols: [0xb09a5e, 0x8a7a4a], trim: 0x7a5a3a,
      lantern: 0xffd08a, treeMix: ['oak', 'birch', 'hazel'],
      fence: 'picket', path: 'dirt',
    },
    fisher: {
      name: 'Old Barrow', title: 'Fisherman',
      voice: 0.86,
      greet: ['Back again. The water has been kind this morning.',
        'Mind the wet stones on the way down.'],
      proud: ['Word travels. They say you have been busy.',
        'Let me see what you have got, then.'],
      idle: ['Eleven years I have been after one particular trout.',
        'Everything in this river has a name, if you fish it long enough.'],
    },
  },

  {
    id: 'millbrook', name: 'Millbrook', x: 300, z: -110,
    r: 128, core: 68, datum: null, zone: 0.18, biome: 'lake',
    blurb: 'Built in a crescent round a still lake, with more boats than houses.',
    water: { kind: 'lake', r: 44, depth: 6.5 },
    style: {
      wall: 'plank', roof: 'shingle', storeys: [1, 2], plinth: 0.2, stilts: 0.4, terrace: 0,
      wallCols: [0xd8c8a0, 0xcfc4a8, 0xe0d4b0],
      beam: 0x7a6242, roofCols: [0x8a7c62, 0x6f6450], trim: 0x4a6a78,
      lantern: 0xffe0a0, treeMix: ['willow', 'birch', 'alder'],
      fence: 'rail', path: 'board', jetties: true, boats: true,
    },
    fisher: {
      name: 'Mira Tench', title: 'Boat-keeper',
      voice: 1.14,
      greet: ['Careful on the boards, they are slick.', 'The lake is deeper than it looks.'],
      proud: ['You have been out past the reeds, then.', 'Not bad. Not bad at all.'],
      idle: ['My grandmother sank a boat out there. Never found it.',
        'Still water keeps bigger fish than a river ever will.'],
    },
  },

  {
    id: 'fenmoor', name: 'Fenmoor', x: -380, z: 340,
    r: 122, core: 62, datum: null, zone: 0.26, biome: 'swamp',
    blurb: 'Nothing here touches the ground. Walkways, stilts, and a great deal of frog.',
    water: { kind: 'lake', r: 50, depth: 3.2, marsh: true },
    style: {
      wall: 'plank', roof: 'reed', storeys: [1, 1], plinth: 0, stilts: 2.2, terrace: 0,
      wallCols: [0x8a8468, 0x7a7a5e, 0x94886a],
      beam: 0x4a4436, roofCols: [0x7a7448, 0x635e3a], trim: 0x3e4a34,
      lantern: 0x9fe8a8, treeMix: ['willow', 'alder'],
      fence: 'rail', path: 'board', mossy: 0.8, walkways: true,
    },
    fisher: {
      name: 'Sedge', title: 'Fenwarden',
      voice: 0.74,
      greet: ['Stay on the boards. I mean it.', 'Wet out. Wet in. Wet always.'],
      proud: ['You went out into the fen and came back. Good.', 'Something to sell? Let me look.'],
      idle: ['Things live under here that have never seen the sun.',
        'The lights out over the water are not lanterns. Do not follow them.'],
    },
  },

  {
    id: 'stonecrag', name: 'Stonecrag', x: 250, z: 460,
    r: 118, core: 58, datum: null, zone: 0.34, biome: 'cliff',
    blurb: 'Cut into the cliff in five terraces, with ladders where the streets should be.',
    water: { kind: 'lake', r: 34, depth: 9 },
    style: {
      wall: 'stone', roof: 'slate', storeys: [1, 2], plinth: 0.9, stilts: 0, terrace: 3.1,
      wallCols: [0x9a9288, 0x8c8478, 0xa69c8e],
      beam: 0x5a4c3a, roofCols: [0x545a60, 0x42474c], trim: 0x6a5a48,
      lantern: 0xffc070, treeMix: ['pine', 'birch'],
      fence: 'stone', path: 'stone', ladders: true,
    },
    fisher: {
      name: 'Garrick Pike', title: 'Cliffside Fisher',
      voice: 0.66,
      greet: ['Long way down, that. Do not lean.', 'Pool at the bottom never warms up.'],
      proud: ['You climb well for somebody with a creel on.', 'Show me.'],
      idle: ['Line has to be forty feet before it wets. You get used to it.',
        'The cold ones fight hardest.'],
    },
  },

  {
    id: 'thornhollow', name: 'Thornhollow', x: 560, z: 140,
    r: 124, core: 64, datum: null, zone: 0.46, biome: 'deepforest',
    blurb: 'So far under the canopy it keeps its lanterns lit at noon.',
    water: { kind: 'lake', r: 38, depth: 5.5 },
    style: {
      wall: 'log', roof: 'shingle', storeys: [1, 2], plinth: 0.25, stilts: 0, terrace: 0,
      wallCols: [0x6a5334, 0x7a6040, 0x5e4a2e],
      beam: 0x3e3020, roofCols: [0x4a5a38, 0x3c4a2e], trim: 0x2e3a24,
      lantern: 0xffb060, treeMix: ['oak', 'pine', 'yew'],
      fence: 'stake', path: 'dirt', mossy: 0.55, canopy: true,
    },
    fisher: {
      name: 'Brel Nettle', title: 'Hollow Fisher',
      voice: 0.94,
      greet: ['Keep your weapon where you can reach it.', 'You came the long way, then.'],
      proud: ['Not many get out this far and bother to fish.', 'Go on, let me see.'],
      idle: ['Wolves take the shallows at dusk. I take the deep.',
        'Dark water, dark fish. That is all there is to it.'],
    },
  },

  {
    id: 'coldhollow', name: 'Coldhollow', x: -520, z: -300,
    r: 120, core: 60, datum: null, zone: 0.55, biome: 'snow',
    blurb: 'Steep roofs, deep eaves, and a chimney going on every single house.',
    water: { kind: 'lake', r: 40, depth: 7.5, cold: true },
    style: {
      wall: 'log', roof: 'snow', storeys: [1, 2], plinth: 0.5, stilts: 0, terrace: 0,
      wallCols: [0x7a6448, 0x8a7052, 0x6e5a40],
      beam: 0x4a3a28, roofCols: [0xe8eef2, 0xd4dce4], trim: 0x8a4a3a,
      lantern: 0xffcf8a, treeMix: ['pine', 'spruce'],
      fence: 'stake', path: 'snow', snow: 1, chimneys: 2,
    },
    fisher: {
      name: 'Vell Frostrow', title: 'Ice Fisher',
      voice: 0.58,
      greet: ['Shut the door. Oh. There is no door out here.', 'Cold enough for you?'],
      proud: ['You have hands like ice and a full creel. My kind of person.', 'Let me see them.'],
      idle: ['Cut a hole, sit down, wait. That is the whole of it.',
        'Water this cold, the fish do not hurry. Neither should you.'],
    },
  },

  {
    id: 'goldhaven', name: 'Goldhaven', x: -160, z: -600,
    r: 126, core: 66, datum: null, zone: 0.66, biome: 'canyon',
    blurb: 'Stacked up both walls of a red canyon, with awnings strung across the gap.',
    water: { kind: 'lake', r: 30, depth: 11 },
    style: {
      wall: 'sandstone', roof: 'flat', storeys: [1, 2], plinth: 0.6, stilts: 0, terrace: 2.6,
      wallCols: [0xd8a878, 0xc89464, 0xe0b88c],
      beam: 0x8a5a34, roofCols: [0xb88a5a, 0xa87c4e], trim: 0xc86a3a,
      lantern: 0xffb84a, treeMix: ['pine', 'hazel'],
      fence: 'stone', path: 'stone', awnings: true, terraces: true,
    },
    fisher: {
      name: 'Sable Quarry', title: 'Canyon Fisher',
      voice: 1.02,
      greet: ['Water is down the bottom. Everything is down the bottom.',
        'Do not drop anything. You will not get it back.'],
      proud: ['You have been somewhere worth going.', 'Right. What have you got.'],
      idle: ['The pool has no bottom anybody has found.',
        'Gold in the walls, they say. There is not. There are fish, though.'],
    },
  },

  {
    id: 'lastlight', name: 'Lastlight', x: -660, z: 620,
    r: 116, core: 56, datum: null, zone: 0.80, biome: 'mountain',
    blurb: 'The last roofs before the peaks. Everything is stone and everything is low.',
    water: { kind: 'lake', r: 36, depth: 13 },
    style: {
      wall: 'stone', roof: 'slate', storeys: [1, 1], plinth: 1.2, stilts: 0, terrace: 2.2,
      wallCols: [0x8c8880, 0x7e7a72, 0x9a948a],
      beam: 0x4a4238, roofCols: [0x4a4e54, 0x3a3e44], trim: 0x5a6a74,
      lantern: 0xbfd8ff, treeMix: ['pine', 'spruce'],
      fence: 'stone', path: 'stone', snow: 0.5, low: true,
    },
    fisher: {
      name: 'Hesper Crag', title: 'Highwater Fisher',
      voice: 0.7,
      greet: ['Thin air. Take your time.', 'Nobody comes up here by accident.'],
      proud: ['You have walked a long way to show me a fish. I respect that.',
        'Out with them, then.'],
      idle: ['The tarn is older than the mountain, if you believe the story.',
        'I have seen things surface up here I do not talk about.'],
    },
  },

  {
    id: 'stillwater', name: 'Stillwater', x: 620, z: -590,
    r: 130, core: 62, datum: null, zone: 0.93, biome: 'stilllake',
    blurb: 'Pale houses standing in water that has never once had a ripple on it.',
    water: { kind: 'lake', r: 60, depth: 16, still: true },
    style: {
      wall: 'stone', roof: 'tile', storeys: [1, 2], plinth: 0.3, stilts: 1.6, terrace: 0,
      wallCols: [0xe4e8ec, 0xd8e0e4, 0xeef2f4],
      beam: 0x8a94a0, roofCols: [0xa8b8c4, 0x8ea0b0], trim: 0x6fa8b8,
      lantern: 0x9fe8ff, treeMix: ['willow', 'birch'],
      fence: 'rail', path: 'board', jetties: true, walkways: true, still: true,
    },
    fisher: {
      name: 'The Quiet Warden', title: 'Keeper of Stillwater',
      voice: 0.5,
      greet: ['Softly.', 'You are the first in a long while.'],
      proud: ['Yes. I thought you might be the one who could.',
        'Let me see what the water gave you.'],
      idle: ['It does not move. It has never moved.',
        'Whatever you catch here was already very old when the village was new.'],
    },
  },
];

export const VILLAGE_BY_ID = Object.fromEntries(VILLAGES.map(v => [v.id, v]));
export const HOME = VILLAGES[0];

/** The nearest village to a point, and how far away it is. */
export function nearestVillage(x, z) {
  let best = null, bd = Infinity;
  for (const v of VILLAGES) {
    const d = Math.hypot(v.x - x, v.z - z);
    if (d < bd) { bd = d; best = v; }
  }
  return { village: best, dist: bd };
}

/**
 * HOW DANGEROUS IS IT HERE.
 *
 * Zone runs 0 at the home green to 1 at the far corner of the map, and it is
 * the one number the whole difficulty curve reads: which fish are in the
 * water, what is in the wood, how good the rods on the rack are. It is a
 * distance from HOME rather than from the map centre, because the player's
 * mental model is "how far have I walked", not "where is the origin".
 */
export function zoneAt(x, z) {
  const d = Math.hypot(x - HOME.x, z - HOME.z);
  /* the first 150 m is the village itself and is always zone 0 */
  return Math.max(0, Math.min(1, (d - 150) / 900));
}

/** 1..5, for the things that want a band rather than a curve. */
export function dangerBand(x, z) {
  const t = zoneAt(x, z);
  return t < 0.20 ? 1 : t < 0.40 ? 2 : t < 0.62 ? 3 : t < 0.82 ? 4 : 5;
}

export const BAND_NAMES = [
  '', 'Inner Forest', 'Wilderness', 'Deep Forest', 'Dangerous Wilderness', 'The Far Wood',
];
