# Error copy: Tasks

Part of the StepQuest specs; see [../README.md](../README.md). Requirements: [requirements.md](requirements.md), design: [design.md](design.md).

- [x] 88.1 Spec, steering section "Mischief in errors" in `copy-voice.md`, ghost-guide G8.3 pointer
  - _Requirements: E1 to E8_
- [x] 88.2 Rewrite every error line in `en.ts` and `es.ts` (planning, avoid streets, map data, location, quest GPS, offline, empty, sound, crash)
  - _Requirements: E1, E3 to E6_
- [x] 88.3 `GhostNote` and CSS; use it in the planner, quest log, locate message, safety notice and settings; faces on the map failure and the crash screen
  - _Requirements: E2_
- [x] 88.4 `errorCopy.test.ts`; tests that asserted old copy now use test ids or the dictionary
  - _Requirements: E8.1, E8.2, E8.4_
- [x] 88.5 Hook `error-copy-voice`
  - _Requirements: E8.3_
- [x] 88.6 `npm test`, `npx tsc -b`, `npm run lint`, `npm run build`
