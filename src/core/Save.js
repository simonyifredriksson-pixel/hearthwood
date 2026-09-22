/* Save.js — localStorage with a version and a shrug.
   A save that fails must never break the game; the worst case is that you
   start a fresh morning in Hearthwood. */

import { SAVE_KEY } from './Config.js?v=1790102737';

export function loadRaw() {
  try {
    const s = localStorage.getItem(SAVE_KEY);
    if (!s) return null;
    const o = JSON.parse(s);
    return (o && typeof o === 'object') ? o : null;
  } catch (e) {
    console.warn('[save] unreadable, starting fresh', e);
    return null;
  }
}

export function saveRaw(obj) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(obj));
    return true;
  } catch (e) {
    console.warn('[save] could not write', e);
    return false;
  }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* nothing to do */ }
}

export function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
}
