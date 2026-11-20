# Implementation Plan

Tasks are grouped by phase. Do not start the next phase until the current phase builds, its tests pass, and the UI can be demonstrated with screenshots.

## Phase 1 — Route planner and tile map

- [x] 1. Scaffold Vite + React + TypeScript (strict), Vitest, Oxlint, GitHub Pages workflow, EN/ES i18n and the brand constant
  - _Requirements: 5.3, 8.2_
- [x] 2. Add `.kiro` steering (product, tech, structure, visual style), this spec, and hooks (tests and lint on save)
  - _Requirements: 8.1_
- [x] 3. OSM layer: tag classification, Overpass normalization with shared nodes, compact codec, bundled Benicalap fixture
  - _Requirements: 1.1, 3.6_
- [x] 4. Polite Overpass client with IndexedDB cache, throttling, size cap and fallback endpoint (mocked tests)
  - _Requirements: 1.2, 1.3, 1.4_
- [x] 5. Tile grid and rasterization (polygons, thick roads, 4-connected paths, crossings) with fixture tests
  - _Requirements: 2.1, 2.2, 2.3_
- [x] 6. Auto-tiling: 4-bit and 8-bit blob masks with exhaustive tests
  - _Requirements: 2.4_
- [x] 7. Original procedural tileset, sprites and chunked canvas renderer with pan/zoom and overview map
  - _Requirements: 2.5, 2.6, 1.5_
- [x] 8. Walking graph, A*, loop and A→B planners tuned to ±5 %, feasibility reasons, checkpoints
  - _Requirements: 3.1–3.8, 4.1, 4.2_
- [x] 9. Retro UI: mode, tap-to-place, goal presets, stride, plan / another route, quest log, live-area loader
  - _Requirements: 5.1, 5.2, 5.3_
- [x] 10. Screenshots (390×844 and 1280×800) of a 10k loop and an A→B route in `screenshots/phase1/`

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
- [x] 21a. Fix: step goal and stride fields accept free typing (raw text, validated and clamped only on blur, Enter or Plan, with an inline hint); goal range 100–60,000 steps; retro slider 500–30,000 synced both ways with the field
  - _Requirements: 5.1_

## Phase 3 — Visual polish

- [ ] 22. Walker sprites facing four directions with a 2-frame walk cycle (reduced-motion aware)
- [ ] 23. Tile polish: diagonal street smoothing, more building and park variety, water animation
- [ ] 24. Run planning in a Web Worker if larger live areas make the UI stutter

## Phase 4 — Sound

- [ ] 25. Original formant speech synthesizer (glottal source + formant filters, phoneme table written by us) with unit tests on generated buffers
- [ ] 26. Callout scripts in EN/ES (turns, checkpoints, halfway, finish)
- [ ] 27. Procedural chiptune (square, triangle, noise) with tempo following step cadence, replacing the placeholder beeps

## Phase 5 — Submission

- [ ] 28. Onboarding, logo, PWA manifest
- [ ] 29. Public repo with `/.kiro`, OSI licence, Pages deploy, demo video under 3 minutes, write-up
