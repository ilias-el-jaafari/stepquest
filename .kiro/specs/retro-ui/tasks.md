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

## i18n rework (Nov 2026)

- [x] 65. i18n rework: review, typed keys, formatting, agreement, language switching and scans (design: "i18n architecture review (Nov 2026)")
  - [x] 65.1 Review of `src/i18n/**`, every place text or numbers reach the user, the voice phrases and the language switch; findings F1 to F14 and bugs B1 to B8 written into `design.md`
    - _Requirements: 8.3, 8.12_
  - [x] 65.2 Typed keys: `Translate` derives each key's variables from its English text; unknown keys and missing, misspelled or extra variables fail `tsc`; `PlainKey` for lookup tables; type tests with `@ts-expect-error`
    - _Requirements: 8.4_
  - [x] 65.3 `i18n/format.ts` (`formatNumber`, `formatDecimal`, `formatKm`, `formatDistance`, `formatSignedPercent`) used by the planner, result box, hero tab and quest screen; the unit `km` leaves the dictionaries and JSX (B1, B2, B3)
    - _Requirements: 8.5, 8.6_
  - [x] 65.4 Plural selection by displayed value (`0,01` is plural, `10.000` is ten thousand) and a cached `Intl.PluralRules` (B4)
    - _Requirements: 8.7_
  - [x] 65.5 Spanish copy: "5 %" with a no-break space, "Calle añadida: {name}" instead of a gendered "Añadida {name}" (B5, B6); wording changes listed in `design.md`
    - _Requirements: 8.8_
  - [x] 65.6 Locale detection reads the whole `navigator.languages` list and matches the primary subtag, so "est" is not Spanish (B7)
    - _Requirements: 8.9_
  - [x] 65.7 Page language, title and description follow the language (`meta.title`, `meta.description`); quest runner drops queued speech and re-warms callouts on a language change (B8)
    - _Requirements: 8.10_
  - [x] 65.8 Source scan (`sourceScan.test.ts`): no text typed into JSX, accessibility attributes or `document.title`, no `toFixed` or `toLocaleString()` for people, with a scanner self-test and a small allowlist
    - _Requirements: 8.3, 8.5_
  - [x] 65.9 Layout fit check (`fit.test.ts`): tabs, two-per-row buttons and full-width buttons at 390 px by character count of the monospace font, English and Spanish
    - _Requirements: 8.11_
  - [x] 65.10 Dictionary hygiene (`copy.test.ts`): no unused key (seven removed), percent and unit rules, inverted marks, no stray spaces; property tests P-I3 and P-I4
    - _Requirements: 8.5, 8.7, 8.8, 8.13_
  - [x] 65.11 Spec sync: requirements 8.3 to 8.13, design review, this list

## App shell rework (Nov 2026)

- [x] 67. App shell rework: review, reducer, split of `App.tsx`, bug fixes, accessibility, layout, PWA (design: "App shell review (Nov 2026)")
  - [x] 67.1 Review of `App.tsx`, `src/ui/**`, `index.css`, `main.tsx` and the manifest; findings F1 to F18 and bugs B1 to B16 written into `design.md`
    - _Requirements: 5c.1 to 5c.17_
  - [x] 67.2 Typed app state reducer (`src/app/appState.ts`) with request tokens, `useAppState` with a synchronous `latest`, and property tests P-A1 to P-A4
    - _Requirements: 5c.1, 5c.2, 5c.17_
  - [x] 67.3 Split `App.tsx` (955 to about 310 lines): hooks `usePlanner`, `useArea`, `useNumberFields`, `useToday`, `useOnline`; components `AppHeader`, `PlannerPanel`, `BagContent`, `HeroContent`, `SettingsContent`, `MapBanners`, `Sheet`, `ResultBox`, `SafetyNotice`, `FieldNote`, `LocateMessage`; coordinates formatter in `geo/coords.ts`
    - _Requirements: 5c.17_
  - [x] 67.4 Planning fixes: one request per press, stale answers dropped, failure leaves "Planning…" (B1 to B3); start-up failures: retry for the map, kept quest with a notice (B4, B5); fresh "steps today" (B6)
    - _Requirements: 5c.1 to 5c.6_
  - [x] 67.5 Re-render storms: memoised `MapView`, stable callbacks in the quest screen (B7, B8)
    - _Requirements: 5c.7_
  - [x] 67.6 Dialogs and focus: `useModal`, `ConfirmDialog` replacing `window.confirm`, `CompleteDialog`, `inert` app behind the intro, `useDismiss` for Info and Sound, `aria-controls` and `aria-pressed` fixes, whole-line dialogue announcement (B9 to B15)
    - _Requirements: 5c.8 to 5c.12_
  - [x] 67.7 `ErrorBoundary` with EN/ES retro message (keys `crash.*`), Try again and Reload; saved data untouched
    - _Requirements: 5c.13_
  - [x] 67.8 Layout: 320 px header, landscape phone layout, sticky Plan button on short screens, banners, safe areas; `scripts/check-layout.mjs` and `shellCss.test.ts`; manifest `orientation: any`
    - _Requirements: 5c.14, 5c.15_
  - [x] 67.9 PWA: service worker generated by the build (`src/pwa/sw.template.js`), `UpdateStore`, update and offline banners (keys `update.*`, `net.offline`)
    - _Requirements: 5c.16_
  - [x] 67.10 Dead CSS removed (rules fully overridden by later copies, `.box-sub`, `.topbar-tools`); a test fails on new ones
    - _Requirements: 5c.17_
  - [x] 67.11 Spec and steering sync: requirements 5c, this list, design review, `structure.md` and `tech.md`


## Hero look review (Nov 2026, requirement 15)

- [x] 69.8 Review of `hero/**` written into `design.md` (B7 to B9, open points)
  - _Requirements: 15.1 to 15.4_
- [x] 69.9 `-0` repaired, sprites built from the repaired look, `setLook` stores the repaired look (failing tests first)
  - _Requirements: 15.1, 15.2, 15.3_
- [x] 69.10 Property tests: any JSON value gives a valid look, valid looks are unchanged, one bad part repairs only that part
  - _Requirements: 15.1_

## Bottom bar fit (Nov 2026, requirement 16)

- [x] 70.1 Quest bottom bar and button rows fit 320 to 430 px in EN and ES (wrapping bar, `min-width: 0`, label clamp 9 to 10 px); `hudFit.test.ts` checks label geometry and the CSS rules
  - _Requirements: 16.1 to 16.4_

## Page zoom lock (requirement 17)

- [x] 71.1 Locked viewport meta, `pageZoomGuard` (gesture and multi-touch cancel outside the map canvas, visual viewport reset), `touch-action` rules, minimum font 7 px, tests, design trade-off note
  - _Requirements: 17.1 to 17.6_
