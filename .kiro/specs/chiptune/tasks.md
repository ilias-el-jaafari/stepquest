# Chiptune: tasks

- [x] 90.1 `theme.ts`: the composed 16-bar loop (lead, arpeggio, bass, drums), three keys from the seed, pure `themeEventsAt`; `chiptune.ts` reduced to shared helpers and level constants
  - _Requirements: C1, C6.1_
- [x] 90.2 `musicPlayer.ts`: lazy theme, idle timer when inaudible, page hidden and visible, one look-ahead window
  - _Requirements: C2, C5.1, C5.4, C5.6_
- [x] 90.3 Jingles in `sfx.ts` (gem, last gem, scare, finish, summary fanfare) and `jingleDuck` in `graph.ts` with `duckForJingle` and `jingleDuckOps`; limiter on the master
  - _Requirements: C3, C6.2, C6.3_
- [x] 90.4 Settings: `chiptune` flag, `musicAudible`, default music 0.8; engine: no context while muted, suspend and resume, unlock in the unmuting tap, music start and stop on toggles
  - _Requirements: C4, C5_
- [x] 90.5 UI: "Chiptune music" checkbox (EN, ES); `useGhost` plays the scare jingle
  - _Requirements: C3.2, C4.1_
- [x] 90.6 Tests: theme, music player, jingles and ducking, settings, engine mute rules, demo events to jingles
  - _Requirements: C1 to C7_
- [x] 90.7 Docs: steering (`tech.md`, `visual-style.md` sound section, `product.md`), `README.md` hook list, hook `chiptune-tests`, spec index, voice-audio notes (task 37, requirement 7f.2)
