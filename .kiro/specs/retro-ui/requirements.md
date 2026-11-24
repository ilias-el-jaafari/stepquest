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

### Requirement 8: Engineering

1. THE SYSTEM SHALL keep domain logic in pure, unit-tested TypeScript and run all tests offline.
2. THE SYSTEM SHALL keep the product name in one constant.
