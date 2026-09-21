/* Icons.js — every glyph in the interface, drawn as vector paths.
   ===========================================================================
   There are no emoji in Hearthwood. Emoji are a different typeface on every
   machine, they are the wrong weight next to a serif, half of them are
   unreadable at 16 px, and none of them can take the interface's colour.

   RULES, learned the hard way:
     - SOLID FILLS, NO STROKES. A stroked icon at 16 px is a smudge.
     - ONE 24×24 GRID for everything, so a row of icons optically aligns.
     - `currentColor`, so an icon inherits the text colour it sits beside.
     - Interior detail is a HOLE punched with fill-rule="evenodd" in the SAME
       path. Shapes meant to UNION must be separate <path> elements —
       overlapping subpaths in one evenodd path CANCEL, which silently ate
       half of these the first time round.
*/

const P = {
  stick: 'M3.2 17.8 L14.4 6.6 a1.6 1.6 0 0 1 2.3 2.3 L5.5 20.1 a1.6 1.6 0 0 1-2.3-2.3 Z' +
    'M14.8 9.2 L19 5 l1.6 1.6 L16.4 10.8 Z M12.4 11.6 L16.2 15.4 l-1.6 1.6 -3.8-3.8 Z',
  satchel: 'M4 9 h16 a1 1 0 0 1 1 1 v9 a2 2 0 0 1-2 2 H5 a2 2 0 0 1-2-2 v-9 a1 1 0 0 1 1-1 Z' +
    'M8 9 V7 a4 4 0 0 1 8 0 v2 h-2 V7 a2 2 0 0 0-4 0 v2 Z M10 13 h4 v2 h-4 Z',
  hammer: 'M13.6 3 L21 10.4 l-2.8 2.8 -2.2-2.2 -7.4 7.4 a2 2 0 0 1-2.8-2.8 l7.4-7.4 -2.2-2.2 Z',
  leaf: 'M20 4 c-9 0-15 4-15 11 a5 5 0 0 0 1.4 3.5 L4 21 l1.4 1.4 2.5-2.5 A5 5 0 0 0 11 21 c7 0 9-6 9-17 Z',
  spark: 'M12 2 l1.9 6.4 6.1 1.6 -6.1 1.6 -1.9 6.4 -1.9-6.4 -6.1-1.6 6.1-1.6 Z' +
    'M19 15 l.9 2.6 2.6.9 -2.6.9 -.9 2.6 -.9-2.6 -2.6-.9 2.6-.9 Z',
  home: 'M12 3 L2 11 h3 v9 h5 v-6 h4 v6 h5 v-9 h3 Z',
  tree: 'M12 2 L18 9 h-3 l4 5 h-3.5 l3.5 5 H9 l3.5-5 H9 l4-5 h-3 Z M11 19 h2 v3 h-2 Z',
  map: 'M9 3 L3 5.5 v16 L9 19 l6 2.5 6-2.5 v-16 L15 5.5 Z M9 5.6 l4 1.7 v11.1 l-4-1.7 Z',
  close: 'M5.6 4.2 L12 10.6 18.4 4.2 19.8 5.6 13.4 12 19.8 18.4 18.4 19.8 12 13.4 5.6 19.8 4.2 18.4 10.6 12 4.2 5.6 Z',
  check: 'M9.6 17.2 L4.4 12 6 10.4 l3.6 3.6 8.4-8.4 1.6 1.6 Z',
  chevron: 'M8.6 5.6 L15 12 8.6 18.4 7.2 17 12.2 12 7.2 7 Z',
  heart: 'M12 21 C5 16 2 12.4 2 8.8 A4.8 4.8 0 0 1 12 6.2 4.8 4.8 0 0 1 22 8.8 C22 12.4 19 16 12 21 Z',
  moon: 'M13 2 A10 10 0 1 0 22 14 8 8 0 0 1 13 2 Z',
  sun: 'M12 7 a5 5 0 1 0 0 10 5 5 0 0 0 0-10 Z M11 1 h2 v3.4 h-2 Z M11 19.6 h2 V23 h-2 Z' +
    'M1 11 h3.4 v2 H1 Z M19.6 11 H23 v2 h-3.4 Z M4.2 5.6 L5.6 4.2 8 6.6 6.6 8 Z' +
    'M16 17.4 l1.4-1.4 2.4 2.4 -1.4 1.4 Z M17.4 8 L16 6.6 18.4 4.2 19.8 5.6 Z M6.6 16 L8 17.4 5.6 19.8 4.2 18.4 Z',
  mushroom: 'M12 2 C6.5 2 2.5 6 2.5 10 h19 C21.5 6 17.5 2 12 2 Z M9.5 11.5 h5 v7.5 a2.5 2.5 0 0 1-5 0 Z',
  moss: 'M3 18 c2-4 5-2 6-5 1 3 4 1 6 5 z M13 19 c1.5-3 4-1.5 5-4 .8 2.5 3 1 3 4 z',
  sword: 'M18.5 2 L21 4.5 11.5 14 9 11.5 Z M8 12.5 L11.5 16 8.8 18.7 7.5 17.4 5.8 19.1 4.5 17.8 6.2 16.1 4.9 14.8 Z',
  broom: 'M14.8 2.4 L16.6 4.2 9.8 11 8 9.2 Z M8.4 11.6 l4 4 -1.6 1.6 c-1.6 1.6-5.4 2.4-8.4 4.4 2-3 2.8-6.8 4.4-8.4 Z',
  crown: 'M3 8 l4 4 5-7 5 7 4-4 -2 11 H5 Z M5 20 h14 v2 H5 Z',
  clock: 'M12 2 a10 10 0 1 0 0 20 10 10 0 0 0 0-20 Z M12 4.2 a7.8 7.8 0 1 1 0 15.6 7.8 7.8 0 0 1 0-15.6 Z' +
    'M11 6.5 h2 V12 l4 2.4 -1 1.7 -5-3 Z',
  eye: 'M12 5 C6 5 2 9.4 1 12 c1 2.6 5 7 11 7 s10-4.4 11-7 C22 9.4 18 5 12 5 Z' +
    'M12 8.2 a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 0 1 0-7.6 Z',
  paw: 'M6.5 11 a2.6 2.6 0 1 1 0-5.2 2.6 2.6 0 0 1 0 5.2 Z M17.5 11 a2.6 2.6 0 1 1 0-5.2 2.6 2.6 0 0 1 0 5.2 Z' +
    'M10 6.4 a2.3 2.3 0 1 1 0-4.6 2.3 2.3 0 0 1 0 4.6 Z M14 6.4 a2.3 2.3 0 1 1 0-4.6 2.3 2.3 0 0 1 0 4.6 Z' +
    'M12 11.5 c3.6 0 6 2.6 6 5.3 0 2-1.7 3.4-3.6 3.1 -1.6-.3-3.2-.3-4.8 0 -1.9.3-3.6-1.1-3.6-3.1 0-2.7 2.4-5.3 6-5.3 Z',
  drop: 'M12 2 C12 2 5 10 5 14.6 A7 7 0 0 0 19 14.6 C19 10 12 2 12 2 Z',
  scroll: 'M5 3 h11 a3 3 0 0 1 3 3 v13 a2 2 0 0 0 2 2 H7 a3 3 0 0 1-3-3 V4 a1 1 0 0 1 1-1 Z' +
    'M7 7 h8 v1.8 H7 Z M7 10.6 h8 v1.8 H7 Z M7 14.2 h5 V16 H7 Z',
  arrow: 'M12 3 L20 11 h-5 v10 H9 V11 H4 Z',
  plus: 'M11 4 h2 v7 h7 v2 h-7 v7 h-2 v-7 H4 v-2 h7 Z',
  minus: 'M4 11 h16 v2 H4 Z',
  bag: 'M6 8 h12 l1.6 12 a2 2 0 0 1-2 2.2 H6.4 a2 2 0 0 1-2-2.2 Z M9 8 V6 a3 3 0 0 1 6 0 v2 h-2 V6 a1 1 0 0 0-2 0 v2 Z',
  fire: 'M12 2 c1 4-3 5-3 9a3 3 0 0 0 6 0c0-1.6-.6-2.4-.6-3.6 2 1.6 3.6 4 3.6 6.4a6 6 0 0 1-12 0C6 9 12 8 12 2 Z',
  wind: 'M3 8 h11 a2.5 2.5 0 1 0-2.5-2.5 h-2 A4.5 4.5 0 1 1 14 10 H3 Z' +
    'M3 13 h14 a2.5 2.5 0 1 1-2.5 2.5 h-2 A4.5 4.5 0 1 0 17 11 H3 Z',

  /* --- FISH N STICKS ---------------------------------------------------
     The body and the eye are ONE evenodd path, so the eye is a hole. The
     tail is a separate path, because a tail that overlapped the body in
     the same evenodd path would cancel it — which is exactly the trap the
     header warns about, and exactly what happened on the first attempt. */
  fish: 'M13.6 5 C17.8 5 21 8.2 22 12 21 15.8 17.8 19 13.6 19 9.4 19 6.2 15.8 5.2 12 '
    + '6.2 8.2 9.4 5 13.6 5 Z M16.4 9.6 a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3 Z',
  tail: 'M5.4 12 L1.6 7.4 v9.2 Z',
  rod: 'M2.6 20.2 L4.1 21.7 6.6 19.2 5.1 17.7 Z'          // the cork grip
    + 'M5.8 17 L7.1 18.3 C12.4 13 16.6 8.6 20.9 2.6 15 6.9 10.7 11.4 5.8 17 Z'  // the shaft
    + 'M8.2 14.2 a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8 Z'                    // the reel
    + 'M19.4 3.4 L21 5 C19 8.4 17.2 11.2 15.4 13 l-1-1 c1.8-2 3.4-4.6 5-8.6 Z', // the line
  coin: 'M12 2 a10 10 0 1 0 0 20 10 10 0 0 0 0-20 Z M12 4.4 a7.6 7.6 0 1 1 0 15.2 7.6 7.6 0 0 1 0-15.2 Z'
    + 'M11 6.4 h2 v1.2 h2 v2 h-4 v1.4 h4 v4.6 h-2 v1.2 h-2 v-1.2 H9 v-2 h4 v-1.4 H9 V7.6 h2 Z',
  star: 'M12 1.8 l3.1 6.6 7 .9 -5.1 4.9 1.3 7.1 -6.3-3.5 -6.3 3.5 1.3-7.1 -5.1-4.9 7-.9 Z',
  sort: 'M7 3 L11 8 H8 v13 H6 V8 H3 Z M17 21 L13 16 h3 V3 h2 v13 h3 Z',
  scale: 'M11 2 h2 v2.4 h6 v2 h-6 V20 h5 v2 H6 v-2 h5 V6.4 H5 v-2 h6 Z',
};

/** Icon markup, for interpolating straight into innerHTML. */
export function ic(name, cls = '') {
  const d = P[name] || P.stick;
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">` +
    `<path fill="currentColor" fill-rule="evenodd" d="${d}"/></svg>`;
}

export const ICON_NAMES = Object.keys(P);
