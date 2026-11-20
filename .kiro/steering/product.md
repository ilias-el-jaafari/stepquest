---
inclusion: always
---

# Product Overview

StepQuest (working name; the display name lives in `APP_NAME` in `src/config/brand.ts`) turns a daily step goal into an 8-bit overworld quest on real streets. It is the Kiroween 2026 entry in the **Resurrection** category by Ilias El Jaafari El Idrissi: it brings back the handheld-RPG overworld (tile maps, auto-tiling, chiptune, formant speech) and points it at a modern habit, walking 10,000 steps.

## Who it is for

People who already chase a daily step count and want a reason to walk a new route: pick a start, choose a loop or an A→B walk, set a goal, and get a route that matches it, with checkpoints to collect on the way.

## Core promise

- Type a step goal (10,000 by default) and a stride (0.75 m by default); get a pedestrian route within ±5 % of that distance.
- **Loop** returns to the start. **A → B** ends elsewhere and adds detours to reach the goal.
- If the goal cannot fit (shorter than the direct A→B path, or larger than the loaded area allows), say so plainly and suggest the nearest feasible number of steps.
- The map is the real street layout from OpenStreetMap, drawn as a 16×16 tile overworld with original pixel art.

## Phases

1. **Route planner and tile map** (this phase): OSM data (bundled Benicalap demo + live Overpass with cache), rasterization to a tile grid, 4/8-bit auto-tiling, an original procedural tileset, loop and A→B routing to a step target, evenly spaced checkpoints, a retro UI in English and Spanish.
2. **Walk it**: geolocation, live position on the map, checkpoint collection, progress.
3. **Sound**: an original 80s-style formant speech synthesizer for turn-by-turn and progress callouts (written from scratch; do not port SAM or any other third-party synth), plus a procedural chiptune whose tempo follows walking speed.
4. **Polish and submission**: onboarding, demo video, write-up.

## Non-goals

- No copyrighted assets: no sprites, tiles, music, fonts or sounds ripped from Nintendo or any other game. Everything is drawn or synthesized by us, or uses an open licence (the pixel font is OFL).
- No accounts or servers of our own. Map data comes from OpenStreetMap (ODbL) and must always be credited on screen.
- No turn-by-turn traffic navigation; this is a walking game, and the user must still watch the real street.

## Success

On a phone in Benicalap, a user sets 10,000 steps, presses one button, and sees a pixel-art loop of about 7.5 km with 10 checkpoints, before 4 December 2026, 23:00 Europe/Madrid.
