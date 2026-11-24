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
