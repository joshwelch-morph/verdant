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
- Hemisphere: ${tc.cy >= 0 ? 'Northern Hemisphere — south-facing slopes receive more sun' : 'Southern Hemisphere — north-facing slopes receive more sun'}

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
    max_tokens: 2500,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = data.content?.[0]?.text || '';
  const clean = text.replace(/```json|```/gi, '').trim();

  try {
    return JSON.parse(clean);
  } catch {
    // Response may have been cut off or wrapped — try to extract the array
    const match = clean.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Terrain analysis returned unexpected format. Please try again.');
  }
}

// ── JSON recovery helper ───────────────────────────────────────────────

/**
 * If the API response was truncated mid-JSON, try to salvage what we can.
 * Finds the opening { of the main object, then walks backward from the
 * truncation point to find the last complete plant entry and closes the
 * structure so JSON.parse can succeed.
 */
function _salvageJSON(raw) {
  // Find the outermost opening brace
  const start = raw.indexOf('{');
  if (start === -1) return null;

  let str = raw.slice(start);

  // Try progressively shorter strings until we find something parseable
  // by closing off any open arrays/objects
  for (let cut = str.length; cut > str.length * 0.3; cut--) {
    const slice = str.slice(0, cut).trimEnd();

    // Count open braces/brackets to figure out what we need to close
    let braces = 0, brackets = 0;
    let inString = false, escape = false;
    for (const ch of slice) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') braces++;
      else if (ch === '}') braces--;
      else if (ch === '[') brackets++;
      else if (ch === ']') brackets--;
    }

    if (braces < 0 || brackets < 0) continue; // malformed at this cut point

    // Build closing suffix
    const suffix = ']'.repeat(brackets) + '}'.repeat(braces);
    try {
      const result = JSON.parse(slice + suffix);
      // Only accept if we got at least the plants array with 1+ entries
      if (result.plants && result.plants.length > 0) return result;
    } catch {
      // keep trimming
    }
  }
  return null;
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
Hemisphere: ${prop.address.match(/australia|new zealand|south africa|argentina|chile|brazil/i) ? 'Southern — north-facing slopes get more sun' : 'Northern — south-facing slopes get more sun'}
Goals: ${prop.goals.join(', ')}
SELECTED SYSTEMS: ${systems.join(', ')}

INATURALIST PLANTS: ${plantCtx}
INATURALIST ANIMALS: ${animalCtx}

Return JSON: { "plants": [...6 items], "nativeMedicinals": [...3 items], "wildlife": {...} }

Each plant: { name, latin, emoji, matchScore("High"/"Medium"), roles[], layer, whyThisProperty(1–2 sentences), availability(nursery name or region), availabilityLevel("Common"/"Specialist"), medicinalUse(or null), wildlifeValue(1 sentence), height, rootDepth, yield, maintenanceLevel("None"/"Low"/"Moderate"), guild[2–3 names], systemFit[] }

Each medicinal: { name, latin, observationNote, medicinalUses(1–2 sentences), cultivationNote, caution(or null) }

Wildlife: { ecologicalSummary, pollinators[2–3], pestPredators[2–3], browsingAnimals[2–3] }
Each animal: { emoji, name, latin, observationLevel("High"/"Medium"/"Low"), role, designResponse }

Use web search to check plant availability at nurseries near ${prop.address}.`;

  const data = await callAPI({
    model: MODEL,
    max_tokens: 8000,
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
    // If truncated mid-JSON, try to salvage complete plant objects
    parsed = _salvageJSON(clean);
    if (!parsed) throw new Error('Could not parse response — please try again.');
  }

  if (!parsed.plants) throw new Error('Unexpected response format from API.');
  return parsed;
}
