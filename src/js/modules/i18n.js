/**
 * i18n.js
 * Internationalisation — Spanish localisation (first language beyond English).
 *
 * The Verdant brief lists Spanish, Portuguese, French, Arabic, Hindi, and
 * Swahili as "not stretch goals — they are the mission made real."
 *
 * This module:
 *   1. Provides a translation dictionary (en → es)
 *   2. Exposes t(key) — returns translated string or falls back to English
 *   3. Renders a language toggle button (EN | ES) in the app header
 *   4. Applies translations to all static UI text via data-i18n attributes
 *   5. Persists language choice to localStorage
 *   6. Passes the active language to Claude prompts so AI output is localised
 *
 * Architecture: data-i18n="key" attributes on HTML elements + JS t() function
 * for dynamic content. No build step, no external library.
 *
 * Adding a new language: add an entry to TRANSLATIONS, then add to LANGUAGES.
 */

// ── Supported languages ──────────────────────────────────────────────────────
export const LANGUAGES = [
  { code: 'en', label: 'EN', name: 'English'  },
  { code: 'es', label: 'ES', name: 'Español'  },
];

// ── Active language ──────────────────────────────────────────────────────────
let _lang = localStorage.getItem('verdant_lang') || 'en';

export function getLang()         { return _lang; }
export function setLang(code)     {
  _lang = code;
  localStorage.setItem('verdant_lang', code);
  applyTranslations();
  _updateToggleBtns();
}

// ── Translation dictionary ───────────────────────────────────────────────────
// Format: { key: { en: '...', es: '...' } }
// Keys use dot notation matching the UI element context.
// Only Spanish is fully populated for launch; other languages stub to English.

const TRANSLATIONS = {
  // ── Setup screen (S0) ──
  'setup.welcome':         { en: 'Welcome to',                                                es: 'Bienvenido a' },
  'setup.tagline':         { en: 'Regenerative land design powered by ecological intelligence. Let\'s set up your workspace.', es: 'Diseño regenerativo del suelo con inteligencia ecológica. Configuremos tu espacio de trabajo.' },
  'setup.api_config':      { en: 'API CONFIGURATION',                                         es: 'CONFIGURACIÓN DE API' },
  'setup.api_key':         { en: 'Anthropic API Key',                                         es: 'Clave API de Anthropic' },
  'setup.api_key_note':    { en: 'Your key is used only in this session and never stored.',    es: 'Tu clave solo se usa en esta sesión y nunca se almacena.' },
  'setup.get_key':         { en: 'Get a key →',                                               es: 'Obtener clave →' },
  'setup.mapbox':          { en: 'Mapbox Token',                                              es: 'Token de Mapbox' },
  'setup.mapbox_note':     { en: 'optional — for satellite map',                              es: 'opcional — para mapa satelital' },
  'setup.property':        { en: 'PROPERTY DETAILS',                                          es: 'DETALLES DE LA PROPIEDAD' },
  'setup.name':            { en: 'Property Name',                                             es: 'Nombre de la propiedad' },
  'setup.location':        { en: 'Location / Address',                                        es: 'Ubicación / Dirección' },
  'setup.size':            { en: 'Property Size',                                             es: 'Tamaño de la propiedad' },
  'setup.soil':            { en: 'Soil type (if known)',                                      es: 'Tipo de suelo (si lo conoces)' },
  'setup.water':           { en: 'Water features',                                            es: 'Características del agua' },
  'setup.goals':           { en: 'Primary Goals',                                             es: 'Objetivos principales' },
  'setup.begin':           { en: 'Begin Design ›',                                            es: 'Iniciar Diseño ›' },

  // ── Goals ──
  'goal.food':             { en: '🍎 Food abundance',                                         es: '🍎 Abundancia alimentaria' },
  'goal.water':            { en: '💧 Water security',                                         es: '💧 Seguridad hídrica' },
  'goal.income':           { en: '💰 Income from land',                                       es: '💰 Ingresos del suelo' },
  'goal.wildlife':         { en: '🦋 Wildlife habitat',                                       es: '🦋 Hábitat para fauna' },
  'goal.soil':             { en: '🪱 Soil restoration',                                       es: '🪱 Restauración del suelo' },
  'goal.maintenance':      { en: '🔧 Low maintenance',                                        es: '🔧 Bajo mantenimiento' },
  'goal.medicinals':       { en: '🌿 Medicinal plants',                                       es: '🌿 Plantas medicinales' },
  'goal.carbon':           { en: '🌳 Carbon storage',                                         es: '🌳 Almacenamiento de carbono' },

  // ── Nav tabs ──
  'nav.map':               { en: 'Map',                                                       es: 'Mapa' },
  'nav.plants':            { en: 'Plants',                                                    es: 'Plantas' },
  'nav.design':            { en: 'Design',                                                    es: 'Diseño' },
  'nav.calendar':          { en: 'Calendar',                                                  es: 'Calendario' },
  'nav.overview':          { en: 'Overview',                                                  es: 'Resumen' },
  'nav.report':            { en: 'Report',                                                    es: 'Informe' },

  // ── Map screen (S1) ──
  'map.title':             { en: 'Your land',                                                 es: 'Tu terreno' },
  'map.sub':               { en: 'Map your property · mark opportunities',                    es: 'Mapea tu propiedad · marca oportunidades' },
  'map.analyse':           { en: 'Analyse Terrain →',                                         es: 'Analizar Terreno →' },

  // ── Plants screen (S2) ──
  'plants.title':          { en: 'Site intelligence',                                         es: 'Inteligencia del sitio' },
  'plants.sub':            { en: 'Fetch local wildlife data, then analyse',                   es: 'Obtén datos locales de flora/fauna, luego analiza' },
  'plants.fetch_wildlife': { en: 'Fetch Wildlife Data',                                       es: 'Obtener Datos de Flora/Fauna' },
  'plants.analyse':        { en: 'Analyse My Land',                                           es: 'Analizar Mi Terreno' },

  // ── Design screen (S3) ──
  'design.title':          { en: 'Your design plan',                                          es: 'Tu plan de diseño' },
  'design.sub':            { en: 'Guilds, systems & companion plantings',                     es: 'Gremios, sistemas y cultivos compañeros' },
  'design.browse':         { en: '🌿 Browse & Add Plants',                                    es: '🌿 Explorar y Agregar Plantas' },
  'design.browse_sub':     { en: 'Search 80+ nursery plants rated for your site',             es: 'Busca más de 80 plantas de vivero evaluadas para tu sitio' },
  'design.placeholder':    { en: 'Your design plan will appear here',                         es: 'Tu plan de diseño aparecerá aquí' },
  'design.run_hint':       { en: 'Run Analyse My Land on the Plants screen to generate your personalised guild plantings, companion pairings, and system checklist.', es: 'Ejecuta "Analizar Mi Terreno" en la pantalla de Plantas para generar tus plantaciones de gremios, parejas compañeras y lista de sistemas.' },

  // ── Calendar screen (S4) ──
  'calendar.title':        { en: 'Seasonal calendar',                                         es: 'Calendario estacional' },
  'calendar.sub':          { en: 'Personalised tasks for your land',                          es: 'Tareas personalizadas para tu terreno' },

  // ── Overview / Dashboard (S6) ──
  'overview.title':        { en: 'Overview',                                                  es: 'Resumen' },
  'overview.vitals':       { en: 'Ecosystem Vitals',                                          es: 'Indicadores del Ecosistema' },
  'overview.terrain':      { en: 'Terrain Analysis',                                          es: 'Análisis del Terreno' },
  'overview.site_cond':    { en: 'Site Conditions',                                           es: 'Condiciones del Sitio' },
  'overview.soil':         { en: 'Soil Health',                                               es: 'Salud del Suelo' },
  'overview.water':        { en: 'Water',                                                     es: 'Agua' },
  'overview.pollinators':  { en: 'Pollinators',                                               es: 'Polinizadores' },
  'overview.solar':        { en: 'Solar',                                                     es: 'Solar' },

  // ── Report screen (S5) ──
  'report.title':          { en: 'Design report',                                             es: 'Informe de diseño' },
  'report.sub':            { en: 'Your complete regenerative land design',                    es: 'Tu diseño completo de tierra regenerativa' },
  'report.export_pdf':     { en: '🖨️ Print / PDF',                                            es: '🖨️ Imprimir / PDF' },
  'report.share':          { en: '🔗 Share Link',                                             es: '🔗 Compartir Enlace' },
  'report.calendar_export':{ en: '📅 Export Calendar',                                        es: '📅 Exportar Calendario' },

  // ── Plant browser ──
  'pb.title':              { en: 'Plant Browser',                                             es: 'Explorador de Plantas' },
  'pb.search':             { en: 'Search by name, role, or type…',                            es: 'Busca por nombre, función o tipo…' },
  'pb.shown':              { en: 'plants shown',                                              es: 'plantas mostradas' },
  'pb.add':                { en: '+ Add to Plan',                                             es: '+ Agregar al Plan' },
  'pb.added':              { en: '✓ Added',                                                   es: '✓ Agregado' },
  'pb.thrives':            { en: '✅ Thrives here',                                           es: '✅ Prospera aquí' },
  'pb.marginal':           { en: '⚠️ Marginal',                                               es: '⚠️ Marginal' },
  'pb.poor':               { en: '❌ Not suited',                                             es: '❌ No apto' },
  'pb.zone_missing':       { en: '📍 Run analysis for zone matching',                         es: '📍 Ejecuta análisis para comparar zonas' },
  'pb.run_analysis':       { en: 'Run analysis for zone matching',                            es: 'Ejecutar análisis para comparar zonas' },

  // ── Honesty banner ──
  'honesty.starting_point':{ en: 'This is a starting point.',                                es: 'Esto es un punto de partida.' },
  'honesty.verify':        { en: 'Verify all recommendations on the ground before acting. No remote tool replaces eyes on the land.', es: 'Verifica todas las recomendaciones sobre el terreno antes de actuar. Ninguna herramienta remota reemplaza los ojos en el campo.' },

  // ── Terrain strip labels ──
  'terrain.elev_range':    { en: 'Elevation range',                                           es: 'Rango de elevación' },
  'terrain.avg_slope':     { en: 'Avg slope',                                                 es: 'Pendiente media' },
  'terrain.aspect':        { en: 'Aspect (faces)',                                            es: 'Orientación' },
  'terrain.swale_zones':   { en: 'Swale zone found',                                          es: 'Zona de acequia encontrada' },
  'terrain.swale_zones_p': { en: 'Swale zones found',                                         es: 'Zonas de acequias encontradas' },

  // ── Slope descriptions ──
  'slope.flat':            { en: 'flat',                                                      es: 'plano' },
  'slope.gentle':          { en: 'gently sloping',                                            es: 'pendiente suave' },
  'slope.moderate':        { en: 'moderately sloping',                                        es: 'pendiente moderada' },
  'slope.steep':           { en: 'steep',                                                     es: 'pronunciado' },
  'slope.very_steep':      { en: 'very steep',                                                es: 'muy pronunciado' },

  // ── Common actions ──
  'action.save':           { en: 'Save',                                                      es: 'Guardar' },
  'action.reset':          { en: 'Reset',                                                     es: 'Reiniciar' },
  'action.close':          { en: 'Close',                                                     es: 'Cerrar' },
  'action.confirm':        { en: 'Confirm',                                                   es: 'Confirmar' },
  'action.cancel':         { en: 'Cancel',                                                    es: 'Cancelar' },
  'action.view_all':       { en: 'View all ›',                                                es: 'Ver todo ›' },

  // ── Sections ──
  'section.systems':       { en: 'Selected Systems',                                          es: 'Sistemas Seleccionados' },
  'section.guilds':        { en: 'Guild Plantings',                                           es: 'Plantaciones de Gremios' },
  'section.layers':        { en: 'Forest Layer Diversity',                                    es: 'Diversidad de Capas del Bosque' },
  'section.checklist':     { en: 'System Checklist',                                          es: 'Lista de Sistemas' },
  'section.your_plan':     { en: 'Your Planting Plan',                                        es: 'Tu Plan de Plantación' },
};

// ── Core t() function ─────────────────────────────────────────────────────────

/**
 * Translate a key to the active language.
 * Falls back to English, then to the key itself.
 * @param {string} key
 * @param {object} [vars]  Optional interpolation vars e.g. { count: 3 }
 */
export function t(key, vars = {}) {
  const entry = TRANSLATIONS[key];
  if (!entry) return key; // unknown key — return as-is
  const str = entry[_lang] ?? entry['en'] ?? key;
  // Simple {{var}} interpolation
  return str.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}

// ── Apply translations to DOM via data-i18n attributes ───────────────────────

/**
 * Walk the DOM and translate all [data-i18n] elements.
 * Also translates [data-i18n-placeholder] for input placeholders.
 */
export function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    el.textContent = t(key);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });

  // Update html lang attribute
  document.documentElement.lang = _lang;
}

// ── Language toggle UI ───────────────────────────────────────────────────────

/**
 * Inject the language toggle into the topbar (called once from app.js).
 */
export function initLangToggle() {
  // Find the topbar — inject toggle before the end
  const topbar = document.querySelector('.topbar, #appTopbar, .tb-right');
  if (!topbar) return;

  // Don't double-insert
  if (document.getElementById('lang-toggle')) return;

  const wrap = document.createElement('div');
  wrap.id    = 'lang-toggle';
  wrap.className = 'lang-toggle';
  wrap.innerHTML = LANGUAGES.map(l =>
    `<button class="lang-btn ${l.code === _lang ? 'lang-active' : ''}" data-lang="${l.code}" title="${l.name}">${l.label}</button>`
  ).join('');

  // Insert at the end of topbar (or append to body header area)
  const tbRight = document.querySelector('.tb-right') || topbar;
  tbRight.appendChild(wrap);

  // Wire click
  wrap.addEventListener('click', e => {
    const btn = e.target.closest('.lang-btn');
    if (!btn) return;
    setLang(btn.dataset.lang);
  });

  applyTranslations();
}

function _updateToggleBtns() {
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('lang-active', btn.dataset.lang === _lang);
  });
}

// ── Claude language instruction ──────────────────────────────────────────────

/**
 * Returns a system-level instruction for Claude to respond in the active language.
 * Inject this into Claude API calls when language !== 'en'.
 */
export function claudeLangInstruction() {
  if (_lang === 'en') return '';
  const names = { es: 'Spanish', pt: 'Portuguese', fr: 'French', ar: 'Arabic', hi: 'Hindi', sw: 'Swahili' };
  const langName = names[_lang] || _lang;
  return `\n\nIMPORTANT: Respond entirely in ${langName}. All plant names, descriptions, and explanations must be in ${langName}. Keep scientific (Latin) names in Latin.`;
}
