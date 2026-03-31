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
import { runIngestion } from './modules/ingest.js';
import { invalidateReportCache } from './modules/report.js';
import { saveState, loadState, clearState, hasSavedState, getSavedScreen, getSavedAt } from './modules/persist.js';
import { initTour } from './modules/tour.js';

// ── Share link receiver ────────────────────────────────────────────────
//
// Detects ?share= in the URL, decodes the base64 snapshot written by
// report.js _exportShareLink(), populates APP state, and launches
// straight into the Report screen in read-only "shared view" mode.

(function _bootShareReceiver() {
  const params = new URLSearchParams(location.search);
  const b64 = params.get('share');
  if (!b64) return;

  try {
    const json = decodeURIComponent(escape(atob(b64)));
    const snap = JSON.parse(json);
    if (!snap || snap.v !== 1) return; // unknown schema version

    // Populate APP state from the snapshot
    if (snap.property)      Object.assign(APP.property, snap.property);
    if (snap.selectedOpps)  APP.selectedOpps = new Set(snap.selectedOpps);
    if (snap.addedPlants)   APP.addedPlants  = new Set(snap.addedPlants);
    if (snap.siteProfile)   APP.siteProfile  = snap.siteProfile;
    if (snap.plants)        APP.plants       = snap.plants;
    if (snap.medicinals)    APP.medicinals   = snap.medicinals;
    if (snap.scores?.plants != null) APP.analysisRan = true;

    // Restore API key from any existing saved session (user needs theirs to regenerate narrative)
    try {
      const saved = JSON.parse(localStorage.getItem('verdant_v1') || 'null');
      if (saved?.apiKey) APP.apiKey = saved.apiKey;
    } catch { /* silent */ }

    // Show the shared design immediately — skip setup screen
    const s0 = document.getElementById('s0');
    if (s0) s0.classList.remove('active');

    showNav();

    // Show a "Viewing shared design" banner
    _showSharedBanner(snap);

    // Navigate to Report screen so the recipient sees the full design
    navTo('s5');

    // Also render dashboard with the snapshot data
    renderDashboard();

    // Strip the ?share= param from the URL so refreshing doesn't re-apply
    const cleanUrl = location.pathname;
    history.replaceState(null, '', cleanUrl);

  } catch (e) {
    // Malformed share link — fall through to normal boot
    console.warn('[Verdant] Could not decode share link:', e);
  }
})();

function _showSharedBanner(snap) {
  const container = document.getElementById('s5');
  if (!container) return;

  const name   = snap.property?.name || 'Shared Property';
  const date   = snap.ts ? new Date(snap.ts).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const banner = document.createElement('div');
  banner.className = 'shared-view-banner';
  banner.id = 'sharedViewBanner';
  banner.innerHTML = `
    <div class="svb-ico">🔗</div>
    <div class="svb-body">
      <div class="svb-title">Viewing shared design</div>
      <div class="svb-sub">${name}${date ? ' · Shared ' + date : ''}</div>
    </div>
    <button class="svb-close" id="svbClose" title="Dismiss">✕</button>`;

  // Insert at top of report screen body
  const body = container.querySelector('.screen-body');
  if (body) body.insertBefore(banner, body.firstChild);

  document.getElementById('svbClose')?.addEventListener('click', () => banner.remove());
}

// ── Session restore ────────────────────────────────────────────────────

/**
 * On boot, check for a saved session. If one exists, show a "Resume" banner
 * on the setup screen instead of requiring the user to re-enter everything.
 */
(function _bootRestore() {
  if (!hasSavedState()) return;

  const savedAt = getSavedAt();
  const when = savedAt
    ? _relativeTime(savedAt)
    : 'a previous session';

  // Inject the resume banner into the setup screen
  const setupInner = document.querySelector('.setup-inner');
  if (!setupInner) return;

  const banner = document.createElement('div');
  banner.className = 'resume-banner';
  banner.id = 'resumeBanner';
  banner.innerHTML = `
    <div class="rb-icon">🌿</div>
    <div class="rb-body">
      <div class="rb-title">Resume your session</div>
      <div class="rb-sub">Saved ${when} · ${_savedPropertyName()}</div>
    </div>
    <button class="rb-btn" id="resumeBtn">Resume →</button>
    <button class="rb-clear" id="clearBtn" title="Start fresh">✕</button>
  `;
  // Insert at the top of setup-inner, above the emblem
  setupInner.insertBefore(banner, setupInner.firstChild);

  document.getElementById('resumeBtn').addEventListener('click', _resumeSession);
  document.getElementById('clearBtn').addEventListener('click', _discardSession);
})();

function _savedPropertyName() {
  try {
    const raw = localStorage.getItem('verdant_v1');
    const d = raw ? JSON.parse(raw) : null;
    return d?.property?.name || 'Your Property';
  } catch { return 'Your Property'; }
}

function _relativeTime(ms) {
  const diff = Date.now() - ms;
  const mins = Math.round(diff / 60000);
  if (mins < 2)  return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24)  return `${hrs} hour${hrs !== 1 ? 's' : ''} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

/**
 * Load persisted state and skip the setup screen entirely,
 * navigating straight to the screen the user was last on.
 */
function _resumeSession() {
  const ok = loadState();
  if (!ok) {
    toast('Could not restore session', '⚠️');
    return;
  }
  showNav();
  initTour(); // tour state already has seen screens from previous session
  const screen = getSavedScreen();
  // Activate s0 → next screen transition correctly
  const s0 = document.getElementById('s0');
  if (s0) s0.classList.remove('active');
  navTo(screen);

  // If analysis ran, re-render results panels
  if (APP.analysisRan) {
    _renderPlantResults();
    _updatePlantsNavBadge();
    renderDashboard();
  }

  // If we had ingestion data, re-render dashboard
  if (APP.siteProfile) {
    renderDashboard();
    _setDashSub('✅ Site data loaded — ' + (APP.siteProfile.climate || 'see Overview'));
  }

  toast('Session restored', '🌿');
}

/**
 * Discard the saved session and let the user start fresh.
 */
function _discardSession() {
  clearState();
  const banner = document.getElementById('resumeBanner');
  if (banner) banner.remove();
}

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

  // Persist the initial property profile immediately
  saveState();

  showNav();
  initTour(); // start first-run tooltip tour
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

  // If no Mapbox token, try geocoding via Nominatim (free, no key needed)
  const geocodeUrl = token
    ? `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(addr)}.json?access_token=${token}&limit=1`
    : `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addr)}&format=json&limit=1`;

  if (!addr) return;

  fetch(geocodeUrl, token ? {} : { headers: { 'Accept-Language': 'en' } })
    .then(r => r.json())
    .then(d => {
      let lat, lng;
      if (token && d.features?.length) {
        [lng, lat] = d.features[0].center;
      } else if (!token && d.length) {
        lat = parseFloat(d[0].lat);
        lng = parseFloat(d[0].lon);
      }
      if (lat == null || lng == null) return;

      // Prefill iNat coordinate fields
      const latEl = document.getElementById('inatLat');
      const lngEl = document.getElementById('inatLng');
      if (latEl) latEl.value = lat.toFixed(4);
      if (lngEl) lngEl.value = lng.toFixed(4);

      // Kick off the property ingestion pipeline in the background
      _startIngestion(lat, lng);
    })
    .catch(() => {}); // silent — fields have sensible defaults
}

/**
 * Run the Stage 1 ingestion pipeline and refresh the dashboard when done.
 */
async function _startIngestion(lat, lng) {
  try {
    _setDashSub('⏳ Fetching climate & soil data…');
    await runIngestion(lat, lng);
    _setDashSub('✅ Site data loaded — ' + (APP.siteProfile?.climate || 'see Overview'));
    saveState(); // persist enriched siteProfile
    renderDashboard(); // refresh with real data
  } catch (e) {
    _setDashSub('Your property at a glance');
    // Silent fail — dashboard still works with user-entered data
  }
}

function _setDashSub(text) {
  const el = document.getElementById('dashSub');
  if (el) el.textContent = text;
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
    invalidateReportCache(); // force narrative to regenerate
    saveState();             // persist analysis results
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
  const wc = (APP.wildlife?.pollinators?.length || 0)
    + (APP.wildlife?.pestPredators?.length || 0)
    + (APP.wildlife?.browsingAnimals?.length || 0);
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
    medList.innerHTML = APP.medicinals.length
      ? APP.medicinals.map((m, i) => `
          <div class="medcard" style="animation-delay:${(i * .07).toFixed(2)}s">
            <div class="mc-n">${m.name}</div>
            <div class="mc-l">${m.latin}</div>
            <div class="mc-o">📍 ${m.observationNote}</div>
            <div class="mc-u">${m.medicinalUses}</div>
            <div class="mc-c">🌱 ${m.cultivationNote}</div>
            ${m.caution ? `<div class="mc-w">⚠️ ${m.caution}</div>` : ''}
          </div>`).join('')
      : `<div class="empty-state" style="padding:30px 0">
           <div class="es-icon">🌿</div>
           <div class="es-title">No medicinals found</div>
           <div class="es-sub">Add iNaturalist data or rerun analysis to surface medicinal plants for your region.</div>
         </div>`;
  }

  // Wildlife
  const w = APP.wildlife || {};
  const wildSubtitle = document.getElementById('wildSubtitle');
  if (wildSubtitle) {
    wildSubtitle.textContent = APP.inatAnimals?.length
      ? `Based on ${APP.inatAnimals.length} local iNaturalist observations`
      : `Based on regional knowledge for ${APP.property.address}`;
  }
  const wildList = document.getElementById('wildList');
  if (wildList) {
    wildList.innerHTML = `
      <div class="eco-card">
        <div class="eco-t">Ecological character</div>
        <div class="eco-tx">${w.ecologicalSummary || 'Run analysis to generate wildlife insights for this property.'}</div>
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
  saveState(); // persist plant selection change
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
