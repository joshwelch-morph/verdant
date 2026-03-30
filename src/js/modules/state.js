/**
 * state.js
 * Shared application state. A single mutable object that all modules
 * read from and write to. Import `APP` wherever you need it.
 *
 * Keep this flat and explicit — resist the urge to nest deeply.
 * Every key should be self-documenting.
 */

export const APP = {
  // ── API credentials (session-only, never persisted) ──────────────────
  apiKey: '',
  mapboxToken: '',

  // ── Property profile ────────────────────────────────────────────────
  property: {
    name: 'My Property',
    address: '',
    size: '',
    soil: '',
    water: '',
    goals: [],
    // Derived / enriched during terrain analysis:
    climate: '',
    rainfall: '',
    slope: '',
    frost: '',
    existing: '',
    hardiness: '',
    country: '',
  },

  // ── Map / terrain state ──────────────────────────────────────────────
  // Opportunities the user has selected ("added to design") on the map.
  // Keyed by opportunity ID (e.g. 'swales', 'pond', 'food_forest').
  selectedOpps: new Set(),

  // ── Plants & analysis ────────────────────────────────────────────────
  // Plants the user has explicitly added to their planting plan.
  addedPlants: new Set(),

  // Raw iNaturalist observations (deduped to unique species).
  inatPlants: [],
  inatAnimals: [],

  // Results from the Claude analysis.
  plants: [],
  medicinals: [],
  wildlife: {},

  // Whether the Claude plant analysis has completed at least once.
  analysisRan: false,

  // ── Site profile (from ingestion pipeline) ───────────────────────────
  // Populated by ingest.js after geocoding. Null until first ingestion.
  siteProfile: null,
};
