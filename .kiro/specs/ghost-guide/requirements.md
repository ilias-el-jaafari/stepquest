# Ghost guide: requirements

## Introduction

Floor Mesters (UX, Kiro) judged: "Scare me, then make it easy. I want an interface with a little mischief in it, like a ghost that guides me or an error message that makes me laugh. If I smile and still know what to tap next, you've won me over."

StepQuest gets a small original pixel ghost, **Wisp**. It hosts the first-run intro, comments on gems, celebrates the finish, gives a friendly scare at night and, above all, **paces the walk**: during a quest it floats ahead along the planned route at a brisk-walk pace, and the HUD says how the player is doing against it. Part A of the same change makes the hero's own motion smooth (requirement 6g of [quest](../quest/requirements.md)); the ghost reuses that route-progress model.

## Glossary

- **Wisp**: the ghost guide (our own design, see `visual-style.md`).
- **Pace point**: the place on the route a walker at the target pace would have reached, `pace × elapsed`.
- **Gap**: hero progress along the route minus the pace point, metres (positive = hero ahead).
- **Pacer clock**: elapsed quest time, at the simulator's time scale in simulated walks, frozen while paused.

## Requirements

### Requirement G1: The ghost is original and cheap

1. THE SYSTEM SHALL draw Wisp in code as 16×16 character-grid sprites (a rounded sheet with a wavy hem, two eyes, a blush and a small lantern), in its own colours, with nothing taken from or resembling a character of another game.
2. THE SYSTEM SHALL have four frames: two floating frames (the hem wave alternates every 320 ms), a happy frame and a "boo" frame, each pre-rendered once to an offscreen canvas and then only blitted. The map's scene cache and dirty rendering SHALL stay as they are: the ghost is part of the overlay, never of the scene.
3. WHEN the light is dark, THE SYSTEM SHALL give the lantern a small, faint warm glow (half the walker's strength).
4. THE SYSTEM SHALL draw the face as two separate 2×2 ink eyes (columns 4–5 and 9–10, rows 4–5), a clear row with a pink blush on each cheek, and a one-pixel mouth below, so it never reads as a "+" (a test checks it). The "boo" frame has a 3×2 open mouth; the happy frame a small smile.
5. THE SYSTEM SHALL draw Wisp on the map 1.5 times the size of a tile sprite (`GHOST_SCALE`), so it reads next to the hero.

### Requirement G2: First-run intro (three taps)

1. WHEN the app opens for the first time on a device, THE SYSTEM SHALL show a three-screen intro hosted by Wisp: (1) pick a start, (2) set a goal or a finish, (3) press plan.
2. THE SYSTEM SHALL let the player skip it at any moment, SHALL remember in `localStorage` (`ONBOARDING_STORAGE_KEY`) that it was seen or skipped, and SHALL NOT show it again by itself.
3. THE SYSTEM SHALL offer it again from Settings ("Show intro").
4. THE SYSTEM SHALL keep the modal behaviour of the existing intro (focus in, Tab trap, Escape, focus back, arrow keys, the app behind is inert). Wisp pops in with a "Boo!" on the first screen; with reduced motion nothing moves.

### Requirement G3: Gem comments

1. WHEN a gem is collected, THE SYSTEM SHALL show one short line from Wisp (a bubble with its face in the HUD) for about 3.5 s, in English or Spanish, chosen from five variants by the quest seed so that two gems in a row never repeat; the gem before the flag has its own line.
2. THE SYSTEM SHALL keep the finish line out of the HUD: it belongs to the summary (G4).

### Requirement G4: Finish celebration

1. WHEN the quest summary of a finished quest opens, THE SYSTEM SHALL show Wisp next to the hero, happy, spinning and surrounded by three twinkling pixel sparkles, with a caption line. The paused summary shows a calm Wisp without sparkles or caption.
2. WHEN the player prefers reduced motion, THE SYSTEM SHALL show Wisp still and without sparkles.

### Requirement G5: Friendly night scare

1. WHEN the quest's light (the demo's day cycle, `?time=` or the real time at the walker's place) first reaches dusk or night, THE SYSTEM SHALL play, once per quest, "Boo!" ("¡Bu!") as a quick pop of Wisp's face and its "boo" pose on the map, and 1.5 s later the line "Don't worry, this way has street lamps." ("Por aquí hay farolas.").
2. THE SYSTEM SHALL make no sound for it and SHALL NOT use a sudden movement across the screen. With reduced motion the line shows without the pop.

### Requirement G6: Ghost pacer

1. THE SYSTEM SHALL compute the target pace as 5.0 km/h by default (about 110 steps a minute at a 0.75 m stride, scaled by the stride setting), or distance over the suggested duration when a duration is given, kept between 3 and 7 km/h.
2. THE SYSTEM SHALL show the pace in the planner summary once a route is ready ("Ghost pace: 5.0 km/h · ~110 steps/min" / "Ritmo fantasma: 5,0 km/h · ~110 pasos/min"), with the steps per minute rounded to 5.
3. WHILE a quest runs, THE SYSTEM SHALL draw Wisp on the planned route at `pace × elapsed` plus a lead of 6 m (so it is never hidden under the hero and shows next to it from the first second), mirrored when it heads left, never past the finish, never going back along the route.
4. THE SYSTEM SHALL run the pacer clock at the simulator's time scale in simulated walks and in the demo, and SHALL freeze it while the page is hidden, before the first fix of a real walk and once the quest is finished. A resumed quest starts with Wisp where the hero is. When the rest of the route is recalculated, Wisp keeps its gap to the hero.
5. THE SYSTEM SHALL show the status in the HUD as a bubble with Wisp's face and in a polite live region: "You are ahead of the ghost!", "Keeping the ghost's pace" or "Falling behind... the ghost is waiting for you!" (Spanish: "Vas por delante del fantasma", "Al ritmo del fantasma", "Te estás quedando atrás… ¡el fantasma te espera!").
6. THE SYSTEM SHALL change the status with hysteresis: to ahead or behind when the gap passes ±30 m, back to "on pace" only inside ±12 m, and keep quiet during the first 15 s. A line Wisp says (G3, G5) wins over the status while it shows.
7. THE SYSTEM SHALL work in the simulator and in the demo run (`?demo=1`): the hero and Wisp are both on screen from the first seconds.

### Requirement G7: Accessibility

1. THE SYSTEM SHALL keep every line Wisp says readable (Press Start 2P 8 px on a paper bubble with an ink outline, 390 px wide phones included) and SHALL put the same text in an always-present `aria-live="polite"` region, so the visual bubble is decoration.
2. THE SYSTEM SHALL turn off the pop, the spin, the sparkles, the bob and the hem wave under `prefers-reduced-motion`; the ghost still moves along the route because that is information.

### Requirement G8: Voice and copy

1. THE SYSTEM SHALL write every ghost line in the voice set in `copy-voice.md` ("Wisp"), in English and Spanish with the same keys (`ghost.*`, `result.ghostPace*`, `summary.ghost`), game-pitch tone, no development talk.
2. THE SYSTEM SHALL keep all ghost text in `src/i18n`.
3. THE SYSTEM SHALL give every error, empty, offline, permission and loading-failure line the same voice (a joke, then what to tap), as set by [error-copy](../error-copy/requirements.md).
