/**
 * plan.js
 * Renders the Design Plan screen (S3).
 *
 * When the user has run analysis, this screen is fully data-driven:
 *   - Summary stats from live APP state
 *   - Guild planting sections grouped by companion clusters
 *   - System implementation checklist from selectedOpps
 *   - Phased timeline (adapted to selected systems)
 *   - Earthworks spec (scaled to property size)
 *
 * Before analysis runs, it shows a contextual placeholder.
 */

import { APP } from './state.js';
import { openBrowser } from './plantbrowser.js';

// ── Constants ────────────────────────────────────────────────────────────

const SYSTEM_META = {
  swales:         { ico: '💧', phase: 1, label: 'Contour Swales',       detail: 'Keyline earthworks for water harvesting' },
  pond:           { ico: '🌊', phase: 1, label: 'Retention Pond',       detail: 'On-farm water storage & aquatic habitat' },
  rain_garden:    { ico: '🌧️', phase: 1, label: 'Rain Garden',          detail: 'Bioretention cell for runoff filtering' },
  water_harvesting:{ ico: '🪣', phase: 1, label: 'Water Harvesting',    detail: 'Tank, bore or cistern system' },
  food_forest:    { ico: '🌳', phase: 2, label: 'Food Forest',          detail: '7-layer polyculture system' },
  kitchen_garden: { ico: '🥬', phase: 2, label: 'Kitchen Garden',       detail: 'Annual beds close to the house' },
  medicinals:     { ico: '🌿', phase: 2, label: 'Medicinal Garden',     detail: 'Native & introduced herbals' },
  soil_rehab:     { ico: '🪱', phase: 1, label: 'Soil Rehabilitation',  detail: 'Compost, mulch & cover crops' },
  solar_zone:     { ico: '☀️', phase: 2, label: 'Solar Zone',           detail: 'High-sun food production area' },
  windbreak:      { ico: '🌾', phase: 1, label: 'Windbreak',            detail: 'Shelterbelts & pioneer plantings' },
};

const LAYER_ORDER = [
  'Canopy', 'Sub-canopy', 'Shrub', 'Herbaceous', 'Ground cover', 'Root', 'Climber', 'Aquatic',
  'canopy', 'sub-canopy', 'shrub', 'herbaceous', 'ground cover', 'root', 'climber', 'aquatic',
];

// Layer display info
const LAYER_META = {
  canopy:       { emoji: '🌳', color: '#3D6B47' },
  'sub-canopy': { emoji: '🍎', color: '#5C7F6E' },
  shrub:        { emoji: '🫐', color: '#7EB67A' },
  herbaceous:   { emoji: '🌿', color: '#A3B18A' },
  'ground cover':{ emoji: '🍓', color: '#C4A882' },
  root:         { emoji: '🥕', color: '#B87B4E' },
  climber:      { emoji: '🍇', color: '#8E6EC2' },
  aquatic:      { emoji: '🌾', color: '#5BA3C9' },
};

function _layerMeta(layer) {
  const key = (layer || '').toLowerCase();
  return LAYER_META[key] || { emoji: '🌱', color: '#7EB67A' };
}

// ── Guild builder ────────────────────────────────────────────────────────

/**
 * Groups plants into guild clusters based on their guild[] companion lists.
 * Uses a simple union-find approach so plants sharing any companion
 * end up in the same cluster.
 */
function _buildGuilds(plants) {
  if (!plants.length) return [];

  // Build adjacency: plant name → Set of companions
  const adj = new Map();
  plants.forEach(p => {
    if (!adj.has(p.name)) adj.set(p.name, new Set());
    (p.guild || []).forEach(g => adj.get(p.name).add(g));
  });

  // Simple cluster by shared guild tag
  const plantNames = plants.map(p => p.name);
  const visited = new Set();
  const guilds = [];

  for (const plant of plants) {
    if (visited.has(plant.name)) continue;

    // Find all plants that share at least one guild companion with this plant
    const cluster = [plant];
    visited.add(plant.name);

    const myCompanions = adj.get(plant.name) || new Set();

    for (const other of plants) {
      if (visited.has(other.name)) continue;
      const otherCompanions = adj.get(other.name) || new Set();
      // Connected if: other is in my guild list, or I'm in their guild list
      const connected = myCompanions.has(other.name) || otherCompanions.has(plant.name)
        || [...myCompanions].some(c => otherCompanions.has(c));
      if (connected) {
        cluster.push(other);
        visited.add(other.name);
      }
    }

    guilds.push(cluster);
  }

  // Sort clusters: biggest first
  return guilds.sort((a, b) => b.length - a.length);
}

// ── HTML builders ────────────────────────────────────────────────────────

function _plantChipHTML(p, isAdded) {
  const lm = _layerMeta(p.layer);
  return `<div class="dp-chip ${isAdded ? 'dp-chip-added' : ''}" title="${p.latin || ''}">
    <span class="dp-chip-e">${p.emoji || '🌿'}</span>
    <span class="dp-chip-n">${p.name}</span>
    <span class="dp-chip-l" style="background:${lm.color}20;color:${lm.color}">${lm.emoji} ${p.layer || '?'}</span>
  </div>`;
}

function _guildBlockHTML(cluster, idx, addedPlants) {
  // Find the best "anchor" plant (highest match score, canopy/shrub preference)
  const anchor = cluster.find(p => p.matchScore === 'High') || cluster[0];

  // Determine guild name from shared companions or anchor name
  const allCompanions = new Set(cluster.flatMap(p => p.guild || []));
  const guildName = anchor.name + ' Guild';

  const layers = [...new Set(cluster.map(p => (p.layer || '').toLowerCase()))].filter(Boolean);
  const layerStr = layers.slice(0, 3).map(l => (_layerMeta(l).emoji + ' ' + l)).join(' · ');

  const chips = cluster.map(p => _plantChipHTML(p, addedPlants.has(p.name))).join('');

  // Pair interactions: find plants in cluster whose guild[] overlap with cluster members
  const pairs = [];
  for (let i = 0; i < cluster.length; i++) {
    for (let j = i + 1; j < cluster.length; j++) {
      const a = cluster[i], b = cluster[j];
      if ((a.guild || []).includes(b.name) || (b.guild || []).includes(a.name)) {
        pairs.push(`<span class="cp-pair">${a.emoji || '🌿'} ${a.name} + ${b.emoji || '🌿'} ${b.name}</span>`);
      }
    }
  }

  return `<div class="guild-block" id="gb${idx}">
    <div class="gb-head">
      <div class="gb-anchor">${anchor.emoji || '🌿'}</div>
      <div class="gb-info">
        <div class="gb-name">${guildName}</div>
        <div class="gb-layers">${layerStr || '–'}</div>
      </div>
      <div class="gb-count">${cluster.length} plants</div>
    </div>
    <div class="gb-chips">${chips}</div>
    ${pairs.length ? `<div class="gb-pairs"><div class="gp-lbl">✨ Companion pairs</div>${pairs.join('')}</div>` : ''}
  </div>`;
}

function _systemChecklistHTML(selectedOpps) {
  if (!selectedOpps.size) {
    return `<div class="dp-empty">No systems selected yet. Add them from the Map screen.</div>`;
  }

  const byPhase = { 1: [], 2: [], 3: [] };
  selectedOpps.forEach(id => {
    const m = SYSTEM_META[id];
    if (!m) return;
    byPhase[m.phase].push({ id, ...m });
  });

  const phaseNames = { 1: 'Phase 1 — Foundation', 2: 'Phase 2 — Establishment', 3: 'Phase 3 — Maturity' };

  return [1, 2, 3].filter(p => byPhase[p].length).map(p => `
    <div class="sys-phase-group">
      <div class="spg-label">${phaseNames[p]}</div>
      ${byPhase[p].map(s => `
        <div class="sys-item">
          <div class="si-ico">${s.ico}</div>
          <div class="si-body">
            <div class="si-name">${s.label}</div>
            <div class="si-detail">${s.detail}</div>
          </div>
          <div class="si-check">○</div>
        </div>`).join('')}
    </div>`).join('');
}

function _layerSummaryHTML(plants) {
  if (!plants.length) return '';

  const byLayer = {};
  plants.forEach(p => {
    const key = (p.layer || 'Unknown').toLowerCase();
    if (!byLayer[key]) byLayer[key] = [];
    byLayer[key].push(p);
  });

  const order = ['canopy', 'sub-canopy', 'shrub', 'herbaceous', 'ground cover', 'root', 'climber'];
  const rows = order.filter(l => byLayer[l]).map(l => {
    const ps = byLayer[l];
    const lm = _layerMeta(l);
    const pct = Math.round((ps.length / plants.length) * 100);
    return `<div class="layer-row">
      <div class="lr-emoji">${lm.emoji}</div>
      <div class="lr-name">${l.charAt(0).toUpperCase() + l.slice(1)}</div>
      <div class="lr-bar-wrap">
        <div class="lr-bar" style="width:${pct}%;background:${lm.color}"></div>
      </div>
      <div class="lr-count">${ps.length}</div>
    </div>`;
  });

  // Any unlisted layers
  const other = Object.entries(byLayer)
    .filter(([k]) => !order.includes(k))
    .flatMap(([, ps]) => ps);
  if (other.length) {
    const lm = { emoji: '🌱', color: '#A3B18A' };
    const pct = Math.round((other.length / plants.length) * 100);
    rows.push(`<div class="layer-row">
      <div class="lr-emoji">${lm.emoji}</div>
      <div class="lr-name">Other</div>
      <div class="lr-bar-wrap">
        <div class="lr-bar" style="width:${pct}%;background:${lm.color}"></div>
      </div>
      <div class="lr-count">${other.length}</div>
    </div>`);
  }

  return rows.join('');
}

// ── Main render ──────────────────────────────────────────────────────────

export function renderPlan() {
  const container = document.getElementById('planContent');
  if (!container) return;

  const hasData = APP.analysisRan;
  const plants  = APP.plants || [];
  const addedPlants = APP.addedPlants;
  const selectedOpps = APP.selectedOpps;
  const prop = APP.property;

  // ── Summary stats ──
  const activePlants = addedPlants.size > 0 ? [...addedPlants].length : plants.length;
  const systemCount  = selectedOpps.size;
  const guildCount   = hasData ? _buildGuilds(plants).length : '–';

  document.getElementById('dp-stat-plants')  && (document.getElementById('dp-stat-plants').textContent  = hasData ? activePlants : '–');
  document.getElementById('dp-stat-systems') && (document.getElementById('dp-stat-systems').textContent = systemCount || '–');
  document.getElementById('dp-stat-guilds')  && (document.getElementById('dp-stat-guilds').textContent  = guildCount);
  document.getElementById('dp-stat-layers')  && (document.getElementById('dp-stat-layers').textContent  = hasData ? [...new Set(plants.map(p => p.layer).filter(Boolean))].length : '–');

  // ── Browse Plants button (always visible) ──
  const zoneStr = APP.siteProfile?.hardiness?.zone
    ? `Zone ${APP.siteProfile.hardiness.zone}`
    : APP.property?.hardiness || null;
  const zoneLabel = zoneStr ? ` · ${zoneStr}` : '';

  // ── Placeholder when no analysis ──
  if (!hasData) {
    container.innerHTML = `
      <div class="dp-placeholder">
        <div class="dpp-ico">🗺️</div>
        <div class="dpp-title">Your design plan will appear here</div>
        <div class="dpp-sub">Run <strong>Analyse My Land</strong> on the Plants screen to generate your personalised guild plantings, companion pairings, and system checklist.</div>
      </div>
      <div class="pb-launch-wrap">
        <button class="pb-launch-btn" id="pb-launch-btn">
          🌿 Browse &amp; Add Plants
          <span class="pb-launch-sub">Search 80+ nursery plants rated for your site${zoneLabel}</span>
        </button>
      </div>`;
    // Still show systems checklist if any selected
    if (systemCount) {
      container.innerHTML += `<div class="sec-label" style="margin-top:4px">Selected Systems</div>
        <div style="padding:0 14px">${_systemChecklistHTML(selectedOpps)}</div>`;
    }
    _wireBrowseBtn();
    return;
  }

  // ── Full data-driven render ──
  const guilds = _buildGuilds(plants);

  container.innerHTML = `

    <!-- Browse Plants button -->
    <div class="pb-launch-wrap">
      <button class="pb-launch-btn" id="pb-launch-btn">
        🌿 Browse &amp; Add Plants
        <span class="pb-launch-sub">Search 80+ nursery plants rated for your site${zoneLabel}</span>
      </button>
    </div>

    <!-- Layer diversity bar chart -->
    <div class="sec-label">Forest Layer Diversity</div>
    <div class="layer-chart" style="padding:0 14px 6px">
      ${_layerSummaryHTML(plants)}
    </div>

    <!-- Guild planting groups -->
    <div class="sec-label" style="margin-top:4px">Guild Plantings
      <span class="sl-sub">${guilds.length} companion cluster${guilds.length !== 1 ? 's' : ''}</span>
    </div>
    <div class="guild-list" style="padding:0 14px">
      ${guilds.map((cluster, i) => _guildBlockHTML(cluster, i, addedPlants)).join('')}
    </div>

    <!-- System implementation checklist -->
    <div class="sec-label" style="margin-top:4px">System Checklist
      <span class="sl-sub">${systemCount} active</span>
    </div>
    <div style="padding:0 14px">
      ${_systemChecklistHTML(selectedOpps)}
    </div>

    <!-- Plants added to plan summary -->
    ${addedPlants.size > 0 ? `
    <div class="sec-label" style="margin-top:4px">Your Planting Plan
      <span class="sl-sub">${addedPlants.size} selected</span>
    </div>
    <div class="added-plants-wrap" style="padding:0 14px">
      <div class="added-chips">
        ${plants.filter(p => addedPlants.has(p.name)).map(p => _plantChipHTML(p, true)).join('')}
      </div>
    </div>` : ''}

    <div style="height:80px"></div>
  `;

  // Wire system checklist check toggle
  container.querySelectorAll('.sys-item').forEach(item => {
    item.addEventListener('click', () => {
      const check = item.querySelector('.si-check');
      if (check) {
        const done = item.classList.toggle('done');
        check.textContent = done ? '✓' : '○';
      }
    });
  });

  _wireBrowseBtn();
}

// ── Browse button wiring ─────────────────────────────────────────────────────
function _wireBrowseBtn() {
  const btn = document.getElementById('pb-launch-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    openBrowser(plant => {
      // When a plant is added from the browser, re-render the plan
      // so the "Your Planting Plan" section updates
      renderPlan();
    });
  });
}
