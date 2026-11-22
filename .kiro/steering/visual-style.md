---
inclusion: always
---

# Visual style

A handheld-RPG overworld, in the spirit of Game Boy Color / Game Boy Advance era monster-collecting games, but **entirely original**. Never copy, trace or sample sprites, tiles, palettes or UI from Nintendo, Game Freak or any other commercial game.

## Map

- 16×16 tiles, top-down with a light 3/4 cheat: buildings show a front wall with windows and doors on their south edge.
- Terrains: pale town ground, park grass (with trees and tufts), water with sand shores, asphalt roads with kerbs, sandy footpaths, zebra crossings.
- Auto-tiling everywhere: area terrains use 8-bit blob masks (outer edges, outer and inner corners); paths use 4-bit masks (ends, straights, corners, tees, crossroads).
- One roof colour per building block (flood-filled), from a small palette of five.
- Nearest-neighbour scaling only. Far zoom switches to a 1-pixel-per-tile "town map" in the same palette.
- The route is a trail of red footprints; checkpoints are numbered gold "step gems"; the finish is a chequered flag; the walker is a small kid with a beanie and yellow headphones (our own design); the player dresses it in the Hero tab (boy or girl; skin, hair, cap, shirt and trousers from palettes of 6–8 swatches), and the map walker and header avatar wear that look.
- Shallow diagonal streets get one long asphalt wedge per flat run, so kerbs run straight instead of in stairs.

## UI

- Dark ink background with a subtle dot grid; panels are RPG dialog boxes: black outline with notched 8-bit corners (drawn with offset box-shadows, never border-radius), blue inner rule, warm paper fill, stepped hard drop shadow.
- During a quest the map is the screen of a plain handheld console: plastic body, dark bezel with a power light and two thin stripes. No brand, no logo, no extra console buttons; the existing buttons keep the 8-bit style.
- Press Start 2P for all text, small sizes (7–12 px), no smoothing.
- Chunky bevelled buttons; the primary action is coral red.
- Map data attribution is always visible on the map.

## Palette (see `src/render/palette.ts`)

Ink `#1b1a2e`, paper `#fbf7ec`, frame blue `#5d93c9`, coral `#ff4f6d`, gold `#ffd84a`, grass `#74c45a`, water `#4a8ff0`, asphalt `#8d8ca0`, path `#ecc98f`.

## Accessibility

- Every control offers at least 48 px to press (its own box, or an invisible `::after` press area for compact buttons). Text remains readable on a 390 px wide phone.
- Presses sink by 2 px, click quietly on the effects channel (volume and mute apply) and buzz for 8 ms on Android only.
- Motion is retro and short: 150–250 ms with `steps()` (sheets slide in in steps, the selected tab has a blinking ▶, dialogue boxes a bouncing ▼, the steps meter fills block by block).
- `prefers-reduced-motion` turns all of it off, as well as the walk cycles.
