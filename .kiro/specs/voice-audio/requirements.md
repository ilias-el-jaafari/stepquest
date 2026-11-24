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

### Requirement 7d (Nov 2026 review): Speech text is read the way a person reads it

**User Story:** As a walker who hears callouts in English or Spanish, I want numbers, units and accented words pronounced correctly, so that the voice never says nonsense or silently skips a word.

#### Acceptance Criteria

1. WHEN a phrase contains a decimal number ("1.5", Spanish "1,5"), THE SYSTEM SHALL read it as one number with "point" / "coma" and SHALL NOT insert a sentence pause at the separator.
2. WHEN a phrase contains a number that is too large to spell (1,000,000,000 or more), THE SYSTEM SHALL read it digit by digit and SHALL NOT drop it.
3. THE SYSTEM SHALL treat only a comma, a full stop (as the locale's thousands separator) and a no-break space as thousand separators, and SHALL NOT join two separate numbers that are written with an ordinary space between them.
4. WHEN a number is followed by a unit or abbreviation (km, m, min, h, s, %), THE SYSTEM SHALL read the full word in the phrase language, in the singular for 1 and the plural otherwise.
5. THE SYSTEM SHALL read text with a decomposed accent (n + U+0303) exactly like the precomposed letter, and SHALL read accented letters that a language does not use (for example "é" in English, "ç" in Spanish) as their base letter instead of dropping them.
6. WHEN several punctuation marks follow each other ("!!", "...", "?!,"), THE SYSTEM SHALL produce one pause, the longest of them.

### Requirement 7e (Nov 2026 review): The voice never gets stuck, clicks or disagrees with the bubble

**User Story:** As a walker, I want the voice to keep working after a glitch, an interruption or a language change, so that I do not have to restart the app.

#### Acceptance Criteria

1. THE SYSTEM SHALL keep the language a phrase was queued in, so that a phrase is always synthesized with the rules of its own language, even when the app language changes while it waits.
2. IF synthesizing or starting a phrase fails, THEN THE SYSTEM SHALL show it as a silent bubble and continue with the next phrase, and SHALL NOT leave the queue blocked.
3. IF the audio context is interrupted, suspended or closed while a phrase is on air, or the end of the phrase is never reported, THEN THE SYSTEM SHALL end or continue that phrase silently within its expected length plus 1.5 seconds, so that the queue and the bubble always advance.
4. THE SYSTEM SHALL ignore a blank phrase, SHALL limit a spoken phrase to 280 characters (cut at a sentence or word boundary), and SHALL use that same shortened text for the bubble.
5. WHEN a phrase is cut in, muted or stopped, THE SYSTEM SHALL fade it out within 20 ms instead of cutting it abruptly.
6. THE SYSTEM SHALL measure phrase age with a monotonic clock, so that a change of the device clock neither drops nor keeps stale phrases.
7. THE SYSTEM SHALL never produce a non-finite or out-of-range sample: every synthesized phrase has finite samples in [-1, 1], starts and ends at zero, and invalid synthesizer options (speed, pitch, sample rate) are replaced by safe values.
8. WHEN the voice is not speaking, THE SYSTEM SHALL release the music ducking, also when an interrupted phrase continues as a silent bubble.
9. WHEN a phrase that is likely to be spoken (distance marks, turns) is known in advance, THE SYSTEM SHOULD synthesize it during idle time, so that no callout needs more than one cached lookup on the main thread when it is due.

### Requirement 7f (Nov 2026 review): Music is robust against bad input, hidden tabs and lost contexts

**User Story:** As a walker, I want the music to follow my pace without glitches, even when GPS data is odd or the phone has been in my pocket.

#### Acceptance Criteria

1. THE SYSTEM SHALL treat a non-finite tempo as "standing still" and SHALL keep every tempo, glide and step length finite and within 1 to 300 BPM.
2. WHILE the page is hidden, THE SYSTEM SHALL schedule at least 1.5 seconds of music ahead, so that timer throttling does not make the music stutter.
3. WHEN a gain or ducking change is made, THE SYSTEM SHALL start it from the value the parameter has at that moment, so that it does not jump (no pop) in any browser.
4. THE SYSTEM SHALL start and end every note and effect envelope at zero gain, and SHALL disconnect the nodes of a note when it ends.
5. WHEN the last bar of a song is played, THE SYSTEM SHALL play one held tonic, not several overlapping copies of it.
6. IF the AudioContext has been closed by the system, THEN THE SYSTEM SHALL create a new one on the next user gesture and resume the music and the voice with it.
7. THE SYSTEM SHALL keep the speech bubble, in every state of the audio engine, equal to the phrase that is on air or shown silently, and wrapping a bubble text SHALL terminate for any width and keep every character (a character outside the basic plane counts as one).
