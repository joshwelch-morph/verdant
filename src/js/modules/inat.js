/**
 * inat.js
 * iNaturalist API integration and the Plants screen's system-selector row.
 *
 * Fetches research-grade plant and animal observations within 15km of a
 * given coordinate, deduplicates to unique species, and stores results
 * in APP.inatPlants / APP.inatAnimals.
 *
 * Upgrade (S2 Wildlife improvements):
 *   - Species cards now include thumbnail photos from the iNat API
 *   - Animals grouped by taxon (Birds, Insects, Mammals, Reptiles, etc.)
 *   - Each species links out to iNaturalist for the full observation list
 *   - Observation count shown per species
 *   - Taxon group badges with counts shown in summary header
 */

import { APP } from './state.js';
import { toast } from './ui.js';

// ── iNaturalist fetch ─────────────────────────────────────────────────

export async function fetchINat() {
  const lat = parseFloat(document.getElementById('inatLat').value);
  const lng = parseFloat(document.getElementById('inatLng').value);

  if (isNaN(lat) || isNaN(lng)) {
    toast('Enter valid coordinates', '⚠️');
    return;
  }

  const btn = document.getElementById('fetchBtn');
  btn.disabled = true;
  btn.textContent = '…';

  ['fb-plants', 'fb-animals'].forEach(id => {
    const el = document.getElementById(id);
    el.className = 'fbadge fb-load';
    el.textContent = 'Fetching…';
  });

  try {
    // Fetch more results (100) and include photos + obs counts
    const base = `https://api.inaturalist.org/v1/observations?lat=${lat}&lng=${lng}&radius=15&quality_grade=research&per_page=100&order_by=votes&include_new_projects=false`;
    const [pr, ar] = await Promise.all([
      fetch(base + '&taxon_name=Plantae&native=true'),
      fetch(base + '&taxon_name=Animalia'),
    ]);
    const [pd, ad] = await Promise.all([pr.json(), ar.json()]);

    APP.inatPlants  = _uniqueSpecies(pd.results || []);
    APP.inatAnimals = _uniqueSpecies(ad.results || []);

    _setBadge('fb-plants',  APP.inatPlants.length  + ' species', 'fb-ready');
    _setBadge('fb-animals', APP.inatAnimals.length + ' species', 'fb-ready');
    _updateFetchStatus();
    _renderFetchSummary();

    toast(`${APP.inatPlants.length} plants + ${APP.inatAnimals.length} animals found`, '🔬');

    // Persist the new iNat observations
    import('./persist.js').then(m => m.saveState());
  } catch (e) {
    _setBadge('fb-plants',  'Failed', 'fb-off');
    _setBadge('fb-animals', 'Failed', 'fb-off');
    toast('iNaturalist fetch failed', '⚠️');
    console.error('[Verdant] iNat fetch error:', e);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Fetch →';
  }
}

// ── Deduplicate + enrich species ──────────────────────────────────────
// Stores photo URL, obs count, and iNat URL alongside common/scientific name.

function _uniqueSpecies(results) {
  // Group by taxon.name to count observations per species
  const countMap = new Map();
  results.forEach(o => {
    if (!o.taxon?.name || !o.taxon?.preferred_common_name) return;
    const key = o.taxon.name;
    const existing = countMap.get(key);
    if (!existing) {
      countMap.set(key, {
        name:         o.taxon.name,
        common:       o.taxon.preferred_common_name,
        iconicGroup:  o.taxon.iconic_taxon_name || 'Unknown',
        // Best photo: try taxon default first, then observation photo
        photoUrl:     o.taxon.default_photo?.square_url
                   || o.photos?.[0]?.url?.replace('medium', 'square')
                   || null,
        inatUrl:      `https://www.inaturalist.org/taxa/${o.taxon.id}`,
        obsCount:     1,
      });
    } else {
      existing.obsCount += 1;
      // Prefer photo with a square thumbnail if we don't have one yet
      if (!existing.photoUrl) {
        existing.photoUrl = o.taxon.default_photo?.square_url
                         || o.photos?.[0]?.url?.replace('medium', 'square')
                         || null;
      }
    }
  });
  // Sort: most-observed first
  return [...countMap.values()].sort((a, b) => b.obsCount - a.obsCount);
}

// ── Badge & status helpers ────────────────────────────────────────────

function _setBadge(id, text, cls) {
  const el = document.getElementById(id);
  if (el) { el.className = 'fbadge ' + cls; el.textContent = text; }
}

function _updateFetchStatus() {
  const total = APP.inatPlants.length + APP.inatAnimals.length;
  const el = document.getElementById('fpStatus');
  if (el) {
    el.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;background:var(--green-lt);display:inline-block;box-shadow:0 0 5px rgba(120,212,54,.5)"></span> ${total} observations`;
  }
}

// ── Taxon group metadata ──────────────────────────────────────────────

const TAXON_GROUPS = {
  Aves:       { emoji: '🐦', label: 'Birds' },
  Insecta:    { emoji: '🦋', label: 'Insects' },
  Mammalia:   { emoji: '🦡', label: 'Mammals' },
  Reptilia:   { emoji: '🦎', label: 'Reptiles' },
  Amphibia:   { emoji: '🐸', label: 'Amphibians' },
  Arachnida:  { emoji: '🕷️', label: 'Spiders & Mites' },
  Actinopterygii: { emoji: '🐟', label: 'Fish' },
  Mollusca:   { emoji: '🐌', label: 'Molluscs' },
  Fungi:      { emoji: '🍄', label: 'Fungi' },
  Plantae:    { emoji: '🌿', label: 'Plants' },
  Unknown:    { emoji: '🦗', label: 'Other invertebrates' },
};

function _groupMeta(iconicTaxon) {
  return TAXON_GROUPS[iconicTaxon] || { emoji: '🐾', label: iconicTaxon || 'Other' };
}

// ── Render fetch summary ──────────────────────────────────────────────

function _renderFetchSummary() {
  const div = document.getElementById('fetchSummary');
  if (!div) return;
  div.style.display = 'block';

  // ── Plants section ──
  const plantCards = APP.inatPlants.slice(0, 12).map(s => _speciesCard(s, 'plant')).join('');

  // ── Animals: group by taxon, show top 3 per group ──
  const animalGroups = new Map();
  APP.inatAnimals.forEach(s => {
    const grp = s.iconicGroup || 'Unknown';
    if (!animalGroups.has(grp)) animalGroups.set(grp, []);
    animalGroups.get(grp).push(s);
  });

  // Sort groups by count descending
  const sortedGroups = [...animalGroups.entries()]
    .sort((a, b) => b[1].length - a[1].length);

  // Group badges header
  const groupBadges = sortedGroups.map(([grp, spp]) => {
    const m = _groupMeta(grp);
    return `<span class="inat-grp-badge">${m.emoji} ${m.label} <strong>${spp.length}</strong></span>`;
  }).join('');

  // Cards: up to 3 per group, max 4 groups shown
  const animalCards = sortedGroups.slice(0, 5).map(([grp, spp]) => {
    const m = _groupMeta(grp);
    const cards = spp.slice(0, 4).map(s => _speciesCard(s, 'animal')).join('');
    return `
      <div class="inat-grp-header">
        <span class="inat-grp-ico">${m.emoji}</span>
        <span class="inat-grp-name">${m.label}</span>
        <span class="inat-grp-count">${spp.length} species</span>
      </div>
      <div class="inat-card-row">${cards}</div>`;
  }).join('');

  div.innerHTML = `
    <div class="inat-section-header">
      <span class="ish-ico">🌿</span>
      <span class="ish-title">${APP.inatPlants.length} native plants observed nearby</span>
      <a class="ish-link" href="https://www.inaturalist.org/observations?taxon_name=Plantae&lat=${_getCoord('inatLat')}&lng=${_getCoord('inatLng')}&radius=15" target="_blank" rel="noopener">View all ›</a>
    </div>
    <div class="inat-card-row">${plantCards}</div>

    <div class="inat-section-header" style="margin-top:12px">
      <span class="ish-ico">🦋</span>
      <span class="ish-title">${APP.inatAnimals.length} animal species observed nearby</span>
      <a class="ish-link" href="https://www.inaturalist.org/observations?taxon_name=Animalia&lat=${_getCoord('inatLat')}&lng=${_getCoord('inatLng')}&radius=15" target="_blank" rel="noopener">View all ›</a>
    </div>
    <div class="inat-grp-badges">${groupBadges}</div>
    ${animalCards}
  `;
}

function _speciesCard(s, type) {
  const initials = (s.common || s.name).slice(0, 2).toUpperCase();
  const imgHtml = s.photoUrl
    ? `<img class="inat-thumb" src="${s.photoUrl}" alt="${s.common}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
    : '';
  const fallback = `<div class="inat-thumb-fallback" ${s.photoUrl ? 'style="display:none"' : ''}>${initials}</div>`;
  const obsLabel = s.obsCount > 1 ? `<span class="inat-obs-count">${s.obsCount}</span>` : '';
  return `
    <a class="inat-card ${type === 'animal' ? 'inat-card-a' : ''}" href="${s.inatUrl}" target="_blank" rel="noopener" title="${s.name}">
      <div class="inat-card-photo">${imgHtml}${fallback}</div>
      ${obsLabel}
      <div class="inat-card-name">${s.common}</div>
      <div class="inat-card-sci">${s.name}</div>
    </a>`;
}

function _getCoord(id) {
  const el = document.getElementById(id);
  return el ? parseFloat(el.value) || 0 : 0;
}

// ── Fetch panel toggle ─────────────────────────────────────────────────

export function toggleFetchPanel() {
  const panel = document.getElementById('fetchPanel');
  if (!panel) return;
  panel.classList.toggle('open');
  const chev = document.getElementById('fpChev');
  if (chev) chev.style.transform = panel.classList.contains('open') ? 'rotate(90deg)' : '';
}

// ── Systems row ───────────────────────────────────────────────────────
// Builds the row of toggleable "system" chips on the Plants screen,
// seeded from whatever opportunities the user selected on the map.

const SYS_MAP = {
  swales: '💧 Contour Swales',
  pond: '🌊 Retention Pond',
  forest: '🌳 Food Forest',
  food_forest: '🌳 Food Forest',
  garden: '🥬 Kitchen Garden',
  kitchen_garden: '🥬 Kitchen Garden',
  solar: '☀️ Solar Zone',
  solar_zone: '☀️ Solar Zone',
  soil: '🪱 Soil Rehab',
  soil_rehab: '🪱 Soil Rehab',
};

// Always-present default systems
const DEFAULT_SYSTEMS = ['🌿 Native Medicinals', '☀️ Solar Zone', '🪱 Soil Rehab'];

export function initSysRow() {
  const row = document.getElementById('sysRow');
  if (!row) return;

  const systems = new Set([
    ...[...APP.selectedOpps].map(k => SYS_MAP[k]).filter(Boolean),
    ...DEFAULT_SYSTEMS,
  ]);

  row.innerHTML = [...systems]
    .map(s => `<div class="sp on" data-sys="${s}">${s}</div>`)
    .join('');

  // Wire toggles
  row.querySelectorAll('.sp').forEach(chip => {
    chip.addEventListener('click', () => chip.classList.toggle('on'));
  });
}

/**
 * Returns the list of currently-enabled system names from the sysRow.
 */
export function getSelectedSystems() {
  return Array.from(document.querySelectorAll('#sysRow .sp.on')).map(p => p.dataset.sys);
}

/**
 * Re-render the fetch summary from persisted data (called on nav to S2
 * when iNat data was fetched in a previous session).
 */
export function restoreInatSummary() {
  if (APP.inatPlants?.length || APP.inatAnimals?.length) {
    _setBadge('fb-plants',  (APP.inatPlants?.length  || 0) + ' species', 'fb-ready');
    _setBadge('fb-animals', (APP.inatAnimals?.length || 0) + ' species', 'fb-ready');
    _updateFetchStatus();
    _renderFetchSummary();
  }
}
