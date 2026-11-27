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
| `src/sights/grounds.ts` | `groundKind(landuseClass)`, `linkSights(sights, grounds)` (point in polygon, nearest of the kind, pieces joined by shared end points, sights sharing grounds merged), `areaDistanceM`. Pure. |
| `src/sights/campus.ts` | `buildCampus(grid, town, marks)`: per tile roles (lawn, paving, tree, roof, wall) inside the area, whole-house replacement, main building and crown spot. Pure over a grid. |
| `src/render/campusArt.ts` | Per kind material (`CAMPUS_STYLE`), tile painters for roof, wall, lawn, paving and the night window layer; cached tile bitmaps. |
| `src/render/sightLayer.ts` | Atlas on first use, per-chunk campus bitmaps (day, lit), `drawStatic` (before the tint), `drawNight` (lit windows and halo, after the tint). No labels. |
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

The atlas holds, per kind, the day sprite and a "lit" overlay (only the window and lamp pixels in warm yellow, rest transparent) side by side; painted once, like the decor atlas. `drawStatic` blits day sprites into the cached scene before the tint (so they darken at night). `drawNight` blits the lit overlay and one cached glow (stepped rings, `lighter`) after the tint. There are no name labels on the map (task 92). Culling by screen box; no arrays are built per paint (the placed list is built when it goes stale). The overlay (route, hero, Wisp) draws above the scene, so nothing here can cover them; the keep-out set keeps footprints off the route tiles.

## Wisp and the summary

`announceNext` returns the nearest not-yet-announced mark within `PASS_M` of the hero. `useGhost` calls it when the hero moves, only if no line shows and 20 s have passed since the last sight line (`SIGHT_GAP_MS`). Lines: `ghost.sight.<kind>` (no name) and `ghost.sightNamed.<kind>` (`{name}`, for university, school, hospital and the four monuments), the name cut to 22 characters. The summary reads `passedSights(marks, quest.alongM)`.

## Performance

Static: one `drawImage` per visible sight per scene paint (a few). Nothing runs per frame except what the scene cache already skips. The corridor filter runs when the route or the world's sights change, not per frame. Measured with the 4×-throttled benchmark: see tasks.md.

## Real footprint (task 92)

**Data (measured on the z14 tiles of València, Tarongers and the town hall):** `landuse` holds `university` (1 to 3 per tile), `school` (17 to 21), `hospital` (2 to 3) and also `college`, `kindergarten`, `library`, `stadium`; there is none for places of worship or the town hall (`poi` `town_hall/townhall`, `place_of_worship/*`). `building` polygons carry only `render_height`, `colour`. So `omt.ts` keeps, as `OsmData.grounds` (`Ground = { kind, mode: 'grounds' | 'footprint', ring }`, ring as flat lat/lon, clipped at the tile edge like every polygon): the landuse polygons of the four classes, and the building polygons that contain a sight point of the same tile (or lie within 25 m of it, nearest first). `assemble.ts` hands a piece to the cell of its first vertex, `worldData.ts` merges (identical rings once), `codec.ts` writes `gr` (version 6). Pieces cut by a tile edge are joined when they share an end point (rounded to 1e-6°).

**Linking (`grounds.ts`):** for a sight, the pieces of its kind: the group (joined pieces) containing its point, else the nearest group within 60 m (university also takes `college`); with no `grounds`, the `footprint` group likewise within 25 m. The linked sight keeps the rings. Two sights linked to the same group become one (the better `sightScore`). The corridor filter measures to ring edges (and 0 inside), with a bounding-box pre-test.

**Campus map (`campus.ts`):** for each mark with rings, the tile bounding box is scanned once, a tile belongs to the area when its centre is inside a ring. Roles: `grounds`: building tiles become `roof` or `wall` (a building tile whose south neighbour is not a building is the façade row), non-building ground becomes `lawn`, `paving` (within one tile of a building or a street) or `tree` (hash 1 in 14 of lawn, never beside a building); road, path, crossing and water tiles are left alone. A house lot (from `TownLookup.houseAt`) with at least a third of its tiles in the area is taken whole (tiles not in the area become lawn); lots with less are removed from the area. `footprint`: every area tile not street or water is building. The main building is the 8-connected group of building tiles that holds the tile of the sight's point (else the nearest within 3 tiles, else the largest); its crown spot is the middle of its south row. Pure, deterministic, tested for arbitrary rectangles and polygons.

**Painting:** `campusArt.ts` paints 16 × 16 tiles per (kind, role, edge mask, variant): roof tiles with the kind's pattern and a dark outline on the sides that touch a non-building tile, façade tiles with windows (door at the crown column), lawn, paving and tree tiles. Chunk bitmaps (512 × 512, transparent) are built on first draw into an LRU of 24 and dropped when the map or the marks change; the lit bitmap holds only the window pixels. The crown is the kind's sprite body (no plate) blitted from the atlas, centred on the crown spot, so it can rise above the footprint. Night: the lit bitmaps over the tint and one cached halo sprite per building, scaled to its box, with `lighter`.

**Order:** chunk tiles and houses (existing) -> campus chunk bitmaps (cover the houses) -> crowns and fixed sprites -> decor (skips campus building tiles through `DecorLayer.setBlocked`).
