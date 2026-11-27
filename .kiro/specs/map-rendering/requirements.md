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
5. THE SYSTEM SHALL show "OpenFreeMap © OpenMapTiles © OpenStreetMap contributors" (ODbL data) on the map at all times.

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
7. THE SYSTEM SHALL NOT move any light with panning, and SHALL animate lights only as requirement 22 describes (a slight flicker and firefly glints, both off with reduced motion). *(Amended by 22; it used to forbid all animation.)*
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

### Requirement 18 (task 72): OpenStreetMap credit in one fixed place

**User Story:** As a walker and as a data licensor, I want the OpenStreetMap credit in the same small corner of every map, so that it is always visible, readable and never hides under a panel.

#### Acceptance Criteria

1. THE SYSTEM SHALL show the credit "OpenFreeMap © OpenMapTiles © OpenStreetMap contributors" (Spanish: "OpenFreeMap © OpenMapTiles © colaboradores de OpenStreetMap") on the planner map and on the quest map, as a link to `https://www.openstreetmap.org/copyright`, in the bottom-left corner of the map viewport.
2. THE SYSTEM SHALL keep that position constant whatever the content: it SHALL NOT depend on the panels, banners, dialogs or HUD that are shown, and no rule for `.map-attribution` outside the single base rule SHALL move it.
3. THE SYSTEM SHALL keep the credit clear of everything else: the quest bottom HUD and the map banners SHALL start above the credit strip (`--attr-h`), and the credit SHALL be above the map canvas in stacking order so the link can be tapped.
4. THE SYSTEM SHALL draw the credit with a font size of at least 7 px (the page-zoom-lock minimum), dark ink on a paper backing of at least 85 % opacity (contrast above 4.5:1), and SHALL NOT hide it at any viewport size.

### Requirement 19 (task 70): Streaming multi-area world

**User Story:** As a walker in the middle of a quest, I want to zoom out or pan and always see the real streets around me, so that the map has no hard edge where the data stops.

Related: [routing](../routing/requirements.md) (the walking graph grows with the map, requirements 3 and 4), [quest](../quest/requirements.md) (the active route, gems, progress and rerouting never move because of new data), `.kiro/steering/osm-etiquette.md` (every rule there still holds).

#### Acceptance Criteria

1. THE SYSTEM SHALL split the world into fixed cells of 0.01° of latitude by 0.01° of longitude (about 1.1 × 0.9 km at València), identified by integer indices (`floor(lat / 0.01)`, `floor(lon / 0.01)`), so that every point is in exactly one cell and neighbouring cells share an edge exactly.
2. WHEN the view rests (no pan or zoom for `SETTLE_MS`), THE SYSTEM SHALL list the cells that touch the view and are not yet loaded, nearest to the view centre first, and SHALL request them in batches of at most 4 cells that form a rectangle (one bounding box, at most 4 km², well under the 36 km² cap). **Superseded by 20.4, 20.5, 20.8 (batches adapt, 1 to 6 cells, and the coarse layer comes first).**
3. WHILE a cell request is running, THE SYSTEM SHALL NOT start another request (the second is refused, never queued), and SHALL leave at least `MIN_REQUEST_GAP_MS` between two downloads from the tab. **Superseded by 20.7 (two downloads, 1.5 s apart).**
4. WHEN the view moves while cells are waiting, THE SYSTEM SHALL cancel the stale wish list and plan again from the new view; a pan that never rests SHALL send no request.
5. THE SYSTEM SHALL download at most `MAX_CELLS_PER_MINUTE` cells in any 60 s window, SHALL NOT retry a failed cell before a back-off that starts at 30 s, doubles after each failure and ends at 5 minutes, and SHALL treat status 429 and 504 as `rateLimited` and enter the back-off at once. Every mirror still gets exactly one request per download. **Superseded by 20.7 and 20.10 (requests per minute, back-off 4 s to 2 min with jitter). The 429 and 504 mapping and one request per mirror per download are replaced by 20.9.**
6. THE SYSTEM SHALL look for a cell in IndexedDB before any request, SHALL store each downloaded cell under its own key (`v<codec>:cell:<i>,<j>`) with the 7-day expiry of requirement 14.5, SHALL treat a damaged or expired entry as a miss, and SHALL keep at most 300 cell entries (oldest saved first out, deleted locally, no request). **Amended by 21.10: cells now feed the walking graph only; nothing is drawn because of them alone.**
7. WHEN a request returns, THE SYSTEM SHALL cut the answer into the cells it asked for and SHALL NOT cache or draw a cell the answer cannot cover.
8. THE SYSTEM SHALL merge cells into one world: a way that appears in several cells (same OSM id) becomes one way; a way that was cut at a cell border and meets its other half at a shared point becomes one continuous way; nodes at the same coordinates in different cells become one node; points of interest and activity points are not duplicated. The result SHALL NOT depend on the order in which the cells arrive.
9. THE SYSTEM SHALL rasterize each cell into one shared tile grid of fixed extent (a frame of at most 9 × 9 cells around the first area) that uses a single projection, so the tiles of neighbouring cells line up exactly; the layers, terrain, styles, barriers and bridge flags of a cell SHALL depend only on that cell's own data, not on which neighbours are loaded.
10. THE SYSTEM SHALL lay out the town (houses, gardens, landmarks, park gates, trees) per cell from that cell's own data, only on tiles the cell owns, so that two cells never place overlapping structures and the layout of a cell is the same whatever the order of arrival. **Superseded for houses by 20.12 (a building is built whole by the cell that holds its centre). Landmarks, park gates and the order-independence rule still hold.**
11. WHEN a cell is added, THE SYSTEM SHALL extend the walking graph with its edges only (existing node and edge ids stay valid), SHALL connect ways across the border, and the graph SHALL describe the same nodes and edges (by coordinates) as a graph built in one go from the merged data.
12. WHILE a quest is active, THE SYSTEM SHALL keep streaming cells; new cells SHALL only add drawing and graph edges for future reroutes. THE SYSTEM SHALL NOT change the quest state, the planned route, the gems, the progress or the map object the renderer holds, and a reroute started after a cell arrived SHALL use the larger graph. **Amended by 20.17: when the frame moves, the map view gets a new grid object (the renderer is rebuilt at the same place and zoom); the quest state, route, gems, progress, merged data and graph still do not change.**
13. WHEN the view is at a zoom below `DETAIL_ZOOM`, THE SYSTEM SHALL draw one pixel per tile from a cached overview that updates per cell; WHEN the zoom is at or below `FAR_ZOOM` (1.5), THE SYSTEM SHALL draw the simplified overview (roads, paths, water, parks, and plain building colour; no houses, landmarks or lights).
14. THE SYSTEM SHALL draw a subtle two-tone stipple (never black) over every tile of a cell that is not loaded yet, in the detailed chunks and in both overviews, and SHALL redraw the affected chunks and the overview rectangle, one tile wider than the cell, when a cell arrives or leaves. **Superseded by 20.6: only a cell with no data at all gets the stipple.**
15. THE SYSTEM SHALL keep at most `MAX_RESIDENT_CELLS` (49) cells in memory; WHEN more are loaded, it SHALL drop the cells farthest from the view centre first (least recently seen), SHALL NOT drop a cell that touches the active route (with one cell of margin) or the view, and SHALL clear the tiles, town and graph edges of a dropped cell. A dropped cell that comes back into view is read from IndexedDB without a request.
16. THE SYSTEM SHALL NOT load a cell outside the frame (4 cells from the first cell in each direction); a view that rests outside it keeps the existing "load this area" offer, which is never made during a quest. **Superseded by 20.17 while a route is planned or a quest runs: the frame follows the view. Without a route the offer stays.**
17. WHEN the bundled Benicalap extract is the world, THE SYSTEM SHALL work offline exactly as before (the extract is the first set of cells; cells outside it are requested only when the tab is online).
18. THE SYSTEM SHALL keep the credit of requirement 18 on the map at all times, also while cells load, and SHALL NOT start any request in tests (streaming is off under Vitest unless a test passes its own client).
19. THE SYSTEM SHALL plan the cells to load from the real view box (width and height in metres at the screen's own aspect ratio, never a square radius around the centre), so that every cell the view touches is wanted at every zoom the view can reach.
20. WHILE a quest is active, THE SYSTEM SHALL keep the view inside the coverable window: the map's minimum zoom is the smallest ladder zoom at which the view, at its real width, height and latitude and in the worst alignment with the cell grid, touches at most `QUEST_WINDOW_CELLS` cells (equal to `MAX_CELLS_PER_MINUTE`, 12), so one minute of the unchanged request budget covers the whole view. Zoom-out buttons, pinch, wheel, keys and a window resize SHALL NOT go below it. Outside a quest the zoom range is unchanged. **Superseded by 20.13 (the budget counts coarse regions at wide zooms).**
21. WHERE the loaded map ends and no data has arrived (a cell still loading, in back-off, offline, or outside the frame), THE SYSTEM SHALL NOT draw a straight cut: the loaded side of that frontier SHALL fade into the no-data ground through a band of ordered dither (five steps, dense at the edge, sparse inside), drawn in the detailed chunks and in both overviews, with a width that is constant on screen at every zoom. The band SHALL use only the no-data ground colour (never black) and SHALL NOT be drawn along a border shared with a loaded cell. **Superseded by 20.6: the band only follows the edge of everything drawn, never a border between detail and coarse cells.**
22. THE SYSTEM SHALL leave the Overpass etiquette unchanged by requirements 19 to 21: one request in flight, at most `MAX_CELLS_PER_MINUTE` (12) cells in any 60 s window, the cache and back-off rules of requirements 3 to 6. **Superseded by 20.7 to 20.10 and the new limits in `osm-etiquette.md`.**

### Requirement 20 (task 73): Map loading v2, coarse layer first

**User Story:** As a walker on a phone with a patchy mobile connection, I want the whole screen to show streets, parks and water within seconds of opening the map or zooming out, with the buildings filling in behind, so that the map never looks broken and never stops loading.

Related: [routing](../routing/requirements.md) (the walking graph only ever sees detail cells; safety and night weights are unchanged), [quest](../quest/requirements.md) (nothing about the active route changes when data arrives), `.kiro/steering/osm-etiquette.md` (limits and reasons), design.md "Root cause" (what the field report came from). This requirement replaces the parts of requirement 19 marked "Superseded" above; every other criterion of 19 holds.

#### Acceptance Criteria

1. THE SYSTEM SHALL offer a coarse layer in regions of 5 × 5 cells (0.05° square, at most 24 km² at València, under the 36 km² cap, aligned to cell borders), loaded with ONE query per region that asks only for streets from motorway to living street and pedestrian, parks and commons, forest, farmland, orchards, allotments, cemeteries, reservoirs, water and woods, rivers and canals, and rail, and SHALL drop everything else from the answer (buildings, barriers, paths and service ways, lawns and small gardens, points of interest). **Superseded by 21.4 (coarse layer from z12 vector tiles; no Overpass query).**
2. THE SYSTEM SHALL cache each coarse region as one entry (`v<codec>:coarse:<i>,<j>`, 7-day expiry, damaged or expired counts as a miss, at most 16 entries, oldest saved first out, deleted locally), SHALL read it before any request, and SHALL cut it into cell records. **Superseded by 21.8 (tiles cached per tile).**
3. THE SYSTEM SHALL paint a coarse cell as tiles and tracks only: no houses, landmarks or gates, and no entry in the merged data, the walking graph or the safety context. A coarse record SHALL NOT be painted over a cell that has a detail record, SHALL be kept, and SHALL be painted again when the detail of that cell is dropped; a detail record SHALL replace the coarse tiles of its cell.
4. THE SYSTEM SHALL request detail cells only while the zoom is above `FAR_ZOOM` (1.5), which is where buildings and houses are drawn; at or below it the coarse layer is all the view needs and no detail request is made for the view. **Superseded by 21.5 (z14 vector tiles above `FAR_ZOOM`).**
5. WHEN the view rests, THE SYSTEM SHALL request, in two lanes that take turns with one request each: coarse regions (the region under the view centre first, then the other regions the view touches, then those the view would touch at its lowest reachable zoom, nearest first, at most 6 of the latter) and detail batches (cells of the view, nearest to the centre first). Cached regions and cells SHALL be read and drawn at once when the view changes, without waiting for it to rest, and SHALL cost no request. **Superseded by 21.5, 21.8 and 21.9 (no horizon prefetch).**
6. THE SYSTEM SHALL draw the stipple only over cells that have neither a coarse nor a detail record, and the dithered band of 19.21 only along an edge of the area that has any record, never along a border between a detail cell and a coarse cell. Where detail is missing and the coarse layer is there, the coarse tiles are the placeholder.
7. THE SYSTEM SHALL run at most 2 downloads at once (`MAX_IN_FLIGHT`), start them at least 1.5 s apart (`MIN_REQUEST_GAP_MS`) and at most 12 per rolling minute, SHALL give an explicit "load this area" download the client to itself, and SHALL start nothing while the device is offline.
8. THE SYSTEM SHALL size a detail request at 1 to 6 cells forming a rectangle (at most 6 km²): it starts at 2, grows by one after an answer in under 10 s up to a ceiling, and after a failure of a batch of n cells the ceiling becomes n − 1 and the batch halves (never below 1); after 8 quick answers at the ceiling it tries one more. **Superseded by 21.10 (graph cells only, batches of 2).**
9. THE SYSTEM SHALL NOT let any download hang. Mirrors are asked in order, the last good one first; the next mirror joins when the one before failed or has sent no answer header for 6 s; the first mirror to send a good header wins and the others are cancelled before they send a body (a phone never splits its link across mirrors). A mirror gets 25 s for its header, an answer that stalls for 12 s is cut off, and one call ends within 60 s; the client frees its slot and aborts the worker after 75 s whatever happens, and the streamer gives up on a unit after 100 s. A cache read that takes more than 2 s counts as a miss and a write that takes more than 5 s as not saved. A 429 or 504 answer, a query that timed out on the server, an unreadable answer and an answer without `elements` keep their codes and are never cached.
10. WHEN a unit (a region or a cell) fails, THE SYSTEM SHALL retry it after 4 s, doubling per failure to 2 min, each wait randomised by ±25 %, SHALL keep retrying for as long as the view needs it, SHALL NOT let one failing unit delay another, and WHEN the server answers 429 or 504 SHALL pause every start for at least 20 s (randomised, longer after repeated failures). **Amended by 21.8 and 21.10: these numbers are for graph cells; tiles have their own.**
11. THE SYSTEM SHALL hand a downloaded answer to the map before its cache writes finish (writes run one job at a time afterwards), and SHALL add the cells of one answer one at a time with a yield between them, one change notice per cell, so no frame carries more than one cell of rasterizing, town layout and graph work.
12. THE SYSTEM SHALL build a building whole: a building belongs to the cell that holds the centre of its bounding box (south and west edges in, north and east out), that cell lays out its houses on the building's tiles even where they lie in a neighbour's tiles (the window widens to hold the building, at most 80 tiles), the other cells build nothing on it, and a landmark never stands on a building another cell owns. The houses, trees and fences of a cell that reach into a neighbour's tiles SHALL be found by the town lookup there, SHALL be repainted when the owner arrives or leaves, and SHALL NOT depend on the order cells arrive in.
13. WHILE a quest is active, THE SYSTEM SHALL keep the minimum zoom at the smallest ladder zoom whose view, in the worst alignment with the grid, touches at most 4 regions when the zoom is at or below `FAR_ZOOM` and at most 12 cells above it. The planner is not limited. **Superseded by 21.11.**
14. WHILE a planned or active route exists, THE SYSTEM SHALL also load the detail cells of the route within 1.2 km ahead of the view centre (at most 6 cells, nearest along the route first) and the coarse regions of those cells, but only while no download is running, so one slot always stays for the view. **Superseded by 21.9 (tiles) and 21.10 (graph cells).**
15. THE SYSTEM SHALL expose a read-only load state on the map canvas, measured over every cell the camera shows (inside the frame or not; a cell outside the frame has nothing drawn): `data-map-ready` is `full` when every cell in view has what the zoom needs (detail above `FAR_ZOOM`, any layer at or below it), `coarse` when not, but every cell in view has at least the coarse layer, and `loading` otherwise; `data-map-pending` is the number of cells in view that still lack what the zoom needs (0 when `full`). With streaming off, the state is `full` and 0. The state SHALL change no visible element or text.
16. THE SYSTEM SHALL show the credit "© OpenStreetMap contributors" (Spanish "© colaboradores de OpenStreetMap") as a link to `https://www.openstreetmap.org/copyright`, `OSM_ATTRIBUTION` SHALL hold the English text, and all tests SHALL run without the network. **Superseded by 21.12.**
17. WHILE a route is planned or a quest runs, WHEN the view rests (`SETTLE_MS`) showing any cell outside the frame, THE SYSTEM SHALL move the frame so it is centred on the cell under the view centre, keep the merged data, the detail records and the walking graph (so the route, gems, progress and reroutes are untouched), forget the coarse records outside the new frame (they come back from the cache), repaint the records inside the new frame one cell per task nearest the view centre first, rebuild the map renderer on the new grid at the same place and zoom, and then plan coarse and detail work (20.4, 20.5) for the view. THE SYSTEM SHALL NOT move the frame onto the cell it is already centred on. Without a route, a view that rests outside the frame keeps the "load this area" behaviour of 7a.5.


### Requirement 21 (task 74): The map is drawn from vector tiles, not from Overpass

**User Story:** As a walker on a phone, I want the map to appear within seconds wherever I look, even when the public map servers that plan routes are overloaded, so that the screen never stays blank.

Related: requirements 19 and 20 (the cells, the frame, readiness, the frame that follows the view; the parts marked "Superseded by 21" no longer hold), [routing](../routing/requirements.md) (the walking graph, safety and night weights are unchanged and still built from OpenStreetMap ways from Overpass or the bundled extract), `.kiro/steering/osm-etiquette.md` (Overpass and OpenFreeMap rules), design.md "Map data from vector tiles" (measurements and reasons).

#### Acceptance Criteria

1. THE SYSTEM SHALL draw the map only from data that is already on the device (the bundled extract and loaded graph cells) and from vector tiles in the OpenMapTiles schema served by OpenFreeMap; no part of the drawing SHALL wait for, or depend on, an Overpass request.
2. THE SYSTEM SHALL read the tile URL template and the highest zoom from the TileJSON `https://tiles.openfreemap.org/planet` at run time, keep it for 24 hours (on the device), use a stored older one when the read fails, and SHALL NOT write a tileset version into the code.
3. THE SYSTEM SHALL turn each OpenMapTiles feature into the OpenStreetMap tags it stands for and classify it with the same rules as Overpass data, so that the same street, park, water, building or landmark gets the same art: `transportation` classes motorway to tertiary (with `ramp` as `_link`), `minor` as residential, `service`, `track`, `busway`, `path` with its subclass (pedestrian areas as plazas), rail, light rail, tram and subway, `brunnel` as bridge or tunnel; `building`; `landcover` and `park` greens, woods and farmland; `landuse` pitches, playgrounds and cemeteries; `water` (not swimming pools) and `waterway`; `poi` supermarkets (the green market by name), hospitals and clinics, stations and schools.
4. THE SYSTEM SHALL draw the coarse layer from z13 tiles with everything they hold except points of interest (every street and path class, buildings, landcover, parks, pitches, water, waterways, rail), painted as tiles without town, so that at every zoom at or below `FAR_ZOOM` a place drawn from the coarse layer looks like a place drawn from the detail layer or the bundled extract (no visible square). The coarse layer is also the placeholder where detail is missing. *(Amended by task 75: was z12 filtered to main streets and big areas, which drew a sparse map around a dense square.)*
5. THE SYSTEM SHALL draw the detail layer (buildings, houses, paths, landmarks) from z14 tiles, the highest zoom the service has, and use them for every closer zoom; a cell is drawn from detail once every z14 tile that meets the cell grown by 0.004° has arrived.
6. THE SYSTEM SHALL clip every tile's geometry exactly at the tile edge in tile units and convert it to degrees from the global integer tile coordinate, so that two neighbours share their edge to the last bit; the pieces of a building that meet across a seam SHALL share one anchor (the centre of the box of all pieces), and the cell that holds the anchor SHALL build the houses of every piece, so that the pieces rasterize to exactly the tiles of the uncut building and get the same houses whatever the order in which cells arrive.
7. THE SYSTEM SHALL paint each cell from, in this order of preference: a complete graph record, a vector-tile detail record, a coarse record, a partial graph record (one that covers only part of its cell, such as the edge cells of the bundled extract); a partial graph record SHALL be painted only while the cell has no tile record, and SHALL then count as not covered. WHILE the view zoom is at or below `FAR_ZOOM`, THE SYSTEM SHALL paint every cell that has a coarse record from it, also a cell with a graph record, and SHALL load the coarse tiles of every visible cell for that purpose, so that the far zooms show one source and no square; above `FAR_ZOOM` the order above applies again. Switching repaints the visible cells first, one per task, nearest the view centre first, keeping the old paint on screen until the new one is in. Vector-tile records for drawing SHALL NOT enter the merged data, the walking graph or the safety context (*amended by requirement 23: walking records, which hold only walkable lines and are never painted, do*). *(Amended by task 75: a partial graph record used to win over the coarse layer, leaving the rest of its cell flat ground while readiness said `full`.)*
8. THE SYSTEM SHALL fetch tiles with at most 4 downloads at once (OpenFreeMap's limit for parallel requests), end one request after 15 s and free its slot after 25 s whatever happens, give up on a unit after 40 s, retry a failed tile after 2 s doubling to 60 s (±25 % random), pause every tile start for 30 s (±25 %) after a 429, read 204 and 404 as an empty tile, start at most 60 tile downloads in any 60 s, read the IndexedDB cache (7 days, at most 60 tiles, oldest saved first out; a read over 2 s counts as a miss) before any request and draw a cached tile at once without waiting for the view to rest, request nothing before the view has rested 0.4 s or while offline, and save tiles only after they were handed to the map.
9. WHILE a route is planned or a quest runs, THE SYSTEM SHALL also load the detail tiles of the cells within 1.2 km of the route ahead of the view centre (at most 6 cells); THE SYSTEM SHALL NOT prefetch anything else beyond the view.
10. THE SYSTEM SHALL ask Overpass only for what tiles cannot give (*amended by requirement 23: the area download is gone, the streets come from tiles and Overpass only enriches them*): graph cells along the route ahead and the enrichment of requirement 23.5 (one request at a time, at most 2 cells, back-off 4 s doubling to 2 min, the limits of 20.7 and the mirror rules of 20.9). A failed or slow Overpass request SHALL NOT change what is drawn or the load state.
11. WHILE a quest is active, THE SYSTEM SHALL keep the minimum zoom at the smallest ladder zoom whose view, in the worst alignment, touches at most 12 z13 tiles at or below `FAR_ZOOM` (about 3.8 km each; 6 in a typical alignment) or 6 z14 tiles above it, and spans at most 9 cells on each axis (the frame). On the 390 × 844 reference phone at València there is no floor (0.5).
12. THE SYSTEM SHALL show the credit "OpenFreeMap © OpenMapTiles © OpenStreetMap contributors" (Spanish: "OpenFreeMap © OpenMapTiles © colaboradores de OpenStreetMap") in the fixed corner of requirement 18, with each part linked (openfreemap.org, openmaptiles.org, openstreetmap.org/copyright), on one line on a 320 px screen, in a narrow sans font of at least 7 px, with a visible space before each "©" as laid out by the browser (the links SHALL sit in one inline run, not as separate flex items, whose whitespace a browser drops); `OSM_ATTRIBUTION` SHALL hold the English text.
13. THE SYSTEM SHALL decode and convert tiles in one Web Worker kept for the session, and SHALL add one cell per task on the main thread.
14. THE SYSTEM SHALL keep `data-map-ready` and `data-map-pending` (20.15) over the cells the camera shows, where a cell counts as covered only when the record painted for it covers the whole cell; `data-map-ready` SHALL NOT be `full` (nor `coarse`) while any visible cell lacks a whole-cell record, and every cell that lacks one SHALL be counted in `data-map-pending`. All tests SHALL run without the network (tiles are built in the test).
15. WHEN `data-map-ready` is `full` at the lowest zoom of a quest, THE SYSTEM SHALL have painted map data on every pixel row and column of the map canvas, including the part under the quest HUD and the panels; no row or column SHALL show only the no-data ground.


### Requirement 22 (task 76): Visible street lamps and night details

**User Story:** As a walker out after sunset, I want lamp posts, glowing pools and a few small night details on the map, so that an evening walk looks like an evening and I can still see my route and gems first.

Related: requirement 9 (day cycle, `?time=HH:MM`), [safety-night](../safety-night/requirements.md) (routing weights are untouched).

#### Acceptance Criteria

1. WHILE `lamps` strength is above 0.02 at detail zoom (at or above `DETAIL_ZOOM`), THE SYSTEM SHALL draw a pixel-art lamp post (dark post, cap and a bright bulb) on each lamp's kerb tile, with a warm pool of light on the ground drawn with the additive (`lighter`) blend, over painted chunks only.
2. THE SYSTEM SHALL place lamps from the tile grid by a pure, deterministic rule (requirement 9.4): the same grid gives the same lamps in the same order, every lamp stands on a road or crossing tile at a kerb, and lamps on one kerb side are `LAMP_SPACING * 2` tiles apart. The map sources carry no `highway=street_lamp` nodes (the walking graph holds ways only, the vector tiles hold no lamp points), so no lamp is read from the data; if a source ever provides lamp nodes, they replace the procedural lamps within their cell.
3. BELOW `DETAIL_ZOOM` (the overview, including `FAR_ZOOM` and under), THE SYSTEM SHALL draw each lamp as a small light dot of 1 to 3 device pixels (the pool only, no sprite, no window light), from the lamps of the chunks the view touches.
4. THE SYSTEM SHALL bound the lamp cost: at most `MAX_LAMPS_PER_CHUNK` lamps are drawn per chunk and at most `MAX_LAMPS_PER_FRAME` per frame; when a chunk holds more, it keeps an evenly spaced subset (the same subset every frame). Lamp lists are cached per grid and chunk size, and the lamp sprite and pool are painted once into cached canvases.
5. WHEN the user does not prefer reduced motion, THE SYSTEM SHALL let each pool flicker by at most 8 % of its strength, in steps of `FLICKER_MS`, each lamp on its own deterministic phase, and SHALL schedule at most one repaint timer for it; WHEN the user prefers reduced motion, THE SYSTEM SHALL draw every pool at full strength with no timer.
6. WHILE it is dusk or night at detail zoom, THE SYSTEM SHALL draw a few fireflies in parks: at most `MAX_FIREFLIES_PER_CHUNK` per chunk on park, wood, garden and grass tiles chosen from a hash of the tile (deterministic), each a 1 to 2 art-pixel warm green-yellow glint that blinks with reduced motion off and stays steady and dim with it on. There is no traffic and no headlight light.
7. THE SYSTEM SHALL keep lit windows as in requirement 9.4 (about 70 %, a function of the building and window position only), and SHALL keep every night detail below the route, gems, walker and bubble in the draw order and no brighter than the gem glow, so the route stays the most visible thing.
8. THE SYSTEM SHALL draw every night detail from code (no image assets, nothing from another game), and SHALL NOT change any routing weight or planner behaviour.
9. THE SYSTEM SHALL keep the approved golden frames pixel-identical except the frames that show night lamps (the night frame at zoom 24 changes because lamps now have posts); the change is listed in `design.md`, and a new golden pins a night frame with lamps, fireflies and a far-zoom dot frame.

### Requirement 23 (task 78): Walking-only records from vector tiles, Overpass as enrichment

**User Story:** As a walker, I want the streets I can walk on to arrive with the map, so that planning does not depend on a slow public server.

Related: requirement 21 (drawing; 21.1, 21.7 and 21.10 are amended here), [routing](../routing/requirements.md) requirements 12 and 13.

#### Acceptance Criteria

1. THE SYSTEM SHALL turn the z14 tiles that meet a set of cells into walking records: one record per cell holding only the walkable lines (requirement 13.1 of routing), cut from one network built over all tiles of the request so that the snapping and the joins are the same in every cell. A walking record SHALL enter the merged data and the walking graph, SHALL NOT be painted, and SHALL NOT replace a graph record of the same cell (the bundled extract keeps its cells).
2. THE SYSTEM SHALL load those tiles with at most 4 downloads at once, cache first (the tile cache of 21.8), each request ending after 15 s, up to 2 retries per tile after 1 s and 2 s (±25 %), the whole load ending after 40 s with a `timeout` error, and report progress (tiles in, tiles in all) to the caller.
3. THE SYSTEM SHALL tell the frame apart from the graph: a cell counts as having a graph when it has a graph record or a walking record. `needsGraph` SHALL be false for a cell with a walking record, so the route-ahead lane does not ask Overpass for it.
4. WHEN the start (or finish) lies in a cell outside the frame, THE SYSTEM SHALL make a new world centred on the walk and load the walking records into it; WHEN the cells are in the frame, THE SYSTEM SHALL add them to the world on screen without clearing the plan or the start.
5. THE SYSTEM SHALL enrich walking records from Overpass cells: a cell from the device cache at once, a cell from the network only in the background, one request at a time, each ending after 12 s, never while a plan waits. An Overpass way is matched to a tile way when most of the tile way's sample points lie within 6 m of it and run within 25° of its direction; the match gives the tile way the `safety` flags and the street name. Overpass geometry SHALL NOT enter a cell that has a walking record; its activity points and industrial rings do. Every enrichment makes a new snapshot of the world (earlier snapshots keep what they had).
6. THE SYSTEM SHALL keep `data.source` `'tiles'` for a world whose graph comes from walking records (`'overpass'` once an Overpass record was added to a cell without a walking record), so a saved quest on such a map is restored as a live map, not as the demo.

### Requirement 24 (task 79): Frame performance on a phone

**User Story:** As a walker with an iPhone, I want the map to pan, zoom and follow my walker smoothly, so that the quest feels like a game and not a slideshow.

Related: requirements 12, 20 and 22 (this requirement bounds their cost), [quest](../quest/requirements.md) requirement 6f (the walker's motion), [demo-mode](../demo-mode/requirements.md) requirement D7.

Budgets are measured with the benchmark harness of `design.md` ("Frame performance"): Chrome headless, 390 × 844 at device ratio 3, CPU throttled 4×, a quest on the simulator, night 22:30 and day 12:00, at ×1 and ×20.

#### Acceptance Criteria

1. WHILE the camera pans, or the simulated walk runs with the camera following the walker, THE SYSTEM SHALL draw at least 50 frames per second on the benchmark harness, by day and by night, at ×1 and ×20.
2. WHEN the user zooms out and in over the ladder, THE SYSTEM SHALL NOT run a task longer than 200 ms from drawing the map, and the drawing tasks of the whole sequence SHALL add up to less than 1.5 s.
3. THE SYSTEM SHALL draw the map under the overlay (ground, terrain chunks, water, tracks, tint, window and lamp light) into a cached scene, and SHALL draw that scene again only when something it shows changed: map data, the zoom or the canvas size, the lighting (a new clock value, a flicker or ripple step, the sky timer), a chunk that was a stand-in, or a camera move beyond the scene's margin. A frame that only moves the walker, the pickups, the bubble or the camera inside the margin SHALL be one blit of the scene plus the overlay.
4. THE SYSTEM SHALL keep a margin of a quarter of the shorter screen side (a multiple of 32 device pixels, none if the scene would pass half of `MAX_PIXELS`) around the screen in the scene, so that panning and following need a new scene about once per 20 frames at walking speed.
5. THE SYSTEM SHALL draw nothing when nothing changed (no frame is requested at rest), and SHALL repaint flicker, firefly and ripple animations from timers of at most 4 Hz (`FLICKER_MS` 500, fireflies at 250, water at 450).
6. THE SYSTEM SHALL back the canvas at no more than `MAX_DPR` (2) device pixels per CSS pixel; the canvas is scaled up by the browser with `image-rendering: pixelated`, and every art pixel still lands on whole backing pixels at the zoom ladder's levels.
7. THE SYSTEM SHALL build a terrain chunk by copying tile pixels (read back once per atlas tile) into one image buffer and writing it with one `putImageData`, not with one `drawImage` per tile, and SHALL paint the ring of prefetch chunks one per idle frame outside any scene redraw.
8. THE SYSTEM SHALL show the walker and, in follow mode and in the demo camera, the camera at the position given by `WalkerMotion` at the time of the frame: a function of the clock, continuous at every fix, moving the walker by about speed × frame time on every frame (0.55 to 1.6 times) with fixes every 0.2 to 2.5 s, at any frame rate, and settling without a fix. A jump of more than `TELEPORT_TILES` (a reroute or a resume) SHALL place the walker instead of walking it.
9. THE SYSTEM SHALL NOT update React state per animation frame: the quest state changes once per fix and the HUD clock once per second.
10. WHEN the user opens another tab on a phone, THE SYSTEM SHALL keep the map canvas element and its size (the planner under the map keeps its room, hidden and not focusable), so that no resize, no rebuild and no stretched bitmap is shown; a resize of the map SHALL be drawn before the next paint.
11. THE SYSTEM SHALL keep every golden frame unchanged and the heap after a collection no higher than before this task, within 1 MB.

### Requirement 25 (task 80): Full detail around the hero, level of detail by distance

**User Story:** As a walker who plans a 10,000-step quest, I want every street within a walk's reach of me to be drawn in full when I zoom out, with its name, and I want to tap a street and have the finish of an A → B walk snap to it, so that I can pick a real destination instead of a point on a coarse sketch.

Related: requirements 19, 20 and 21 (the streamed world and its tiles; 21.7 is amended here), 22.3 (far-zoom lamps), 24 (performance budgets, which this requirement keeps), [routing](../routing/requirements.md) requirement 12 (A → B finish), `.kiro/steering/osm-etiquette.md`.

Terms: the **hero** is the walker in a quest, else the start point of the planner. **R** is the detail radius, 10 km by default (9 km before requirement 26) (`DEFAULT_LOD_RADIUS_M`), 2 to 15 km when set with `?lod=<km>`. A **level of detail (LOD) tile** is one z14 vector tile reduced to what the far zooms draw (streets by class, street names, simplified building footprints, parks and water).

#### Acceptance Criteria

1. THE SYSTEM SHALL choose the look of each z14 tile from its distance to the hero and the zoom, not from the zoom alone: at zoom above `FAR_ZOOM` the tile art of the streamed world (unchanged); at or below `FAR_ZOOM`, within R of the hero, the LOD look drawn from z14 data; beyond R the coarse layer (z13) as before. The distance is that of the nearest point of the tile to the hero.
2. WHILE the zoom is at or below `FAR_ZOOM` and a tile within R is loaded, THE SYSTEM SHALL draw it from its z14 data at every zoom the player can reach (0.5 and up), with streets as lines whose width and colour depend on the class (motorway to path, with a darker casing from tertiary up), building footprints simplified and filled (a building smaller than 1.5 device px is one pixel), parks and water filled, and SHALL NOT draw the coarse (z13) layer over it.
3. THE SYSTEM SHALL NOT leave a hole inside R: a tile within R that is not loaded yet SHALL be drawn as a neutral placeholder in the ground colour of the map (so the day and night tint treats it like loaded ground, not as black), without lamp dots of its own, until its bitmap is ready; a loaded tile SHALL cover its whole rectangle. Neighbouring tiles SHALL meet without a seam or a gap (shared integer device-pixel edges).
4. THE SYSTEM SHALL keep each LOD tile as an offscreen bitmap per level (256, 384, 512, 768 and 1024 px per side, the smallest level that is at least the tile's size in device px, else 1024), build it once, reuse it while the zoom changes inside a level, draw a bitmap of another level scaled while the right one is not ready, and keep the bitmaps in a least-recently-used set bounded by `LOD_BITMAP_BUDGET_BYTES` (48 MB).
5. THE SYSTEM SHALL NOT run a task of the LOD pipeline on the main thread for more than `LOD_SLICE_MS` (8 ms): a bitmap is painted in slices, and the decoding and simplification of a tile run in the tile worker. The costs of requirement 24 SHALL NOT regress: the scene is still cached and redrawn only when something it shows changed, and the budgets 24.1 and 24.2 hold with the LOD layer on.
6. THE SYSTEM SHALL label named streets with the pixel font at the zooms where their class is readable (secondary and bigger from 0.5, tertiary from 0.75, every named street from 1.5, up to below `DETAIL_ZOOM`), taking the text from the data unchanged (no translation, so any language works), horizontal on streets that run more or less east-west and turned 90° on the others, each label inside the length of its street, no two labels overlapping (a gap of 2 CSS px), the same name no closer than 160 CSS px to itself, higher classes placed first, at most `MAX_LABELS` (60) in a view. The layout depends only on the loaded data and the zoom, and SHALL be cached with the scene.
7. WHEN the user taps the map in A → B mode while placing the finish, at any zoom, THE SYSTEM SHALL snap the finish to the nearest walkable point of the nearest street within `SNAP_PX` (28 CSS px, at least 12 m, at most 250 m) of the tap, preferring a named street when one lies within 12 m of the nearest street, and SHALL tell the player the street name in the form "Finish: Calle X" ("Meta: Calle X" in Spanish) in a status line over the map; a street without a name gives "Finish: street" and a tap with no street in reach keeps the tapped point and says nothing about a street. Walkable excludes motorway, trunk, rail and busway lines and lines marked `foot=no`.
8. THE SYSTEM SHALL prefetch the z14 data of R in rings: first the tiles the view shows (nearest the view centre first), then the tiles within R in order of distance from the hero (nearest first, ties by row then column), at most `LOD_MAX_PARALLEL` (4) downloads at once in total (the limit of `VectorTileClient`, shared with the map tiles and the walking graph), at most 2 of them for the rings, at most 60 ring starts in any 60 s, and none while the view moves (`SETTLE_MS`) or the device is offline. Ring prefetch SHALL pause while the browser asks to save data (`saveData`) or reports `slow-2g` or `2g`, SHALL run one at a time and only to 5 km on `3g`, SHALL stop after `PREFETCH_MAX_TILES` (200) tiles or `PREFETCH_MAX_BYTES` (40 MB) received in a session, and SHALL pause while the page is hidden. What the view needs is always loaded, whatever these caps say.
9. THE SYSTEM SHALL cache each LOD tile in IndexedDB (`lod<codec>:z/x/y`, 7 days, at most `MAX_LOD_ENTRIES` 320) next to the full tiles, read it before any request, and rely on the browser's HTTP cache for the raw tile (the CDN allows years), so a tile that is also needed as detail art is downloaded once. A damaged entry is a miss.
10. THE SYSTEM SHALL NOT ask for z13 coarse tiles for a cell that the LOD layer covers (every z14 tile of the cell within R and none of them failed), and SHALL ask for them again for a cell with a failed LOD tile, so a failing connection still shows the coarse map. Readiness (`data-map-ready`) at far zoom SHALL count a covered cell as ready only when its LOD tiles are loaded.
11. THE SYSTEM SHALL keep every golden frame unchanged (they are at detail zoom or far zoom without a LOD layer), and the LOD layer SHALL be off under Vitest unless a test turns it on, like streaming (requirement 19).

### Requirement 26 (task 81): The far pick: the camera and the detail follow the view

**User Story:** As a walker who plans an A → B walk, I want to move the map to a street 8 to 10 km from where I stand, in the planner and during a quest, and tap it, so that I can choose a real destination across the city and not only one near me.

Related: requirement 25 (the LOD layer, whose radius and prefetch this extends), requirements 19 to 21 (the streamed frame), 24 (budgets), [routing](../routing/requirements.md) requirement 14 (the streets along the way), `.kiro/steering/osm-etiquette.md`.

Terms: the **hero** is as in requirement 25. **R_far** is `R_FAR_M`, 10 km. The **reach** is `PAN_REACH_M`, 12 km. A **focus point** is the A → B finish, or a place the view rested at beyond the hero's rings.

#### Acceptance Criteria

1. WHILE the map is a streamed world that follows the view (streaming on, not the self-playing demo), THE SYSTEM SHALL let the camera pan and zoom freely within the reach (12 km) of the hero, so that it can be R_far or more away from the hero in the planner and in a quest; the camera SHALL NOT be clamped to the streamed frame. A map that does not follow the view keeps the old limit (half a screen past the loaded area).
2. THE SYSTEM SHALL move the streamed frame to the view centre when the view has rested outside it (0.4 s), in the planner as well as with a route or a quest, keeping the data, the walking graph and the planner's start and finish; and SHALL NOT replace the map or move the start when the player only looks elsewhere. Until the frame has moved, the part of the map outside it is drawn in the ground colour (never black) and, at far zoom, in the LOD look where the LOD layer reaches.
3. THE SYSTEM SHALL draw every z14 tile within `FOCUS_RADIUS_M` (2.5 km) of a focus point in its LOD look at the far zooms, as for the hero's radius (25.1 to 25.5), keeping the finish and the two newest rested view places. A view place becomes a focus point only when it rests beyond the hero's rings (R minus half the focus radius) and no focus point lies within half the focus radius of it.
4. THE SYSTEM SHALL load the focus tiles after the tiles the view shows and before the hero's rings, nearest the focus point first, the finish first, in the same lane as the rings (at most 2 downloads at once, 4 in all, the 60 starts a minute, none before the view rests, none offline or while hidden, none on save-data or 2g), and SHALL count them against their own session cap `FOCUS_MAX_TILES` (120) instead of the ring cap of 25.8. The default detail radius R is 10 km (`DEFAULT_LOD_RADIUS_M`), so that every street the hero's rings meet reaches R_far.
5. WHEN the player taps a street within R_far of the hero in A → B mode and the LOD tiles there are loaded, THE SYSTEM SHALL snap the finish to it (25.7) at every far zoom (0.5 to `FAR_ZOOM`), and the status line SHALL say "Finish: Calle X" ("Meta: Calle X").
6. THE SYSTEM SHALL keep the cost of the far zooms where requirement 24 puts it: the LOD bitmaps are painted when the page is idle (`requestIdleCallback`, at most 150 ms late; without it, one slice every 8 ms), the scene is redrawn for finished bitmaps at most every 120 ms while a backlog is painted, a street label that cannot lie in the scene window is not laid out, the rail stamps of a line are made only for the segments near the screen (the sleepers keep their places along the line), and the voice phrases that are rendered ahead are synthesized in slices of at most 6 ms. Every golden frame SHALL stay unchanged.
7. THE SYSTEM SHALL snap the finish only to a street line that the walking graph accepts: a LOD street line carries `NO_FOOT` exactly when `isWalkable` (the rule `walkNet` uses, applied to the tags `transportationTags` gives) refuses it, so a motorway, a trunk without `foot=yes`, a busway, rail, a cycleway without `foot=yes` and any road marked `foot=no`, `use_sidepath` or private are never chosen. The point SHALL come from a walkable `transportation` line only. The name in the banner SHALL come from the `transportation_name` line that belongs to that walkable line (the same street class, within `NAME_MATCH_M` (4 m) of the snapped point), never from a name line alone, because name lines carry no access tags; a walkable line without such a name gives "Finish: street". A named line still wins over a nearer unnamed one within `NAMED_BONUS_M`. LOD tiles cached before this rule (`v` 1) are misses.
8. WHEN the player taps the finish and every z14 tile within the snap radius of the tap is loaded but no walkable street lies within that radius, THE SYSTEM SHALL keep the tapped point and say at once, in the status line, "No walkable street near there. Tap closer to a street." ("No hay ninguna calle transitable cerca. Toca más cerca de una calle."), and SHALL NOT say a street name. WHILE a tile within the radius is not loaded, the tap says nothing about a street (as before).
9. THE SYSTEM SHALL show the straight-line distance from the start in the finish status line, "Finish: Calle X · 9.2 km" ("Meta: Calle X · 9,2 km"), with one decimal in the number format of the language (`formatKmShort`), and SHALL set `data-finish-m` on that element to the whole metres of that distance (`haversine(start, finish)`, rounded). The distance follows the start when the start moves.
    - _Requirements: 26.1 to 26.9_

