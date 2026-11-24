# Safety and night: Implementation Plan

Part of the StepQuest specs; see [../README.md](../README.md). Task numbers are the original ids from the single spec, so they are not consecutive here. Do not tick a task until `npm test`, `npx tsc -b`, `npm run lint` and `npm run build` pass.

## Safe routes

- [x] 43. Safety cost per edge from OpenStreetMap tags (lit, sidewalks, pedestrian/residential/living streets, alleys and driveways, tunnels and covered passages, unlit paths and tracks, industrial and railway land, shops and cafés within 40 m), as a multiplier on edge length so the step goal and its ±5 % tolerance stay the same (S2, S3)
- [x] 44. Safe routing always on (no switch); when the preferred streets cannot fit the goal, say so in neutral words and offer a walk that fits on any street; explained in an Info / FAQ panel from the header (S1, S7)
- [x] 45. Streets to avoid: search loaded street names or tap the map, saved on the device, drawn on the map as hazard tape with a no-entry sign, hard-avoided by the router; if a route is impossible without them, plan anyway and name the streets used (S6, S7)
- [x] 46. Night awareness, automatic: local sunrise/sunset (no API); from sunset to sunrise (or if the walk ends after dark) lighting and empty areas weigh more, and lit or lively avenues get a small bonus (S4, S5, S8)
- [x] 47. Overpass query and demo extract with street names, lighting, sidewalks, industrial land and shops/amenities (codec v3) (S9)
- [x] 48. Tests: cost function, street search and nearest street, avoid list, safe/normal/avoid fallbacks, sun times, codec round trip, safety box UI; screenshots in `screenshots/safe-route/`

## Mobile design

- [x] 49b. Field test fixes A: much stronger lighting weight (main avenues presumed lit, unknown side streets penalised), tram/metro/train tracks drawn as rails and never walkable, HUD messages never cover the map buttons, locate centres on the walker during a quest (S3, S8)

## Spec rework and review (Nov 2026)

- [x] 68.1 Requirements S1 to S10, the "Architecture and review" design section (cost model, tag table with rationale, day/night switch, avoid semantics, fallbacks, budget and reroute, data gaps), correctness properties and open questions; README index updated
- [x] 68.2 Review of `safety.ts`, `safePlanner.ts`, `sun.ts`, `avoidList.ts` and the reroute and App callers against S1 to S10; findings in the design section; weight values untouched
- [x] 68.3 Sun, local solar day: failing test first (`sunTimes` used the UTC day, so far from Greenwich it returned the wrong day and `isDark` disagreed with it); `sunTimes` now uses the local solar day and returns undefined for non-finite input (S4.4, S4.5)
- [x] 68.4 Sun property tests: `isDark` agrees with sunrise and sunset over a latitude/longitude/date grid, altitude is finite and continuous across UTC midnight and the year turn, polar day and night, Tromsø edge, DST day (S4)
- [x] 68.5 One night rule: `isNightWalk` in `sun.ts` shared by planning (`App.tsx`) and rerouting (`reroute.ts`), with tests for a walk crossing sunset, a walk ending before sunset, a walk starting in the dark and an invalid duration (S5)
- [x] 68.6 Avoid-name matching: failing test first (typographic and straight apostrophes, as in "l’Albereda", did not match); `normalizeName` folds them. Tests pin that street-type words are not stripped and that duplicates are listed once (S6.2, S6.3)
- [x] 68.7 Fallback gap: failing test first (when safe routing could not fit and the only street that fits was on the avoid list, no normal route was offered); `planWithSafety` now offers a normal route without the list and `normalAvoidedUsed` names the streets, shown in the notice (S7.3)
- [x] 68.8 Cost-model property tests: factor finite and in [0.6, 6] for any input, `min` ≤ 1 and every cost ≥ `min`, lit never costlier than unlit or untagged at night, tagged-unlit never cheaper than untagged, route length and steps unchanged by weights (day and night), cost array cached per option set (S2, S8)
- [x] 68.9 Open questions recorded in design.md for the product owner (street-type prefixes, avenue bonus, clamp, short tunnels, walk speed, parks, re-weighting a running quest)
