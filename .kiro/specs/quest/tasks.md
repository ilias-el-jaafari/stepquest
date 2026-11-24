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
