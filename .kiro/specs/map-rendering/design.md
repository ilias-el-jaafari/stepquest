# Map rendering and data: Design

Part of the StepQuest specs; see [../README.md](../README.md). See also: [routing](../routing/requirements.md), [quest](../quest/requirements.md) (route and walker overlays), [retro-ui](../retro-ui/requirements.md) (dialogue box, plural forms).

## Overview

A client-only React app. All heavy lifting is pure TypeScript: OSM normalization, rasterization, auto-tiling and routing run without the DOM and are tested against the bundled Benicalap extract. The renderer is a small canvas engine in the style of old console map engines: a tile grid, a lazily painted tile atlas, cached 32×32-tile chunks, and sprites drawn on top.

## Architecture

```mermaid
flowchart LR
  Overpass[(Overpass API)] --> Client[OverpassClient + IndexedDB cache]
  Fixture[(benicalap.osm.json)] --> Decode[decodeOsm]
  Client --> Normalize[normalizeOverpass]
  Normalize --> Data[OsmData]
  Decode --> Data
  Data --> Raster[rasterizeOsm → TileGrid]
  Data --> Graph[WalkGraph CSR]
  Raster --> Autotile[mask4 / mask8 → blob]
  Autotile --> Renderer[MapRenderer]
  Graph --> Planner[planLoop / planOneWay]
  Planner --> Checkpoints[placeCheckpoints]
  Checkpoints --> Renderer
  Planner --> UI[React panel]
```

## Data model

- `OsmData`: shared node arrays (`lat`, `lon`) plus ways `{ kind, highway, walkable, area, tunnel, crossing, nodes[] }`. Shared node indices encode junctions.
- Compact JSON (`CompactOsm`): delta-encoded 1e-6° integers and flat way rows; the 13.4k-way demo extract is 1.55 MB (≈469 kB gzip, the built `benicalap.osm` chunk) and lazy-loaded.

## Tile grid

- Origin at the bbox's north-west corner, equirectangular projection, 5 m per tile (Benicalap: ≈636 × 646 tiles).
- Roads are thick segments sized by highway class (6–16 m); paths are 4-connected one-tile lines; areas are scanline-filled at tile centres.
- Layer bits per tile, resolved to one terrain. Sidewalks overlapping a drawn carriageway stay road; only `footway=crossing` turns road into zebra.

## Auto-tiling

- `mask4`: N=1, E=2, S=4, W=8. Paths connect to paths, crossings and (one-way) roads.
- `mask8`: N, NE, E, SE, S, SW, W, NW = 1…128; `reduceMask8` clears a diagonal unless both neighbouring cardinals are set → 47 masks (`BLOB_MASKS`).
- The map edge counts as connected so no borders appear at the edge of the loaded area.

## Rendering

- Module layout and the reasons for it: see "Architecture review (Nov 2026)" below (`MapRenderer` is a facade over camera, chunk, lighting and overlay layers).
- `paintTile(ctx, x, y, spec)` draws a tile from `(terrain, m4, m8, variant, roof, vertical)`; the atlas paints each distinct key once.
- Chunks (32×32 tiles = 512×512 px) are cached with an LRU of 96. Zoom ladder 0.5–48 CSS px per tile; ≥ 8 draws tiles, below that a 1-px-per-tile overview image.
- Overlay: route cells (4-connected rasterization of the polyline) as footprints, numbered checkpoint gems, finish flag, start mat and walker sprite.

## Tile art (task 51)

**Tile catalogue** (`src/render/tileset.ts`, `tileSpecs.ts`, `structures.ts`):

| Tile | Art | Chosen by |
| --- | --- | --- |
| Road | asphalt grain, crack on variant 5, kerb band with paving joints, lit/shaded kerb line, dashed centre line | `m8`, `variant`, `lane` |
| Crossing | grained asphalt, white bars with shaded lower or right row | `vertical` |
| Path, park | packed earth: `pathA/B`, specks, pebbles | `surface` 0 |
| Path, town | 4×4 flagstones in staggered rows, joints, lit corner | `surface` 1 |
| Plaza | slabs with joints and lit corners | `variant`, `m8` |
| Park grass | tufts (2, 3; also edge tiles that would hold a tree), stones (4, 7), flowers (5, 6), tree (0, 1 on interior tiles), bush beside a tree | `variant`, `deco` |
| Water | 3 ripple frames, sand shore, foam that laps with the frame | `frame`, `m8` |
| House | roof style (shingles, seams, clay) from `seed>>>4`, shutters, base course, porch, chimney | house `seed` |
| Apartments | shop front and awning on the ground floor for one seed in three | house `seed` |

**Palette use.** Only `src/render/palette.ts`. Added: `kerbLight`, `pebble`, `awnings` (four stripe pairs). Everything else reuses existing colours (`stone*`, `laneMark`, `waterDeep`, `fenceShade`). Light comes from the top-left.

**Variation scheme.** `tileSpecAt` derives `variant = tileHash(tx, ty) % 8` plus three new fields: `lane` (`laneCode`: contiguous road runs along both axes, the street runs along the clearly longer axis, width 3–9; centre tile of odd widths, one edge row of even widths; bit 8 alternates per tile for the dash pattern), `surface` (0 when any 8-neighbour is park) and `deco` (bush when a 4-neighbour holds a tree). Per-pixel grain uses an integer hash of (x, y, variant). No `Math.random`, no time input, so art depends only on the map position.

**Animation and budget.** `TileSpec.frame` (0–2) is part of `tileKey`, so each frame is one extra atlas slot per distinct water tile (about a dozen). Chunks bake frame 0 and record their water tiles. After the chunks are drawn, `drawWater` redraws the water tiles of painted visible chunks from the atlas when the frame is 1 or 2 and sets a single timer for the next 450 ms boundary; it sets none when no water is visible, at zoom below 8 (overview), or with `prefers-reduced-motion`. Other art adds no per-frame work. Atlas growth: lane (≤ 8 codes), surface (2), deco (2), frame (3) multiply keys only for road, path, grass and water tiles.

## Town and landmarks (Phase 3)

- OSM extras: `barrier=*` lines, `place=square` areas, and landmark points (`shop=supermarket`, hospitals and health centres, stations and subway entrances, schools). Points come from nodes or way/relation centres, are deduplicated per kind (a station's entrances merge) and stored in codec v2 as `[kind, lat×1e6, lon×1e6]` triples; ways gain a style index (park style, barrier type, building type, plaza). v1 data still decodes.
- `layoutTown(grid)` (cached per grid): landmarks first, at the nearest free spot of their size within 9 tiles (on buildings, then half on buildings, then any open ground or plaza); park gates where a footpath enters a big park. Remaining building components are cut by BSP into lots; each lot gets up to three houses placed with a largest-rectangle search, plus a front yard (fence or hedge with a gate in line with the door) or side garden when there is room. Everything is seeded from tile coordinates, so it is stable across reloads.
- Structures are painted after the tiles of each chunk and clipped to it, so they are cached with the chunk; the overview uses roof colours.
- Diagonal streets: a soft tile whose two cardinal neighbours and the diagonal between them are road gets an asphalt triangle in that corner; tiles with three road sides become road.
- Route: the polyline is rasterized to ordered 4-connected cells, staircase corners are dropped, and the band is stamped as a pixel brush along the segments, with arrow heads (9×9, rasterized from one triangle in 8 directions) every 6 cells.
- Walker: `facingFrom(dx, dy, previous)` with a 1.25 axis bias to avoid flicker on diagonals; frames 0-1-0-2 every 140 ms while moving; position tweened between fixes.

## Map without holes (task 50b)

- Root cause: `MapRenderer.render` cleared the canvas to ink black and painted only chunks inside the one loaded grid, each built synchronously in the frame that first needed it. Anything outside the loaded bounding box (the camera may go half a screen beyond it, and zoom 0.5 shows several kilometres) stayed black, and zooming into a big area built many chunks at once and stalled frames. The loaded area was only replaced through a manual "Load this area" button.
- Rendering: the canvas is cleared to the ground colour (`groundB`); the loaded grid rectangle is `groundA`. `chunkPlan.ts` (pure) lists the visible chunks and a one-chunk prefetch ring, both sorted by distance to the screen centre. `drawChunks` paints visible chunks in that order until `CHUNK_BUDGET_MS` (6 ms) is used, always at least one per frame; the others are drawn as a scaled slice of the 1-px-per-tile overview (same palette), and a follow-up frame is requested. When all visible chunks exist, one ring chunk is painted per frame. `LruCache` (96 chunks, or visible + 8 if the screen needs more) never evicts chunks on screen.
- Data: `ui/autoLoad.ts` (`shouldAutoLoad`) decides when a rested view outside the loaded area loads by itself: no download running, no route or quest to lose, and not within 500 m of a failed attempt. `App` waits 1.2 s after the map settles, then calls the existing `loadLiveAround`, so requests still go through `OverpassClient` (cache, single request, 10 s spacing, mirrors). With a plan or quest the "Load this area" button remains. Panning anywhere with several areas merged into one world was not done: the walking graph, tile grid and town layout are built per bounding box.

## Error handling: Overpass

- Overpass errors map to `busy`, `rateLimited`, `tooLarge`, `network`, `badResponse` and `badArea` (invalid box, task 66), each with a translated message.

## Testing strategy

- Unit tests for geo maths, step conversion, tag classification, codec round-trip, Overpass client (mocked fetch: cache, throttling, fallback, size cap), rasterization (connectivity, fills, terrain mix on the fixture), auto-tiling (all masks), the tile painter (pixel probes), sprites, routing on the fixture (targets, feasibility, seeds, stride, robustness over random points), checkpoints, i18n parity and an App smoke test.

## Correctness properties (task 58)

Checked with fast-check (fixed seed `20261204`) in `src/osm/codec.property.test.ts` and `src/render/chunkPlan.property.test.ts`.

- **P-M1 Codec round trip.** For random maps (nodes at 1e-6° precision, ways of every kind with optional highway, style, name, safety flags and roundabout flag, landmarks, industrial rings, activity points), `decodeOsm(encodeOsm(x))` equals `x`, also after a JSON text round trip, and `encode(decode(encode(x)))` equals `encode(x)`. The bundled Benicalap extract survives a re-encode unchanged. Validates 1.1, 1.3.
- **P-D1 Visible chunks covered.** For any camera, zoom, screen size, grid and margin, every chunk that the screen rectangle overlaps (and that lies on the grid) is in `visible`; none is listed twice or in both `visible` and `ring`; chunks outside the screen are not visible; both lists are sorted nearest the centre first and stay inside the grid. Validates 7a.2, 7a.3.
- **P-D2 Cache keeps what is on screen.** For any sequence of insertions with any protected set, a protected chunk already cached is never evicted and the cache exceeds its limit only when everything else in it is protected; `chunkLimit` is at least the base and `visible + 8`, so filling the cache with the prefetch ring and the visible chunks never loses a visible one. Validates 7a.4.

## Day-cycle lighting (task 60)

- **Model** (`src/render/daylight.ts`, pure): `lightingAt(ms, place)` = `lightingFromAltitude(sunAltitude(ms, place))`. A piecewise-linear tint table by altitude (30° white, 12° faint warm, 6° golden, 0° orange, −4° pink-purple, −8° blue-purple, −12° and −18° blue night) gives the multiply colour; `darkness = 1 − luminance(tint)`. Lamp strength is a smoothstep from 4° to −6°, window strength from 2° to −8°, so windows light first, just after sunset. Phases: day ≥ 12°, golden ≥ sunset altitude (`HORIZON` exported from `sun.ts`), dusk ≥ −12°, night below. Dawn and dusk share the table, so the morning mirrors the evening. Civil twilight is part of the table, but routing keeps its own rule (night = below the horizon altitude), untouched.
- **Clock**: `MapRenderer.lighting` caches the value per 30 s; a 60 s timer requests a repaint (no per-frame work). `?time=HH:MM` is parsed by `parseTimeParam` in `MapView` and sets `setClockOverride(minutes)`, which uses that local time of today for lighting only.
- **Compositing** in `render()`: ground, chunks, water, rails, then `multiply` fill of the tint (skipped when darkness ≤ 0.5 %), then lights, then route, gems, walker. The route and sprites are drawn after the tint, so they stay bright. Chunk canvases never contain light, so the cache is the same all day and no chunk is repainted on a phase change.
- **Windows** (`lights.ts`): the real painters run once per building against a recording context that collects the glass rectangles (`P.window`, `P.glass`), so the glow sits exactly on the painted windows. About 70 % are kept by a hash of the building seed, position and window position (cached in a WeakMap). They are drawn as plain `fillRect` in warm yellow at the window strength, for houses and landmarks in visible chunks at detail zoom only.
- **Street lamps** (`lamps.ts`): `Layer.lit` (new raster bit 128) marks road tiles of ways with `SAFETY_LIT`. The data has no lamp nodes, so lamps stand on road kerb tiles on a lattice (every 12 tiles per side, the two sides offset by 6): lit tiles always, wide (≥ 3 tiles) streets as presumed-lit main avenues, and every street ≥ 2 tiles wide when the area has no lit tag at all. Lamps are bucketed per chunk once per grid. Each draws a cached 32-px stepped, dithered glow sprite additively (`lighter`), plus a 2×2 art-pixel bright head.
- **Walker and gems**: an additive glow sprite under the walker (4 tiles wide) and each gem (2.4 tiles) at lamp strength.
- **Performance**: one full-canvas fill per frame, plus at detail zoom a few hundred `fillRect` and `drawImage` calls of a cached sprite for the visible chunks. Nothing runs at far zoom except the tint.
- **Reduced motion**: lights are static, so there is nothing to switch off.
- **Testing**: `daylight.test.ts` (phases, golden before sunset, dusk exactly when `isDark`, parser, preview clock), `daylight.property.test.ts` (P-L1 to P-L4), `lights.test.ts` (windows on glass and stable, lit raster bit, lamp lattice and lit rule on a synthetic grid), `nightRender.test.ts` (renderer uses multiply and lights at night, not at noon).

### Correctness properties (task 60)

Fast-check, seed `20261204`, in `src/render/daylight.property.test.ts`.

- **P-L1 Bounds.** For any altitude, time and place, tint channels are integers in 0 to 255, darkness, lamps and windows lie in 0 to 1. Validates 9.3.
- **P-L2 Monotonic in altitude.** A lower sun never gives less darkness, lamp or window strength. Validates 9.3.
- **P-L3 Evening is continuous and monotonic.** For random places and days, from 3 h before to 3 h after sunset, darkness never decreases and changes by under 0.02 per minute. Validates 9.3.
- **P-L4 Morning mirror.** From 3 h before to 3 h after sunrise, darkness never increases. Validates 9.3.

## Architecture review (Nov 2026)

Scope: `src/render/**`, `src/tiles/**`, `src/ui/MapView.tsx`. Method: read the code against requirements 2, 6a, 7a, 8 and 9, then check each suspicion with a failing test before touching the code (tasks 63.x).

### Current structure

- `MapRenderer.ts` (1026 lines) does everything: camera maths, canvas sizing, tile atlas, chunk cache, structure painting, water ripples, overview stand-ins, the day-cycle clock, tint, window and lamp light, rails, avoided-street tape, route footprints, gems, walker tween, speech bubble and pickups. Eleven private fields hold unrelated state and `render()` is a 150-line function.
- `chunkPlan.ts` (pure plan and LRU), `tileSpecs.ts`, `tileset.ts`, `structures.ts`, `lights.ts`, `lamps.ts`, `daylight.ts`, `routePath.ts` are already separate and tested.
- `MapView.tsx` holds all input handling (one 130-line effect: pointer, pinch, wheel) and cannot be tested without a DOM.

### Findings

Bugs (each has a regression test in 63.x; "verified" means the test failed before the fix):

| Id | Finding | Effect |
| --- | --- | --- |
| B1 | Every wheel event is one ladder step; `deltaY = 0` counts as "zoom out" | A trackpad flick runs through all 13 levels; horizontal scroll zooms out |
| B2 | Pinch compares `target` with `zoom × 1.4` after each step. Ladder step 8 → 16 is 2×, so for ratios 1.40 to 1.43 the zoom flips up and down on every move event. Two-finger drag does not pan | Flicker while pinching; map follows only the zoom |
| B3 | `cssWidth` falls back to `canvas.width` (device px) when `clientWidth` is 0, then `render` multiplies by the pixel ratio again | A hidden canvas grows by the pixel ratio on every frame |
| B4 | `devicePixelRatio` is read per frame but nothing triggers a frame when it changes alone | Blurry map after dragging the window to another screen |
| B5 | Backing store is `css × dpr` with no limit | iOS Safari (16.7 Mpx limit) and big 2× screens can give a blank canvas |
| B6 | Window and lamp light is drawn for every planned chunk, also for the ones still showing the 1-px-per-tile stand-in | Yellow dots on the blurry overview while chunks load at night |
| B7 | A stand-in is drawn with width `round(sw × scale)` while its neighbours start at `round(origin + (cx+1) × 32 × scale)` | 1 px ground-coloured seams between stand-ins and painted chunks |
| B8 | Whole 512 px chunks are scaled as one block, but water tiles are redrawn with per-tile rounded edges | At non-integer scale (browser zoom, pixel ratio 1.1) ripples sit up to 1 px off their tiles |
| B9 | Evicted chunks are only dropped from the map, never released; `dispose` frees neither chunks, atlas pages nor the overview; `chunkWater` keeps entries of evicted chunks | Canvas memory stays on iOS until a GC that may never come; 96 chunks are 96 MB |
| B10 | `requestRender` without `requestAnimationFrame` calls `render()` directly, and `render()` calls `requestRender()` while the walker moves or chunks are pending | Unbounded recursion outside a browser |
| B11 | `lampsInChunk(grid, cx, cy, size)` caches by grid only, so the first `size` wins | Latent: wrong lamps if another chunk size is ever used |
| B12 | `zoomStep` from a zoom between two levels moves two levels up | Skipped level (not reachable today; the ladder is the only source) |
| B13 | `setPointerCapture` can throw (`InvalidStateError`); right and middle mouse buttons pan and place points | Uncaught error; context-menu click places a start |
| B14 | The camera is not clamped again after a resize | After rotating a phone the view can sit far outside the map |
| B15 | After a tab returns from the background the sky is stale until the next 60 s timer | Up to a minute of wrong tint |
| B16 | `planChunks` uses the unrounded camera while drawing uses a rounded origin | Suspected 1 px uncovered column at non-integer scale. Not reproduced: `chunkCoverage.property.test.ts` found no gap in 600 random cases with the plan unpadded, so the plan is unchanged |

Missing requirements: pinch pan, inertia, double tap, keyboard, backing-store limit, hidden canvas, pixel-ratio change, release of canvases, repaint on visibility, a performance budget. Added as requirements 10 to 13.

Performance (counting-stub benchmark in `bench.test.ts`, 390 × 700 CSS px at 2×, 7.5 km serpentine route):

- P1 The route is re-projected and re-laid out every frame (`footprints` over the full polyline, thousands of objects) and every footprint is about 30 `fillRect` calls. At far zoom that is 88 910 calls per frame, and the frame is repeated at 60 Hz while the walker moves.
- P2 Per-frame allocations: `chunkKey` template strings (about 6 per chunk per frame), a `Set` of on-screen keys, the chunk plan arrays and their sort, the `toScreen` closures and objects, a lamp list fetched twice.
- P3 Overdraw: the full-canvas ground fill and the loaded-area fill are both painted before chunks that cover them. Kept: they hide edge slivers, and removing the second one at far zoom would change edge pixels (the overview is drawn to a fractional rectangle). The duplicated branches of `render()` that issued the same fill are merged.
- P5 Track lines (`drawRails`, 62 in the demo map) cost about 14 000 `fillRect` calls per frame at far zoom after culling (26 000 before). Left as the largest remaining cost: caching them needs a canvas per sub-unit origin offset (the snapping depends on it), too much memory for the gain. Follow-up: batch each colour into one path fill.
- P4 Chunk blits are scaled to 512 × zoom px each, up to 4608 px at zoom 48 on a 3× phone, although only the visible part matters.

Design:

- D1 One class, many jobs (see above). D2 Dead code: `chevrons`, `ARROW_PATTERNS`, `dir8` (the route is footprints since task 51), `WINDOW_RGB_COOL`, the getters `atlasSize`, `railCount`, `avoidedCount` and `facing`, the duplicated `groundA` fill branches. D3 Requirement 6a.4 still says "direction arrows". D4 Input logic lives in a React effect.

### Target design

```mermaid
flowchart TB
  MapView --> MapInput[ui/mapInput.ts: DOM events] --> Gestures[render/gestures.ts: pure]
  MapView --> MR[MapRenderer facade]
  MapInput --> MR
  MR --> Camera[camera.ts]
  MR --> Viewport[viewport.ts]
  MR --> Sched[frameScheduler.ts]
  MR --> Chunks[chunkLayer.ts + atlas.ts + overview.ts + chunkPlan.ts]
  MR --> Light[lightingLayer.ts: clock, tint, lights]
  MR --> Overlay[overlayLayer.ts + footprintLayer.ts + walkerMotion.ts + bubble.ts]
```

- `camera.ts`: `Camera` class with camX, camY, zoom, the CSS size, `screenToTile`, `tileToScreen`, `panBy`, `zoomTo`, `zoomStep`, `fit`, `clamp`. No DOM, no grid projection (the facade converts lat/lon).
- `viewport.ts`: `backingSize(css, dpr, limits)` (pure) and `watchPixelRatio(cb)` (matchMedia re-armed on every change).
- `chunkLayer.ts`: owns atlas, chunk cache (numeric keys, release on eviction), structure index, water tiles, stand-ins; `draw()` returns the chunks that are really painted.
- `lightingLayer.ts`: clock override, 30 s cache, 60 s timer and visibility repaint, tint fill, window and lamp light for painted chunks.
- `overlayLayer.ts`: route, avoided tape, rails, gems, walker, bubble, pickups. `footprintLayer.ts` caches the layout per zoom in world pixels and draws each print as one cached stamp. `walkerMotion.ts` is the pure tween and facing state.
- `frameScheduler.ts`: coalesces `requestRender`, runs the frame, guards re-entrancy.
- Input: `gestures.ts` (`WheelAccumulator`, `pinchLevel`, `VelocityTracker`, `glide`, `TapPairer`, pure) and `ui/mapInput.ts` (listeners, pointer capture, glide loop, keyboard) so `MapView` only creates it.

Rationale: each module has one reason to change and a test that does not need a canvas. Pure modules (camera, gestures, viewport maths, plans) get property tests; layers get tests on a software canvas (`render/testing/softCanvas.ts`) that implements `fillRect`, `drawImage`, alpha, `multiply`, `lighter` and a rectangular clip, so frames can be compared pixel by pixel. Alternative considered: keep one class and only extract helpers. Rejected: the state (cache, clock, walker) would stay shared and every change would keep touching `render()`.

### Visual changes

The approved look is pinned by golden frames (`golden.test.ts`, snapshot of a frame hash per scene). They must not change except for the defects below, each only visible in the stated case:

- B6: no light over stand-ins (only while chunks load at night).
- B7 and B8: seams and ripple offsets at non-integer scale and while chunks load; none at integer scales.
- Input additions are not drawing changes: the map canvas is a tab stop with a dashed gold focus ring (same style as the buttons) and an accessible name (`map.canvas`, English and Spanish).
- Everything else (stamps, caches, module split) keeps every golden hash.

### Results

Golden frames (`golden.test.ts`, 7 frames over 5 scenes) were recorded on the old code before the split and are unchanged: the refactor, the footprint stamps and the culling are pixel-identical. Visible differences are limited to the defects above (B6 while chunks load at night, B7 and B8 at non-integer pixel ratios); no golden scene hits them.

Benchmark (`bench.test.ts`: counting stub context, 390 × 700 CSS px at 2×, 7.5 km route, 80 warm-up frames, steady state; time is the JavaScript side only, median of repeated runs on one machine; calls are `fillRect` plus `drawImage` per frame):

| Scene | Before ms | After ms | Before calls | After calls |
| --- | --- | --- | --- | --- |
| Detail zoom 16, still camera | 0.82 | 0.08 | 5148 | 191 |
| Detail zoom 16, panning | 0.60 | 0.08 | 3890 | 145 |
| Detail zoom 16, route only (no tracks) | 0.76 | 0.06 | 5146 | 191 |
| Far zoom 1, route only (no tracks) | 0.55 | 0.04 | 5141 | 185 |
| Far zoom 1 with the demo map's tracks | 2.05 | 1.04 | 26 010 | 13 931 |
| Night, detail zoom 16 | 0.82 | 0.16 | 5402 | 434 |

A real canvas also pays for the pixels, which this stub does not measure; the call counts are the part a browser must execute, and they are asserted by the tests (under 1500 for the route at every zoom, requirement 12.1).

Bugs fixed with their regression tests: B1, B2, B13 (`gestures.test.ts`, `mapInput.test.ts`); B3, B4, B5, B6, B7, B9, B10, B11, B12, B14, B15 (`rendererBugs.test.ts`, each failed before the fix); B8 and B16 are covered by `chunkCoverage.property.test.ts` (B8 is fixed by construction: water and chunk blits share `tileEdgeX/Y`; B16 not reproduced).

Property tests added (fast-check, seed `20261204`): P-C1 to P-C4 camera and backing store (`camera.test.ts`), P-D3 screen covered (`chunkCoverage.property.test.ts`), P-T1 to P-T6 auto-tile masks on random grids (`autotile.property.test.ts`; no bug found), P-L5 painted frame continuous in time (`lightingLayer.test.ts`), plus wheel, pinch and glide properties (`gestures.test.ts`).

- **P-C1** screen ↔ tile round trip under 1e-6 tile at every zoom and anywhere the clamp allows (also at 36 000 tiles from the origin). **P-C2** zoom keeps the tile under the pointer. **P-C3** clamp bounds and idempotence. **P-C4** pan and opposite pan return to the start.
- **P-D3** every device pixel of the loaded area on screen is covered by a chunk or stand-in, for ratios 1 to 3, zoom 8 to 48, any camera, with all chunks painted or one.
- **P-T1** masks stay in the 47 blob masks and diagonals need both neighbouring cardinals. **P-T2** the map edge is connected. **P-T3** the 4-bit mask is the cardinal part of the 8-bit one. **P-T4** a mask depends only on its 3 × 3 neighbourhood. **P-T5** rotating the grid 90° rotates the masks. **P-T6** one terrain has no borders.
- **P-L5** from 15:00 to 23:30 the mean colour of a painted frame changes by under 5.1 levels per minute (the 0.02 of P-L3), and night is darker than noon with the same chunk cache.

## OSM data and rasterizer review (Nov 2026)

Scope: `src/osm/**`, `src/tiles/**`, `src/town/layout.ts`, `src/geo/geo.ts`, `scripts/build-fixture.ts`, `osm-etiquette.md`. Method: read the code against requirements 1, 2 and 6a, check each suspicion with a small hand-made area or a scratch run on the code before the change ("verified" means it failed or misbehaved there), then fix with a regression test (tasks 66.x). Requirements 14 to 16 hold the resulting rules. Overpass etiquette is unchanged: one request per mirror, one download at a time, 10 s gap, 36 km² cap, cache first; every new step in this section works on local data.

### Current structure

- `osm/`: `demoArea.ts` (query), `download.ts` (mirror race, answer check), `download.worker.ts` (runs it off the main thread), `normalize.ts` (Overpass JSON to `OsmData`), `classify.ts` (tags), `codec.ts` (compact JSON, bundled fixture and cache form), `cache.ts` (IndexedDB), `overpass.ts` (client: cache, index, spacing, cap).
- `tiles/`: `grid.ts` (layers, terrain priority), `rasterize.ts` (polygon fill, thick segments, 4-connected lines), `autotile.ts`, `diagonal.ts`. `town/layout.ts` builds houses and landmarks on the resolved terrain.
- The routing graph reads `OsmData.ways` directly (walkable ways clipped to the bbox), so everything `normalize` lets through reaches both the picture and the planner.

### Findings

| Id | Finding | Effect |
| --- | --- | --- |
| D1 | A NaN, inverted or out-of-range box: `NaN > 36` is false, so the cap passes; the query text then contains `NaN` (verified) | A bad coordinate from the UI downloads nothing useful and can be cached |
| D2 | Area uses the width of the south edge only (small error, but it is the only check of the cap); the cap was tested on the request while the downloaded box and the cache key were different boxes. The key rounded to the nearest 0.001°, so an entry could miss up to 50 m of a request that mapped to it | Edge of the map missing after a cache hit; a request just over the cap could pass or fail by rounding |
| D3 | `decodeOsm` of a damaged or old entry throws a plain `Error` inside `cached()`; the entry stays (verified: `loadArea` rejects with "Unsupported map data version 9") | Every load of that area fails until the entry expires after 7 days |
| D4 | The area index is parsed without checking its records; a `null` record throws a `TypeError` in `contains` | The same failure, from `localStorage` |
| D5 | Nothing is ever deleted: expired areas, areas that fell off the 40-record index, and entries of older cache versions stay in IndexedDB | Storage grows for ever; quota errors later |
| D6 | An entry with a saved-at time in the future (clock set back) counts as fresh until the clock passes it | Stale map for much longer than 7 days |
| D7 | A failed `indexedDB.open` is remembered for the session; a write that ends in `abort` without `error` leaves its promise pending, and the client stays `busy` for ever | No cache for the session; hardening, not reproduced in a test |
| D8 | The key prefix `v3` is typed by hand and has no link to the codec version | A format change keeps serving old data lacking the new fields |
| D9 | `decodeOsm` repairs what it cannot read: an unknown kind becomes a road (verified), an out-of-range node index reads `?? 0` (a point at 0°, 0°), missing arrays throw later in the renderer | Damaged data draws wrong things instead of failing |
| D10 | An answer without `elements` (an empty object, `null`, a page that happens to parse) is normalized to an empty map and cached for a week (verified) | "No streets here" for 7 days |
| D11 | Only `null` geometry points are gaps; `NaN` or 1e9 is accepted, and a building of two points and back is kept | Chords across the map; coordinates 1e9 away make every later step slow |
| D12 | The query asks for ways only, so multipolygon relations never arrive: a building with a courtyard or a park with a pond mapped as a relation is missing when its outer way is untagged (the usual case). The model has no inner rings | Missing large buildings and parks in live maps; no holes anywhere |
| D13 | `isTunnel` lets `layer=-1` win over an explicit `tunnel=no` (verified), which also drops the way from the picture and sets the COVERED safety flag; there is no bridge information, so rail tracks are drawn across bridge decks | Cuttings vanish; tracks run over road bridges |
| D14 | The local projection subtracts longitudes directly: 0.01° across the antimeridian gives 38 134 km (verified). `bboxAround` returns longitudes above 180 and latitudes above 90, which Overpass rejects. Near a pole `cos(lat)` reaches 0 and the inverse divides by zero | Fiji, Chukotka and polar users get nonsense; none in the Benicalap demo |
| R1 | Rasterization visits every tile of a feature's own extent, inside the grid or not. Overpass returns whole ways, so a forest or river that merely touches the area costs its full size: a 110 km square forest took 5.1 s for a 6 × 6 km area; a 20 000 × 20 000 tile polygon makes 400 million visits in 1.35 s (verified); a coordinate of infinity never ends | Freezes the phone (the worker only covers the download, not the grid) |
| R2 | `thickSegment` tests every tile of the segment's bounding box: a long diagonal costs length², not length × width | Slow long rivers and roads |
| R3 | `line4` with a slope that rounds to zero (denormal) gets `NaN` step distances and walks away from its end tile (verified: tiles 0,0 to 0,-3 for a line to (-5e-324, 0)); rounding can also overshoot the end column | Broken 4-connection on near-axis lines; found by the property test |
| R4 | A ring whose corners are on one line paints the tiles whose centres lie exactly on it | Stray lines from zero-area buildings (rare) |
| R5 | No holes (see D12), so a courtyard cannot exist | |
| R6 | Rails are drawn after the chunks, whatever lies over them | See D13 |
| R7 | Not changed on purpose: area-tagged ways that are not closed are filled with a closing chord (a mapping error, and the answer is whole ways, so the closed case is the common one); the equirectangular projection error is below 0.3 % at 6 km up to latitude 80°, so the scale stays at the north-west corner | Documented, covered by `geo.test.ts` |
| T1 | Town layout: blocks are 4-connected components of building tiles, lots are cut from the block's rectangle and masked by the block, so courtyards and a grid edge stay empty. No defect found; cost is one-off (below) | Courtyard test added |

Reviewed without change: worker protocol (a new worker per download, progress throttled), mirror race (each mirror gets one request, the winner aborts the rest, 429 and 504 map to `rateLimited`, timeouts abort), `Promise.any` error priority, key spacing and `busy` rule, `areaForWalk` formula, attribution.

### Design

- `geo.ts`: `wrapDeltaLon`, `wrapLon` (identity for values already in range, so existing coordinates keep their bits and the golden frames stay), `MAX_LAT` guard in `LocalProjection`, `bboxAround` clipped to ±90 and ±180, `isValidBBox`, `bboxAreaSphereKm2`. A walk next to the antimeridian gets a box trimmed at 180°; the grid and graph are per box and never wrap.
- `overpass.ts`: `snapBBox` grows a request outwards to the 0.001° grid with a `1e-7` float guard; the client downloads, keys, indexes and caps that box. `areaForWalk` caps its radius at 2.85 km (was 3 km) so the grown box stays under 36 km² (a 2.9 km radius gave 36.05 km² after growing; 2.85 km stays under 36 at the equator, 40° and 60°, tested). Only walks above about 13 km of target distance are affected. `cacheKey` is `v${CODEC_VERSION}:…`. `readEntry` decodes with a `try`, deletes what it cannot read and reports a miss. `prune` runs after a successful save: it drops expired and overflow index records and their data, and once per session deletes keys without the current prefix. `AreaCache` gains optional `delete` and `keys`.
- `cache.ts`: `isFresh(savedAt, now)` (number, under 7 days, at most 5 minutes in the future); `IndexedDbCache` forgets a failed or closed connection, rejects on `abort` and `blocked`, and implements `delete` and `keys`.
- `download.ts`: `isOverpassResponse`; the timeout remark is checked before the shape, so a remark-only answer is `busy`.
- `normalize.ts`: `validPoint` (finite, ±90, ±180) decides gaps; areas need three different corners; relations of kind building, park or water with `type=multipolygon` go through `multipolygon.ts` (`assembleRings` joins member ways by equal end coordinates, `buildPolygons` gives each inner ring to the smallest containing outer ring), producing one area way per outer ring with `holes`; outer members that are also tagged on their own are skipped (`claimed`). Roads and paths with `bridge=*` get `bridge`. Relation nodes are indexed by coordinate and not shared with way nodes, because relation members carry no node ids; areas never join the walking graph.
- `classify.ts`: `isTunnel` (bridge never, explicit `tunnel` tag first, then negative `layer`) also serves the rail rule; `isBridge`.
- `codec.ts`: version 4 adds flag 32 (bridge) and `holes: {w, r}[]` (delta-coded rings). `validate` checks shape, kinds and every node index before decoding and throws `CorruptDataError`. Encoding is deterministic, so the stability property holds. The bundled fixture stays at version 3 (rebuilding needs the original Overpass answers, which are not in the repository); it decodes unchanged, so `bridge` and `holes` are absent there.
- `rasterize.ts` (public API, all pure): `fillRings(rings, visit, bounds?)` (even-odd over several rings; crossings bucketed per row, so cost is edges × rows crossed; rows and columns clamped to `bounds`), `fillPolygon` (one ring), `thickSegment(a, b, half, visit, bounds?)` (per row, only the columns of the strip around the line are tested, then the same exact distance test as before, so output is identical), `line4(a, b, visit, bounds?)` (clips to one tile outside the grid, always steps towards the end tile), `clipSegment`, `cutRailsAtBridges`, `rasterizeOsm`, `buildTileGrid`. `TileGrid.bridge` marks bridge-deck tiles; `rasterizeOsm` cuts the rail polylines there, in half-tile steps, only for polylines that touch a deck.
- Town: no code change.

Alternatives considered. (1) Add `rel` clauses for multipolygons to the live query: rejected for now. It is still one request, but it enlarges every answer and the steering file says ways only; the parser, codec and rasterizer are ready, so it is a one-line query change once the owner agrees. (2) Clip polygons geometrically (Sutherland–Hodgman) before filling: rejected; clamping rows and columns gives identical tiles with less code. (3) Serve a stale cache entry when the network fails: useful offline, but it changes requirement 1.3; left as a suggestion. (4) Scale the projection at the box centre: error gain below 0.1 %, but it would move grid sizes and every golden frame; not done.

### Correctness properties (task 66)

Fast-check, fixed seed `20261204`.

- **P-G1 Projection round trip.** `toLatLon(toXY(p))` returns `p` for origins and points anywhere, across the antimeridian. Validates 16.7.
- **P-G2 Scale.** Within 6 km up to latitude 70°, the projected distance is within 0.5 % of haversine. Validates 16.7.
- **P-G3 Box validity.** `bboxAround` of any point and radius is valid and contains the point. Validates 14.1.
- **P-M1 (extended) Codec round trip** on random maps now with holes and bridge flags, through JSON text; encoding is stable.
- **P-M2 Damage.** A damaged compact value either throws `CorruptDataError` or decodes with every node index in range. Validates 15.7.
- **P-T1 Area.** A filled convex polygon has as many tiles as its area, within half its perimeter. Validates 16.1.
- **P-T2 Bounds.** Filling with bounds equals filling without them, restricted to the bounds. Validates 16.1.
- **P-T3 Holes.** Outer minus hole is exactly `w·h − iw·ih` tiles and every hole tile is empty. Validates 16.2.
- **P-T4 Translation.** Moving a polygon by whole tiles moves its fill. Validates 16.1.
- **P-T5 Thick segment.** The row-limited version marks exactly the tiles of the brute-force test plus the centre line. Validates 16.4.
- **P-T6 Clipped line.** A line from inside the grid to anywhere stays 4-connected, within one tile of the grid and keeps its inside end. Validates 16.1, 16.4.

### Results

Measured on one machine (Node 24, median of 7 runs for Benicalap, a single run for the synthetic areas; pure functions, no canvas). The 36 km² area is synthetic: 6 × 6 km, 6128 street segments and about 1900 buildings, 1198 × 1199 tiles.

| Case | Before | After |
| --- | --- | --- |
| Rasterize Benicalap (635 × 645, 15 457 ways) | 37 ms | 33 ms |
| Rasterize 3 × 3 km synthetic (600 × 600) | 11 ms | 12 ms |
| Rasterize 6 × 6 km synthetic (the cap) | 26 ms | 23 ms |
| The same plus a 110 km forest and a 70 km river through it | 5109 ms | 49 ms |
| Fill of a 20 000 × 20 000 tile polygon | 400 000 000 visits, 1347 ms | 10 000 visits (bounded to a 100 × 100 grid), under 1 ms |
| Decode the Benicalap extract (96 k nodes) | 2.6 ms | 6.3 ms (shape check) |
| Encode the Benicalap extract | 6 ms | 6 ms |
| Town layout, Benicalap / 36 km² synthetic | 119 ms / 236 ms | unchanged code: 114 ms / 243 ms |

The decode check costs about 4 ms once per map and guards every cache read and every download. The town layout is a one-off cost (about 70 % is the per-lot ramp and corner test, 5.6 ms is landmarks, 22 ms park gates, 8 ms the block search); it was measured and left alone. The bundled Benicalap grid hashes to the same value as before (`rasterize.regression.test.ts`), and the golden frames are unchanged.

Visible changes: none in the bundled demo. In live data: courtyards and ponds appear when relation geometry is present; rails stop at bridge decks; `tunnel=no` ways with a negative layer are drawn; boxes near ±180° or the poles are valid.

Cross-reference to routing: the graph is unchanged. It still takes walkable ways clipped to the bbox, and `holes` and `bridge` are not read by it. Two effects reach it through `normalize`: ways with a bad coordinate are split at the gap (they used to put NaN into the node table), and a `tunnel=no` way with a negative layer is no longer flagged covered, so it counts as open air in the night weights.

Limits kept: no walk is planned across the antimeridian (the box is trimmed at 180°); a live area still has no relations (D12); an unclosed area-tagged way is filled with a closing chord.


## Town layout review (Nov 2026)

Scope: `src/town/layout.ts` (395 lines, one file) and its callers `render/chunkLayer.ts`, `overview.ts`, `structures.ts`, `lights.ts`. Requirement 17, tasks 69.1 to 69.7.

### Current structure (before)

`layoutTown(grid)`: `placeLandmarks` (grid points in data order, three passes of three sizes within 9 tiles) → `findParkGates` → connected building blocks → BSP lots → up to three largest rectangles per lot → front yards (fence, gate) → trees. All in one file, with a `Set` of block tiles per block.

### Findings

| Id | Finding | Effect |
| --- | --- | --- |
| B1 | Landmarks were placed in the order of `grid.pois`, and each one reserves its tiles. Two points that compete for a spot give a different town when the data order changes (Overpass does not promise an order; the fixture builder merges extracts). | Station and market near (194, 375) on the Benicalap map moved with the order. |
| B2 | Points of one kind on one tile, or one inside the footprint of another, each got a landmark (the second one next door). | Two schools drawn side by side for one OSM school. |
| B3 | A point with an unknown kind threw `LANDMARK_SIZES[kind] is not iterable`; one with NaN coordinates was only skipped by luck of `inBounds(NaN)`. | A bad cached extract would stop the whole map drawing. |
| B4 | Park gates were found after landmarks without looking at them, and houses were placed on the tiles of a gate's arch row (`houseAt` and `landmarkAt` both set). | House and arch painted on the same tiles. A landmark overlap did not occur in tests but was possible by construction. |
| B5 | A horizontal gate at map row 1 had `y = -1`; the code later guarded the index but the painter still received a rectangle outside the map. | Arch clipped or painted at row -1. |
| B6 | A front-yard fence under the removed column of a side garden (`w - 1`) had no house above it, so the "tile under a house stays clear" rule did not protect it and a tree could stand on the fence. | Tree through a fence. |

Checked and found correct: houses are cut from a mask of building tiles, so they never cover roads, water or plazas, and `largestRect` clearing keeps them disjoint (property test confirms, 60 random maps). A front-yard row lies inside the lot. The door column is always inside the house. Block order is the scan order of the first tile, so seeds do not depend on traversal order. `Math.max(...)` and `Set` iteration do not leak into results (the `trees`, `fences` and `gates` sets are only read by membership).

By design (documented, not changed): lots are cut from the bounding box of a block, so a concave block is covered by the pieces of up to three rectangles per lot and an L-shaped leftover stays building tiles; blocks thinner than 2 tiles or under 4 tiles get no house; a landmark can move up to 9 tiles (45 m) from its OSM point.

### Performance

Linear. `layoutBench.test.ts` (printed, one machine, ms, median of 3 runs after, single run before): Benicalap demo 635 × 645 tiles 137 → 110; 600 × 600 tiles of 40-tile blocks 158 → 147; one 600 × 600 block 283 → 182. The saving comes from a tile-to-block `Int32Array` instead of a `Set` per block and a flood fill without a closure per tile. The 36 km² cap is 1200 × 1200 tiles, about four times these grids.

### Target design

```
types.ts      House, Landmark, TownLayout, Rect, LOT, colour counts
random.ts     rng (mulberry32), hash2
blocks.ts     components, analyseBlocks (blocks + owner array), subdivide (BSP), largestRect
landmarks.ts  landmarkSites (sorted, deduplicated), placeLandmarks, findParkGates, LANDMARK_SIZES
houses.ts     placeHouses (lots, houses, yards, trees), houseKind
layout.ts     layoutTown, townFor, re-exports of the names the renderer and tests import
```

- `landmarkSites(grid)` returns the usable points sorted by kind (`LANDMARK_KINDS` order), then row, then column, with duplicates removed. Placement walks that list, so the result depends on the map, not on the data order.
- `reserved` (a `Uint8Array`) is the single record of tiles that landmarks and gates have taken; houses are placed only on building tiles outside it.
- Trees keep their random draws: `scatterTrees` draws for the same tiles as before and only refuses to store a tree on a fence tile.

### Behaviour changes (all deliberate)

- Landmark order in `TownLayout.landmarks` is now by kind (healing, station, school, greenMarket, market), then position, instead of data order, so `landmarkAt` indices differ. Nothing outside the renderer reads the index.
- On the Benicalap map one station and one market moved by one or two tiles, because they compete for the same space and the winner no longer depends on the data order. This changes one golden frame (`far zoom town map`, night frame at zoom 0.5: `23e2e9c8` to the new hash in `golden.test.ts.snap`). The other four scenes keep their hashes. Confirmed by restoring data-order placement: the old hash returns.
- Gate tiles are reserved, so up to a 3 × 2 patch of building tiles under an arch no longer holds a house.

### Properties (fast-check)

- **P-Y1** for random maps with random points: every house tile is a building tile, houses are pairwise disjoint and do not touch a landmark or gate, landmarks and gates are inside the map and disjoint.
- **P-Y2** shuffling `grid.pois` leaves `landmarks` and `houses` equal.
- **P-Y3** at most one landmark per distinct (kind, tile) point, and each landmark lies near a point of its own kind.
- **P-Y4** no tree on a house, fence or gate tile.

### Page zoom lock (cross-reference)

The map canvas is the only element that handles pinch (`touch-action: none`, pointer events in `ui/mapInput.ts`). The page-level guard that stops Safari from zooming the page is specified in retro-ui requirement 17; it must keep skipping events whose target is inside `.map-canvas`.
