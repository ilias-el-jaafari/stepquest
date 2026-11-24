# Routing: Design

Part of the StepQuest specs; see [../README.md](../README.md). See also: [safety-night](../safety-night/requirements.md) (edge weights), [quest](../quest/requirements.md) (reroute trigger), [map-rendering](../map-rendering/requirements.md) (graph source data).

## Routing

- Graph: walkable ways only, clipped to the loaded bbox; CSR adjacency; components labelled, snapping only to the largest one (≤ 150 m).
- A* with a straight-line heuristic and a per-edge cost multiplier; each leg of a multi-stop route multiplies already-used edges by 6 to avoid retracing.
- Loop: triangle start → P1 → P2 → start, P1/P2 at a size `r` along a seeded bearing with a 70–110° spread. `r` is tuned by a damped secant step (≤ 7 iterations) until length is within ±5 %; up to 8 bearings are tried.
- A→B: shortest path first (too short / direct match). Otherwise two detour shapes (one via point off the A–B line, or a two-point "bracket") on both sides and at 3 anchor positions, each tuned the same way.
- Score: within tolerance first, then least overlap. "Too long" reports the longest route found.

## Roundabouts (task 51b)

- `OsmWay.roundabout` is set from `junction=roundabout|circular` (codec flag 16, backwards compatible: old data decodes without it).
- `findRoundabouts` (`src/osm/roundabout.ts`) stitches tagged arcs into closed rings (every node used by exactly two segments) and adds small round untagged loops by shape. The island is the ring polygon in local metres.
- `WalkGraph` drops every non-ring edge whose interior (samples at 10-90 %, at least 0.5 m from the ring) is inside an island. Ring edges are exempt, so the ring and the crossings that meet it still route. Safety weights and the planner are untouched, so the ±5 % tolerance holds.
- `normalizeOverpass` splits line ways at nodes with null geometry (outside the box) instead of joining the neighbours, which used to create straight chords. Clipped polygons keep their old behaviour.
- The route is drawn from graph node chains only, so once no edge crosses the island no chord can be drawn through it.

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

## Architecture review (Nov 2026)

Read of `src/routing/**` (graph, A*, planners, safety, roundabout, worker, plan service), `src/quest/reroute*.ts`, this spec and `.kiro/steering/routing.md`. Covers requirements 8, 9 and 10.

### Current structure

- `WalkGraph` (`graph.ts`): builds an undirected CSR graph from every walkable way inside the bbox, drops roundabout-island chords, labels connected components, and exposes `nearestNode` (brute-force linear scan) and `shortestPath` (A*).
- `planner.ts`: `planLoop` and `planOneWay` each call `tune()`, a damped-secant search that calls `routeVia` → `graph.shortestPath` once per leg, per candidate size, per bearing/anchor. `routeVia` copies the full edge-cost array (`Float32Array.from(req.cost)`) on every call so later legs can penalise reused edges.
- `safety.ts`: pure per-edge cost factors, plus a single-slot `WeakMap` cache (`costCache`) keyed by a stringified options tuple, one slot per `SafetyContext`.
- `safePlanner.ts`: tries safe+avoid, then safe without avoid, then unweighted, as three independent calls into `plan()`, each of which calls `edgeCosts` with different options.
- `reroute.ts`: `reconnect()` (local rejoin search) and the `planWithSafety` full-replan fallback, each with their own length computation (`cumulativeDistances` on points vs. `joined.length` from edges).
- `roundabout.ts`: ring stitching and an inside-polygon sampler used only at graph-build time.
- Worker boundary: `planService.ts` holds the per-world graph/context and answers `plan`/`reroute` requests identically whether called from `planner.worker.ts` or `inlineBackend()`.

### Problems found

1. **No interior routing on closed pedestrian plazas/squares.** The walking graph only has edges along a plaza's boundary ring (the way's node sequence), never across its interior, even though `isArea`/`wayStyle` mark it walkable and drawable as an open plaza. A route that should cut across a square instead detours around its perimeter, and two points on opposite sides of the same small plaza can snap to the same boundary node, surfacing a confusing `samePoint` result instead of a real route. (Requirement 8.4, 8.5)
2. **Loop mode has no "too short" reason.** `planOneWay` reports `tooShort` with `minSteps` when the target is below the direct path; `planLoop` has no equivalent lower bound and falls through to `noMatch` for a target too small for the smallest triangle it tries, leaving the walker without a next number to ask for. (Requirement 3.9)
3. **`maxSteps` is only populated on one of two paths that can produce it.** `planLoop` sets `maxSteps` only `if (best.error < 0)`; a `noMatch` result that failed to converge for other reasons (not genuinely because the area is too small) carries no hint at all, even though the user-facing need — "tell me the nearest feasible number" — is the same in both cases. (Requirement 3.10)
4. **Access and foot restrictions are correct at graph-build time but not re-verified at the API boundary that matters for rerouting.** `isWalkable` (classify.ts) already excludes `access=no|private` and `foot=no|use_sidepath|private` from `WalkGraph`, so in practice a reroute cannot route onto an excluded way — the graph itself never contains the edge. The risk is not a current bug but an invariant that depends on every caller (plan, reroute, rejoin search) sharing one `WalkGraph` built once from `isWalkable`; nothing currently enforces that two different graphs (e.g. built from stale cached data vs. a fresh one) can't disagree. (Requirement 8.3)
5. **No pedestrian-direction restriction handling.** `isWalkable` never reads `oneway`, `oneway:foot`, `foot:forward` or `foot:backward`; the graph is fully undirected. This matches the common case (foot traffic is usually exempt from vehicle one-ways) but is an undocumented, silent gap for the less common tagged-pedestrian-direction case. (Requirement 8.8)
6. **The `crossing` flag on `OsmWay` is written and never read.** `normalize.ts` computes `crossing: kind === 'path' && isCrossing(tags)` for every way, but neither `WalkGraph` nor `safety.ts` consult it; `safetyFactor` has no crossing-specific term despite the steering doc listing crossings as a recognised tag category. Dead wiring: a reader of the code reasonably expects crossings to affect something. (Requirement 9.1)
7. **No defensive range check on `targetSteps`.** Both planners hand an arbitrary `targetSteps` straight to `tune()`; a value below `MIN_STEPS` (100) or above `MAX_STEPS` (60,000) runs the full search anyway and returns whatever `noMatch`/`tooLong` result falls out, rather than a fast, explicit range error. The UI happens to clamp its own input, but the planner API offers no equivalent guarantee to a worker message or a script. (Requirement 8.6)
8. **Empty or ways-only-excluded graphs are not special-cased.** `WalkGraph` with `size === 0` works today (`nearestNode` returns `undefined`, every plan reports `unreachable`), which is already correct behaviour — but it is accidental rather than tested or documented, so a future change to `nearestNode` could silently break it. (Requirement 8.7, verification only — no behaviour change needed, add a regression test.)
9. **Initial-plan performance is unmeasured.** `rerouteBench.test.ts` times the reroute path only. The initial `planLoop`/`planOneWay` tuning search was not timed. The review guessed that repeated `nearestNode` scans and the per-call `Float32Array.from(req.cost)` copy were the hot spots; **measurement disproved this** (see "Measured results"): a plan makes 21 to 38 `nearestNode` calls at ~0.1 ms each and the cost copy is microseconds, while it runs 30 to 62 A* legs and each leg allocated three typed arrays of graph size. (Requirement 10.1, 10.2)
10. **Three independent length computations for "the same" quantity.** `finish()` (planner.ts) sums real edge lengths from the graph; `reconnect()` (reroute.ts) takes `cumulativeDistances(points).at(-1)` from haversine distances between points. These should agree (edge lengths are built from haversine in `WalkGraph`, and `edgeLength`'s fallback is haversine too), but nothing asserts it for a reconnect patch the way property P-R2 asserts it for a fresh plan. Gap in property coverage, not a known-wrong value today.
11. **Five different "how close counts as close enough" constants with no cross-reference.** `MAX_SNAP_M` (150 m, planner), the `snapToRoute` window (60 m behind / 400 m ahead, snap.ts), `offRouteM` (40 m), `decideM` (20 m) and `retryM` (80 m) in quest.ts, and `JOIN_SNAP_M` (8 m, reroute.ts) all answer a version of "is this near enough". Documentation gap, not a bug; now one comment block next to `MAX_SNAP_M` lists them in order. (Corrects the first draft, which named `offRouteThreshold`, a name that does not exist.)
12. **No found instances of unbounded loops.** `tune()` (7 iterations), the bearing/anchor loops (8 / 3×2×2, all `for`/`for...of` over fixed arrays), `stitchRings`'s ring walk (bounded by `comp.length`), and A* (bounded by `closed` marking, a CSR graph with finite nodes) all terminate by construction. Verified, no action needed.

### Target design

- **Plaza interior routing (problem 1):** at graph-build time, for each walkable closed `path` way with `area: true` fully inside the loaded box, add the chords between ring vertices that lie inside the polygon (`plazaChords.ts`: no proper crossing of a ring edge, sampled interior points inside by the even-odd test from `osm/roundabout.ts`, thinned to 60 vertices, never across a roundabout island). A visibility graph of the ring was chosen over a centroid node (no synthetic nodes, concave plazas stay correct) and over a triangulation (shortest paths follow real geometry). Cost on Benicalap: +1,555 edges (25,336 to 26,891), graph build about +25 ms once per map.
- **Loop "too short" (problem 2):** before running `tune()`'s bearing search, compute the length of the smallest triangle the loop planner is willing to build (its floor size, already computed as the `size` clamp of `Math.max(20, ...)` inside `tune`), convert it to steps, and short-circuit to `{ ok: false, reason: 'tooShort', minSteps }` when the target is below that floor, mirroring `planOneWay`'s direct-path check.
- **`maxSteps` on every infeasible path (problem 3):** always track the single best (`longest`) route and its steps across all attempts in `planLoop`, the same way `planOneWay` already does with its local `longest`/`track` helper, and populate `maxSteps` from it whenever `ok: false`, regardless of which reason was chosen.
- **Shared exclusion invariant (problem 4):** no code change required; add a property/regression test that builds two `WalkGraph`s from the same `OsmData` and asserts their edge sets are identical, and a test that asserts no edge in the graph ever belongs to a way with `access=no|private` or `foot=no|use_sidepath|private`, to make the invariant explicit and guarded going forward.
- **Pedestrian-direction tags (problem 5):** out of scope for this review as a behaviour change (no directed-graph support is planned); document the gap plainly in requirements 8.8 and leave `WalkGraph` undirected. Revisit only if a concrete report of a mis-routed gated path appears.
- **Crossing flag (problem 6), decided by the product owner:** do not change `safetyFactor` or any safety/night weight. Keep marked crossings in the graph and cover that with tests; record "prefer marked crossings" as an open proposal (below).
- **Step-count range check (problem 7):** add a guard at the top of `planRoute` (shared by both modes) that returns a new `InfeasibleReason` value, `outOfRange`, with `minSteps: MIN_STEPS, maxSteps: MAX_STEPS`, before any snapping or tuning happens. Implemented inside both `planLoop` and `planOneWay` (so direct callers are guarded too); `planRoute` dispatches to them. The UI shows `error.outOfRange` in English and Spanish.
- **Empty-graph regression test (problem 8):** add a fixture test building a `WalkGraph` from an `OsmData` with zero walkable ways and asserting `planRoute` returns `unreachable` for both modes; no production code change.
- **Initial-plan timing (problem 9):** add `src/routing/planBench.test.ts` alongside `rerouteBench.test.ts`, timing a cold `planLoop` and `planOneWay` call on the Benicalap fixture, reporting the same kind of breakdown (nearest-node time, edge-cost-copy time, A* time) so a future optimisation has a baseline. Then address the two measured hot spots: cache `graph.nearestNode`'s projected `x`/`y` lookups are already array reads (no change needed there), but move the per-leg `Float32Array.from(req.cost)` copy in `routeVia` to a single copy per `tune()` call (one copy per planned route attempt, not one per leg per iteration), since the reuse penalty only needs to accumulate across legs of the *same* attempt, not be recreated from scratch each time either. Superseded because `routeVia` already copies once per call and the copy costs microseconds.) Final: A* working memory is allocated once per graph and reused with generation stamps; `Math.hypot` became `Math.sqrt`.
- **Length computation property (problem 10):** extend property P-R2 (or add P-RR4) to also check a local reconnect patch's `route.distanceM` against the sum of its own edge lengths plus the kept tail's haversine length, closing the coverage gap without changing behaviour.
- **Constant cross-references (problem 11):** add one comment block (in `planner.ts`, where `MAX_SNAP_M` is already defined) listing all five distance constants and the relative ordering they depend on, so a future change has one place to check; no behaviour change.

### Rationale

Every behaviour change above is additive or corrects a reporting gap (loop "too short", `maxSteps` on all paths, plaza interior routing, crossing weighting, range check): none changes the ±5 % tolerance semantics, the safety/night factor formulas, gem spacing, or the shape of a `ReroutePatch`. The plaza fix is the only one that changes the graph's edge set, and only adds edges inside polygons that were already walkable and already drawn open — it cannot make a previously valid route invalid, only shorten some. The initial-plan performance fix changes allocation patterns only, not search behaviour, so existing fixture tests (routing.test.ts, routing.property.test.ts) are expected to keep passing unchanged and serve as the regression guard.

### Loop reasons (decision)

A loop is `tooLong` when its best attempt is shorter than the goal (unchanged), `tooShort` when every attempt built is more than 5 % longer than the goal, otherwise `noMatch`. Before this review the second case was reported as `noMatch` and carried no hint. User-visible change: a goal below the smallest loop (about 150 steps on Benicalap) now shows "Too short for a loop here: the smallest loop is about N steps" (`error.tooShortLoop`) instead of the generic no-match text. Loop results now always carry `minSteps` and `maxSteps`.

### Behaviour changes made in this pass (all documented here on purpose)

1. Loop `tooShort` and `minSteps`/`maxSteps` on every infeasible loop (61.1, 61.2).
2. `outOfRange` for goals outside 100 to 60,000 steps, NaN and Infinity (61.3). Before, an A→B goal of 50 steps said `tooShort` with the direct distance; it now says to pick a goal between 100 and 60,000. The UI already clamps its input, so users only meet this through scripts or worker messages.
3. Plaza chords (61.7): walkable closed `path` areas get inner chords. Edges are only added, never removed. On Benicalap 13 walkable areas get chords and plans still meet their goals.
4. Nothing else about route choice changed: safety/night weights, the ±5 % window, gem spacing, `ReroutePatch` and reroute thresholds are untouched.

### Refactor (module boundaries)

`planner.ts` was one 320-line file. It is now the public facade (`planRoute`, `planLoop`, `planOneWay`, `bearingBetween`, `MAX_SNAP_M`, types re-exported) over: `planTypes.ts` (request/response types), `routeBuild.ts` (join legs, reuse penalty, overlap, scoring, `finish`), `tune.ts` (size search, `Attempts` shortest/longest tracker, seeded hash), `graph.ts` (CSR graph, A*), `plazaChords.ts` (pure geometry). `joinLegs` no longer spreads long arrays into `push`.

### Measured results (planBench, warm medians, Benicalap fixture, ms)

| | before | after |
|---|---|---|
| A* one leg (start to end) | 0.70 to 0.99 | 0.50 |
| Loop 10k | 20 to 25 | 15 |
| Loop 10k, safe weights | 32 to 42 | 25 |
| A to B 10k | 31 to 34 | 22 |
| A to B 10k, safe weights | 66 to 70 | 50 to 52 |

A plan makes 21 (loop) to 38 (A to B) `nearestNode` calls (about 0.1 ms each) and 30 to 62 A* legs. `after` includes the larger graph from plaza chords.

### Open question for the product owner: prefer marked crossings

Not implemented. Idea: lower the cost of a way flagged `crossing` slightly (or add a small penalty to unmarked roads crossed by a path) so routes cross at zebra crossings. The flag is already parsed (`OsmWay.crossing`, 522 walkable crossing ways on Benicalap) and kept in the graph. A change would go in `safetyFactor`/`EdgeInfo` next to the `SAFETY_*` flags with a factor between `MIN_FACTOR` and `MAX_FACTOR`. Risks: it shifts every safe route (tests in `safety.test.ts` and fixture plans would need re-baselining), and a marked crossing is not always safer (busy avenues). Needs a decision: yes or no, and the size of the bonus. Until then `planner.review.test.ts` asserts that the flag does not change costs.

### Open question: `place=square`

Squares tagged only `place=square` (21 on Benicalap, no `highway`) are drawn as plazas but are not walkable, so routes go around them. Making them walkable would add edges and chords across many open squares. It was not changed because it alters the graph far more than the review's scope. Needs a decision.

## Geodesy review (Nov 2026)

Scope: `src/geo/geo.ts` (the coordinate helpers live here; there is no `coords.ts`). Requirement 11, tasks 69.13 and 69.14.

| Id | Finding | Fix |
| --- | --- | --- |
| B10 | `destination` returned a longitude up to 180.009 after crossing the antimeridian. | `wrapLon`. |
| B11 | `bboxAround` used 111 320 m per degree, the projection 111 195 m, so a box was 0.11 % too small for its radius (1 m per km). | Both use `M_PER_DEG_LAT`; boxes grow by 0.11 %. |
| B12 | Near a pole `cos(lat)` goes to 0: `bboxAround` returned infinite longitudes and latitudes above 90. | `cos` floored at 1e-6, latitudes and longitudes clamped. |
| B13 | `LocalProjection` with a pole origin divided by zero in `toLatLon`; across the antimeridian `toXY` returned a point 40 000 km away. | Same floor; longitude difference wrapped. |

Checked and correct: haversine is clamped before `asin`; projection round trip is within 1 mm; distance error is under 0.5 % up to 4 km at latitudes up to 60° (property tests). Not changed: the projection is equirectangular, so error grows with latitude and with distance from the origin; a walk area of a few kilometres at the latitudes of the product is far inside the bound.

Tests: `geo/review.test.ts`.


## Streamed world (map-rendering requirement 19)

The walking graph can grow: `GraphAccumulator` (in `graph.ts`) holds the node map and the edge list, and `new WalkGraph(data)` is `add(data)` plus the CSR build. A streamed world adds the ways of new cells only and retries the edges that were outside the loaded cells before; "inside" is `OsmData.coverage` (the loaded cells) when present, else the bbox. Node and edge ids already issued never change while cells are only added, and a `WalkGraph` built from an accumulator mark is the graph as it was at that mark. The planners are unchanged; a reroute uses the graph of the newest snapshot. See [map-rendering design](../map-rendering/design.md#streaming-multi-area-world-requirement-19-task-70).
