# Retro UI: Requirements

Part of the StepQuest specs; see [../README.md](../README.md) for the introduction, glossary and index. Requirement ids are kept from the original single spec so history stays traceable.

Related: [quest](../quest/requirements.md) (HUD content, resume after reload), [map-rendering](../map-rendering/requirements.md) (map view, data loading), [voice-audio](../voice-audio/requirements.md) (sound menu).

## Requirements

### Requirement 5: Interface

#### Acceptance Criteria

1. THE SYSTEM SHALL let the user set the start (and, for A→B, the finish) by tapping the map, choose the mode, the step goal (typed, with presets and a slider; 100–60,000 steps) and the stride, and press one button to plan. Number fields SHALL accept free typing and SHALL only validate and clamp on blur, Enter or Plan, with an inline hint when a value is out of range.
2. THE SYSTEM SHALL show distance, estimated steps, the difference from the goal, the checkpoint count, an estimated walking time, and a feasibility message.
3. THE SYSTEM SHALL work on a 390 px wide phone and on desktop, in English and Spanish, and remember the user's settings.

### Requirement 5b: Handheld-console buttons

**User Story:** As a walker, I want every button to look and feel like a chunky handheld-console button, so that the whole app reads as one retro game and is easy to hit while walking.

#### Acceptance Criteria

1. THE SYSTEM SHALL draw every text action as a pill button and every icon action as a round button, with a thick dark outline, stepped pixel corners (no `border-radius`), a saturated fill, a light bevel on the top and left edges and a dark bevel on the bottom and right edges.
2. WHEN a button is pressed, THE SYSTEM SHALL invert its bevel and move its label or icon down 2 px, and SHALL NOT move the button box.
3. THE SYSTEM SHALL draw the icons for zoom in, zoom out, fit, home, recenter, sound on, sound off, play, pause and menu as original pixel art made of crisp SVG rectangles, and SHALL NOT use icon fonts or external images.
4. THE SYSTEM SHALL use the same button family on the planner, the map controls, the quest HUD, the Bag, Hero and Settings tabs, the sound and info menus and the dialogs.
5. THE SYSTEM SHALL keep a press area of at least 48 px on both axes for every button, an accessible name for every icon-only button, a visible `:focus-visible` outline, and a label colour with a contrast of at least 4.5:1 on its fill.
6. WHERE the user prefers reduced motion, THE SYSTEM SHALL show the pressed state without any transition.

### Requirement 5c (task 67, Nov 2026 review): A dependable app shell

**User Story:** As a walker using the app on a phone for weeks, I want the screens around the map to stay correct when I tap fast, lose signal, turn the phone, or leave the app open overnight, so that I never meet a stuck button, a blank screen or yesterday's numbers.

#### Acceptance Criteria

1. WHEN the user presses "Plan quest" twice before the first answer arrives, THE SYSTEM SHALL send one planning request.
2. WHEN the user changes the mode, the step goal, the stride, the start or finish, or the avoid list while a request is out, THE SYSTEM SHALL drop that request's answer and SHALL NOT show a route that no longer matches the inputs.
3. IF the planner fails or throws, THEN THE SYSTEM SHALL leave the "Planning…" state, show a translated message and allow another try.
4. IF the bundled map cannot be built at start-up, THEN THE SYSTEM SHALL show a translated message with a "Try again" button instead of "Building the overworld…" forever.
5. IF a saved quest belongs to a live map that cannot be loaded, THEN THE SYSTEM SHALL keep the saved quest and tell the user why it is not shown.
6. WHEN the app returns to the foreground, another tab changes the stored total, or local midnight passes, THE SYSTEM SHALL read "steps today" again.
7. WHEN a text field or a clock changes state, THE SYSTEM SHALL NOT redraw the map view (its props are stable).
8. THE SYSTEM SHALL ask "End this quest?" in a dialog of its own style (`role="alertdialog"`, safe answer focused first, Escape means no) and SHALL NOT use the browser's `confirm`.
9. WHILE a modal dialog is open (onboarding, end-quest question, quest complete), THE SYSTEM SHALL keep Tab inside it, move focus into it, return focus to the previous element on close, and react to Escape wherever focus is. WHILE the onboarding is open, the app behind it SHALL be `inert`.
10. WHEN the Info or Sound pop-up closes with Escape while focus is inside it, THE SYSTEM SHALL put focus back on the button that opened it. `aria-controls` SHALL only point at an element that exists.
11. THE SYSTEM SHALL announce each dialogue line once and whole (a status region), and SHALL hide the letter-by-letter copy from screen readers.
12. THE SYSTEM SHALL mark the quest-complete screen as a named modal dialog and the preset and start/finish buttons with `aria-pressed`.
13. IF a render error occurs, THEN THE SYSTEM SHALL show a friendly English or Spanish message with "Try again" and "Reload", SHALL NOT show the raw error, and SHALL NOT delete the saved quest or settings.
14. THE SYSTEM SHALL fit without sideways scrolling and keep the "Plan quest" button reachable at 320×568, 390×844, phones on their side (844×390, 568×320), tablets, desktop and 2560 px wide screens, and SHALL keep notch and home-bar insets on every edge. The header SHALL fit at 320 px.
15. THE SYSTEM SHALL NOT lock the installed app to portrait.
16. THE SYSTEM SHALL keep the app shell and the bundled demo map working offline once visited (service worker), SHALL show a note while the browser is offline, and WHEN a new version is ready SHALL offer an "Update" button on the planning screens and SHALL NOT reload by itself.
17. THE SYSTEM SHALL keep `App.tsx` to screen layout and wiring: state transitions in a typed, pure reducer with property tests; presentational components under `src/ui`.

### Requirement 9: Onboarding and logo

**User Story:** As a first-time visitor, I want a short, skippable introduction and a recognisable logo, so that I understand what the app does in under half a minute and can start walking.

#### Acceptance Criteria

1. WHEN the app opens and the onboarding has never been completed or skipped on this device, THE SYSTEM SHALL show an onboarding dialog of exactly three screens: choose your distance (step goal or stride, loop or A→B on real streets within ±5 %), follow the gems (numbered gems in order, voice and speech bubbles, rerouting when leaving the route) and safe by default (lit, lively streets with sidewalks, lighting counting more from sunset, always on, streets to avoid still available).
2. THE SYSTEM SHALL show every onboarding screen in the active language (English or Spanish), with a small original pixel illustration drawn in code, a step indicator, a Skip button on every screen, a Back button from screen 2, and a Next button that becomes "Start" on screen 3.
3. WHEN the user presses Skip, presses Escape, or presses Start, THE SYSTEM SHALL close the onboarding and store a flag in `localStorage` under `stepquest.onboarded`, and SHALL NOT show the onboarding again on later visits.
4. THE SYSTEM SHALL offer a "Show intro" button in the Settings tab that reopens the onboarding at screen 1 at any time.
5. THE SYSTEM SHALL expose the onboarding as a modal `role="dialog"` with an accessible name, move focus into it when it opens, keep Tab inside it, return focus to the previous element when it closes, and support the keyboard: Escape skips, ArrowRight goes to the next screen, ArrowLeft to the previous one, and Enter on the dialog (not on a button) goes forward or starts.
6. THE SYSTEM SHALL give every onboarding button a press area of at least 48 px on both axes, take every text from `src/i18n` with the same keys in English and Spanish, and WHERE the user prefers reduced motion, SHALL show no screen transition animation.
7. THE SYSTEM SHALL draw an original pixel-art logo (a gem on a path) in code from a pixel grid, show it with the product name in the app header and on the first onboarding screen, and use the same grid to build the favicon and the home-screen icons. The logo SHALL NOT use external images or fonts other than Press Start 2P.
8. IF `localStorage` is unavailable, THEN THE SYSTEM SHALL still show the onboarding once per page load and SHALL NOT throw.

### Requirement 8: Engineering

1. THE SYSTEM SHALL keep domain logic in pure, unit-tested TypeScript and run all tests offline.
2. THE SYSTEM SHALL keep the product name in one constant.
3. THE SYSTEM SHALL take every user-facing text (visible text, `aria-label`, `title`, `alt`, `placeholder`, the page title and the page description) from `src/i18n`, with the same keys and the same placeholder names in English and Spanish. The only literals allowed in JSX are the language names "Español" and "English", each written in its own language.
4. THE SYSTEM SHALL check translation keys and their variables at compile time: WHEN code calls `t` with an unknown key, a missing, misspelled or extra variable, or variables for a key that has none, THE BUILD SHALL fail.
5. THE SYSTEM SHALL write numbers with the separators of the active language: a decimal comma in Spanish and a decimal point in English for distances, percentages and megabytes, and the grouping of `toLocaleString` for counts. Coordinates typed or shown as latitude and longitude SHALL keep the decimal point in both languages, because that is what the field parses.
6. THE SYSTEM SHALL show distances under one kilometre in metres and from one kilometre in kilometres with two decimals, and SHALL NOT print `NaN` or `-0` for any numeric input.
7. WHEN a variable that selects a plural form is a formatted string, THE SYSTEM SHALL choose the form by the value the string shows ("10.000" is ten thousand, "0,01" is a fraction, "1" is one), so that a count of one gets the singular and a fraction gets the plural in both languages.
8. THE SYSTEM SHALL write a percentage as "5%" in English and as "5 %" with a no-break space in Spanish, and SHALL NOT put a gendered word before a variable that can be a street name (OpenStreetMap names can be masculine or feminine).
9. WHEN the browser offers a list of preferred languages and the user has not chosen one, THE SYSTEM SHALL use the first entry that is English or Spanish, and English if there is none. The language the user chose SHALL always win and SHALL be remembered.
10. WHEN the language changes, THE SYSTEM SHALL update the `lang` attribute of the page, the page title and the page description together with the interface, WHILE a quest is running THE SYSTEM SHALL drop speech queued in the previous language and pre-render the common callouts in the new one, and every later callout, speech bubble and dialogue line SHALL be in the new language.
11. THE SYSTEM SHALL keep every tab label and every word of a button label inside its control on a 390 px wide screen with the pixel font, in both languages, and an automated check SHALL fail when a new label is too long.
12. THE SYSTEM SHALL NOT show raw error text from the network, the map servers, the location service or a worker to the user; each failure SHALL map to a code with a translated message.
13. THE SYSTEM SHALL have no translation key that no code uses.

### Requirement 15 (task 69): Hero look

**User Story:** As a walker, I want my chosen walker to come back as I left it, and never to break the map, whatever my browser has stored.

#### Acceptance Criteria

1. WHEN the saved look is missing, is not JSON, is not an object, or holds an unknown body or a palette index that is not a whole number inside its palette (negative, too large, fractional, `-0`, text), THE SYSTEM SHALL use the default for each bad part, keep the good parts, and SHALL NOT throw.
2. THE SYSTEM SHALL keep only a repaired look in memory and in storage, so every screen shows the same walker the next start shows.
3. THE SYSTEM SHALL build and cache the walker's sprites from the repaired look, so that a look with invalid parts cannot put wrong sprites under another look's cache key.
4. WHEN storage is unavailable or full, THE SYSTEM SHALL keep the chosen look for the session.

### Requirement 16 (task 70): Bottom bar and button rows fit every phone

**User Story:** As a walker on any phone, I want every button in the quest bar and in the dialogs to stay inside its frame in my language, so that I can always tap End.

#### Acceptance Criteria

1. WHEN the viewport is 320 to 430 px wide, THE SYSTEM SHALL keep the walked/steps readout, the fold button, the sound button and the End button of the quest bottom bar inside the console frame, in English and in Spanish, without changing the wording.
2. WHEN the bar is too narrow for one row, THE SYSTEM SHALL wrap the readout onto its own row, and SHALL shrink the text button's label to no less than 9 px before anything leaves the frame.
3. THE SYSTEM SHALL let every flex child of a button row shrink (`min-width: 0`) and SHALL cap `.pix-btn` at the width of its container.
4. WHEN a button row of the planner, a dialog or the complete screen is shown in Spanish at 320 px, THE SYSTEM SHALL fit each word of every label, and an automated check SHALL fail when a label or a rule regresses.
