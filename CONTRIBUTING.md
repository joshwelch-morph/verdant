# Contributing to Verdant

Verdant exists to make regenerative land design accessible to anyone. Contributions that serve that mission are welcome.

If you're a permaculture practitioner, ecologist, developer, or farmer — your knowledge matters here. This project lives or dies on the quality of its design recommendations, not just its code.

---

## Ways to contribute

### Fix a design error

If a design recommendation is ecologically wrong, misleading, or poorly grounded, please open an issue. Describe what the claim is, why it's wrong, and what the evidence says. This is the highest-value contribution you can make.

### Add regional plant data

Currently Verdant generates plant recommendations fresh from Claude each session, using whatever iNaturalist and regional knowledge it can access. A curated regional plant database would make recommendations faster, cheaper, and more accurate.

If you know a bioregion well — Australian temperate, Mediterranean, Pacific Northwest, UK lowlands, tropical Africa, etc. — a structured plant list for that region (even as a JSON or CSV file) would be enormously useful.

See `src/js/modules/claude.js` for the data structure the plant analysis expects.

### Add Northern Hemisphere calendar support

The maintenance calendar (`src/js/modules/calendar.js`) uses Southern Hemisphere months (the proof-of-concept property is in Victoria, Australia). A Northern Hemisphere variant, or a hemisphere-detection/selection system, would make the app useful to a much wider audience.

### Improve the PDF export

The report screen has export buttons that currently show "coming soon" toasts. A working PDF export — ideally using a library like `jsPDF` or `html2canvas`, or a simple print stylesheet — is the most-requested missing feature.

### Offline / low-bandwidth mode

Many rural properties have poor connectivity. Any work toward a progressive web app (PWA) with offline capability, cached map tiles, or reduced API footprint would directly serve the people Verdant is built for.

### Add a build pipeline

Verdant currently uses ES modules directly in the browser with no build step, which keeps the barrier to contribution low. If you add a bundler (Vite is the natural choice), please keep the no-build development path working. Not everyone contributing will want to run `npm install`.

### Translations and i18n

The app currently has no internationalisation infrastructure. If you want to add i18n support, please open an issue first to discuss the approach — there are several reasonable options and it's worth aligning before writing code.

---

## Development setup

No build step required. Open `index.html` in a browser, or serve locally:

```bash
npx serve .
```

For live-reload during development:

```bash
npx browser-sync start --server --files "**/*.html, **/*.css, **/*.js"
```

---

## Code conventions

**JavaScript**
- ES modules throughout (`import`/`export`). No CommonJS.
- One module per concern. Keep modules focused.
- Prefer plain functions over classes.
- Comment the *why*, not the *what*.
- No framework dependencies. Vanilla JS intentionally.

**CSS**
- Design tokens live in `:root` in `verdant.css`. Use them.
- Keep styles in `verdant.css`. Avoid inline styles in JS except for dynamic values that can't be expressed as classes.
- Dark theme is the only theme. The colour palette is defined in `:root`.

**HTML**
- Screen markup lives in `index.html`. IDs are the primary hook for JS.
- Prefer `data-*` attributes over class names for JS behaviour hooks.

---

## Submitting changes

1. Fork the repository
2. Create a branch: `git checkout -b your-feature-name`
3. Make your changes
4. Test in at least one modern browser (Chrome, Firefox, or Safari)
5. Open a pull request with a clear description of what changed and why

For significant changes — new screens, architectural changes, changes to the AI prompts — please open an issue first to discuss the approach.

---

## On the AI prompts

The prompts in `src/js/modules/claude.js` are the heart of what Verdant does. Changes to them should be made carefully, with an understanding of how they affect output quality.

If you're improving a prompt, include before/after examples of the output change in your PR. Prompt changes that make recommendations less grounded or less specific to the property are regressions, even if the output looks more polished.

---

## Ground rules

- Be kind. This is a project about restoration. That should show in how we treat each other.
- Design recommendations must be grounded. If you add a claim, cite the evidence.
- Respect the mission. Changes that make Verdant less accessible — heavier, more complex, paywalled — are not aligned with the project's purpose.

---

*Questions? Open an issue. We'd rather hear from you.*
