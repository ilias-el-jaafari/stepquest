---
inclusion: fileMatch
fileMatchPattern: ["src/routing/**", "src/quest/**", "src/osm/**", "src/geo/**"]
---

# Routing rules

Read this before changing the planners, the safety weights, the reroute logic or the worker protocol. Every planner change needs a fixture test (run on `src/data/benicalap.osm.json`, never the network).

## OSM tags in use

- **Walkable** (`isWalkable` in `src/osm/classify.ts`): `highway` in the road set (`residential`, `living_street`, `service`, `unclassified`, `road`, primary/secondary/tertiary and their links) or the path set (`footway`, `pedestrian`, `path`, `steps`, `track`, `bridleway`). Never walkable: motorway, trunk, busway (and their links), `cycleway` unless `foot` allows it, `access=no|private`, `foot=no|use_sidepath|private`, and rail tracks.
- **Safety proxies** (`safetyFlags`): `lit` (yes/no), `sidewalk*` and `footway=sidewalk`, `highway=service` with an alley-type `service`, `tunnel`, `covered`, `indoor`, `layer < 0`, `tunnel=building_passage`.
- **Liveliness**: `shop` (not vacant) and a small set of `amenity` values within 40 m of a street.
- **Industrial land**: `landuse` values in the industrial set; edges inside count as unattractive.
- **Crossings**: `footway=crossing`, `highway=crossing`, `crossing=*`.
- **Roundabouts**: `junction=roundabout|circular`.

## Safety weights

- The safety layer (`src/routing/safety.ts`) multiplies each edge cost by a factor between `MIN_FACTOR` (0.6) and `MAX_FACTOR` (6). Lower is preferred. It changes which streets are chosen, never the length arithmetic: the step goal is measured in real metres.
- Lighting is the strongest signal. Main avenues count as lit unless `lit=no`; untagged side streets and paths count as probably dark, so extra steps are spent on lit avenues, not on dark side streets.
- At night (`isDark`) lighting, tunnels, alleys, industrial land and park paths count more. A lit avenue gets only a small bonus (`AVENUE_NIGHT_BONUS`), smaller than a tagged-lit residential or pedestrian street.
- User-avoided street names are a hard avoid, compared without case, accents or extra spaces (`normalizeName`).
- When you change a weight, update `safety.test.ts` and keep the factors pure and documented.

## Roundabout rule

- `findRoundabouts` stitches tagged ring arcs into one ring and also detects small round closed road loops without tags (perimeter 20–220 m, circularity above 0.75, never `service`).
- The walking graph drops any edge that crosses a roundabout island (a path mapped over the island, a chord between ring nodes). Ring ways themselves stay walkable. Never route across an island.

## Step budget

- `TARGET_TOLERANCE` is 0.05 (`src/geo/steps.ts`). A planned route, and a rerouted remainder, must land within ±5 % of the target distance. Planners tune a size parameter until they do.
- If the goal cannot fit (shorter than the direct A→B path, or larger than the loaded area allows) return a reason and the nearest feasible number of steps, in plain words. Never return an out-of-budget route silently.
- Distance and steps convert only through `src/geo/steps.ts` with the user's stride.

## Rerouting

- Triggered by the quest reducer (`src/quest/quest.ts`) when the walker is off the line and still heading toward the next checkpoint. Retry only after `retryM` more walking.
- `planReroute` first tries a local reconnection to the planned route (rejoin points ahead of the walker, not past the next checkpoint). If that breaks the ±5 % budget of the steps left, it replans the remainder to the finish, spreading the uncollected checkpoints evenly and avoiding the street just left.
- Collected checkpoints, walked distance and walked footprints are kept. Below `MIN_REMAINING_STEPS` (150) no replan is attempted.
- A patch is valid only for the quest and reroute count it was computed from (`patchFits`); otherwise drop it.

## Worker protocol

- Planning runs in `planner.worker.ts` on top of `PlanService`, which has no worker code in it so the main-thread fallback runs the same logic. Messages are plain structured-clone data (`planProtocol.ts`): `world` (build graph and safety context once per map), `plan`, `reroute`, `drop`; replies are `ready`, `plan`, `reroute`, `error`.
- `PlanClient` keeps one running job and one waiting job per kind; the newest request wins and an older answer is returned as `stale`. Do not add message types without updating both ends and `planClient.test.ts`.
