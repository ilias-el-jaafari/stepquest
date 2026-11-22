# Implementation Plan

Tasks are grouped by phase. Do not start the next phase until the current phase builds, its tests pass, and the UI can be demonstrated with screenshots.

## Phase 1 — Route planner and tile map

- [x] 1. Scaffold Vite + React + TypeScript (strict), Vitest, Oxlint, GitHub Pages workflow, EN/ES i18n and the brand constant
  - _Requirements: 5.3, 8.2_
- [x] 2. Add `.kiro` steering (product, tech, structure, visual style), this spec, and hooks (tests and lint on save)
  - _Requirements: 8.1_
- [x] 3. OSM layer: tag classification, Overpass normalization with shared nodes, compact codec, bundled Benicalap fixture
  - _Requirements: 1.1, 3.6_
- [x] 4. Polite Overpass client with IndexedDB cache, throttling, size cap and fallback endpoint (mocked tests)
  - _Requirements: 1.2, 1.3, 1.4_
- [x] 5. Tile grid and rasterization (polygons, thick roads, 4-connected paths, crossings) with fixture tests
  - _Requirements: 2.1, 2.2, 2.3_
- [x] 6. Auto-tiling: 4-bit and 8-bit blob masks with exhaustive tests
  - _Requirements: 2.4_
- [x] 7. Original procedural tileset, sprites and chunked canvas renderer with pan/zoom and overview map
  - _Requirements: 2.5, 2.6, 1.5_
- [x] 8. Walking graph, A*, loop and A→B planners tuned to ±5 %, feasibility reasons, checkpoints
  - _Requirements: 3.1–3.8, 4.1, 4.2_
- [x] 9. Retro UI: mode, tap-to-place, goal presets, stride, plan / another route, quest log, live-area loader
  - _Requirements: 5.1, 5.2, 5.3_
- [x] 10. Screenshots (390×844 and 1280×800) of a 10k loop and an A→B route in `screenshots/phase1/`

## Phase 2 — GPS and checkpoints

- [x] 11. "Use my location": one-shot high-accuracy fix, start point set, live Overpass area loaded when outside the map; denied / timeout / unavailable / insecure / unsupported / too-inaccurate messages in EN and ES
  - _Requirements: 6.1, 6.7_
- [x] 12. GPS noise filter: accuracy gate (50 m), max-speed sanity (7 m/s, reset after 3 agreeing outliers), Kalman smoothing, jitter-proof odometer
  - _Requirements: 6.2_
- [x] 13. Route snapping with a progress window (loops that cross themselves), off-route detection with a direction hint
  - _Requirements: 6.3, 6.6_
- [x] 14. Active quest: watchPosition source, walker follows the snapped position, camera follow (drag to unfollow), walked trail turns gold
  - _Requirements: 6.3_
- [x] 15. Checkpoint collection in route order (22 m radius growing with poor accuracy, max 35 m; "walked past" also counts), pickup sparkle + toast + square-wave beep, finish fanfare
  - _Requirements: 6.4, 6.5_
- [x] 16. HUD: next checkpoint, distance and direction, gems collected/total, walked distance, steps (distance ÷ stride), time, pace, GPS status (waiting, weak, lost)
  - _Requirements: 6.5_
- [x] 17. Quest complete screen with stats and "New quest"
  - _Requirements: 6.5_
- [x] 18. Persistence in localStorage (resume after reload or lost signal, same map restored), Screen Wake Lock with re-acquire on visibility change
  - _Requirements: 6.8_
- [x] 19. Walk simulator (speed ×1–×120, optional GPS noise and glitches) for testing and the demo video; resumable
  - _Requirements: 6.9_
- [x] 20. Tests: filter, snapping, collection (order, radius, accuracy), off-route, persistence and resume, finish condition, simulated walk end-to-end on the fixture, geolocation and wake-lock adapters, App flows
- [x] 21. Screenshots of the HUD mid-route, a pickup and the complete screen in `screenshots/phase2/`
- [x] 21a. Fix: step goal and stride fields accept free typing (raw text, validated and clamped only on blur, Enter or Plan, with an inline hint); goal range 100–60,000 steps; retro slider 500–30,000 synced both ways with the field
  - _Requirements: 5.1_

## Phase 3 — Visual polish

- [x] 22. Town layout: building blocks cut into lots (BSP, 4–7 × 4–6 tiles), up to three houses per lot (largest free rectangle, at least 2 × 2), six roof and four wall colours, house / apartment / warehouse styles from the OSM building type, front yards with picket fences or hedges and gates, side gardens, garden trees; cached per grid and painted into the chunk canvases
- [x] 23. Landmarks from OSM points: hospitals and public health centres (healing-centre building with an original cross sign), metro and train stations, schools, park entrances (gates on paths entering big parks), and supermarkets (one chain gets a green special shop with original basket and leaf signs; the rest a generic shop). No brand names, logos or game-specific designs are drawn
- [x] 24. Terrain variety: park styles (lawn with flowers, tall grass, sports pitches, playgrounds, woods, farmland, orchards, cemeteries, gardens), squares and plazas, water with a foam shore, fences, hedges and walls from `barrier=*`, building lots as lawn
- [x] 25. Diagonal streets softened with asphalt corner triangles; footpath corners drawn as quarter rings
- [x] 26. Route drawn as one continuous band (4-connected cells, staircase corners smoothed) with an outline, centre dots and direction arrows every 6 tiles; walked part turns gold
- [x] 27. Walker with four facings from its movement (with hysteresis) and a 3-frame walk cycle; tweened between fixes; reduced-motion aware
- [x] 28. Classic RPG dialogue box (typewriter, blinking marker, tap / Enter to skip or continue, auto-close while walking) for the quest start, each pickup and the finish
- [x] 29. Fix: proper plural forms in EN and ES for every count (checkpoints, steps, gems), chosen with `Intl.PluralRules`
- [x] 30. Fix: once the quest is finished, signal and route warnings are hidden and `watchPosition` and the wake lock are released; late fixes are ignored
- [x] 31. Tests: lot subdivision, largest rectangle, town layout on synthetic and fixture grids, landmark tag mapping and dedupe, way styles, codec v2 (and v1 decoding), diagonal corners, route continuity, arrows and smoothing, walker frames and facing, structure painters, dialogue box, plurals, finished-quest banner and watch stop
- [x] 32. Before / after screenshots (390×844 in Spanish, 1280×800 in English) in `screenshots/phase3/`
- [ ] 33. Run planning in a Web Worker if larger live areas make the UI stutter

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

## Safe routes

- [x] 43. Safety cost per edge from OpenStreetMap tags (lit, sidewalks, pedestrian/residential/living streets, alleys and driveways, tunnels and covered passages, unlit paths and tracks, industrial and railway land, shops and cafés within 40 m), as a multiplier on edge length so the step goal and its ±5 % tolerance stay the same
- [x] 44. Safe routing always on (no switch); when no safer route meets the goal, say so and offer the normal route; explained in an Info / FAQ panel from the header
- [x] 45. Streets to avoid: search loaded street names or tap the map, saved on the device, drawn on the map as hazard tape with a no-entry sign, hard-avoided by the router; if a route is impossible without them, plan anyway and name the streets used
- [x] 46. Night awareness, automatic: local sunrise/sunset (no API); from sunset to sunrise (or if the walk ends after dark) lighting and empty areas weigh more, and lit or lively avenues get a small bonus
- [x] 47. Overpass query and demo extract with street names, lighting, sidewalks, industrial land and shops/amenities (codec v3)
- [x] 48. Tests: cost function, street search and nearest street, avoid list, safe/normal/avoid fallbacks, sun times, codec round trip, safety box UI; screenshots in `screenshots/safe-route/`

## Mobile design

- [x] 49. App frame: header with title and steps today, full-height map, framed planner above a bottom tab bar (Map, Bag, Hero, Settings) with original pixel icons; side rail on wide screens; existing panels moved into tabs and sheets; iPhone safe areas, web app manifest and home-screen icons; quest dialogue kept clear of the map credit line
- [x] 49b. Field test fixes A: much stronger lighting weight (main avenues presumed lit, unknown side streets penalised), tram/metro/train tracks drawn as rails and never walkable, HUD messages never cover the map buttons, locate centres on the walker during a quest
- [x] 49c. Field test fixes B: footprints route (walked prints darker), follow mode, adaptive rerouting, map-area loading (auto-load around GPS, "Load this area", mirror race, worker, area cache, progress)
- [ ] 50. Speech bubbles on the map
- [ ] 51. New tile art

## Phase 5 — Submission

- [ ] 52. Onboarding, logo
- [ ] 53. Public repo with `/.kiro`, OSI licence, Pages deploy, demo video under 3 minutes, write-up
