/**
 * map.js
 * Mapbox satellite map with real 3D terrain, contour lines, AI-driven
 * design-opportunity pin placement, boundary drawing, and layer controls.
 *
 * Public API:
 *   initMap()        — call once when the map screen is first shown
 *   getAiOpps()      — returns the current AI-placed opportunities object
 */

import { APP } from './state.js';
import { toast, openDrawer, updateDrawerAddBtn, closeDrawer, getCurrentDrawerOppId } from './ui.js';
import { runAIPlacement } from './claude.js';

// ── Module state ────────────────────────────────────────────────────────
let mapInitDone = false;
let verdantMap = null;

// Draw-mode state
let mapDrawMode = false;
let mapDrawCoords = [];
let mapDrawMarkers = [];

// Placed pin markers keyed by opportunity id
let mapPinMarkers = {};

// AI-placed opportunities keyed by id
let aiOpps = {};

// ── Public accessors ─────────────────────────────────────────────────────
export function getAiOpps() { return aiOpps; }
export function getMap() { return verdantMap; }

// ── Init ─────────────────────────────────────────────────────────────────

export function initMap() {
  if (mapInitDone) return;
  mapInitDone = true;

  const token = APP.mapboxToken;
  if (!token) {
    toast('Enter your Mapbox token on the setup screen', '⚠️');
    return;
  }

  mapboxgl.accessToken = token;
  verdantMap = new mapboxgl.Map({
    container: 'verdantMap',
    style: 'mapbox://styles/mapbox/satellite-streets-v12',
    zoom: 17,
    pitch: 45,
    bearing: -20,
    center: [144.9631, -37.3522], // default; replaced by geocode
  });

  verdantMap.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right');

  verdantMap.on('load', () => {
    _add3DTerrain();
    _addSkyLayer();
    _addContourLayers();
    _addBoundaryLayer();
    _addZoneLayers();

    // Geocode property address → fly there → sample terrain + run AI
    const addr = APP.property.address || 'Daylesford, Victoria, Australia';
    _geocodeAddress(addr, token);

    verdantMap.on('click', _onMapClick);
    verdantMap.on('rotate', _updateCompassHUD);
    _updateCompassHUD();
  });

  // Show layer switcher once map is ready
  const switcher = document.getElementById('mapLayerSwitcher');
  if (switcher) switcher.style.display = 'flex';

  // Wire up controls
  _wireControls();
}

// ── Terrain & layers ───────────────────────────────────────────────────

function _add3DTerrain() {
  verdantMap.addSource('mapbox-dem', {
    type: 'raster-dem',
    url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
    tileSize: 512,
  });
  verdantMap.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });
}

function _addSkyLayer() {
  verdantMap.addLayer({
    id: 'sky',
    type: 'sky',
    paint: {
      'sky-type': 'atmosphere',
      'sky-atmosphere-sun': [0, 90],
      'sky-atmosphere-sun-intensity': 15,
    },
  });
}

function _addContourLayers() {
  verdantMap.addSource('contours', {
    type: 'vector',
    url: 'mapbox://mapbox.mapbox-terrain-v2',
  });

  // Minor contours — every 10m, visible at plot scale (zoom 15+)
  verdantMap.addLayer({
    id: 'contour-lines-minor',
    type: 'line',
    source: 'contours',
    'source-layer': 'contour',
    filter: ['==', ['%', ['get', 'ele'], 10], 0],
    minzoom: 14,
    paint: {
      'line-color': 'rgba(120,200,80,0.45)',
      'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.5, 17, 1.2, 19, 1.8],
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0.4, 16, 0.7],
    },
  });

  // Major contours — every 50m, bolder, visible from further out
  verdantMap.addLayer({
    id: 'contour-lines-major',
    type: 'line',
    source: 'contours',
    'source-layer': 'contour',
    filter: ['==', ['%', ['get', 'ele'], 50], 0],
    paint: {
      'line-color': ['interpolate', ['linear'], ['get', 'ele'],
        0,    'rgba(58,159,200,0.7)',
        200,  'rgba(120,200,80,0.7)',
        500,  'rgba(232,168,48,0.7)',
        1000, 'rgba(200,80,40,0.7)',
      ],
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 16, 2, 19, 2.5],
      'line-opacity': 0.85,
    },
  });

  // Contour labels — show every 10m at close zoom, every 50m further out
  verdantMap.addLayer({
    id: 'contour-labels',
    type: 'symbol',
    source: 'contours',
    'source-layer': 'contour',
    filter: ['==', ['%', ['get', 'ele'], 10], 0],
    minzoom: 15,
    layout: {
      'symbol-placement': 'line',
      'text-field': ['concat', ['to-string', ['get', 'ele']], 'm'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 15, 9, 18, 11],
      'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Regular'],
    },
    paint: {
      'text-color': 'rgba(200,230,160,0.9)',
      'text-halo-color': 'rgba(0,0,0,0.7)',
      'text-halo-width': 1.5,
    },
  });
}

function _addBoundaryLayer() {
  verdantMap.addSource('boundary', {
    type: 'geojson',
    data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[]] } },
  });
  verdantMap.addLayer({
    id: 'boundary-fill',
    type: 'fill',
    source: 'boundary',
    paint: { 'fill-color': 'rgba(92,184,50,0.06)', 'fill-opacity': 1 },
  });
  verdantMap.addLayer({
    id: 'boundary-line',
    type: 'line',
    source: 'boundary',
    paint: {
      'line-color': 'rgba(168,230,100,0.7)',
      'line-width': 2.5,
      'line-dasharray': [5, 2],
    },
  });
}

function _addZoneLayers() {
  [
    { id: 'zone-water', color: 'rgba(58,159,200,0.22)' },
    { id: 'zone-food', color: 'rgba(92,184,50,0.2)' },
    { id: 'zone-solar', color: 'rgba(232,168,48,0.18)' },
    { id: 'zone-soil', color: 'rgba(200,120,48,0.15)' },
  ].forEach(z => {
    verdantMap.addSource(z.id, {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[]] } },
    });
    verdantMap.addLayer({
      id: z.id,
      type: 'fill',
      source: z.id,
      paint: { 'fill-color': z.color, 'fill-opacity': 1 },
    });
  });
}

// ── Geocoding ─────────────────────────────────────────────────────────

async function _geocodeAddress(address, token) {
  try {
    const r = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${token}&limit=1`
    );
    const d = await r.json();
    if (d.features?.length) {
      const [lng, lat] = d.features[0].center;
      verdantMap.flyTo({ center: [lng, lat], zoom: 18, pitch: 45, bearing: -20, duration: 2500 });
      const badge = document.getElementById('mapPropBadge');
      if (badge) badge.textContent = d.features[0].place_name?.split(',')[0] || address;
      // Auto-populate iNat coordinate fields with the geocoded location
      const latEl = document.getElementById('inatLat');
      const lngEl = document.getElementById('inatLng');
      if (latEl) latEl.value = lat.toFixed(4);
      if (lngEl) lngEl.value = lng.toFixed(4);
      setTimeout(() => {
        _placeDefaultBoundary(lng, lat);
        sampleTerrainAndAnalyse(lng, lat);
      }, 3000);
    }
  } catch (e) {
    toast('Geocoding failed — check your Mapbox token', '⚠️');
  }
}

export async function geocodeSearch() {
  const q = document.getElementById('mapSearchInput')?.value.trim();
  if (!q || !verdantMap) return;
  try {
    const r = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${mapboxgl.accessToken}&limit=1`
    );
    const d = await r.json();
    if (d.features?.length) {
      const [lng, lat] = d.features[0].center;
      verdantMap.flyTo({ center: [lng, lat], zoom: 18, pitch: 45, bearing: -20, duration: 1800 });
      _clearAllMarkers();
      setTimeout(() => {
        _placeDefaultBoundary(lng, lat);
        sampleTerrainAndAnalyse(lng, lat);
      }, 2200);
    }
  } catch (e) {
    toast('Search failed', '⚠️');
  }
}

// ── Terrain sampling ──────────────────────────────────────────────────

/**
 * Sample a 5×5 elevation grid, derive terrain intelligence, then
 * ask Claude to place design opportunities at terrain-logical positions.
 */
export async function sampleTerrainAndAnalyse(cx, cy) {
  _showAILoading();

  const d = 0.003;
  const steps = 5;
  const grid = [];
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) {
      grid.push({
        lng: cx - d + (i / (steps - 1)) * d * 2,
        lat: cy - d + (j / (steps - 1)) * d * 2,
      });
    }
  }

  // Wait for DEM tiles to load
  await new Promise(r => setTimeout(r, 1200));

  const samples = grid.map(pt => {
    let elev = null;
    try { elev = verdantMap.queryTerrainElevation([pt.lng, pt.lat], { exaggerated: false }); } catch (e) {}
    return { ...pt, elev: elev ?? 0 };
  });

  const elevs = samples.map(s => s.elev);
  const minElev = Math.min(...elevs);
  const maxElev = Math.max(...elevs);
  const relief = maxElev - minElev;

  const lowest = samples.reduce((a, b) => a.elev < b.elev ? a : b);
  const highest = samples.reduce((a, b) => a.elev > b.elev ? a : b);
  const midElev = (minElev + maxElev) / 2;
  const midSlope = samples.filter(s => Math.abs(s.elev - midElev) < relief * 0.2);
  const swaleCandidate = midSlope[Math.floor(midSlope.length / 2)] || { lng: cx - 0.001, lat: cy + 0.001 };

  const northSamples = samples.filter(s => s.lat > cy);
  const southSamples = samples.filter(s => s.lat <= cy);
  const avgNorth = northSamples.reduce((a, b) => a + b.elev, 0) / northSamples.length;
  const avgSouth = southSamples.reduce((a, b) => a + b.elev, 0) / southSamples.length;
  const slopeDir = avgNorth > avgSouth ? 'north-to-south' : 'south-to-north';

  // Hemisphere-aware aspect: in the Northern Hemisphere south-facing slopes
  // get more sun; in the Southern Hemisphere north-facing slopes do.
  const isNorthernHemisphere = cy >= 0;
  const aspect = isNorthernHemisphere
    ? (avgNorth > avgSouth ? 'south-facing (good solar)' : 'north-facing (cooler, moister)')
    : (avgSouth > avgNorth ? 'north-facing (good solar)' : 'south-facing (cooler, moister)');

  const terrainContext = {
    cx, cy,
    relief: relief.toFixed(1),
    minElev: minElev.toFixed(1),
    maxElev: maxElev.toFixed(1),
    lowestPoint: lowest,
    highestPoint: highest,
    swaleCandidate,
    slopeDir,
    aspect,
    propertySize: APP.property.size || '3.4 acres',
    soil: APP.property.soil || 'Clay-loam',
    water: APP.property.water || 'Seasonal creek',
    goals: APP.property.goals || ['food abundance', 'water security'],
    address: APP.property.address || 'Unknown location',
  };

  _updateTerrainBadge(terrainContext);

  try {
    const opps = await runAIPlacement(terrainContext);
    aiOpps = {};
    opps.forEach(o => { aiOpps[o.id] = o; });
    _hideAILoading();
    _placeAIPins(opps);
    _placeAIZoneBlobs(opps);
    toast('Terrain analysis complete', '🌿');
  } catch (e) {
    console.error('AI placement error:', e);
    _hideAILoading();
    _fallbackPins(terrainContext);
  }
}

// ── Pin placement ─────────────────────────────────────────────────────

function _placeAIPins(opps) {
  opps.forEach((o, i) => setTimeout(() => _addPin(o), 200 + i * 300));
}

function _addPin(o) {
  const catColors = {
    water: { bg: 'rgba(16,50,76,.95)', clr: '#90d8f0', border: 'rgba(58,159,200,.5)' },
    food: { bg: 'rgba(16,40,10,.95)', clr: '#a0e060', border: 'rgba(92,184,50,.5)' },
    solar: { bg: 'rgba(52,32,6,.95)', clr: '#f0c860', border: 'rgba(232,168,48,.5)' },
    soil: { bg: 'rgba(36,20,6,.95)', clr: '#d4a870', border: 'rgba(200,120,48,.5)' },
  };
  const c = catColors[o.category] || catColors.food;

  const el = document.createElement('div');
  el.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer;animation:pinPop .4s cubic-bezier(.34,1.56,.64,1)';
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:5px;padding:6px 12px 6px 8px;border-radius:50px;font-size:11px;font-weight:700;white-space:nowrap;background:${c.bg};color:${c.clr};border:1.5px solid ${c.border};box-shadow:0 4px 16px rgba(0,0,0,.6)">
      <span style="font-size:13px">${o.icon}</span>${o.title}
    </div>
    <div style="width:2px;height:8px;background:rgba(255,255,255,.2);border-radius:1px"></div>
    <div style="width:6px;height:6px;border-radius:50%;background:${c.border}"></div>`;

  el.addEventListener('click', e => {
    e.stopPropagation();
    _openOppDrawer(o.id);
  });

  const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
    .setLngLat([o.lng, o.lat])
    .addTo(verdantMap);

  mapPinMarkers[o.id] = marker;
}

function _openOppDrawer(id) {
  const o = aiOpps[id];
  if (!o) return;
  const isAdded = APP.selectedOpps.has(id);
  openDrawer(o, isAdded, (oppId) => {
    _toggleOpp(oppId);
    updateDrawerAddBtn(APP.selectedOpps.has(oppId));
  });
}

function _toggleOpp(id) {
  if (APP.selectedOpps.has(id)) {
    APP.selectedOpps.delete(id);
    toast('Removed', '↩️');
  } else {
    APP.selectedOpps.add(id);
    toast((aiOpps[id]?.title || id) + ' added!', '✅');
  }
  _updateMapHUD();

  // Notify inat module so sysRow stays in sync
  import('./inat.js').then(m => m.initSysRow());
}

// ── Zone blobs ────────────────────────────────────────────────────────

function _placeAIZoneBlobs(opps) {
  const catZone = { water: 'zone-water', food: 'zone-food', solar: 'zone-solar', soil: 'zone-soil' };
  const groups = {};
  opps.forEach(o => {
    const z = catZone[o.category];
    if (!z) return;
    if (!groups[z]) groups[z] = [];
    groups[z].push(o);
  });
  Object.entries(groups).forEach(([zoneId, pts]) => {
    const cx = pts.reduce((a, b) => a + b.lng, 0) / pts.length;
    const cy = pts.reduce((a, b) => a + b.lat, 0) / pts.length;
    const geo = _circleGeo(cx, cy, 0.004, 0.003);
    if (verdantMap.getSource(zoneId)) verdantMap.getSource(zoneId).setData(geo);
  });
}

function _circleGeo(cx, cy, rx, ry, steps = 32) {
  const coords = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    coords.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] } };
}

// ── Fallback pins (no AI / API error) ────────────────────────────────

function _fallbackPins(tc) {
  const fallbacks = [
    {
      id: 'swales', title: 'Contour Swales', icon: '💧', category: 'water',
      lat: tc.swaleCandidate.lat, lng: tc.swaleCandidate.lng,
      reasoning: `Mid-slope position at ~${tc.swaleCandidate.elev?.toFixed(0) || '–'}m elevation — ideal for intercepting runoff on this ${tc.slopeDir} slope.`,
      stats: [{ v: '68%', l: 'Rain captured' }, { v: '~$800', l: 'Est. cost' }, { v: '2 days', l: 'Install' }],
      tags: ['Year 1', 'DIY possible'], impact: 'High',
    },
    {
      id: 'pond', title: 'Retention Pond', icon: '🌊', category: 'water',
      lat: tc.lowestPoint.lat, lng: tc.lowestPoint.lng,
      reasoning: `Lowest point at ${tc.lowestPoint.elev.toFixed(0)}m — natural catchment for all upslope runoff.`,
      stats: [{ v: '4 months', l: 'Dry storage' }, { v: '~$2,400', l: 'Est. cost' }, { v: '4,000L', l: 'Capacity' }],
      tags: ['Year 1–2', 'Wildlife habitat'], impact: 'High',
    },
    {
      id: 'food_forest', title: 'Food Forest', icon: '🌳', category: 'food',
      lat: tc.cy + 0.001, lng: tc.cx - 0.001,
      reasoning: `${tc.aspect} — best light exposure for multi-layered canopy.`,
      stats: [{ v: '457%', l: 'More species' }, { v: '40+', l: 'Edibles' }, { v: '~2 hrs', l: 'Wk yr 3' }],
      tags: ['Year 1–3', 'Self-fertilising'], impact: 'High',
    },
    {
      id: 'soil_rehab', title: 'Soil Rehab', icon: '🪱', category: 'soil',
      lat: tc.cy - 0.001, lng: tc.cx + 0.0005,
      reasoning: 'Compacted lower areas benefit most from no-dig mulch and microbial inoculants.',
      stats: [{ v: '+27%', l: 'Soil carbon' }, { v: '201×', l: 'Earthworms' }, { v: '2–3yr', l: 'Recovery' }],
      tags: ['Year 1', 'No-dig'], impact: 'Medium',
    },
  ];
  fallbacks.forEach(o => { aiOpps[o.id] = o; });
  _placeAIPins(fallbacks);
  _placeAIZoneBlobs(fallbacks);
}

// ── Boundary drawing ──────────────────────────────────────────────────

function _placeDefaultBoundary(lng, lat) {
  const d = 0.0045;
  const coords = [
    [lng - d * .6, lat + d * .55], [lng + d * .4, lat + d * .65],
    [lng + d * .85, lat + d * .1], [lng + d * .7, lat - d * .5],
    [lng - d * .1, lat - d * .7], [lng - d * .8, lat - d * .3],
    [lng - d * .6, lat + d * .55],
  ];
  verdantMap.getSource('boundary').setData({
    type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] },
  });
}

export function startDrawMode() {
  mapDrawMode = true;
  mapDrawCoords = [];
  mapDrawMarkers.forEach(m => m.remove());
  mapDrawMarkers = [];
  document.getElementById('mapDrawBanner').style.display = 'flex';
  document.getElementById('mapBoundaryToolbar').style.display = 'none';
  document.getElementById('mapAcreBadge').style.display = 'none';
  verdantMap.getSource('boundary').setData({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[]] } });
  verdantMap.getCanvas().style.cursor = 'crosshair';
  _clearAllMarkers();
}

export function confirmBoundary() {
  mapDrawMode = false;
  document.getElementById('mapDrawBanner').style.display = 'none';
  document.getElementById('mapBoundaryToolbar').style.display = 'none';
  mapDrawMarkers.forEach(m => m.remove());
  mapDrawMarkers = [];
  verdantMap.getCanvas().style.cursor = '';
  toast('Boundary confirmed — running AI analysis…', '🌿');
  if (mapDrawCoords.length >= 3) {
    const cx = mapDrawCoords.reduce((s, c) => s + c[0], 0) / mapDrawCoords.length;
    const cy = mapDrawCoords.reduce((s, c) => s + c[1], 0) / mapDrawCoords.length;
    sampleTerrainAndAnalyse(cx, cy);
  }
}

export function clearBoundary() {
  mapDrawCoords = [];
  mapDrawMarkers.forEach(m => m.remove());
  mapDrawMarkers = [];
  verdantMap.getSource('boundary').setData({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[]] } });
  document.getElementById('mapBoundaryToolbar').style.display = 'none';
  document.getElementById('mapAcreBadge').style.display = 'none';
}

function _onMapClick(e) {
  if (!mapDrawMode) return;
  mapDrawCoords.push([e.lngLat.lng, e.lngLat.lat]);

  const dot = document.createElement('div');
  dot.style.cssText = 'width:10px;height:10px;border-radius:50%;background:#e8a830;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,.6)';
  const m = new mapboxgl.Marker({ element: dot }).setLngLat(e.lngLat).addTo(verdantMap);
  mapDrawMarkers.push(m);

  if (mapDrawCoords.length >= 3) {
    const closed = [...mapDrawCoords, mapDrawCoords[0]];
    verdantMap.getSource('boundary').setData({
      type: 'Feature', geometry: { type: 'Polygon', coordinates: [closed] },
    });
    document.getElementById('mapBoundaryToolbar').style.display = 'flex';
    _updateAcreBadge(mapDrawCoords);
  }
}

function _updateAcreBadge(coords) {
  let area = 0;
  const n = coords.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += coords[i][0] * coords[j][1];
    area -= coords[j][0] * coords[i][1];
  }
  const sqDeg = Math.abs(area) / 2;
  const sqM = sqDeg * 111320 * 111320 * Math.cos(coords[0][1] * Math.PI / 180);
  const acres = (sqM / 4047).toFixed(1);
  const badge = document.getElementById('mapAcreBadge');
  badge.textContent = `${acres} acres selected`;
  badge.style.display = 'block';
  APP.property.size = `${acres} acres`;
}

// ── Map style switching ────────────────────────────────────────────────

export function setMapStyle(style, activeBtn) {
  if (!verdantMap) return;
  document.querySelectorAll('#btn-sat, #btn-topo').forEach(b => {
    b.style.background = 'rgba(12,20,8,.9)';
    b.style.borderColor = 'var(--border)';
    b.style.color = 'var(--muted)';
  });
  activeBtn.style.background = 'rgba(85,176,37,.2)';
  activeBtn.style.borderColor = 'rgba(85,176,37,.4)';
  activeBtn.style.color = '#a0e060';

  verdantMap.setStyle(
    style === 'satellite'
      ? 'mapbox://styles/mapbox/satellite-streets-v12'
      : 'mapbox://styles/mapbox/outdoors-v12'
  );

  verdantMap.once('styledata', () => {
    _add3DTerrain();
    _addContourLayers();
    _addBoundaryLayer();
    _addZoneLayers();
    // Re-place existing pins after style reload
    const existing = Object.values(aiOpps);
    if (existing.length) {
      _placeAIPins(existing);
      _placeAIZoneBlobs(existing);
    }
  });
}

// ── Layer toggles ─────────────────────────────────────────────────────

export function toggleLayer(el, layer) {
  const on = el.dataset.active !== 'true';
  el.dataset.active = on ? 'true' : 'false';
  el.style.color = on ? 'var(--cream)' : 'var(--muted)';
  el.style.borderColor = on ? 'rgba(255,255,255,.2)' : 'var(--border)';

  const vis = on ? 'visible' : 'none';
  const layerMap = {
    water: ['zone-water'],
    food: ['zone-food'],
    solar: ['zone-solar'],
    soil: ['zone-soil'],
  };
  (layerMap[layer] || []).forEach(id => {
    if (verdantMap?.getLayer(id)) verdantMap.setLayoutProperty(id, 'visibility', vis);
  });

  const catMap = {
    water: ['swales', 'pond'],
    food: ['food_forest', 'kitchen_garden', 'medicinals'],
    solar: ['solar_zone', 'windbreak'],
    soil: ['soil_rehab'],
  };
  (catMap[layer] || []).forEach(id => {
    const m = mapPinMarkers[id];
    if (m) m.getElement().style.opacity = vis === 'visible' ? '1' : '0.25';
  });
}

// ── HUD updates ────────────────────────────────────────────────────────

function _updateMapHUD() {
  const n = APP.selectedOpps.size;
  document.getElementById('mv-s').textContent = n;

  const all = [...APP.selectedOpps].map(k => aiOpps[k]).filter(Boolean);
  const waterCount = all.filter(o => o.category === 'water').length;
  const foodCount = all.filter(o => o.category === 'food').length;

  document.getElementById('mv-w').textContent = waterCount >= 2 ? '82%' : waterCount === 1 ? '55%' : '–';
  document.getElementById('mv-f').textContent = foodCount >= 2 ? '520kg' : foodCount === 1 ? '200kg' : '–';

  const cta = document.getElementById('mapCta');
  if (cta) {
    cta.style.opacity = n > 0 ? '1' : '0';
    cta.style.pointerEvents = n > 0 ? 'all' : 'none';
    cta.style.transform = n > 0 ? 'scale(1)' : 'scale(.9)';
  }

  const nb = document.getElementById('nb-map');
  if (nb) { nb.textContent = n; nb.classList.toggle('on', n > 0); }
}

function _updateCompassHUD() {
  const bearing = verdantMap?.getBearing() || 0;
  const needle = document.getElementById('compassNeedle');
  if (needle) needle.style.transform = `rotate(${bearing}deg)`;
}

function _updateTerrainBadge(tc) {
  const el = document.getElementById('elevBadge');
  if (!el) return;
  document.getElementById('elevRelief').textContent = `Relief: ${tc.relief}m`;
  document.getElementById('elevAspect').textContent = tc.aspect.split('(')[0].trim();
  el.style.display = 'block';
}

// ── AI loading state ─────────────────────────────────────────────────

function _showAILoading() {
  _clearAllMarkers();
  const el = document.getElementById('mapAIStatus');
  if (el) {
    el.style.display = 'flex';
    el.innerHTML = `<span style="animation:lspin 1s linear infinite;display:inline-block">🌿</span>&nbsp; Analysing terrain with AI…`;
  }
}

function _hideAILoading() {
  const el = document.getElementById('mapAIStatus');
  if (el) el.style.display = 'none';
}

// ── Helpers ────────────────────────────────────────────────────────────

function _clearAllMarkers() {
  Object.values(mapPinMarkers).forEach(m => m.remove());
  mapPinMarkers = {};
  ['zone-water', 'zone-food', 'zone-solar', 'zone-soil'].forEach(id => {
    if (verdantMap?.getSource(id)) {
      verdantMap.getSource(id).setData({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[]] } });
    }
  });
  if (verdantMap?.getSource('boundary')) {
    verdantMap.getSource('boundary').setData({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[]] } });
  }
}

// ── Control wiring ─────────────────────────────────────────────────────

function _wireControls() {
  // Search
  const searchBtn = document.getElementById('mapSearchBtn');
  const searchInput = document.getElementById('mapSearchInput');
  if (searchBtn) searchBtn.addEventListener('click', geocodeSearch);
  if (searchInput) searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') geocodeSearch(); });

  // Style buttons
  const satBtn = document.getElementById('btn-sat');
  const topoBtn = document.getElementById('btn-topo');
  if (satBtn) satBtn.addEventListener('click', () => setMapStyle('satellite', satBtn));
  if (topoBtn) topoBtn.addEventListener('click', () => setMapStyle('topo', topoBtn));

  // Draw
  const drawBtn = document.getElementById('btn-draw');
  if (drawBtn) drawBtn.addEventListener('click', startDrawMode);
  const confirmBtn = document.getElementById('confirmBoundaryBtn');
  if (confirmBtn) confirmBtn.addEventListener('click', confirmBoundary);
  const clearBtn = document.getElementById('clearBoundaryBtn');
  if (clearBtn) clearBtn.addEventListener('click', clearBoundary);

  // Layer switcher
  document.querySelectorAll('#mapLayerSwitcher [data-layer]').forEach(el => {
    el.addEventListener('click', () => toggleLayer(el, el.dataset.layer));
  });

  // CTA → Plants screen
  const cta = document.getElementById('mapCta');
  if (cta) cta.addEventListener('click', () => import('./nav.js').then(m => m.navTo('s2')));

  // Close drawer on map canvas click
  document.addEventListener('click', e => {
    const drawer = document.getElementById('drawer');
    if (drawer && !drawer.contains(e.target) && !e.target.closest('.mapboxgl-marker')) {
      closeDrawer();
    }
  });
}
