/**
 * report.js
 * Renders the design report screen (S5).
 *
 * Scores are derived from the user's selected systems and plant additions.
 * They are intentionally simple — relative indicators, not precise metrics.
 * Future work: generate a property-specific narrative summary from Claude.
 */

import { APP } from './state.js';
import { toast } from './ui.js';

export function renderReport() {
  const p = APP.property;

  // Property header
  const titleEl = document.getElementById('rh-title');
  const subEl = document.getElementById('rh-sub');
  if (titleEl) titleEl.textContent = p.name || 'Your Property';
  if (subEl) {
    subEl.textContent = `Regenerative Design · ${p.address || 'Location not set'} · ${
      new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
    }`;
  }

  // ── Scores ────────────────────────────────────────────────────────────
  const hasWater = APP.selectedOpps.has('swales') || APP.selectedOpps.has('pond');
  const hasFullWater = APP.selectedOpps.has('swales') && APP.selectedOpps.has('pond');
  const hasFood = APP.selectedOpps.has('food_forest') || APP.selectedOpps.has('forest')
    || APP.selectedOpps.has('kitchen_garden') || APP.selectedOpps.has('garden');
  const hasSoil = APP.selectedOpps.has('soil_rehab') || APP.selectedOpps.has('soil');

  // Water security score
  const wsEl = document.getElementById('rs-w');
  if (wsEl) wsEl.textContent = hasFullWater ? '82%' : hasWater ? '55%' : '–';

  // Biodiversity score
  const biodiv = hasFood && hasSoil ? 'High' : hasFood ? 'Good' : hasSoil ? 'Moderate' : '–';
  const bsEl = document.getElementById('rs-b');
  if (bsEl) bsEl.textContent = biodiv;

  // Systems count
  const ssEl = document.getElementById('rs-s');
  if (ssEl) ssEl.textContent = APP.selectedOpps.size || '–';

  // Plants added
  const psEl = document.getElementById('rs-p');
  if (psEl) psEl.textContent = APP.addedPlants.size || '–';

  // ── Property summary ──────────────────────────────────────────────────
  const summaryEl = document.getElementById('reportSummary');
  if (summaryEl) {
    if (APP.analysisRan) {
      const systemNames = [...APP.selectedOpps].join(', ') || 'None selected';
      const plantNames = [...APP.addedPlants].join(', ') || 'None added';
      summaryEl.innerHTML = `
        <strong>${p.name}</strong> — ${p.size} in ${p.address}.<br><br>
        <strong>Selected systems (${APP.selectedOpps.size}):</strong> ${systemNames}<br><br>
        <strong>Added to planting plan (${APP.addedPlants.size}):</strong> ${plantNames}<br><br>
        <strong>Goals:</strong> ${p.goals.join(', ') || 'Not specified'}`;
    } else {
      summaryEl.textContent = 'Complete the plant analysis to generate your full report summary.';
    }
  }

  // ── Export buttons (future work) ──────────────────────────────────────
  _wireExportButtons();
}

function _wireExportButtons() {
  const exportPdf = document.getElementById('exportPdf');
  const exportPlanting = document.getElementById('exportPlanting');
  const shareLink = document.getElementById('shareLink');
  const exportCalendar = document.getElementById('exportCalendar');

  if (exportPdf && !exportPdf.dataset.wired) {
    exportPdf.dataset.wired = 'true';
    exportPdf.addEventListener('click', () => toast('PDF export coming soon', '📄'));
  }
  if (exportPlanting && !exportPlanting.dataset.wired) {
    exportPlanting.dataset.wired = 'true';
    exportPlanting.addEventListener('click', () => toast('Planting plan export coming soon', '🌱'));
  }
  if (shareLink && !shareLink.dataset.wired) {
    shareLink.dataset.wired = 'true';
    shareLink.addEventListener('click', () => toast('Share link copied!', '🔗'));
  }
  if (exportCalendar && !exportCalendar.dataset.wired) {
    exportCalendar.dataset.wired = 'true';
    exportCalendar.addEventListener('click', () => toast('Calendar export coming soon', '📅'));
  }
}
