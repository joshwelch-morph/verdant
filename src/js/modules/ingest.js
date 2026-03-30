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
  // Run all fetches in parallel
  const [elevation, nasa, meteo] = await Promise.all([
    fetchElevation(lat, lng),
    fetchNASAPower(lat, lng),
    fetchOpenMeteo(lat, lng),
  ]);

  const siteProfile = {
    lat,
    lng,
    elevation,
    nasa,
    meteo,
    // Derived strings
    climate:  _describeClimate(nasa, elevation),
    rainfall: _describeRainfall(nasa),
    frost:    _describeFrost(nasa),
    solar_kw: _solarKw(nasa, APP.property.size),
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

  // Store full profile for dashboard + report
  APP.siteProfile = siteProfile;

  return siteProfile;
}
