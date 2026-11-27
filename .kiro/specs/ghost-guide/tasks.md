# Ghost guide: tasks

## Smooth walker (quest requirement 6g)

- [x] 84.1 `RouteLine` and `RouteWalker`: constant pace along the route in a simulation, monotonic progress with a 15 m back tolerance for real GPS
  - _Requirements: quest 6g.1 to 6g.4_
- [x] 84.2 `OverlayLayer` places the hero through `RouteWalker` (facing from the route, off-route fixes drawn where they are); `QuestScreen` passes `simMps` and `offRoute`
  - _Requirements: quest 6g.1 to 6g.4, map-rendering 27.1_
- [x] 84.3 Property tests: monotonic across frames and fixes, ±10 % of speed × dt at ×1, ×5, ×20 with irregular frames, no step back at fix boundaries; golden frames keep their hashes (their quest is marked off-route)
  - _Requirements: quest 6g.5_
- [x] 84.4 Hook `walker-progress-tests` runs these tests when `walkerMotion.ts`, `routeWalker.ts`, `simulate.ts` or `simSource.ts` is saved

## The ghost

- [x] 85.1 `ghost/art.ts`: four sprites, phases, bob; tests for validity
  - _Requirements: G1_
- [x] 85.2 `OverlayLayer.drawGhost`: cached sprite blit, mirror, lantern glow, reduced motion
  - _Requirements: G1, G6.3, G7.2_
- [x] 86.1 `ghost/pacer.ts`: pace, plan, pause, rebase, status with hysteresis; unit and property tests
  - _Requirements: G6.1, G6.3 to G6.6_
- [x] 86.2 `useGhost`, `GhostHud`, planner line "Ghost pace", demo and simulator rates
  - _Requirements: G6.2, G6.4, G6.5, G6.7, G7.1_
- [x] 87.1 `ghost/director.ts`, gem comments, night scare once per quest
  - _Requirements: G3, G5_
- [x] 87.2 Onboarding hosted by Wisp (replayable from Settings), summary guest with spin and sparkles
  - _Requirements: G2, G4_
- [x] 87.3 EN/ES copy (`ghost.*`, `result.ghostPace*`, `summary.ghost`, `onboarding.*`), steering notes (`visual-style.md`, `copy-voice.md`, `structure.md`)
  - _Requirements: G8_
- [x] 87.4 `npm test`, `npx tsc -b`, `npm run lint`, `npm run build`

## Polish from browser review

- [x] 90.1 Wisp's face redrawn (two spaced 2×2 eyes, cheek blush, one-pixel mouth; boo and happy mouths), 1.5× on the map, fainter night glow; `ghost/art.test.ts`
  - _Requirements: G1.3 to G1.5_
- [x] 90.2 Demo choreography: `gapScript` on `PacerPlan`, `DEMO_GAP_KEYS` and `demoGapScript` in `demo/script.ts`, `useGhost({ demo })`; tests in `demo/script.test.ts`
  - _Requirements: D8.2_
