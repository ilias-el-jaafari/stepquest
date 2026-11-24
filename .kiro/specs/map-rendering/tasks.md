# Map rendering and data: Implementation Plan

Part of the StepQuest specs; see [../README.md](../README.md). Task numbers are the original ids from the single spec, so they are not consecutive here. Do not tick a task until `npm test`, `npx tsc -b`, `npm run lint` and `npm run build` pass.

## Phase 1 — Route planner and tile map

- [x] 3. OSM layer: tag classification, Overpass normalization with shared nodes, compact codec, bundled Benicalap fixture
  - _Requirements: 1.1, 3.6_
- [x] 4. Polite Overpass client with IndexedDB cache, throttling, size cap and fallback endpoint (mocked tests)
  - _Requirements: 1.2, 1.3, 1.4_
- [x] 5. Tile grid and rasterization (polygons, thick roads, 4-connected paths, crossings) with fixture tests
  - _Requirements: 2.1, 2.2, 2.3_
- [x] 6. Auto-tiling: 4-bit and 8-bit blob masks with exhaustive tests
  - _Requirements: 2.4_
- [x] 7. Original procedural tileset, sprites and chunked canvas renderer with pan/zoom and overview map
  - _Requirements: 2.5, 2.6, 1.5_
- [x] 10. Screenshots (390×844 and 1280×800) of a 10k loop and an A→B route in `screenshots/phase1/`

## Phase 3 — Visual polish

- [x] 22. Town layout: building blocks cut into lots (BSP, 4–7 × 4–6 tiles), up to three houses per lot (largest free rectangle, at least 2 × 2), six roof and four wall colours, house / apartment / warehouse styles from the OSM building type, front yards with picket fences or hedges and gates, side gardens, garden trees; cached per grid and painted into the chunk canvases
- [x] 23. Landmarks from OSM points: hospitals and public health centres (healing-centre building with an original cross sign), metro and train stations, schools, park entrances (gates on paths entering big parks), and supermarkets (one chain gets a green special shop with original basket and leaf signs; the rest a generic shop). No brand names, logos or game-specific designs are drawn
- [x] 24. Terrain variety: park styles (lawn with flowers, tall grass, sports pitches, playgrounds, woods, farmland, orchards, cemeteries, gardens), squares and plazas, water with a foam shore, fences, hedges and walls from `barrier=*`, building lots as lawn
- [x] 25. Diagonal streets softened with asphalt corner triangles; footpath corners drawn as quarter rings
- [x] 26. Route drawn as one continuous band (4-connected cells, staircase corners smoothed) with an outline, centre dots and direction arrows every 6 tiles; walked part turns gold
- [x] 27. Walker with four facings from its movement (with hysteresis) and a 3-frame walk cycle; tweened between fixes; reduced-motion aware
- [x] 31. Tests: lot subdivision, largest rectangle, town layout on synthetic and fixture grids, landmark tag mapping and dedupe, way styles, codec v2 (and v1 decoding), diagonal corners, route continuity, arrows and smoothing, walker frames and facing, structure painters, dialogue box, plurals, finished-quest banner and watch stop
- [x] 32. Before / after screenshots (390×844 in Spanish, 1280×800 in English) in `screenshots/phase3/`

## Mobile design

- [x] 50b. Map without holes: ground colour instead of black, time-budgeted nearest-first chunk painting with town-map stand-ins, idle prefetch ring, size-limited chunk cache that keeps on-screen chunks, automatic loading of the area under a rested view (debounced, one request at a time, no retry storms) when no route would be lost; tests for chunk planning, cache, auto-load rule and renderer fills
- [ ] 51. New tile art
