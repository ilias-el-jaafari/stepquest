---
inclusion: always
---

# Project Structure

```
src/
  config/brand.ts        APP_NAME and storage keys (rename the app here only)
  geo/                   geodesy helpers and step maths
  osm/                   tag classification, Overpass client (walking graph), cache, compact codec, demo area
  vector/                OpenFreeMap vector tiles: tile maths, OpenMapTiles mapping and clipping, cell assembly, tile client (drawing), walking network from tiles (walkNet)
  data/                  bundled OSM extract (ODbL)
  tiles/                 TileGrid, rasterization, auto-tiling masks, diagonal smoothing
  town/                  lots, houses, gardens and landmark placement (town layout)
  world/                 streamed multi-area world: 0.01° cells, per-cell records, merge and stitching, frame tiles, live world, cell streamer, walking-area loader, Overpass tag enrichment
  routing/               walking graph, A*, loop and A→B planners, checkpoints
  render/                palette, tile painter, structure painters, route path, sprites, MapRenderer (canvas)
  app/                   app state reducer (appState.ts) and the hooks around it: planning, map area and location, number fields, today's steps, online status
  pwa/                   service worker template (filled in by the build) and the update store
  ui/                    React map view, planner, tab sheets, quest HUD, dialogs (modal focus), error boundary, sound menu, data loading hooks
  demo/                  self-playing `?demo=1` run: script, clock and camera maths (pure)
  audio/                 formant voice, callouts, chiptune, effects, scheduler, sound settings, Web Audio engine
  i18n/                  English and Spanish dictionaries
  App.tsx                screen layout: wires app/ state to ui/ components (about 300 lines)
scripts/                 fixture builder, route probe, screenshot script
screenshots/phaseN/      review screenshots per phase
.kiro/                   steering, specs and hooks
```

## Conventions

- Domain modules are pure and unit-tested next to the code (`*.test.ts`).
- Import with explicit `.ts`/`.tsx` extensions (Node runs the scripts with type stripping).
- No user-facing string outside `src/i18n`. No product name outside `src/config/brand.ts` (and generated HTML via the Vite plugin).
- Every new terrain or tile shape gets a painter test; every planner change gets a fixture test.
