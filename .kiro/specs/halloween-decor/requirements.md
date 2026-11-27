# Halloween decor: requirements

## Introduction

StepQuest is a Kiroween entry, so the map gets a light, tasteful Halloween dressing: pumpkins and jack-o'-lanterns, bats, cobwebs, skeletons, gravestones, fog, candles and lanterns, crows and a witch hat on some lamp posts. All of it is pixel art we draw in code (no external assets, nothing from another game or brand), placed deterministically from the map data, cheap to draw, and quiet by day.

## Glossary

- **Decor item**: one placed sprite (or a cluster of up to three gravestones) with a kind, a foot position in tile units, a rank and a phase.
- **Site**: a candidate spot on a fixed geographic lattice (about 5 to 6 m apart) with a hash-seeded jitter, kind and rank.
- **Rank**: a stable number from 0 to 1 per item. An item is shown when its rank is below the budget's density and its place in the chunk's rank order is within the chunk's cap.
- **Static item**: drawn into the cached scene. **Animated item** (bats, fog, waving skeletons) and the flicker of lit items: drawn in the overlay.
- **Atlas**: one offscreen canvas holding every decor frame, painted once.
- **Keep-out**: the tiles within 2 of the route, the start and the finish.

## Requirements

### Requirement H1: Original art, painted once

1. THE SYSTEM SHALL draw every decor sprite as a character grid in `src/decor/art.ts` (our own designs and colours, documented in `visual-style.md`), with no image, audio or font file added and nothing taken from another game, character or brand. The hook `assets-guard` applies to any file that is added.
2. THE SYSTEM SHALL paint all frames once into a single offscreen atlas (128 px wide, row-packed with a 1 px gutter, 22 frames, 27 px high) and only blit from it afterwards.

### Requirement H2: Kinds

1. THE SYSTEM SHALL offer: pumpkin, jack-o'-lantern (lit face and glow at night), bat (two wing frames, animated, night only), cobweb (four corner orientations), sitting skeleton (two frames, waving), gravestone clusters of one to three (three shapes), fog wisp (night only), crow, candle (lit at night), small lantern (lit at night), and a witch hat on some lamp posts (night only, with the post).

### Requirement H3: Placement is deterministic and sensible

1. THE SYSTEM SHALL place decor from a seeded hash of a fixed latitude and longitude lattice, so the same place gets the same decor on every visit and whatever grid, frame or window the map was cut from.
2. THE SYSTEM SHALL anchor decor to: park and green tiles (not pitches, playgrounds or farmland; gravestones and fog are favoured in cemeteries), plazas, ground tiles within 4 tiles of a landmark, ground tiles at the corner of a lot between two streets, and concave building corners and ground next to them (cobwebs).
3. THE SYSTEM SHALL NOT place decor on a tile whose 3×3 neighbourhood holds a road, path or crossing, on water or a building tile, or on a tile with no loaded data. Bat orbits (up to 0.9 tile) and fog drift (up to 0.5 tile) stay inside that neighbourhood.
4. THE SYSTEM SHALL NOT draw static decor on a keep-out tile, and SHALL NOT draw an animated item within 1.5 tiles of the hero. The overlay, the hero, the ghost, the gems and the UI always come after the decor in draw order.
5. THE SYSTEM SHALL compute a chunk's items once (32 × 32 tiles, cached with the grid like lamps and fireflies, forgotten when the chunk's tiles change) and keep them in rank order.
6. EXCEPTION: the witch hat sits on an existing lamp post, which stands on a street kerb; it is part of that street fixture, not an object placed on the street. It appears on one post in five (hash of the post's tile) and only where the post is drawn.

### Requirement H4: Density and zoom

1. THE SYSTEM SHALL hide decor below the detail zoom (8 CSS px per tile) and draw it at the zoom's scale, so sprites are smaller further out.
2. THE SYSTEM SHALL cap static items per chunk by zoom: 2 at zoom 8, 3 at 12, 4 at 16, 5 at 24, 6 at 32 and above (linear between). On a 390 × 844 phone screen no zoom shows more than 16 static items.

### Requirement H5: Day and night

1. WHILE the day-cycle darkness is below 0.3, THE SYSTEM SHALL show 55 % of the items (by rank), unlit, with no bats, fog, glows or hats and at most one animated item per chunk (waving skeletons).
2. WHILE the darkness is 0.3 or more, THE SYSTEM SHALL show every ranked item, light the jack-o'-lanterns, candles and lanterns, add stepped additive glows, put hats on lamp posts, fly bats, drift fog and flicker the glows (animated items per chunk: 1 below zoom 12, 2 below 24, 3 above).
3. THE SYSTEM SHALL draw sprites before the sky tint (so night tints them) and glows and hats after it.

### Requirement H6: Animation is capped and slow

1. THE SYSTEM SHALL draw at most 12 animated items (including flickers) per frame, nearest the screen centre first, and SHALL step their motion at no more than 12 Hz (`tickOf`). Bats loop slowly (14 to 22 s per orbit; under 1 tile per second) and flap at 6 Hz; fog drifts over 30 s; skeletons wave at 3 Hz.
2. THE SYSTEM SHALL run one timer, aligned to the next 12 Hz step, only while an animated item is drawn, and none otherwise.

### Requirement H7: Reduced motion

1. WHEN `prefers-reduced-motion` is set, THE SYSTEM SHALL stop all decor motion: tick 0, the first wing and wave frames, no drift, steady glows, no flicker and no timer.

### Requirement H8: Performance

1. THE SYSTEM SHALL NOT allocate per frame in the decor passes (atlas slots in a precomputed table, items in cached arrays, no strings built in the loop), SHALL NOT redraw the scene for a walker move, a pan inside the margin or the animation timer, and SHALL redraw it only for a change of light, setting, zoom, chunk data or keep-out.
2. THE SYSTEM SHALL keep the 4×-throttled phone profile at about 55 to 60 fps while walking and panning and add no long task. (Measure with the existing frame profile before release; the passes are at most one `drawImage` per item.)

### Requirement H9: Setting

1. THE SYSTEM SHALL offer "Halloween decor" / "Decoración de Halloween" in Settings, on by default, kept in `localStorage` (`stepquest.decor`), and `?decor=0` or `?decor=1` SHALL override it for a visit. Switching it redraws the map at once.

### Requirement H10: Tests

1. THE SYSTEM SHALL test: seeded determinism (property test, also across a grid built again), no overlap with street geometry, rank order, density caps per screen at each zoom, zoom scaling, day/night differences, reduced motion, the animated cap and timer, keep-out, the setting, the atlas layout (golden: 128 × 27, 22 frames) and two golden frames (day and night) in `golden.test.ts`. The older golden frames are drawn with the decor off, so their hashes are unchanged.
