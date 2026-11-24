# Quest (GPS, gems, simulation): Implementation Plan

Part of the StepQuest specs; see [../README.md](../README.md). Task numbers are the original ids from the single spec, so they are not consecutive here. Do not tick a task until `npm test`, `npx tsc -b`, `npm run lint` and `npm run build` pass.

## Phase 2 — GPS and checkpoints

- [x] 11. "Use my location": one-shot high-accuracy fix, start point set, live Overpass area loaded when outside the map; denied / timeout / unavailable / insecure / unsupported / too-inaccurate messages in EN and ES
  - _Requirements: 6.1, 6.7_
- [x] 12. GPS noise filter: accuracy gate (50 m), max-speed sanity (7 m/s, reset after 3 agreeing outliers), Kalman smoothing, jitter-proof odometer
  - _Requirements: 6.2_
- [x] 13. Route snapping with a progress window (loops that cross themselves), off-route detection with a direction hint
  - _Requirements: 6.3, 6.6_
- [x] 14. Active quest: watchPosition source, walker follows the snapped position, camera follow (drag to unfollow), walked trail turns gold
  - _Requirements: 6.3_
- [x] 15. Checkpoint collection in route order (22 m radius growing with poor accuracy, max 35 m; "walked past" also counts), pickup sparkle + toast + square-wave beep, finish fanfare
  - _Requirements: 6.4, 6.5_
- [x] 16. HUD: next checkpoint, distance and direction, gems collected/total, walked distance, steps (distance ÷ stride), time, pace, GPS status (waiting, weak, lost)
  - _Requirements: 6.5_
- [x] 17. Quest complete screen with stats and "New quest"
  - _Requirements: 6.5_
- [x] 18. Persistence in localStorage (resume after reload or lost signal, same map restored), Screen Wake Lock with re-acquire on visibility change
  - _Requirements: 6.8_
- [x] 19. Walk simulator (speed ×1–×120, optional GPS noise and glitches) for testing and the demo video; resumable
  - _Requirements: 6.9_
- [x] 20. Tests: filter, snapping, collection (order, radius, accuracy), off-route, persistence and resume, finish condition, simulated walk end-to-end on the fixture, geolocation and wake-lock adapters, App flows
- [x] 21. Screenshots of the HUD mid-route, a pickup and the complete screen in `screenshots/phase2/`

## Phase 3 — Visual polish

- [x] 30. Fix: once the quest is finished, signal and route warnings are hidden and `watchPosition` and the wake lock are released; late fixes are ignored

## Mobile design

- [x] 49c. Field test fixes B: footprints route (walked prints darker), follow mode, adaptive rerouting, map-area loading (auto-load around GPS, "Load this area", mirror race, worker, area cache, progress)

## Architecture review follow-up (Nov 2026)

Findings and rationale: see "Architecture review (Nov 2026)" in [design.md](design.md) and Requirement 6b. Every bug fix starts with a failing regression test.

- [x] 64.1 Split `quest.ts` into `state.ts`, `deviation.ts`, `collect.ts`, `machine.ts`, `stats.ts`; `quest.ts` re-exports them (no behaviour change; existing tests stay green)
  - _Requirements: 6b.15_
- [x] 64.2 Filter hardening: `invalid` reason, unknown accuracy (0, NaN, missing) as 20 m, agreeing outliers, accuracy of both readings in the speed gate, clock set back, age check of browser fixes (`fixFreshness.ts`)
  - _Requirements: 6b.1, 6b.2, 6b.3, 6b.4, 6b.5_
- [x] 64.3 Odometer: no drift while standing (threshold 2 × accuracy, 4 to 30 m), capped share for accepted jumps, never decreases
  - _Requirements: 6b.6_
- [x] 64.4 Gems: time-aware passing, exactly once and in order, finish only after the flag (`collect.ts`)
  - _Requirements: 6b.7, 6b.8_
- [x] 64.5 Off-route hysteresis and `backOnRoute` when the message ends
  - _Requirements: 6b.9_
- [x] 64.6 Reroute race: patch bound to the collected count, to a walker still off the route and near the planned position; rejected requests ignored
  - _Requirements: 6b.10_
- [x] 64.7 Persistence: quest version 2, `migrate.ts` (v1 to v2, newer kept, validation), saved route must fit the loaded map
  - _Requirements: 6b.8, 6b.11_
- [x] 64.8 Steps today credited as walked, for the day of the fix, once (`creditedSteps`)
  - _Requirements: 6b.12_
- [x] 64.9 Wake lock: one sentinel, release after a late resolve, `onChange` for the HUD
  - _Requirements: 6b.13_
- [x] 64.10 Simulator source: stop in the middle of a tick; demo ×20 end to end with noise and glitches
  - _Requirements: 6b.16, 6b.17_
- [x] 64.11 `QuestSession` (pure controller: fixes, save throttle, step credit, reroute tickets) and a thin `useQuestRunner`; `signalStatus` out of `QuestScreen`; hook cleanup (late errors, unmount, timers)
  - _Requirements: 6b.14, 6b.15, 6b.16_
- [x] 64.12 Property tests on random noisy traces: odometer never decreases, no counting while standing, gems once and in order, finish only after the flag, persistence round trip, migration
  - _Requirements: 6b.6, 6b.7, 6b.8, 6b.11_
- [x] 64.13 Dead code (`remainingM`, unused sentinel listener type, `testWalk.ts` renamed `testWalk.testutil.ts`), spec and README sync
  - _Requirements: 6b.15_

## Step counting review (Nov 2026, requirement 6c)

- [x] 69.11 Review of `geo/steps.ts` and its callers written into `design.md`; `roundStride` used by `sanitizeSettings` (B14)
  - _Requirements: 6c.1, 6c.3_
- [x] 69.12 Property tests: steps → metres → steps exact, metres → steps → metres within half a stride, stride and height bounds
  - _Requirements: 6c.2, 6c.3_

## End-of-quest summary (requirement 6d)

- [x] 75.1 `quest/summary.ts`: stats, clamping, titles; unit and property tests
  - _Requirements: 6d.1, 6d.4_
- [x] 75.2 `ui/celebration.ts`: seeded confetti, fireworks and calm twinkles with a particle cap; tests
  - _Requirements: 6d.5_
- [x] 75.3 `fanfare` and `rest` effects in `audio/sfx.ts`
  - _Requirements: 6d.7_
- [x] 75.4 `ui/SummaryScreen.tsx` replaces `CompleteDialog`: hero hop, canvas, reduced motion, sound, two buttons; EN and ES copy; fit tests at 320 and 390
  - _Requirements: 6d.1, 6d.3, 6d.6, 6d.7, 6d.8_
- [x] 75.5 `QuestScreen`: paused variant on "End", "Back to map", "Plan another quest"; App flow tests
  - _Requirements: 6d.2, 6d.3_


## Location prepares the walk (task 78)

- [x] 78.7 "Use my location" loads the streets around the fix before it reports success, a placed start prefetches them, a failed load says so with Retry (see [routing tasks](../routing/tasks.md) 78.7 and 78.9)
  - _Requirements: 6e.1 to 6e.4_
