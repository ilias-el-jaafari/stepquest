# Error copy (mischief in errors): Requirements

Part of the StepQuest specs; see [../README.md](../README.md) for the introduction, glossary and index. Requirement ids are prefixed with `E`.

Related: [ghost-guide](../ghost-guide/requirements.md) (Wisp, G8 voice and copy), [retro-ui](../retro-ui/requirements.md) (requirement 19, copy; i18n), [quest](../quest/requirements.md) (GPS and resume states), [map-rendering](../map-rendering/requirements.md) (map loading failures), [routing](../routing/requirements.md) (planning failures). Voice rules: `.kiro/steering/copy-voice.md`, section "Mischief in errors".

## Introduction

Floor Mesters (UX, Kiro) judged: "an error message that makes me laugh. If I smile and still know what to tap next, you've won me over." Every state where something did not work, is missing, is offline or needs a permission gets one short line in Wisp's voice that makes the player smile and says what to tap next.

## Glossary

- **Error line**: the dictionary string a player reads in an error, empty, offline, permission or loading-failure state.
- **Action**: the verb and, when a button fixes the state, the label of that button in quotes (EN “Retry”, ES «Reintentar»).
- **Error key**: a key listed in the tables of E1 to E6 and in `ERROR_KEYS` of `src/i18n/errorCopy.test.ts`.

## Requirements

### Requirement E1: Every error line has a joke and an action

**User Story:** As a player, I want an error to make me smile and tell me what to tap, so that a failure never leaves me stuck.

1. THE SYSTEM SHALL write every error key as a short funny line in Wisp's voice followed by an action, in English and Spanish, with the same keys and the same placeholders (names and plural forms) in both.
2. THE SYSTEM SHALL include in every error key a verb from the lists in `copy-voice.md` ("Mischief in errors") and, WHERE a button fixes the state, the exact label of that button.
3. THE SYSTEM SHALL keep every number or placeholder the previous line carried (`{min}`, `{max}`, `{steps}`, `{m}`, `{dir}`, `{value}`, `{names}`).
4. THE SYSTEM SHALL NOT blame the player (no "you denied", "invalid", "you must") and SHALL NOT use development talk (servers, caches, requests, codes, timeouts, APIs).
5. THE SYSTEM SHALL keep each line to two lines on a 390 px phone (78 characters with the placeholders filled in, at 39 characters a line).

### Requirement E2: Wisp's face on error boxes

1. WHEN an error box is shown in the planner, the settings or the map, THE SYSTEM SHALL stick Wisp's face (the "boo" sprite) on the top-left corner of the box (`GhostNote`), over the border, so the text keeps the full width.
2. THE SYSTEM SHALL hide the face from assistive technology (`aria-hidden`); the text carries the meaning and keeps its `role` (`alert` or `status`).
3. THE SYSTEM SHALL show a larger face above the text on the two full-panel errors: the map failure and the crash screen.

### Requirement E3: Planning states

| State | Key | Where | Action in the line |
| --- | --- | --- | --- |
| Goal shorter than the A→B path | `error.tooShort` | quest log | tap the suggested-steps button, or move the finish closer |
| Goal shorter than the smallest loop | `error.tooShortLoop` | quest log | tap the suggested-steps button |
| Goal outside the allowed range | `error.outOfRange` | quest log | pick a number in `{min}`–`{max}`, tap "Plan quest" |
| Goal longer than the area allows | `error.tooLong` | quest log | tap the suggested-steps button |
| No route within ±5 % (closest shown) | `error.noMatch` | quest log | tap "Another route" or move the start |
| Point outside the loaded map | `error.outsideArea`, `area.outside` | quest log, map banner | tap "Load this area" |
| No walkable street near the point | `error.unreachable`, `map.finishNone` | quest log, finish note | tap closer to a street |
| Start and finish are the same | `error.samePoint` | quest log | tap "Loop" or move the finish |
| Planning failed, streets would not load, streets took too long | `error.planFailed`, `error.planStreets`, `error.planTimeout` | planner | tap "Retry" (the button keeps working) |
| Invalid number typed | `target.invalid`, `stride.invalid` | field note | type a whole number or length; the old value is kept |

1. THE SYSTEM SHALL keep the "Use N steps", "Another route" and "Retry" buttons beside these lines working as before.
2. THE SYSTEM SHALL keep `error.preview` after a line when the map shows the closest attempt.

### Requirement E4: Streets to avoid and map data

| State | Key | Action in the line |
| --- | --- | --- |
| No street with that name | `safety.noMatch` | try another name or tap "Pick on map" |
| Tap found no named street | `safety.noStreet` | tap right on a street |
| Area too small for a safe walk | `safety.infeasible` | tap the button below |
| An avoided street cannot be dodged | `safety.avoidIgnored` | move the start |
| Bad coordinates | `data.badCoords` | type like 39.4935, -0.3920 |
| Map service busy, too large, unreachable, answered badly, bad area | `data.err.busy`, `rateLimited`, `tooLarge`, `network`, `badResponse`, `badArea` | tap the button again, lower the goal, or pick another start |
| The map did not load at start | `map.error` | tap "Try again" |

### Requirement E5: Location and quest states

| State | Key | Action in the line |
| --- | --- | --- |
| Weak GPS at "Use my location" | `loc.weak` | tap the map to place the start |
| Streets around the player would not load | `loc.areaFailed` | tap "Retry" |
| Location unsupported, insecure, denied, unavailable, timed out, inaccurate | `loc.err.unsupported`, `insecure`, `denied`, `unavailable`, `timeout`, `inaccurate` | tap the map, turn location on, or step outside and tap "Use my location" |
| Quest tracking unsupported, insecure, denied | `quest.err.unsupported`, `insecure`, `denied` | tap "Simulate instead" or turn location on |
| Quest GPS unavailable, slow, rough | `quest.err.unavailable`, `timeout`, `inaccurate` | keep walking, head to open sky |
| No GPS signal (weak, lost) | `quest.weak`, `quest.lost` | keep walking, keep the screen on |
| Off the route | `quest.offRoute` | head `{dir}` for `{m}` m |
| Saved quest whose map did not load | `quest.resumeFailed` | go online and reload |

### Requirement E6: Offline, empty, sound and crash states

| State | Key | Action in the line |
| --- | --- | --- |
| Offline | `net.offline` | turn on data or wifi; saved areas still work |
| Empty quest log (nothing planned) | `result.empty` | pick a start, set a goal, tap "Plan quest" |
| Sound paused by the phone | `sound.resume` | tap to turn the sound on |
| Render crash (`ErrorBoundary`) | `crash.title`, `crash.body` | tap "Try again" or "Reload"; the saved quest is safe |

1. THE SYSTEM SHALL keep the crash screen independent of the i18n provider (it reads the language itself) and keep both of its buttons working.
2. THE SYSTEM SHALL keep the offline banner without a face (it is a full-width strip) and its text in the same voice.

### Requirement E7: States without a screen yet

1. THE SYSTEM currently shows nothing for a full device storage (saving fails silently and the quest keeps running), an empty history, a route without checkpoints (the quest says "walk to the flag") or the simulation notice (the badge "Simulation ×N" and the hint under "Simulate walk" are plain labels). WHEN a screen is added for one of them, THE SYSTEM SHALL give it an error key in the voice of E1, add the key to `ERROR_KEYS` and to the tables above.
2. THE SYSTEM SHALL keep the note that simulated walks do not count (`hero.note`) in Wisp's voice.

### Requirement E8: Checked, not remembered

1. THE SYSTEM SHALL have a test (`src/i18n/errorCopy.test.ts`) that checks, for every error key and both languages: the key exists, the placeholders match, an action verb is present, no blame wording, and the filled-in line fits two lines of 39 characters.
2. THE SYSTEM SHALL have the test check that a label quoted in an error line is the text of another dictionary string, so a renamed button breaks the build.
3. THE SYSTEM SHALL run the hook `error-copy-voice` when `src/i18n/en.ts` or `es.ts` is saved, to check new or changed error strings against "Mischief in errors" and the EN/ES parity.
4. THE SYSTEM SHALL keep other tests from asserting the exact text of an error line: they use test ids or read the string from the dictionary.
