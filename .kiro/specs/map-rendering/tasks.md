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
- [x] 51. New tile art: asphalt grain, lit kerbs, lane dashes, flagstone and earth paths, grass variations with bush clusters, 3-frame water ripples (static with reduced motion), roof styles, shutters, porches and shop awnings; painter, spec and animation tests; requirement 8 and design section added

## Property-based tests

- [x] 58. Codec and chunk-plan property tests (P-M1, P-D1, P-D2 in `design.md`). No source bug found.

## Day-cycle lighting

- [x] 60. Day-cycle lighting on the map (requirement 9): `daylight.ts` model from solar altitude, multiply tint, lit windows from the real painters, street lamps from `lit` tags or main streets, walker and gem glow, `?time=HH:MM` preview, README section; unit, property (P-L1 to P-L4) and renderer tests. Routing untouched.

## Map renderer rework (Nov 2026, requirements 10 to 13)

- [x] 63.1 Safety net: software canvas test helper, golden frame snapshots of the approved look (5 scenes, day, night at 2×, dusk with water frame and tracks, far zoom with tape and walker, wide detail), counting benchmark with a 7.5 km route (before numbers)
  - _Requirements: 12.7_
- [x] 63.2 `camera.ts` and `viewport.ts`: pure camera (screen ↔ tile, pan, zoom around a point, ladder step, fit, clamp), backing-store limits, hidden canvas, pixel-ratio watcher, clamp on resize (B3, B4, B5, B12, B14); round-trip, zoom-anchor and clamp properties
  - _Requirements: 10.1 to 10.5_
- [x] 63.3 `gestures.ts` and `ui/mapInput.ts`: wheel accumulator, pinch level with hysteresis and pan, inertia, double tap, primary button, safe pointer capture, keyboard; `MapView` only creates the input (B1, B2, B13)
  - _Requirements: 11.1 to 11.7_
- [x] 63.4 `atlas.ts`, `overview.ts`, `chunkLayer.ts`: numeric chunk keys, plan memo, tile-aligned visible-part blits, exact stand-in rectangles, release on eviction and dispose, water entries dropped with their chunk (B7, B8, B9, B16); chunk coverage property at any zoom and pan
  - _Requirements: 10.6, 10.7, 12.3, 12.6_
- [x] 63.5 `lightingLayer.ts`: clock and cache moved out, light only over painted chunks, lamps asked per chunk size, repaint on visibility change (B6, B11, B15); lighting continuity test
  - _Requirements: 12.2, 12.5, 12.8, 9.6_
- [x] 63.6 `overlayLayer.ts`, `footprintLayer.ts`, `walkerMotion.ts`, `bubble.ts`: route layout cached per zoom in world pixels, footprints as cached stamps, culling, rails and tape moved; the route costs under 1500 calls per frame (P1, P2)
  - _Requirements: 12.1, 12.7_
- [x] 63.7 `frameScheduler.ts` and the thin `MapRenderer` facade (B10); public API unchanged
  - _Requirements: 12.4, 13.1, 13.2_
- [x] 63.8 Auto-tile and tile-spec property tests on random grids: reduced masks stay in the 47, map edge counts as connected, 90° rotation symmetry, locality (3 × 3), uniform area is 255
  - _Requirements: 2.4_
- [x] 63.9 Dead code removed (`chevrons`, `ARROW_PATTERNS`, `dir8`, `WINDOW_RGB_COOL`, unused getters, duplicate fill branches); requirement 6a.4 text matches footprints
  - _Requirements: 13.3_
- [x] 63.10 Spec results (before and after timings, visible changes), README index, final `npm test`, `npx tsc -b`, `npm run lint`, `npm run build`
  - _Requirements: 12.7_


## OSM data and rasterizer rework (Nov 2026, requirements 14 to 16)

- [x] 66.1 Safety net: pinned hash of the Benicalap grid (layers, terrain, styles, barriers, rails; same value on the code before the rework), golden frames kept, benchmark test on a 36 km² synthetic area with a continental forest and river (before numbers in `design.md`)
  - _Requirements: 16.1, 16.6_
- [x] 66.2 `geo.ts`: antimeridian wrap and polar guard in `LocalProjection`, `bboxAround` clipped to valid coordinates, `isValidBBox`, exact spherical area; round trip, error-by-latitude and box properties (P-G1 to P-G3)
  - _Requirements: 14.1, 14.2, 16.7_
- [x] 66.3 `rasterize.ts`: grid bounds, per-row crossing buckets, `fillRings` with holes, row-limited `thickSegment`, `line4` that clips and always steps towards its end tile, non-finite and collinear guards, bridge flag and `cutRailsAtBridges`; regression tests on small hand-made areas and properties P-T1 to P-T6
  - _Requirements: 16.1 to 16.6_
- [x] 66.4 `normalize.ts`, `multipolygon.ts`, `classify.ts`: coordinate validation, degenerate areas, multipolygon relations with holes, claimed outer ways, `isTunnel` with explicit tags first, `isBridge`
  - _Requirements: 15.1 to 15.5, 15.9_
- [x] 66.5 `codec.ts` version 4 (bridge flag, holes), `CODEC_VERSION`, `CorruptDataError` and shape checks on decode; round trip with holes and bridges, damage property (P-M2)
  - _Requirements: 15.6, 15.7_
- [x] 66.6 `overpass.ts`, `cache.ts`: box validation and snapping, versioned keys, damaged entries as misses, index validation, clock skew, quota, pruning, IndexedDB reopen, `badArea` message in both languages
  - _Requirements: 14.1 to 14.8, 14.10_
- [x] 66.7 `download.ts`, `demoArea.ts`: answer shape check, timeout remark first, query refuses invalid boxes; one request per mirror unchanged
  - _Requirements: 14.9_
- [x] 66.8 Town layout reviewed (courtyards, grid edge, landmarks, park gates, cost): no defect found; courtyard test added
  - _Requirements: 16.2_
- [x] 66.9 `scripts/build-fixture.ts`: input check, relation merge, newest timestamp, decode check, no empty output
  - _Requirements: 15.8_
- [x] 66.10 Spec results (before and after timings), README index, `osm-etiquette.md` notes, final `npm test`, `npx tsc -b`, `npm run lint`, `npm run build`
  - _Requirements: 16.1_

## Town layout review (Nov 2026, requirement 17)

- [x] 69.1 Review of `town/layout.ts` written into `design.md` ("Town layout review"): findings B1 to B6, checked-correct list, performance, target modules
  - _Requirements: 17.1 to 17.9_
- [x] 69.2 Split `layout.ts` into `types.ts`, `random.ts`, `blocks.ts` (block analysis, BSP, largest rectangle), `landmarks.ts`, `houses.ts`; `layout.ts` keeps `layoutTown`, `townFor` and the public names; tile-to-block array instead of a `Set` per block
  - _Requirements: 17.9_
- [x] 69.3 Landmarks independent of data order, deduplicated per kind and tile, unknown kinds and bad coordinates ignored (B1, B2, B3); regression tests `town/review.test.ts` failed before the fix
  - _Requirements: 17.1, 17.3, 17.4_
- [x] 69.4 Park gates reserve their tiles, stay inside the map and off landmarks and houses (B4, B5)
  - _Requirements: 17.2, 17.5_
- [x] 69.5 No tree on a fence tile (B6), random draws unchanged
  - _Requirements: 17.6_
- [x] 69.6 Property tests P-Y1 to P-Y4 on random maps with random points
  - _Requirements: 17.1 to 17.6_
- [x] 69.7 `layoutBench.test.ts` timings (before and after in `design.md`), golden hash of the night far-zoom frame updated with the reason documented
  - _Requirements: 17.8_

## OpenStreetMap credit placement (requirement 18)

- [x] 72.1 One fixed bottom-left credit with link on the planner and quest maps; stray placement rules removed; HUD and banners clear of it; `attribution.test.ts`, `MapView.test.tsx`
  - _Requirements: 18.1 to 18.4_

## Streaming multi-area world (requirement 19)

- [x] 70.1 Spec: requirement 19, design section (architecture, data flow, cell size, etiquette, memory budget, failure modes), tasks
  - _Requirements: 19.1 to 19.18_
- [x] 70.2 `world/cells.ts`: cell ids, bounds, cells in a box, nearest-first order, batch planning; example and property tests
  - _Requirements: 19.1, 19.2_
- [x] 70.3 `world/slice.ts`, `world/worldData.ts`, `world/coverage.ts`: per-cell records, append-only merge with stitching and dedupe; tests (split way, duplicates, order independence)
  - _Requirements: 19.7, 19.8_
- [x] 70.4 `routing/graph.ts`: `GraphAccumulator`; incremental graph equals the one-go graph; existing routing tests unchanged
  - _Requirements: 19.11_
- [x] 70.5 `osm/overpass.ts`: `loadCells` (per-cell cache, one request, slicing, cell index and pruning); fake-timer tests for in flight, spacing, expiry, damaged entries
  - _Requirements: 19.3, 19.6, 19.7_
- [x] 70.6 `tiles/grid.ts` windows and blit, `town/layout.ts` owned-rect layout, `world/tileWorld.ts`: per-cell raster, town units, rails, events; seam and order tests
  - _Requirements: 19.9, 19.10, 19.14_
- [x] 70.7 `world/liveWorld.ts`: records, snapshots, LRU eviction with route protection; quest-not-disturbed invariant tests
  - _Requirements: 19.12, 19.15, 19.16, 19.17_
- [x] 70.8 `world/streamer.ts`: view to batches, debounce, cancel stale, per-minute cap, back-off, online check; fake-timer tests
  - _Requirements: 19.2 to 19.5_
- [x] 70.9 Renderer: `TownLookup`, chunk invalidation, loading stipple, incremental overview, far overview, view notifications; golden frames unchanged; far-zoom bench
  - _Requirements: 19.13, 19.14_
- [x] 70.10 App wiring (`useMapData`, `useArea`, `App`, `QuestScreen`, `MapView`): the world is a `LiveWorld`, streaming runs in the planner and in a quest, off under Vitest
  - _Requirements: 19.12, 19.16, 19.18_
- [x] 70.11 Docs: `osm-etiquette.md`, specs README, other specs' cross references; final `npm test`, `npx tsc -b`, `npm run lint`, `npm run build`
  - _Requirements: 19.1 to 19.18_

- [x] 70.12 Field fix: whole view covered and soft frontier (requirements 19.19 to 19.22)
  - [x] 70.12.1 Spec: requirements 19.19 to 19.22, design section
  - [x] 70.12.2 `world/window.ts`: `worstCellsTouched`, `questMinZoom`; property tests
  - [x] 70.12.3 `Camera.minZoom`, renderer floor while a quest is active; tests
  - [x] 70.12.4 `LiveWorld.frontier()` and `render/frontier.ts` (dithered fog band); tests
  - [x] 70.12.5 Spanish copy: "punto de control" in the quest HUD and results; 320 px fit test
  - _Requirements: 19.19 to 19.22_

- [x] 73 Map loading v2 (field report 3: blank map and a strip of tiles on mobile, loading slow or never finished)
  - [x] 73.1 Root cause in design.md: measured sizes and costs, the budget arithmetic, the shared-link race, the stuck dependencies; what was checked and is not a cause
  - [x] 73.2 Spec: requirement 20, earlier criteria of 19 marked superseded, design section, tasks
  - [x] 73.3 `osm/download.ts`: hedged mirrors (`fetchMirrors`), header, stall and total timeouts, caller abort; `osm/download.worker.ts` passes the mirror order, the coarse query and aborts
    - _Requirements: 20.9_
  - [x] 73.4 `osm/coarse.ts`, `world/regions.ts`: coarse query and filter, regions of 5 × 5 cells; tests including the share of points on the bundled extract
    - _Requirements: 20.1_
  - [x] 73.5 `osm/overpass.ts`: two slots, 1.5 s gap, 75 s deadline, mirror order, `loadCoarse` and `cachedCoarse`, cache read and write limits, writes after hand-over; tests
    - _Requirements: 20.2, 20.7, 20.9, 20.11_
  - [x] 73.6 `world/tileWorld.ts`, `town/layout.ts`: coarse paint without town, buildings built whole by the cell that holds their centre (spill lookup, landmarks never on a foreign building); order, overlap and drop tests
    - _Requirements: 20.3, 20.12_
  - [x] 73.7 `world/liveWorld.ts`: coarse records, no stipple on coarse cells, frontier at the edge of everything drawn, fall-back to coarse on eviction; tests
    - _Requirements: 20.3, 20.6_
  - [x] 73.8 `world/streamer.ts`: cache pass, two lanes, adaptive batch with ceiling, jittered back-off, rate and slot limits, route ahead, watchdog, one cell per task, load state; fake-timer and slow-link tests
    - _Requirements: 20.4 to 20.11, 20.14, 20.15_
  - [x] 73.9 `world/window.ts`, renderer: floor counts regions at wide zooms; the view callback carries zoom and horizon box; tests
    - _Requirements: 20.13_
  - [x] 73.10 `useStreaming`, `useArea`, `App`, `QuestScreen`, `MapView`: `data-map-ready` and `data-map-pending` on the canvas; test
    - _Requirements: 20.15_
  - [x] 73.11 Docs: `osm-etiquette.md` (new limits and reasons, attribution), `OSM_ATTRIBUTION`, specs README; `npm test`, `npx tsc -b`, `npm run lint`, `npm run build`
    - _Requirements: 20.7 to 20.10, 20.16_
  - [x] 73.12 Field benchmark fix: the frame follows the view during a route or quest (requirement 20.17); readiness over every cell the camera shows; `LiveWorld.recentre`/`paintNext`, streamer re-anchor, `MapView` rebuild at the same place, renderer ignores a moved source; regression `world/panAway.test.ts`; Root cause "Cause 0"
    - _Requirements: 20.15, 20.17_


- [x] 74 The map is drawn from vector tiles (field benchmark 3: Overpass at capacity, 8 of 11 requests failed, the view stayed blank for 150 s)
  - [x] 74.1 Root cause and measurements in design.md ("Map data from vector tiles"); requirement 21; superseded and amended criteria of 19 and 20 marked
  - [x] 74.2 `vector/tileMath.ts`, `vector/omt.ts`: Mercator tiles; OpenMapTiles to tags to the existing classifier; exact clipping at the tile edge; tests with tiles encoded in the test
    - _Requirements: 21.2, 21.3, 21.6_
  - [x] 74.3 `vector/assemble.ts`, `OsmWay.anchor`, `TileWorld` ownership by anchor: cells from tiles, building groups across seams; seam and order tests
    - _Requirements: 21.5, 21.6_
  - [x] 74.4 `vector/client.ts`, `vector/fetchTile.ts`, tile messages in `osm/download.worker.ts`: TileJSON at run time, IndexedDB and HTTP cache, six slots, timeouts, persistent worker; tests
    - _Requirements: 21.2, 21.8, 21.13_
  - [x] 74.5 `world/liveWorld.ts`: drawn records, paint preference, readiness and frontier over what is painted, eviction of drawn cells; tests
    - _Requirements: 21.7, 21.14_
  - [x] 74.6 `world/streamer.ts`: tile lane (coarse, detail, route ahead), graph lane for Overpass cells, no horizon prefetch; Overpass failure never changes drawing; tests
    - _Requirements: 21.1, 21.4, 21.5, 21.8 to 21.10_
  - [x] 74.7 `world/window.ts`: floor in z12/z14 tiles and the frame; renderer without the horizon box; tests
    - _Requirements: 21.11_
  - [x] 74.8 Credit "OpenFreeMap © OpenMapTiles © OpenStreetMap contributors" with three links, narrow sans font, `OSM_ATTRIBUTION`; fit test at 320 px
    - _Requirements: 21.12_
  - [x] 74.9 Dead code of the Overpass drawing path removed (coarse query, regions, `loadCoarse`, horizon); steering (`osm-etiquette.md` tile use, `tech.md`, `structure.md`, `copy-voice.md`), README; `npm test`, `npx tsc -b`, `npm run lint`, `npm run build`
