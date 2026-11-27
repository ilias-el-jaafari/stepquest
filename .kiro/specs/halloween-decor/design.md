# Halloween decor: design

## Modules

| Module | Role |
| --- | --- |
| `src/decor/art.ts` | Sprites as character grids (`DECOR_FRAMES`), the decor palette (`DECOR`), `atlasLayout()` (pure, golden), the pumpkin, gravestone, fog, web, fence and glow drawn by rule (`pumpkinRows`, `graveRows`), the others by hand. |
| `src/decor/place.ts` | `decorInChunk(grid, cx, cy, size)`: lattice sites, terrain tests, kind pick by category, rank order, cache, `forgetDecor(grid, rect?)`. Pure. |
| `src/decor/budget.ts` | `decorBudget(zoom, darkness, enabled)`: visibility, caps per chunk, density; `MAX_ANIMATED`, `ANIM_HZ`, `MAX_STATIC_PER_SCREEN`. Pure. |
| `src/decor/anim.ts` | `tickOf`, bat orbit and flap, fog drift, skeleton wave, flicker. Pure functions of an item and a tick. |
| `src/decor/pref.ts` | The setting: external store, `localStorage`, `?decor=`. |
| `src/render/decorLayer.ts` | `DecorLayer`: atlas canvas, `drawStatic` (scene, before the tint), `drawNight` (glows, hats, after the tint), `drawAnimated` (overlay), the 12 Hz timer. |
| `src/render/MapRenderer.ts` | Wires the layer, builds the keep-out set from the route and markers, `setDecor`. |
| `src/ui/SettingsSheet.tsx`, `MapView.tsx` | The checkbox and the subscription. |

## Placement

Lattice: nodes every 0.000036° of latitude and 0.000044° of longitude (about 4.0 m and 3.8 m at València), each with a jitter in its cell and a hash `hash3(i, j, salt)`. A node is a candidate with probability 0.8, and gives way when a candidate of lower rank is closer than 3.8 m (`crowded`, from the hashes only, checked last because it is the dearest test). For a chunk, the nodes covering its corners are converted to tile coordinates with `grid.toTileXY`; a node counts for the chunk that contains its tile. The lattice and the hashes are geographic, so a different frame or window gives the same sites.

Classification of the site tile (the tile and the one above it must be loaded, free of road, path and crossing, and not under a house; animated items, graves and cobwebs also need the whole 3×3 free of streets):

| Tile | Category | Kinds (weight) |
| --- | --- | --- |
| park (park, garden, grass, orchard) | park | pumpkin 4, jack 3, crow 1.5, candle 1, graves 1.2, bat 2.5, fog 2.5, skeleton 0.6, scarecrow 1, cauldron 0.5, sign 0.8, fence 0.6 |
| park, wood style | wood | spider 4, jack 3, pumpkin 2.5, bat 3, fog 3, crow 1.5, sign 0.8, candle 1 |
| park, cemetery style | cemetery | graves 6, candle 2, crow 2, skeleton 1.2, fog 3, bat 3, jack 1, sign 1 |
| plaza | plaza | lantern 3, pumpkin 3, candle 2, skeleton 1.5, crow 1, jack 2.5, cauldron 1, bat 1.5, fog 1.5, sign 1 |
| ground with building on two perpendicular sides only | web | cobweb at that corner |
| ground within 4 tiles of a landmark | poi | jack 4, pumpkin 3, candle 2, lantern 2, cauldron 1, sign 1, bat 1.2, fog 1.2 |
| ground with streets 2 tiles away on both axes | corner | pumpkin 3, lantern 3, candle 1, fence 2, sign 1.5, jack 2 |
| any other ground, and open yards on building terrain (no house, landmark, tree or gate on the tile, no house just south of it; a front fence is fine; `DecorLayer` builds the tests from the town lookup) | yard | pumpkin 4, jack 2.5, candle 1.5, lantern 1.5, crow 1, bat 1.8, fence 2, scarecrow 0.8, cauldron 0.7, fog 1, sign 0.5 |
| garden tree (town lookup) | tree | spider on a third of the sites |

Gravestone clusters need the whole 3×3 to be green, ground or plaza. The kind is picked by hash. The foot is the site's own position in its tile, so the spacing of the sites is the spacing of what is drawn (moving items sit at least 0.25 tile down). Low kinds (`LOW_KINDS`) may have a house wall in the tile above; tall ones (`TALL_KINDS`) need the second tile above free of streets. A static sprite's half width (`HALF_WIDTH`, art pixels / 32) must not reach a street or a tile without data: it moves inward by at most 0.15 tile or the site is dropped. Moving items keep their whole sprite and orbit inside the clear 3×3 (bat orbit 0.55 × 0.2 tile, fog drift 0.3, fog 20 px wide, bat 13 px).

A chunk keeps `statics` (cobwebs, pumpkins, jacks, candles, lanterns, crows, graves) and `animated` (bats, fog, skeletons), each in rank order; `order` is the static's index. The renderer shows a static when `order < staticPerChunk`, `rank < density`, it is not night-only by day, and its tile is not in the keep-out.

## Drawing order

1. Scene (`paintScene`): chunks, water, tracks, then `drawStatic` (sprites), then the tint, then night lights, then `drawNight` (additive glows at 0.8 × strength, hats with the post's alpha).
2. Frame: scene blit, `drawAnimated` (bats, fog, skeletons, then glow flicker as additive pulses), then the overlay (route, gems, hero, ghost, bubble). Decor never covers any of them.

## Time and motion

`tick = floor(now / 83.3 ms)`, or 0 with reduced motion. Everything moving is a function of (item, tick): same tick, same picture. `drawAnimated` schedules one `setTimeout` aligned to the next step when it drew anything and the user accepts motion; the callback requests a normal frame (no scene redraw).

## Keep-out

`MapRenderer.setRoute` and `setMarkers` mark every tile within 1 of the route (densified to half-tile steps), the start and the finish. The scene is redrawn only when the set really changes, so setting the same route again, or a start on the route, costs nothing.

## Performance notes

The atlas is 128 × 52 px, once per page. Placement per chunk happens once per grid (about 2000 lattice nodes, a handful of terrain reads each; the 8-neighbour spacing test runs only for the sites that passed the terrain tests) when the chunk is first drawn in the scene; the list is reused by every later scene redraw and every animated frame. Per frame the animated pass walks the visible chunks' short lists, stops at 16 and issues one `drawImage` per item. No object, array or string is created in the loops.

## Tests

`src/decor/decor.test.ts` (placement, budget, animation, atlas), `src/decor/pref.test.ts`, `src/render/decorLayer.test.ts` (layer, caps, timer, reduced motion, renderer wiring), two golden frames in `src/render/golden.test.ts`.

## Quest-zoom visibility (requirement H11)

The first browser review (task 89.10) fixed "nothing in a city". The second one (a 390 × 844 phone at 2×, `?time=22:30` and `12:00`, València start) found only two or three tiny pumpkins and lanterns in the free map area. Measured then: 18 static items on the screen, 8 clear of the HUD, each 8 × 7 art pixels. Causes and changes:

1. **Small art.** A pumpkin was half a tree. New art at 13 × 12 for pumpkins and jacks (drawn by rule: ribbed ellipse, highlight, shade, stem and leaf; the jack's face is patched on by hand), and larger bats, skeleton, gravestones, crow, candle, lantern and fog. Nothing is an enlarged old sprite.
2. **The cap binds.** With every cap removed the screen held 47 items; the cap per chunk (44 at zoom 24) cut that to 24. The caps are now 90 at 24 (41 on the screen, about 14 in the free band by night and by day), with 26 at 16 and 10 at 12 so that the zooms below keep their counts. The lattice is denser (0.000036° × 0.000044°, candidates 0.8) and spaced by a hash rule, because a denser lattice alone only made overlapping pumpkins.
3. **Few free tiles.** Front fences no longer block a yard tile; low items may stand against a house wall; wider sprites are checked against their half width.
4. **New pieces** that read at that size: scarecrow, cauldron, haunted signpost, picket fence with a pumpkin, spider on garden trees, a small pumpkin beside a pumpkin.

Alternatives rejected: scaling the old sprites by 2 (mixed pixel densities, the 8 px eyes of the jack become 16 px blocks); raising density without a spacing rule (overlaps, 61,000 items in the demo area with pairs 0.01 tile apart before the rule); drawing decor under the HUD-free band only (the HUD changes with the screen).

Far zoom: nothing in `src/decor` runs below zoom 8, but the lists the lamps, fireflies and decor keep per chunk were thrown away for the whole grid whenever a streamed cell arrived (`forgetLamps(grid)`), and the lamps of a grid were found by one scan of the whole world on the next night draw. See map-rendering design, "Far-pan at night".
