/**
 * report.js
 * Renders the design report screen (S5).
 *
 * Scores are derived from live APP state (same logic as dashboard.js).
 * On first visit after analysis, generates a Claude narrative summary.
 * PDF export uses window.print() with a dedicated @media print stylesheet.
 *
 * Stage 3 additions:
 *   - Site strip now surfaces growing months, GBIF biodiversity, land use,
 *     solar seasonality, frost/drought month counts.
 *   - Calendar export generates a real .ics file from personalised tasks.
 *   - Share link encodes APP snapshot as a base64 URL param.
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

// ── Site strip ─────────────────────────────────────────────────────────

function _renderSiteStrip(sp, p, s) {
  const el = document.getElementById('reportSiteStrip');
  if (!el) return;

  // ── Core site items (always shown) ──
  const items = [
    { icon: '🌡️', label: 'Climate',   val: sp?.climate  || p.climate  || '–' },
    { icon: '🌿',  label: 'Hardiness', val: p.hardiness || (sp?.hardiness?.zone ? `Zone ${sp.hardiness.zone}` : '–') },
    { icon: '🌧️', label: 'Rainfall',  val: sp?.rainfall || p.rainfall || '–' },
    { icon: '❄️',  label: 'Frost',     val: sp?.frost    || p.frost    || '–' },
    { icon: '💧',  label: 'Root Zone', val: sp?.water_balance || (sp?.gwetroot != null ? `${sp.gwetroot} wetness` : '–') },
    { icon: '☀️',  label: 'Solar',     val: sp?.solar_kwh_day ? `${sp.solar_kwh_day} kWh/m²/d` : '–' },
    { icon: '🪱',  label: 'Soil',      val: p.soil || sp?.soil_desc || '–' },
    { icon: '📐',  label: 'Elevation', val: sp?.elevation ? `${Math.round(sp.elevation)}m asl` : (p.slope || '–') },
  ];

  // ── Stage 3 additions (shown when data is available) ──

  // Growing season from Open-Meteo climate normals
  if (sp?.growing_months?.length) {
    const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const names = sp.growing_months.map(m => MONTH_SHORT[m - 1]).join(', ');
    items.push({ icon: '🌱', label: 'Growing Season', val: `${names} (${sp.growing_months.length} months)` });
  }

  // Solar seasonality — best and worst months from NASA POWER
  if (sp?.solar_peak_month && sp?.solar_low_month) {
    items.push({
      icon: '🌞', label: 'Solar Peak/Low',
      val: `${sp.solar_peak_month} ${sp.solar_peak_kwh ? sp.solar_peak_kwh + ' kWh' : ''} / ${sp.solar_low_month} ${sp.solar_low_kwh ? sp.solar_low_kwh + ' kWh' : ''}`.trim(),
    });
  }

  // GBIF biodiversity counts
  if (sp?.gbif_plant_count != null || sp?.gbif_animal_count != null) {
    const parts = [];
    if (sp.gbif_plant_count != null) parts.push(`${sp.gbif_plant_count.toLocaleString()} plant spp.`);
    if (sp.gbif_animal_count != null) parts.push(`${sp.gbif_animal_count.toLocaleString()} animal spp.`);
    items.push({ icon: '🦋', label: 'Biodiversity (5km)', val: parts.join(' · ') || '–' });
  }

  // Land use context from OpenStreetMap
  if (sp?.land_use_summary) {
    items.push({ icon: '🗺️', label: 'Land Context', val: sp.land_use_summary });
  } else if (sp?.land_use?.length) {
    items.push({ icon: '🗺️', label: 'Land Context', val: sp.land_use.slice(0, 3).join(', ') });
  }

  // Drought risk
  if (sp?.drought_months?.length) {
    const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const names = sp.drought_months.map(m => MONTH_SHORT[m - 1]).join(', ');
    items.push({ icon: '🏜️', label: 'Drought Risk', val: `${names}`, highlight: 'warn' });
  }

  // Frost months (beyond the brief "Frost" string)
  if (sp?.frost_months?.length) {
    const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const names = sp.frost_months.map(m => MONTH_SHORT[m - 1]).join(', ');
    items.push({ icon: '🧊', label: 'Frost Months', val: names, highlight: 'cool' });
  }

  el.innerHTML = items.map(i => `
    <div class="rss-item${i.highlight ? ' rss-' + i.highlight : ''}">
      <span class="rss-icon">${i.icon}</span>
      <div class="rss-info">
        <div class="rss-label">${i.label}</div>
        <div class="rss-val">${i.val}</div>
      </div>
    </div>`).join('');
}

// ── Narrative ──────────────────────────────────────────────────────────

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
    shareLink.addEventListener('click', _exportShareLink);
  }
  if (exportCalendar && !exportCalendar.dataset.wired) {
    exportCalendar.dataset.wired = 'true';
    exportCalendar.addEventListener('click', _exportCalendarICS);
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

// ── iCal (.ics) export ─────────────────────────────────────────────────
//
// Generates a Year 1 maintenance calendar from ALL personalised tasks
// across all four seasons. Each task becomes a single-day VEVENT placed
// at the start of its season's first month.

const SEASON_START_DATES = {
  // Northern Hemisphere
  nh: { spring: '0301', summer: '0601', autumn: '0901', winter: '1201' },
  // Southern Hemisphere
  sh: { spring: '0901', summer: '1201', autumn: '0301', winter: '0601' },
};

function _isNorthernHemisphere() {
  const addr = (APP.property.address || '').toLowerCase();
  if (/australia|new zealand|south africa|argentina|chile|brazil|uruguay|peru|bolivia|ecuador|colombia|venezuela|kenya|tanzania|mozambique|zimbabwe|zambia|madagascar/i.test(addr)) {
    return false;
  }
  return true;
}

function _icsEscape(str) {
  return (str || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function _icsDate(yearStr, monthDay) {
  // yearStr = '2025', monthDay = '0301' → '20250301'
  return yearStr + monthDay;
}

function _exportCalendarICS() {
  // Dynamically import ALL_TASKS equivalent — we replicate the filter logic here
  // to avoid a circular dependency. We pull from window globals set by calendar.js
  // if available, otherwise fall back to a simpler version.
  const opps = APP.selectedOpps || new Set();
  const sp   = APP.siteProfile;

  // Import ALL_TASKS — we need access to the task list. Since calendar.js is an
  // ES module without a runtime export of ALL_TASKS, we reconstruct the filtered
  // list via a lightweight inline approach.
  _buildAndDownloadICS(opps, sp);
}

function _buildAndDownloadICS(opps, sp) {
  const hemisphere = _isNorthernHemisphere() ? 'nh' : 'sh';
  const dates      = SEASON_START_DATES[hemisphere];
  const year       = String(new Date().getFullYear());
  const nextYear   = String(new Date().getFullYear() + 1);

  // Inline task list (matches calendar.js ALL_TASKS — filter logic replicated)
  const RAW_TASKS = [
    // SPRING
    { id: 'sp-seeds',      season: 'spring', t: 'Sow annual seeds',                d: 'Tomatoes, cucumbers, squash, beans — start under cover or direct sow when soil reaches 12°C.', time: '2 hrs' },
    { id: 'sp-swales',     season: 'spring', t: 'Inspect swale integrity',          d: 'Check berms for winter erosion damage. Repair any breaches before the wet season ends.', time: '1 hr', requires: 'swales' },
    { id: 'sp-comfrey',    season: 'spring', t: 'First comfrey chop',               d: 'Cut comfrey to 10cm when plants reach 40cm tall. Leave all material as mulch around fruit trees.', time: '1.5 hrs' },
    { id: 'sp-prune',      season: 'spring', t: 'Fruit tree pruning',               d: 'Shape young food forest trees for open-centre form. Never remove more than 25% of canopy in one season.', time: '3 hrs', requires: 'food_forest' },
    { id: 'sp-microbes',   season: 'spring', t: 'Apply microbial solution',         d: 'Mix JMS 1:100 with water. Drench all garden beds and food forest floor to kick-start spring soil biology.', time: '2 hrs' },
    { id: 'sp-pond',       season: 'spring', t: 'Pond spring clean',                d: 'Remove winter debris and check inlet/overflow. Inspect for bank erosion.', time: '1.5 hrs', requires: 'pond' },
    { id: 'sp-windbreak',  season: 'spring', t: 'Plant windbreak gaps',             d: 'Fill any gaps in windbreak with fast-growing pioneer species. Water new plantings weekly.', time: '2 hrs', requires: 'windbreak' },
    { id: 'sp-garden',     season: 'spring', t: 'Prepare kitchen garden beds',      d: 'Add 5cm of compost to all beds before sowing. Direct sow salad crops as overnight temps stay above 5°C.', time: '2 hrs', requires: 'kitchen_garden' },
    { id: 'sp-soil-rehab', season: 'spring', t: 'Inoculate compacted zones',        d: 'Apply mycorrhizal inoculant to soil rehabilitation areas. Broadcast pioneer cover crop mix.', time: '1.5 hrs', requires: 'soil_rehab' },
    { id: 'sp-meds',       season: 'spring', t: 'Divide and replant medicinals',    d: 'Divide established clumps of comfrey, yarrow, and valerian before growth surges.', time: '1 hr', requires: 'medicinals' },
    // SUMMER
    { id: 'su-irrigation', season: 'summer', t: 'Irrigation check',                d: 'Confirm gravity drip lines are clear. Check pond or tank level — should be near full going into dry season.', time: '30 min' },
    { id: 'su-succession', season: 'summer', t: 'Succession sow fast crops',        d: 'Direct sow lettuce, radish, and spinach every 3 weeks. Shade cloth over beds in peak heat over 35°C.', time: '1 hr', requires: 'kitchen_garden' },
    { id: 'su-mulch',      season: 'summer', t: 'Mulch heavily before peak heat',   d: 'Top up mulch to 15cm on all beds and food forest floor before peak summer.', time: '2 hrs' },
    { id: 'su-pond',       season: 'summer', t: 'Pond maintenance',                 d: 'Remove excess aquatic plants to keep 40–60% open water. Check spillway is clear before storm events.', time: '1 hr', requires: 'pond' },
    { id: 'su-harvest',    season: 'summer', t: 'Peak harvest and preservation',    d: 'Daily harvest from kitchen garden. Preserve surplus by drying, fermenting, or freezing.', time: '20 min/day' },
    { id: 'su-swales',     season: 'summer', t: 'Summer swale monitor',             d: 'Check swale berms for cracking in heat. Water any newly planted swale species.', time: '30 min', requires: 'swales' },
    { id: 'su-ff-water',   season: 'summer', t: 'Deep water young food forest trees', d: 'Young trees need one deep soak per week in summer. Apply 20+ litres per tree to roots.', time: '1 hr', requires: 'food_forest' },
    // AUTUMN
    { id: 'au-harvest',    season: 'autumn', t: 'Nut and fruit harvest',            d: 'Hazel, apple, pear, and quince harvest window. Store in a cool dry location.', time: '4 hrs' },
    { id: 'au-winter-greens', season: 'autumn', t: 'Sow winter greens and garlic', d: 'Kale, chard, spinach, and garlic all go in now. Get garlic in before first frost.', time: '1.5 hrs' },
    { id: 'au-chop',       season: 'autumn', t: 'Chop-and-drop pioneer species',   d: 'Cut nitrogen-fixing shrubs and dynamic accumulators to knee height. Leave all cut material as surface mulch.', time: '2 hrs' },
    { id: 'au-ferment',    season: 'autumn', t: 'Start liquid fertiliser barrel',  d: 'Fill a barrel with wild grasses and crop residues. Ferment 3+ months for a powerful soil drench.', time: '1 hr' },
    { id: 'au-earthworks', season: 'autumn', t: 'Earthwork inspection before winter', d: 'Check all swale overflows, pond spillway, and inlet channels before winter rains arrive.', time: '1.5 hrs', requires: 'swales' },
    { id: 'au-pond-prep',  season: 'autumn', t: 'Prepare pond for winter inflow',  d: 'Clear overflow channel of any leaf build-up. Check dam face for any cracks before it fills.', time: '1 hr', requires: 'pond' },
    { id: 'au-soil-rehab2', season: 'autumn', t: 'Autumn soil biology application', d: 'Apply compost tea or worm castings to soil rehabilitation zones. Autumn moisture helps fungi colonise over winter.', time: '1.5 hrs', requires: 'soil_rehab' },
    { id: 'au-meds-harvest', season: 'autumn', t: 'Harvest and dry medicinal herbs', d: 'Final harvest of echinacea root, valerian root, and rosehips. Dry thoroughly before storing.', time: '2 hrs', requires: 'medicinals' },
    // WINTER
    { id: 'wi-trees',      season: 'winter', t: 'Tree planting season',            d: 'The best time to plant bare-root fruit and nut trees — soil is moist, trees are dormant.', time: '4 hrs' },
    { id: 'wi-design',     season: 'winter', t: 'Annual design review',            d: 'Review what worked this year. Update your Verdant plan. Order seeds and bare-root stock for spring.', time: '2 hrs' },
    { id: 'wi-microbes',   season: 'winter', t: 'Brew microbial solution',         d: 'Collect forest leaf mould. Brew JMS with boiled potato water, brown rice wash, and molasses.', time: '1 hr' },
    { id: 'wi-cover',      season: 'winter', t: 'Broadcast green manure',          d: 'Spread clover and phacelia seed mix on any bare soil. Protects against erosion, fixes nitrogen through winter.', time: '1 hr' },
    { id: 'wi-compost',    season: 'winter', t: 'Turn and check compost',          d: 'Turn bays to introduce oxygen. Add any tree prunings chipped to 2cm. Aim for 50% brown, 50% green.', time: '1 hr' },
    { id: 'wi-swale-plant', season: 'winter', t: 'Plant swale banks',             d: 'Plant the berms with deep-rooted species — comfrey, vetiver grass, or fruit trees.', time: '2 hrs', requires: 'swales' },
    { id: 'wi-ff-plant',   season: 'winter', t: 'Expand food forest with bare-root stock', d: 'Winter is the best time to add new canopy and sub-canopy trees.', time: '3 hrs', requires: 'food_forest' },
  ];

  // Filter tasks for this property
  const tasks = RAW_TASKS.filter(t => !t.requires || opps.has(t.requires));

  if (!tasks.length) {
    toast('Add systems on the Map to personalise your calendar first', '📅');
    return;
  }

  // Build iCal lines
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Verdant Regenerative Design//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${_icsEscape(APP.property.name || 'Verdant')} Maintenance Calendar`,
    'X-WR-TIMEZONE:UTC',
  ];

  const uid_suffix = `@verdant-${Date.now()}`;
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  tasks.forEach((task, idx) => {
    // Determine which year to use (winter straddles year boundary for NH)
    const useYear = (hemisphere === 'nh' && task.season === 'winter') ? nextYear : year;
    const dtStart = _icsDate(useYear, dates[task.season]);

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${task.id}-${idx}${uid_suffix}`);
    lines.push(`DTSTAMP:${now}Z`);
    lines.push(`DTSTART;VALUE=DATE:${dtStart}`);
    lines.push(`DTEND;VALUE=DATE:${dtStart}`);
    lines.push(`SUMMARY:🌿 ${_icsEscape(task.t)}`);
    lines.push(`DESCRIPTION:${_icsEscape(task.d + (task.time ? `\\n\\nTime estimate: ${task.time}` : ''))}`);
    lines.push(`CATEGORIES:Verdant,${task.season.charAt(0).toUpperCase() + task.season.slice(1)}`);
    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');

  const icsContent = lines.join('\r\n');
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${(APP.property.name || 'verdant').replace(/\s+/g, '_')}_maintenance_calendar.ics`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`Downloaded ${tasks.length} tasks as .ics`, '📅');
}

// ── Share link ─────────────────────────────────────────────────────────
//
// Encodes a read-only snapshot of the current APP state into a base64
// URL parameter. The recipient can open the link without any account.
// The snapshot is intentionally lightweight — no images, no blobs.

function _exportShareLink() {
  try {
    const snapshot = {
      v:  1, // schema version
      ts: Date.now(),
      property: APP.property,
      selectedOpps: [...(APP.selectedOpps || [])],
      addedPlants:  [...(APP.addedPlants  || [])],
      siteProfile: APP.siteProfile ? {
        climate:          APP.siteProfile.climate,
        rainfall:         APP.siteProfile.rainfall,
        frost:            APP.siteProfile.frost,
        water_balance:    APP.siteProfile.water_balance,
        soil_desc:        APP.siteProfile.soil_desc,
        elevation:        APP.siteProfile.elevation,
        solar_kwh_day:    APP.siteProfile.solar_kwh_day,
        growing_months:   APP.siteProfile.growing_months,
        frost_months:     APP.siteProfile.frost_months,
        drought_months:   APP.siteProfile.drought_months,
        gbif_plant_count: APP.siteProfile.gbif_plant_count,
        gbif_animal_count:APP.siteProfile.gbif_animal_count,
        land_use_summary: APP.siteProfile.land_use_summary,
        solar_peak_month: APP.siteProfile.solar_peak_month,
        solar_low_month:  APP.siteProfile.solar_low_month,
        solar_peak_kwh:   APP.siteProfile.solar_peak_kwh,
        solar_low_kwh:    APP.siteProfile.solar_low_kwh,
        hardiness:        APP.siteProfile.hardiness,
        rain_mm_year:     APP.siteProfile.rain_mm_year,
        temp_mean:        APP.siteProfile.temp_mean,
      } : null,
      plants:     (APP.plants    || []).slice(0, 30), // cap at 30 for URL size
      medicinals: (APP.medicinals || []).slice(0, 20),
      scores: {
        water:        APP.analysisRan ? _computeReportScores().water        : null,
        biodiversity: APP.analysisRan ? _computeReportScores().biodiversity : null,
        systems:      APP.analysisRan ? _computeReportScores().systems      : null,
        plants:       APP.analysisRan ? _computeReportScores().plants       : null,
      },
    };

    const json      = JSON.stringify(snapshot);
    const b64       = btoa(unescape(encodeURIComponent(json)));
    const shareUrl  = `${location.origin}${location.pathname}?share=${b64}`;

    // Try to copy to clipboard
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(shareUrl).then(() => {
        toast('Share link copied to clipboard!', '🔗');
      }).catch(() => {
        _fallbackCopyLink(shareUrl);
      });
    } else {
      _fallbackCopyLink(shareUrl);
    }
  } catch (e) {
    toast('Could not generate share link', '❌');
    console.error('[Verdant] Share link error:', e);
  }
}

function _fallbackCopyLink(url) {
  // Prompt with the URL as a fallback
  const shortened = url.length > 80 ? url.slice(0, 80) + '…' : url;
  toast('Link ready — see console for full URL', '🔗');
  console.info('[Verdant] Share link:\n' + url);
}

/** Call when analysis is re-run so narrative regenerates on next visit */
export function invalidateReportCache() {
  _cachedNarrative = null;
  _narrativeForAnalysisRun = false;
}
