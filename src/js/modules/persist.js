/**
 * persist.js
 * localStorage persistence for Verdant.
 *
 * Saves all non-sensitive APP state so the user's work survives a page
 * refresh. API keys and tokens are intentionally NEVER persisted.
 *
 * Public API:
 *   saveState()         — write current APP state to localStorage
 *   loadState()         — restore APP state from localStorage (call on boot)
 *   clearState()        — wipe persisted state (for "Start Over")
 *   hasSavedState()     — true if a valid saved session exists
 *   getSavedScreen()    — the screen the user was on when last saved
 */

import { APP } from './state.js';

const STORAGE_KEY = 'verdant_v1';

// ── Serialise / deserialise helpers ────────────────────────────────────

/**
 * Convert APP state to a plain object safe for JSON.stringify.
 * Sets become arrays; everything else passes through.
 */
function _serialise() {
  return {
    _savedAt:      Date.now(),
    _screen:       _lastScreen,

    property:      { ...APP.property },
    siteProfile:   APP.siteProfile ? { ...APP.siteProfile } : null,

    // Sets → arrays
    selectedOpps:  [...APP.selectedOpps],
    addedPlants:   [...APP.addedPlants],

    // Analysis results
    plants:        APP.plants,
    medicinals:    APP.medicinals,
    wildlife:      APP.wildlife,
    analysisRan:   APP.analysisRan,

    // iNat observations
    inatPlants:    APP.inatPlants,
    inatAnimals:   APP.inatAnimals,

    // Custom map zones
    customZones:   APP.customZones,
  };
}

/**
 * Restore serialised data back into APP.
 * Returns false if data is missing or structurally invalid.
 */
function _deserialise(data) {
  if (!data || !data.property) return false;

  try {
    // Property
    Object.assign(APP.property, data.property);

    // Site profile
    APP.siteProfile = data.siteProfile || null;

    // Sets
    APP.selectedOpps = new Set(data.selectedOpps || []);
    APP.addedPlants  = new Set(data.addedPlants  || []);

    // Analysis results
    APP.plants      = data.plants      || [];
    APP.medicinals  = data.medicinals  || [];
    APP.wildlife    = data.wildlife    || {};
    APP.analysisRan = data.analysisRan || false;

    // iNat
    APP.inatPlants   = data.inatPlants   || [];
    APP.inatAnimals  = data.inatAnimals  || [];

    // Custom zones
    APP.customZones  = data.customZones  || [];

    return true;
  } catch {
    return false;
  }
}

// ── Track current screen so we can restore it ──────────────────────────

let _lastScreen = 's1';

export function setPersistedScreen(screenId) {
  _lastScreen = screenId;
  // Debounce: update storage immediately so screen is always in sync
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      d._screen = screenId;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
    }
  } catch { /* silent */ }
}

// ── Public functions ────────────────────────────────────────────────────

/**
 * Persist the current APP state to localStorage.
 * Call after any meaningful state change (analysis, plant add, etc.)
 */
export function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_serialise()));
  } catch (e) {
    // localStorage may be full or blocked in private browsing
    console.warn('[Verdant] Could not save state:', e.message);
  }
}

/**
 * Load persisted state into APP.
 * @returns {boolean} true if state was successfully restored
 */
export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    const ok = _deserialise(data);
    if (ok && data._screen) _lastScreen = data._screen;
    return ok;
  } catch {
    return false;
  }
}

/**
 * Wipe saved state and reset the last-screen tracker.
 * Use for "Start Over" / reset flows.
 */
export function clearState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* silent */ }
  _lastScreen = 's1';
}

/**
 * Returns true if there is a valid saved session in localStorage.
 */
export function hasSavedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    return !!(data && data.property && data.property.address);
  } catch {
    return false;
  }
}

/**
 * Returns the screen ID the user was on when state was last saved.
 * Defaults to 's1'.
 */
export function getSavedScreen() {
  return _lastScreen || 's1';
}

/**
 * Returns the saved-at timestamp (ms since epoch), or null.
 */
export function getSavedAt() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw)?._savedAt || null;
  } catch {
    return null;
  }
}
