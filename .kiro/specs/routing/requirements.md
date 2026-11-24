# Routing: Requirements

Part of the StepQuest specs; see [../README.md](../README.md) for the introduction, glossary and index. Requirement ids are kept from the original single spec so history stays traceable.

Related: [safety-night](../safety-night/requirements.md) (edge weights), [quest](../quest/requirements.md) (reroute trigger), [map-rendering](../map-rendering/requirements.md) (graph source data).

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

