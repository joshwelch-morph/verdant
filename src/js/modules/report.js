/**
 * report.js
 * Renders the design report screen (S5).
 *
 * Scores are derived from live APP state (same logic as dashboard.js).
 * On first visit after analysis, generates a Claude narrative summary.
 * PDF export uses window.print() with a dedicated @media print stylesheet.
 */

import { APP } from './state.js';
import { toast } from './ui.js';
import { generateReportNarrative } from './claude.js';

// Cache the narrative so we don't regenerate on every nav
let _cachedNarrative = null;
let _narrativeForAnalysisRun = false; // track if narrative was built after analysis

// ── Score helpers (mirrors dashboard.js logic) ─────────────────────────

function _computeReportScores() {
  const plants   = APP.plants   || [];
  const meds     = APP.medicinals || [];
  const wildlife = APP.wildlife  || {};
  const opps     = APP.selectedOpps;
  const goals    = APP.property.goals || [];

  // Soil health
  const layers = [...new Set(plants.map(p => p.layer).filter(Boolean))];
  const deepRoots = plants.filter(p => (p.rootDepth || '').match(/deep|tap/i)).length;
  const soilPct = Math.min(100, 20
    + layers.length * 12
    + deepRoots * 6
    + (opps.has('soil_rehab') ? 20 : 0)
    + (goals.includes('soil building') ? 10 : 0));

  // Water retention
  const waterOpps = ['swales', 'pond', 'rain_garden', 'water_harvesting']
    .filter(k => opps.has(k)).length;
  const waterPct = Math.min(100, 25 + waterOpps * 18 + deepRoots * 5
    + (goals.includes('water security') ? 15 : 0));

  // Pollinator activity
  const pollinatorCount = (wildlife.pollinators || []).length;
  const pollPlants = plants.filter(p => (p.roles || []).some(r => /pollinat/i.test(r))).length;
  const pollinatorRaw = Math.min(100, pollinatorCount * 12 + pollPlants * 8);

  // Solar potential — use real NASA data if available
  const sp = APP.siteProfile;
  const solarKw = sp?.solar_kw ?? (parseFloat(APP.property.size) * 1.4 || 5.8);
  const solarPct = Math.min(100, Math.round((solarKw / 12) * 100));

  // Biodiversity
  const biodiversityPct = Math.min(100, 20
    + plants.length * 4
    + meds.length * 3
    + pollinatorCount * 4
    + (wildlife.pestPredators || []).length * 3);

  return {
    soil:         soilPct,
    water:        waterPct,
    pollinator:   pollinatorRaw,
    solar:        solarPct,
    biodiversity: biodiversityPct,
    systems:      opps.size,
    plants:       plants.length,
    meds:         meds.length,
    solarKw,
    layers:       layers.length,
    pollinatorCount,
  };
}

// ── Score ring SVG ─────────────────────────────────────────────────────

function _ringHTML(pct, color, size = 52) {
  const r = (size / 2) - 5;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct / 100);
  const cx = size / 2, cy = size / 2;
  return `
  <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform:rotate(-90deg)">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(0,0,0,0.07)" stroke-width="5"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="5"
      stroke-linecap="round"
      stroke-dasharray="${circ.toFixed(1)}"
      stroke-dashoffset="${offset.toFixed(1)}"
      style="transition:stroke-dashoffset 1s cubic-bezier(.4,0,.2,1)"/>
  </svg>`;
}

// ── Render ─────────────────────────────────────────────────────────────

export function renderReport() {
  const p  = APP.property;
  const sp = APP.siteProfile;
  const s  = _computeReportScores();
  const hasData = APP.analysisRan;

  // ── Print date ──
  const phDate = document.getElementById('ph-date');
  if (phDate) phDate.textContent = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

  // ── Header ──
  const titleEl = document.getElementById('rh-title');
  const subEl   = document.getElementById('rh-sub');
  if (titleEl) titleEl.textContent = p.name || 'Your Property';
  if (subEl) {
    const loc  = p.address || 'Location not set';
    const date = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
    subEl.textContent = `Regenerative Design · ${loc} · ${date}`;
  }

  // ── Score cards ──
  _setScore('rs-w',  hasData ? s.water        + '%' : '–',  hasData ? s.water        : 0, '#5BA3C9');
  _setScore('rs-b',  hasData ? s.biodiversity + '%' : '–',  hasData ? s.biodiversity : 0, '#7EB67A');
  _setScore('rs-s',  s.systems || '–',                      Math.min(100, s.systems * 16), '#DDA15E');
  _setScore('rs-p',  s.plants  || '–',                      Math.min(100, s.plants * 8),   '#A3B18A');

  // ── Site conditions strip ──
  _renderSiteStrip(sp, p, s);

  // ── Summary / narrative ──
  _renderNarrative(hasData);

  // ── Export buttons ──
  _wireExportButtons();
}

function _setScore(id, text, pct, color) {
  const cell = document.getElementById(id);
  if (!cell) return;
  cell.innerHTML = `
    <div class="rs-ring">${_ringHTML(pct, color)}</div>
    <div class="rs-num">${text}</div>`;
}

function _renderSiteStrip(sp, p, s) {
  const el = document.getElementById('reportSiteStrip');
  if (!el) return;
  const items = [
    { icon: '🌡️', label: 'Climate',   val: sp?.climate  || p.climate  || '–' },
    { icon: '🌧️', label: 'Rainfall',  val: sp?.rainfall || p.rainfall || '–' },
    { icon: '❄️',  label: 'Frost',     val: sp?.frost    || p.frost    || '–' },
    { icon: '☀️',  label: 'Solar',     val: sp?.solar_kwh_day ? `${sp.solar_kwh_day} kWh/m²/d` : '–' },
    { icon: '🪱',  label: 'Soil',      val: p.soil || sp?.soil_desc || '–' },
    { icon: '📐',  label: 'Elevation', val: sp?.elevation ? `${Math.round(sp.elevation)}m asl` : (p.slope || '–') },
  ];
  el.innerHTML = items.map(i => `
    <div class="rss-item">
      <span class="rss-icon">${i.icon}</span>
      <div class="rss-info">
        <div class="rss-label">${i.label}</div>
        <div class="rss-val">${i.val}</div>
      </div>
    </div>`).join('');
}

async function _renderNarrative(hasData) {
  const el = document.getElementById('reportSummary');
  if (!el) return;

  if (!hasData) {
    el.innerHTML = `<p class="report-placeholder">Complete the plant analysis on the Plants screen to generate your personalised property narrative.</p>`;
    return;
  }

  // If we already have a cached narrative from this analysis run, show it
  if (_cachedNarrative && _narrativeForAnalysisRun) {
    el.innerHTML = _cachedNarrative;
    return;
  }

  // Show loading state
  el.innerHTML = `<p class="report-generating"><span class="rg-dot">●</span><span class="rg-dot">●</span><span class="rg-dot">●</span> Generating your property narrative…</p>`;

  try {
    const html = await generateReportNarrative();
    _cachedNarrative = html;
    _narrativeForAnalysisRun = true;
    el.innerHTML = html;
  } catch (e) {
    // Fallback to structured summary if API fails
    const p = APP.property;
    const plants = APP.plants || [];
    const opps = [...APP.selectedOpps];
    _cachedNarrative = `
      <p><strong>${p.name}</strong> — ${p.size} at ${p.address}. Goals: ${p.goals.join(', ') || 'regenerative land stewardship'}.</p>
      <p><strong>Selected systems (${opps.length}):</strong> ${opps.join(', ') || 'None selected'}</p>
      <p><strong>Plants in plan (${APP.addedPlants.size}):</strong> ${[...APP.addedPlants].join(', ') || 'None added yet'}</p>`;
    _narrativeForAnalysisRun = true;
    el.innerHTML = _cachedNarrative;
  }
}

// ── Export buttons ─────────────────────────────────────────────────────

function _wireExportButtons() {
  const exportPdf      = document.getElementById('exportPdf');
  const exportPlanting = document.getElementById('exportPlanting');
  const shareLink      = document.getElementById('shareLink');
  const exportCalendar = document.getElementById('exportCalendar');

  if (exportPdf && !exportPdf.dataset.wired) {
    exportPdf.dataset.wired = 'true';
    exportPdf.addEventListener('click', _printReport);
  }
  if (exportPlanting && !exportPlanting.dataset.wired) {
    exportPlanting.dataset.wired = 'true';
    exportPlanting.addEventListener('click', _exportPlantingPlan);
  }
  if (shareLink && !shareLink.dataset.wired) {
    shareLink.dataset.wired = 'true';
    shareLink.addEventListener('click', () => toast('Share link coming soon', '🔗'));
  }
  if (exportCalendar && !exportCalendar.dataset.wired) {
    exportCalendar.dataset.wired = 'true';
    exportCalendar.addEventListener('click', () => toast('Calendar export coming soon', '📅'));
  }
}

function _printReport() {
  // Add print class to body so @media print styles kick in
  document.body.classList.add('printing-report');
  window.print();
  setTimeout(() => document.body.classList.remove('printing-report'), 1000);
}

function _exportPlantingPlan() {
  const plants = APP.plants || [];
  const added  = APP.addedPlants;
  if (!plants.length) {
    toast('Run plant analysis first', '🌱');
    return;
  }

  // Build a simple CSV
  const header = 'Name,Latin,Layer,Height,Root Depth,Yield,Maintenance,Roles,Guild Partners';
  const rows = plants
    .filter(pl => added.size === 0 || added.has(pl.name))
    .map(pl => [
      pl.name,
      pl.latin || '',
      pl.layer || '',
      pl.height || '',
      pl.rootDepth || '',
      pl.yield || '',
      pl.maintenanceLevel || '',
      (pl.roles || []).join('; '),
      (pl.guild || []).join('; '),
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${(APP.property.name || 'verdant').replace(/\s+/g, '_')}_planting_plan.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Planting plan downloaded', '🌿');
}

/** Call when analysis is re-run so narrative regenerates on next visit */
export function invalidateReportCache() {
  _cachedNarrative = null;
  _narrativeForAnalysisRun = false;
}
