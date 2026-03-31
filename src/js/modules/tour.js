/**
 * tour.js
 * First-run feature tour. Shows a contextual tooltip spotlight on each
 * screen the first time the user visits it after setup.
 *
 * Public API:
 *   initTour()         — call once from app.js after showNav()
 *   markScreenSeen(id) — call from nav.js when a screen is visited
 *
 * Each screen gets at most one tooltip, shown once per install.
 * Tour state is stored in localStorage under 'verdant_tour_v1'.
 */

const TOUR_KEY = 'verdant_tour_v1';

// ── Tour steps ─────────────────────────────────────────────────────────
// One step per screen. `anchor` is a CSS selector for the element to
// point at. If the element can't be found the tooltip centres itself.
// `pos` is the preferred tooltip position: 'top' | 'bottom' | 'left' | 'right'

const STEPS = {
  s1: {
    title: '🗺️ AI Terrain Analysis',
    body:  'Verdant reads your real terrain and places regenerative design opportunities. Tap any pin to add a system to your plan.',
    anchor: '#mapHUD',
    pos:    'bottom',
  },
  s2: {
    title: '🔬 iNaturalist + Analysis',
    body:  'Fetch native plant and animal observations from within 15km of your property, then hit <strong>Analyse My Land</strong> to get AI-powered plant recommendations.',
    anchor: '#fetchPanelHead',
    pos:    'bottom',
  },
  s3: {
    title: '🌿 Your Guild Plan',
    body:  'After analysis, this screen shows your plants grouped into guild companion clusters — tap each to explore relationships and mark systems as done.',
    anchor: '#dp-stat-plants',
    pos:    'bottom',
  },
  s4: {
    title: '📅 Maintenance Calendar',
    body:  'Seasonal task lists tailored to your systems. Use this to plan your workload across the year.',
    anchor: '.season-tabs',
    pos:    'bottom',
  },
  s5: {
    title: '📋 Design Report',
    body:  'Your full property report — scores, narrative, and export to CSV or PDF. The narrative is written by Claude using your real site data.',
    anchor: '#exportPdf',
    pos:    'top',
  },
  s6: {
    title: '🌿 Ecosystem Overview',
    body:  'Live gauges tracking soil health, water retention, pollinator activity, and solar potential — all updated when you run analysis.',
    anchor: '.gauge-grid',
    pos:    'top',
  },
};

// ── State ───────────────────────────────────────────────────────────────

let _seen = new Set();

function _loadSeen() {
  try {
    const raw = localStorage.getItem(TOUR_KEY);
    _seen = new Set(raw ? JSON.parse(raw) : []);
  } catch {
    _seen = new Set();
  }
}

function _saveSeen() {
  try {
    localStorage.setItem(TOUR_KEY, JSON.stringify([..._seen]));
  } catch { /* silent */ }
}

// ── Tooltip renderer ────────────────────────────────────────────────────

let _overlay = null;

function _dismiss() {
  if (_overlay) {
    _overlay.classList.add('tour-out');
    setTimeout(() => {
      _overlay?.remove();
      _overlay = null;
    }, 300);
  }
}

function _showTooltip(step) {
  // Remove any existing tooltip
  _dismiss();

  const tooltip = document.createElement('div');
  tooltip.className = 'tour-tip';
  tooltip.innerHTML = `
    <div class="tt-body">
      <div class="tt-title">${step.title}</div>
      <div class="tt-text">${step.body}</div>
      <div class="tt-footer">
        <button class="tt-dismiss">Got it</button>
      </div>
    </div>
  `;
  document.body.appendChild(tooltip);
  _overlay = tooltip;

  // Position: try to find anchor element
  requestAnimationFrame(() => {
    const anchor = step.anchor ? document.querySelector(step.anchor) : null;
    _positionTooltip(tooltip, anchor, step.pos || 'bottom');

    tooltip.classList.add('tour-in');
    tooltip.querySelector('.tt-dismiss').addEventListener('click', _dismiss);

    // Auto-dismiss after 8 seconds
    setTimeout(() => {
      if (_overlay === tooltip) _dismiss();
    }, 8000);
  });
}

function _positionTooltip(tip, anchor, preferred) {
  const margin = 12;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const tw = tip.offsetWidth || 280;
  const th = tip.offsetHeight || 100;

  if (!anchor) {
    // Centre at bottom
    tip.style.left = Math.max(margin, (vw - tw) / 2) + 'px';
    tip.style.top  = (vh - th - 80) + 'px';
    return;
  }

  const rect = anchor.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top  + rect.height / 2;

  let left, top;

  if (preferred === 'bottom') {
    left = Math.max(margin, Math.min(vw - tw - margin, cx - tw / 2));
    top  = rect.bottom + margin;
    if (top + th > vh - margin) top = rect.top - th - margin; // flip to top
  } else if (preferred === 'top') {
    left = Math.max(margin, Math.min(vw - tw - margin, cx - tw / 2));
    top  = rect.top - th - margin;
    if (top < margin) top = rect.bottom + margin; // flip to bottom
  } else if (preferred === 'left') {
    left = rect.left - tw - margin;
    top  = Math.max(margin, Math.min(vh - th - margin, cy - th / 2));
    if (left < margin) left = rect.right + margin;
  } else { // right
    left = rect.right + margin;
    top  = Math.max(margin, Math.min(vh - th - margin, cy - th / 2));
    if (left + tw > vw - margin) left = rect.left - tw - margin;
  }

  tip.style.left = Math.max(margin, left) + 'px';
  tip.style.top  = Math.max(margin, top)  + 'px';
}

// ── Public API ──────────────────────────────────────────────────────────

export function initTour() {
  _loadSeen();
}

/**
 * Called by nav.js each time a screen becomes active.
 * Shows tour tooltip on first visit.
 */
export function markScreenSeen(screenId) {
  _loadSeen();
  if (_seen.has(screenId)) return;
  _seen.add(screenId);
  _saveSeen();

  const step = STEPS[screenId];
  if (step) {
    // Delay slightly so screen content has rendered
    setTimeout(() => _showTooltip(step), 600);
  }
}

/**
 * Reset tour so all screens show their tooltips again.
 * Exposed for debugging and the "Replay tour" option.
 */
export function resetTour() {
  _seen = new Set();
  try { localStorage.removeItem(TOUR_KEY); } catch { /* silent */ }
}
