/**
 * app.js
 * Entry point. Bootstraps the setup screen and wires everything together.
 *
 * The module graph is:
 *   app.js
 *     ├── state.js        (shared mutable state)
 *     ├── nav.js          (screen transitions)
 *     ├── ui.js           (toast, drawer, helpers)
 *     ├── map.js          (Mapbox map + AI terrain placement)
 *     ├── inat.js         (iNaturalist fetch + sys-row)
 *     ├── claude.js       (Anthropic API calls)
 *     ├── plan.js         (design plan screen)
 *     ├── calendar.js     (maintenance calendar screen)
 *     └── report.js       (report screen)
 */

import { APP } from './modules/state.js';
import { navTo, showNav } from './modules/nav.js';
import { toast, roleClass, layerEmoji } from './modules/ui.js';
import { fetchINat, toggleFetchPanel, initSysRow, getSelectedSystems } from './modules/inat.js';
import { runPlantAnalysis } from './modules/claude.js';
import { wireSeasonTabs } from './modules/calendar.js';
import { renderDashboard } from './modules/dashboard.js';

// ── Setup screen ───────────────────────────────────────────────────────

// Goal pill toggles
document.querySelectorAll('.goal-pill').forEach(p =>
  p.addEventListener('click', () => p.classList.toggle('on'))
);

document.getElementById('startBtn').addEventListener('click', startApp);

function startApp() {
  APP.apiKey = document.getElementById('apiKey').value.trim();
  APP.mapboxToken = document.getElementById('mapboxToken').value.trim();
  APP.property.name = document.getElementById('propName').value.trim() || 'My Property';
  APP.property.address = document.getElementById('propAddress').value.trim();
  APP.property.size = document.getElementById('propSize').value.trim();
  APP.property.soil = document.getElementById('propSoil').value.trim();
  APP.property.water = document.getElementById('propWater').value.trim();
  APP.property.goals = Array.from(document.querySelectorAll('.goal-pill.on')).map(p => p.dataset.g);

  // Pre-populate iNaturalist coordinate fields from the property address
  // (map geocoding will update these once the map is shown)
  _syncInatCoords();

  showNav();
  navTo('s1');
}

/**
 * Pre-fill iNat lat/lng fields using a rough geocode of the property address.
 * The map module will set a more precise location after geocoding.
 */
function _syncInatCoords() {
  // We don't block on this — it's a nice-to-have prefill
  const token = APP.mapboxToken;
  const addr = APP.property.address;
  if (!token || !addr) return;

  fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(addr)}.json?access_token=${token}&limit=1`)
    .then(r => r.json())
    .then(d => {
      if (d.features?.length) {
        const [lng, lat] = d.features[0].center;
        const latEl = document.getElementById('inatLat');
        const lngEl = document.getElementById('inatLng');
        if (latEl) latEl.value = lat.toFixed(4);
        if (lngEl) lngEl.value = lng.toFixed(4);
      }
    })
    .catch(() => {}); // silent — fields have sensible defaults
}

// ── Plants screen ──────────────────────────────────────────────────────

// Fetch panel toggle
document.getElementById('fetchPanelHead').addEventListener('click', toggleFetchPanel);

// iNat fetch button
document.getElementById('fetchBtn').addEventListener('click', fetchINat);

// Result tab switching
document.querySelectorAll('.rtab[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.rtab').forEach(t => t.classList.remove('on'));
    btn.classList.add('on');
    document.querySelectorAll('.cpanel').forEach(p => p.classList.remove('on'));
    const panel = document.getElementById('cp-' + btn.dataset.tab);
    if (panel) panel.classList.add('on');
  });
});

// Analyse button
document.getElementById('abtn').addEventListener('click', runAnalysis);

async function runAnalysis() {
  if (!APP.apiKey) {
    toast('Enter your Anthropic API key in Setup first', '⚠️');
    return;
  }

  const systems = getSelectedSystems();
  if (!systems.length) {
    toast('Select at least one system', '💡');
    return;
  }

  // UI: loading state
  document.getElementById('plantsEmpty').style.display = 'none';
  document.getElementById('rtabs').style.display = 'none';
  document.querySelectorAll('.cpanel').forEach(p => p.classList.remove('on'));
  document.getElementById('errCard').classList.remove('on');
  document.getElementById('abtn').disabled = true;
  document.getElementById('loading').classList.add('on');
  _animateLoadingSteps();

  try {
    const result = await runPlantAnalysis(systems);
    APP.plants = result.plants || [];
    APP.medicinals = result.nativeMedicinals || [];
    APP.wildlife = result.wildlife || {};
    APP.analysisRan = true;
    _renderPlantResults();
    _updatePlantsNavBadge();
    renderDashboard(); // update gauges with fresh data
  } catch (e) {
    _showError(e.message);
  } finally {
    document.getElementById('loading').classList.remove('on');
    document.getElementById('abtn').disabled = false;
  }
}

function _animateLoadingSteps() {
  const ids = ['ls1', 'ls2', 'ls3', 'ls4', 'ls5'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.className = 'lstep';
  });
  ids.forEach((id, i) => setTimeout(() => {
    if (i > 0) {
      const prev = document.getElementById(ids[i - 1]);
      if (prev) { prev.classList.remove('on'); prev.classList.add('done'); }
    }
    const el = document.getElementById(id);
    if (el) el.classList.add('on');
  }, i * 1000));
}

function _renderPlantResults() {
  // Show tabs and counts
  document.getElementById('rtabs').style.display = 'flex';

  const rtnPlants = document.getElementById('rtn-plants');
  const rtnMeds = document.getElementById('rtn-meds');
  const rtnWild = document.getElementById('rtn-wild');

  if (rtnPlants) { rtnPlants.textContent = APP.plants.length; rtnPlants.classList.add('on'); }
  if (rtnMeds) { rtnMeds.textContent = APP.medicinals.length; rtnMeds.classList.add('on'); }
  const wc = (APP.wildlife.pollinators?.length || 0)
    + (APP.wildlife.pestPredators?.length || 0)
    + (APP.wildlife.browsingAnimals?.length || 0);
  if (rtnWild) { rtnWild.textContent = wc; rtnWild.classList.add('on'); }

  // Filter bar
  const layers = [...new Set(APP.plants.map(p => p.layer))];
  document.getElementById('plantFbar').innerHTML =
    `<div class="ftab on" data-filter="all">All</div>` +
    layers.map(l => `<div class="ftab" data-filter="layer:${l}">${layerEmoji(l)} ${l}</div>`).join('') +
    `<div class="ftab" data-filter="score:High">⭐ Best</div>` +
    `<div class="ftab" data-filter="avail:Common">🛒 In stores</div>`;

  // Wire filter bar
  document.querySelectorAll('#plantFbar .ftab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#plantFbar .ftab').forEach(t => t.classList.remove('on'));
      tab.classList.add('on');
      _applyPlantFilter(tab.dataset.filter);
    });
  });

  _renderPlantList(APP.plants);

  // Medicinals
  const medSubtitle = document.getElementById('medSubtitle');
  if (medSubtitle) medSubtitle.textContent = `${APP.medicinals.length} species from local observations`;
  const medList = document.getElementById('medList');
  if (medList) {
    medList.innerHTML = APP.medicinals.map((m, i) => `
      <div class="medcard" style="animation-delay:${(i * .07).toFixed(2)}s">
        <div class="mc-n">${m.name}</div>
        <div class="mc-l">${m.latin}</div>
        <div class="mc-o">📍 ${m.observationNote}</div>
        <div class="mc-u">${m.medicinalUses}</div>
        <div class="mc-c">🌱 ${m.cultivationNote}</div>
        ${m.caution ? `<div class="mc-w">⚠️ ${m.caution}</div>` : ''}
      </div>`).join('');
  }

  // Wildlife
  const w = APP.wildlife;
  const wildSubtitle = document.getElementById('wildSubtitle');
  if (wildSubtitle) {
    wildSubtitle.textContent = APP.inatAnimals.length
      ? `Based on ${APP.inatAnimals.length} local iNaturalist observations`
      : `Based on regional knowledge for ${APP.property.address}`;
  }
  const wildList = document.getElementById('wildList');
  if (wildList) {
    wildList.innerHTML = `
      <div class="eco-card">
        <div class="eco-t">Ecological character</div>
        <div class="eco-tx">${w.ecologicalSummary || ''}</div>
      </div>
      <div class="w-sub"><div class="ws-ico">🐝</div><div class="ws-ttl">Pollinators</div><div class="ws-cnt">${(w.pollinators || []).length} species</div></div>
      ${(w.pollinators || []).map((a, i) => _animalHTML(a, 'poll', i)).join('')}
      <div class="w-sub"><div class="ws-ico">🦅</div><div class="ws-ttl">Pest Predators</div><div class="ws-cnt">${(w.pestPredators || []).length} species</div></div>
      ${(w.pestPredators || []).map((a, i) => _animalHTML(a, 'pred', i)).join('')}
      <div class="w-sub"><div class="ws-ico">🦘</div><div class="ws-ttl">Browsing Pressure</div><div class="ws-cnt">${(w.browsingAnimals || []).length} species</div></div>
      ${(w.browsingAnimals || []).map((a, i) => _animalHTML(a, 'browse', i)).join('')}`;
  }

  // Switch to plants tab
  document.querySelectorAll('.cpanel').forEach(p => p.classList.remove('on'));
  document.getElementById('cp-plants').classList.add('on');
  document.querySelectorAll('.rtab').forEach(t => t.classList.remove('on'));
  document.querySelector('.rtab').classList.add('on');
}

function _applyPlantFilter(filter) {
  if (filter === 'all') return _renderPlantList(APP.plants);
  if (filter === 'score:High') return _renderPlantList(APP.plants.filter(p => p.matchScore === 'High'));
  if (filter === 'avail:Common') return _renderPlantList(APP.plants.filter(p => p.availabilityLevel === 'Common'));
  if (filter.startsWith('layer:')) {
    const layer = filter.slice(6);
    return _renderPlantList(APP.plants.filter(p => p.layer === layer));
  }
  _renderPlantList(APP.plants);
}

function _renderPlantList(list) {
  const container = document.getElementById('plantList');
  if (!container) return;
  container.innerHTML = list.length
    ? list.map((p, i) => _plantHTML(p, i)).join('')
    : `<div class="empty-state"><div class="es-icon">🔍</div><div class="es-title">No plants in this filter</div></div>`;

  // Wire accordion and add-to-plan buttons
  container.querySelectorAll('.pcard').forEach((card, i) => {
    card.querySelector('.phead').addEventListener('click', () => card.classList.toggle('open'));
    const addBtn = card.querySelector('.padd');
    if (addBtn) {
      addBtn.addEventListener('click', e => {
        e.stopPropagation();
        _togglePlantAdd(list[i].name, addBtn);
      });
    }
  });
}

function _plantHTML(p, i) {
  const roles = (p.roles || []).map(r => `<span class="tag ${roleClass(r)}">${r}</span>`).join('');
  const attrs = [
    ['Layer', p.layer], ['Height', p.height || '–'], ['Root', p.rootDepth || '–'],
    ['Yield', p.yield || 'N/A'], ['Maintenance', p.maintenanceLevel || '–'],
    ['Systems', (p.systemFit || []).join(', ') || '–'],
  ].map(([l, v]) => `<div class="pa"><div class="pa-l">${l}</div><div class="pa-v">${v}</div></div>`).join('');

  const guild = (p.guild || []).map(g => `<span class="gchip">${g}</span>`).join('');
  const isAdded = APP.addedPlants.has(p.name);

  return `<div class="pcard" style="animation-delay:${(i * .05).toFixed(2)}s">
    <div class="phead">
      <div class="pemoji">${p.emoji || '🌿'}</div>
      <div class="pinfo">
        <div class="pname">${p.name}</div>
        <div class="platin">${p.latin}</div>
        <div class="proles">${roles}</div>
      </div>
      <div class="pmeta">
        <span class="pmatch ${p.matchScore === 'High' ? 'pm-h' : 'pm-m'}">${p.matchScore}</span>
        <span class="pavail ${p.availabilityLevel === 'Common' ? 'pa-c' : 'pa-s'}">${p.availabilityLevel === 'Common' ? '🛒 In stores' : '🌱 Specialist'}</span>
        <span class="pchev">›</span>
      </div>
    </div>
    <div class="pbody">
      <div class="rblock rb-g">${p.whyThisProperty || 'Suited to your conditions.'}</div>
      ${p.wildlifeValue ? `<div class="rblock rb-t">${p.wildlifeValue}</div>` : ''}
      ${p.availability ? `<div class="rblock rb-b">${p.availability}</div>` : ''}
      ${p.medicinalUse ? `<div class="rblock rb-p">${p.medicinalUse}</div>` : ''}
      <div class="pattrs">${attrs}</div>
      ${guild ? `<div class="guild-wrap"><div class="gl-lbl">Guild companions</div><div class="gchips">${guild}</div></div>` : ''}
      <button class="padd ${isAdded ? 'done' : ''}">${isAdded ? '✓ Added to planting plan' : '+ Add to planting plan'}</button>
    </div>
  </div>`;
}

function _togglePlantAdd(name, btn) {
  if (APP.addedPlants.has(name)) {
    APP.addedPlants.delete(name);
    btn.textContent = '+ Add to planting plan';
    btn.classList.remove('done');
    toast('Removed', '↩️');
  } else {
    APP.addedPlants.add(name);
    btn.textContent = '✓ Added to planting plan';
    btn.classList.add('done');
    toast(`${name} added`, '🌿');
  }
  _updatePlantsNavBadge();
}

function _updatePlantsNavBadge() {
  const n = APP.addedPlants.size;
  const nb = document.getElementById('nb-plants');
  if (nb) { nb.textContent = n; nb.classList.toggle('on', n > 0); }
}

function _animalHTML(a, type, i) {
  const obsClass = { High: 'obs-h', Medium: 'obs-m', Low: 'obs-l' }[a.observationLevel] || 'obs-l';
  const obsLabel = { High: 'Frequently observed', Medium: 'Occasionally observed', Low: 'Rarely observed' }[a.observationLevel] || '';
  return `<div class="acard ${type}" style="animation-delay:${(i * .06).toFixed(2)}s">
    <div class="ac-hd">
      <div class="ac-em">${a.emoji || '🐾'}</div>
      <div><div class="ac-nm">${a.name}</div><div class="ac-lt">${a.latin}</div></div>
      <div class="ac-obs ${obsClass}">${obsLabel}</div>
    </div>
    <div class="ac-role">${a.role}</div>
    <div class="ac-dr ${type}">${a.designResponse}</div>
  </div>`;
}

function _showError(msg) {
  const c = document.getElementById('errCard');
  if (!c) return;
  const isKeyError = msg.toLowerCase().includes('401') || msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('api key') || msg.toLowerCase().includes('authentication');
  const hint = isKeyError
    ? 'Check your Anthropic API key is valid and has credits.'
    : 'This is usually a temporary issue — hit Analyse again to retry.';
  c.innerHTML = `<strong>⚠️ Something went wrong</strong><br><br>${msg}<br><br>${hint}`;
  c.classList.add('on');
  document.getElementById('plantsEmpty').style.display = 'none';
}

// ── Calendar ────────────────────────────────────────────────────────────
wireSeasonTabs();

// ── Dashboard ────────────────────────────────────────────────────────────
// Render once on load (pre-analysis placeholder state) and again after analysis
renderDashboard();

// Dashboard re-renders on nav via nav.js
