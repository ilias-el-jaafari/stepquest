# Chiptune: requirements

## Introduction

StepQuest already has a tempo-following chiptune and a few sound effects (see [voice-audio](../voice-audio/requirements.md)). This spec replaces the generated major-key tune with **our own composed quest loop** in a spooky-cute minor and whole-tone flavour, gives the key moments (gem, Wisp's night scare, finish) short original **jingles** that duck the loop, adds a **Chiptune music** setting, and makes sound free when it is off: nothing is loaded, no AudioContext exists and no timer runs while sound is muted.

Everything is synthesized in code with the Web Audio API. There are no samples, and no melody is taken from or meant to recall an existing piece.

## Glossary

- **Loop**: the 16-bar composed quest tune. One step is a sixteenth note; a bar is 16 steps; the loop is 256 steps and repeats without a gap.
- **Jingle**: a short effect on the effects bus for a game moment: gem pickup, scare, finish (and the summary reprise).
- **Music on**: the new setting `chiptune` (label "Chiptune music" / "Música chiptune"). Music is **audible** when the sound is not muted, "Voice only" is off, `chiptune` is on and the music volume is above zero.
- **Gesture**: a tap or key press, the only moment a browser lets an AudioContext start.

## Requirements

### Requirement C1: An original loop

1. THE SYSTEM SHALL play a composed loop of 16 bars in four phrases: a creeping minor motif (bars 1 to 4), its answer (5 to 8), a whole-tone wander (9 to 12) and a cute resolution (13 to 16), on a 25 % pulse lead, a 12.5 % pulse arpeggio, a triangle bass and noise drums.
2. THE SYSTEM SHALL use only notes written for this app (`src/audio/theme.ts`), with no sampled audio, no generated song and no melody taken from another work. Copyrighted or recognisable tunes are out of scope.
3. WHEN the loop ends, THE SYSTEM SHALL continue with its first bar on the next step, with no pause, overlap or repeated step at the boundary.
4. THE SYSTEM SHALL keep every voice of bars 9 to 12 inside the whole-tone scale of the bar's root (A, then B♭), every voice of the other bars inside A minor with its colour notes (F♯, G♯ and the D♯ wink, never C♯ or B♭), and every note within MIDI 28 to 96.
5. THE SYSTEM SHALL pick one of three keys from the quest seed (A, G or C minor) so quests differ a little; the three keys are the same notes moved by 0, −2 or +3 semitones, and a change of key happens on a bar line.

### Requirement C2: Scheduling

1. THE SYSTEM SHALL schedule notes ahead on the AudioContext clock from a 25 ms timer: every step inside a 150 ms window is scheduled once, at the time the clock gives it, and never again.
2. THE SYSTEM SHALL follow the walking pace (one beat per step, 84 to 150 BPM, about 104 BPM for a relaxed walk) with a smooth glide, as before, and pause when the walker stands still.
3. WHEN the page becomes hidden, THE SYSTEM SHALL fade the music out and stop scheduling it, and WHEN the page is visible again it SHALL fade the music back in from the current bar position without a burst of missed notes.
4. WHEN the quest ends, THE SYSTEM SHALL stop the loop (fade out, timer cleared) before the finish jingle's tail.
5. THE SYSTEM SHALL never play a missed step in a burst: after a stall the clock jumps forward.

### Requirement C3: Jingles

1. THE SYSTEM SHALL play an original jingle for each of: a gem (a short minor arpeggio, 0.2 to 0.5 s; the last gem before the flag adds a high bell), Wisp's night scare ("¡Bu!": a playful two-note wobble and a sparkle, under 0.8 s, softer than the gem), and the finish (a fanfare of 2 to 3 s that climbs a whole-tone run and lands on a major chord).
2. WHEN Wisp's night scare is shown, THE SYSTEM SHALL play the scare jingle once per quest. The scare stays friendly: low level, no noise burst.
3. WHEN a jingle starts, THE SYSTEM SHALL lower the loop to about a third for the length of the jingle plus a short tail and then bring it back, on the audio clock, without a click. Overlapping jingles extend the duck. Ducking for jingles and ducking for the voice SHALL be independent, so one never releases the other.
4. THE SYSTEM SHALL play jingles on the effects bus: muting, "Voice only" and an effects volume of zero silence them; the **Chiptune music** setting does not.

### Requirement C4: Setting and defaults

1. THE SYSTEM SHALL offer a "Chiptune music" checkbox next to Mute and Voice only in the sound controls (the sound menu and Settings), in English and Spanish.
2. THE SYSTEM SHALL store it as `chiptune` in the sound settings, default **on**, sanitize any stored value and keep every older stored setting valid.
3. THE SYSTEM SHALL treat it as on **only while sound is on**: it has no effect while sound is muted or "Voice only" is on, and the checkbox is disabled then.
4. THE SYSTEM SHALL keep the default music slider at 80 %, so the default, quiet mix is heard without any change.

### Requirement C5: Muted means nothing

1. WHILE sound is muted, THE SYSTEM SHALL NOT create an AudioContext (a tap while muted does not unlock audio), SHALL NOT load the composed loop, and SHALL NOT keep a music timer running.
2. WHEN sound is muted while audio runs, THE SYSTEM SHALL silence it at once (buses to zero, the music timer stopped, speech stopped) and suspend the context.
3. WHEN sound is unmuted by a tap, THE SYSTEM SHALL create or resume the context in that tap, and the music that was asked for (menu or quest) SHALL start in time with the next bar.
4. WHEN the music setting is turned off, THE SYSTEM SHALL fade the loop out at once and stop its timer; turning it on again starts it in the same tap. Jingles are not affected.
5. THE SYSTEM SHALL create the AudioContext only inside a gesture (as before). The self-playing `?demo=1` run starts silent and begins to play at the first tap.
6. THE SYSTEM SHALL load the composed loop with a dynamic `import()` the first time music is audible, so the main bundle holds no part of the composition.

### Requirement C6: Loudness

1. THE SYSTEM SHALL keep the music at a low level: with the music slider and the master slider at 100 %, the summed peak of all simultaneous music voices SHALL stay at or below 0.12 of full scale (a test sums the worst step of the loop).
2. THE SYSTEM SHALL keep every jingle at or below 0.5 of full scale before the effects and master sliders, and SHALL run the master through a limiter where the browser offers one, so the mix of music, jingles and voice does not clip.
3. THE SYSTEM SHALL give every note an envelope that starts and ends at zero (no clicks).

### Requirement C7: Demo mode

1. IN `?demo=1` the quest events SHALL produce the same jingles as a real walk: a gem jingle at each gem (the last-gem variant before the flag), the scare jingle when the light first turns to dusk, and the finish jingle at the finish; the loop SHALL play from the first tap and stop at the finish.
2. THE SYSTEM SHALL need no demo-only audio code: the events take the normal path.
