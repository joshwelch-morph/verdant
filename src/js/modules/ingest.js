/**
 * ingest.js
 * Stage 1 property ingestion pipeline.
 *
 * Given a lat/lng (from geocoding the property address), fetches:
 *   1. Elevation          — OpenTopoData SRTM30m
 *   2. Climate & rainfall — NASA POWER (annual averages)
 *   3. Frost dates        — Open-Meteo historical climate
 *   4. Soil description   — enriches user-entered soil with context
 *
 * All APIs are free and require no keys.
 * Results are written into APP.property and APP.siteProfile.
 *
 * Export: runIngestion(lat, lng) → Promise<siteProfile>
 */

import { APP } from './state.js';

// ── API helpers ────────────────────────────────────────────────────────

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${url} (${res.status})`);
  return res.json();
}

// ── 1. Elevation ───────────────────────────────────────────────────────

async function fetchElevation(lat, lng) {
  try {
    const data = await fetchJSON(
      `https://api.opentopodata.org/v1/srtm30m?locations=${lat},${lng}`
    );
    return data.results?.[0]?.elevation ?? null;
  } catch {
    return null;
  }
}

// ── 2. NASA POWER — climate averages ──────────────────────────────────
// Parameters:
//   PRECTOTCORR = precipitation (mm/day annual mean)
//   T2M         = temperature 2m (°C annual mean)
//   T2M_MIN     = min temp (°C annual mean of daily mins)
//   T2M_MAX     = max temp (°C annual mean of daily maxs)
//   ALLSKY_SFC_SW_DWN = solar irradiance (kWh/m²/day)

async function fetchNASAPower(lat, lng) {
  const params = 'PRECTOTCORR,T2M,T2M_MIN,T2M_MAX,ALLSKY_SFC_SW_DWN';
  const url = `https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=${params}&community=AG&longitude=${lng}&latitude=${lat}&format=JSON`;
  try {
    const data = await fetchJSON(url);
    const p = data.properties?.parameter;
    if (!p) return null;

    // Annual averages (key 'ANN')
    const rain_mm_day = p.PRECTOTCORR?.ANN ?? null;
    const temp_mean   = p.T2M?.ANN ?? null;
    const temp_min    = p.T2M_MIN?.ANN ?? null;
    const temp_max    = p.T2M_MAX?.ANN ?? null;
    const solar       = p.ALLSKY_SFC_SW_DWN?.ANN ?? null;

    // Monthly min temps — find frost months (below 0°C)
    const monthlyMins = p.T2M_MIN
      ? Object.entries(p.T2M_MIN)
          .filter(([k]) => k !== 'ANN')
          .map(([k, v]) => ({ month: parseInt(k), temp: v }))
      : [];
    const frostMonths = monthlyMins.filter(m => m.temp <= 0).map(m => m.month);

    // Monthly rainfall — find driest / wettest month
    const monthlyRain = p.PRECTOTCORR
      ? Object.entries(p.PRECTOTCORR)
          .filter(([k]) => k !== 'ANN')
          .map(([k, v]) => ({ month: parseInt(k), mm_day: v }))
      : [];

    return {
      rain_mm_year: rain_mm_day !== null ? Math.round(rain_mm_day * 365) : null,
      rain_mm_day,
      temp_mean:    temp_mean !== null ? +temp_mean.toFixed(1) : null,
      temp_min:     temp_min  !== null ? +temp_min.toFixed(1)  : null,
      temp_max:     temp_max  !== null ? +temp_max.toFixed(1)  : null,
      solar_kwh:    solar     !== null ? +solar.toFixed(2)     : null,
      frost_months: frostMonths,
      monthly_rain: monthlyRain,
    };
  } catch {
    return null;
  }
}

// ── 3. Open-Meteo — current conditions + historical ───────────────────

async function fetchOpenMeteo(lat, lng) {
  // Historical climate normals via Open-Meteo archive
  const url = `https://climate-api.open-meteo.com/v1/climate?latitude=${lat}&longitude=${lng}&start_date=2000-01-01&end_date=2009-12-31&models=ERA5&daily=precipitation_sum,temperature_2m_max,temperature_2m_min&timezone=auto`;
  try {
    const data = await fetchJSON(url);
    // Just grab the timezone as a climate hint
    return {
      timezone: data.timezone ?? null,
    };
  } catch {
    return null;
  }
}

// ── 4. Derive human-readable climate description ───────────────────────

function _describeClimate(nasa, elevation) {
  if (!nasa) return '';

  const { rain_mm_year, temp_mean, temp_min, temp_max, frost_months } = nasa;

  // Köppen-ish classification
  let zone = '';
  if (temp_mean !== null && rain_mm_year !== null) {
    if (temp_mean > 18 && rain_mm_year > 1500) zone = 'Tropical humid';
    else if (temp_mean > 18 && rain_mm_year < 500) zone = 'Tropical arid';
    else if (temp_mean > 18) zone = 'Subtropical';
    else if (temp_mean > 10 && rain_mm_year > 800) zone = 'Temperate oceanic';
    else if (temp_mean > 10 && rain_mm_year > 400) zone = 'Temperate continental';
    else if (temp_mean > 10) zone = 'Mediterranean / semi-arid';
    else if (temp_mean > 0)  zone = 'Cool temperate';
    else zone = 'Subarctic / alpine';
  }

  const parts = [];
  if (zone) parts.push(zone);
  if (rain_mm_year !== null) parts.push(`${rain_mm_year}mm/yr rainfall`);
  if (temp_mean !== null) parts.push(`avg ${temp_mean}°C`);
  if (frost_months?.length) parts.push(`${frost_months.length} frost months`);
  if (elevation !== null) parts.push(`${Math.round(elevation)}m elevation`);

  return parts.join(' · ');
}

function _describeFrost(nasa) {
  if (!nasa?.frost_months?.length) return 'Frost-free' ;
  const n = nasa.frost_months.length;
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const names = nasa.frost_months.map(m => MONTHS[m - 1]).join(', ');
  return `${n} frost month${n > 1 ? 's' : ''} (${names})`;
}

function _describeRainfall(nasa) {
  if (!nasa?.rain_mm_year) return '';
  const mm = nasa.rain_mm_year;
  let desc = '';
  if (mm < 250)       desc = 'Arid';
  else if (mm < 500)  desc = 'Semi-arid';
  else if (mm < 800)  desc = 'Moderate';
  else if (mm < 1200) desc = 'Well-watered';
  else if (mm < 2000) desc = 'High rainfall';
  else desc = 'Very high rainfall';
  return `${desc} — ${mm}mm/yr`;
}

// ── 4. SoilGrids — global soil properties ─────────────────────────────
// ISRIC SoilGrids REST API: returns soil properties at 0–30cm depth.
// Properties: phh2o (pH), soc (organic carbon), clay, sand, silt fractions.

async function fetchSoilGrids(lat, lng) {
  const props = 'phh2o,soc,clay,sand,silt,bdod';
  const url = `https://rest.isric.org/soilgrids/v2.0/properties/query?lon=${lng}&lat=${lat}&property=${props.split(',').map(p => `property=${p}`).join('&').replace(/property=/g, '')}&depth=0-30cm&value=mean`;
  // Correct URL format for SoilGrids v2
  const soilUrl = `https://rest.isric.org/soilgrids/v2.0/properties/query?lon=${lng}&lat=${lat}&${props.split(',').map(p => `property=${p}`).join('&')}&depth=0-30cm&value=mean`;
  try {
    const data = await fetchJSON(soilUrl);
    const layers = data.properties?.layers;
    if (!layers?.length) return null;

    // Extract values — SoilGrids returns in d×10 units for most properties
    const get = (name) => {
      const layer = layers.find(l => l.name === name);
      return layer?.depths?.[0]?.values?.mean ?? null;
    };

    const ph_raw  = get('phh2o');   // pH × 10
    const soc_raw = get('soc');     // g/kg × 10
    const clay    = get('clay');    // g/100g × 10 = %×10
    const sand    = get('sand');
    const silt    = get('silt');
    const bd_raw  = get('bdod');    // bulk density cg/cm³

    return {
      ph:         ph_raw  != null ? (ph_raw / 10).toFixed(1)  : null,
      soc_gkg:    soc_raw != null ? (soc_raw / 10).toFixed(1) : null,
      clay_pct:   clay    != null ? Math.round(clay / 10)     : null,
      sand_pct:   sand    != null ? Math.round(sand / 10)     : null,
      silt_pct:   silt    != null ? Math.round(silt / 10)     : null,
      bd_gcm3:    bd_raw  != null ? (bd_raw / 100).toFixed(2) : null,
    };
  } catch {
    return null;
  }
}

/** Build a human-readable soil description from SoilGrids data */
function _describeSoil(sg) {
  if (!sg) return null;
  const parts = [];
  // Texture class
  if (sg.clay_pct != null && sg.sand_pct != null) {
    const c = sg.clay_pct, s = sg.sand_pct;
    let texture = '';
    if (c >= 40) texture = 'Clay';
    else if (c >= 27 && s <= 45) texture = 'Clay loam';
    else if (c >= 20 && s >= 45) texture = 'Sandy clay loam';
    else if (s >= 70) texture = 'Sandy loam';
    else if (s >= 50) texture = 'Loamy sand';
    else texture = 'Loam';
    parts.push(texture);
  }
  if (sg.ph)       parts.push(`pH ${sg.ph}`);
  if (sg.soc_gkg)  parts.push(`${sg.soc_gkg}g/kg organic carbon`);
  if (sg.clay_pct) parts.push(`${sg.clay_pct}% clay`);
  return parts.join(' · ') || null;
}

// ── Solar potential estimate ───────────────────────────────────────────

function _solarKw(nasa, sizeStr) {
  // Rough estimate: solar irradiance × usable area × panel efficiency
  const irr = nasa?.solar_kwh ?? 4.5;
  const acres = parseFloat(sizeStr) || 1;
  const m2 = acres * 4047;
  const usable = m2 * 0.05; // 5% of land for solar
  const efficiency = 0.18;
  const kw = (usable * efficiency * irr) / 1000;
  return Math.min(50, +kw.toFixed(1));
}

// ── Main export ────────────────────────────────────────────────────────

/**
 * Run the full ingestion pipeline for a given lat/lng.
 * Writes results into APP.property and APP.siteProfile.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<object>} siteProfile
 */
export async function runIngestion(lat, lng) {
  // Run all fetches in parallel — soil fetch is lower priority, include anyway
  const [elevation, nasa, meteo, soilGrids] = await Promise.all([
    fetchElevation(lat, lng),
    fetchNASAPower(lat, lng),
    fetchOpenMeteo(lat, lng),
    fetchSoilGrids(lat, lng),
  ]);

  const soilDesc = _describeSoil(soilGrids);

  const siteProfile = {
    lat,
    lng,
    elevation,
    nasa,
    meteo,
    soilGrids,
    // Derived strings
    climate:  _describeClimate(nasa, elevation),
    rainfall: _describeRainfall(nasa),
    frost:    _describeFrost(nasa),
    solar_kw: _solarKw(nasa, APP.property.size),
    soil_desc: soilDesc,
    // Raw numbers for gauges
    rain_mm_year:  nasa?.rain_mm_year  ?? null,
    temp_mean:     nasa?.temp_mean     ?? null,
    temp_min:      nasa?.temp_min      ?? null,
    solar_kwh_day: nasa?.solar_kwh     ?? null,
    frost_months:  nasa?.frost_months  ?? [],
    fetched_at:    new Date().toISOString(),
  };

  // Write into APP.property (used by claude.js prompts)
  APP.property.climate  = siteProfile.climate;
  APP.property.rainfall = siteProfile.rainfall;
  APP.property.frost    = siteProfile.frost;
  // Enrich soil only if user hasn't entered detailed info already
  if (soilDesc && !APP.property.soil) {
    APP.property.soil = soilDesc;
  } else if (soilDesc) {
    // Append SoilGrids data as additional context
    APP.property.soil = APP.property.soil + ` (SoilGrids: ${soilDesc})`;
  }

  // Store full profile for dashboard + report
  APP.siteProfile = siteProfile;

  return siteProfile;
}
