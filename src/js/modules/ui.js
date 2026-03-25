/**
 * ui.js
 * Shared UI utilities: toast notifications, the map-side drawer,
 * and small DOM helpers used across multiple modules.
 */

// ── Toast ──────────────────────────────────────────────────────────────

let toastTimer = null;

/**
 * Show a brief toast notification.
 * @param {string} message
 * @param {string} [icon='✅']
 */
export function toast(message, icon = '✅') {
  const el = document.getElementById('toast');
  const msgEl = document.getElementById('t-m');
  const icoEl = document.getElementById('t-i');
  if (!el || !msgEl || !icoEl) return;

  msgEl.textContent = message;
  icoEl.textContent = icon;
  el.classList.add('on');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2500);
}

// ── Drawer ─────────────────────────────────────────────────────────────

let currentDrawerOppId = null;

/**
 * Open the map side-drawer with an opportunity's detail.
 * @param {object} opp - Opportunity object (from aiOpps or oppData)
 * @param {boolean} isAdded - Whether already added to design
 * @param {function} onToggle - Called with (oppId) when the add/remove button is clicked
 */
export function openDrawer(opp, isAdded, onToggle) {
  currentDrawerOppId = opp.id;

  const catColors = {
    water: 'rgba(58,159,200,.15)',
    food: 'rgba(92,184,50,.12)',
    solar: 'rgba(232,168,48,.15)',
    soil: 'rgba(200,120,48,.12)',
  };
  const bg = catColors[opp.category] || opp.ib || 'rgba(85,176,37,.12)';

  const statsHtml = (opp.stats || [])
    .map(s => `<div class="stat-box"><div class="stat-v">${s.v}</div><div class="stat-l">${s.l}</div></div>`)
    .join('');

  const tagsHtml = (opp.tags || [])
    .map(t => `<span class="tag t-green">${t}</span>`)
    .join('');

  const reasonHtml = opp.reasoning
    ? `<div style="background:rgba(85,176,37,.07);border:1px solid rgba(85,176,37,.15);border-left:3px solid rgba(85,176,37,.4);border-radius:10px;padding:10px 12px;margin-bottom:12px;">
        <div style="font-size:9px;font-weight:800;color:var(--green-lt);letter-spacing:.06em;margin-bottom:5px;">🗺 WHY THIS LOCATION</div>
        <div style="font-size:12px;color:rgba(240,234,216,.85);line-height:1.7;">${opp.reasoning}</div>
      </div>`
    : opp.desc
      ? `<div class="d-desc">${opp.desc}</div>`
      : '';

  document.getElementById('d-hd').innerHTML = `
    <div class="d-ico" style="background:${bg}">${opp.icon}</div>
    <div>
      <div class="d-title">${opp.title}</div>
      <div class="d-sub">${opp.sub || (opp.impact ? opp.impact + ' impact · AI placed' : 'AI terrain analysis')}</div>
    </div>
    <div class="d-x" id="drawerClose">✕</div>`;

  document.getElementById('d-body').innerHTML = `
    <div class="stat-row">${statsHtml}</div>
    ${reasonHtml}
    <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:4px">${tagsHtml}</div>`;

  document.getElementById('d-ft').innerHTML = `
    <button class="d-add ${isAdded ? 'done' : ''}" id="dAddBtn">
      ${isAdded ? '✓ Added to design' : '+ Add to my design'}
    </button>
    <button class="d-later" id="dLaterBtn">Later</button>`;

  document.getElementById('drawer').classList.add('open');

  // Wire buttons
  document.getElementById('drawerClose').addEventListener('click', closeDrawer);
  document.getElementById('dLaterBtn').addEventListener('click', closeDrawer);
  document.getElementById('dAddBtn').addEventListener('click', () => {
    if (onToggle) onToggle(opp.id);
  });
}

/**
 * Update the drawer's add button state without re-rendering the full drawer.
 * @param {boolean} isAdded
 */
export function updateDrawerAddBtn(isAdded) {
  const btn = document.getElementById('dAddBtn');
  if (!btn) return;
  btn.className = 'd-add' + (isAdded ? ' done' : '');
  btn.textContent = isAdded ? '✓ Added to design' : '+ Add to my design';
}

export function closeDrawer() {
  const drawer = document.getElementById('drawer');
  if (drawer) drawer.classList.remove('open');
  currentDrawerOppId = null;
}

export function getCurrentDrawerOppId() {
  return currentDrawerOppId;
}

// ── Small helpers ──────────────────────────────────────────────────────

/**
 * Map a plant role name to a CSS tag class.
 */
export function roleClass(role) {
  return {
    Food: 't-green',
    'N-Fixer': 't-blue',
    Accumulator: 't-amber',
    Medicinal: 't-purple',
    Wildlife: 't-teal',
  }[role] || 't-gray';
}

/**
 * Map a forest layer name to an emoji.
 */
export function layerEmoji(layer) {
  return {
    Canopy: '🌳',
    'Sub-canopy': '🌲',
    Shrub: '🫐',
    Herbaceous: '🌿',
    Groundcover: '🍀',
    Vine: '🍇',
    Root: '🥕',
  }[layer] || '🌱';
}
