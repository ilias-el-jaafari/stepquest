# Routing: Requirements

Part of the StepQuest specs; see [../README.md](../README.md) for the introduction, glossary and index. Requirement ids are kept from the original single spec so history stays traceable.

Related: [safety-night](../safety-night/requirements.md) (edge weights), [quest](../quest/requirements.md) (reroute trigger), [map-rendering](../map-rendering/requirements.md) (graph source data; the graph grows with streamed cells, requirement 19.11).

## Requirements

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
9. WHEN the mode is Loop and every loop the planner builds is more than 5 % longer than the target (the target is below the smallest loop that fits), THE SYSTEM SHALL report "too short" with the step count of the shortest loop built as `minSteps`, the same way A→B does, instead of "no match". A loop of exactly `minSteps` steps SHALL then be plannable.
10. THE SYSTEM SHALL attach both `minSteps` (shortest loop built) and `maxSteps` (longest loop built), plus the closest loop as a preview, to every infeasible Loop result that had at least one attempt ("too short", "too long" and "no match"), so a failed Loop plan never leaves the walker without a next number to try.

### Requirement 4: Checkpoints

#### Acceptance Criteria

1. THE SYSTEM SHALL place one checkpoint per about 1,000 steps by default (at least 1, at most 30).
2. THE SYSTEM SHALL space checkpoints evenly by distance along the route, with the last one at the finish.

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

### Requirement 8: Graph correctness on real-world data shapes

**User Story:** As a walker anywhere OpenStreetMap data is imperfect or unusual, I want the planner to still produce a legal, walkable route or a clear failure, so that the app never silently proposes a route I cannot walk.

#### Acceptance Criteria

1. THE SYSTEM SHALL snap a start or end point only to the main (largest) connected component of the walking graph, never to a disconnected island, and SHALL report "unreachable" WHEN that component is farther than `MAX_SNAP_M` from the point, so a quest is never planned on an island the walker cannot leave.
2. WHEN streets are closed to a plan (cost `Infinity`, for example the avoid list) so that the finish cannot be reached, THE SYSTEM SHALL report "unreachable" for A→B, and for a Loop whose start is walled in SHALL still answer with a non-success result, in bounded time, never a route through a closed street.
3. THE SYSTEM SHALL exclude any way from the walking graph where `access` is `no` or `private`, or `foot` is `no`, `use_sidepath` or `private`, consistently between the initial plan, a reroute, and a rejoin point search, so a rerouted walker is never sent onto a way the initial plan correctly avoided.
4. WHERE a closed walkable pedestrian area (`highway=pedestrian` or `footway` with `area=yes`, so `kind` is `path`, `area` is true and the way is entirely inside the loaded box) exists, THE SYSTEM SHALL add walkable chords between its ring vertices that stay inside the polygon (never across a concave notch, never across a roundabout island), so a route can cross the plaza instead of following only its boundary. `place=square` without a walkable `highway` tag is not walkable today and is out of scope (open question in `design.md`).
5. THE SYSTEM SHALL keep plaza chords bounded (at most `MAX_PLAZA_NODES` ring vertices considered per plaza) and SHALL never remove an edge that existed before, so the change can only shorten routes.
6. THE SYSTEM SHALL reject a target step count that is not finite, below `MIN_STEPS` or above `MAX_STEPS` (`src/geo/steps.ts`) before any snapping or search, with the reason `outOfRange` carrying those bounds as `minSteps`/`maxSteps`, and the UI SHALL name the allowed range in both languages.
7. WHILE the walking graph for a loaded area has zero nodes or zero edges (no walkable way in the area), THE SYSTEM SHALL report "unreachable" for every plan request against that area instead of raising an error.
8. THE SYSTEM SHALL document that `oneway`, `oneway:foot`, `foot:forward` and `foot:backward` are not read and that the walking graph is undirected by design (foot traffic is normally exempt from vehicle one-ways). Directed pedestrian edges are out of scope until a concrete mis-route is reported.
9. THE SYSTEM SHALL treat `highway=steps` as walkable (stairs are legal for pedestrians; step-free routing is out of scope), and SHALL keep `access=no|private` and `foot=no|use_sidepath|private` ways out of the graph unless `foot` is `yes|designated|permissive|official`.

### Requirement 9: Crossings stay routable

**User Story:** As a walker crossing a road, I want the route near a marked crossing to be treated consistently with the safety model, so that marked crossings are never lost from the walking graph and the safety weights stay predictable.

#### Acceptance Criteria

1. THE SYSTEM SHALL keep every walkable way flagged `crossing` as edges of the walking graph, joined to the streets it crosses through shared nodes, so a marked crossing is routable. Safety and night weights SHALL NOT depend on the flag (product decision, Nov 2026); a possible "prefer marked crossings" weight is recorded as an open proposal in `design.md` and is not implemented.

### Requirement 10: Initial-plan search performance

**User Story:** As a walker pressing "plan a route" on a newly loaded live area, I want the first route to appear without a noticeable stall, so that planning a new quest feels as responsive as rerouting already does.

#### Acceptance Criteria

1. THE SYSTEM SHALL have a timing test (`planBench.test.ts`), alongside the existing reroute timing test, that measures a warm initial Loop plan and A→B plan on the bundled Benicalap map, counts the nearest-node and A* calls a plan makes, and fails when either exceeds a generous budget.
2. THE SYSTEM SHALL run A* without allocating per-search arrays (working memory reused across searches), because A* legs, not nearest-node lookups or cost-array copies, dominate a plan's time (see `design.md`, measured).

### Requirement 11 (task 69): Distance and projection maths

**User Story:** As a walker, I want route lengths and map positions to be computed the same way everywhere, so that a 7.5 km route is 7.5 km on every screen and map box.

#### Acceptance Criteria

1. THE SYSTEM SHALL use one value for metres per degree of latitude in the projection and in `bboxAround`, so a box of radius r contains the circle of r metres around its centre.
2. THE SYSTEM SHALL keep longitudes inside [-180, 180] when computing a destination, and SHALL take the short way across the antimeridian when projecting.
3. WHEN a point or a box is at or near a pole, THE SYSTEM SHALL return finite coordinates inside the valid ranges (boxes are clamped, never wrapped).
4. THE SYSTEM SHALL project a point and back to within 1 mm for walk-sized offsets, and the projected distance SHALL be within 0.5 % of the great-circle distance up to 4 km at latitudes up to 60°.

### Requirement 12 (task 78): Planning always answers

**User Story:** As a walker who presses "Plan quest" anywhere (here, in the middle of València, or a few kilometres from the bundled demo), I want the button to react at once and to end with a route or with a clear message and a way to try again, so that the app never looks frozen.

Related: [quest](../quest/requirements.md) requirement 6e (locating), [map-rendering](../map-rendering/requirements.md) requirement 23 (where the streets come from), `.kiro/steering/copy-voice.md`.

#### Acceptance Criteria

1. WHEN the player presses the plan button, THE SYSTEM SHALL show the busy state (button "Planning…", disabled, `aria-busy`) in the same render, before any street data is read or any request is sent.
2. WHILE the walking graph of the area the walk needs is not on the device, THE SYSTEM SHALL name the step under the button ("Loading streets…" with the number of map pieces in: "3 of 9"), and SHALL show "Planning…" only for the search itself.
3. WHEN planning cannot start (the map is not ready, or A → B has no finish yet), THE SYSTEM SHALL say why in a visible message next to the button; a press SHALL never end without a change on screen.
4. IF loading the streets fails, takes longer than 40 s, or the planner worker breaks, THEN THE SYSTEM SHALL end the busy state and show an in-game message with a "Retry" button, in English and Spanish, in the voice of `copy-voice.md` (no mention of servers, tiles, graphs or caches). The Retry button SHALL run the same plan again.
5. WHEN a plan has no route (outside the map, no street within 150 m, goal too short or too long, no match), THE SYSTEM SHALL show the reason on the Map tab, under the planner, as well as in the quest log; a "Use N steps" button SHALL be offered where the reason has a nearest feasible number.
6. THE SYSTEM SHALL keep the mode chips, the placing chips ("Start" / "Finish") and the step presets inside the planner box at 320 px and up (they wrap onto a second line, nothing is cut off), and the "A → B" label SHALL stay on one line.
7. WHEN the player switches to A → B, THE SYSTEM SHALL make the next map tap set the finish, and a finish that no walk of the goal's length could reach from the start SHALL be forgotten when the start moves (the planner never keeps a finish from another place).

### Requirement 13 (task 78): The walking graph comes from the vector tiles

**User Story:** As a walker, I want routes to appear wherever the map is drawn, without waiting for a public map server that is often overloaded, so that planning works the first time.

Related: [map-rendering](../map-rendering/requirements.md) requirement 23, [safety-night](../safety-night/requirements.md) (weights unchanged), design.md "Walking graph from tiles (task 78)" for the measurements.

#### Acceptance Criteria

1. THE SYSTEM SHALL build the walking graph of a live area from the z14 `transportation` layer of OpenFreeMap tiles: only ways that `isWalkable` accepts, with vertices snapped to a 1e-6° grid so that equal points are one node, with the pieces of a street cut at a tile edge joined into one way when exactly two ends of the same kind of way meet, and with every dead end within 3 m of another walkable way (not a bridge or a tunnel) connected to it (the way is split at the meeting point).
2. THE SYSTEM SHALL pass a connectivity test on real València tiles kept as a fixture (`src/vector/__fixtures__`): at least 95 % of the graph's length in the main component, and a loop and an A → B walk across a tile seam planned within ±5 %.
3. THE SYSTEM SHALL keep the safety and night weights as they are: a way from tiles has no `safety` flags until enrichment, which is the same as an Overpass way without `lit`, `sidewalk` or `service` tags.
4. THE SYSTEM SHALL use Overpass only to enrich that graph (requirement 23.5), never to decide whether planning can start.
5. THE SYSTEM SHALL plan on the graph of the cells that cover the walk (`areaForWalk` for a loop, the start-to-finish box for A → B); cells already in the graph (the bundled extract included) are not loaded again.

### Requirement 14 (task 82): An A → B walk across the city

**User Story:** As a walker who taps a street 8 to 10 km away as the finish and presses "Plan quest", I want the app to load the streets along the way and plan across them, so that a far finish is as plannable as a near one.

Related: requirements 12 and 13 (the answer, the walking graph from tiles), [map-rendering](../map-rendering/requirements.md) requirement 26 (the far pick), [safety-night](../safety-night/requirements.md) (weights unchanged), `.kiro/steering/osm-etiquette.md`.

#### Acceptance Criteria

1. WHEN the straight distance from start to finish is more than `CORRIDOR_FROM_M` (4 km), THE SYSTEM SHALL load the walking graph of the cells along the straight line between them (the corridor: every cell within half the corridor width of the line, 1 km, up to 2 km for a goal much longer than the direct way) instead of the box of `areaForWalk`, whose 36 km² cap cannot hold such a walk; a walk of 4 km or less keeps `areaForWalk`.
2. THE SYSTEM SHALL load only the cells of the corridor that are not in the graph yet, from the z14 tiles that meet them (cache first, at most 4 at once, two retries, as in 13.1 and `osm-etiquette.md`), into the world on screen, wherever its frame is; the walking records of cells outside the frame are kept (they are never painted) and are not dropped when the frame moves.
3. THE SYSTEM SHALL give the load of a corridor 40 s plus 1.5 s for every tile above 16, show the progress "Loading streets… n of m" and, on failure or timeout, the Retry message of 12.4; the load starts when the finish is tapped (the prefetch of 12.2), so the plan button usually finds the streets.
4. THE SYSTEM SHALL plan on that graph exactly as before (same A* weights, same ±5 % search, same infeasible answer with the nearest feasible number of steps), and SHALL keep the safety and night weights unchanged: a way from tiles has no safety flags until enrichment, which uses Overpass cells near the loaded cells only.
    - _Requirements: 14.1 to 14.4_

