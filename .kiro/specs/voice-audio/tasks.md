# Voice and audio: Implementation Plan

Part of the StepQuest specs; see [../README.md](../README.md). Task numbers are the original ids from the single spec, so they are not consecutive here. Do not tick a task until `npm test`, `npx tsc -b`, `npm run lint` and `npm run build` pass.

## Phase 4 — Sound

- [x] 34. Original formant speech synthesizer: Rosenberg glottal pulse and hiss sources, cascade of formant resonators with gliding targets, our own phoneme table (English ARPAbet set plus Spanish vowels, tap, trill, ñ and jota), stress and a falling pitch contour, pitch snapped to semitones and a 6-bit output for the robot timbre
- [x] 35. Text to speech: Spanish letter-to-sound rules (stress from accents and the penultimate rule, Castilian c/z), an English pronouncing dictionary covering every word the app says plus letter-rule fallback, numbers in words in EN and ES ("veintiún pasos", "ten thousand sixty five")
- [x] 36. Callouts in EN and ES with plurals: quest start, each gem (number, total, distance and direction to the next), last gem to the flag, distance marks (500 / 200 / 100 / 50 m), turns 30 m ahead (detected from the route geometry), off route with a direction, back on route, halfway, finish; priority queue with urgent cut-in and stale-phrase dropping; music ducks while the voice speaks
- [x] 37. Procedural chiptune: seeded songs (A A' B A form, common progressions, motif-based melody on a 25 % pulse, 12.5 % pulse arpeggio, triangle bass, LFSR-noise drums), look-ahead scheduler on the audio clock, tempo of one beat per step from the walking speed (84–150 BPM) with a smooth glide, fade-out and pause when the walker stops or fixes stop arriving
- [x] 38. Sound effects for gem pickup, last gem, off route and the finish jingle (replacing the placeholder beeps)
- [x] 39. Sound settings: master, music, voice and effects volumes, mute and voice-only, saved in localStorage (old mute flag migrated); compact sound button and panel in the header and the quest HUD
- [x] 40. iOS / autoplay: AudioContext created only in a tap, silent unlock buffer, resume after interruptions on the next tap, on returning to the page and on state changes, "tap to turn sound back on" hint in the HUD, media playback audio session where supported
- [x] 41. Tests: settings persistence and repair, tempo mapping and glide, pace tracker, scheduler, song rules, effects, voice queue, numbers, Spanish and English pronunciation, synthesizer output (bounds, determinism, formant energy), turn detection, callout planner, engine with a fake AudioContext, sound menu, spoken opening line
- [x] 42. Screenshots of the sound controls in `screenshots/phase4/`

## Mobile design

- [x] 50. Speech bubbles on the map: the phrase on air (from the voice queue, so it always matches what is spoken) is drawn as a pixel-art bubble next to the walker in the app language and removed when the phrase ends or is cut; muted or locked audio still shows it for a time based on text length

## Property-based tests

- [x] 59. Speech bubble property tests (P-V1, P-V2 in `design.md`). No source bug found.
