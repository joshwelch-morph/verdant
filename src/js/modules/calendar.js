/**
 * calendar.js
 * Seasonal maintenance calendar (S4).
 *
 * Calendar content is structured data keyed by season. Tasks include
 * time estimates so landholders can plan their weeks realistically.
 *
 * Months are Southern Hemisphere by default (matching the proof-of-concept
 * property in Victoria, Australia). A Northern Hemisphere variant is a
 * good first contribution — see CONTRIBUTING.md.
 */

const CAL_DATA = {
  spring: [
    {
      month: 'September',
      tasks: [
        {
          ico: '🌱',
          t: 'Sow annual seeds',
          d: 'Tomatoes, cucumbers, squash, beans — start under cover or direct sow when soil reaches 12°C.',
          time: '2 hrs',
        },
        {
          ico: '💧',
          t: 'Check swale integrity',
          d: 'Inspect berms for winter erosion. Repair before wet season ends.',
          time: '1 hr',
        },
        {
          ico: '🌿',
          t: 'First comfrey chop',
          d: 'Cut comfrey to 10cm when 40cm tall. Leave as mulch around fruit trees.',
          time: '1.5 hrs',
        },
      ],
    },
    {
      month: 'October',
      tasks: [
        {
          ico: '🍎',
          t: 'Fruit tree pruning',
          d: 'Shape young trees for open centre. Never remove more than 25% in one season.',
          time: '3 hrs',
        },
        {
          ico: '🪱',
          t: 'Apply JADAM microbial solution',
          d: 'Mix 500L JMS to 100L water. Drench all garden beds and food forest floor.',
          time: '2 hrs',
        },
      ],
    },
  ],

  summer: [
    {
      month: 'December',
      tasks: [
        {
          ico: '💧',
          t: 'Irrigation check',
          d: 'Confirm gravity drip to kitchen garden. Check pond level — should be near full going into dry season.',
          time: '30 min',
        },
        {
          ico: '🥬',
          t: 'Succession sow',
          d: 'Direct sow fast crops every 3 weeks for continuous harvest.',
          time: '1 hr',
        },
        {
          ico: '☀️',
          t: 'Mulch heavily',
          d: 'Top up to 15cm before peak heat. Prevents moisture loss and feeds soil biology.',
          time: '2 hrs',
        },
      ],
    },
    {
      month: 'January',
      tasks: [
        {
          ico: '🌊',
          t: 'Pond maintenance',
          d: 'Remove excess aquatic plants. Check spillway is clear.',
          time: '1 hr',
        },
        {
          ico: '🍅',
          t: 'Peak harvest',
          d: 'Daily harvest from kitchen garden. Preserve surplus by drying, fermenting, or freezing.',
          time: '20 min/day',
        },
      ],
    },
  ],

  autumn: [
    {
      month: 'March',
      tasks: [
        {
          ico: '🌰',
          t: 'Nut and fruit harvest',
          d: 'Hazel, apple, and pear harvest. Store in cool dry location. Press surplus apples.',
          time: '4 hrs',
        },
        {
          ico: '🌱',
          t: 'Sow winter greens',
          d: 'Kale, chard, spinach, and garlic. Garlic in by end of April.',
          time: '1.5 hrs',
        },
        {
          ico: '✂️',
          t: 'Chop and drop pioneers',
          d: 'Cut nitrogen-fixing shrubs to knee height. Leave all material as mulch.',
          time: '2 hrs',
        },
      ],
    },
    {
      month: 'April',
      tasks: [
        {
          ico: '🪸',
          t: 'Make JADAM liquid fertiliser',
          d: 'Fill barrel with wild grasses and crop residues. Submerge, seal, ferment 3+ months.',
          time: '1 hr',
        },
        {
          ico: '💧',
          t: 'Earthwork inspection',
          d: 'Check all swale overflows, pond spillway, and inlet channel before winter rains.',
          time: '1.5 hrs',
        },
      ],
    },
  ],

  winter: [
    {
      month: 'June',
      tasks: [
        {
          ico: '🌳',
          t: 'Tree planting season',
          d: 'Best time to plant bare-root fruit trees. Soil is moist, trees dormant. Plant with comfrey companions.',
          time: '4 hrs',
        },
        {
          ico: '📐',
          t: 'Design review',
          d: 'Review what worked this year. Update your design. Plan new additions for spring.',
          time: '2 hrs',
        },
      ],
    },
    {
      month: 'July',
      tasks: [
        {
          ico: '🍄',
          t: 'Brew JADAM microbial solution',
          d: 'Collect forest leaf mold. Brew JMS with boiled potato water. Ready in 48–72 hrs when bubbling.',
          time: '1 hr',
        },
        {
          ico: '🌿',
          t: 'Green manure sow',
          d: 'Broadcast clover and phacelia on any bare soil. Protects soil, fixes nitrogen, feeds spring pollinators.',
          time: '1 hr',
        },
      ],
    },
  ],
};

// ── Render ─────────────────────────────────────────────────────────────

/**
 * Render the calendar for a given season.
 * @param {string} season - 'spring' | 'summer' | 'autumn' | 'winter'
 */
export function renderCal(season) {
  const months = CAL_DATA[season] || [];
  const container = document.getElementById('calContent');
  if (!container) return;

  container.innerHTML = months.map(m => `
    <div class="cal-month">
      <div class="cal-month-name">${m.month}</div>
      ${m.tasks.map(t => `
        <div class="cal-task">
          <div class="ct-ico">${t.ico}</div>
          <div style="flex:1">
            <div class="ct-t">${t.t}</div>
            <div class="ct-d">${t.d}</div>
          </div>
          <div class="ct-time">${t.time}</div>
        </div>`).join('')}
    </div>`).join('');
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
