# Voice and audio: Requirements

Part of the StepQuest specs; see [../README.md](../README.md) for the introduction, glossary and index. Requirement ids are kept from the original single spec so history stays traceable.

Related: [quest](../quest/requirements.md) (events that trigger callouts), [map-rendering](../map-rendering/requirements.md) (the speech bubble is drawn by the map renderer).

## Requirements

### Requirement 7 (Phase 4): Sound

**User Story:** As a walker, I want a retro voice and music while I walk, so that I can keep the phone in my hand less and the walk feels like a game.

#### Acceptance Criteria

1. THE SYSTEM SHALL speak turn-by-turn and progress callouts (start, checkpoint reached, distance to the next one, turns, off route, back on route, halfway, finish) in English and Spanish, with correct plurals, using an original formant speech synthesizer (no third-party speech code or samples).
2. THE SYSTEM SHALL play a procedural chiptune (pulse, triangle and noise channels) whose tempo follows the walking pace, changes smoothly, and pauses when the walker stops.
3. WHEN a checkpoint is collected or the quest is finished, THE SYSTEM SHALL play a sound effect.
4. THE SYSTEM SHALL offer master, music, voice and effects volumes, mute and a voice-only mode, and SHALL remember them on the device.
5. THE SYSTEM SHALL start audio only after a user gesture, SHALL keep working while the screen is kept awake, and SHALL recover audio after a system interruption on the next tap or when the page becomes visible again.
6. WHILE the voice speaks, THE SYSTEM SHALL lower the music; an urgent phrase (finish) SHALL interrupt a less important one.
7. WHEN a callout is spoken, THE SYSTEM SHALL show the same text, in the app language, in a pixel-art speech bubble next to the walker on the map, and SHALL remove it when the phrase ends, is interrupted, or sound is muted.
8. IF speech is unavailable or muted, THEN THE SYSTEM SHALL still show the bubble, for a duration based on the text length (1.8 to 7 seconds), following the same phrase queue so that bubble and voice never disagree.
