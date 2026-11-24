# Retro UI: Implementation Plan

Part of the StepQuest specs; see [../README.md](../README.md). Task numbers are the original ids from the single spec, so they are not consecutive here. Do not tick a task until `npm test`, `npx tsc -b`, `npm run lint` and `npm run build` pass.

## Phase 1 — Route planner and tile map

- [x] 1. Scaffold Vite + React + TypeScript (strict), Vitest, Oxlint, GitHub Pages workflow, EN/ES i18n and the brand constant
  - _Requirements: 5.3, 8.2_
- [x] 2. Add `.kiro` steering (product, tech, structure, visual style), this spec, and hooks (tests and lint on save)
  - _Requirements: 8.1_
- [x] 9. Retro UI: mode, tap-to-place, goal presets, stride, plan / another route, quest log, live-area loader
  - _Requirements: 5.1, 5.2, 5.3_

## Phase 2 — GPS and checkpoints

- [x] 21a. Fix: step goal and stride fields accept free typing (raw text, validated and clamped only on blur, Enter or Plan, with an inline hint); goal range 100–60,000 steps; retro slider 500–30,000 synced both ways with the field
  - _Requirements: 5.1_

## Phase 3 — Visual polish

- [x] 28. Classic RPG dialogue box (typewriter, blinking marker, tap / Enter to skip or continue, auto-close while walking) for the quest start, each pickup and the finish
- [x] 29. Fix: proper plural forms in EN and ES for every count (checkpoints, steps, gems), chosen with `Intl.PluralRules`

## Mobile design

- [x] 49. App frame: header with title and steps today, full-height map, framed planner above a bottom tab bar (Map, Bag, Hero, Settings) with original pixel icons; side rail on wide screens; existing panels moved into tabs and sheets; iPhone safe areas, web app manifest and home-screen icons; quest dialogue kept clear of the map credit line
- [x] 49e. Retro look: walker dressing in the Hero tab (boy/girl, five colour parts, live walking preview, saved on the device), ten-block steps meter, quest map inside a generic handheld-console screen, notched 8-bit panels and buttons, 48 px press areas, press click and Android buzz, stepwise motion with reduced-motion support
- [x] 55. Console buttons (requirement 5b): pill and round pixel buttons with stepped corners, bevels and sinking press; original pixel icons for zoom, fit, home, recenter, sound, play, pause and menu; one family on every screen; AA label contrast test; Playwright rule updated

## Phase 5 — Submission

- [x] 52. Onboarding and logo (requirement 9): original pixel gem logo drawn from a grid (header, intro, favicon and PWA icons via build-icons.mjs); first-run 3-screen intro in EN and ES with pixel illustrations, Skip, Back, Next, Start, Esc and arrow keys, focus trap, stored under `stepquest.onboarded`, reopened with "Show intro" in Settings; screenshot scripts set the key
- [ ] 53. Public repo with `/.kiro`, OSI licence, Pages deploy, demo video under 3 minutes, write-up

## Property-based tests

- [x] 57. i18n property tests (P-I1, P-I2 in `design.md`). Bug found and fixed: `dlg.pickup` had a plural `{left|Queda #.|Quedan #.}` in Spanish but a plain `{left}` in English; the English text now uses `{left|# to go.|# to go.}` (same output, same plural form set).
