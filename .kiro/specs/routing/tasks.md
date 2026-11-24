# Routing: Implementation Plan

Part of the StepQuest specs; see [../README.md](../README.md). Task numbers are the original ids from the single spec, so they are not consecutive here. Do not tick a task until `npm test`, `npx tsc -b`, `npm run lint` and `npm run build` pass.

## Phase 1 — Route planner and tile map

- [x] 8. Walking graph, A*, loop and A→B planners tuned to ±5 %, feasibility reasons, checkpoints
  - _Requirements: 3.1–3.8, 4.1, 4.2_

## Phase 3 — Visual polish

- [x] 33. Run planning in a Web Worker if larger live areas make the UI stutter (done with task 54: plans and reroutes run in a worker with a synchronous fallback)

## Mobile design

- [x] 49d. Polish: the planner folds on phones once a route is ready (and the quest HUD starts folded); distance to the next checkpoint measured along the route; long A→B goals hit ±5 % with a side loop; strong penalty for walking a street twice; neutral fallback wording; straight kerbs on shallow diagonal streets; walked footprints kept after a reroute; Pages workflow on Node 24 actions
- [x] 51b. Field fix: routes go around roundabouts (ring detection incl. split arcs and untagged loops, island edges removed from the walking graph, ways split at out-of-box nodes instead of chords); tests on synthetic plazas and the Benicalap fixture
- [x] 54. Fast rerouting (requirement 7c): timing test on the Benicalap map; planning and rerouting in a Web Worker with a typed protocol, latest-wins and an inline fallback; local reconnect to the planned route within the step budget before a full replan; edge-cost cache; off-route decision after 20 m instead of 30 m; tests for the protocol, stale requests, reconnect (budget, gem order, stale patch) and the debounce

## Property-based tests

- [x] 56. Property tests with fast-check (`routing.property.test.ts`, `roundabout.property.test.ts`, `src/quest/reroute.property.test.ts`) for P-R1 to P-R4, P-RA1, P-RA2 and P-RR1 to P-RR3 in `design.md`: random seeds, starts and goals on the Benicalap fixture, random roundabout rings, random off-route positions; fixed seed 20261204. No source bug found in this area; the float32 edge costs versus the float64 `min` needed a `Math.fround` in the test, which is only a precision note.

## Architecture review follow-up (Nov 2026)

Each bug task starts with a failing regression test (fixture-based, Benicalap, no network) before the fix, per the project's quality bar. Performance tasks are measured against `rerouteBench.test.ts`'s approach and a new `planBench.test.ts`. See "Architecture review (Nov 2026)" in `design.md` for the problems and target design; requirement numbers are in `requirements.md`.

- [x] 61.1 Loop mode "too short": failing test first (a target below the smallest triangle size returns `noMatch` today instead of `tooShort`), then make `planLoop` report `tooShort` with `minSteps` below its floor size, mirroring `planOneWay`
  - _Requirements: 3.9_
- [x] 61.2 `maxSteps` on every infeasible Loop result: failing test first (a `noMatch` with no `maxSteps` even though a longest attempt exists), then track and report the longest attempt's steps on every `ok: false` path in `planLoop`, matching `planOneWay`'s existing `longest`/`track` pattern
  - _Requirements: 3.10_
- [x] 61.3 Step-count range guard: failing test first (`targetSteps` below `MIN_STEPS` or above `MAX_STEPS` currently runs the full tuning search), then add a shared guard in `planRoute` returning a new `outOfRange` reason with `minSteps`/`maxSteps` set to the allowed bounds, before any snapping (guard lives in `planLoop` and `planOneWay`; UI strings `error.outOfRange` added in en and es)
  - _Requirements: 8.6_
- [x] 61.4 Empty-graph regression test: a fixture `OsmData` with zero walkable ways builds a zero-size `WalkGraph`, and `planRoute` reports `unreachable` for both modes (no production change expected; this guards problem 8 of the review)
  - _Requirements: 8.7_
- [x] 61.5 Shared-exclusion invariant tests: a property test asserting two `WalkGraph`s built from the same `OsmData` have identical edge sets, and a test asserting no graph edge belongs to a way with `access=no|private` or `foot=no|use_sidepath|private`
  - _Requirements: 8.3_
- [x] 61.6 Crossings (scope set by the product owner: safety and night weights NOT changed): `safetyFactor` is untouched; tests prove crossing ways stay in the graph, join the streets they cross and are routable, and that the crossing flag does not change edge costs; "prefer marked crossings" is written up as an open proposal in `design.md`
  - _Requirements: 9.1_
- [x] 61.7 Plaza interior routing: failing test first (two opposite points on a plaza/square fixture snap to the same graph node, or a route between them only follows the boundary ring), then add interior chords for walkable plaza/square polygons at graph-build time (centroid-node or restricted-triangulation approach from `design.md`), reusing the point-in-polygon and distance-to-ring helpers from `roundabout.ts`
  - _Requirements: 8.4, 8.5_
- [x] 61.8 Reconnect length property: extend the reroute property tests with a check that a local patch's `route.distanceM` equals the sum of its own edge lengths plus the kept tail's haversine length (closes the P-R2-style coverage gap for reroute patches)
  - _Requirements: 7c.4_
- [x] 61.9 Initial-plan timing baseline: add `src/routing/planBench.test.ts` timing a cold `planLoop` and `planOneWay` call on the Benicalap fixture (nearest-node time, edge-cost-copy time, A* time), following the reporting style of `rerouteBench.test.ts`
  - _Requirements: 10.1_
- [x] 61.10 Reduce A* allocation (retargeted after measuring in 61.9: the per-call cost copy is microseconds and `nearestNode` is ~0.1 ms; A* legs dominate): reuse A* working memory per graph with generation stamps, `sqrt` instead of `hypot`; planBench shows A* leg 0.70 to 0.50 ms and plans 20 to 30 % faster
  - _Requirements: 10.2_
- [x] 61.11 Document the snap/offset distance constants: one comment block in `planner.ts` next to `MAX_SNAP_M` (actual names: `snapToRoute` 60/400 m window, `offRouteM`, `decideM`, `retryM`, `JOIN_SNAP_M`) with their ordering (no behaviour change)
  - _Requirements: none (documentation only, supports review problem 11)_
- [x] 61.12 Document the pedestrian-direction gap: add a short note to `.kiro/steering/routing.md`'s OSM tags section stating that `oneway`/`oneway:foot`/`foot:forward`/`foot:backward` are not read and the graph is undirected by design for the common case (no behaviour change)
  - _Requirements: 8.8_

## Geodesy review (Nov 2026, requirement 11)

- [x] 69.13 Review of `geo/geo.ts` written into `design.md` (B10 to B13); one metres-per-degree constant, wrapped longitudes, clamped boxes, finite projection at the poles (failing tests first)
  - _Requirements: 11.1, 11.2, 11.3_
- [x] 69.14 Property tests: projection round trip and distance accuracy against haversine
  - _Requirements: 11.4_
