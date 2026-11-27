# Landmarks: design

## Data source (checked on real València tiles)

The OpenMapTiles `poi` layer of the z14 tiles carries what is needed, so no new request exists. Measured on the tile at the centre of València (`class/subclass`, count): `place_of_worship/christian` 43, `/muslim` 1, `/undefined` 1; `school/school` 47 (+ `kindergarten` 11, not used); `college/university` 5; `college/college` 2; `hospital/hospital` 5 (+ `clinic` 20, not used); `town_hall/townhall` 1 (other `town_hall/*` are community centres and a court: not used); `attraction/attraction` 3; `monument/monument` 6; `castle/castle` 2, `castle/ruins` 3. Fields: `name`, `class`, `subclass`, `rank` (lower is more important, per tile), no `wikidata` and no religion beyond the subclass. Overpass is not used for sights: its enrichment stays what it was (streets). `sightFromTags` also reads real OSM tags (religion, wikidata, wikipedia) when an Overpass or fixture extract carries them (`normalize.ts`), so a richer source needs no new code.

Artworks (`art_gallery/artwork`, 62 in the same tile: falla statues, murals) are not monuments here.

## Modules

| Module | Role |
| --- | --- |
| `src/sights/types.ts` | `SightKind`, `Sight` (stored), `SightMark` (kept for a route: id, kind, lat, lon, name, alongM, lateralM). |
| `src/sights/classify.ts` | `sightFromPoi(props)` (OpenMapTiles), `sightFromTags(tags)` (OSM), `monumentStyle`, `monumentScore`, `dedupeSights`. Pure. |
| `src/sights/route.ts` | `sightsAlongRoute(sights, polyline, corridorM)` (projection, segment distance, `alongM`), `topMonuments(sights, n)`, `passedSights(marks, alongM)`, `announceNext(player, marks, announced, passM)`. Pure. |
| `src/sights/art.ts` | Palette `SIGHT`, one `Sprite` per kind built from a tiny grid builder, `litOverlay`, `sightAtlasLayout`. Pure. |
| `src/sights/place.ts` | `placeSights(marks, grid, keep, town)`: free spot search, no overlap. Pure over a grid. |
| `src/sights/useSights.ts` | Hook: world sights + route -> marks, with the quest's top two fixed. |
| `src/render/sightLayer.ts` | Atlas on first use, `drawStatic` (before the tint), `drawNight` (lit windows and glow, after the tint), `drawLabels`. |
| `src/ghost/director.ts` | `sightLine(mark)`: key and placeholders for Wisp. |
| `src/ui/SummaryScreen.tsx` | The "Places discovered" list. |

## Pipeline

1. `omt.ts` reads each `poi` point through `sightFromPoi` and adds it to `OsmData.sights` (not for coarse tiles). `assemble.ts` hands each sight to the cell that contains it, `worldData.ts` merges and dedupes (`dedupeSights`), `snapshot()` exposes `world.data.sights`. The drawn cells (the only records that carry sights; walking records are streets only) reach the data through `LiveWorld.addDrawn` -> `WorldData.addSights`; when the list grows the current world snapshot gets a new identity with the longer list and keeps its graph and safety context (`withSights`).
2. `codec.ts` writes `sg` (`[kindIndex, lat1e6, lon1e6, rank, nameIndex, flags]` rows, names in `sgn`) and `CODEC_VERSION` becomes 5, so cached tiles without sights are replaced by the normal cache rules (7 days, no extra request). Decoding versions 1 to 4 gives no sights.
3. `useSights(world, routePoints, { lock })` gives the marks: all kinds except monuments are kept when inside the corridor; monuments only when among the top two, which are computed once per route identity in a quest (`lock`) and live in the planner.
4. `MapView` passes the marks to `MapRenderer.setSights`. The renderer marks its placement stale on a new mark list, a new keep-out set or a source change, and places lazily at the next scene paint.
5. `QuestScreen` gives the marks to `useGhost` (Wisp) and to the summary (`passedSights`).

## Importance score

`score = classWeight + (name ? 20 : 0) + (wikidata ? 25 : 0) + (wikipedia ? 25 : 0) + max(0, 40 − rank/5)`; order by score descending, then `name` (locale-free compare), then `lat`, then `lon`. The sort is total, so shuffled input gives the same two.

## Corridor maths

Local equirectangular projection around the first route point (`LocalProjection`); for each sight the minimum point-to-segment distance over the polyline, with a bounding-box pre-test per segment chunk (routes have a few thousand points, sights a few hundred). `alongM` is the cumulative length to the projection of the closest segment.

## Placement

Sprite size in tiles: `ceil(w/16)` by `ceil(h/16)`, base row at the bottom. Candidates are the tiles within 6 tiles of the point in rings of growing radius (ties by row, then column). A candidate is valid when every tile of the footprint is in bounds, loaded (`covered`), not road, path, crossing, plaza-street or water, not in the keep-out set, and not taken by a sight placed before. Order of placement: by `alongM`. Result per mark: tile x, y of the footprint's south-west corner or none.

## Rendering

The atlas holds, per kind, the day sprite and a "lit" overlay (only the window and lamp pixels in warm yellow, rest transparent) side by side; painted once, like the decor atlas. `drawStatic` blits day sprites into the cached scene before the tint (so they darken at night). `drawNight` blits the lit overlay and one cached glow (stepped rings, `lighter`) after the tint. Labels use `ctx.font` of the pixel font at `max(6, 0.3 × zoom)` px with a paper stroke; drawn after the tint. Culling by screen box; no arrays are built per paint (the placed list is built when it goes stale). The overlay (route, hero, Wisp) draws above the scene, so nothing here can cover them; the keep-out set keeps footprints off the route tiles.

## Wisp and the summary

`announceNext` returns the nearest not-yet-announced mark within `PASS_M` of the hero. `useGhost` calls it when the hero moves, only if no line shows and 20 s have passed since the last sight line (`SIGHT_GAP_MS`). Lines: `ghost.sight.<kind>` (no name) and `ghost.sightNamed.<kind>` (`{name}`, for university, school, hospital and the four monuments), the name cut to 22 characters. The summary reads `passedSights(marks, quest.alongM)`.

## Performance

Static: one `drawImage` per visible sight per scene paint (a few). Nothing runs per frame except what the scene cache already skips. The corridor filter runs when the route or the world's sights change, not per frame. Measured with the 4×-throttled benchmark: see tasks.md.
