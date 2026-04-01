/**
 * plantbrowser.js
 * Plant Browser — search, filter, and suitability-check the curated plant database.
 *
 * Renders a modal/drawer overlay on the Design screen (S3) so users can:
 *   1. Browse all plants by category or search by name / role
 *   2. See a suitability badge (✅ Thrives / ⚠️ Marginal / ❌ Not suited)
 *   3. Add plants directly to their plan
 *
 * Suitability is evaluated against:
 *   - USDA hardiness zone (APP.siteProfile.hardiness.zone or APP.property.hardiness)
 *   - Chill hours (APP.siteProfile.chill_hours or derived from climate data)
 *   - Drought months (if droughtTolerant required)
 *   - Wet soil risk
 *
 * No external API calls — fully offline once plants.json is loaded.
 */

import { APP } from './state.js';
import { t } from './i18n.js';

// ── Module state ────────────────────────────────────────────────────────────
let _allPlants = [];        // raw JSON array
let _loaded    = false;
let _query     = '';
let _category  = 'All';
let _onAdd     = null;      // callback(plant) when user adds a plant

// ── Load plant database ─────────────────────────────────────────────────────
async function _loadPlants() {
  if (_loaded) return;
  const res  = await fetch('./src/data/plants.json');
  _allPlants = await res.json();
  _loaded    = true;
}

// ── Suitability engine ──────────────────────────────────────────────────────

/**
 * Returns { level: 'great'|'marginal'|'poor', reasons: string[] }
 *
 * Zone number is the USDA zone integer (e.g. 6 for zone 6b).
 */
function _assess(plant) {
  const sp  = APP.siteProfile || {};
  const prop = APP.property   || {};

  // ── Resolve hardiness zone ──
  let zone = null;
  // Try siteProfile first
  if (sp.hardiness?.zone) {
    const m = String(sp.hardiness.zone).match(/(\d+)/);
    if (m) zone = parseInt(m[1], 10);
  }
  // Fallback to property.hardiness string like "Zone 6b" or "6"
  if (zone == null && prop.hardiness) {
    const m = String(prop.hardiness).match(/(\d+)/);
    if (m) zone = parseInt(m[1], 10);
  }

  // ── Resolve chill hours ──
  let chillHours = sp.chill_hours ?? null;
  // If not stored directly, estimate from frost months and average winter temp
  if (chillHours == null && sp.frost_months?.length) {
    // Rough heuristic: each frost month ≈ 200 chill hours (very approximate)
    chillHours = sp.frost_months.length * 200;
  }

  // ── Resolve drought / wet indicators ──
  const droughtMonths = sp.drought_months?.length ?? 0;
  const wetFeet = (sp.water_balance || '').toLowerCase().includes('surplus') ||
                  (prop.water || '').toLowerCase().includes('creek') ||
                  (prop.water || '').toLowerCase().includes('flood') ||
                  (prop.water || '').toLowerCase().includes('wet');

  const reasons  = [];
  const warnings = [];
  const issues   = [];

  // ── Zone check ──
  if (zone != null) {
    if (zone < plant.hardinessMin) {
      issues.push(`Zone ${zone} is too cold (needs zone ${plant.hardinessMin}+)`);
    } else if (zone > plant.hardinessMax) {
      if (plant.hardinessMax <= 8) {
        // Some plants can't handle truly hot zones
        issues.push(`Zone ${zone} may be too warm (rated to zone ${plant.hardinessMax})`);
      } else {
        warnings.push(`At upper end of hardiness range (zone ${plant.hardinessMax})`);
      }
    } else {
      reasons.push(`Zone ${zone} is within rated range (${plant.hardinessMin}–${plant.hardinessMax})`);
    }
  }

  // ── Chill hours check ──
  if (chillHours != null && plant.chillHours > 0) {
    if (chillHours < plant.chillHours * 0.75) {
      issues.push(`Insufficient chill hours — needs ~${plant.chillHours} hrs, site has ~${chillHours}`);
    } else if (chillHours < plant.chillHours) {
      warnings.push(`Borderline chill hours (~${chillHours} of ${plant.chillHours} needed)`);
    } else {
      reasons.push(`Sufficient chill hours (~${chillHours} hrs available)`);
    }
  }

  // ── Drought check ──
  if (droughtMonths >= 3 && !plant.droughtTolerant && plant.waterNeeds !== 'low') {
    warnings.push(`${droughtMonths} dry months — consider irrigation`);
  } else if (droughtMonths >= 5 && !plant.droughtTolerant) {
    issues.push(`Extended drought (${droughtMonths} months) — plant needs consistent water`);
  } else if (droughtMonths >= 3 && plant.droughtTolerant) {
    reasons.push('Drought tolerant — suits dry periods');
  }

  // ── Wet feet check ──
  if (wetFeet && !plant.wetFeetTolerant && plant.waterNeeds !== 'high') {
    warnings.push('Poorly drained or wet soils may cause root rot');
  } else if (wetFeet && plant.wetFeetTolerant) {
    reasons.push('Tolerates wet/moist soils well');
  }

  // ── Determine level ──
  let level;
  if (issues.length > 0)        level = 'poor';
  else if (warnings.length > 0) level = 'marginal';
  else                          level = 'great';

  return {
    level,
    reasons,
    warnings,
    issues,
    allNotes: [...reasons, ...warnings, ...issues],
  };
}

// ── Filter logic ────────────────────────────────────────────────────────────
function _filtered() {
  let list = _allPlants;
  if (_category !== 'All') {
    list = list.filter(p => p.category === _category);
  }
  if (_query.trim()) {
    const q = _query.toLowerCase();
    list = list.filter(p =>
      p.name.toLowerCase().includes(q)   ||
      p.latin.toLowerCase().includes(q)  ||
      (p.notes || '').toLowerCase().includes(q) ||
      (p.roles || []).some(r => r.includes(q))  ||
      (p.category || '').toLowerCase().includes(q)
    );
  }
  return list;
}

// ── Badge HTML ──────────────────────────────────────────────────────────────
function _badgeHTML(assessment) {
  if (assessment.level === 'great') {
    return `<span class="pb-badge pb-badge-great">${t('pb.thrives')}</span>`;
  }
  if (assessment.level === 'marginal') {
    return `<span class="pb-badge pb-badge-marginal">${t('pb.marginal')}</span>`;
  }
  return `<span class="pb-badge pb-badge-poor">${t('pb.poor')}</span>`;
}

function _suitabilityTooltip(assessment) {
  const all = [...assessment.reasons, ...assessment.warnings, ...assessment.issues];
  if (!all.length) return 'No site data yet — run analysis for full assessment';
  return all.join(' · ');
}

// ── Card HTML ───────────────────────────────────────────────────────────────
function _cardHTML(plant) {
  const a    = _assess(plant);
  const isAdded = APP.addedPlants.has(plant.id) || APP.addedPlants.has(plant.name);

  const roleIcons = {
    food: '🍽️', medicinal: '💊', nitrogen_fix: '🌱', wildlife_habitat: '🦋',
    pollinator_support: '🐝', windbreak: '🌾', timber: '🪵', groundcover: '🍀',
    dynamic_accumulator: '⬆️', cover_crop: '🌾', culinary: '🧑‍🍳',
    soil_building: '🪱', fodder: '🌿', pest_repellent: '🚫', water_management: '💧',
  };
  const roleChips = (plant.roles || []).slice(0, 4).map(r =>
    `<span class="pb-role">${roleIcons[r] || '🌿'} ${r.replace(/_/g, ' ')}</span>`
  ).join('');

  const suitTip = _suitabilityTooltip(a);

  return `
<div class="pb-card pb-suit-${a.level}" data-id="${plant.id}">
  <div class="pb-card-top">
    <div class="pb-emoji">${plant.emoji}</div>
    <div class="pb-card-info">
      <div class="pb-card-name">${plant.name}</div>
      <div class="pb-card-latin">${plant.latin}</div>
    </div>
    <div class="pb-badge-wrap" title="${suitTip}">${_badgeHTML(a)}</div>
  </div>
  <div class="pb-card-roles">${roleChips}</div>
  <div class="pb-card-meta">
    <span>📏 ${plant.matureHeight}</span>
    <span>🗓️ Fruit in ${plant.yearsToFruit} yr</span>
    <span>☀️ ${plant.sunNeeds.replace('_', ' ')}</span>
    <span>💧 ${plant.waterNeeds}</span>
  </div>
  ${plant.notes ? `<div class="pb-card-notes">${plant.notes}</div>` : ''}
  ${a.allNotes.length ? `<div class="pb-suit-notes pb-suit-notes-${a.level}">${a.allNotes.slice(0,2).join(' · ')}</div>` : ''}
  <button class="pb-add-btn ${isAdded ? 'pb-add-btn-added' : ''}" data-id="${plant.id}">
    ${isAdded ? t('pb.added') : t('pb.add')}
  </button>
</div>`;
}

// ── Categories ──────────────────────────────────────────────────────────────
function _categories() {
  const cats = ['All', ...new Set(_allPlants.map(p => p.category))];
  return cats;
}

// ── Render browser ──────────────────────────────────────────────────────────
function _renderBrowser() {
  const overlay = document.getElementById('pb-overlay');
  if (!overlay) return;

  const cats    = _categories();
  const plants  = _filtered();
  const hasZone = !!(APP.siteProfile?.hardiness?.zone || APP.property?.hardiness);

  // Zone display
  const zoneStr = APP.siteProfile?.hardiness?.zone
    ? `Zone ${APP.siteProfile.hardiness.zone}`
    : APP.property?.hardiness || null;

  const zoneChip = zoneStr
    ? `<span class="pb-zone-chip">📍 ${zoneStr}</span>`
    : `<span class="pb-zone-chip pb-zone-missing">📍 ${t('pb.run_analysis')}</span>`;

  overlay.innerHTML = `
<div class="pb-drawer">
  <div class="pb-drawer-header">
    <div class="pb-drawer-title">
      <span class="pb-drawer-ico">🌿</span>
      <div>
        <div class="pb-drawer-h">${t('pb.title')}</div>
        <div class="pb-drawer-sub">${_allPlants.length} ${t('pb.shown')} ${zoneChip}</div>
      </div>
    </div>
    <button class="pb-close-btn" id="pb-close">✕</button>
  </div>

  <div class="pb-controls">
    <input
      class="pb-search"
      id="pb-search"
      type="text"
      placeholder="${t('pb.search')}"
      value="${_query}"
      autocomplete="off"
    />
    <div class="pb-cats" id="pb-cats">
      ${cats.map(c => `<button class="pb-cat-btn ${c === _category ? 'pb-cat-active' : ''}" data-cat="${c}">${c}</button>`).join('')}
    </div>
  </div>

  <div class="pb-results-count">${plants.length} ${t('pb.shown')}</div>

  <div class="pb-grid" id="pb-grid">
    ${plants.length
      ? plants.map(_cardHTML).join('')
      : `<div class="pb-empty">No plants match your search. Try a different name or category.</div>`
    }
  </div>
</div>`;

  // ── Events ──────────────────────────────────────────────────────────
  document.getElementById('pb-close').addEventListener('click', closeBrowser);

  // Click outside drawer closes
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeBrowser();
  });

  document.getElementById('pb-search').addEventListener('input', e => {
    _query = e.target.value;
    _refreshGrid();
  });

  document.getElementById('pb-cats').addEventListener('click', e => {
    const btn = e.target.closest('.pb-cat-btn');
    if (!btn) return;
    _category = btn.dataset.cat;
    _query = '';
    document.getElementById('pb-search').value = '';
    _renderBrowser();
  });

  document.getElementById('pb-grid').addEventListener('click', e => {
    const btn = e.target.closest('.pb-add-btn');
    if (!btn) return;
    const id   = btn.dataset.id;
    const plant = _allPlants.find(p => p.id === id);
    if (!plant) return;

    const alreadyAdded = APP.addedPlants.has(plant.id) || APP.addedPlants.has(plant.name);
    if (alreadyAdded) {
      APP.addedPlants.delete(plant.id);
      APP.addedPlants.delete(plant.name);
      btn.textContent = t('pb.add');
      btn.classList.remove('pb-add-btn-added');
      btn.closest('.pb-card').classList.remove('pb-card-added');
    } else {
      APP.addedPlants.add(plant.id);
      btn.textContent = t('pb.added');
      btn.classList.add('pb-add-btn-added');
      btn.closest('.pb-card').classList.add('pb-card-added');
      // Fire callback if registered
      if (_onAdd) _onAdd(plant);
    }
  });
}

function _refreshGrid() {
  const grid   = document.getElementById('pb-grid');
  const count  = document.querySelector('.pb-results-count');
  if (!grid) return;
  const plants = _filtered();
  if (count) count.textContent = `${plants.length} ${t('pb.shown')}`;
  grid.innerHTML = plants.length
    ? plants.map(_cardHTML).join('')
    : `<div class="pb-empty">${t('pb.no_results')}</div>`;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Open the plant browser overlay.
 * @param {function} onAdd  Optional callback fired when user adds a plant
 */
export async function openBrowser(onAdd) {
  _onAdd = onAdd || null;
  await _loadPlants();

  // Create overlay if it doesn't exist
  let overlay = document.getElementById('pb-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'pb-overlay';
    overlay.className = 'pb-overlay';
    document.body.appendChild(overlay);
  }
  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  _renderBrowser();
}

export function closeBrowser() {
  const overlay = document.getElementById('pb-overlay');
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
}

/**
 * Returns suitability assessment for a single plant by id or name.
 * Useful for showing inline badges on AI-generated plants in plan.js.
 */
export async function assessPlant(idOrName) {
  await _loadPlants();
  const plant = _allPlants.find(p => p.id === idOrName || p.name.toLowerCase() === idOrName.toLowerCase());
  if (!plant) return null;
  return { plant, assessment: _assess(plant) };
}

/**
 * Returns an array of { plant, assessment } for all plants matching a query.
 */
export async function searchPlants(query) {
  await _loadPlants();
  _query = query;
  return _filtered().map(p => ({ plant: p, assessment: _assess(p) }));
}
