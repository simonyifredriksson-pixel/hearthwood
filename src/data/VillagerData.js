/* VillagerData.js — who lives in Hearthwood, and what they say.
   ===========================================================================
   Twenty-odd named villagers, each with a species, an outfit, a job and a
   handful of lines. The lines are the point: a village whose people say
   "Hello, traveller" is a village of signposts, and a village whose people
   say something about the weather, their neighbours, or the thing they are
   carrying is a village.

   The Stickwright has her own tree, because she is the one character the
   whole game routes through.
*/

/* ========================================================================= */
/* THE STICKWRIGHT                                                           */
/* ========================================================================= */

export const STICKWRIGHT = {
  id: 'stickwright',
  name: 'Old Nissel',
  title: 'the Stickwright',
  kind: 'hare',
  outfit: 'apron',
  scale: 1.06,
  cloth: 0x6d7a48,
  /* She is a hare: the tallest ears in the village, silver at the tips, one
     of them notched. You can see who she is from the far side of the green,
     which matters for the only NPC the player must be able to find. */
  seed: 0x4e1551,
  voice: 1.18,

  greet: [
    'Ah. You have the look of someone who has been LOOKING at the ground.',
    'Come in, come in. Mind the shavings.',
    'You found something. I can always tell — you are holding it differently.',
    'Sit if you like. Talk if you like. But show me the wood first.',
  ],
  greetEmpty: [
    'Empty-handed! Well. The wood is that way and it is not going anywhere.',
    'Nothing yet? Good. Nothing is where everyone starts.',
    'Bring me wood, child. Any wood. I will tell you what is in it.',
  ],
  idle: [
    'Three turns of cord. Not two. Three.',
    'Never carve across the grain. Carve WITH it, or it carves you.',
    'Everything in this village was a tree once, including half the people.',
    'Feel the weight of it. If it does not want to be a spear, it will tell you.',
  ],
};

/* ========================================================================= */
/* THE FISHERMAN                                                             */
/* ========================================================================= */

/**
 * Barnaby Quill, who has been on that bank a very long time.
 *
 * He is the second named character the player meets and he exists to hand
 * over the rod, so his first line has to do three things at once: acknowledge
 * that the player has just been to the Stickwright, explain what he is for,
 * and get out of the way. Everything after that is flavour he will happily
 * repeat forever.
 */
export const FISHERMAN = {
  id: 'fisherman',
  name: 'Barnaby Quill',
  title: 'the Fisherman',
  kind: 'cat',
  outfit: 'smock',
  scale: 1.02,
  cloth: 0x4a6272,
  seed: 0xf15a21,
  voice: 0.86,

  /* the rod handover — this runs once, the first time you talk to him */
  first: [
    'Let me guess.',
    'You just made your first weapon.',
    'And now you need a fishing rod.',
    'Here. Take this one. I have got plenty.',
  ],
  greet: [
    'Water is the same as wood, you know. You have to wait for it.',
    'Still biting. Always still biting.',
    'Sit down if you like. The fish do not mind an audience.',
    'Caught anything? No? Good. Keeps you humble.',
  ],
  idle: [
    'Hold when it dives. Let go when it rises. That is the whole of it.',
    'Eleven years I have been after one particular trout.',
    'A patient animal never goes hungry. A very patient one does, but happily.',
    'The moon ones only come up when you have stopped expecting them.',
  ],
  /* what he says once the player has actually caught something */
  proud: [
    'There. Now you are a fisherman. Everything else is practice.',
    'Not bad. Not bad at all for a first go.',
    'See? Waiting is a skill. You have got the beginnings of it.',
  ],
};

/* ========================================================================= */
/* THE VILLAGERS                                                             */
/* ========================================================================= */

/* `job` drives what they do all day (see NPCs.js), `home` is a hint for where
   they start. Nothing here is required to exist — the village places them in
   whatever slots it actually built. */
export const VILLAGERS = [
  {
    name: 'Marrow Cobb', kind: 'badger', outfit: 'jerkin', job: 'smith', cloth: 0x8a4a3c,
    lines: [
      'Iron is honest. You hit it and it changes. Wood ARGUES.',
      'Nissel gets all the interesting work. I get hinges.',
      'If you find a straight ash limb, she will pay you in stories.',
    ],
  },
  {
    name: 'Pell Wimbrey', kind: 'mouse', outfit: 'apron', job: 'baker', cloth: 0xa87a4a,
    lines: [
      'Second batch is in. Do not tell anyone about the second batch.',
      'The oven has not gone out in forty years. Not once.',
      'My grandmother swept this floor. Same broom. Nissel rebound it twice.',
    ],
  },
  {
    name: 'Rook Thistledown', kind: 'squirrel', outfit: 'hood', job: 'forester',
    lines: [
      'There is a fallen giant two ridges north. Been down since the big storm.',
      'The deep wood is fine. It is the deep wood at DUSK I would think about.',
      'Best sticks are under the old oaks. Everything falls from something.',
    ],
  },
  {
    name: 'Bramble Vetch', kind: 'hedgehog', outfit: 'smock', job: 'gardener',
    lines: [
      'Slugs. Every year. Every single year.',
      'Those beans will be up past the fence by the turn of the month.',
      'Take a flower if you want one. Take TWO and we shall have words.',
    ],
  },
  {
    name: 'Nettle Fen', kind: 'otter', outfit: 'jerkin', job: 'fisher', cloth: 0x4a6272,
    lines: [
      'Water is high today. That is good for me and bad for the bridge.',
      'Half the best wood in this valley comes down the river, not off the trees.',
      'Bleached white and smooth as a stone — driftbone, we call it.',
    ],
  },
  {
    name: 'Corrie Ashlock', kind: 'rabbit', outfit: 'strawHat', job: 'farmer',
    lines: [
      'Weather is holding. Weather never holds.',
      'Scarecrow needs a new head. The old one went to seed.',
      'You want the south fields if you are after long straight wood.',
    ],
  },
  {
    name: 'Tamsin Burr', kind: 'rabbit', outfit: 'smock', job: 'market', cloth: 0x7a5570,
    lines: [
      'Fresh this morning. Fresher than Pell will admit his bread is.',
      'Everyone comes past eventually. That is the whole trick of a market.',
      'I saw someone carry a branch through here taller than the mill.',
    ],
  },
  {
    name: 'Hobb Quill', kind: 'hedgehog', outfit: 'cap', job: 'sweeper',
    lines: [
      'Leaves. Leaves. More leaves. It is autumn\'s fault, not mine.',
      'A clean path is a kindness to the next person along it.',
      'Do not stack firewood against a daub wall. It gets IN.',
    ],
  },
  {
    name: 'Fenna Larkspur', kind: 'deer', outfit: 'smock', job: 'wander', cloth: 0x53704f,
    lines: [
      'I walked as far as the white rocks once. Took all day and I saw nobody.',
      'There is a glade out east where the light comes down in bars.',
      'Everything is further away than it looks from the fence.',
    ],
  },
  {
    name: 'Old Barrow', kind: 'badger', outfit: 'hood', job: 'sit',
    lines: [
      'Sixty-one winters in this valley and it still surprises me.',
      'Nissel\'s mother taught her. I remember the mother.',
      'Sit down. The wood will still be there in an hour.',
    ],
  },
  {
    name: 'Wick Tallow', kind: 'mouse', outfit: 'apron', job: 'market',
    lines: [
      'Candles, rushlights, tallow. Everything that keeps the dark off.',
      'They light the green lanterns at dusk. You should see it.',
      'Buy two. The second one is always the one you needed.',
    ],
  },
  {
    name: 'Juniper Vane', kind: 'fox', outfit: 'hood', job: 'wander', cloth: 0x8c6f8a,
    lines: [
      'You walk fast. I like that in a person.',
      'Mind the bog south of the mill. It swallowed a cart once.',
      'The mountains are not as far as they look. They are further.',
    ],
  },
  {
    name: 'Dunnock Reed', kind: 'otter', outfit: 'jerkin', job: 'carry',
    lines: [
      'Firewood. Always firewood. The hearths eat a forest a winter.',
      'Ask me again when my arms are empty.',
      'Split it while it is green, burn it when it is grey.',
    ],
  },
  {
    name: 'Mabel Crow', kind: 'rabbit', outfit: 'apron', job: 'well',
    lines: [
      'Sweetest water in three valleys, and I will fight anyone who says otherwise.',
      'The well was here before the village. The village came to the well.',
      'Mind the bucket. It has a mind of its own.',
    ],
  },
  {
    name: 'Tobin Small', kind: 'mouse', outfit: 'child', job: 'play', scale: 0.62,
    lines: [
      'I found a stick as long as TWO of me!',
      'Can you run? Bet you cannot run as fast as me.',
      'Nissel made me a sword. It is only a little one.',
    ],
  },
  {
    name: 'Prue Small', kind: 'mouse', outfit: 'child', job: 'play', scale: 0.60,
    lines: [
      'We are not allowed past the fence. YOU are, though.',
      'There are green mushrooms in the deep wood that GLOW. Rook said.',
      'Bet you cannot find a stick with a hole right through it.',
    ],
  },
  {
    name: 'Harl Bracken', kind: 'squirrel', outfit: 'child', job: 'play', scale: 0.64,
    lines: [
      'Whoever gets to the big oak first wins. Go!',
      'My stick is a SWORD. Yours is just a stick.',
      'Grown-ups never look UP. That is where everything good is.',
    ],
  },
  {
    name: 'Selda Mire', kind: 'frog', outfit: 'smock', job: 'market', cloth: 0x6b8272,
    lines: [
      'Pots, jars, crocks. Everything a kitchen needs and two things it does not.',
      'I came up from the fen country. Drier here. I am still deciding.',
      'You will want something to keep the rain off that wood.',
    ],
  },
  {
    name: 'Gorse Widdy', kind: 'bear', outfit: 'jerkin', job: 'carry', cloth: 0x76664a,
    lines: [
      'Heavy? This? No.',
      'I carry for the mill on market days. Good work if your back agrees.',
      'You are welcome to try lifting it. Everyone does. Nobody can.',
    ],
  },
  {
    name: 'Wren Pallow', kind: 'hare', outfit: 'smock', job: 'chat',
    lines: [
      'Did you hear? Nissel took delivery of something SPIRALLED.',
      'They say the wood remembers. I say the wood is a wood.',
      'Come to the green at dusk. Somebody usually sings.',
    ],
  },
  {
    name: 'Cobb Merrow', kind: 'badger', outfit: 'cap', job: 'chat',
    lines: [
      'Wren will tell you the wood remembers. Wren tells everyone.',
      'Mill wheel wants greasing. It has wanted greasing since spring.',
      'Nothing happens here. That is the best thing about here.',
    ],
  },
  {
    name: 'Ivy Redd', kind: 'fox', outfit: 'apron', job: 'market', cloth: 0x8a4a3c,
    lines: [
      'Cloth, thread, cord. Nissel buys her binding cord from me, you know.',
      'Three turns, she always says. Three turns of cord.',
      'You will want something with a strap if you are carrying much.',
    ],
  },
];

/* ========================================================================= */
/* CRITTERS                                                                  */
/* ========================================================================= */

export const CRITTERS = [
  { kind: 'chicken', n: 7 },
  { kind: 'cat', n: 3 },
  { kind: 'duck', n: 4 },
];

/* ========================================================================= */
/* AMBIENT CHATTER                                                           */
/* ========================================================================= */

/** Lines anyone might say, used when a villager has run out of their own. */
export const SMALL_TALK = [
  'Morning.',
  'Mind how you go.',
  'Grand day for it.',
  'Rain later, I should think.',
  'Off to the wood again?',
  'You look like you have been walking.',
  'Somebody has been busy.',
];
