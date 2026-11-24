# Retro UI: Design

Part of the StepQuest specs; see [../README.md](../README.md). See also: [quest](../quest/requirements.md) (HUD content), [voice-audio](../voice-audio/requirements.md) (sound menu).

## Dialogue and plurals (Phase 3)

- Dialogue: `DialogueBox` (typewriter at 28 ms per character, skip / next on tap, Enter or Space, auto-close for pickups and the start). Priority: finish, then pickup, then start.
- Plurals: templates use `{n|one|other}` (with `#` for the value), resolved by `Intl.PluralRules` for the active locale; formatted numbers are read by their digits.

## Console buttons (task 55)

- One CSS family, `.pix-btn` (pill) and `.pix-btn.round` (48×48 icon button), replaces the earlier box-shadow buttons. The button element is transparent. `::after` is the dark outline and `::before`, inset 3 px, is the fill; both are clipped by the same stepped `clip-path` polygon (corner rows of 3 px with offsets 15, 9, 6, 3, 3 px, so a 48 px button is a pill and a 48 px square is a circle). The button box itself is not clipped, so the focus outline (a normal dashed `outline`) and the 48 px press area stay intact.
- The bevel is four 3 px gradient strips on the fill, driven by `--b1` (top and left) and `--b2` (bottom and right). `:active` swaps them, and moves the label by trading 2 px of top padding for bottom padding, so the box height never changes. Reduced motion removes the transition only; the state change stays.
- Colour variants set `--fill`, `--hi` and `--lo`: default sky, `.on` gold, `.primary` coral (mint inside the planner), `.danger` orange, `:disabled` grey. Labels are ink on all of them. `src/ui/buttonStyle.ts` lists the same colours and the contrast helper; its test fails when any label drops under 4.5:1 and checks that `index.css` declares the same hex values.
- Icons: `ICONS` in `pixelArt.ts` gains `plus`, `minus`, `fit`, `home`, `soundOn`, `soundOff`, `play`, `pause` and `menu` (12×12, original). `PixelIcon` renders them as crisp SVG rectangles. The sound button, the map buttons and the HUD fold button are round when they have no text.
- Compact buttons now have a real 48 px box instead of an invisible `::after` area, which `clip-path` would clip.
- `scripts/screenshot-retro.mjs` keeps the 48 px check and the no-rounded-corners check for panels; for `.pix-btn` it now requires a stepped `clip-path` instead of a zero radius.

## Onboarding and logo (task 52, requirement 9)

- **Logo.** `src/ui/logoArt.ts` holds `LOGO` (16×16, letters mapped to the palette: ink outline, gold gem with light and dark facets, sand path, transparent elsewhere). It is original: a faceted gem standing on a winding path, no shape taken from any game or brand. `Logo` (in `Logo.tsx`) draws it with `PixelSvg` next to `APP_NAME` set in Press Start 2P; the name stays in `brand.ts`. The header `h1` contains the mark (`aria-hidden`) and the name. `scripts/build-icons.mjs` imports `LOGO`, writes `public/favicon.svg` (grass background plus one rect per run) and renders the PNG icons from it.
- **Storage.** `ONBOARDING_STORAGE_KEY = 'stepquest.onboarded'` in `brand.ts`; value `"1"`. `src/ui/onboarding.ts` has `hasSeenOnboarding` and `markOnboardingSeen`, both wrapped in try/catch (private mode). Screenshot and check scripts set the key before loading.
- **Screens.** `Onboarding.tsx`, rendered by `App` over everything (`.onb-wrap`, fixed, dimmed backdrop; `.onb` panel in the notched console style). State is the step index 0–2. Each screen has an illustration (`onboardingArt.ts`, 16×11 grids built with a small helper: loop with a flag, three numbered gems on a path, a street lamp at night), a title, a body of one or two sentences, and three step dots. Screen 1 also shows the logo.
- **Buttons.** Skip (left, every screen), Back (from screen 2), Next, which reads "Start" on screen 3. All are `.pix-btn` (48 px minimum). Skip and Start both mark the flag and close. "Show intro" in Settings re-opens at screen 1 without clearing the flag.
- **Copy (keys `onboarding.*`).**
  - 1 EN: "Choose your distance" / "Set a step goal, or your stride, and StepQuest plans a loop or an A to B walk on real streets, within 5% of your goal." ES: "Elige tu distancia" / "Fija un objetivo de pasos, o tu zancada, y StepQuest planea un circuito o un paseo de A a B por calles reales, con un margen del 5 %."
  - 2 EN: "Follow the gems" / "Collect the numbered gems in order. The voice and the speech bubbles guide you, and if you leave the route you are rerouted." ES: "Sigue las gemas" / "Recoge las gemas numeradas en orden. La voz y los bocadillos te guían, y si te sales de la ruta se recalcula."
  - 3 EN: "Safe by default" / "Routes always prefer lit, lively streets with sidewalks, and from sunset lighting counts even more. It is always on, no switch needed. You can still list streets to avoid." ES: "Seguro por defecto" / "Las rutas prefieren siempre calles iluminadas y con vida, con aceras, y desde la puesta de sol la iluminación pesa aún más. Siempre activo, sin interruptor. Aun así puedes listar calles que evitar."
  - No plural forms are needed; the step label is `Step {n} of {total}` / `Paso {n} de {total}`.
- **Accessibility.** `role="dialog"`, `aria-modal`, `aria-labelledby` the screen title, `aria-describedby` the body. On open, focus goes to the dialog panel (`tabIndex=-1`) and the previous active element is restored on close. Tab and Shift+Tab wrap between the dialog buttons. Escape skips. ArrowRight/ArrowLeft move between screens. Enter on the panel advances or starts; Enter on a button keeps its own click. A polite live region is not needed because focus stays on the panel and the title is its name. The illustrations are `aria-hidden`. The screen change has no animation, so reduced motion needs no special case beyond the button transition rule already in place.
- **Tests.** Logo and illustration grids are rectangular and use only declared letters; the flow (3 screens, Next/Back, Start/Skip/Escape persist the flag, no reshow, Show intro reopens, focus restored); EN/ES parity is covered by the i18n tests. App tests set the key so they start on the map.

## Correctness properties (task 57)

Checked with fast-check in `src/i18n/i18n.property.test.ts` (fixed seed `20261204`). Requirement ids refer to this folder, plus 6a.6 in map-rendering for plurals.

- **P-I1 Parity.** Every English key has a Spanish twin (and the reverse), with the same placeholder names and the same set of plural placeholders (`{n|one|other}`), and no stray braces remain outside placeholder syntax. Exhaustive over the dictionaries. Validates 5.3, 8.1 and map-rendering 6a.6.
- **P-I2 Interpolation is total.** For random values of every placeholder name (counts including negative, huge, NaN and infinite; formatted numbers such as `10.000`; free text with `$&` and `#`), `interpolate` never throws and leaves no supplied `{placeholder}` unfilled in any message of either language. The plural form follows the count (`1` selects the singular, everything else the plural, `#` is replaced by the value), and a missing variable leaves exactly its own placeholder. Validates 5.3, 8.1.

## i18n architecture review (Nov 2026)

Scope: `src/i18n/**`, every place where text or numbers reach the user (`src/**/*.tsx`, `src/audio/callouts.ts`, `index.html`, `public/manifest.webmanifest`), and the speech phrases. Method: read the code against requirements 5.3, 8 and 9, grep for typed-in strings and number formatting, then write a failing test for each suspected bug before the fix (task 65). Requirement ids are in this folder (8.3 to 8.13 are new).

### Structure

- `en.ts` is the source of truth (`as const`); `es.ts` is `Record<MessageKey, string>`, so a missing Spanish key already failed the build. Placeholder names and plural placeholders were only checked at run time (P-I1).
- `locale.ts` holds detection, storage and `interpolate` (`{name}` and `{name|one|other}` with `#`). `I18nProvider.tsx` keeps the locale in state and gives `t`. Components use `useI18n`; the voice receives the locale per phrase (`engine.say(text, locale)`).
- Plural forms come from `Intl.PluralRules`. Counts use `toLocaleString(locale)`; no `Intl.NumberFormat` was used.
- Raw error text never reaches the screen: Overpass, geolocation and the planner worker map to codes (`data.err.*`, `loc.err.*`, `quest.err.*`, `error.*`), each translated.

### Findings

| Id | Finding | Outcome |
| --- | --- | --- |
| F1 | No text is typed into JSX, `aria-label`, `title`, `alt` or `placeholder`. The only literals are the endonyms "Español" and "English" in the language select. | Kept; guarded by a scan test with those two in the allowlist. |
| F2 | `t(key, vars)` accepted any key and any variables (`Record<string, string \| number>`). A typo in a variable name showed `{lat}` on screen and compiled. | Fixed (65.2). |
| F3 | Seven keys were dead: `app.name`, `lang.en`, `lang.es`, `settings.title`, `onboarding.title`, `quest.distanceDir`, `quest.pickup`. | Removed (65.10); a test fails on a new dead key. |
| F4 | The longest Spanish word on a button is "introducción" (12 characters) and the longest Spanish tab is "Mochila" or "Ajustes" (7). Nothing overflows at 390 px. Buttons wrap between words, so only a single long word or a tab label can overflow. | No change; guarded by `fit.test.ts`. |
| F5 | The manifest (`name`, `description`, `lang`) is one static file with an English description. A web manifest cannot follow a language chosen inside the app. | Not changed; recorded under open points. |
| F6 | Coordinates (`place.startAt`, `data.live`, `data.badCoords`) use a decimal point in Spanish. The coordinates field parses a point, and a comma next to the comma between latitude and longitude would be ambiguous. | Kept on purpose (8.5). |
| F7 | The Spanish copy mixes "checkpoint" (Bag, HUD, `result.ready`) and "gema" (dialogue, voice, onboarding). The English copy mixes "checkpoint" and "gem" the same way. | Not changed: it is Ilias's wording and the split is the same in both languages. |
| F8 | `voice.*` phrases in both languages use plural forms for metres and steps; Spanish `voice.distance` uses "Falta/Faltan" with the form. Number words come from `voice/numbers.ts`. `EN_LEXICON` coverage of every English voice phrase is already tested (`voice.test.ts`). | No change. |
| F9 | Spanish "al {dir}" and "hacia el {dir}" agree with all eight compass words (all masculine, including "noreste"). | No change. |
| F10 | "gema" (feminine) agrees everywhere; `safety.avoidIgnored` "la usa/las usa" agrees with "calle(s)". | No change. |
| F11 | Spanish plural edge cases: 0 is plural ("0 pasos"), 1 singular, decimals plural ("1,5 metros"). Step counts stay below 60,000 and metre values below 1,000, so no "millón de" case occurs. | Tested (65.4, P-I3). |
| F12 | The plural count of a string variable was read by deleting every non-digit, which turned "0,01" into 1 and "1,5" into 15. | Bug B4. |
| F13 | Switching language updates all React text, dialogue lines and bubbles (computed on each render with the current `t`). The quest screen has no language control, so the switch happens in Settings or after a reload. Phrases queued before a switch stayed in the old language and callouts were not pre-rendered in the new one. | Bug B8. |
| F14 | Unit symbols ("km", "m", "min", "MB") are the same in both languages. "km" was typed next to the number in four places. | Moved into the formatter (B3). |

### Bugs

Each has a regression test (task 65).

| Id | Where | Problem | Test |
| --- | --- | --- | --- |
| B1 | `App.tsx` result box, stride hint, `result.short`, loading size | Distances, percentages and megabytes used `toFixed`, so Spanish showed "7.50 km", "1.2%" and "0.4 MB" with a point. | `format.test.ts`; `App.test.tsx` (Spanish plan: `7,50 km`, `1,2 % vs objetivo`, stride hint) |
| B2 | `ResultBox` | `route.error >= 0 ? '+' : '−'` printed "−0.0%" for a tiny negative error. | `format.test.ts` (`formatSignedPercent`) |
| B3 | `QuestScreen.fmtDistance`, `App.tsx` | `fmtDistance` tested `m < 1000` before rounding, so 999.6 m showed as "1000 m"; "km" was typed in JSX and in dictionary text. | `format.test.ts` (`formatDistance(999.6)` is "1,00 km"), source scan |
| B4 | `locale.ts` `countOf` | "0,01" counted as 1 ("0,01 metro") and "1,5" as 15. | `i18n.test.ts`, P-I3 |
| B5 | `es.ts` | `safety.added` "Añadida {name}." disagreed with masculine street names ("Añadida Camino de Vera"). | `copy.test.ts` |
| B6 | `es.ts` | Percent spacing was mixed in one language ("5%", "5 %", "±5 %", "{pct}%"). | `copy.test.ts` |
| B7 | `locale.ts` `detectLocale` | Only `navigator.language` was read, so a visitor with ["ca", "es"] got English, and any code that starts with "es" (such as "est") counted as Spanish. | `i18n.test.ts` |
| B8 | `useQuestRunner.ts`, `I18nProvider`, `index.html` | After a language change the voice queue kept old-language phrases and callouts were not pre-rendered in the new language. The page title and description stayed English. | `useQuestRunner.test.tsx`, `I18nProvider.test.tsx`, `App.test.tsx` |

### Design after the review

- **Typed `t`.** `Translate` (in `en.ts`) reads the placeholder names of `typeof en[K]` with a template-literal type (`{n}` and `{n|one|other}` both give `n`) and requires exactly that object. A key without placeholders takes no variables. `PlainKey` is the set of such keys, for lookup tables (tabs, FAQ, onboarding screens, volume labels). `calloutText` is the one cast: each voice key takes a different subset of the callout's variables, and `callouts.test.ts` checks that no placeholder is left.
- **Formatting.** `i18n/format.ts` is the only place that turns numbers into text for people: `formatNumber`, `formatDecimal`, `formatKm`, `formatDistance`, `formatSignedPercent`. They use `toLocaleString(locale)` with fixed fraction digits and no grouping for decimals, and map `NaN`, infinities and "-0" to zero. Units are part of the formatted value, not of the dictionary text.
- **Plural count.** `countOf` reads a string by its shown value: digits only is an integer, groups of three after a separator ("1.000", "1,234") are thousands, a separator followed by other digits is a fraction.
- **Language switch.** `I18nProvider` sets `lang`, `document.title` and the description meta tag in one effect (`meta.title`, `meta.description`). The runner compares the locale with the one it last spoke, and on a change while a session exists calls `stopVoice()` and re-warms the callouts.
- **Scans.** `sourceScan.test.ts` parses every non-test source file with `rolldown/parseAst` (the parser Vite ships; TypeScript 7 has no JavaScript API) and fails on text in JSX, in the text attributes, between tags as a string expression, or assigned to `document.title`. It also fails on `toFixed` (three files are allowed, for coordinates and query boxes) and on `toLocaleString()` without a locale. `fit.test.ts` holds the 390 px geometry as constants with the CSS values they come from. `copy.test.ts` holds the typing tests, copy rules and the dead-key check.

### Wording changes (Spanish unless noted)

| Key | Before | After |
| --- | --- | --- |
| `safety.added` | Añadida {name}. | Calle añadida: {name}. |
| `result.vsTarget` | {sign}{pct}% vs objetivo | {sign}{pct} % vs objetivo (no-break space) |
| `hero.progress` | {pct}% del objetivo de hoy | {pct} % del objetivo de hoy (no-break space) |
| `info.a.route` | … a menos de un 5% de tu objetivo … | … a menos de un 5 % de tu objetivo … (no-break space) |
| `error.noMatch`, `onboarding.1.body` | ±5 % and 5 % with a plain space | the same with a no-break space |
| `meta.title`, `meta.description` (new) | Page title and description only in English in `index.html` | English text unchanged. Spanish: "{app} — tus pasos, como una aventura de 8 bits" and "{app} convierte tu objetivo diario de pasos en una aventura de 8 bits por calles reales." |

English copy is unchanged. Spanish numbers change shape: "7.50 km" is now "7,50 km" and "1.2%" is now "1,2 %".

### Properties added

- **P-I3 Plural by value.** A formatted count (`formatNumber`) picks the same plural form as the number, and a formatted fraction is always plural.
- **P-I4 Decimal formatting.** `formatDecimal` always shows the requested digits with the locale separator, never `-0` or `NaN`, and stays within half a unit of the last digit of the input.

### Open points

- The web manifest stays English (F5). A per-language manifest would need two files and a swap at load, which the app does not do today.
- English selects the singular for a count of exactly 1.0 shown with a decimal ("1.0 meter"); no such text exists today.

## App shell review (Nov 2026)

Scope: `src/App.tsx` (955 lines), `src/ui/**`, `src/index.css`, `src/main.tsx`, `public/manifest.webmanifest`, `index.html`. Cross-references: [quest](../quest/design.md) (resume, finish, wake lock) and [map-rendering](../map-rendering/design.md) (`MapView`, data loading). Method: read the code, list suspected bugs, write a failing test for each (`src/AppShell.test.tsx` and friends), then fix (task 67). There was no service worker before this review, so "update prompt of the PWA" had nothing to review; it is added (F15).

### Findings

| Id | Finding | Outcome |
| --- | --- | --- |
| F1 | `App.tsx` held 40 `useState`s, three async flows and every tab's markup in one function. Handlers closed over stale state (`plan`, `loadLiveAround`, `locateMe` through a `locateRef` patch). | Typed reducer, `latest` ref, hooks, components (67.2, 67.3). |
| F2 | Every keystroke in the step field re-rendered `MapView` (new `onTap`, `onLocate`, `onView` closures) and so ran its effects. The quest screen did the same on each one-second clock tick. | `MapView` is `memo`; stable callbacks (B7, B8). |
| F3 | "Plan quest" had no guard against a second press before the first state update, and nothing marked a request as stale when the inputs changed. | Request tokens in the reducer (B1, B3). |
| F4 | `plan` had no `catch`: a worker error left the button on "Planning…" for good. | B2. |
| F5 | The bundled map load had no `catch`: a failed chunk showed "Building the overworld…" forever. A saved live quest whose map failed to load was silently skipped. | B4, B5. |
| F6 | `stepsToday` was read once per page load, so "Steps today" stayed old after a night or after the app came back from the background. `now` for sunrise was fixed per visit. | `useToday` (B6). |
| F7 | `window.confirm` ends a quest: blocked in some in-app browsers and installed apps, unstyled, not translatable beyond the message. | `ConfirmDialog` (B13). |
| F8 | Onboarding handled keys on its own panel only; a click on the dimmed backdrop moved focus out and Escape, arrows and Tab stopped working. The app behind it stayed tabbable and readable. | `useModal`, `inert` (B15). |
| F9 | The quest-complete screen was `role="dialog"` without a name and did not take focus. | `CompleteDialog` (B12). |
| F10 | The dialogue box had `aria-live` on text that grows one letter every 28 ms, so a screen reader would read letters. | Whole-line status region (B14). |
| F11 | `aria-controls` pointed at ids that do not exist while a pop-up or list is closed (Info, Sound, search). Escape closed the pop-ups but dropped focus to the page. `aria-label` on the start/finish group without a role. Preset and place buttons showed their state by colour only. | B9, B10, B11, B16. |
| F12 | Effects with cleanup are fine: map input, resize observer, timers, wake lock and quest listeners all clean up. `useLiveLoader` keeps one request at a time. No leaks found. | No change. |
| F13 | Layout at 320 px: the header (logo 18 px, avatar, steps pill) was 417 px wide and the pill stuck out of the screen; at 390 px the pill ran 27 px over. Phone on its side: map 160 px, planner 143 px high with the plan button below the fold. Portrait-only manifest. Safe-area insets were present on top, bottom, left and right of the header, tab bar, sheets and quest screen. | Fixed (67.8). |
| F14 | Colour contrast measured against the paper background: hint 7.9, accent text 6.2, error 5.7, good 4.8, warning 6.3, footer on ink 5.4, tagline on navy 8.7, gold on navy 7.5. All at least 4.5:1. | No change. |
| F15 | No service worker, no offline note, no update flow. | 67.9. |
| F16 | No error boundary: a render error white-screened the app. | 67.7. |
| F17 | Dead CSS: `.box-sub`, `.topbar-tools`, and 20 earlier declarations in `.app`, `.topbar`, `.logo`, `.tagline`, `.layout`, `.map-wrap`, `.map-buttons`, `.box`, `.presets`, `.chip`, `.quest`, `.hud`, `.hud-top`, `.hud-buttons`, `.dialog`, `.complete-box`, `.avatar`, `.steps-pill`, `.planner-row`, `.tab.on .tab-icon` that a later rule of the same selector always overrode. | Removed (67.10). |
| F18 | State that must survive a reload: settings, avoid list, look, onboarding flag, locale, quest and daily steps are stored. State that should not: route and plan, planner fold, active tab, simulate options, picked street note; all reset, as intended. The avoid list was saved inside event handlers (and twice in `onTap`); it is now saved by one effect. | Kept; B-free. |

### Bugs

| Id | Where | Problem | Regression test |
| --- | --- | --- | --- |
| B1 | `plan` | Two presses in one frame sent two requests. | `AppShell.test.tsx` B1 |
| B2 | `plan` | A throwing planner left "Planning…" on. | B2 |
| B3 | `plan` | An answer arriving after the mode changed still set the route. | B3, reducer P-A1, P-A3 |
| B4 | start-up | A failed demo load showed the loading text forever. | B4 |
| B5 | start-up | A saved live quest on an unreachable map vanished without a word. | B5 |
| B6 | header | "Steps today" never refreshed. | B6, `shellCss.test.ts` (midnight timer) |
| B7 | `MapView` | Typing redrew the map controls on every key. | B7 |
| B8 | `QuestScreen` | The clock tick redrew the map controls every second. | B8 |
| B9 | planner | `aria-label` on a plain `div` (start/finish switch). | B9 |
| B10 | Info, Sound, avoid search | `aria-controls` to a missing id. | B10 |
| B11 | Info, Sound | Escape lost focus. | B11 |
| B12 | quest complete | Dialog without name or focus. | B12 |
| B13 | quest HUD | Browser `confirm`. | B13, `modal.test.tsx` |
| B14 | dialogue box | Live region on typed text. | `DialogueBox.test.tsx` B14 |
| B15 | onboarding | Keys died after a click on the backdrop; the app behind was reachable. | B15, `modal.test.tsx` |
| B16 | planner | State by colour only. | B16 |

### Target structure

```
App.tsx                 layout and wiring (about 310 lines)
app/appState.ts         AppState, AppAction, appReducer (pure)
app/useAppState.ts      useReducer plus `latest`, the newest state for handlers and async code
app/usePlanner.ts       PlanClient, plan (one at a time, token checked), reroute for the quest runner
app/useArea.ts          world, boot or resume, live loading, "use my location", auto-load of the area under the view
app/useNumberFields.ts  raw text of the step and stride fields
app/useToday.ts         steps today and "now", refreshed on show, storage and midnight
app/useOnline.ts        navigator.onLine as an external store
pwa/                    sw.template.js, updateStore.ts
ui/                     AppHeader, PlannerPanel, BagContent, HeroContent, SettingsContent, MapBanners, Sheet,
                        ResultBox, SafetyNotice, FieldNote, LocateMessage, ConfirmDialog, CompleteDialog,
                        ErrorBoundary, UpdateBanner, useModal, useDismiss
```

### Design decisions

- **Reducer and tokens.** `plan: { status, token, seed }`. `clearPlan` runs on every input change: it drops the route and increases the token. `planStart` is ignored while `status` is `running`. `planDone`, `planFailed` and `planCancelled` apply only when their token equals the current one and the status is `running`. This makes the three plan bugs one rule, and the reducer is pure, so property tests cover it. `useAppState` keeps `latest` by applying the reducer a second time inside `dispatch`; the reducer is pure, so this is safe, and it lets a handler see a dispatch from the same event.
- **No-op actions return the same state object.** Setting a setting to its current value, switching to the tab already shown and so on do not clear the route or re-render.
- **Fields.** Number-field text stays local to `useNumberFields` (typing is not app state); usable values flow into `settings` while typing. Plan validates the text first, then reads `latest`.
- **World outside the reducer.** `World` (graph, grid, OSM data) is large and not plain data. `useArea` keeps it in `useState` plus a ref.
- **Modals.** `useModal(panel, { onEscape, onKey })` listens on the document, so it works after focus left the panel. Tab wraps; with no focusable element it keeps focus on the panel. Focus goes to `[data-autofocus]` or the panel and returns to the previous element on close. `ConfirmDialog` focuses the safe answer. The onboarding is rendered beside `.app`, which gets `inert` while it is open.
- **Error boundary.** A class component outside `I18nProvider`; it takes the language from `detectLocale()` and the dictionaries directly, so a broken provider cannot break it. It logs to the console only. It touches no storage. "Try again" re-renders, "Reload" reloads, and a saved quest resumes on boot.
- **Layout.** Under 430 px the logo is 13 px with a 22 px mark; under 360 px the header avatar is hidden (the Hero tab shows it). On a short landscape phone the layout is a row: map left, planner right (up to 420 px), slim header, tab labels beside their icons, left inset applied. On screens up to 700 px high the plan row sticks to the bottom of the scrolling planner. Wide screens keep the existing rail and 400 px column.
- **Service worker.** `vite.config.ts` emits `sw.js` from `src/pwa/sw.template.js` with the list of built files and a build id (hash of the file list and `index.html`). Same-origin GETs only; Overpass requests are never intercepted. Pages: network first, cached shell when offline. Assets: cache first. A new worker waits; `UpdateStore.apply()` posts `skip-waiting` and the page reloads once on `controllerchange`. The prompt sits in the planning screen only, so a quest is never reloaded by surprise. The first install is not an update (`controller` is null). The registration runs in production builds only. It is not tested in a browser here; the store and the worker's rules are unit-tested with fakes.
- **Coordinates.** `geo/coords.ts` owns `toFixed` for coordinates (the one allowed place, see the source scan).

### Visible changes (the look and flow Ilias approved stay)

- Ending a quest opens a pixel dialog ("End this quest?", "Keep walking" / "End quest") instead of the browser box. Spanish: "Seguir andando" / "Terminar misión".
- Narrow phones: smaller logo in the header; below 360 px the small avatar leaves the header.
- Phones on their side: map and planner side by side.
- Short portrait screens: the Plan button stays at the bottom of the planner while it scrolls.
- New messages: planner failure, map failure with "Try again", saved-quest notice, offline note, update prompt, crash screen. The tab and planner look is unchanged.
- The installed app can rotate.

### Properties

- **P-A1** A route never outlives a change of its inputs (start, finish, settings, avoid list).
- **P-A2** A request is running only after `planStart`, and a running request keeps its token.
- **P-A3** An answer with another token changes nothing (same object returned).
- **P-A4** The state stays valid after any action sequence: a real tab, an avoid list within bounds, `placing` is `start` or `end`.

### Tests

`AppShell.test.tsx` (bug regressions through the whole app, with render counting through a wrapped `PixelIcon` that only `MapView` draws), `app/appState.test.ts` (reducer and properties, fixed seed `20261204`), `ui/modal.test.tsx`, `ui/ErrorBoundary.test.tsx`, `ui/shellCss.test.ts` (safe areas, landscape rules, dead rules, dead classes), `pwa/updateStore.test.ts` (update flow and worker rules), `geo/coords.test.ts`. `scripts/check-layout.mjs` measures the seven screen sizes in Chrome; `scripts/screenshot-retro.mjs` still passes.

### Open points

- Safe-area insets cannot be emulated by headless Chrome; the CSS is checked by text, not on a device.
- The service worker is built and linted but was not run in a browser during this review.
- Onboarding, Info and Sound pop-ups are not yet announced to screen readers when they open beyond the dialog role (focus moves into onboarding; the pop-ups keep focus on their button).

## Hero look review (Nov 2026)

Scope: `src/hero/look.ts`, `useLook.ts`. Requirement 15, tasks 69.8 to 69.10.

### Findings

| Id | Finding | Fix |
| --- | --- | --- |
| B7 | `JSON.parse('{"skin":-0}')` gives `-0`, which passed `Number.isInteger(i) && i >= 0` and stayed `-0`. `toEqual` and `Object.is` see it as not `0`. | `i + 0`. |
| B8 | `walkerFor` made its cache key from the repaired look but built sprites from the raw one. A look typed loosely (`shirt: '2'` indexes the palette as `PALETTES.shirt['2']`, or `body: 'robot'`) cached sprites for the wrong colours under the default key, so the default walker changed colour for the rest of the session. | `walkerFor` and `lookColors` repair first. |
| B9 | `setLook` stored the object it was given; only the saved copy was repaired, so memory and storage disagreed until the next start. | `setLook` stores `normalizeLook(look)`. |

Checked and correct: corrupt JSON, a throwing `getItem`, `null`, arrays and primitives all give a valid look (property test over `fc.jsonValue()`). Each part is repaired alone: a bad cap leaves the shirt as chosen.

Open points, not changed: the sprite cache is not bounded (at most 2 × 6 × 7 × 8 × 8 × 6 = 32 256 looks, only the ones shown are built); another tab's change is not seen until reload (no `storage` listener); the saved look has no version, so reordering a palette later would change colours silently (add a version then).

Tests: `look.review.test.ts`, `useLook.test.ts`.

## Quest bottom bar fit (task 70, requirement 16)

Field bug (iPhone, 390 px, Spanish): "Terminar" left the console frame. Cause: the folded bar was a single non-wrapping flex row (stats `flex: 1` with `1fr` columns, round buttons `flex: none`, End button with 20 px side padding at 10 px), and grid `1fr` columns and flex children had an implicit `min-width: auto`.

Fix, all in `src/index.css`: the folded bar wraps; the readout is `flex: 1 1 100px` with `minmax(0, 1fr)` columns and takes its own row when the buttons need the space; `.hud-buttons` wraps and has `min-width: 0`; its text buttons use `flex: 1 1 0`, 8 px side padding and `font-size: clamp(9px, 2.6vw, 10px)`; `.pix-btn` has `max-width: 100%`. Folded bar padding is 8 px 10 px.

Geometry used by the test (`src/ui/hudFit.test.ts`): HUD content width = viewport - 2 x (6 + 3 + 8 + 10 + 4 + 10) = 238 px at 320 px. Spanish "Terminar" at 9 px is 72 px; with two 48 px round buttons and gaps it needs 212 px. Other rows (confirm, crash, onboarding, planner actions) already wrap with `flex-wrap`; the test covers their Spanish labels.
