# Halloween decor: design

## Modules

| Module | Role |
| --- | --- |
| `src/decor/art.ts` | Sprites as character grids (`DECOR_FRAMES`), the decor palette (`DECOR`), `atlasLayout()` (pure, golden), the web and glow drawn by rule. |
| `src/decor/place.ts` | `decorInChunk(grid, cx, cy, size)`: lattice sites, terrain tests, kind pick by category, rank order, cache, `forgetDecor`. Pure. |
| `src/decor/budget.ts` | `decorBudget(zoom, darkness, enabled)`: visibility, caps per chunk, density; `MAX_ANIMATED`, `ANIM_HZ`, `MAX_STATIC_PER_SCREEN`. Pure. |
| `src/decor/anim.ts` | `tickOf`, bat orbit and flap, fog drift, skeleton wave, flicker. Pure functions of an item and a tick. |
| `src/decor/pref.ts` | The setting: external store, `localStorage`, `?decor=`. |
| `src/render/decorLayer.ts` | `DecorLayer`: atlas canvas, `drawStatic` (scene, before the tint), `drawNight` (glows, hats, after the tint), `drawAnimated` (overlay), the 12 Hz timer. |
| `src/render/MapRenderer.ts` | Wires the layer, builds the keep-out set from the route and markers, `setDecor`. |
| `src/ui/SettingsSheet.tsx`, `MapView.tsx` | The checkbox and the subscription. |

## Placement

Lattice: nodes every 0.00005° of latitude and 0.00006° of longitude (about 5.6 m and 5.1 m at València), each with a jitter in its cell and a hash `hash3(i, j, salt)`. A node is a candidate with probability 0.2. For a chunk, the nodes covering its corners are converted to tile coordinates with `grid.toTileXY`; a node counts for the chunk that contains its tile. The lattice and the hashes are geographic, so a different frame or window gives the same sites.

Classification of the site tile (the 3×3 around it must be loaded and free of road, path, crossing):

| Tile | Category | Kinds (weight) |
| --- | --- | --- |
| park (park, garden, grass, wood, orchard) | park | pumpkin 4, jack 2, crow 1.5, candle 1, graves 1, bat 2, fog 2, skeleton 0.3 |
| park, cemetery style | cemetery | graves 6, candle 2, crow 2, skeleton 1, fog 3, bat 2, jack 1 |
| plaza | plaza | lantern 3, pumpkin 3, candle 2, skeleton 1.5, crow 1, jack 2 |
| ground with building on two perpendicular sides only | web | cobweb at that corner |
| ground within 4 tiles of a landmark | poi | jack 4, pumpkin 3, candle 2, lantern 2 |
| ground with streets 2 tiles away on both axes | corner | pumpkin 3, lantern 3, candle 1 |

Gravestone clusters need the whole 3×3 to be green, ground or plaza. The kind is picked by hash, the foot lies at 0.25 to 0.75 across and 0.55 to 0.95 down the tile, and sprites are at most 16 art pixels wide, so they stay inside the clear 3×3.

A chunk keeps `statics` (cobwebs, pumpkins, jacks, candles, lanterns, crows, graves) and `animated` (bats, fog, skeletons), each in rank order; `order` is the static's index. The renderer shows a static when `order < staticPerChunk`, `rank < density`, it is not night-only by day, and its tile is not in the keep-out.

## Drawing order

1. Scene (`paintScene`): chunks, water, tracks, then `drawStatic` (sprites), then the tint, then night lights, then `drawNight` (additive glows at 0.6 × strength, hats with the post's alpha).
2. Frame: scene blit, `drawAnimated` (bats, fog, skeletons, then glow flicker as additive pulses), then the overlay (route, gems, hero, ghost, bubble). Decor never covers any of them.

## Time and motion

`tick = floor(now / 83.3 ms)`, or 0 with reduced motion. Everything moving is a function of (item, tick): same tick, same picture. `drawAnimated` schedules one `setTimeout` aligned to the next step when it drew anything and the user accepts motion; the callback requests a normal frame (no scene redraw).

## Keep-out

`MapRenderer.setRoute` and `setMarkers` mark every tile within 2 of the route (densified to half-tile steps), the start and the finish. The scene is redrawn only when the set really changes, so setting the same route again, or a start on the route, costs nothing.

## Performance notes

The atlas is 128 × 27 px, once per page. Placement per chunk happens once per grid (about 1000 lattice nodes, a handful of terrain reads each) when the chunk is first drawn in the scene; the list is reused by every later scene redraw and every animated frame. Per frame the animated pass walks the visible chunks' short lists, stops at 12 and issues one `drawImage` per item. No object, array or string is created in the loops.

## Tests

`src/decor/decor.test.ts` (placement, budget, animation, atlas), `src/decor/pref.test.ts`, `src/render/decorLayer.test.ts` (layer, caps, timer, reduced motion, renderer wiring), two golden frames in `src/render/golden.test.ts`.
