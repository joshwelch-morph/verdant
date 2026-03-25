/**
 * inat.js
 * iNaturalist API integration and the Plants screen's system-selector row.
 *
 * Fetches research-grade plant and animal observations within 15km of a
 * given coordinate, deduplicates to unique species, and stores results
 * in APP.inatPlants / APP.inatAnimals.
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
    const base = `https://api.inaturalist.org/v1/observations?lat=${lat}&lng=${lng}&radius=15&quality_grade=research&per_page=50&order_by=votes`;
    const [pr, ar] = await Promise.all([
      fetch(base + '&taxon_name=Plantae&native=true'),
      fetch(base + '&taxon_name=Animalia'),
    ]);
    const [pd, ad] = await Promise.all([pr.json(), ar.json()]);

    APP.inatPlants = _uniqueSpecies(pd.results || []);
    APP.inatAnimals = _uniqueSpecies(ad.results || []);

    _setBadge('fb-plants', APP.inatPlants.length + ' species', 'fb-ready');
    _setBadge('fb-animals', APP.inatAnimals.length + ' species', 'fb-ready');
    _updateFetchStatus();
    _renderFetchSummary();

    toast(`${APP.inatPlants.length} plants + ${APP.inatAnimals.length} animals found`, '🔬');
  } catch (e) {
    _setBadge('fb-plants', 'Failed', 'fb-off');
    _setBadge('fb-animals', 'Failed', 'fb-off');
    toast('iNaturalist fetch failed', '⚠️');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Fetch →';
  }
}

function _uniqueSpecies(results) {
  return [...new Map(
    results
      .filter(o => o.taxon?.name && o.taxon?.preferred_common_name)
      .map(o => [o.taxon.name, {
        name: o.taxon.name,
        common: o.taxon.preferred_common_name,
        iconicGroup: o.taxon.iconic_taxon_name,
      }])
  ).values()];
}

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

function _renderFetchSummary() {
  const div = document.getElementById('fetchSummary');
  if (!div) return;
  div.style.display = 'block';
  div.innerHTML = `
    <div style="font-weight:700;color:var(--green-lt);margin-bottom:3px">🌿 ${APP.inatPlants.length} native plants</div>
    <div class="obs-pills">${APP.inatPlants.slice(0, 10).map(s => `<span class="op">${s.common}</span>`).join('')}</div>
    <div style="font-weight:700;color:var(--blue-lt);margin-top:7px;margin-bottom:3px">🦋 ${APP.inatAnimals.length} animal species</div>
    <div class="obs-pills">${APP.inatAnimals.slice(0, 10).map(s => `<span class="op op-a">${s.common}</span>`).join('')}</div>`;
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
