/**
 * plan.js
 * Renders the three-phase implementation plan (S3).
 *
 * Phase content is authored here as structured data so it can be
 * easily edited, extended, or eventually replaced by AI-generated
 * phased plans that are property-specific.
 */

// ── Phase data ─────────────────────────────────────────────────────────
// Each phase has a colour scheme, name, period, and an array of tasks.
// Task descriptions are grounded in peer-reviewed permaculture research —
// see docs/science.md for citations.

const PHASE_DATA = [
  {
    num: '1',
    bg: 'rgba(43,151,181,.2)',
    tc: '#88d4ee',
    name: 'Water & Foundation',
    period: 'Year 1 · Months 1–12',
    tasks: [
      {
        ico: '💧',
        t: 'Dig swales (3 contour positions)',
        d: 'Start at the top of the slope. Use an A-frame to find true contour. Well-placed swales can divert 30–70% of overland flow into the soil. Complete before first autumn rains.',
      },
      {
        ico: '🌊',
        t: 'Excavate retention pond',
        d: 'Eastern boundary low point. Clay-lined with rock inlet. On-farm water storage measurably raises shallow water tables within 3–7 years. Install overflow spillway before filling season.',
      },
      {
        ico: '🪱',
        t: 'Begin soil rehabilitation',
        d: 'Woodchip mulch 10–15cm over compacted areas at 25–30:1 carbon-to-nitrogen ratio — the research-validated sweet spot for microbial activation. Broadcast white clover as a living nitrogen source. No digging.',
      },
      {
        ico: '🌱',
        t: 'Plant nitrogen-fixing pioneers',
        d: 'Alder, goumi berry, and Siberian pea shrub on windward edges. These fix atmospheric nitrogen, building fertility for everything planted after — no purchased inputs needed.',
      },
      {
        ico: '🥬',
        t: 'Set up kitchen garden beds',
        d: 'Raised beds, woodchip paths. Install gravity drip from pond. First plantings: salad greens, herbs, root vegetables. Expect labile soil carbon to increase visibly within the first 2 years.',
      },
    ],
  },
  {
    num: '2',
    bg: 'rgba(85,176,37,.2)',
    tc: '#98de55',
    name: 'Food Forest Planting',
    period: 'Years 1–3 · Active establishment',
    tasks: [
      {
        ico: '🍎',
        t: 'Plant canopy trees — target 15–25% cover',
        d: 'Apple, pear, and hazel as primary canopy at 4–6m spacing. Research shows groundwater recharge peaks at 15–25% canopy cover — dense plantings over 40% can reduce aquifer recharge. Comfrey companions at each drip line immediately.',
      },
      {
        ico: '🫐',
        t: 'Establish shrub layer',
        d: 'Gooseberries, currants, goumi berry, and elder in the mid-layer. Fill gaps with nitrogen-fixing shrubs. Diversified shrub layers are where most of the 457% biodiversity gains are generated.',
      },
      {
        ico: '🌿',
        t: 'Sow ground layer',
        d: 'Comfrey, yarrow, mint, strawberry, and white clover throughout. Combined with no-till and mulch, expect soil organic carbon to be measurably higher by year 3.',
      },
      {
        ico: '🍄',
        t: 'Inoculate with mycorrhizal fungi',
        d: 'Dip all bare-root trees before planting. Apply AACT soil drench in spring and autumn of establishment years. Fungal-dominant soils turn carbon over more slowly — this is the long-term sequestration mechanism.',
      },
    ],
  },
  {
    num: '3',
    bg: 'rgba(180,100,40,.2)',
    tc: '#c8a060',
    name: 'System Maturity',
    period: 'Years 4–10 · Harvest & refinement',
    tasks: [
      {
        ico: '✂️',
        t: 'Selective succession management',
        d: 'Chop pioneer nitrogen fixers as canopy closes. Leave all material as chop-and-drop mulch. This continuous organic input is what drives ongoing SOC increase — research shows gains compound over 15–30 years.',
      },
      {
        ico: '🌳',
        t: 'Food forest self-management',
        d: 'By year 5 the system largely manages itself. The edible diversity and resilience of a mature food forest rivals or exceeds monocultures — it is the stability and variety, not raw kg/hectare, that makes these systems exceptional.',
      },
      {
        ico: '💧',
        t: 'Aquifer & creek monitoring',
        d: 'Deep aquifer response lags surface changes by years. Year-round creek flow and rising water table are realistic 5–15 year outcomes with swales, pond, and managed canopy all working together.',
      },
      {
        ico: '🪱',
        t: 'Soil biology verification',
        d: 'Annual worm count: target 10+ per cubic foot. At this density the soil food web is self-sustaining. European permaculture research found 201% more earthworms in mature permaculture sites vs conventional land.',
      },
    ],
  },
];

// ── Render ─────────────────────────────────────────────────────────────

let planRendered = false;

export function renderPlan() {
  // Only render once (plan is static; could be made dynamic in future)
  const container = document.getElementById('phaseList');
  if (!container || planRendered) return;
  planRendered = true;

  container.innerHTML = PHASE_DATA.map((p, i) => `
    <div class="phase-card ${i === 0 ? 'open' : ''}" id="ph${i}">
      <div class="ph-head" data-phase="${i}">
        <div class="ph-num" style="background:${p.bg};color:${p.tc}">${p.num}</div>
        <div>
          <div class="ph-name">${p.name}</div>
          <div class="ph-period">${p.period}</div>
        </div>
        <div class="ph-chev">›</div>
      </div>
      <div class="ph-body">
        ${p.tasks.map(t => `
          <div class="task">
            <div class="task-ico">${t.ico}</div>
            <div>
              <div class="task-title">${t.t}</div>
              <div class="task-desc">${t.d}</div>
            </div>
          </div>`).join('')}
      </div>
    </div>`).join('');

  // Wire phase accordion toggles
  container.querySelectorAll('.ph-head').forEach(head => {
    head.addEventListener('click', () => {
      const card = document.getElementById('ph' + head.dataset.phase);
      if (card) card.classList.toggle('open');
    });
  });
}
