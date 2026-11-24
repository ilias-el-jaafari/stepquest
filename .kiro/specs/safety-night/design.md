# Safety and night: Design

Part of the StepQuest specs; see [../README.md](../README.md). See also: [routing](../routing/requirements.md) (planner and ±5 % budget), [map-rendering](../map-rendering/requirements.md) (OSM tags in the codec), [quest](../quest/requirements.md) (reroute trigger). Working rules: `.kiro/steering/routing.md` ("Safety weights").

## Safety weights

Rerouting uses the same weights and the avoid list (see "Fast rerouting" in [routing](../routing/design.md)); a safety cost is a multiplier on edge length, so the step goal and its ±5 % tolerance stay the same.

The day-cycle lighting on the map ([map-rendering](../map-rendering/design.md), task 60) reuses `sunAltitude` and `HORIZON` from `src/geo/sun.ts`. It only draws; it changes no weight here (S10).

## Architecture and review (Nov 2026)

### Modules

| File | Role |
| --- | --- |
| `src/osm/classify.ts` | `safetyFlags(tags)` (SAFETY_LIT, UNLIT, SIDEWALK, ALLEY, COVERED), `isLively`, `isIndustrialLand`, `isTunnel` |
| `src/routing/safety.ts` | `safetyFactor` (pure), `safetyContext` (per-edge facts, once per area), `edgeCosts` (cost array for one option set), names (`normalizeName`, `streetNames`, `searchStreets`, `nearestStreet`, `avoidedPolylines`, `avoidedOnRoute`), `routeSafety` |
| `src/routing/safePlanner.ts` | `planWithSafety`: the fallback chain (S7) |
| `src/geo/sun.ts` | `sunAltitude`, `isDark`, `sunTimes`, `isNightWalk`, `HORIZON` |
| `src/ui/avoidList.ts`, `AvoidStreetsBox.tsx` | avoid list: clean, add, remove, load, save (`AVOID_STORAGE_KEY`) |
| `src/render/hazard.ts`, `streetMarks.ts`, `overlayLayer.ts` | hazard tape and no-entry sign on avoided streets |
| `src/App.tsx`, `src/quest/reroute.ts` | build `{ safe: true, night, avoid }` for a plan and a reroute |

### Cost model: a multiplier that never changes length

`edgeCosts(ctx, { safe, night, avoid })` returns a `Float32Array` with one multiplier per edge, plus `min` (the smallest, at most 1) and `closed` (number of avoided edges). The planner passes it as `cost` / `minCost`. A* path cost is Σ length × factor, and the heuristic is straight-line distance × `min`, which never overestimates (S2.4). Everything the user sees (route distance, steps, checkpoints, ±5 % tuning) uses real edge lengths from `graph.lengths`. The tuner changes its size parameter until the real length fits, so weights only choose which streets fill the budget. Avoided edges cost `Infinity` and are not part of `min`. With `safe` false and an empty avoid list `edgeCosts` returns undefined and the planner is unweighted. The last result is cached per context and option key (safe, night, sorted normalised avoid names); callers never modify it.

`safetyFactor(edge, night)` multiplies independent terms and clamps the product to [0.6, 6]. Every term is a constant; `lively` and `flags` are only compared, never multiplied, so no input can produce NaN.

### Tag table (weights unchanged by this review)

Order: type factor, then lighting, then the other terms; the product is clamped.

| Signal (OSM) | Day | Night | Rationale |
| --- | --- | --- | --- |
| `highway=pedestrian`, `living_street` | 0.8 | 0.8 | People on foot, no cars |
| `residential` | 0.92 | 0.92 | Houses, overlooked |
| `primary`/`secondary`/`tertiary` and links | 1 | 1 | Busy, neutral by type; lighting decides |
| `footway` | 1 | 1 | Neutral; lighting decides |
| `unclassified`, `road` | 1.1 | 1.1 | Less information |
| `service` | 1.35 | 1.35 | Back-of-building roads |
| `steps` | 1.25 | 1.25 | Slow, often between buildings |
| `path`, `bridleway` | 1.3 | 1.8 | Isolated, dark at night |
| `track` | 1.7 | 2.4 | Rural, isolated |
| any other value or none | 1 | 1 | Neutral |
| Lit (`lit` other than `no`, `disused`, `unknown`; or an avenue without `lit=no`) | × 0.92 | × 0.75 (`LIT_NIGHT`) | Lighting is the strongest signal |
| `lit=no` or `disused` | × 1.3 | × 3 | Known dark |
| Untagged path, footway, track, steps, bridleway | × 1.1 | × 1.8 | Probably dark |
| Untagged `pedestrian` | × 1 | × 1.2 | Pedestrian zones are usually lit but rarely mapped so |
| Untagged anything else | × 1.12 | × 1.6 (`UNKNOWN_LIT_NIGHT`) | Side streets are probably darker than a lit avenue |
| Sidewalk (`sidewalk*` other than `no`, `none`, `separate`; `footway=sidewalk`) | × 0.93 | × 0.93 | Separated from traffic |
| Alley (`highway=service` with `service` alley, driveway, parking_aisle or drive-through) | × 1.5 | × 2 | Hidden, no passers-by |
| Tunnel, `layer<0`, `covered=yes`, `building_passage`, `indoor=yes` | × 2 | × 3 | Enclosed, often unlit |
| Midpoint inside industrial land (`landuse` industrial, railway, construction, brownfield, depot) | × 1.5 | × 2.2 | Empty after hours |
| Park path that is not lit | × 1 | × 1.8 | Lonely after dark |
| Lit avenue | × 1 | × 0.95 (`AVENUE_NIGHT_BONUS`) | Small bonus on top of the lit factor |
| 3 or more shops or listed amenities within 40 m | × 0.85 | × 0.75 | Lively |
| 1 or 2 within 40 m | × 0.93 | × 0.88 | Some life |

Lively amenities: restaurant, cafe, bar, pub, fast_food, pharmacy, bank, ice_cream, library, police, marketplace, community_centre, theatre, cinema; any `shop` except `vacant` and `no`.

Examples at night: a tagged-lit residential street is 0.92 × 0.75 = 0.69; a lit avenue is 1 × 0.75 × 0.95 = 0.71; an untagged residential side street is 0.92 × 1.6 = 1.47; an untagged footway is 1 × 1.8 = 1.8; a `lit=no` track is 2.4 × 3 = 7.2, clamped to 6.

### Day / night switch

`night` is a boolean decided once per plan or reroute by `isNightWalk(startMs, walkMs, place)`: dark at the start or dark at the estimated end. There is no gradual blend and no twilight margin (S4.2). `isDark` is `sunAltitude < HORIZON`. Altitude comes from low-precision NOAA-style formulas (a minute or two of error). `sunTimes` returns sunrise and sunset of the local solar day (day start is UTC midnight shifted by 4 minutes per degree of longitude) and nothing when the sun does not cross the horizon that day.

Decision for a walk that crosses sunset (S5): planning at 17:00 for a 90-minute walk with sunset at 17:40 uses night weights for the whole route, because the end is dark. The Info text already says so ("also applies when the walk will end after dark"). A running quest is not re-weighted when sunset passes. A reroute recomputes `night` from its own time and remaining distance, so a quest that leaves the route after sunset gets night weights for the rest. No new product behaviour is introduced. Planning estimates the duration at 4.8 km/h (`WALK_KMH` in `App.tsx`) and reroute at 1.3 m/s (4.68 km/h); the difference is 2.5 % of the duration and matters only within minutes of sunset.

Time zones: the maths is UTC plus longitude. The device's time zone and DST only change how times are labelled (`InfoMenu`). A device with a wrong clock plans for the wrong sun, which is accepted.

### Avoid list semantics

- Stored as display names. Matching uses `normalizeName`: NFD with accents removed, typographic apostrophes (’ ʼ ´ `) folded to ', lower case, spaces collapsed and trimmed. Street-type words are not stripped, so "Calle Mayor" and "Mayor" differ (stripping would also merge "Calle Mayor" with "Plaza Mayor"; see open questions).
- Duplicates are dropped when the normalised names are equal; the first spelling is kept. At most `MAX_AVOID` = 50 names.
- Every walkable way with a matching name is closed, which covers a street mapped as several ways. A street with no `name` tag cannot be avoided.
- A reroute adds the street the walker just left (the nearest named street to where the deviation started) to the avoid list for that reroute only. The stored list is untouched.
- The router treats avoided edges as closed. If no route fits, `planWithSafety` drops the list and names what the route still uses (S7).

### Fallback chain (`planWithSafety`)

1. Safe plus avoid list. If it fits, done.
2. If the list is not empty: safe without the list. If it fits, `notice: 'avoidIgnored'` and `avoidedUsed`.
3. If safe: a normal route with the list. If it fits, `notice: 'safeInfeasible'` and `normal`.
4. If safe and the list is not empty: a normal route without the list. If it fits, `notice: 'safeInfeasible'`, `normal` and `normalAvoidedUsed` (added in review, task 68.7).
5. Otherwise the first (failed) result with its reason and nearest feasible steps.

### Interaction with the ±5 % budget and rerouting

The budget is checked against real length (S2). A weighted search can miss a budget that an unweighted one meets (it prefers a longer lit street, leaving the tuner less room); step 3 handles that case. Rerouting runs the same `planWithSafety` for the remainder and accepts the result only if its steps are within ±5 % of the steps left (`withinBudget`). Its local reconnection uses the same cost array. If nothing fits, no patch is made and the walker keeps the old route.

### Data gaps

`lit` is sparse, `sidewalk` is often missing and shops are mapped unevenly. The model treats "unknown" as a penalty at night for side streets and paths, and as presumed lit for main avenues. In an area with no `lit`, `sidewalk`, shop or industrial data, every edge falls back to type factors and the planner behaves like a mild preference for pedestrian and residential streets. A missing or unknown `highway` gets the neutral type factor and the untagged lighting term.

`routeSafety` reports `lit` as the share of length with an explicit `lit` flag, so presumed-lit avenues do not count there. This is a display choice and is kept.

### Correctness properties

- **P-S1** For any edge facts and either `night`, `safetyFactor` is finite and in [`MIN_FACTOR`, `MAX_FACTOR`].
- **P-S2** `MIN_FACTOR` ≤ 1, and every non-avoided cost from `edgeCosts` is ≥ `min`.
- **P-S3** A route's `distanceM` equals the sum of its real edge lengths and its steps equal `metresToSteps(distanceM)`, with or without weights, day or night.
- **P-S4** At night a street with `lit` costs no more than the same street untagged or `lit=no`.
- **P-S5** A tagged-unlit street (not an avenue) never costs less than the same street untagged.
- **P-S6** `sunAltitude` is finite and continuous: it changes by at most 0.5° per minute, including across UTC midnight and the year turn.
- **P-S7** Away from the exact minute, `isDark(t)` equals `t < sunrise || t > sunset` for the local solar day of `t`, wherever the sun rises and sets.
- **P-S8** Polar day is never dark and polar night is always dark; `sunTimes` returns undefined for both and for non-finite input.
- **P-S9** `normalizeName` ignores case, accents, apostrophe style and spacing, and keeps street-type words.
- **P-S10** `edgeCosts` called twice with the same options returns the same object; day and night costs differ.

### Open questions for the product owner (weights are not changed)

1. **Street-type prefixes.** Should "Calle", "Carrer", "C/", "Av." and "Avenida" be ignored when comparing stored names, so "Colón" equals "Calle Colón"? Search already finds it by substring; only the stored comparison is exact. Stripping could merge different streets ("Calle Mayor" and "Plaza Mayor").
2. **`AVENUE_NIGHT_BONUS` (0.95).** A lit avenue (0.71) is 3 % dearer than a tagged-lit residential street (0.69). The comment says the bonus is "smaller than" the residential one, which holds, but is a near tie what the owner wants?
3. **Clamp at 6.** `lit=no` tracks, tunnels and industrial land all reach 6 at night, so the router cannot tell "very bad" from "terrible". Raise the clamp?
4. **Short tunnels.** An underpass with `layer=-1` counts as a tunnel (× 3 at night) even when it is short and well lit. Exempt short ones (under about 30 m)?
5. **Walk speed.** Planning assumes 4.8 km/h and reroute 1.3 m/s. Should both read one constant?
6. **Parks.** A lit park path at night gets only the lit bonus. Should parks be avoided at night even when lit?
7. **Re-weighting a running quest.** Should a quest planned in daylight re-plan when sunset passes, instead of waiting for a reroute? The current design does not.
