/* RodData.js — the ladder the whole game is climbed on.
   ===========================================================================
   A rod is the only thing in FISH N STICKS the player BUYS, so it has to be
   the only thing that makes the next village worth walking to. Each one is:

     A REAL UPGRADE, not a bigger number. Every stat changes how the minigame
     feels — `lift` and `control` change how the bar handles, `line` decides
     which fish you can hold at all, `reach` decides how deep you can fish,
     and `luck`/`rare` change what is down there. A rod you cannot feel the
     moment you cast it is not an upgrade, it is a receipt.

     A DIFFERENT OBJECT. The `art` block is a genome, not a palette: shaft
     material and taper, how many joints, the reel, the guides, the grip
     wrap, the butt cap and whatever the rod has instead of a tip. RodArt.js
     builds from it. There is no rod in this list that is another rod in a
     different colour.

     SOLD SOMEWHERE SPECIFIC. `at` is the village that stocks it. The ladder
     runs outward from home, so "I need a better rod" and "I should walk
     further" are the same sentence.
*/

/**
 *   lift     how hard the band rises when you hold. Higher = snappier.
 *   fall     how fast it sinks when you let go.
 *   control  damping on the band. Higher = less overshoot, easier to place.
 *   band     how wide the catch zone is, as a fraction of the bar.
 *   line     the heaviest FIGHT value the rod can hold. A fish above this
 *            drains the catch meter no matter how well you track it, which
 *            is what stops a starter rod landing a River Father.
 *   reach    how deep the rod can fish, 0..1. Gates whole species.
 *   lure     how quickly a bite comes.
 *   luck     multiplier on mutation chance.
 *   rare     multiplier on the rare end of the fish table.
 */
export const RODS = [
  {
    id: 'bentpin', name: 'Bent Pin', price: 0, at: 'home', tier: 0,
    blurb: 'A hazel switch, a length of cord and a pin somebody straightened out. It works, which is the most anyone claims for it.',
    lift: 4.20, fall: 2.30, control: 1.00, band: 0.20, line: 1.30, reach: 0.45,
    lure: 1.00, luck: 1.00, rare: 1.00,
    art: {
      shaft: 'hazel', len: 1.55, taper: 0.55, joints: 0, bend: 0.10,
      reel: 'none', guides: 2, grip: 'cord', wrap: 0x8a7a52, butt: 'plain',
      tipCol: 0xc8b48a, lineCol: 0xe8e0c8,
    },
  },
  {
    id: 'willowswitch', name: 'Willow Switch', price: 140, at: 'home', tier: 1,
    blurb: 'Green willow, cut in spring and dried slow. It bends further than you expect and comes back every time.',
    lift: 4.70, fall: 2.30, control: 1.25, band: 0.21, line: 1.55, reach: 0.52,
    lure: 1.10, luck: 1.05, rare: 1.05,
    art: {
      shaft: 'willow', len: 1.80, taper: 0.62, joints: 0, bend: 0.26,
      reel: 'peg', guides: 3, grip: 'leather', wrap: 0x6a4e34, butt: 'knob',
      tipCol: 0xd8cf9a, lineCol: 0xf0ead0,
    },
  },
  {
    id: 'hazelcaster', name: 'Hazel Caster', price: 650, at: 'millbrook', tier: 2,
    blurb: 'Two pieces, brass-ferruled, with a proper little reel. The first rod that feels like equipment rather than a stick with string on it.',
    lift: 5.20, fall: 2.25, control: 1.55, band: 0.22, line: 1.85, reach: 0.60,
    lure: 1.22, luck: 1.12, rare: 1.15,
    art: {
      shaft: 'ash', len: 2.05, taper: 0.66, joints: 1, bend: 0.20,
      reel: 'drum', guides: 4, grip: 'cork', wrap: 0x9a6a3a, butt: 'brass',
      tipCol: 0xe0d2a8, lineCol: 0xfaf2d8,
    },
  },
  {
    id: 'reedspine', name: 'Reedspine', price: 2800, at: 'fenmoor', tier: 3,
    blurb: 'Split marsh cane bound in nine places. Almost weightless, and it hears a bite before you do.',
    lift: 5.60, fall: 2.20, control: 1.85, band: 0.23, line: 2.05, reach: 0.70,
    lure: 1.55, luck: 1.20, rare: 1.28,
    art: {
      shaft: 'cane', len: 2.30, taper: 0.74, joints: 2, bend: 0.34,
      reel: 'drum', guides: 5, grip: 'wrapcord', wrap: 0x4e6a3a, butt: 'cap',
      tipCol: 0xd8e0b0, lineCol: 0xe8f4d8, bindings: 9,
    },
  },
  {
    id: 'ironleaf', name: 'Ironleaf Rod', price: 11000, at: 'stonecrag', tier: 4,
    blurb: 'A steel spine sleeved in blackened ash, with a counterweight in the butt. Heavy, and it does not care what is on the end of it.',
    lift: 6.10, fall: 2.15, control: 2.30, band: 0.24, line: 2.55, reach: 0.78,
    lure: 1.50, luck: 1.28, rare: 1.42,
    art: {
      shaft: 'steel', len: 2.20, taper: 0.58, joints: 1, bend: 0.09,
      reel: 'geared', guides: 6, grip: 'leather', wrap: 0x2e3238, butt: 'weight',
      tipCol: 0x9aa2a8, lineCol: 0xd8dce0, plates: true, flair: 'outriggers',
    },
  },
  {
    id: 'deepauger', name: 'Deepwater Auger', price: 42000, at: 'coldhollow', tier: 5,
    blurb: 'Built for water with no bottom. The reel takes both hands and the line is rated for things nobody has written down.',
    lift: 6.40, fall: 2.10, control: 2.55, band: 0.25, line: 3.10, reach: 0.90,
    lure: 1.70, luck: 1.38, rare: 1.60,
    art: {
      shaft: 'bone', len: 2.55, taper: 0.70, joints: 2, bend: 0.14,
      reel: 'big', guides: 7, grip: 'double', wrap: 0x3a4650, butt: 'spike',
      tipCol: 0xc8d4d8, lineCol: 0xbfe0f0, plates: true, flair: 'outriggers',
    },
  },
  {
    id: 'stormwood', name: 'Stormwood Rod', price: 150000, at: 'thornhollow', tier: 6,
    blurb: 'Cut from a tree that was struck twice. The line hums in still air and the fish come up angry.',
    lift: 6.80, fall: 2.05, control: 2.85, band: 0.26, line: 3.55, reach: 0.95,
    lure: 2.10, luck: 1.55, rare: 1.85,
    art: {
      shaft: 'stormwood', len: 2.45, taper: 0.68, joints: 1, bend: 0.22,
      reel: 'geared', guides: 7, grip: 'wrapcord', wrap: 0x4a3a5a, butt: 'brass',
      tipCol: 0xb49aff, lineCol: 0xd8c8ff, glow: 0x8a6aff, bindings: 5, flair: 'lantern',
    },
  },
  {
    id: 'gildenspine', name: 'Gildenspine', price: 480000, at: 'goldhaven', tier: 7,
    blurb: 'Somebody spent a fortune making a fishing rod beautiful. Irritatingly, it also works better than anything else on the shelf.',
    lift: 7.10, fall: 2.00, control: 3.20, band: 0.27, line: 3.95, reach: 0.98,
    lure: 2.30, luck: 1.80, rare: 2.10,
    art: {
      shaft: 'gilt', len: 2.35, taper: 0.72, joints: 2, bend: 0.18,
      reel: 'ornate', guides: 8, grip: 'leather', wrap: 0x8a6a1a, butt: 'jewel',
      tipCol: 0xf6dc86, lineCol: 0xfff0c0, glow: 0xffd24a, filigree: true, flair: 'ribbons',
    },
  },
  {
    id: 'riverbone', name: 'Riverbone Rod', price: 1500000, at: 'lastlight', tier: 8,
    blurb: 'A single rib from something the river was keeping. It is warm, and the line never seems to end.',
    lift: 7.50, fall: 1.95, control: 3.60, band: 0.28, line: 4.60, reach: 1.00,
    lure: 2.60, luck: 2.20, rare: 2.55,
    art: {
      shaft: 'rib', len: 2.70, taper: 0.64, joints: 0, bend: 0.28,
      reel: 'big', guides: 8, grip: 'double', wrap: 0x6a5a48, butt: 'spike',
      tipCol: 0xf0e4c8, lineCol: 0xe8f8ff, glow: 0x9fe8d8, plates: true, filigree: true, flair: 'twintip',
    },
  },
  {
    id: 'quietrod', name: 'The Quiet Rod', price: 6000000, at: 'stillwater', tier: 9,
    blurb: 'It makes no sound. Cast it and the water goes flat for thirty feet. Nobody at the shop will say where it came from.',
    lift: 8.00, fall: 1.90, control: 4.20, band: 0.30, line: 6.00, reach: 1.00,
    lure: 3.20, luck: 3.00, rare: 3.40,
    art: {
      shaft: 'glass', len: 2.60, taper: 0.80, joints: 0, bend: 0.16,
      reel: 'ornate', guides: 9, grip: 'wrapcord', wrap: 0x1a2a34, butt: 'jewel',
      tipCol: 0xdcf8ff, lineCol: 0xffffff, glow: 0x9fe4ff, filigree: true, spectral: true, flair: 'finial',
    },
  },
];

export const ROD_BY_ID = Object.fromEntries(RODS.map(r => [r.id, r]));
export const STARTER_ROD = RODS[0].id;

/** Everything a given village has on the rack, cheapest first. */
export function rodsAt(villageId) {
  return RODS.filter(r => r.at === villageId && r.price > 0)
    .sort((a, b) => a.price - b.price);
}

/** The rod the player is actually using, falling back to the starter. */
export function rodOf(id) { return ROD_BY_ID[id] || RODS[0]; }

/**
 * How a rod reads on a shop card: the four or five numbers a player can feel.
 * Shown as a delta against what they already own, because "Control 2.30" is
 * meaningless and "+0.45 Control" is a reason to buy something.
 */
export const ROD_STATS = [
  { key: 'lift', label: 'Pull', hint: 'how hard the band rises' },
  { key: 'control', label: 'Control', hint: 'how steadily it holds a line' },
  { key: 'band', label: 'Zone', hint: 'how much water the band covers' },
  { key: 'line', label: 'Line', hint: 'the heaviest fish it can hold' },
  { key: 'reach', label: 'Depth', hint: 'how deep you can fish' },
  { key: 'lure', label: 'Lure', hint: 'how fast a bite comes' },
  { key: 'luck', label: 'Luck', hint: 'the odds of a mutation' },
  { key: 'rare', label: 'Fortune', hint: 'the odds of something rare' },
];
