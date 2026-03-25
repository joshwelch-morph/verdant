# Verdant

**Regenerative land design for everyone.**

Verdant is open source infrastructure for permaculture design. It makes professional-quality regenerative land design accessible to anyone with land and a need — regardless of their ability to pay.

The feeling it exists to create is **relief**.

---

## What it does

You describe your land. Verdant reads the terrain, pulls real local ecological data, and returns a complete, site-specific regenerative design — phased implementation plan, plant list, seasonal calendar, and a design report you can act on.

No permaculture background required. No consultant fee.

**Core capabilities:**

- **Satellite map with real 3D terrain** — Mapbox satellite imagery, elevation exaggeration, contour lines, and a compass. Draw your actual property boundary on the map to calculate acreage.
- **AI terrain analysis** — Samples a 5×5 elevation grid across your property and asks Claude to place design opportunities (swales, ponds, food forests, solar zones) at terrain-logical coordinates with written reasoning for each placement.
- **iNaturalist integration** — Pulls real research-grade plant and animal observations from within 15km of your property. The AI then reasons across local species presence when recommending plants and design responses.
- **Claude plant matching** — Property-specific reasoning for every plant recommendation. Not a generic species list — each entry explains *why this plant suits this land*, wildlife value, where to source it locally, and how it fits the guild.
- **Phased design plan** — Three-phase implementation across Years 1–10, with earthworks specifications and task-level guidance grounded in peer-reviewed permaculture research.
- **Seasonal maintenance calendar** — Month-by-month task schedule with time estimates across all four seasons.
- **Design report** — Aggregated scores for water security, biodiversity, systems selected, and plants added, with a shareable property summary.

---

## Philosophy

Good land design knowledge exists. The problem is access.

Permaculture design courses cost thousands of dollars. Qualified designers charge consulting fees most landholders can't afford. The people who most need regenerative design support — small farmers, rural families, new landholders — are often the ones least able to access it.

Verdant treats that as an infrastructure problem, not a knowledge problem. The knowledge exists. The infrastructure to deliver it, site-specifically and at zero cost, did not — until now.

Every design decision in this codebase is made in service of the person standing on a piece of degraded land wondering where to start.

---

## Getting started

Verdant runs entirely in the browser. There is no backend, no build step, no server to run.

**1. Get API keys**

You need two free API keys:

- **Anthropic API key** — for Claude AI analysis. Create one at [console.anthropic.com](https://console.anthropic.com). New accounts receive free credits.
- **Mapbox token** — for the satellite map. Create one at [account.mapbox.com](https://account.mapbox.com/access-tokens/). The free tier is generous.

Both keys are used only in your browser session. They are never stored, never transmitted to any server other than Anthropic and Mapbox directly.

**2. Open the app**

Open `index.html` in any modern browser. No installation required.

Or serve it locally for development:

```bash
npx serve .
# then open http://localhost:3000
```

**3. Configure your property**

Enter your API keys, property details, location, and primary goals on the setup screen, then click Begin Design.

**4. Use the map**

The map will geocode your address and place AI-analysed design opportunities on the actual terrain. Click any pin to see the terrain reasoning and add it to your design.

Optionally, use the draw tool (pencil icon) to trace your actual property boundary for accurate acreage.

**5. Fetch local species data**

On the Plants screen, expand Data Sources and click Fetch to pull real iNaturalist observations from near your property. This enriches the AI's plant and wildlife analysis with locally-observed species.

**6. Run the analysis**

Click Analyse My Land. Claude will cross-reference your property profile, local iNaturalist species, and regional nursery availability to generate property-specific plant recommendations, native medicinal profiles, and a wildlife overview.

**7. Review your plan, calendar, and report**

Use the bottom navigation to move between the Design Plan, Maintenance Calendar, and Report screens.

---

## Project structure

```
verdant/
├── index.html              # Application shell and screen markup
├── src/
│   ├── css/
│   │   └── verdant.css     # All styles: design tokens, components, screens
│   └── js/
│       ├── app.js          # Entry point — initialises app, wires setup screen
│       └── modules/
│           ├── state.js    # Shared application state (APP object)
│           ├── nav.js      # Screen navigation
│           ├── map.js      # Mapbox map, terrain sampling, AI pin placement
│           ├── inat.js     # iNaturalist API integration
│           ├── claude.js   # Anthropic API calls (terrain analysis + plant matching)
│           ├── plan.js     # Design plan screen rendering
│           ├── calendar.js # Seasonal maintenance calendar
│           ├── report.js   # Report screen rendering
│           └── ui.js       # Shared UI utilities (toast, drawer)
├── docs/
│   └── science.md          # Sources and citations for design claims
├── CONTRIBUTING.md
├── LICENSE
└── README.md
```

---

## Contributing

Verdant is early. There is a long list of things that would make it more useful.

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to get involved.

**Particularly valuable contributions:**

- Regional plant databases (currently the AI generates these fresh each time; curated regional lists would improve accuracy and reduce API cost)
- Offline/low-bandwidth mode (many rural properties have poor connectivity)
- PDF export (the most-requested missing feature)
- Localisation (metric/imperial toggle exists in part; full i18n is a future goal)
- Mobile PWA packaging
- Permaculture practitioner review of design recommendations

If you are a permaculture designer, ecologist, or farmer and you find an error in the design logic, please open an issue. The design recommendations should be grounded in evidence. If they aren't, that's a bug.

---

## The science

The quantitative claims in Verdant's design plan come from peer-reviewed research. Key sources:

- **457% more plant species** — Ponisio et al. (2015), meta-analysis of diversified farming systems, *Proceedings of the Royal Society B*
- **201% more earthworms** — Bengtsson et al. (2005), organic farming meta-analysis
- **+27% soil carbon over 10 years** — no-dig/mulch composting meta-analyses; see `docs/science.md` for full citations
- **15–25% canopy cover for peak groundwater recharge** — Zhang et al. (2001), global forest–water review

These numbers appear in the UI only where the underlying research supports them. Where claims are uncertain or generalised, the language reflects that.

---

## API usage and cost

A full analysis (terrain placement + plant matching with web search) uses approximately:

- ~1,500 tokens for terrain analysis (Claude Sonnet)
- ~6,000–8,000 tokens for plant analysis with web search (Claude Sonnet)

At current Anthropic pricing, a complete property analysis costs roughly $0.05–0.12 USD. The Anthropic free credit tier comfortably covers dozens of analyses.

Mapbox tile loads are within the free tier for typical usage.

---

## License

MIT. See [LICENSE](LICENSE).

Use it, fork it, build on it. If you make something that helps more people restore more land, that's the whole point.
