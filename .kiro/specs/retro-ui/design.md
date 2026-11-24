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
