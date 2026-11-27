# Demo mode: Tasks

Part of the StepQuest specs; see [../README.md](../README.md). Requirements: [requirements.md](requirements.md), design: [design.md](design.md).

- [x] 77. Self-playing demo run (`?demo=1`)
  - [x] 77.1 Spec: requirements D1 to D6, design, tasks
  - [x] 77.2 `demo/script.ts` and `demo/camera.ts` (pure): URL, constants, time warp, progress, clock, camera blend, timeline, shot; unit tests
    - _Requirements: D1.1, D1.2, D3.2, D3.5, D4.1, D4.2, D5.1, D5.2_
  - [x] 77.3 `LightingLayer.setClockAt` and `MapRenderer.setClockAt` / `autoShot`; `MapView` props `clockAt` and `shot`
    - _Requirements: D4.1, D5.1_
  - [x] 77.4 App wiring: `demoAppState`, no saving, fixed night weights, `useDemoRun`, `useArea` demo (bundled only, no streaming), runner without store, audio armed for the first tap, language from the URL
    - _Requirements: D1, D2, D3.1, D3.7_
  - [x] 77.5 `QuestScreen` demo: clock and camera from progress, tap stops the camera, reduced motion, dialogues move on by themselves (`DialogueBox.autoNextMs`)
    - _Requirements: D3.3, D3.4, D4.3, D4.4_
  - [x] 77.6 App test with failing `fetch`: whole run to the summary, tap, reduced motion, normal visit unchanged
    - _Requirements: D2, D3, D4.3, D4.4, D5.1_
- [x] 79.8 The HUD of the demo run has no "Simulation ×N" badge (`QuestScreen`, `AppDemo.test.tsx`)
  - _Requirements: D7.1, D7.2_
