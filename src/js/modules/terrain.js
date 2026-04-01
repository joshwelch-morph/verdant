/**
 * terrain.js
 * High-resolution terrain analysis using USGS 3DEP (3D Elevation Program).
 *
 * Replaces the single-point OpenTopoData SRTM30m call with a full terrain
 * analysis grid using the USGS National Map ImageServer — free, no API key,
 * up to 1-metre resolution for the continental US, 3–10m for Alaska/Hawaii,
 * and 30m global fallback via OpenTopoData.
 *
 * Given a property centre point and approximate size, this module:
 *   1. Builds a sampling grid across the property bounding box
 *   2. Queries USGS 3DEP getSamples for all grid points in one request
 *   3. Derives: min/max/mean elevation, slope %, aspect (cardinal direction),
 *      slope position (ridge / mid-slope / valley), contour interval,
 *      estimated water flow direction, and swale placement zones
 *   4. Falls back to OpenTopoData SRTM30m for non-US locations
 *   5. Returns a structured terrain object stored in APP.siteProfile.terrain
 *
 * The resolution of the 3DEP data (1m / 3m / 10m / 30m) is reported
 * transparently and surfaced in the UI so users understand data quality.
 *
 * CORS: USGS 3DEP ImageServer supports CORS — direct browser calls work.
 * EPQS single-point also supports CORS.
 */

// ── Constants ────────────────────────────────────────────────────────────────

const USGS_SAMPLES_URL = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples';
const USGS_EPQS_URL    = 'https://epqs.nationalmap.gov/v1/json';
const OPENTOPODATA_URL = 'https://api.opentopodata.org/v1/srtm30m';

// Grid dimensions — 5×5 = 25 points for a standard property
// Enough to determine slope trend, aspect, and identify low/high zones
const GRID_COLS = 5;
const GRID_ROWS = 5;

// Approximate degrees per metre at mid-latitudes
const DEG_PER_M_LAT = 1 / 111320;
const DEG_PER_M_LNG = (lat) => 1 / (111320 * Math.cos(lat * Math.PI / 180));

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Estimate bounding box from centre point and property size in acres.
 * Returns { minLat, maxLat, minLng, maxLng, widthM, heightM }
 */
function _bbox(lat, lng, sizeAcres) {
  // 1 acre ≈ 4047 m²  → side length of square = sqrt(size * 4047)
  const areaM2   = (parseFloat(sizeAcres) || 1) * 4047;
  const sideM    = Math.sqrt(areaM2);
  // Add 20% margin so we capture slopes just outside the boundary
  const halfM    = (sideM / 2) * 1.2;
  const halfLat  = halfM * DEG_PER_M_LAT;
  const halfLng  = halfM * DEG_PER_M_LNG(lat);
  return {
    minLat: lat - halfLat,
    maxLat: lat + halfLat,
    minLng: lng - halfLng,
    maxLng: lng + halfLng,
    widthM:  halfM * 2,
    heightM: halfM * 2,
  };
}

/**
 * Build a regular grid of [lng, lat] points within the bounding box.
 */
function _buildGrid(bbox, cols, rows) {
  const points = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lng = bbox.minLng + (c / (cols - 1)) * (bbox.maxLng - bbox.minLng);
      const lat = bbox.minLat + (r / (rows - 1)) * (bbox.maxLat - bbox.minLat);
      points.push([lng, lat]);
    }
  }
  return points;
}

/**
 * Query USGS 3DEP getSamples for an array of [lng, lat] points.
 * Returns array of elevation values (metres) in the same order as input,
 * null for any that failed, and the resolution of the source data.
 */
async function _query3DEP(points) {
  const geometry = JSON.stringify({
    points: points,
    spatialReference: { wkid: 4326 },
  });

  const params = new URLSearchParams({
    geometry,
    geometryType:         'esriGeometryMultipoint',
    returnFirstValueOnly: 'false',
    interpolation:        'RSP_BilinearInterpolation',
    outFields:            '*',
    f:                    'json',
  });

  const url = `${USGS_SAMPLES_URL}?${params.toString()}`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`3DEP getSamples failed: ${res.status}`);
  const data = await res.json();

  if (!data.samples?.length) throw new Error('3DEP: no samples returned');

  // Sort by locationId to match input order
  const sorted = [...data.samples].sort((a, b) => a.locationId - b.locationId);

  // Extract elevations and best resolution
  const elevations  = sorted.map(s => s.value != null && s.value !== 'NoData' ? parseFloat(s.value) : null);
  const resolutions = sorted.map(s => parseFloat(s.resolution) || 30);
  const bestRes     = Math.min(...resolutions.filter(r => r > 0));

  return { elevations, resolution: bestRes };
}

/**
 * Fallback: single-point OpenTopoData SRTM30m for non-US locations.
 */
async function _queryOpenTopo(lat, lng) {
  const res  = await fetch(`${OPENTOPODATA_URL}?locations=${lat},${lng}`);
  if (!res.ok) throw new Error(`OpenTopoData failed: ${res.status}`);
  const data = await res.json();
  const elev = data.results?.[0]?.elevation ?? null;
  return { elevations: elev != null ? [elev] : [null], resolution: 30 };
}

// ── Analysis ─────────────────────────────────────────────────────────────────

/**
 * From a grid of elevations, derive terrain statistics.
 * Grid is GRID_ROWS × GRID_COLS, row-major (bottom-to-top = S to N).
 */
function _analyzeGrid(elevations, bbox, cols, rows) {
  const valid = elevations.filter(e => e != null);
  if (!valid.length) return null;

  const minElev  = Math.min(...valid);
  const maxElev  = Math.max(...valid);
  const meanElev = valid.reduce((s, e) => s + e, 0) / valid.length;
  const elevRange = maxElev - minElev;

  // ── Slope ──────────────────────────────────────────────────────────
  // Use central-difference method across the grid
  const slopes = [];
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const idx  = r * cols + c;
      const dz_x = (elevations[idx + 1]     ?? elevations[idx]) -
                   (elevations[idx - 1]     ?? elevations[idx]);
      const dz_y = (elevations[idx + cols]  ?? elevations[idx]) -
                   (elevations[idx - cols]  ?? elevations[idx]);
      // Cell spacing in metres
      const dx   = bbox.widthM  / (cols - 1);
      const dy   = bbox.heightM / (rows - 1);
      const slope_pct = (Math.sqrt((dz_x / (2 * dx)) ** 2 + (dz_y / (2 * dy)) ** 2)) * 100;
      slopes.push(slope_pct);
    }
  }
  const avgSlope = slopes.length
    ? slopes.reduce((s, v) => s + v, 0) / slopes.length
    : 0;
  const maxSlope = slopes.length ? Math.max(...slopes) : 0;

  // ── Aspect — dominant direction of slope ──────────────────────────
  // Average dx/dy across the whole grid
  let sumDx = 0, sumDy = 0, count = 0;
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const idx  = r * cols + c;
      const dz_x = (elevations[idx + 1]    ?? elevations[idx]) -
                   (elevations[idx - 1]    ?? elevations[idx]);
      const dz_y = (elevations[idx + cols] ?? elevations[idx]) -
                   (elevations[idx - cols] ?? elevations[idx]);
      sumDx += dz_x;
      sumDy += dz_y;
      count++;
    }
  }
  // Aspect is the direction the slope faces (downhill direction)
  const aspectRad  = Math.atan2(sumDy / count, sumDx / count);
  const aspectDeg  = ((aspectRad * 180 / Math.PI) + 360) % 360;
  const aspectCard = _degToCardinal(aspectDeg);

  // ── Slope position ─────────────────────────────────────────────────
  // Classify each point as ridge (top 33%), mid-slope, or valley (bottom 33%)
  const low33  = minElev + elevRange * 0.33;
  const high67 = minElev + elevRange * 0.67;

  const valleyIdxs = [];
  const ridgeIdxs  = [];
  const midIdxs    = [];

  elevations.forEach((e, i) => {
    if (e == null) return;
    if (e <= low33)  valleyIdxs.push(i);
    else if (e >= high67) ridgeIdxs.push(i);
    else midIdxs.push(i);
  });

  // Convert grid index to approximate relative position
  function _idxToPos(idx) {
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    const relX = c / (cols - 1);  // 0 = W, 1 = E
    const relY = r / (rows - 1);  // 0 = S, 1 = N
    return { relX, relY };
  }

  // ── Water flow & swale zones ───────────────────────────────────────
  // Swales are placed on contour just above valley/mid-slope transition
  // i.e. at the elevation ≈ 40th percentile of the range
  const swaleTargetElev   = minElev + elevRange * 0.40;
  const swaleTargetElev2  = minElev + elevRange * 0.65; // second swale on larger slopes

  // Find grid points closest to swale target elevations
  const swalePoints = elevations
    .map((e, i) => ({ e, i, diff: Math.abs((e ?? 999) - swaleTargetElev) }))
    .filter(p => p.e != null)
    .sort((a, b) => a.diff - b.diff)
    .slice(0, 3)
    .map(p => {
      const r = Math.floor(p.i / cols);
      const c = p.i % cols;
      const lng = bbox.minLng + (c / (cols - 1)) * (bbox.maxLng - bbox.minLng);
      const lat = bbox.minLat + (r / (rows - 1)) * (bbox.maxLat - bbox.minLat);
      return { lat, lng, elevation: p.e };
    });

  // ── Contour interval recommendation ───────────────────────────────
  // Standard permaculture: contours every 1–2m on gentle slopes, 5m on steep
  const contourInterval = avgSlope < 5   ? 0.5
    : avgSlope < 15  ? 1
    : avgSlope < 30  ? 2
    : 5;

  // ── Hemisphere (needed for solar aspect interpretation) ────────────
  // Northern hemisphere: south-facing = most sun
  // Southern hemisphere: north-facing = most sun

  // ── Slope description ──────────────────────────────────────────────
  const slopeDesc = avgSlope < 2   ? 'flat'
    : avgSlope < 5   ? 'gently sloping'
    : avgSlope < 15  ? 'moderately sloping'
    : avgSlope < 30  ? 'steep'
    : 'very steep';

  // ── Key permaculture zones derived from terrain ────────────────────
  // Water harvesting zone: lowest point(s) of property
  const waterZonePoints = elevations
    .map((e, i) => ({ e, i }))
    .filter(p => p.e != null && p.e <= low33)
    .slice(0, 2)
    .map(p => {
      const r = Math.floor(p.i / cols);
      const c = p.i % cols;
      const lng = bbox.minLng + (c / (cols - 1)) * (bbox.maxLng - bbox.minLng);
      const lat = bbox.minLat + (r / (rows - 1)) * (bbox.maxLat - bbox.minLat);
      return { lat, lng, elevation: p.e };
    });

  // Best food forest zone: mid-slope, best-aspect position
  const foodForestPoints = elevations
    .map((e, i) => ({ e, i }))
    .filter(p => p.e != null && p.e > low33 && p.e < high67)
    .slice(0, 2)
    .map(p => {
      const r = Math.floor(p.i / cols);
      const c = p.i % cols;
      const lng = bbox.minLng + (c / (cols - 1)) * (bbox.maxLng - bbox.minLng);
      const lat = bbox.minLat + (r / (rows - 1)) * (bbox.maxLat - bbox.minLat);
      return { lat, lng, elevation: p.e };
    });

  return {
    // Raw grid
    grid: { cols, rows, points: elevations },
    bbox,
    // Summary stats
    elevation_min:  Math.round(minElev  * 10) / 10,
    elevation_max:  Math.round(maxElev  * 10) / 10,
    elevation_mean: Math.round(meanElev * 10) / 10,
    elevation_range: Math.round(elevRange * 10) / 10,
    // Slope
    slope_avg_pct:  Math.round(avgSlope * 10) / 10,
    slope_max_pct:  Math.round(maxSlope * 10) / 10,
    slope_desc:     slopeDesc,
    // Aspect
    aspect_deg:     Math.round(aspectDeg),
    aspect_cardinal: aspectCard,
    // Contour
    contour_interval_m: contourInterval,
    // Zones
    swale_points:       swalePoints,
    water_zone_points:  waterZonePoints,
    food_forest_points: foodForestPoints,
    // Valley / ridge / mid index counts
    valley_pct: Math.round((valleyIdxs.length / valid.length) * 100),
    ridge_pct:  Math.round((ridgeIdxs.length  / valid.length) * 100),
    mid_pct:    Math.round((midIdxs.length    / valid.length) * 100),
  };
}

/**
 * Convert degrees to cardinal direction (16-point compass)
 */
function _degToCardinal(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

/**
 * Determine if lat/lng is within the US (rough bounding box).
 * 3DEP has best coverage for continental US, Alaska, Hawaii.
 */
function _isUS(lat, lng) {
  // Continental US + Alaska + Hawaii rough bounds
  if (lat >= 24 && lat <= 50 && lng >= -125 && lng <= -66) return true;  // CONUS
  if (lat >= 54 && lat <= 72 && lng >= -170 && lng <= -130) return true; // Alaska
  if (lat >= 18 && lat <= 23 && lng >= -162 && lng <= -154) return true; // Hawaii
  return false;
}

// ── Data quality descriptor ──────────────────────────────────────────────────

/**
 * Returns a human-readable description of terrain data quality
 * for use in the honesty banner.
 */
export function terrainQualityLabel(resolution, isUS) {
  if (!isUS) {
    return {
      label:   '30m global',
      detail:  'SRTM 30-metre resolution — each data point covers a 30×30m area',
      quality: 'low',
      source:  'OpenTopoData SRTM30m',
    };
  }
  if (resolution <= 1) {
    return {
      label:   '1m LiDAR',
      detail:  'USGS 3DEP 1-metre LiDAR — highest available resolution',
      quality: 'high',
      source:  'USGS 3DEP 1m',
    };
  }
  if (resolution <= 3) {
    return {
      label:   '3m LiDAR',
      detail:  'USGS 3DEP 3-metre resolution LiDAR data',
      quality: 'high',
      source:  'USGS 3DEP 3m',
    };
  }
  if (resolution <= 10) {
    return {
      label:   '10m DEM',
      detail:  'USGS 3DEP 10-metre digital elevation model',
      quality: 'medium',
      source:  'USGS 3DEP 10m',
    };
  }
  return {
    label:   '30m DEM',
    detail:  'USGS 3DEP 30-metre (1 arc-second) digital elevation model',
    quality: 'medium',
    source:  'USGS 3DEP 30m',
  };
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Run full terrain analysis for a property.
 *
 * @param {number} lat         Property centre latitude
 * @param {number} lng         Property centre longitude
 * @param {string|number} sizeAcres  Property size (parsed for bbox)
 * @returns {Promise<object>}  Terrain analysis object
 */
export async function analyzeTerrain(lat, lng, sizeAcres = 1) {
  const isUS   = _isUS(lat, lng);
  const bbox   = _bbox(lat, lng, sizeAcres);
  const points = _buildGrid(bbox, GRID_COLS, GRID_ROWS);

  let elevations, resolution;

  if (isUS) {
    // Try USGS 3DEP first (best quality, US-only)
    try {
      const result = await _query3DEP(points);
      elevations   = result.elevations;
      resolution   = result.resolution;

      // Sanity check: if all are null, fall back
      const validCount = elevations.filter(e => e != null).length;
      if (validCount < points.length * 0.5) {
        throw new Error('3DEP: too many null values, falling back');
      }
    } catch (err) {
      console.warn('[Terrain] 3DEP failed, falling back to EPQS centre point:', err.message);
      // Fallback: single centre point via EPQS
      const epqsRes = await fetch(`${USGS_EPQS_URL}?x=${lng}&y=${lat}&wkid=4326&includeDate=false`);
      if (epqsRes.ok) {
        const epqsData = await epqsRes.json();
        const singleElev = parseFloat(epqsData.value) || null;
        elevations = new Array(points.length).fill(singleElev);
        resolution = 30;
      } else {
        throw new Error('Both 3DEP and EPQS failed');
      }
    }
  } else {
    // Non-US: use OpenTopoData SRTM30m (centre point only)
    try {
      const result = await _queryOpenTopo(lat, lng);
      // Fill the whole grid with the single centre elevation
      // (no slope analysis possible with single point)
      elevations = new Array(points.length).fill(result.elevations[0]);
      resolution = result.resolution;
    } catch {
      elevations = new Array(points.length).fill(null);
      resolution = 30;
    }
  }

  // Analyse the grid
  const analysis = _analyzeGrid(elevations, bbox, GRID_COLS, GRID_ROWS);
  const qualityInfo = terrainQualityLabel(resolution, isUS);

  if (!analysis) {
    return {
      isUS,
      resolution,
      quality: qualityInfo,
      elevation: elevations.find(e => e != null) ?? null,
      error: 'Insufficient elevation data for terrain analysis',
    };
  }

  return {
    isUS,
    resolution,
    quality:          qualityInfo,
    ...analysis,
    // Convenience: single elevation value for backward compat
    elevation:        analysis.elevation_mean,
  };
}
