/**
 * dashboard.js
 * Illustrated eco-dashboard (S6).
 *
 * Renders four radial gauges, a property-scan panel with zone bars,
 * and a site-metrics strip. Reads from APP after plant analysis runs.
 */

import { APP } from './state.js';

// ── Gauge helper ───────────────────────────────────────────────────────

/**
 * Build SVG arc path for a radial gauge.
 * Uses a 160°-wide sweep on a 100×100 viewBox.
 */
function _gaugeArc(pct, r = 38) {
  const cx = 50, cy = 54;
  const startAngle = -200; // degrees from 3 o'clock
  const sweep = 220;       // total sweep degrees
  const angle = startAngle + sweep * Math.min(1, Math.max(0, pct));

  const toRad = d => (d * Math.PI) / 180;

  const x1 = cx + r * Math.cos(toRad(startAngle));
  const y1 = cy + r * Math.sin(toRad(startAngle));
  const x2 = cx + r * Math.cos(toRad(angle));
  const y2 = cy + r * Math.sin(toRad(angle));

  const large = sweep * pct > 180 ? 1 : 0;

  // Track arc (background)
  const tx1 = cx + r * Math.cos(toRad(startAngle));
  const ty1 = cy + r * Math.sin(toRad(startAngle));
  const tx2 = cx + r * Math.cos(toRad(startAngle + sweep));
  const ty2 = cy + r * Math.sin(toRad(startAngle + sweep));

  return {
    track: `M ${tx1.toFixed(2)} ${ty1.toFixed(2)} A ${r} ${r} 0 1 1 ${tx2.toFixed(2)} ${ty2.toFixed(2)}`,
    fill:  pct <= 0
      ? ''
      : `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
  };
}

/**
 * Render one radial gauge widget.
 * The fill path starts invisible (dashoffset = pathLength) and animates
 * to visible via _animateGauges() after render.
 */
function _gaugeHTML({ id, emoji, label, value, unit, pct, color, sub }) {
  const { track, fill } = _gaugeArc(pct);
  const strokeW = 7;
  return `
  <div class="gauge-widget" id="gw-${id}" data-pct="${pct}" data-val="${value}" data-unit="${unit}">
    <svg viewBox="0 0 100 100" class="gauge-svg" aria-hidden="true">
      <path class="gauge-track" d="${track}" fill="none" stroke-width="${strokeW}" stroke-linecap="round"/>
      ${fill ? `<path class="gauge-fill" id="gf-${id}" d="${fill}" fill="none" stroke-width="${strokeW}"
        stroke-linecap="round" stroke="${color}"
        style="filter:drop-shadow(0 0 4px ${color}66);stroke-dashoffset:1;stroke-dasharray:1"/>` : ''}
    </svg>
    <div class="gauge-inner">
      <div class="gauge-emoji">${emoji}</div>
      <div class="gauge-val" id="gv-${id}">0<span class="gauge-unit">${unit}</span></div>
    </div>
    <div class="gauge-label">${label}</div>
    ${sub ? `<div class="gauge-sub">${sub}</div>` : ''}
  </div>`;
}

// ── Zone bar helper ────────────────────────────────────────────────────

function _zoneHTML({ emoji, name, pct, color }) {
  return `
  <div class="zone-row">
    <div class="zone-left">
      <span class="zone-emoji">${emoji}</span>
      <span class="zone-name">${name}</span>
    </div>
    <div class="zone-bar-wrap">
      <div class="zone-bar-fill" data-pct="${pct}" style="width:0%;background:${color}"></div>
    </div>
    <div class="zone-pct">${pct}%</div>
  </div>`;
}

// ── Compute scores from APP state ──────────────────────────────────────

function _computeScores() {
  const plants = APP.plants || [];
  const meds = APP.medicinals || [];
  const wildlife = APP.wildlife || {};
  const opps = APP.selectedOpps || new Set();
  const goals = APP.property.goals || [];

  // Soil Health: based on plant diversity (layers represented)
  const layers = [...new Set(plants.map(p => p.layer).filter(Boolean))];
  const soilPct = Math.min(100, 40 + layers.length * 10 + (meds.length > 0 ? 8 : 0));

  // Water Retention: based on selected water-related opps + plants with deep roots
  const waterOpps = [...opps].filter(o => /water|swale|pond|rain/i.test(o)).length;
  const deepRoots = plants.filter(p => /deep|1\.[5-9]|[2-9]\d*m/i.test(p.rootDepth || '')).length;
  const waterPct = Math.min(100, 25 + waterOpps * 18 + deepRoots * 5
    + (goals.includes('water security') ? 15 : 0));

  // Pollinator Activity: based on pollinators array + plants with pollinator role
  const pollinatorCount = (wildlife.pollinators || []).length;
  const pollPlants = plants.filter(p => (p.roles || []).some(r => /pollinat/i.test(r))).length;
  const pollinatorRaw = pollinatorCount * 12 + pollPlants * 8;

  // Solar Yield: use real NASA irradiance if available, else estimate
  const sp = APP.siteProfile;
  const solarKw = sp?.solar_kw ?? (parseFloat(APP.property.size) * 1.4 || 5.8);

  // Biodiversity (for report card)
  const biodiversityPct = Math.min(100, 20
    + plants.length * 4
    + meds.length * 3
    + (wildlife.pollinators || []).length * 4
    + (wildlife.pestPredators || []).length * 3);

  return {
    soil:       { pct: soilPct,       value: soilPct,        unit: '%',   label: 'Soil Health',       emoji: '🪱', color: '#7EB67A', sub: layers.length ? `${layers.length} plant layers` : 'Add plants to improve' },
    water:      { pct: waterPct,      value: waterPct,       unit: '%',   label: 'Water Retention',   emoji: '💧', color: '#5BA3C9', sub: `${waterOpps} water systems` },
    pollinator: { pct: Math.min(1, pollinatorRaw / 200), value: pollinatorCount * 12 + pollPlants * 8, unit: '', label: 'Pollinator Activity', emoji: '🌸', color: '#DDA15E', sub: `${pollinatorCount} species nearby` },
    solar:      { pct: Math.min(1, solarKw / 12),  value: solarKw.toFixed(1), unit: 'kW', label: 'Solar Potential', emoji: '☀️', color: '#E8A830', sub: `est. peak capture` },
    biodiversity: biodiversityPct,
    plants:     plants.length,
    meds:       meds.length,
    systems:    opps.size,
  };
}

// ── Animation ──────────────────────────────────────────────────────────

/**
 * Animate gauge arcs, zone bars, and counter numbers after render.
 * Called via double-rAF so the browser has painted initial state first.
 */
function _animateDashboard() {
  // ── Gauge arc draw-on ──
  document.querySelectorAll('.gauge-fill').forEach((path, i) => {
    const len = path.getTotalLength?.() ?? 200;
    path.style.strokeDasharray = `${len}`;
    path.style.strokeDashoffset = `${len}`;
    path.style.transition = 'none';
    // Stagger each gauge by 120ms
    setTimeout(() => {
      path.style.transition = `stroke-dashoffset 1s cubic-bezier(0.4,0,0.2,1)`;
      path.style.strokeDashoffset = '0';
    }, 80 + i * 120);
  });

  // ── Zone bar slide-in ──
  document.querySelectorAll('.zone-bar-fill').forEach((bar, i) => {
    const targetPct = bar.dataset.pct || 0;
    bar.style.width = '0%';
    bar.style.transition = 'none';
    setTimeout(() => {
      bar.style.transition = `width 0.9s cubic-bezier(0.4,0,0.2,1)`;
      bar.style.width = `${targetPct}%`;
    }, 200 + i * 80);
  });

  // ── Counter count-up ──
  document.querySelectorAll('.gauge-widget').forEach((widget, i) => {
    const valEl = widget.querySelector('.gauge-val');
    if (!valEl) return;
    const unit = widget.dataset.unit || '';
    const rawVal = parseFloat(widget.dataset.val) || 0;
    // Integer or 1-decimal
    const isDecimal = String(widget.dataset.val).includes('.');
    const duration = 900;
    const startDelay = 80 + i * 120;
    const startTime = performance.now() + startDelay;

    function tick(now) {
      const elapsed = Math.max(0, now - startTime);
      const progress = Math.min(1, elapsed / duration);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = rawVal * eased;
      const display = isDecimal ? current.toFixed(1) : Math.round(current);
      valEl.innerHTML = `${display}<span class="gauge-unit">${unit}</span>`;
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

// ── Render ─────────────────────────────────────────────────────────────

export function renderDashboard() {
  const container = document.getElementById('dashContent');
  if (!container) return;

  const s = _computeScores();
  const prop = APP.property;
  const sp = APP.siteProfile;   // ingestion results (may be null)
  const hasData = APP.analysisRan;

  // ── Gauges ──
  const gauges = [
    { id: 'soil',  ...s.soil,  sub: hasData ? s.soil.sub : 'Run analysis to update' },
    { id: 'water', ...s.water, sub: hasData ? s.water.sub : 'Run analysis to update' },
    { id: 'poll',  ...s.pollinator, sub: hasData ? s.pollinator.sub : 'Run analysis to update' },
    { id: 'solar', ...s.solar, sub: sp?.solar_kwh_day ? `${sp.solar_kwh_day} kWh/m²/day` : s.solar.sub },
  ];

  // ── Property Scan zones ──
  const zones = [
    { emoji: '🌳', name: 'Food Forest',  pct: hasData ? Math.min(95, 40 + s.plants * 3) : 0,   color: '#5C7F6E' },
    { emoji: '🥬', name: 'Garden Beds',  pct: hasData ? Math.min(95, 50 + s.meds * 4) : 0,     color: '#A3B18A' },
    { emoji: '💧', name: 'Water Systems', pct: hasData ? Math.min(95, 30 + s.systems * 15) : 0, color: '#5BA3C9' },
    { emoji: '🌻', name: 'Pollinator Zones', pct: hasData ? Math.min(95, 25 + (s.pollinator.value > 0 ? 35 : 0) + s.plants * 2) : 0, color: '#DDA15E' },
  ];

  const biodiversityDisplay = hasData ? `${s.biodiversity}%` : '–';
  const soilDisplay = hasData ? `${s.soil.value}%` : '–';
  const plantsDisplay = hasData ? s.plants : '–';
  const systemsDisplay = hasData ? (s.systems || '–') : '–';

  container.innerHTML = `

    <!-- Property Scan Panel -->
    <div class="prop-scan-card">
      <div class="psc-header">
        <div class="psc-dot"></div>
        <div class="psc-title">Property Scan</div>
        <div class="psc-address">${prop.address || 'Not set'}</div>
      </div>

      <div class="psc-illustration">
        <div class="psc-terrain">
          <div class="terrain-layer tl-sky"></div>
          <div class="terrain-layer tl-canopy"></div>
          <div class="terrain-layer tl-mid"></div>
          <div class="terrain-layer tl-ground"></div>
          <div class="terrain-layer tl-water"></div>
          <div class="terrain-labels">
            <span class="tl-badge" style="left:12%;top:28%">🌳 Canopy</span>
            <span class="tl-badge" style="left:55%;top:18%">☀️ Solar</span>
            <span class="tl-badge" style="left:72%;top:56%">💧 Water</span>
          </div>
        </div>
      </div>

      <div class="psc-zones">
        ${zones.map(_zoneHTML).join('')}
      </div>

      <div class="psc-stats">
        <div class="pss"><div class="pss-v">${prop.size || '–'}</div><div class="pss-l">Property size</div></div>
        <div class="pss-div"></div>
        <div class="pss"><div class="pss-v">${prop.soil ? prop.soil.split(',')[0] : '–'}</div><div class="pss-l">Soil type</div></div>
        <div class="pss-div"></div>
        <div class="pss"><div class="pss-v">${prop.goals.length}</div><div class="pss-l">Goals set</div></div>
      </div>
    </div>

    <!-- Gauge Grid -->
    <div class="sec-label" style="margin-top:4px">Ecosystem Vitals</div>
    <div class="gauge-grid">
      ${gauges.map(_gaugeHTML).join('')}
    </div>

    ${!hasData ? `
    <div class="dash-nudge">
      <div class="dn-ico">🌱</div>
      <div class="dn-text">Run <strong>Analyse My Land</strong> on the Plants screen to populate your gauges with real data.</div>
    </div>` : ''}

    <!-- Report Summary Row -->
    <div class="sec-label" style="margin-top:4px">Design Overview</div>
    <div class="dash-overview">
      <div class="do-cell">
        <div class="do-v">${plantsDisplay}</div>
        <div class="do-l">Plants matched</div>
      </div>
      <div class="do-cell do-cell-accent">
        <div class="do-v">${biodiversityDisplay}</div>
        <div class="do-l">Biodiversity</div>
      </div>
      <div class="do-cell">
        <div class="do-v">${soilDisplay}</div>
        <div class="do-l">Soil health</div>
      </div>
      <div class="do-cell">
        <div class="do-v">${systemsDisplay}</div>
        <div class="do-l">Systems active</div>
      </div>
    </div>

    <!-- Site Metrics -->
    <div class="sec-label" style="margin-top:4px">Site Conditions</div>
    <div class="site-metrics">
      <div class="sm-row">
        <div class="sm-icon">🌡️</div>
        <div class="sm-info">
          <div class="sm-label">Climate Zone</div>
          <div class="sm-val">${sp?.climate || prop.climate || 'Fetching…'}</div>
        </div>
      </div>
      <div class="sm-row">
        <div class="sm-icon">🌧️</div>
        <div class="sm-info">
          <div class="sm-label">Annual Rainfall</div>
          <div class="sm-val">${sp?.rainfall || prop.rainfall || 'Fetching…'}${sp?.rain_mm_year ? '' : ''}</div>
        </div>
      </div>
      <div class="sm-row">
        <div class="sm-icon">❄️</div>
        <div class="sm-info">
          <div class="sm-label">Frost</div>
          <div class="sm-val">${sp?.frost || prop.frost || 'Fetching…'}</div>
        </div>
      </div>
      <div class="sm-row">
        <div class="sm-icon">☀️</div>
        <div class="sm-info">
          <div class="sm-label">Solar Irradiance</div>
          <div class="sm-val">${sp?.solar_kwh_day ? `${sp.solar_kwh_day} kWh/m²/day` : (prop.slope ? 'Variable — see map' : 'Fetching…')}</div>
        </div>
      </div>
      <div class="sm-row">
        <div class="sm-icon">📐</div>
        <div class="sm-info">
          <div class="sm-label">Elevation & Slope</div>
          <div class="sm-val">${sp?.elevation ? `${Math.round(sp.elevation)}m asl` : ''}${prop.slope ? (sp?.elevation ? ' · ' : '') + prop.slope : (!sp?.elevation ? 'Visit the Map to read terrain' : '')}</div>
        </div>
      </div>
      <div class="sm-row">
        <div class="sm-icon">🪱</div>
        <div class="sm-info">
          <div class="sm-label">Soil Profile</div>
          <div class="sm-val">${prop.soil || (sp ? 'Fetching…' : '–')}</div>
          ${sp?.soilGrids?.ph ? `<div class="sm-sub">pH ${sp.soilGrids.ph} · ${sp.soilGrids.clay_pct ?? '–'}% clay · ${sp.soilGrids.soc_gkg ?? '–'}g/kg carbon</div>` : ''}
        </div>
      </div>
      <div class="sm-row">
        <div class="sm-icon">💧</div>
        <div class="sm-info"><div class="sm-label">Water Features</div><div class="sm-val">${prop.water || '–'}</div></div>
      </div>
    </div>

    <div style="height:90px"></div>
  `;

  // Trigger animations after browser has painted the new DOM
  requestAnimationFrame(() => requestAnimationFrame(_animateDashboard));
}
