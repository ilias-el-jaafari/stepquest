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
