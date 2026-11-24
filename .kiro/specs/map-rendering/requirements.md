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
4. THE SYSTEM SHALL draw the route as a continuous path with direction arrows, and the walker SHALL face its direction of movement with a walk animation (static when the user prefers reduced motion).
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
