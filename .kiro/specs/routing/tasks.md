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
