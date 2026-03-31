/**
 * calendar.js
 * Hemisphere-aware, personalised seasonal maintenance calendar (S4).
 *
 * Tasks are filtered and enriched from real APP state:
 *   - selectedOpps  → include system-specific tasks only when relevant
 *   - drought_months → flag irrigation tasks with urgency
 *   - frost_months   → flag frost-protection tasks
 *   - growing_months → annotate which months are peak growing for this property
 *   - plants         → add harvest tasks for added plants
 *
 * Done state is persisted in localStorage under `verdant_cal_done_v1`.
 */

import { APP } from './state.js';

// ── Done state persistence ─────────────────────────────────────────────

const DONE_KEY = 'verdant_cal_done_v1';

function _loadDone() {
  try {
    return new Set(JSON.parse(localStorage.getItem(DONE_KEY) || '[]'));
  } catch { return new Set(); }
}

function _saveDone(set) {
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify([...set]));
  } catch { /* silent */ }
}

let _doneSet = _loadDone();

// ── Task definitions ───────────────────────────────────────────────────
//
// Each task has:
//   id        — unique stable key (used for done-state)
//   ico       — emoji
//   t         — title
//   d         — description
//   time      — time estimate string
//   requires  — optional: one of APP.selectedOpps keys that must be present
//   season    — 'spring'|'summer'|'autumn'|'winter'
//   priority  — 'high'|'normal' (high = shown first)
//   tag       — optional category string

const ALL_TASKS = [
  // ── SPRING ──────────────────────────────────────────────────────────
  { id: 'sp-seeds',    season: 'spring', ico: '🌱', priority: 'high',
    t: 'Sow annual seeds',
    d: 'Tomatoes, cucumbers, squash, beans — start under cover or direct sow when soil reaches 12°C.',
    time: '2 hrs', tag: 'food' },

  { id: 'sp-swales',   season: 'spring', ico: '💧', priority: 'high', requires: 'swales',
    t: 'Inspect swale integrity',
    d: 'Check berms for winter erosion damage. Repair any breaches before the wet season ends. Clear any debris from overflow points.',
    time: '1 hr', tag: 'water' },

  { id: 'sp-comfrey',  season: 'spring', ico: '🌿', priority: 'normal',
    t: 'First comfrey chop',
    d: 'Cut comfrey to 10cm when plants reach 40cm tall. Leave all material as mulch around fruit trees — it breaks down fast and feeds the root zone.',
    time: '1.5 hrs', tag: 'soil' },

  { id: 'sp-prune',    season: 'spring', ico: '🍎', priority: 'normal', requires: 'food_forest',
    t: 'Fruit tree pruning',
    d: 'Shape young food forest trees for open-centre form. Never remove more than 25% of canopy in one season.',
    time: '3 hrs', tag: 'food' },

  { id: 'sp-microbes', season: 'spring', ico: '🪱', priority: 'normal',
    t: 'Apply microbial solution',
    d: 'Mix JMS (Korean natural farming inputs) 1:100 with water. Drench all garden beds and food forest floor to kick-start spring soil biology.',
    time: '2 hrs', tag: 'soil' },

  { id: 'sp-pond',     season: 'spring', ico: '🌊', priority: 'normal', requires: 'pond',
    t: 'Pond spring clean',
    d: 'Remove winter debris and check inlet/overflow. Inspect for bank erosion. Introduce or check aquatic plants are establishing.',
    time: '1.5 hrs', tag: 'water' },

  { id: 'sp-windbreak', season: 'spring', ico: '🌾', priority: 'normal', requires: 'windbreak',
    t: 'Plant windbreak gaps',
    d: 'Fill any gaps in windbreak with fast-growing pioneer species. Water new plantings weekly through dry spring periods.',
    time: '2 hrs', tag: 'soil' },

  { id: 'sp-garden',   season: 'spring', ico: '🥬', priority: 'high', requires: 'kitchen_garden',
    t: 'Prepare kitchen garden beds',
    d: 'Add 5cm of compost to all beds before sowing. Break up any surface crusting. Direct sow salad crops as soon as overnight temps stay above 5°C.',
    time: '2 hrs', tag: 'food' },

  { id: 'sp-soil-rehab', season: 'spring', ico: '🪸', priority: 'normal', requires: 'soil_rehab',
    t: 'Inoculate compacted zones',
    d: 'Apply mycorrhizal inoculant to areas under soil rehabilitation. Broadcast fast-growing pioneer cover crop mix to protect bare soil surface.',
    time: '1.5 hrs', tag: 'soil' },

  { id: 'sp-meds',     season: 'spring', ico: '🌸', priority: 'normal', requires: 'medicinals',
    t: 'Divide and replant medicinals',
    d: 'Divide established clumps of comfrey, yarrow, and valerian before growth surges. Replant divisions across the design zones.',
    time: '1 hr', tag: 'food' },

  // ── SUMMER ──────────────────────────────────────────────────────────
  { id: 'su-irrigation', season: 'summer', ico: '💧', priority: 'high',
    t: 'Irrigation check',
    d: 'Confirm gravity drip lines are clear and delivering to kitchen garden. Check pond or tank level — should be near full going into dry season.',
    time: '30 min', tag: 'water' },

  { id: 'su-succession', season: 'summer', ico: '🥬', priority: 'high', requires: 'kitchen_garden',
    t: 'Succession sow fast crops',
    d: 'Direct sow lettuce, radish, and spinach every 3 weeks for continuous harvest. Shade cloth over beds in peak heat over 35°C.',
    time: '1 hr', tag: 'food' },

  { id: 'su-mulch',    season: 'summer', ico: '☀️', priority: 'high',
    t: 'Mulch heavily before peak heat',
    d: 'Top up mulch to 15cm on all beds and food forest floor before peak summer. Prevents moisture loss and feeds soil biology through summer.',
    time: '2 hrs', tag: 'soil' },

  { id: 'su-pond',     season: 'summer', ico: '🌊', priority: 'normal', requires: 'pond',
    t: 'Pond maintenance',
    d: 'Remove excess aquatic plants to keep 40–60% open water. Check spillway is clear before any storm events.',
    time: '1 hr', tag: 'water' },

  { id: 'su-harvest',  season: 'summer', ico: '🍅', priority: 'high',
    t: 'Peak harvest and preservation',
    d: 'Daily harvest from kitchen garden at this time of year. Preserve surplus by drying, fermenting, or freezing. Record yields for next season planning.',
    time: '20 min/day', tag: 'food' },

  { id: 'su-swales',   season: 'summer', ico: '💧', priority: 'normal', requires: 'swales',
    t: 'Summer swale monitor',
    d: 'Check swale berms for cracking in heat. Water any newly planted swale species to establish roots before next dry season.',
    time: '30 min', tag: 'water' },

  { id: 'su-solar',    season: 'summer', ico: '☀️', priority: 'normal', requires: 'solar_zone',
    t: 'Clear solar zone of shading growth',
    d: 'Trim any vegetation that has grown into planned solar zone. This is the highest-yield season — keep the zone clear.',
    time: '1 hr', tag: 'solar' },

  { id: 'su-ff-water', season: 'summer', ico: '🌳', priority: 'normal', requires: 'food_forest',
    t: 'Deep water young food forest trees',
    d: 'Young trees need one deep soak per week in summer rather than frequent shallow watering. Apply 20+ litres per tree to roots.',
    time: '1 hr', tag: 'food' },

  // ── AUTUMN ──────────────────────────────────────────────────────────
  { id: 'au-harvest',  season: 'autumn', ico: '🌰', priority: 'high',
    t: 'Nut and fruit harvest',
    d: 'Hazel, apple, pear, and quince harvest window. Store in a cool dry location. Press surplus apples into cider or juice for winter.',
    time: '4 hrs', tag: 'food' },

  { id: 'au-winter-greens', season: 'autumn', ico: '🌱', priority: 'high',
    t: 'Sow winter greens and garlic',
    d: 'Kale, chard, spinach, and garlic all go in now. Get garlic in before first frost — it needs cold to trigger bulb splitting.',
    time: '1.5 hrs', tag: 'food' },

  { id: 'au-chop',    season: 'autumn', ico: '✂️', priority: 'normal',
    t: 'Chop-and-drop pioneer species',
    d: 'Cut nitrogen-fixing shrubs and dynamic accumulators to knee height. Leave all cut material as surface mulch — do not remove or compost.',
    time: '2 hrs', tag: 'soil' },

  { id: 'au-ferment', season: 'autumn', ico: '🪸', priority: 'normal',
    t: 'Start liquid fertiliser barrel',
    d: 'Fill a barrel with wild grasses and crop residues. Submerge with a weight, seal loosely, and ferment 3+ months for a powerful soil drench.',
    time: '1 hr', tag: 'soil' },

  { id: 'au-earthworks', season: 'autumn', ico: '💧', priority: 'high', requires: 'swales',
    t: 'Earthwork inspection before winter',
    d: 'Check all swale overflows, pond spillway, and inlet channels before winter rains arrive. One afternoon now prevents months of repair.',
    time: '1.5 hrs', tag: 'water' },

  { id: 'au-pond-prep', season: 'autumn', ico: '🌊', priority: 'normal', requires: 'pond',
    t: 'Prepare pond for winter inflow',
    d: 'Clear overflow channel of any leaf build-up. Check dam face for any cracks before it fills. Remove tender aquatic plants.',
    time: '1 hr', tag: 'water' },

  { id: 'au-soil-rehab2', season: 'autumn', ico: '🪱', priority: 'normal', requires: 'soil_rehab',
    t: 'Autumn soil biology application',
    d: 'Apply compost tea or worm castings to soil rehabilitation zones. Autumn moisture helps fungi colonise over winter.',
    time: '1.5 hrs', tag: 'soil' },

  { id: 'au-meds-harvest', season: 'autumn', ico: '🌿', priority: 'normal', requires: 'medicinals',
    t: 'Harvest and dry medicinal herbs',
    d: 'Final harvest of echinacea root, valerian root, and rosehips. Dry thoroughly before storing. Save seeds from best plants.',
    time: '2 hrs', tag: 'food' },

  // ── WINTER ──────────────────────────────────────────────────────────
  { id: 'wi-trees',   season: 'winter', ico: '🌳', priority: 'high',
    t: 'Tree planting season',
    d: 'The best time to plant bare-root fruit and nut trees — soil is moist, trees are dormant. Plant each tree with comfrey companions at the drip line.',
    time: '4 hrs', tag: 'food' },

  { id: 'wi-design',  season: 'winter', ico: '📐', priority: 'normal',
    t: 'Annual design review',
    d: 'Review what worked this year. Update your Verdant plan. Note which systems need expanding. Order seeds and bare-root stock for spring.',
    time: '2 hrs', tag: 'planning' },

  { id: 'wi-microbes', season: 'winter', ico: '🍄', priority: 'normal',
    t: 'Brew microbial solution',
    d: 'Collect forest leaf mould. Brew JMS with boiled potato water, brown rice wash, and molasses. Ready in 48–72 hrs when actively bubbling.',
    time: '1 hr', tag: 'soil' },

  { id: 'wi-cover',  season: 'winter', ico: '🌿', priority: 'high',
    t: 'Broadcast green manure',
    d: 'Spread clover and phacelia seed mix on any bare soil. Protects against erosion, fixes nitrogen through winter, and feeds spring pollinators.',
    time: '1 hr', tag: 'soil' },

  { id: 'wi-compost', season: 'winter', ico: '♻️', priority: 'normal',
    t: 'Turn and check compost',
    d: 'Winter is slow for decomposition but turn bays to introduce oxygen. Add any tree prunings chipped to 2cm. Aim for 50% brown, 50% green.',
    time: '1 hr', tag: 'soil' },

  { id: 'wi-swale-plant', season: 'winter', ico: '💧', priority: 'normal', requires: 'swales',
    t: 'Plant swale banks',
    d: 'Plant the berms with deep-rooted species — comfrey, vetiver grass, or fruit trees. Winter planting means roots establish before summer stress.',
    time: '2 hrs', tag: 'water' },

  { id: 'wi-ff-plant', season: 'winter', ico: '🍎', priority: 'high', requires: 'food_forest',
    t: 'Expand food forest with bare-root stock',
    d: 'Winter is the best time to add new canopy and sub-canopy trees. Order bare-root ahead of the season for best selection and price.',
    time: '3 hrs', tag: 'food' },
];

// ── Season detection ───────────────────────────────────────────────────

function _isNorthernHemisphere() {
  const addr = (APP.property.address || '').toLowerCase();
  if (/australia|new zealand|south africa|argentina|chile|brazil|uruguay|peru|bolivia|paraguay|ecuador|colombia|venezuela|kenya|tanzania|mozambique|zimbabwe|zambia|madagascar/i.test(addr)) {
    return false;
  }
  return true;
}

// Northern Hemisphere: spring=Mar–May, summer=Jun–Aug, autumn=Sep–Nov, winter=Dec–Feb
const NH_MONTHS = {
  spring: ['March', 'April', 'May'],
  summer: ['June', 'July', 'August'],
  autumn: ['September', 'October', 'November'],
  winter: ['December', 'January', 'February'],
};

// Southern Hemisphere: seasons are 6 months offset
const SH_MONTHS = {
  spring: ['September', 'October', 'November'],
  summer: ['December', 'January', 'February'],
  autumn: ['March', 'April', 'May'],
  winter: ['June', 'July', 'August'],
};

/**
 * Detect the current calendar season for this property's hemisphere.
 */
function _currentSeason() {
  const month = new Date().getMonth() + 1; // 1–12
  const isNH = _isNorthernHemisphere();
  if (isNH) {
    if (month >= 3 && month <= 5)  return 'spring';
    if (month >= 6 && month <= 8)  return 'summer';
    if (month >= 9 && month <= 11) return 'autumn';
    return 'winter';
  } else {
    if (month >= 9 && month <= 11) return 'spring';
    if (month === 12 || month <= 2) return 'summer';
    if (month >= 3 && month <= 5)  return 'autumn';
    return 'winter';
  }
}

// ── Task personalisation ───────────────────────────────────────────────

/**
 * Get tasks for a season, filtered and enriched by APP state.
 */
function _getTasksForSeason(season) {
  const opps = APP.selectedOpps || new Set();
  const sp = APP.siteProfile;

  return ALL_TASKS.filter(t => {
    if (t.season !== season) return false;
    // If task requires a specific system, only show if user has it
    if (t.requires && !opps.has(t.requires)) return false;
    return true;
  }).map(task => {
    // Enrich tasks with property-specific context
    let enriched = { ...task };

    // Flag irrigation tasks as high priority during drought months
    if (task.tag === 'water' && sp?.drought_months?.length) {
      const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const droughtNames = sp.drought_months.map(m => MONTH_ABBR[m - 1]);
      const seasonMonthNums = _getSeasonMonthNums(season);
      const droughtOverlap = sp.drought_months.filter(m => seasonMonthNums.includes(m));
      if (droughtOverlap.length > 0) {
        enriched.priority = 'high';
        enriched.alert = `⚠️ Drought risk this season (${droughtNames.filter((_, i) => seasonMonthNums.includes(sp.drought_months[i])).join(', ')})`;
      }
    }

    // Flag frost tasks during frost months
    if (sp?.frost_months?.length && (task.id.includes('prune') || task.id.includes('seeds') || task.id.includes('garden'))) {
      const seasonMonthNums = _getSeasonMonthNums(season);
      const frostOverlap = sp.frost_months.filter(m => seasonMonthNums.includes(m));
      if (frostOverlap.length > 0) {
        const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        enriched.alert = `🧊 Frost risk — wait for ${MONTH_ABBR[(Math.max(...frostOverlap) % 12)]} to pass`;
      }
    }

    return enriched;
  })
  // Sort: high priority first, then by done state (undone first)
  .sort((a, b) => {
    const aDone = _doneSet.has(a.id) ? 1 : 0;
    const bDone = _doneSet.has(b.id) ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    if (a.priority === 'high' && b.priority !== 'high') return -1;
    if (b.priority === 'high' && a.priority !== 'high') return 1;
    return 0;
  });
}

function _getSeasonMonthNums(season) {
  // Returns 1-based month numbers for the season in this hemisphere
  const isNH = _isNorthernHemisphere();
  const MAP = isNH
    ? { spring: [3,4,5], summer: [6,7,8], autumn: [9,10,11], winter: [12,1,2] }
    : { spring: [9,10,11], summer: [12,1,2], autumn: [3,4,5], winter: [6,7,8] };
  return MAP[season] || [];
}

// ── Growing month annotations ──────────────────────────────────────────

/**
 * Returns a small annotation if this month is a peak growing month for the property.
 */
function _growingAnnotation(monthName) {
  const sp = APP.siteProfile;
  if (!sp?.growing_months?.length) return '';
  const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  // Find 1-based month number from full name
  const idx = MONTH_FULL.indexOf(monthName);
  if (idx === -1) return '';
  const monthNum = idx + 1;
  return sp.growing_months.includes(monthNum) ? '🌱 Peak growing' : '';
}

// ── Time total ─────────────────────────────────────────────────────────

function _calcTotalTime(tasks) {
  let mins = 0;
  for (const t of tasks) {
    // Parse "X hrs", "X hr", "X min", "X min/day" → minutes
    const hrMatch  = t.time.match(/(\d+(?:\.\d+)?)\s*hr/);
    const minMatch = t.time.match(/(\d+)\s*min(?!\/day)/);
    const dayMatch = t.time.match(/(\d+)\s*min\/day/);
    if (hrMatch)  mins += parseFloat(hrMatch[1]) * 60;
    if (minMatch) mins += parseInt(minMatch[1]);
    if (dayMatch) mins += parseInt(dayMatch[1]) * 30; // assume ~30 days in season
  }
  if (mins === 0) return null;
  const hrs = Math.round(mins / 60);
  return hrs < 1 ? `${mins}min` : `~${hrs}h`;
}

// ── Render ─────────────────────────────────────────────────────────────

let _currentSeason_ = null;

/**
 * Render the calendar for a given season.
 * @param {string} season - 'spring' | 'summer' | 'autumn' | 'winter'
 */
export function renderCal(season) {
  _currentSeason_ = season;
  const isNH = _isNorthernHemisphere();
  const months = isNH ? NH_MONTHS[season] : SH_MONTHS[season];
  const tasks = _getTasksForSeason(season);
  const container = document.getElementById('calContent');
  if (!container) return;

  const totalTime = _calcTotalTime(tasks.filter(t => !_doneSet.has(t.id)));
  const doneCount = tasks.filter(t => _doneSet.has(t.id)).length;
  const isCurrent = season === _currentSeason();

  // Season header with stats
  const statsBar = `
  <div class="cal-season-bar">
    <div class="csb-label">
      ${isCurrent ? '<span class="csb-now">● Now</span>' : ''}
      ${months.join(' · ')}
    </div>
    <div class="csb-stats">
      ${doneCount > 0 ? `<span class="csb-done">${doneCount} done</span>` : ''}
      ${totalTime ? `<span class="csb-time">⏱ ${totalTime} remaining</span>` : ''}
    </div>
  </div>`;

  if (!tasks.length) {
    container.innerHTML = statsBar + `
    <div class="cal-empty">
      <div class="ce-ico">🌿</div>
      <div class="ce-title">No specific tasks this season</div>
      <div class="ce-sub">Add systems on the Map screen to unlock seasonal maintenance tasks.</div>
    </div>`;
    return;
  }

  // Split tasks across 3 months evenly
  const perMonth = Math.ceil(tasks.length / months.length);

  container.innerHTML = statsBar + months.map((month, i) => {
    const slice = tasks.slice(i * perMonth, (i + 1) * perMonth);
    const growAnnotation = _growingAnnotation(month);

    return `
    <div class="cal-month">
      <div class="cal-month-header">
        <div class="cal-month-name">${month}</div>
        ${growAnnotation ? `<div class="cal-month-grow">${growAnnotation}</div>` : ''}
      </div>
      ${slice.map(t => {
        const isDone = _doneSet.has(t.id);
        return `
        <div class="cal-task${isDone ? ' done' : ''}${t.priority === 'high' && !isDone ? ' priority' : ''}" data-task-id="${t.id}">
          <button class="ct-check" aria-label="${isDone ? 'Mark undone' : 'Mark done'}" data-task-id="${t.id}">
            ${isDone ? '✓' : ''}
          </button>
          <div class="ct-ico">${t.ico}</div>
          <div class="ct-body">
            <div class="ct-t">${t.t}${t.priority === 'high' && !isDone ? ' <span class="ct-badge">Priority</span>' : ''}</div>
            <div class="ct-d">${t.d}</div>
            ${t.alert ? `<div class="ct-alert">${t.alert}</div>` : ''}
          </div>
          <div class="ct-time">${t.time}</div>
        </div>`;
      }).join('')}
    </div>`;
  }).join('');

  // Wire up check buttons
  container.querySelectorAll('.ct-check').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.taskId;
      if (_doneSet.has(id)) {
        _doneSet.delete(id);
      } else {
        _doneSet.add(id);
      }
      _saveDone(_doneSet);
      renderCal(_currentSeason_); // re-render to move done items to bottom
    });
  });
}

/**
 * Wire up season tab buttons. Called once from app.js.
 */
export function wireSeasonTabs() {
  document.querySelectorAll('.stab[data-season]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.stab').forEach(t => t.classList.remove('on'));
      btn.classList.add('on');
      renderCal(btn.dataset.season);
    });
  });
}

/**
 * Called from nav.js when navigating to S4.
 * Auto-selects the current season tab and renders it.
 */
export function activateCurrentSeasonTab() {
  const season = _currentSeason();
  document.querySelectorAll('.stab').forEach(t => t.classList.remove('on'));
  const activeTab = document.querySelector(`.stab[data-season="${season}"]`);
  if (activeTab) activeTab.classList.add('on');
  renderCal(season);
}
