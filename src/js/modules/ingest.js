/**
 * ingest.js
 * Property ingestion pipeline (Stage 1 + Stage 2).
 *
 * Given a lat/lng (from geocoding the property address), fetches:
 *   1. Elevation          — OpenTopoData SRTM30m
 *   2. Climate & rainfall — NASA POWER (annual + extra AG parameters)
 *   3. Frost dates        — derived from NASA POWER T2M_MIN monthly data
 *   4. Soil description   — ISRIC SoilGrids (texture, pH, SOC, N, CEC)
 *   5. Hardiness zone     — phzmapi.org via BigDataCloud ZIP lookup (US)
 *                         — derived mathematically from T2M_MIN (non-US fallback)
 *
 * All APIs are free and require no keys.
 * Results are written into APP.property and APP.siteProfile.
 *
 * Export: runIngestion(lat, lng) → Promise<siteProfile>
 */

import { APP } from './state.js';

// ── API helpers ────────────────────────────────────────────────────────

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, opts);
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

// ── 2. NASA POWER — Stage 1 + Stage 2 parameters ──────────────────────
//
// Stage 1 (existing):
//   PRECTOTCORR       = precipitation (mm/day annual mean)
//   T2M               = temperature 2m (°C annual mean)
//   T2M_MIN           = min temp (°C annual mean of daily mins)
//   T2M_MAX           = max temp (°C annual mean of daily maxs)
//   ALLSKY_SFC_SW_DWN = solar irradiance (kWh/m²/day)
//
// Stage 2 (new):
//   GWETROOT  = root zone soil wetness (0–1, dimensionless)
//   GWETTOP   = surface soil wetness (0–1)
//   EVPTRNS   = evapotranspiration (MJ/m²/day)
//   WS10M     = wind speed at 10m (m/s)
//   CLOUD_AMT = cloud cover (%)
//   RH2M      = relative humidity at 2m (%)

async function fetchNASAPower(lat, lng) {
  const params = [
    'PRECTOTCORR', 'T2M', 'T2M_MIN', 'T2M_MAX',
    'ALLSKY_SFC_SW_DWN',
    'GWETROOT', 'GWETTOP', 'EVPTRNS', 'WS10M', 'CLOUD_AMT', 'RH2M',
  ].join(',');
  const url = `https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=${params}&community=AG&longitude=${lng}&latitude=${lat}&format=JSON`;
  try {
    const data = await fetchJSON(url);
    const p = data.properties?.parameter;
    if (!p) return null;

    // Annual averages (key 'ANN')
    const rain_mm_day  = p.PRECTOTCORR?.ANN       ?? null;
    const temp_mean    = p.T2M?.ANN               ?? null;
    const temp_min     = p.T2M_MIN?.ANN           ?? null;
    const temp_max     = p.T2M_MAX?.ANN           ?? null;
    const solar        = p.ALLSKY_SFC_SW_DWN?.ANN ?? null;
    const gwetroot     = p.GWETROOT?.ANN          ?? null;
    const gwettop      = p.GWETTOP?.ANN           ?? null;
    const evptrns      = p.EVPTRNS?.ANN           ?? null;
    const wind_ms      = p.WS10M?.ANN             ?? null;
    const cloud_pct    = p.CLOUD_AMT?.ANN         ?? null;
    const humidity_pct = p.RH2M?.ANN              ?? null;

    // Monthly min temps — find frost months (below 0°C)
    const monthlyMins = p.T2M_MIN
      ? Object.entries(p.T2M_MIN)
          .filter(([k]) => k !== 'ANN')
          .map(([k, v]) => ({ month: parseInt(k), temp: v }))
      : [];
    const frostMonths = monthlyMins.filter(m => m.temp <= 0).map(m => m.month);

    // Monthly rainfall
    const monthlyRain = p.PRECTOTCORR
      ? Object.entries(p.PRECTOTCORR)
          .filter(([k]) => k !== 'ANN')
          .map(([k, v]) => ({ month: parseInt(k), mm_day: v }))
      : [];

    // Monthly soil moisture — find drought risk months (gwetroot < 0.3)
    const monthlyGwetroot = p.GWETROOT
      ? Object.entries(p.GWETROOT)
          .filter(([k]) => k !== 'ANN')
          .map(([k, v]) => ({ month: parseInt(k), wetness: v }))
      : [];
    const droughtMonths = monthlyGwetroot
      .filter(m => m.wetness !== null && m.wetness < 0.3)
      .map(m => m.month);

    return {
      rain_mm_year:  rain_mm_day !== null ? Math.round(rain_mm_day * 365) : null,
      rain_mm_day,
      temp_mean:     temp_mean  !== null ? +temp_mean.toFixed(1)  : null,
      temp_min:      temp_min   !== null ? +temp_min.toFixed(1)   : null,
      temp_max:      temp_max   !== null ? +temp_max.toFixed(1)   : null,
      solar_kwh:     solar      !== null ? +solar.toFixed(2)      : null,
      // Stage 2 additions
      gwetroot:      gwetroot   !== null ? +gwetroot.toFixed(2)   : null,
      gwettop:       gwettop    !== null ? +gwettop.toFixed(2)    : null,
      evptrns_mj:    evptrns    !== null ? +evptrns.toFixed(2)    : null,
      wind_ms:       wind_ms    !== null ? +wind_ms.toFixed(1)    : null,
      cloud_pct:     cloud_pct  !== null ? Math.round(cloud_pct)  : null,
      humidity_pct:  humidity_pct !== null ? Math.round(humidity_pct) : null,
      frost_months:  frostMonths,
      drought_months: droughtMonths,
      monthly_rain:  monthlyRain,
    };
  } catch {
    return null;
  }
}

// ── 3. Open-Meteo — timezone hint ─────────────────────────────────────

async function fetchOpenMeteo(lat, lng) {
  const url = `https://climate-api.open-meteo.com/v1/climate?latitude=${lat}&longitude=${lng}&start_date=2000-01-01&end_date=2009-12-31&models=ERA5&daily=precipitation_sum,temperature_2m_max,temperature_2m_min&timezone=auto`;
  try {
    const data = await fetchJSON(url);
    return { timezone: data.timezone ?? null };
  } catch {
    return null;
  }
}

// ── 4. SoilGrids — Stage 1 + Stage 2 properties ───────────────────────
//
// Stage 1 (existing): phh2o, soc, clay, sand, silt, bdod
// Stage 2 (new):      nitrogen, cec
//
// All fetched in one API call to stay within rate limits.

async function fetchSoilGrids(lat, lng) {
  const props = ['phh2o', 'soc', 'clay', 'sand', 'silt', 'bdod', 'nitrogen', 'cec'];
  const paramStr = props.map(p => `property=${p}`).join('&');
  const soilUrl = `https://rest.isric.org/soilgrids/v2.0/properties/query?lon=${lng}&lat=${lat}&${paramStr}&depth=0-5cm&depth=5-15cm&depth=15-30cm&value=mean`;
  try {
    const data = await fetchJSON(soilUrl);
    const layers = data.properties?.layers;
    if (!layers?.length) return null;

    // Helper: get mean value for a property, averaged across the 0–30cm depths
    const get = (name) => {
      const layer = layers.find(l => l.name === name);
      if (!layer?.depths?.length) return null;
      const vals = layer.depths.map(d => d.values?.mean).filter(v => v != null);
      if (!vals.length) return null;
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };

    const ph_raw   = get('phh2o');    // pH × 10
    const soc_raw  = get('soc');      // g/kg × 10
    const clay     = get('clay');     // g/100g × 10 = %×10
    const sand     = get('sand');
    const silt     = get('silt');
    const bd_raw   = get('bdod');     // bulk density cg/cm³
    const n_raw    = get('nitrogen'); // cg/kg (divide by 100 → g/kg)
    const cec_raw  = get('cec');      // mmol(c)/kg (divide by 10 → cmol(c)/kg)

    return {
      ph:          ph_raw  != null ? (ph_raw  / 10).toFixed(1)   : null,
      soc_gkg:     soc_raw != null ? (soc_raw / 10).toFixed(1)   : null,
      clay_pct:    clay    != null ? Math.round(clay    / 10)    : null,
      sand_pct:    sand    != null ? Math.round(sand    / 10)    : null,
      silt_pct:    silt    != null ? Math.round(silt    / 10)    : null,
      bd_gcm3:     bd_raw  != null ? (bd_raw  / 100).toFixed(2)  : null,
      nitrogen_gkg: n_raw  != null ? (n_raw   / 100).toFixed(2)  : null,
      cec_cmol:    cec_raw != null ? (cec_raw / 10).toFixed(1)   : null,
    };
  } catch {
    return null;
  }
}

// ── 5. Hardiness zone ─────────────────────────────────────────────────
//
// For US properties: BigDataCloud (lat/lng → ZIP) → phzmapi.org (ZIP → zone)
// For non-US / fallback: derive mathematically from NASA T2M_MIN

// USDA zone table in °C (lower bound of each half-zone)
const USDA_ZONES = [
  { zone: '1a', minC: -51.1 }, { zone: '1b', minC: -48.3 },
  { zone: '2a', minC: -45.6 }, { zone: '2b', minC: -42.8 },
  { zone: '3a', minC: -40.0 }, { zone: '3b', minC: -37.2 },
  { zone: '4a', minC: -34.4 }, { zone: '4b', minC: -31.7 },
  { zone: '5a', minC: -28.9 }, { zone: '5b', minC: -26.1 },
  { zone: '6a', minC: -23.3 }, { zone: '6b', minC: -20.6 },
  { zone: '7a', minC: -17.8 }, { zone: '7b', minC: -15.0 },
  { zone: '8a', minC: -12.2 }, { zone: '8b', minC: -9.4  },
  { zone: '9a', minC: -6.7  }, { zone: '9b', minC: -3.9  },
  { zone: '10a', minC: -1.1 }, { zone: '10b', minC: 1.7  },
  { zone: '11a', minC: 4.4  }, { zone: '11b', minC: 7.2  },
  { zone: '12a', minC: 10.0 }, { zone: '12b', minC: 12.8 },
  { zone: '13a', minC: 15.6 }, { zone: '13b', minC: 18.3 },
];

function _zoneFromTemp(extremeMinC) {
  let result = USDA_ZONES[0].zone;
  for (const z of USDA_ZONES) {
    if (extremeMinC >= z.minC) result = z.zone;
  }
  return result;
}

async function fetchHardinessZone(lat, lng, nasaTempMin) {
  // Step 1: Try US ZIP-based lookup via BigDataCloud + phzmapi.org
  try {
    const geo = await fetchJSON(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`
    );
    const zip = geo?.postcode;
    const country = geo?.countryCode;

    if (zip && country === 'US') {
      try {
        const zoneData = await fetchJSON(`https://phzmapi.org/${zip}.json`);
        if (zoneData?.zone) {
          return {
            zone:     zoneData.zone,
            source:   'USDA',
            country:  'US',
            zip,
            temp_range_f: zoneData.temperature_range ?? null,
          };
        }
      } catch { /* fall through to math-based */ }
    }

    // Step 2: Math-based derivation from NASA T2M_MIN for non-US or fallback
    if (nasaTempMin != null) {
      // T2M_MIN is mean of daily minimums — extreme annual min is ~8–10°C colder
      // Use a -9°C correction for continental, -6°C for maritime/tropical
      const isMaritime = nasaTempMin > 8 && lat >= -35 && lat <= 35;
      const correction = isMaritime ? -6 : -9;
      const estimatedExtremeMin = nasaTempMin + correction;
      const zone = _zoneFromTemp(estimatedExtremeMin);
      return {
        zone,
        source:  'estimated',
        country: country || null,
        est_extreme_min_c: +estimatedExtremeMin.toFixed(1),
      };
    }
  } catch { /* silent — hardiness is optional enrichment */ }

  return null;
}

// ── Climate description helpers ────────────────────────────────────────

function _describeClimate(nasa, elevation) {
  if (!nasa) return '';
  const { rain_mm_year, temp_mean, frost_months } = nasa;

  let zone = '';
  if (temp_mean !== null && rain_mm_year !== null) {
    if (temp_mean > 18 && rain_mm_year > 1500)      zone = 'Tropical humid';
    else if (temp_mean > 18 && rain_mm_year < 500)  zone = 'Tropical arid';
    else if (temp_mean > 18)                         zone = 'Subtropical';
    else if (temp_mean > 10 && rain_mm_year > 800)  zone = 'Temperate oceanic';
    else if (temp_mean > 10 && rain_mm_year > 400)  zone = 'Temperate continental';
    else if (temp_mean > 10)                         zone = 'Mediterranean / semi-arid';
    else if (temp_mean > 0)                          zone = 'Cool temperate';
    else                                              zone = 'Subarctic / alpine';
  }

  const parts = [];
  if (zone) parts.push(zone);
  if (rain_mm_year !== null)   parts.push(`${rain_mm_year}mm/yr rainfall`);
  if (temp_mean !== null)      parts.push(`avg ${temp_mean}°C`);
  if (frost_months?.length)    parts.push(`${frost_months.length} frost months`);
  if (elevation !== null)      parts.push(`${Math.round(elevation)}m elevation`);

  return parts.join(' · ');
}

function _describeFrost(nasa) {
  if (!nasa?.frost_months?.length) return 'Frost-free';
  const n = nasa.frost_months.length;
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const names = nasa.frost_months.map(m => MONTHS[m - 1]).join(', ');
  return `${n} frost month${n > 1 ? 's' : ''} (${names})`;
}

function _describeRainfall(nasa) {
  if (!nasa?.rain_mm_year) return '';
  const mm = nasa.rain_mm_year;
  let desc = '';
  if      (mm < 250)  desc = 'Arid';
  else if (mm < 500)  desc = 'Semi-arid';
  else if (mm < 800)  desc = 'Moderate';
  else if (mm < 1200) desc = 'Well-watered';
  else if (mm < 2000) desc = 'High rainfall';
  else                desc = 'Very high rainfall';
  return `${desc} — ${mm}mm/yr`;
}

// ── Soil description ───────────────────────────────────────────────────

function _describeSoil(sg) {
  if (!sg) return null;
  const parts = [];

  // USDA texture class from clay + sand
  if (sg.clay_pct != null && sg.sand_pct != null) {
    const c = sg.clay_pct, s = sg.sand_pct;
    let texture = 'Loam';
    if      (c >= 40)              texture = 'Clay';
    else if (c >= 27 && s <= 45)   texture = 'Clay loam';
    else if (c >= 20 && s >= 45)   texture = 'Sandy clay loam';
    else if (s >= 70)              texture = 'Sandy loam';
    else if (s >= 50)              texture = 'Loamy sand';
    parts.push(texture);
  }
  if (sg.ph)            parts.push(`pH ${sg.ph}`);
  if (sg.soc_gkg)       parts.push(`${sg.soc_gkg}g/kg SOC`);
  if (sg.nitrogen_gkg)  parts.push(`${sg.nitrogen_gkg}g/kg N`);
  if (sg.clay_pct)      parts.push(`${sg.clay_pct}% clay`);
  return parts.join(' · ') || null;
}

// ── Describe Stage 2 water balance ────────────────────────────────────

function _describeWaterBalance(nasa) {
  if (!nasa) return null;
  const { gwetroot, drought_months, evptrns_mj, rain_mm_year } = nasa;

  const parts = [];

  // Root zone wetness interpretation
  if (gwetroot != null) {
    let wetnessDesc = '';
    if      (gwetroot >= 0.7) wetnessDesc = 'Well-moistened root zone';
    else if (gwetroot >= 0.5) wetnessDesc = 'Adequate root zone moisture';
    else if (gwetroot >= 0.3) wetnessDesc = 'Moderate root zone stress';
    else                       wetnessDesc = 'Dry root zone — irrigation advised';
    parts.push(wetnessDesc);
  }

  // Drought risk months
  if (drought_months?.length) {
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const names = drought_months.map(m => MONTHS[m - 1]).join(', ');
    parts.push(`Drought risk: ${names}`);
  }

  return parts.join(' · ') || null;
}

// ── Solar potential estimate ───────────────────────────────────────────

function _solarKw(nasa, sizeStr) {
  const irr = nasa?.solar_kwh ?? 4.5;
  const acres = parseFloat(sizeStr) || 1;
  const m2 = acres * 4047;
  const usable = m2 * 0.05;
  const efficiency = 0.18;
  const kw = (usable * efficiency * irr) / 1000;
  return Math.min(50, +kw.toFixed(1));
}

// ── Main export ────────────────────────────────────────────────────────

/**
 * Run the full ingestion pipeline (Stage 1 + Stage 2) for a lat/lng.
 * Writes results into APP.property and APP.siteProfile.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<object>} siteProfile
 */
export async function runIngestion(lat, lng) {
  // All fetches run in parallel — hardiness is lower priority so we
  // run it concurrently; if it fails, it gracefully returns null.
  const [elevation, nasa, meteo, soilGrids] = await Promise.all([
    fetchElevation(lat, lng),
    fetchNASAPower(lat, lng),
    fetchOpenMeteo(lat, lng),
    fetchSoilGrids(lat, lng),
  ]);

  // Hardiness zone runs after NASA (needs temp_min for math fallback)
  const hardiness = await fetchHardinessZone(lat, lng, nasa?.temp_min ?? null);

  const soilDesc    = _describeSoil(soilGrids);
  const waterDesc   = _describeWaterBalance(nasa);

  const siteProfile = {
    lat,
    lng,
    elevation,
    nasa,
    meteo,
    soilGrids,
    hardiness,
    // Derived strings
    climate:       _describeClimate(nasa, elevation),
    rainfall:      _describeRainfall(nasa),
    frost:         _describeFrost(nasa),
    water_balance: waterDesc,
    solar_kw:      _solarKw(nasa, APP.property.size),
    soil_desc:     soilDesc,
    // Raw numbers for gauges / dashboard
    rain_mm_year:   nasa?.rain_mm_year   ?? null,
    temp_mean:      nasa?.temp_mean      ?? null,
    temp_min:       nasa?.temp_min       ?? null,
    solar_kwh_day:  nasa?.solar_kwh      ?? null,
    frost_months:   nasa?.frost_months   ?? [],
    drought_months: nasa?.drought_months ?? [],
    gwetroot:       nasa?.gwetroot       ?? null,
    wind_ms:        nasa?.wind_ms        ?? null,
    cloud_pct:      nasa?.cloud_pct      ?? null,
    humidity_pct:   nasa?.humidity_pct   ?? null,
    fetched_at:     new Date().toISOString(),
  };

  // Write enriched strings into APP.property (used by claude.js prompts)
  APP.property.climate  = siteProfile.climate;
  APP.property.rainfall = siteProfile.rainfall;
  APP.property.frost    = siteProfile.frost;

  // Hardiness zone into APP.property.hardiness
  if (hardiness?.zone) {
    APP.property.hardiness = `Zone ${hardiness.zone}${hardiness.source === 'USDA' ? ' (USDA)' : ' (est.)'}`;
  }

  // Enrich soil — append Stage 2 soil data
  if (soilDesc && !APP.property.soil) {
    APP.property.soil = soilDesc;
  } else if (soilDesc) {
    APP.property.soil = APP.property.soil + ` (SoilGrids: ${soilDesc})`;
  }

  // Store full profile for dashboard + report
  APP.siteProfile = siteProfile;

  return siteProfile;
}
