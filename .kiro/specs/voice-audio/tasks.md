# Voice and audio: Implementation Plan

Part of the StepQuest specs; see [../README.md](../README.md). Task numbers are the original ids from the single spec, so they are not consecutive here. Do not tick a task until `npm test`, `npx tsc -b`, `npm run lint` and `npm run build` pass.

## Phase 4 — Sound

- [x] 34. Original formant speech synthesizer: Rosenberg glottal pulse and hiss sources, cascade of formant resonators with gliding targets, our own phoneme table (English ARPAbet set plus Spanish vowels, tap, trill, ñ and jota), stress and a falling pitch contour, pitch snapped to semitones and a 6-bit output for the robot timbre
- [x] 35. Text to speech: Spanish letter-to-sound rules (stress from accents and the penultimate rule, Castilian c/z), an English pronouncing dictionary covering every word the app says plus letter-rule fallback, numbers in words in EN and ES ("veintiún pasos", "ten thousand sixty five")
- [x] 36. Callouts in EN and ES with plurals: quest start, each gem (number, total, distance and direction to the next), last gem to the flag, distance marks (500 / 200 / 100 / 50 m), turns 30 m ahead (detected from the route geometry), off route with a direction, back on route, halfway, finish; priority queue with urgent cut-in and stale-phrase dropping; music ducks while the voice speaks
- [x] 37. (Replaced by the composed loop of [chiptune](../chiptune/tasks.md) task 90.1; the scheduler, tempo and glide below still apply.) Procedural chiptune: seeded songs (A A' B A form, common progressions, motif-based melody on a 25 % pulse, 12.5 % pulse arpeggio, triangle bass, LFSR-noise drums), look-ahead scheduler on the audio clock, tempo of one beat per step from the walking speed (84–150 BPM) with a smooth glide, fade-out and pause when the walker stops or fixes stop arriving
- [x] 38. Sound effects for gem pickup, last gem, off route and the finish jingle (replacing the placeholder beeps)
- [x] 39. Sound settings: master, music, voice and effects volumes, mute and voice-only, saved in localStorage (old mute flag migrated); compact sound button and panel in the header and the quest HUD
- [x] 40. iOS / autoplay: AudioContext created only in a tap, silent unlock buffer, resume after interruptions on the next tap, on returning to the page and on state changes, "tap to turn sound back on" hint in the HUD, media playback audio session where supported
- [x] 41. Tests: settings persistence and repair, tempo mapping and glide, pace tracker, scheduler, song rules, effects, voice queue, numbers, Spanish and English pronunciation, synthesizer output (bounds, determinism, formant energy), turn detection, callout planner, engine with a fake AudioContext, sound menu, spoken opening line
- [x] 42. Screenshots of the sound controls in `screenshots/phase4/`

## Mobile design

- [x] 50. Speech bubbles on the map: the phrase on air (from the voice queue, so it always matches what is spoken) is drawn as a pixel-art bubble next to the walker in the app language and removed when the phrase ends or is cut; muted or locked audio still shows it for a time based on text length

## Property-based tests

- [x] 59. Speech bubble property tests (P-V1, P-V2 in `design.md`). No source bug found.

## Nov 2026 architecture review (requirements 7d, 7e, 7f)

Findings are listed in `design.md` ("Architecture review (Nov 2026)"). Every bug task starts with a failing regression test.

- [x] 62. Voice and audio rework
  - [x] 62.1 Speech text pipeline (`voice/text.ts`): NFC and accent folding, decimals, big numbers digit by digit, ASCII-space thousands removed, units and abbreviations, one pause for repeated punctuation, phrase length limit (bugs B1 to B6, B8, B25)
  - [x] 62.2 Synthesizer hardening: validated options, finite and bounded output, zero at both ends, no per-frame allocation (B7, P1)
  - [x] 62.3 Voice queue: language kept per phrase, injectable monotonic clock, blank phrases refused, documented invariants (B9, B19, B20, B24)
  - [x] 62.4 Speech bubble: `wrapBubbleText` terminates for any width and counts code points (B16)
  - [x] 62.5 Automation helpers and envelopes (`automation.ts`): pop-free parameter changes, pure note/drum/effect envelopes that start and end at zero, node release on end (B13, B22, B23)
  - [x] 62.6 Voice player module (`voicePlayer.ts`): failure isolation, watchdog for a lost end event, interruption handling, fade-out, ducking release, byte-bounded cache, idle pre-rendering and `prewarm` (B10 to B12, B14, P2, P3)
  - [x] 62.7 Music: finite tempo everywhere, look-ahead that grows in a hidden tab, single held tonic in the last bar, `musicPlayer.ts` module (B17, B18, B21)
  - [x] 62.8 Engine split and lifecycle: `graph.ts`, `effects.ts`, `lifecycle.ts`, thin `engine.ts`, closed context recreated (B15, D1 to D4)
  - [x] 62.9 Tests: regression tests for every bug, property tests P-V3 to P-V8
  - [x] 62.10 Spec sync: design, audible-change log and this list

