# Requirements Document

## Introduction

StepQuest turns a step goal into an 8-bit overworld quest on real streets. The user picks a start point, a loop or an A→B walk, a step goal and a stride; the app plans a pedestrian route that matches the goal, places checkpoints along it, and draws it on a pixel-art tile map generated from OpenStreetMap. This specification covers the whole product; Phase 1 (planner and tile map) is implemented first.

## Glossary

- **Stride**: metres per step (default 0.75 m). Target distance = steps × stride.
- **Tolerance**: a route matches the goal when its length is within ±5 % of the target distance.
- **Tile**: a 16×16 pixel cell representing about 5 × 5 m.
- **Blob mask**: an 8-neighbour bitmask where diagonals only count when both adjacent cardinals match, giving 47 distinct tiles.
- **Checkpoint**: a point on the route the walker collects; checkpoint k sits at k/N of the route length, the last one being the finish.

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

### Requirement 3: Route planning

**User Story:** As a walker with a step goal, I want a route that matches my goal, so that I finish my steps exactly where I want.

#### Acceptance Criteria

1. THE SYSTEM SHALL convert steps to distance with the user's stride (default 0.75 m, clamped to 0.4–1.2 m).
2. WHEN the mode is Loop, THE SYSTEM SHALL return a route that starts and ends at the snapped start point and whose length is within ±5 % of the target.
3. WHEN the mode is A→B and the target is below the shortest path by more than 5 %, THE SYSTEM SHALL report "too short" with the minimum number of steps.
4. WHEN the mode is A→B and the target is above the shortest path, THE SYSTEM SHALL add detours to reach the target within ±5 %.
5. IF no route within tolerance fits in the loaded area, THEN THE SYSTEM SHALL report "too long" with the largest number of steps reached, or "no match" with the closest route, and show that route as a preview.
6. THE SYSTEM SHALL only route on ways a pedestrian may use (no motorways, trunk roads, private access, or cycleways not open to pedestrians) and only inside the loaded area.
7. THE SYSTEM SHALL prefer routes with little out-and-back walking, and SHALL offer another loop on request ("Another route").
8. WHEN a point is outside the loaded area or more than 150 m from any walkable way, THE SYSTEM SHALL say so instead of planning.

### Requirement 4: Checkpoints

#### Acceptance Criteria

1. THE SYSTEM SHALL place one checkpoint per about 1,000 steps by default (at least 1, at most 30).
2. THE SYSTEM SHALL space checkpoints evenly by distance along the route, with the last one at the finish.

### Requirement 5: Interface

#### Acceptance Criteria

1. THE SYSTEM SHALL let the user set the start (and, for A→B, the finish) by tapping the map, choose the mode, the step goal (typed, with presets and a slider; 100–60,000 steps) and the stride, and press one button to plan. Number fields SHALL accept free typing and SHALL only validate and clamp on blur, Enter or Plan, with an inline hint when a value is out of range.
2. THE SYSTEM SHALL show distance, estimated steps, the difference from the goal, the checkpoint count, an estimated walking time, and a feasibility message.
3. THE SYSTEM SHALL work on a 390 px wide phone and on desktop, in English and Spanish, and remember the user's settings.

### Requirement 5b: Handheld-console buttons

**User Story:** As a walker, I want every button to look and feel like a chunky handheld-console button, so that the whole app reads as one retro game and is easy to hit while walking.

#### Acceptance Criteria

1. THE SYSTEM SHALL draw every text action as a pill button and every icon action as a round button, with a thick dark outline, stepped pixel corners (no `border-radius`), a saturated fill, a light bevel on the top and left edges and a dark bevel on the bottom and right edges.
2. WHEN a button is pressed, THE SYSTEM SHALL invert its bevel and move its label or icon down 2 px, and SHALL NOT move the button box.
3. THE SYSTEM SHALL draw the icons for zoom in, zoom out, fit, home, recenter, sound on, sound off, play, pause and menu as original pixel art made of crisp SVG rectangles, and SHALL NOT use icon fonts or external images.
4. THE SYSTEM SHALL use the same button family on the planner, the map controls, the quest HUD, the Bag, Hero and Settings tabs, the sound and info menus and the dialogs.
5. THE SYSTEM SHALL keep a press area of at least 48 px on both axes for every button, an accessible name for every icon-only button, a visible `:focus-visible` outline, and a label colour with a contrast of at least 4.5:1 on its fill.
6. WHERE the user prefers reduced motion, THE SYSTEM SHALL show the pressed state without any transition.

### Requirement 6 (Phase 2): GPS and checkpoints

**User Story:** As a walker, I want the map to follow me and count my checkpoints, so that the walk plays like a game.

#### Acceptance Criteria

1. WHEN the user presses "Use my location", THE SYSTEM SHALL request one high-accuracy position, use it as the start, and load a live map area (within the Overpass limits of Requirement 1) IF the position is outside the loaded map.
2. WHILE a quest is active, THE SYSTEM SHALL ignore fixes less accurate than 50 m, fixes with stale timestamps, and jumps faster than 7 m/s (unless three consecutive fixes agree), and SHALL smooth accepted fixes.
3. WHILE a quest is active, THE SYSTEM SHALL draw the walker at the position snapped to the route (or at the filtered position when off-route) and keep the camera on the walker until the user drags the map.
4. THE SYSTEM SHALL collect checkpoints only in route order, WHEN the filtered position is within 22 m of the next checkpoint (plus half of any accuracy above 10 m, at most 35 m) OR the walker passes its position along the route while on the route.
5. WHEN a checkpoint is collected, THE SYSTEM SHALL play a pickup animation and sound, and SHALL show next checkpoint, distance, direction, collected/total, distance walked, steps walked (distance ÷ stride), elapsed time and pace. WHEN the final checkpoint (the flag) is collected, THE SYSTEM SHALL show a "Quest complete" screen with stats.
6. WHEN the walker is more than 40 m (or 1.5 × accuracy) from the route for two fixes in a row, THE SYSTEM SHALL show an off-route hint with a direction.
7. IF location permission is denied, times out, is unavailable, or the page is not secure, THEN THE SYSTEM SHALL explain it in the user's language and keep the app usable (tap-to-place, simulation).
8. THE SYSTEM SHALL save the active quest to local storage and resume it after a reload or lost signal (restoring the same map), and SHALL keep the screen on with the Screen Wake Lock API where supported.
9. THE SYSTEM SHALL offer a "Simulate walk" mode that moves the walker along the route at a chosen speed with optional GPS noise.

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

### Requirement 7 (Phase 4): Sound

**User Story:** As a walker, I want a retro voice and music while I walk, so that I can keep the phone in my hand less and the walk feels like a game.

#### Acceptance Criteria

1. THE SYSTEM SHALL speak turn-by-turn and progress callouts (start, checkpoint reached, distance to the next one, turns, off route, back on route, halfway, finish) in English and Spanish, with correct plurals, using an original formant speech synthesizer (no third-party speech code or samples).
2. THE SYSTEM SHALL play a procedural chiptune (pulse, triangle and noise channels) whose tempo follows the walking pace, changes smoothly, and pauses when the walker stops.
3. WHEN a checkpoint is collected or the quest is finished, THE SYSTEM SHALL play a sound effect.
4. THE SYSTEM SHALL offer master, music, voice and effects volumes, mute and a voice-only mode, and SHALL remember them on the device.
5. THE SYSTEM SHALL start audio only after a user gesture, SHALL keep working while the screen is kept awake, and SHALL recover audio after a system interruption on the next tap or when the page becomes visible again.
6. WHILE the voice speaks, THE SYSTEM SHALL lower the music; an urgent phrase (finish) SHALL interrupt a less important one.
7. WHEN a callout is spoken, THE SYSTEM SHALL show the same text, in the app language, in a pixel-art speech bubble next to the walker on the map, and SHALL remove it when the phrase ends, is interrupted, or sound is muted.
8. IF speech is unavailable or muted, THEN THE SYSTEM SHALL still show the bubble, for a duration based on the text length (1.8 to 7 seconds), following the same phrase queue so that bubble and voice never disagree.

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

### Requirement 7b: Routes go around roundabouts

**User Story:** As a walker, I want the route to follow the roundabout and its crossings, so that I am never sent across the central island.

#### Acceptance Criteria

1. THE SYSTEM SHALL recognise a roundabout from junction=roundabout or junction=circular ways, including rings that OSM splits into several arcs joined end to end, and from a small (20-220 m), round, closed road loop without the tag (service roads excepted).
2. THE SYSTEM SHALL NOT use any walking-graph edge that passes through the inside of a roundabout ring, whatever way it belongs to (a footway mapped over the island, a chord between two ring nodes); the ring itself stays walkable.
3. WHEN a way from Overpass has nodes without geometry (outside the query box), THE SYSTEM SHALL split the line there and SHALL NOT join the nodes on either side with a straight segment.
4. WHEN the start and the end of a leg lie on opposite sides of a roundabout, THE SYSTEM SHALL return a route that never enters the island interior.
5. THE SYSTEM SHALL keep the safety weights and the ±5 % length tolerance unchanged, and SHALL make no new Overpass request for this (the existing query already returns the junction tag).

### Requirement 7c: Fast rerouting

**User Story:** As a walker who left the planned route, I want the new route to appear quickly and the screen to stay smooth, so that I can keep walking without waiting for the app.

#### Acceptance Criteria

1. THE SYSTEM SHALL run route planning and rerouting in a Web Worker, so that the main thread only sends a request and applies the answer, and SHALL fall back to the same code running on the main thread (in a later task, not inside the fix handler) WHERE Web Workers are not available, such as in tests.
2. THE SYSTEM SHALL talk to the worker through a typed message protocol (world, plan, reroute requests; ready, plan, reroute, error answers) and SHALL build the walking graph and safety context once per loaded map, not once per request.
3. WHEN a new request of the same kind arrives before the previous one has been answered, THE SYSTEM SHALL drop the older request and its answer (latest wins), and SHALL NOT start work for a request that is already out of date.
4. WHEN the walker is off the route and still heading for the goal, THE SYSTEM SHALL first try to reconnect: a safety-weighted shortest path from the current position to a point ahead on the planned route (not behind the walker and not beyond the next gem), keeping every uncollected gem at its place and in its order.
5. THE SYSTEM SHALL accept a reconnection only WHEN the walked steps plus the new route stay within ±5 % of the step goal (remaining step budget); OTHERWISE it SHALL replan the whole remainder as before, with safety weights, the avoid list (including the street the walker left), and gems placed evenly.
6. WHEN an answer arrives for a quest that has changed route in the meantime (another reroute applied, quest ended or replaced), THE SYSTEM SHALL ignore it.
7. WHEN the walker has walked 20 m off the line (two fixes beyond 40 m or 1.5 × accuracy, and the walked distance counted by the odometer, which ignores GPS jitter) in the direction of the goal or without getting further from it, THE SYSTEM SHALL start rerouting; GPS jitter and a walk toward the next gem along a different street SHALL NOT show the "you left the route" message.
8. THE SYSTEM SHALL have a timing test on the bundled Benicalap map that reports the time of graph build, safety context, edge costs, shortest path, local reconnect, full replan and drawing the new route, and fails when a local reconnect or a full replan exceeds a generous budget.

### Requirement 8: Engineering

1. THE SYSTEM SHALL keep domain logic in pure, unit-tested TypeScript and run all tests offline.
2. THE SYSTEM SHALL keep the product name in one constant.
