---
inclusion: always
---

# Project Structure

```
src/
  config/brand.ts        APP_NAME and storage keys (rename the app here only)
  geo/                   geodesy helpers and step maths
  osm/                   tag classification, Overpass client, cache, compact codec, demo area
  data/                  bundled OSM extract (ODbL)
  tiles/                 TileGrid, rasterization, auto-tiling masks, diagonal smoothing
  town/                  lots, houses, gardens and landmark placement (town layout)
  routing/               walking graph, A*, loop and A→B planners, checkpoints
  render/                palette, tile painter, structure painters, route path, sprites, MapRenderer (canvas)
  ui/                    React map view, settings, quest HUD, dialogue box, data loading hooks
  i18n/                  English and Spanish dictionaries
  App.tsx                screen layout and planner wiring
scripts/                 fixture builder, route probe, screenshot script
screenshots/phaseN/      review screenshots per phase
.kiro/                   steering, specs and hooks
```

## Conventions

- Domain modules are pure and unit-tested next to the code (`*.test.ts`).
- Import with explicit `.ts`/`.tsx` extensions (Node runs the scripts with type stripping).
- No user-facing string outside `src/i18n`. No product name outside `src/config/brand.ts` (and generated HTML via the Vite plugin).
- Every new terrain or tile shape gets a painter test; every planner change gets a fixture test.
