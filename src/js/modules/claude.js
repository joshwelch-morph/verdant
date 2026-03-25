/**
 * claude.js
 * All calls to the Anthropic API.
 *
 * Two public functions:
 *   runAIPlacement(terrainContext)  → used by map.js to place pins
 *   runPlantAnalysis(systems)       → used by app.js when "Analyse" is clicked
 *
 * Both hit the API directly from the browser. Keys are sourced from
 * APP.apiKey and are never stored or logged.
 *
 * The dangerous-direct-browser-access header is required for browser-origin
 * requests. This is intentional — Verdant has no backend.
 */

import { APP } from './state.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const MODEL = 'claude-sonnet-4-5';

// ── Shared fetch wrapper ───────────────────────────────────────────────

async function callAPI(payload) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': APP.apiKey,
      'anthropic-version': API_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error ${res.status}`);
  }

  return res.json();
}

// ── Terrain / pin placement ────────────────────────────────────────────

/**
 * Ask Claude to place design opportunities at terrain-logical coordinates.
 *
 * @param {object} tc - terrainContext from map.js
 * @returns {Array} Array of opportunity objects with lat/lng/reasoning
 */
export async function runAIPlacement(tc) {
  const prompt = `You are an expert permaculture designer analysing real terrain data for a property at ${tc.address}.

TERRAIN DATA:
- Elevation relief: ${tc.relief}m (min ${tc.minElev}m, max ${tc.maxElev}m)
- Slope direction: ${tc.slopeDir}
- Aspect: ${tc.aspect}
- Lowest point (water collection): lat ${tc.lowestPoint.lat.toFixed(5)}, lng ${tc.lowestPoint.lng.toFixed(5)}, elev ${tc.lowestPoint.elev.toFixed(1)}m
- Highest point (solar/frost drainage): lat ${tc.highestPoint.lat.toFixed(5)}, lng ${tc.highestPoint.lng.toFixed(5)}, elev ${tc.highestPoint.elev.toFixed(1)}m
- Mid-slope swale candidate: lat ${tc.swaleCandidate.lat.toFixed(5)}, lng ${tc.swaleCandidate.lng.toFixed(5)}
- Property size: ${tc.propertySize}
- Soil: ${tc.soil}
- Water features: ${tc.water}
- Owner goals: ${(tc.goals || []).join(', ')}

Based on this REAL terrain data, place 4–6 regenerative design opportunities at the most appropriate coordinates on this property. Each opportunity must be placed using actual terrain reasoning — not generic positions.

Respond ONLY with a JSON array. No markdown, no explanation. Format:
[
  {
    "id": "swales",
    "title": "Contour Swales",
    "icon": "💧",
    "category": "water",
    "lat": <exact latitude based on terrain>,
    "lng": <exact longitude based on terrain>,
    "reasoning": "2–3 sentences explaining WHY this specific location based on the terrain data above",
    "stats": [{"v":"<value>","l":"<label>"},{"v":"<value>","l":"<label>"},{"v":"<value>","l":"<label>"}],
    "tags": ["tag1","tag2","tag3"],
    "impact": "High"
  }
]

Available opportunity types: swales (💧 water), pond (🌊 water), food_forest (🌳 food), kitchen_garden (🥬 food), solar_zone (☀️ solar), soil_rehab (🪱 soil), windbreak (🌾 solar), medicinals (🌿 food).

Place each at the MOST LOGICAL terrain position. Swales go on the mid-slope contour, the pond at the lowest catchment point, food forest on the best-aspect slope, solar zone at the highest/most exposed point.`;

  const data = await callAPI({
    model: MODEL,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = data.content?.[0]?.text || '';
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

// ── Plant analysis ─────────────────────────────────────────────────────

/**
 * Full property analysis: plant recommendations, native medicinals,
 * wildlife overview. Uses web_search tool for real nursery availability.
 *
 * @param {string[]} systems - Selected system names from the sysRow
 * @returns {object} { plants, nativeMedicinals, wildlife }
 */
export async function runPlantAnalysis(systems) {
  const prop = APP.property;

  const plantCtx = APP.inatPlants.length
    ? 'Observed native plants within 15km:\n' + APP.inatPlants.map(s => `${s.common} (${s.name})`).join(', ')
    : 'No iNaturalist plant data — use regional knowledge for ' + prop.address;

  const animalCtx = APP.inatAnimals.length
    ? 'Observed animals within 15km:\n' + (() => {
        const g = {};
        APP.inatAnimals.forEach(a => {
          const key = a.iconicGroup || 'Other';
          if (!g[key]) g[key] = [];
          g[key].push(`${a.common} (${a.name})`);
        });
        return Object.entries(g).map(([k, v]) => `${k}: ${v.join(', ')}`).join('\n');
      })()
    : 'No iNaturalist animal data — use regional knowledge for ' + prop.address;

  const systemPrompt = `You are an expert permaculture designer, plant ecologist, herbalist, and wildlife ecologist. Respond ONLY with valid JSON — no markdown fences, no preamble.`;

  const userPrompt = `Analyse this property and return plant recommendations, native medicinals, and a wildlife overview.

PROPERTY: ${prop.name} | ${prop.address} | ${prop.size}
Climate: ${prop.climate || 'temperate'} | Rainfall: ${prop.rainfall || 'unknown'}
Soil: ${prop.soil} | Slope: ${prop.slope || 'gentle'}
Water: ${prop.water} | Frost: ${prop.frost || 'light'}
Existing: ${prop.existing || 'pasture'} | Hardiness: ${prop.hardiness || 'temperate'}
Goals: ${prop.goals.join(', ')}
SELECTED SYSTEMS: ${systems.join(', ')}

INATURALIST PLANTS: ${plantCtx}
INATURALIST ANIMALS: ${animalCtx}

Return JSON: { "plants": [...10 items], "nativeMedicinals": [...4 items], "wildlife": {...} }

Each plant: { name, latin, emoji, matchScore("High"/"Medium"), roles[], layer, whyThisProperty(2–3 sentences specific to this property), availability(where to source locally), availabilityLevel("Common"/"Specialist"), medicinalUse(or null), wildlifeValue(1–2 sentences on local animal support), height, rootDepth, yield, maintenanceLevel("None"/"Low"/"Moderate"), guild[2–4 names], systemFit[] }

Each medicinal: { name, latin, observationNote, medicinalUses(2–3 sentences), cultivationNote, caution(or null) }

Wildlife: { ecologicalSummary, pollinators[3–4], pestPredators[3–4], browsingAnimals[3–4] }
Each animal: { emoji, name, latin, observationLevel("High"/"Medium"/"Low"), role, designResponse }

Use web search to check plant availability at nurseries in ${prop.address}.`;

  const data = await callAPI({
    model: MODEL,
    max_tokens: 6000,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  // Extract text blocks from the response (tool-use responses may have multiple blocks)
  const text = (data.content || [])
    .map(b => (b.type === 'text' ? b.text : ''))
    .filter(Boolean)
    .join('');

  const clean = text.replace(/```json|```/gi, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch {
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) {
      parsed = JSON.parse(match[0]);
    } else {
      throw new Error('Could not parse response. Try again.');
    }
  }

  if (!parsed.plants) throw new Error('Unexpected response format from API.');
  return parsed;
}
