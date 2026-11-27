# Ghost guide: design

## Modules

| Module | Role |
| --- | --- |
| `src/ghost/art.ts` | The four sprites (`GHOST_FLOAT` ×2, `GHOST_HAPPY`, `GHOST_BOO`), `ghostSprite(pose, phase)`, `ghostPhase`, `ghostBob` (0 when reduced). |
| `src/ghost/pacer.ts` | Pure pacer: `paceFor`, `PacerPlan` (rate, anchor, pause, route offset), `pacerDistanceM`, `pacerAlongM`, `ghostAlongM` (+6 m lead), `rebasePacer`, `pacerGapM`, `nextPacerStatus` (hysteresis). |
| `src/ghost/director.ts` | Pure choice of lines: `checkpointLine`, `finishLine`, `NIGHT_LINES`, `shouldScare`. Lines are dictionary keys without placeholders. |
| `src/render/routeWalker.ts` | `RouteLine` (route polyline in tile units with metres, `pointAt`, `project`) and `RouteWalker` (hero progress). Used by the overlay for the hero and the ghost. |
| `src/render/overlayLayer.ts` | Places the hero through `RouteWalker`, draws the ghost (cached sprite canvases, one glow, mirror when heading left). `QuestOverlay` gains `simMps`, `offRoute`, `ghost {plan, pose}`. |
| `src/ui/useGhost.ts` | Hook: plan state and pauses, 500 ms status tick with hysteresis, line queue (gems, night scare). |
| `src/ui/GhostHud.tsx` | Chip at the top of the bottom stats card (status, gap) plus the always-present `sr-only` live region. |
| `Onboarding.tsx`, `SummaryScreen.tsx`, `PlannerPanel.tsx` | Host, finish guest, and the "Ghost pace" line. |

## Pacer maths

`target(t) = paceMps × elapsed(t)`, `elapsed = anchorElapsed + (t − anchor) × rate` (frozen while `pausedAt`). The frame clock is `performance.now()`, the same one the overlay reads, so the HUD status and the drawn ghost agree. `rate` is the simulator's `timeScale` (1 for a real walk), so at ×20 the ghost walks 20 times faster, like the hero.

On the route: `along = target − offsetM`, clamped to `[0, routeM]`. A reroute starts a new route whose progress restarts near 0; `rebasePacer` adds `heroAlongBefore − heroAlongAfter` to `offsetM` so the gap is unchanged.

Status: `gap = heroAlong − along`. `nextPacerStatus(prev, gap, elapsed)`: `warmup` under 15 s; `ahead` at gap ≥ 30; `behind` at ≤ −30; from `ahead`/`behind` it returns to `on` only inside ±12.

The ghost is drawn at `along + 6 m`. The lead is only visual: the status uses the exact pace point.

## Performance

The ghost adds one `drawImage` of a 16×16 canvas per frame (plus one `lighter` glow at night). Frames are canvases made once per sprite (`OverlayLayer.sprite`). Nothing touches the scene cache: `MapRenderer.updateScene` is unchanged and a walk or pan redraws the overlay only. The status tick is 2 Hz React state; the ghost's position is read from the clock in the frame loop.

## Onboarding

The existing three-screen modal keeps its keys (`onboarding.1..3.*`), now in Wisp's voice and with Wisp as the picture (boo, float, happy). The seen flag is `hasSeenOnboarding` / `markOnboardingSeen` (`ONBOARDING_STORAGE_KEY`); Settings "Show intro" dispatches `intro` again.

## Tests

- `ghost/pacer.test.ts`: pace and steps per minute, distance (rate, pause, resume, monotonic), gap rebasing, hysteresis (properties), ghost placement on the route (property: on the line, ahead of the pace point, monotonic, never past the finish), sprite validity.
- `ghost/director.test.ts`: lines exist in both languages, never repeat back to back, scare once from dusk.
- `ui/useGhost.test.tsx`: status, gem comment, scare once, pause before the first fix and at the finish.
- `ui/GhostHud.test.tsx`: polite live region, quiet warm-up, a line wins and pops.
- `ui/Onboarding.test.tsx`, `AppOnboarding.test.tsx`: the intro, the stored flag, replay from Settings. `SummaryScreen.test.tsx`: spin, sparkles, caption, reduced motion.
- `render/ghostOverlay.test.ts`: the ghost changes the frame, is deterministic, moves with the clock; the simulated hero keeps its pace on the overlay.
- `i18n/*`: key parity, placeholders, unused keys and banned phrases cover the new copy.
