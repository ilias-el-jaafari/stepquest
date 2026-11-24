# Safety and night: Implementation Plan

Part of the StepQuest specs; see [../README.md](../README.md). Task numbers are the original ids from the single spec, so they are not consecutive here. Do not tick a task until `npm test`, `npx tsc -b`, `npm run lint` and `npm run build` pass.

## Safe routes

- [x] 43. Safety cost per edge from OpenStreetMap tags (lit, sidewalks, pedestrian/residential/living streets, alleys and driveways, tunnels and covered passages, unlit paths and tracks, industrial and railway land, shops and cafés within 40 m), as a multiplier on edge length so the step goal and its ±5 % tolerance stay the same
- [x] 44. Safe routing always on (no switch); when the preferred streets cannot fit the goal, say so in neutral words and offer a walk that fits on any street; explained in an Info / FAQ panel from the header
- [x] 45. Streets to avoid: search loaded street names or tap the map, saved on the device, drawn on the map as hazard tape with a no-entry sign, hard-avoided by the router; if a route is impossible without them, plan anyway and name the streets used
- [x] 46. Night awareness, automatic: local sunrise/sunset (no API); from sunset to sunrise (or if the walk ends after dark) lighting and empty areas weigh more, and lit or lively avenues get a small bonus
- [x] 47. Overpass query and demo extract with street names, lighting, sidewalks, industrial land and shops/amenities (codec v3)
- [x] 48. Tests: cost function, street search and nearest street, avoid list, safe/normal/avoid fallbacks, sun times, codec round trip, safety box UI; screenshots in `screenshots/safe-route/`

## Mobile design

- [x] 49b. Field test fixes A: much stronger lighting weight (main avenues presumed lit, unknown side streets penalised), tram/metro/train tracks drawn as rails and never walkable, HUD messages never cover the map buttons, locate centres on the walker during a quest
