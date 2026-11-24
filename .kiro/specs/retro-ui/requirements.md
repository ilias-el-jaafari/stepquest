# Retro UI: Requirements

Part of the StepQuest specs; see [../README.md](../README.md) for the introduction, glossary and index. Requirement ids are kept from the original single spec so history stays traceable.

Related: [quest](../quest/requirements.md) (HUD content), [voice-audio](../voice-audio/requirements.md) (sound menu).

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
