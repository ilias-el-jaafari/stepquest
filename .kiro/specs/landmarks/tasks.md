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

## Polish from browser review (València, ES 390×844)

- [x] 91.2 Names never clipped: `render/labelFit.ts` slides a label inside the view and flips it above the sprite when there is no room below; tests in `labelFit.test.ts` (property) and `sightLayer.test.ts`. The HUD cards are not avoided (the view does not know them).
- [x] 91.4 Wisp mentions a sight within `PASS_M` = 35 m (was 40), so it is on screen; sights are still drawn out to `CORRIDOR_M` = 50 m. Test in `sights/route.test.ts`.
- [x] 91.5 Sprites doubled with new parts (clock, flags, pilasters, second minaret), each on a paving plate with two gold sparkles. Buildings cover 1.5 to 2.6 house lots (`HOUSE_FOOTPRINT_PX`, a 3 × 3 tile lot), monuments are 3 tiles or taller. Footprints are now up to 4 × 4 tiles; the keep-out set still holds route, gems, start and finish. Atlas 288 px wide; tests in `sights/art.test.ts`.

## Rework from Ilias's feedback (task 92)

- [x] 92.1 Spec: requirements L10 and L11, design "Real footprint", `visual-style.md` landmark section (names off the map, materials per kind, campus rules)
  - _Requirements: L5.3, L10, L11_
- [x] 92.2 No names on the map: `drawLabels` and `render/labelFit.ts` removed (names stay in Wisp's lines and the summary); test that nothing is written to the canvas
  - _Requirements: L5.3_
- [x] 92.3 Data: `OsmData.grounds`, `omt.ts` (landuse and containing building polygons), `assemble.ts`, `slice.ts`, `worldData.ts`, `liveWorld.ts`, codec v6 (`gr`); tests
  - _Requirements: L10.1, L8.2_
- [x] 92.4 `sights/grounds.ts` (link, join pieces, merge, distance) and the corridor filter on areas; tests incl. property tests
  - _Requirements: L2.1, L10.2_
- [x] 92.5 `sights/campus.ts` and `render/campusArt.ts`; `SightLayer` per-chunk bitmaps, crowns, night layer, decor keep-out; property tests (special only inside the footprint, no ordinary house left, whole lots)
  - _Requirements: L10.3 to L10.6, L11_
- [x] 92.6 New per-kind materials and silhouettes in `sights/art.ts`; tests for distinct palettes
  - _Requirements: L11.1_
- [x] 92.7 Goldens updated on purpose; `npm test`, `npx tsc -b`, `npm run lint`, `npm run build`; ES 390×844 day and night at Tarongers and the town hall; benchmark twice
  - _Requirements: all_

Verification (task 92.7): ES 390×844 @2x in `shots/I4-campus-es-390x844-{day,night}.png` (Campus dels Tarongers, loop from 39.4790, -0.3420) and `I4-townhall-es-390x844-{day,night}.png` (Plaça de l'Ajuntament).
