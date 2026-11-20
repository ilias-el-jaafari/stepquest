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

## Phase 2 — Walk it

- [ ] 11. Geolocation start ("use my location") with permission handling and an HTTPS note
- [ ] 12. Live position on the map, follow mode, walker animation (4-frame, reduced-motion aware)
- [ ] 13. Checkpoint collection within 20 m, progress bar, finish screen
- [ ] 14. Run planning in a Web Worker if larger live areas make the UI stutter

## Phase 3 — Sound

- [ ] 15. Original formant speech synthesizer (glottal source + formant filters, phoneme table written by us) with unit tests on generated buffers
- [ ] 16. Callout scripts in EN/ES (turns, checkpoints, halfway, finish)
- [ ] 17. Procedural chiptune (square, triangle, noise) with tempo following step cadence

## Phase 4 — Polish and submission

- [ ] 18. Onboarding, final name and logo, PWA manifest
- [ ] 19. Public repo with `/.kiro`, OSI licence, Pages deploy, demo video under 3 minutes, write-up
