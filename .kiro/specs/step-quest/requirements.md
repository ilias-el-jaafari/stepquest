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

### Requirement 7 (Phase 4): Sound

1. THE SYSTEM SHALL speak turn-by-turn and progress callouts with an original formant speech synthesizer (no third-party speech code or samples).
2. THE SYSTEM SHALL play a procedural chiptune (square, triangle, noise) whose tempo follows walking cadence.

### Requirement 8: Engineering

1. THE SYSTEM SHALL keep domain logic in pure, unit-tested TypeScript and run all tests offline.
2. THE SYSTEM SHALL keep the product name in one constant.
