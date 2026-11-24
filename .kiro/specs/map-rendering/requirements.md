# Map rendering and data: Requirements

Part of the StepQuest specs; see [../README.md](../README.md) for the introduction, glossary and index. Requirement ids are kept from the original single spec so history stays traceable.

Related: [routing](../routing/requirements.md), [quest](../quest/requirements.md) (route and walker overlays), [retro-ui](../retro-ui/requirements.md) (dialogue box, plural forms).

## Requirements

### Requirement 1: Map data

**User Story:** As a walker, I want the map to show my real streets, so that the route is something I can actually walk.

#### Acceptance Criteria

1. WHEN the app starts, THE SYSTEM SHALL load the bundled Benicalap (València) extract without any network access.
2. WHEN the user asks for a live area, THE SYSTEM SHALL request streets, footways, buildings, parks/green areas and water for a bounding box sized to the walk from the Overpass API.
3. THE SYSTEM SHALL cache downloaded areas on the device for 7 days and serve repeated requests from the cache.
4. THE SYSTEM SHALL send at most one Overpass request at a time, wait at least 10 s between requests, refuse areas larger than 36 km², and try a fallback endpoint when the first is busy.
5. THE SYSTEM SHALL show "© OpenStreetMap contributors (ODbL)" on the map at all times.

### Requirement 2: Tile map

**User Story:** As a player, I want the city drawn like a handheld RPG overworld, so that walking feels like a game.

#### Acceptance Criteria

1. THE SYSTEM SHALL rasterize map features into a grid of 16×16 tiles at about 5 m per tile, with layers for water, park, building, road, path and crossing.
2. THE SYSTEM SHALL resolve one terrain per tile with the priority crossing > road > path > building > water > park > ground, and SHALL turn a road tile into a zebra crossing only for tagged pedestrian crossings.
3. THE SYSTEM SHALL keep one-tile paths 4-connected when rasterizing diagonal lines.
4. THE SYSTEM SHALL auto-tile paths with 4-bit cardinal masks and area terrains with 8-bit masks reduced to the 47 blob tiles, including outer edges and inner corners.
5. THE SYSTEM SHALL draw every tile and sprite from original procedural or hand-coded pixel art.
6. THE SYSTEM SHALL support pan (drag), zoom (buttons, wheel, pinch) with nearest-neighbour scaling, and a far-zoom town map.

### Requirement 6a (Phase 3): Overworld look

**User Story:** As a walker, I want the map to look like a hand-made 8-bit town, so that my real neighbourhood feels like a game world.

#### Acceptance Criteria

1. THE SYSTEM SHALL split building footprints into small lots and draw separate houses with varied roof and wall colours, doors, windows, gardens, trees, fences and hedges, using only original pixel art.
2. THE SYSTEM SHALL draw distinct parks (flowers, tall grass, pitches, woods), water with a shore, and squares, and SHALL soften the steps of diagonal streets.
3. WHEN the map data has a hospital or public health centre, a metro or train station, a school, a park entrance or a supermarket, THE SYSTEM SHALL draw a matching special building near it. Supermarkets of one chain SHALL get a green special shop; THE SYSTEM SHALL NOT draw any brand name, logo or trademark, nor any design taken from a commercial game.
4. THE SYSTEM SHALL draw the route as a continuous trail of footprints that follows the street, and the walker SHALL face its direction of movement with a walk animation (static when the user prefers reduced motion).
5. THE SYSTEM SHALL show quest messages (start, pickup, finish) in a retro dialogue box that types out, can be skipped with a tap or key, and closes by itself while walking.
6. THE SYSTEM SHALL use correct singular and plural forms in English and Spanish for every count.
7. WHEN the quest is finished, THE SYSTEM SHALL stop location tracking and SHALL NOT show signal or route warnings.
8. THE SYSTEM SHALL keep panning smooth on phones by painting houses and landmarks into the cached map chunks.

### Requirement 7a: Map without holes

**User Story:** As a walker, I want everything on screen to be drawn quickly at every zoom level, so that panning and zooming out never shows black areas.

#### Acceptance Criteria

1. THE SYSTEM SHALL fill every part of the map screen with map ground colour and SHALL NOT show the ink-black background, at any zoom level and anywhere the camera can go, including outside the loaded area.
2. WHEN a visible chunk is not painted yet, THE SYSTEM SHALL draw the scaled town map in its place and SHALL paint the missing chunks nearest the screen centre first, within a time budget per frame (6 ms, and at least one chunk) so that the frame rate stays smooth.
3. WHILE the map is idle, THE SYSTEM SHALL paint one ring of chunks around the screen, one per frame, so that the next pan finds them ready.
4. THE SYSTEM SHALL keep painted chunks in a size-limited cache (96 chunks, more only when the screen itself needs more) that never evicts a chunk on screen.
5. WHEN the user rests the map for 1.2 s with its centre outside the loaded area, AND no route is planned and no quest runs, AND no download is running, THE SYSTEM SHALL load the area under the view by itself, using the same polite Overpass client (cache first, one request at a time, at least 10 s between requests).
6. IF loading that spot failed, THEN THE SYSTEM SHALL NOT ask again for a view within 500 m of it, and SHALL keep the "Load this area" button.
7. WHILE a route is planned or a quest runs, THE SYSTEM SHALL NOT replace the loaded area without a tap on "Load this area".

### Requirement 8 (task 51): Tile art

**User Story:** As a walker, I want the streets, parks, water and buildings to look like a polished handheld-console game, so that the map is pleasant to look at while I walk.

#### Acceptance Criteria

1. THE SYSTEM SHALL draw every terrain tile with original pixel art made in code from the palette in `src/render/palette.ts`, with no external image, font or sound asset and no design taken from a commercial game, and SHALL light every tile from the top-left (highlights on top and left, shade on the bottom and right).
2. THE SYSTEM SHALL draw asphalt with a sparse stable grain, kerbs of pale paving with joints along open road edges (south and east kerb faces bright, north and west faces shaded), and zebra bars with a shaded lower or right row where OSM marks a crossing.
3. WHEN a street is at least 3 tiles wide and clearly longer than wide, THE SYSTEM SHALL draw a dashed centre line (8 px dash, 8 px gap) through the middle of its width, and SHALL NOT draw one on narrower streets or on stair-stepped diagonal streets.
4. THE SYSTEM SHALL draw footpaths in or next to parks as packed earth, and all other footpaths and plazas (pedestrian areas) as flagstones with joints and lit slab corners.
5. THE SYSTEM SHALL vary park grass with tufts, small stones, flowers and trees, and bushes beside trees to form small clusters, chosen only from stable per-tile hashes, so that the same map position always shows the same art and nothing shimmers when panning or zooming.
6. THE SYSTEM SHALL draw water with three ripple frames and a shore with foam, and WHILE the user prefers reduced motion, THE SYSTEM SHALL show only the first frame and SHALL NOT schedule animation.
7. THE SYSTEM SHALL draw houses with one of three roof styles (shingles, standing-seam stripes, clay tiles), optional shutters, a stone base course, an optional door porch, a chimney on some houses, and ground-floor shop fronts with striped awnings on some apartment blocks, all chosen from the building's seed.
8. THE SYSTEM SHALL keep 4-bit and blob-mask auto-tiling, lazily painted atlas tiles and chunk caching unchanged, and SHALL add no per-frame cost except redrawing the water tiles of painted visible chunks once per ripple frame (450 ms).


### Requirement 9 (task 60): Day-cycle lighting on the map

Owner: this spec. The night-from-sunset rule (`isDark`, sunrise/sunset in `src/geo/sun.ts`) belongs to [safety-night](../safety-night/requirements.md); this requirement only reuses it and never changes routing weights.

**User Story:** As a walker, I want the map to follow the real light outside, so that an evening walk looks like an evening.

#### Acceptance Criteria

1. THE SYSTEM SHALL derive the map lighting from the sun's altitude at the map's centre and the current local time, using `sunAltitude` from `src/geo/sun.ts`, and SHALL NOT duplicate the solar formulas.
2. THE SYSTEM SHALL distinguish four phases: day (altitude ≥ 12°), golden (from 12° down to sunset), dusk (sunset down to −12°) and night (below −12°), where sunset is the same altitude at which safe routing starts treating a walk as night, and SHALL show a warm golden tint after sunrise and before sunset and a blue-purple tint at dusk.
3. THE SYSTEM SHALL change tint, lamp strength and window strength continuously with altitude: no jump between consecutive minutes, darkness never decreasing as the sun sinks, and every value within its range (tint channels 0 to 255, strengths 0 to 1).
4. WHILE it is dusk or night, THE SYSTEM SHALL light about 70 % of the windows of each building in warm yellow, chosen deterministically from the building and window position, and SHALL draw street lamps with soft light pools along streets mapped lit=yes, plus wide main streets (and, when no street in the area carries a lighting tag, every street at least 2 tiles wide), at a regular spacing of 12 tiles per kerb side.
5. THE SYSTEM SHALL draw the route, checkpoint gems, start and finish marks and the walker after the tint, so they keep their full colours, and SHALL add a small light around the walker and each gem at night.
6. THE SYSTEM SHALL apply the tint as one multiply fill per frame over the map, SHALL keep the chunk cache independent of the time of day, SHALL draw lights from cached glow sprites, and SHALL repaint for the passing time at most once a minute.
7. THE SYSTEM SHALL NOT animate the lights (no flicker, nothing that moves with panning), so that reduced-motion preferences need no special case and nothing shimmers when panning.
8. WHERE the page URL has `?time=HH:MM`, THE SYSTEM SHALL use that local time of today for the lighting only, and SHALL leave routing, night safety and the quest untouched.
9. THE SYSTEM SHALL NOT change any routing weight or planner behaviour.


### Requirement 10 (task 63): Camera and viewport

**User Story:** As a walker on any phone or desktop, I want the map to stay sharp and in the right place when the window, the screen or the zoom changes, so that it never goes blank or jumps.

#### Acceptance Criteria

1. WHEN the canvas changes size, OR the device pixel ratio changes without a size change (a window moved to another screen, browser zoom), THE SYSTEM SHALL resize the backing store, re-clamp the camera and repaint within one frame.
2. THE SYSTEM SHALL limit the backing store to 8192 px per side and 16 777 216 px in total by lowering the effective pixel ratio (never the CSS size), and SHALL draw with that effective ratio.
3. IF the canvas has no layout size (hidden or not laid out yet), THEN THE SYSTEM SHALL keep the last CSS size it saw (before any layout: the canvas's own size divided by the pixel ratio), SHALL NOT resize the backing store, and SHALL NOT treat the backing-store size as a CSS size.
4. THE SYSTEM SHALL convert between screen and tile coordinates as exact inverses (error under 1e-6 tile) at every zoom level and at any camera position the clamp allows, and zooming SHALL keep the point under the pointer fixed (before clamping).
5. WHEN stepping the zoom ladder from a zoom that is not a ladder level, THE SYSTEM SHALL go to the next level in that direction (never skip one).
6. THE SYSTEM SHALL cover every device pixel of the loaded area with a painted chunk or a stand-in: neighbouring chunks share the same rounded edge, a stand-in fills exactly its chunk's rectangle, and tile blits are aligned to whole tiles so that chunks and animated water tiles line up at any pixel ratio.
7. THE SYSTEM SHALL draw only the part of a chunk that touches the screen, so a blit never has a destination larger than the screen plus one tile at any zoom.

### Requirement 11 (task 63): Map input

**User Story:** As a walker using a thumb, a mouse or a trackpad, I want pan and zoom gestures to feel like every other map, so that I never fight the map.

#### Acceptance Criteria

1. WHEN wheel or trackpad scroll events arrive, THE SYSTEM SHALL add their vertical delta (lines and pages normalised to pixels) and zoom one ladder level per 100 px, forgetting a partial amount after 250 ms of silence; a purely horizontal wheel event SHALL NOT zoom.
2. WHILE two fingers are down, THE SYSTEM SHALL zoom to the ladder level nearest (on a log scale, with 8 % hysteresis) to the start zoom times the finger-distance ratio, without flicker between two levels, and SHALL pan with the midpoint of the fingers.
3. WHEN a one-finger or mouse drag ends faster than 0.05 px/ms, THE SYSTEM SHALL keep gliding with an exponential decay (time constant 250 ms) until under 0.02 px/ms, SHALL stop at a new touch, and SHALL NOT glide when the user prefers reduced motion.
4. WHEN a second tap or click lands within 300 ms and 24 px of the first, THE SYSTEM SHALL zoom in one level at that point and SHALL NOT report the second tap as a placed point.
5. THE SYSTEM SHALL react only to the primary button of a mouse, SHALL survive a refused pointer capture, and SHALL NOT count a cancelled pointer as a tap.
6. WHILE the canvas has keyboard focus, THE SYSTEM SHALL pan 64 px per arrow key press and zoom one level for `+` and `-`.
7. THE SYSTEM SHALL keep the gesture decisions (wheel steps, pinch level, velocity, tap pairing) in pure modules with unit tests, and the DOM binding thin.

### Requirement 12 (task 63): Frame cost, memory and repaint

**User Story:** As a walker whose phone has little memory and battery, I want the map to cost as little as it can, so that a 10 000 step walk does not heat the phone.

#### Acceptance Criteria

1. THE SYSTEM SHALL draw the route with at most one canvas call per footprint (cached footprint stamps), SHALL compute the footprint layout only when the route or the zoom changes, and SHALL skip footprints outside the screen, so a 7.5 km route costs under 1500 fill or draw calls per frame at every zoom.
2. THE SYSTEM SHALL NOT draw window or lamp light over a chunk that is not painted yet (a stand-in).
3. WHEN a chunk is evicted from the cache, or the renderer is disposed, THE SYSTEM SHALL release its canvas (width and height 0) and the entries kept for it (water tiles).
4. THE SYSTEM SHALL NOT recurse when a frame asks for another frame in an environment without `requestAnimationFrame`; the next frame SHALL run after the current one returns.
5. WHEN the page becomes visible again, THE SYSTEM SHALL repaint, so the sky matches the real time without waiting for the 60 s timer.
6. THE SYSTEM SHALL allocate no per-frame keys for chunk lookups (numeric keys) and SHALL reuse the chunk plan while camera, zoom and screen size are unchanged.
7. THE SYSTEM SHALL keep the approved look: the golden frames (day, night, dusk with water and tracks, far zoom, avoided streets) stay pixel-identical, and any visible change SHALL be listed in `design.md` ("Architecture review").
8. THE SYSTEM SHALL keep street lamp positions independent of the chunk size used to ask for them.

### Requirement 13 (task 63): Renderer structure

**User Story:** As the maintainer, I want the map renderer split into small modules with one job each, so that a change to the sky cannot break the camera.

#### Acceptance Criteria

1. THE SYSTEM SHALL keep `MapRenderer` as a thin facade with its current public API, wiring these modules: `camera.ts` (pure view maths), `viewport.ts` (backing store and pixel ratio), `chunkLayer.ts` with `atlas.ts` and `overview.ts` (terrain, structures, water, stand-ins, caches), `lightingLayer.ts` (clock, tint, window and lamp light), `overlayLayer.ts` with `footprintLayer.ts`, `walkerMotion.ts`, `bubble.ts` (route, tape, tracks, gems, walker, speech bubble, pickups), `frameScheduler.ts`, and `gestures.ts` with `src/ui/mapInput.ts` (input).
2. THE SYSTEM SHALL keep Web Audio, React and routing out of these modules; the pure ones SHALL NOT touch the DOM.
3. THE SYSTEM SHALL contain no code that nothing calls (route chevrons, unused getters and constants).


### Requirement 14 (task 66): Map data client and cache

**User Story:** As a walker on a patchy connection, I want a damaged cache, a full disk or a half-finished answer to cost me a retry, not a broken map, so that the next press of "Load this area" works.

Related: 1.3 and 1.4 (cache, one request, 10 s gap, 36 km² cap, mirrors), [routing](../routing/requirements.md) (the graph reads the decoded data).

#### Acceptance Criteria

1. WHEN a box is not finite, not ordered (south < north, west < east) or outside latitude ±90 and longitude ±180, THE SYSTEM SHALL refuse it with the error `badArea` before any cache or network access, and SHALL NOT build an Overpass query for it.
2. THE SYSTEM SHALL measure the area of a box exactly on the sphere, SHALL grow the box outwards to the 0.001° cache grid before downloading, and SHALL apply the 36 km² cap to that grown box; the box `areaForWalk` returns SHALL fit under the cap after growing.
3. THE SYSTEM SHALL key cache entries by the codec version and the grown box, so that an entry covers every request with its key and a new data format never reads old entries.
4. WHEN a cache entry cannot be decoded (damaged, from another version, wrong shape), THE SYSTEM SHALL delete it, treat it as a miss and download, and SHALL NOT surface the decoding error.
5. WHEN an entry or an area-index record has a saved-at time that is not a number, older than 7 days, or more than 5 minutes in the future, THE SYSTEM SHALL treat it as expired; index records of the wrong shape SHALL be ignored one by one.
6. WHEN the cache cannot write (quota exceeded, blocked, aborted), THE SYSTEM SHALL still return the downloaded map and SHALL NOT record the area in the index.
7. WHEN a download has been saved, THE SYSTEM SHALL delete the data of index records that expired or fell off the end of the index, and once per session the entries written under an older cache version; this SHALL use local storage only and SHALL NOT send any request.
8. THE SYSTEM SHALL decode an answer before caching it and SHALL NOT cache one it cannot read; an unreadable answer SHALL be reported as `badResponse`.
9. WHEN Overpass answers with something that is not a JSON object with an `elements` array, or with a timeout remark (`runtime error`, `timed out`, `out of memory`), THE SYSTEM SHALL NOT treat it as a map: the first is `badResponse`, the second `busy`. Status 429 and 504 SHALL stay `rateLimited`, and every mirror SHALL still get exactly one request.
10. WHEN the IndexedDB connection fails to open or is closed by the browser, THE SYSTEM SHALL open it again on the next use instead of remembering the failure for the session.

### Requirement 15 (task 66): OSM parsing and the compact format

**User Story:** As the maintainer, I want every way the parser accepts to be usable by the rasterizer and the graph, so that one odd OSM object cannot draw a chord across the map.

Related: [routing](../routing/requirements.md) (walkable ways, tunnels, roundabouts).

#### Acceptance Criteria

1. WHEN a way point has a missing, non-finite or out-of-range coordinate, THE SYSTEM SHALL treat it as a gap and split lines there (as it does for a point outside the query).
2. THE SYSTEM SHALL drop an area way (building, park, water, area road or path) with fewer than three different corners.
3. WHEN a multipolygon relation with a building, park or water tag arrives with member geometry, THE SYSTEM SHALL join its outer ways into closed rings, give every inner ring to the smallest outer ring that contains it, and produce one area way per outer ring with its `holes`; rings that cannot close SHALL be dropped, and a separately tagged building inside a courtyard SHALL stay.
4. WHEN an outer member of such a relation is also tagged on its own with the same kind, THE SYSTEM SHALL keep only the relation, so the hole is not filled again.
5. THE SYSTEM SHALL decide `tunnel` from an explicit `tunnel` tag first (`tunnel=no` is not underground even with `layer=-1`), then from a negative `layer`, and a way with `bridge=*` (other than `no`) SHALL NOT be a tunnel; roads and paths on a bridge SHALL carry `bridge`.
6. THE SYSTEM SHALL write the compact format with a version number (`CODEC_VERSION`, now 4: adds the bridge flag and holes) and SHALL decode versions 1 to 4.
7. WHEN compact data has an unknown version, a feature kind outside the known list, a node index outside the coordinate list, mismatched coordinate arrays, a bad bounding box or fewer ids than ways, THE SYSTEM SHALL throw `CorruptDataError` and SHALL NOT replace the damaged part by a default (an unknown kind used to become a road).
8. THE fixture build script (`scripts/build-fixture.ts`) SHALL refuse an input without an `elements` array, merge relation members, keep the newest timestamp, check that the encoded file decodes, and never overwrite the fixture with an empty map.
9. THE SYSTEM SHALL keep the Overpass query to ways and nodes (no relations), because adding relations raises the answer size; relation geometry is parsed whenever an extract contains it (for example one saved for `npm run fixture`). Adding relations to the live query needs a decision from the owner and an update to `osm-etiquette.md`.

### Requirement 16 (task 66): Tile rasterizer

**User Story:** As a walker, I want a courtyard to look like a courtyard and a bridge like a bridge, and I want a large area to load without freezing the phone.

Related: 2.1 to 2.3 (layers, terrain priority, 4-connected paths), 6a.

#### Acceptance Criteria

1. THE SYSTEM SHALL visit only tiles inside the grid when rasterizing, so the cost follows the area drawn and not the size of the features: a polygon or line that reaches far outside the grid SHALL cost no more than one that ends at the edge, and a 6 × 6 km area (the cap) SHALL rasterize in under one second.
2. WHEN a polygon way has holes, THE SYSTEM SHALL leave the tiles of every hole empty (even-odd fill), and a self-crossing outline SHALL follow the even-odd rule.
3. THE SYSTEM SHALL ignore points that are not finite, SHALL paint nothing for a ring whose corners are on one line, and SHALL NOT loop or throw for a zero-length segment.
4. THE SYSTEM SHALL step a 4-connected line from its first tile to its last tile whatever the slope (including slopes that round to zero), never away from the end tile.
5. THE SYSTEM SHALL NOT paint tunnels over the surface, SHALL paint bridge roads and paths over water and buildings, and SHALL NOT draw rail tracks on top of a tile covered by a bridge deck; rails that meet no bridge SHALL be left unchanged.
6. THE SYSTEM SHALL keep the rasterized layers, terrain, styles, barriers and rails of the bundled Benicalap fixture identical to those before task 66, and SHALL keep every golden frame.
7. THE SYSTEM SHALL wrap longitude differences at the antimeridian in the local projection, keep the east-west scale finite next to a pole, and keep a box around any point inside the valid coordinate range; its distance error SHALL stay under 0.5 % within 6 km up to latitude 70°.

### Requirement 17 (task 69): Town layout

**User Story:** As a walker, I want the houses, special buildings and park gates to sit where the map says, the same every time, so that my street looks like itself and nothing is drawn on top of anything else.

#### Acceptance Criteria

1. THE SYSTEM SHALL produce the same town (houses, gardens, landmarks, gates, trees) for the same map data whatever the order of the landmark points in that data.
2. THE SYSTEM SHALL put a house only on building tiles that no landmark or park gate has taken, and houses SHALL NOT overlap one another, roads, water, plazas or landmarks.
3. WHEN a landmark point has an unknown kind, a non-finite position or lies outside the map, THE SYSTEM SHALL ignore it and SHALL NOT fail. WHEN several points of one kind share a tile, or a point lies inside a landmark of its own kind, THE SYSTEM SHALL draw one landmark for them.
4. THE SYSTEM SHALL place every landmark wholly inside the map, on free tiles, within 9 tiles of its point, and SHALL NOT let two landmarks or gates overlap.
5. THE SYSTEM SHALL keep park gates inside the map and off landmarks, houses and other gates.
6. THE SYSTEM SHALL NOT put a garden tree on a house, fence or gate tile.
7. WHEN a block is too small or too thin for a 2 × 2 house, THE SYSTEM SHALL leave it as plain building tiles.
8. THE SYSTEM SHALL lay out a 600 × 600 tile map (3 km square, a quarter of the 36 km² cap) in a time that grows linearly with the number of tiles (`layoutBench.test.ts` reports it and fails above a generous budget).
9. THE SYSTEM SHALL keep the town layout in small modules (types, random, block analysis, landmarks and gates, houses) behind `layout.ts`, whose public names do not change.
