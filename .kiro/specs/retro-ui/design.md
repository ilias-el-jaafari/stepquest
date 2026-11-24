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

## Correctness properties (task 57)

Checked with fast-check in `src/i18n/i18n.property.test.ts` (fixed seed `20261204`). Requirement ids refer to this folder, plus 6a.6 in map-rendering for plurals.

- **P-I1 Parity.** Every English key has a Spanish twin (and the reverse), with the same placeholder names and the same set of plural placeholders (`{n|one|other}`), and no stray braces remain outside placeholder syntax. Exhaustive over the dictionaries. Validates 5.3, 8.1 and map-rendering 6a.6.
- **P-I2 Interpolation is total.** For random values of every placeholder name (counts including negative, huge, NaN and infinite; formatted numbers such as `10.000`; free text with `$&` and `#`), `interpolate` never throws and leaves no supplied `{placeholder}` unfilled in any message of either language. The plural form follows the count (`1` selects the singular, everything else the plural, `#` is replaced by the value), and a missing variable leaves exactly its own placeholder. Validates 5.3, 8.1.
