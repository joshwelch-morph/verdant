/**
 * nav.js
 * Screen navigation. Verdant uses a flat set of full-screen "screens"
 * (s0–s5). Transitions are CSS-driven; this module just swaps classes
 * and fires screen-specific init hooks.
 */

import { initMap } from './map.js';
import { renderPlan } from './plan.js';
import { renderCal, activateCurrentSeasonTab } from './calendar.js';
import { renderReport } from './report.js';
import { renderDashboard } from './dashboard.js';
import { initSysRow } from './inat.js';
import { setPersistedScreen } from './persist.js';
import { markScreenSeen } from './tour.js';

let currentScreen = 's0';

/**
 * Navigate to a screen by ID.
 * @param {string} id - e.g. 's1', 's2'
 */
export function navTo(id) {
  if (id === currentScreen) return;

  const prev = document.getElementById(currentScreen);
  const next = document.getElementById(id);
  if (!prev || !next) return;

  prev.classList.remove('active');
  prev.classList.add('prev');
  setTimeout(() => prev.classList.remove('prev'), 350);

  next.classList.add('active');
  currentScreen = id;

  // Persist the current screen so we can restore it on reload
  setPersistedScreen(id);

  // Show first-visit tour tooltip for this screen
  markScreenSeen(id);

  // Sync bottom nav highlight
  document.querySelectorAll('.ni').forEach(n => n.classList.remove('on'));
  const ni = document.getElementById('n-' + id);
  if (ni) ni.classList.add('on');

  // Screen-specific init
  if (id === 's1') initMap();
  if (id === 's2') initSysRow();
  if (id === 's3') renderPlan();
  if (id === 's4') activateCurrentSeasonTab();
  if (id === 's5') renderReport();
  if (id === 's6') renderDashboard();

  // Close any open drawer when navigating away from map
  const drawer = document.getElementById('drawer');
  if (drawer) drawer.classList.remove('open');
}

/**
 * Wire up bottom-nav buttons and show the nav bar.
 * Called once from app.js after setup is complete.
 */
export function showNav() {
  const nav = document.getElementById('appNav');
  if (nav) nav.style.display = 'block';

  document.querySelectorAll('.ni[data-screen]').forEach(btn => {
    btn.addEventListener('click', () => navTo(btn.dataset.screen));
  });
}

export function getCurrentScreen() {
  return currentScreen;
}
