/**
 * honesty.js
 * Data quality and "verify on ground" transparency banner.
 *
 * The Verdant brief is explicit: "Boots on the ground are irreplaceable.
 * The map is not the territory. Every design output must include a clear
 * statement — not in fine print but in the interface."
 *
 * This module renders a persistent banner on all output screens (Dashboard,
 * Design Plan, Report) that communicates:
 *   1. What terrain data resolution was used (1m LiDAR / 10m / 30m)
 *   2. That the design is a starting point, not a finished plan
 *   3. A prompt to verify on the ground before acting
 *
 * The banner is dismissible per session (not permanently — it should always
 * be visible on first view of any session).
 */

import { APP } from './state.js';

// ── Session dismiss tracking (in-memory only, resets each page load) ───────
const _dismissed = new Set();

// ── Quality configs ─────────────────────────────────────────────────────────

function _qualityConfig(terrain) {
  if (!terrain) {
    return {
      icon:    '📡',
      label:   'No terrain data',
      detail:  'Terrain analysis not yet run. Visit the Map screen to analyse your site.',
      quality: 'none',
      color:   '#8a9e8b',
      bg:      'rgba(138,158,139,.08)',
      border:  'rgba(138,158,139,.25)',
    };
  }

  const res = terrain.resolution ?? 30;
  const src = terrain.quality?.source ?? 'unknown';

  if (terrain.quality?.quality === 'high') {
    return {
      icon:    '🛰️',
      label:   terrain.quality.label,
      detail:  terrain.quality.detail,
      quality: 'high',
      color:   '#2d6b3c',
      bg:      'rgba(78,168,96,.08)',
      border:  'rgba(78,168,96,.28)',
    };
  }
  if (terrain.quality?.quality === 'medium') {
    return {
      icon:    '📡',
      label:   terrain.quality.label,
      detail:  terrain.quality.detail,
      quality: 'medium',
      color:   '#7a4e12',
      bg:      'rgba(200,146,58,.08)',
      border:  'rgba(200,146,58,.28)',
    };
  }
  // low / 30m SRTM
  return {
    icon:    '⚠️',
    label:   terrain.quality?.label ?? '30m global',
    detail:  terrain.quality?.detail ?? 'SRTM 30-metre resolution — each data point covers a 30×30m area',
    quality: 'low',
    color:   '#8a2020',
    bg:      'rgba(200,72,72,.07)',
    border:  'rgba(200,72,72,.22)',
  };
}

// ── Banner HTML ─────────────────────────────────────────────────────────────

function _bannerHTML(screenId, terrain, config) {
  const isUS       = terrain?.isUS ?? false;
  const resolution = terrain?.resolution ?? 30;

  // Build the resolution badge
  const resBadge = config.quality === 'high'
    ? `<span class="hb-res-badge hb-res-high">${config.label}</span>`
    : config.quality === 'medium'
    ? `<span class="hb-res-badge hb-res-medium">${config.label}</span>`
    : `<span class="hb-res-badge hb-res-low">${config.label}</span>`;

  // Build the what-this-means line
  const dataLine = terrain
    ? `${config.icon} <strong>${config.detail}</strong>`
    : `${config.icon} Terrain analysis not yet run`;

  // The permanent honesty statement — always shown, same wording
  const honestyLine = `🌿 <strong>This is a starting point.</strong> Verify all recommendations on the ground before acting. No remote tool replaces eyes on the land.`;

  return `
<div class="hb-banner" id="hb-${screenId}" style="border-color:${config.border};background:${config.bg}">
  <div class="hb-content">
    <div class="hb-row hb-data-row">
      <span class="hb-data-text">${dataLine}</span>
      ${resBadge}
    </div>
    <div class="hb-divider"></div>
    <div class="hb-row hb-honesty-row">
      <span class="hb-honesty-text">${honestyLine}</span>
    </div>
  </div>
  <button class="hb-dismiss" data-screen="${screenId}" title="Dismiss for this session">✕</button>
</div>`;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Render (or update) the honesty banner in a container element.
 *
 * @param {string} screenId   e.g. 'dashboard', 'plan', 'report'
 * @param {string} containerId  The element ID to prepend the banner into
 */
export function renderHonestyBanner(screenId, containerId) {
  if (_dismissed.has(screenId)) return;

  const container = document.getElementById(containerId);
  if (!container) return;

  // Remove existing banner if any
  const existing = document.getElementById(`hb-${screenId}`);
  if (existing) existing.remove();

  const terrain = APP.siteProfile?.terrain ?? null;
  const config  = _qualityConfig(terrain);

  const wrapper = document.createElement('div');
  wrapper.className = 'hb-wrap';
  wrapper.innerHTML = _bannerHTML(screenId, terrain, config);

  // Prepend — banner appears at top of content area
  container.insertBefore(wrapper, container.firstChild);

  // Wire dismiss button
  const dismissBtn = wrapper.querySelector('.hb-dismiss');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      _dismissed.add(screenId);
      wrapper.style.transition = 'opacity .2s, max-height .3s';
      wrapper.style.opacity = '0';
      wrapper.style.maxHeight = '0';
      wrapper.style.overflow = 'hidden';
      setTimeout(() => wrapper.remove(), 320);
    });
  }
}

/**
 * Update all currently-rendered honesty banners (call after ingestion
 * completes so they reflect the new terrain data quality).
 */
export function refreshHonestyBanners() {
  ['dashboard', 'plan', 'report'].forEach(id => {
    const existing = document.getElementById(`hb-${id}`);
    if (existing) {
      // Re-render by removing and re-calling
      const wrap = existing.closest('.hb-wrap');
      if (wrap) {
        const containerId = wrap.parentElement?.id;
        if (containerId) {
          wrap.remove();
          _dismissed.delete(id); // force re-show with updated data
          renderHonestyBanner(id, containerId);
        }
      }
    }
  });
}
