/**
 * sw.js — Verdant Service Worker
 *
 * Strategy:
 *   - App shell (HTML, CSS, JS, data) → Cache-first, update in background
 *   - External APIs (Claude, USGS, NASA, etc.) → Network-first, no cache
 *   - Mapbox tiles → Network-first with 24h cache
 *
 * This lets the full app UI load offline. API calls still need network
 * but degrade gracefully (the app already handles fetch failures).
 */

const CACHE_NAME = 'verdant-v1';

// App shell — everything needed to render the UI offline
const APP_SHELL = [
  '/',
  '/index.html',
  '/src/css/verdant.css',
  '/src/js/app.js',
  '/src/js/modules/state.js',
  '/src/js/modules/nav.js',
  '/src/js/modules/ui.js',
  '/src/js/modules/map.js',
  '/src/js/modules/inat.js',
  '/src/js/modules/claude.js',
  '/src/js/modules/ingest.js',
  '/src/js/modules/terrain.js',
  '/src/js/modules/plan.js',
  '/src/js/modules/calendar.js',
  '/src/js/modules/dashboard.js',
  '/src/js/modules/report.js',
  '/src/js/modules/persist.js',
  '/src/js/modules/plantbrowser.js',
  '/src/js/modules/honesty.js',
  '/src/js/modules/i18n.js',
  '/src/js/modules/tour.js',
  '/src/data/plants.json',
  '/manifest.webmanifest',
];

// Domains that should always go to network (APIs, tiles)
const NETWORK_ONLY_ORIGINS = [
  'api.anthropic.com',
  'epqs.nationalmap.gov',
  'elevation.nationalmap.gov',
  'api.opentopodata.org',
  'api.inaturalist.org',
  'power.larc.nasa.gov',
  'rest.isric.org',
  'api.open-meteo.com',
  'overpass-api.de',
  'api.gbif.org',
  'nominatim.openstreetmap.org',
  'api.mapbox.com',
  'geocoder.ls.hereapi.com',
];

// ── Install: cache the app shell ──────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Cache what we can — don't let one missing file block the whole install
      return Promise.allSettled(
        APP_SHELL.map(url =>
          cache.add(url).catch(err =>
            console.warn(`[SW] Could not cache ${url}:`, err.message)
          )
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ── Activate: clean up old caches ─────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: route requests ─────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Always go to network for external APIs
  if (NETWORK_ONLY_ORIGINS.some(origin => url.hostname.includes(origin))) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Mapbox tile requests — network first, cache 24h
  if (url.hostname.includes('mapbox.com') || url.hostname.includes('mapbox.io')) {
    event.respondWith(networkFirstWithCache(event.request, 'verdant-tiles-v1', 86400));
    return;
  }

  // Google Fonts — cache first
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(cacheFirst(event.request, 'verdant-fonts-v1'));
    return;
  }

  // App shell — cache first, fetch in background to stay fresh
  event.respondWith(staleWhileRevalidate(event.request));
});

// ── Strategies ────────────────────────────────────────────────────────────────

async function staleWhileRevalidate(request) {
  const cache    = await caches.open(CACHE_NAME);
  const cached   = await cache.match(request);
  const fetchPromise = fetch(request)
    .then(response => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  return cached || fetchPromise;
}

async function cacheFirst(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirstWithCache(request, cacheName, maxAgeSeconds) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const headers = new Headers(response.headers);
      headers.append('sw-fetched-at', Date.now().toString());
      const body = await response.clone().arrayBuffer();
      cache.put(request, new Response(body, { status: response.status, headers }));
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      const fetchedAt = parseInt(cached.headers.get('sw-fetched-at') || '0');
      if (Date.now() - fetchedAt < maxAgeSeconds * 1000) return cached;
    }
    throw new Error('Offline and no cached response available');
  }
}
