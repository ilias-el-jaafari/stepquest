# Routing: Design

Part of the StepQuest specs; see [../README.md](../README.md). See also: [safety-night](../safety-night/requirements.md) (edge weights), [quest](../quest/requirements.md) (reroute trigger), [map-rendering](../map-rendering/requirements.md) (graph source data).

## Routing

## Routing

- Graph: walkable ways only, clipped to the loaded bbox; CSR adjacency; components labelled, snapping only to the largest one (≤ 150 m).
- A* with a straight-line heuristic and a per-edge cost multiplier; each leg of a multi-stop route multiplies already-used edges by 6 to avoid retracing.
- Loop: triangle start → P1 → P2 → start, P1/P2 at a size `r` along a seeded bearing with a 70–110° spread. `r` is tuned by a damped secant step (≤ 7 iterations) until length is within ±5 %; up to 8 bearings are tried.
- A→B: shortest path first (too short / direct match). Otherwise two detour shapes (one via point off the A–B line, or a two-point "bracket") on both sides and at 3 anchor positions, each tuned the same way.
- Score: within tolerance first, then least overlap. "Too long" reports the longest route found.

## Roundabouts (task 51b)

## Roundabouts (task 51b)

- `OsmWay.roundabout` is set from `junction=roundabout|circular` (codec flag 16, backwards compatible: old data decodes without it).
- `findRoundabouts` (`src/osm/roundabout.ts`) stitches tagged arcs into closed rings (every node used by exactly two segments) and adds small round untagged loops by shape. The island is the ring polygon in local metres.
- `WalkGraph` drops every non-ring edge whose interior (samples at 10-90 %, at least 0.5 m from the ring) is inside an island. Ring edges are exempt, so the ring and the crossings that meet it still route. Safety weights and the planner are untouched, so the ±5 % tolerance holds.
- `normalizeOverpass` splits line ways at nodes with null geometry (outside the box) instead of joining the neighbours, which used to create straight chords. Clipped polygons keep their old behaviour.
- The route is drawn from graph node chains only, so once no edge crosses the island no chord can be drawn through it.

## Fast rerouting (tasks 33 and 54)

## Fast rerouting (tasks 33 and 54)

- Measured first (`src/quest/rerouteBench.test.ts`, Benicalap, 21k graph nodes, 10,000-step loop, desktop Node; four deviations along the loop). Before: a full replan took a median 40 ms and up to 200 ms (the planner's size tuning ran 19 to 38 A* legs; each fallback also rebuilt the edge costs, 6 to 11 ms), all inside the GPS fix handler. One A* leg costs 0.1 ms, nearest node 0.1 ms, track and route cells for drawing 0.6 ms, gem placement under 0.1 ms. Graph build (about 150 ms) and safety context (about 220 ms) happen once per map. So the time goes to the planner's tuning iterations, not to the graph, the gems or drawing; on a phone several times slower, which is the stutter. After: a local reconnect takes a median 4.5 ms (2 A* legs) and at most about 35 ms when it has to fall back to the full replan, and none of it runs on the main thread.
- Worker: `src/routing/planService.ts` (pure, synchronous: holds `{ data, graph, ctx }` per world id and answers `plan` and `reroute` messages), `planner.worker.ts` (wires `onmessage` to the service) and `planClient.ts` (main-thread side). The client registers a world once (`world` message; the worker builds `WalkGraph` and `safetyContext` itself), then sends small requests. The protocol is in `planProtocol.ts`: requests `world | plan | reroute | drop`, answers `ready | plan | reroute | error`, all structured-clone safe.
- Latest wins: one request is in flight at a time (a worker is single-threaded and cannot be interrupted); the client keeps at most one waiting request per kind and replaces it when a newer one arrives, so older requests are never started. An answer for a request that was replaced resolves as `stale` and is ignored. Without `Worker` (tests, old browsers) the same `PlanService` runs on the main thread through an inline backend that answers in a later task and reuses the already built graph.
- Reroute in two steps (`quest/reroute.ts`, `planReroute`): 1) local reconnect: snap the walker to the planned route, take up to three rejoin vertices ahead of the walker and not beyond the next gem (one offset away, two offsets away, the gem), run one safety-weighted A* from the walker to each (edge costs cached per safety options, avoid list included), and keep the candidate whose new total lies within ±5 % of the remaining step budget and closest to it; the route after the rejoin vertex and every uncollected gem stay (gem distances are shifted so the distance to the finish is unchanged); 2) otherwise the previous full replan with `planWithSafety` (even gems, left street avoided). The result is a `ReroutePatch` (plain data with the quest id and the reroute count it was computed from); `applyReroute` merges it into the current state and refuses a patch whose base no longer matches. `rerouteQuest` stays as the synchronous wrapper.
- `edgeCosts` keeps its last result per safety context (same options, same array), because every fallback in `planWithSafety` rebuilt it.
- Runner: `useQuestRunner` takes `requestReroute(state) => Promise<ReroutePatch | undefined>`; the `reroute` event no longer blocks the fix handler. The last request wins and a late patch is applied only if it still matches the quest.
- Debounce: still two consecutive fixes beyond max(40 m, 1.5 × accuracy) to be off the line, then the odometer-based verdict. The walked distance needed to decide dropped from 30 m to 20 m (`decideM`), about 10 s sooner at walking pace; jitter does not move the odometer, and "toward the goal" still means within 90° of it or not further than when leaving, so a walk toward the next gem along another street only reroutes quietly.

## Error handling: planner failures

- Planner failures return a reason plus min/max steps and the closest route for preview; the UI offers a one-tap "Use N steps".

## Correctness properties (task 56)

Checked with fast-check (`*.property.test.ts`, fixed seed `20261204`, so a failure prints the counterexample and reruns the same way) on the bundled Benicalap map. Requirement ids refer to `requirements.md` in this folder.

- **P-R1 Budget or infeasible.** For every request (mode, start, end, step goal 1,500–14,000, stride 0.5–1.0 m, seed), `planRoute` returns either a route whose real length differs from `steps × stride` by at most 5 %, or `ok: false` with a reason (and, for `tooShort`, a positive `minSteps`; a `closest` preview is never flagged as within tolerance). Validates 3.2, 3.3, 3.4, 3.5.
- **P-R2 Chain of edges.** `route.nodes` are consecutive neighbours in the walking graph; a loop starts and ends at the same node; `distanceM` equals the sum of the real edge lengths and the haversine length of `points`. Validates 3.2, 3.6.
- **P-R3 Gems in order and evenly spaced.** Checkpoint k of N sits at k/N of the route length (within 1e-6), strictly increasing, on the polyline at its stated distance, the last one at the finish; N is between 1 and 30. Holds for any polyline (`placeCheckpoints`) and for every planned route. Validates 4.1, 4.2.
- **P-R4 Weights never change real length.** For any combination of safe, night and avoided streets, and for any positive per-edge weights given to `shortestPath`, the reported length is the sum of real edge lengths, steps follow from that length, and edge costs stay within `[MIN_FACTOR, MAX_FACTOR]`. Validates 3.1, 7b.5.
- **P-RA1 Island never crossed, ring stays connected.** For random roundabouts (8–40 ring nodes, radius 8–60 m, 0–8 cut points, reversed arcs, 1–6 entry roads, an optional footway across the island with or without a centre node), no graph edge has a sample point more than 0.5 m inside the island (checked with an independent disc test), every ring edge is in the graph, and the ring and all entry roads are one connected component. Validates 7b.2, 7b.4.
- **P-RA2 Detection ignores the split.** For the same ring cut into ways at different places (and with arcs reversed), `findRoundabouts` returns one roundabout with the same node set and island area, and the walking graph has the same size. A single round untagged ring of 20–220 m is detected. Validates 7b.1.
- **P-RR1 Gem order kept.** For a walker at a random place along a planned loop and a random off-route position 25–120 m away, any patch from `planReroute` keeps the gem count and indices, leaves collected gems untouched and gives the uncollected ones strictly increasing distances ending at the finish; a local patch leaves each uncollected gem where it was. Validates 7c.4.
- **P-RR2 Never behind the walker, never past the next gem.** A local patch is a short leg plus the old route from a vertex that lies between the walker's position along the route and the next gem; it starts within the snap distance of the walker and ends at the old finish. Validates 7c.4.
- **P-RR3 Budget or full replan.** Any patch leaves the remaining steps within ±5 % (+1 step) of the steps left; with `local: false` the kind is `full` and its gems are evenly spaced; with fewer than 150 steps left no patch is made. The test fails if it never exercises both kinds. Validates 7c.5.
