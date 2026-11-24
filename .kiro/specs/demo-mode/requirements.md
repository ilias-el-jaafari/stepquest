# Demo mode (self-playing run for the submission video): Requirements

Part of the StepQuest specs; see [../README.md](../README.md) for the introduction, glossary and index. Requirement ids are prefixed with `D`.

Related: [quest](../quest/requirements.md) (simulation, summary, requirement 6d), [safety-night](../safety-night/requirements.md) (night lighting), [map-rendering](../map-rendering/requirements.md) (camera, streaming), [voice-audio](../voice-audio/requirements.md) (sound settings, unlock on a gesture).

## Requirements

### Requirement D1: Entry

**User Story:** As the author recording the submission video, I want a URL that plays the whole game by itself, so that every take is the same and needs no hands.

#### Acceptance Criteria

1. WHEN the page URL has `demo=1`, THE SYSTEM SHALL start the self-playing demo run; for any other value or without it, THE SYSTEM SHALL behave exactly as before.
2. WHEN the demo URL also has `lang=es` or `lang=en` (any case), THE SYSTEM SHALL show and speak that language for this visit without saving it; another value SHALL fall back to the usual language choice.
3. THE SYSTEM SHALL add no button, link or text for the demo in normal use.

### Requirement D2: No device state, no network for painting

#### Acceptance Criteria

1. WHILE in the demo run, THE SYSTEM SHALL skip the onboarding, ignore and keep the saved settings, avoid list, language and any saved quest, and SHALL NOT save the demo quest.
2. WHILE in the demo run, THE SYSTEM SHALL draw and plan on the bundled Benicalap extract only: no location request, no Overpass request, no vector tile streaming, no automatic loading of the area in view. It SHALL work on GitHub Pages with every fetch failing.

### Requirement D3: Plays by itself

#### Acceptance Criteria

1. WHEN the bundled map is ready, THE SYSTEM SHALL plan a loop of 6,000 steps at a 0.75 m stride from the demo start point with the night weights on, once, and then start the quest with the simulated walk, without any input.
2. THE SYSTEM SHALL simulate a noise-free walk at 5 km/h with a time warp chosen so the route takes 62 s of real time, ticking every 100 ms, so the walker moves smoothly.
3. THE SYSTEM SHALL collect gems with the usual dialogues, effects and spoken callouts (sound settings apply). Dialogue lines SHALL move on by themselves after 2.5 s and the finish dialogue SHALL close by itself after 3 s.
4. THE SYSTEM SHALL end on the "Quest complete!" summary with its celebration and fanfare.
5. THE SYSTEM SHALL be deterministic: the same route, quest id (tune and fireworks), camera script and day cycle every run.
6. THE SYSTEM SHALL take 60 to 90 s from opening the URL to the summary (about 72 s).
7. THE SYSTEM SHALL NOT create the AudioContext outside a user gesture: sound starts on the first tap, and the "tap for sound" button SHALL NOT stop the automatic camera.

### Requirement D4: Automatic camera

#### Acceptance Criteria

1. WHILE the walk runs and no tap has happened, THE SYSTEM SHALL drive the camera from the share of the route walked: close on the walker (24 px per tile) for the first 10 %, an eased pull-out to the whole route by 28 %, the whole route until 62 %, an eased return to the close view by 80 %, and close to the end.
2. THE SYSTEM SHALL keep the zoom between the quest floor and the close zoom, and SHALL move the zoom on a log scale and the centre between the walker and the middle of the route.
3. WHEN the player taps or drags anywhere on the quest screen (except "tap for sound"), THE SYSTEM SHALL stop the automatic camera for the rest of the run; the walk SHALL go on with the usual follow camera.
4. WHEN the user prefers reduced motion, THE SYSTEM SHALL NOT run the automatic camera (no swoops); the usual follow camera stays.

### Requirement D5: Day cycle

#### Acceptance Criteria

1. WHILE in the demo run, THE SYSTEM SHALL light the map as on 21 June 2026 in València (fixed, whatever the day and time zone of the recording) at a time that runs in a straight line from 18:30 at the start of the route to 22:30 at its end, in whole minutes, never going backwards.
2. THE SYSTEM SHALL start the run in afternoon light (no lamps, no lit windows) and end at night with lamps fully on and windows lit (the lighting itself is requirement S10 of [safety-night](../safety-night/requirements.md)).

### Requirement D6: Copy

#### Acceptance Criteria

1. THE SYSTEM SHALL add no new player-facing text; any later text SHALL follow `copy-voice.md` in English and Spanish.
