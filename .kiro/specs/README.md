# StepQuest specs

## Introduction

StepQuest turns a step goal into an 8-bit overworld quest on real streets. The user picks a start point, a loop or an A→B walk, a step goal and a stride; the app plans a pedestrian route that matches the goal, places checkpoints along it, and draws it on a pixel-art tile map generated from OpenStreetMap. These specs cover the whole product; Phase 1 (planner and tile map) is implemented first.

## Glossary

- **Stride**: metres per step (default 0.75 m). Target distance = steps × stride.
- **Tolerance**: a route matches the goal when its length is within ±5 % of the target distance.
- **Tile**: a 16×16 pixel cell representing about 5 × 5 m.
- **Blob mask**: an 8-neighbour bitmask where diagonals only count when both adjacent cardinals match, giving 47 distinct tiles.
- **Checkpoint**: a point on the route the walker collects; checkpoint k sits at k/N of the route length, the last one being the finish.

## Feature specs

Each folder holds `requirements.md`, `design.md` and `tasks.md`. Requirement ids and task numbers are the original ones from the former single spec (`step-quest`), so they are not consecutive within a folder. Each id lives in exactly one spec.

| Spec | Covers | Requirements | Tasks |
| --- | --- | --- | --- |
| [routing](routing/requirements.md) | planner, ±5 % budget, loop and A→B, checkpoints, roundabouts, fast rerouting, worker | 3, 4, 7b, 7c, 8, 9, 10 | 8, 33, 49d, 51b, 54, 56, 61 |
| [safety-night](safety-night/requirements.md) | safety weights, night lighting from sunset, avoid-streets list | none numbered (see its requirements.md) | 43 to 48, 49b |
| [map-rendering](map-rendering/requirements.md) | OSM data, Overpass client and cache, tiles, auto-tiling, chunks, town and landmarks, route path, walker, no black areas, auto-load | 1, 2, 6a, 7a, 9, 10 to 13 | 3 to 7, 10, 22 to 27, 31, 32, 50b, 51, 58, 60, 63 |
| [voice-audio](voice-audio/requirements.md) | formant speech, callouts, speech bubbles, chiptune, effects, sound settings, audio engine robustness | 7, 7d, 7e, 7f | 34 to 42, 50, 59, 62 |
| [retro-ui](retro-ui/requirements.md) | planner and app frame, console buttons, dialogue box, hero, i18n EN/ES and plurals, engineering rules, submission | 5, 5b, 8 | 1, 2, 9, 21a, 28, 29, 49, 49e, 52, 53, 55, 57 |
| [quest](quest/requirements.md) | GPS and filter, snapping, gems, quest state, persistence, wake lock, simulation, finish | 6, 6b | 11 to 21, 30, 49c, 64 |

Where a requirement touches another spec (for example the speech bubble is voice behaviour drawn by the map renderer), the owning spec holds it and the others link to it.

## Shared notes

- Tests run on the bundled fixture and never use the network; each spec's design lists what it tests.
- `.kiro/steering/routing.md` and `.kiro/steering/osm-etiquette.md` hold the working rules for routing, safety weights and Overpass.
- The hook `spec-sync` keeps these specs in line with the code.
