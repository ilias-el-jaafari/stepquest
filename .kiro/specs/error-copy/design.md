# Error copy: design

## Modules

| Module | Role |
| --- | --- |
| `src/i18n/en.ts`, `es.ts` | The error lines (keys in the tables of the requirements). |
| `src/ui/GhostNote.tsx` | Message box (`.msg.ghost-note`) with Wisp's "boo" face stuck on the top-left corner. Props: `tone`, `pose`, `role`, `testId`. |
| `src/index.css` | `.ghost-note` (relative, 18 px top margin), `.ghost-note-face` (absolute, over the border, paper background), `.crash-ghost`. |
| `PlannerPanel`, `ResultBox`, `LocateMessage`, `SafetyNotice`, `SettingsSheet` | Use `GhostNote` for their error boxes. Test ids and roles are unchanged. |
| `App.tsx`, `ErrorBoundary.tsx` | A 32 px face above the text on the map failure and the crash screen (the boundary draws it without the provider). |
| `src/i18n/errorCopy.test.ts` | `ERROR_KEYS`, action verbs, blame words, two-line fit, placeholders, quoted labels. |

## Fit

Press Start 2P is square: a glyph is as wide as the font size. At 8 px, the planner's 334 px box minus 20 px of padding and border holds 39 characters a line. The face sits on the border, not in the text column, so two lines hold 78 characters. The test wraps words greedily with sample numbers (`10.000` steps, `250` m) and fails at a third line.

## Writing a line

1. Joke first, in Wisp's voice (fog, sheets, afterlife). Spanish is its own joke.
2. Then the verb and the button label. Check the label against the dictionary.
3. Keep the placeholders. Run `npx vitest run src/i18n`.
