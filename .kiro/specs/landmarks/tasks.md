# Landmarks: tasks

## Spec and steering

- [x] L1.1 This spec; `visual-style.md` (landmark sprite style), `copy-voice.md` (Wisp's sight lines), `structure.md` (`src/sights/`)
  - _Requirements: all_

## Data

- [x] L2.1 `sights/types.ts`, `sights/classify.ts`: OpenMapTiles and OSM tag classification, religion mapping, monument style and score, dedupe; tests
  - _Requirements: L1, L3.1_
- [x] L2.2 `OsmData.sights`, `omt.ts`, `assemble.ts`, `slice.ts`, `worldData.ts`, `normalize.ts`; codec v5 (`sg`, `sgn`); tests
  - _Requirements: L1.2, L8_
- [x] L2.3 `sights/route.ts`: corridor filter, top monuments, passed list, announce; unit and property tests
  - _Requirements: L2, L3, L6.1, L7.1_

## Art and rendering

- [x] L3.1 `sights/art.ts`: palette, twelve sprites, lit overlays, atlas layout; tests (size, palette, symmetry of the star, no empty sprite)
  - _Requirements: L4_
- [x] L3.2 `sights/place.ts`: free-spot search; tests
  - _Requirements: L5.1_
- [x] L3.3 `render/sightLayer.ts` and `MapRenderer.setSights`, `MapView` prop; layer test with a recording context
  - _Requirements: L5.2 to L5.5_

## Wisp and summary

- [x] L4.1 `ghost/director.ts` `sightLine`, `useGhost` announcements, copy EN/ES
  - _Requirements: L6_
- [x] L4.2 Summary "Places discovered"
  - _Requirements: L7_
- [x] L4.3 `npm test`, `npx tsc -b`, `npm run lint`, `npm run build`; ES 390×844 screenshots day, night and summary; benchmark
  - _Requirements: L9_
