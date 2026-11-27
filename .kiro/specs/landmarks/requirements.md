# Landmarks (sights along the route): requirements

## Introduction

A walk should show what is worth seeing on it. StepQuest draws a few **sights** (faculties, schools, hospitals, places of worship, the town hall and the city's two best-known monuments) as original pixel-art buildings, but only the ones that lie along the planned route, so every route reveals different places. Wisp points them out as the hero passes, and the end-of-quest summary lists the places discovered.

## Glossary

- **Sight**: a point of interest of one of the kinds below, with a name when the data has one.
- **Corridor**: the strip within `CORRIDOR_M` (50 m) of the route polyline. A sight outside it is never drawn.
- **Pass radius**: `PASS_M` (40 m), how close the hero must come for Wisp to comment.
- **Top monuments**: the two monument candidates with the highest importance score among the sights of the loaded map.
- **Passed**: the hero's progress along the route has reached the sight's closest point on the route.

## Requirements

### Requirement L1: Which places are sights

1. THE SYSTEM SHALL recognise these kinds: `university` (amenity=university or college), `school` (amenity=school; kindergartens are not sights), `hospital` (amenity=hospital), `church`, `mosque`, `synagogue` and `temple` (amenity=place_of_worship by religion: christian, muslim, jewish, and every other or unknown religion), `townHall` (amenity=townhall), and the monument kinds `tower`, `arch`, `statue` and `fountain`.
2. THE SYSTEM SHALL read them from the OpenMapTiles `poi` layer of the z14 tiles the map already loads (`class`, `subclass`, `name`, `rank`; for places of worship the `subclass` is the religion), and from OSM tags where a data source carries them (`religion`, `wikidata`, `wikipedia`, `tourism`, `historic`).
3. THE SYSTEM SHALL treat as monument candidates only named features of the classes attraction, monument, memorial, castle and ruins (tourism=attraction, historic=monument|memorial|castle|ruins), and SHALL give each one a generic style (`tower`, `arch`, `statue` or `fountain`) from its class and the words of its name, falling back to a stable pick from its position.
4. THE SYSTEM SHALL merge sights of the same kind that lie within 80 m of each other (a campus, a hospital's wings), keeping the more important one.

### Requirement L2: Only along the route

1. THE SYSTEM SHALL draw a sight only when its distance to the route polyline is at most `CORRIDOR_M`. The distance is measured to the sight's grounds or footprint when it has one (0 when the route runs inside it), otherwise to its point. With no route, no sight is drawn.
2. THE SYSTEM SHALL compute the distance in a local metric projection, to the segments of the polyline, and SHALL also give each kept sight its distance along the route (`alongM`).
3. WHEN the route changes (new plan, new quest, reroute), THE SYSTEM SHALL recompute which sights are shown.

### Requirement L3: The two best-known monuments

1. THE SYSTEM SHALL score each monument candidate: class weight (castle 30, attraction 25, monument 20, memorial 15, ruins 12), a name (+20), `wikidata` (+25) and `wikipedia` (+25) when the source has them, and a rank bonus from the OpenMapTiles poi rank (`max(0, 40 − rank / 5)`; unknown rank counts as 200).
2. THE SYSTEM SHALL pick the two highest scores of the loaded map, breaking ties by name and then by position, so the same data always gives the same two (independent of the order the data arrived in).
3. THE SYSTEM SHALL keep a quest's two monuments fixed once the quest has started, so streaming more map cells never swaps them. Of those two, only the ones inside the corridor are drawn (L2).

### Requirement L4: Original art

1. THE SYSTEM SHALL draw every sight as a sprite made in code (character grids and rectangles), one design per kind, with its own palette, no logos, brands or trademarks and nothing traced from a real building or another game. Religious buildings use generic shapes: a church with a bell tower and a cross, a mosque with a dome and a minaret, a synagogue with arched windows and a Star of David over the door, a temple with a stepped roof and columns.
2. THE SYSTEM SHALL paint all sprites once into one atlas (day frame and night-light frame per kind) and only blit from it.
3. THE SYSTEM SHALL keep art at its own size (about 1.5 to 2 tiles wide), scaled with the zoom exactly like the tile art, with nearest-neighbour scaling.

### Requirement L5: Placement and rendering

1. THE SYSTEM SHALL stand each sprite on the closest free spot to its point (at most 6 tiles away) whose whole footprint is loaded, is not a street, path, crossing or water, does not touch the route, the start, the finish or a checkpoint (the decor keep-out set), and does not overlap another sight. IF there is no such spot, THE SYSTEM SHALL show nothing for that sight.
2. THE SYSTEM SHALL draw sights into the cached scene, before the sky tint, so day and night tint them like the tiles; a redraw of the scene happens only when the sights, the keep-out set or the loaded map change, never per frame.
3. THE SYSTEM SHALL hide sights below zoom 8 (the overview) and SHALL NOT write names on the map at any zoom (task 92: names live only in Wisp's lines and the summary list).
4. WHEN it is dark, THE SYSTEM SHALL light the windows (warm yellow, drawn after the tint) and add a faint warm glow around the building. Sprites never allocate in the frame loop.
5. THE SYSTEM SHALL keep sights out of the HUD's way by not drawing on top of the route, the hero or Wisp (both are drawn in the overlay above the scene).

### Requirement L6: Wisp comments

1. WHEN the hero comes within `PASS_M` of a sight, THE SYSTEM SHALL make Wisp say one short line about it, in English or Spanish, once per sight and quest. The line names the sight when it has a name (university, school, hospital, monuments) and otherwise says what it is ("Look, the Town Hall!" / "¡Mira, el Ayuntamiento!").
2. THE SYSTEM SHALL NOT interrupt a line already showing (gem comment, night scare), and SHALL leave at least 20 s between two sight lines, so a street of schools does not become chatter.
3. THE SYSTEM SHALL follow the copy voice of Wisp (one short sentence, about 45 characters at most, game-pitch tone), keep identical keys and placeholders in both languages, and put the same text in the live region of the ghost HUD.

### Requirement L7: Summary

1. THE SYSTEM SHALL list in the quest summary, under "Places discovered" / "Lugares descubiertos", the sights the hero has passed (progress along the route at or beyond the sight's closest point), in route order, each with its small icon (the sprite) and its name or, without a name, its kind. More than six are shortened to six and "and {n} more".
2. THE SYSTEM SHALL show nothing (no heading) when no sight was passed. A reloaded quest lists the same places, because the list follows route progress and keeps no separate state.

### Requirement L8: Data limits

1. THE SYSTEM SHALL ask for no new data: sights come from tiles the app already loads (the 4-request cap and the Overpass rules of `osm-etiquette.md` stay as they are), and a missing or failed load only means fewer sights, with no error shown.
2. THE SYSTEM SHALL store sights in the compact record (codec version 5, field `sg`); older records decode with no sights.
3. THE SYSTEM SHALL keep the bundled Benicalap demo working: it has no sight data, so it shows none.

### Requirement L9: Tests

1. THE SYSTEM SHALL test: classification per tag set (religion mapping with unknown), the corridor filter (property test: shown only inside, none beyond), the top-two ranking (determinism under shuffling), the atlas and sprite validity, Wisp's single trigger per sight, the summary list, the codec round trip and i18n parity.

### Requirement L10: Real footprint (task 92)

1. THE SYSTEM SHALL read the area of a sight from the same z14 tiles: `landuse` polygons of class `university`, `college`, `school` and `hospital` are its **grounds**; for every sight without grounds (places of worship, the town hall, a school with no landuse polygon) the `building` polygon that contains its point, or the nearest one within 25 m, is its **footprint**. No new request is made.
2. THE SYSTEM SHALL link a sight to the grounds of its kind that contain its point (else the nearest within 60 m), joining the pieces of one polygon that the tile edge cut (shared end points), and SHALL merge sights that share grounds into the most important one.
3. THE SYSTEM SHALL draw a sight that has an area at the scale of that area. Inside **grounds**: every building tile becomes a special building (one large building per connected footprint, any shape), every ordinary house whose lot is at least one third inside is replaced whole, and the rest is campus ground (lawn, paving beside the buildings, a few trees). Inside a **footprint**: the footprint tiles become the special building. Streets, paths, crossings and water are never covered. Nothing in the area is an ordinary house, and no tile outside the area is special, except whole replaced house lots.
4. THE SYSTEM SHALL build the special tiles per 32 × 32 chunk into the cached scene (day and lit layers), when the sights, the loaded map or the chunk change, never per frame, and SHALL keep the Halloween decor off the special building tiles.
5. THE SYSTEM SHALL give the main building (the footprint at the sight's point, else the largest) a crown: the kind's landmark part (pediment and dome, bell tower, minarets, clock tower …) at the front, standing on the footprint. A sight with no area keeps its fixed sprite on a paving plate.
6. THE SYSTEM SHALL keep the route, the start, the finish and the gems visible: they draw above the scene.

### Requirement L11: Unmistakable designs (task 92)

1. THE SYSTEM SHALL give every kind its own material palette (wall, roof, trim) and a distinct silhouette, different from the house tiles: university sandstone with columns and a dome, hospital white with teal and green bands, school brick with a clock, church pale stone with slate roof and bell tower, mosque ivory with teal domes and minarets, synagogue blue-grey with arched front, temple lacquered red with tiered gold roofs, town hall stone with a clock tower, balcony and flags. Special roofs and façades use a dark outline on every free edge.
2. THE SYSTEM SHALL light the windows of special buildings at night and add a faint warm halo around each; the lit layer is built with the chunk, the halo is a cached sprite.


### Requirement L12: Varied buildings and a visible entrance (task 93)

1. WHEN grounds hold more than one building, THE SYSTEM SHALL give each building its own variant (roof colour and pattern, wall colour, roof kind: pitched, flat with skylights, or terrace), chosen deterministically from the mark id and the building's position, so the same map always gives the same campus. WHILE a building has fewer neighbours (another building within 5 tiles) than the kind has variants, THE SYSTEM SHALL NOT give it the variant of a neighbour. Kinds with grounds (university, school, hospital) have at least four variants.
2. WHEN a building is at least 7 × 7 tiles and mostly filled (at least 75 % of its box), THE SYSTEM SHALL cut an inset courtyard (at least 3 × 3 tiles, with two building tiles all round on the closed form), either closed or open to the south, and draw it as court ground with a path. The wings that remain keep their own façade rows.
3. THE SYSTEM SHALL draw rows of windows on every façade row (one or two storeys by building), and SHALL give the main building columns (a portico with a pediment above) around its entrance.
4. THE SYSTEM SHALL give every building of at least 3 tiles an entrance on the side that faces the nearest street, path, plaza or route tile (searched up to 12 tiles out from the middle of each side; south wins a tie and any side within 2 tiles of the nearest; south when nothing is found): double doors in the middle of that side (door tile on the façade row for south, a canopy on the edge tile for the other sides), one row of steps outside it, and a small paved plaza (3 tiles wide, 2 deep) beyond the steps. Steps and plaza are placed only on free tiles: loaded, not street, path, crossing, plaza or water, not a route, start, finish or gem tile, not a building tile and not an ordinary house lot. The entrance carries no sign and no text.
5. THE SYSTEM SHALL keep lawn, paving and trees between the buildings of grounds, so a campus reads as buildings in a park.
6. THE SYSTEM SHALL add flagpoles (plain colours, no flag of a real state or body and no coat of arms) to the main building of the town hall and the university, and chimneys and cupolas to the variants that have them. Vertical parts are props painted into the chunk bitmap after the tiles, so they rise above the roof plane.

### Requirement L13: Special buildings stand out (task 93)

1. THE SYSTEM SHALL draw every special building with an outline two pixels thick in the kind's ink, a drop shadow (a translucent dark strip on the free tiles east and south of the building, light from the north-west), a high-contrast palette per kind and shaded roof slopes (light north slope, dark south slope, a ridge line on pitched roofs), so it stands apart from ordinary houses at the quest zoom. Ordinary houses stay as they are.
2. THE SYSTEM SHALL rise above the roof plane with the kind's landmark part (crown): tower, dome, minaret, bell tower, clock tower, never lower than the roof.

### Requirement L14: Town hall and places of worship, schools, hospitals (task 93)

1. WHEN the footprint of a town hall has fewer than `3 × LOT_TILES` tiles (`LOT_TILES` = 28, the mean lot of the town layout), THE SYSTEM SHALL grow it to that size, on a rectangle centred on the footprint's centroid that is wider than it is tall (3 : 2 at most), with an odd width so the façade is symmetrical about the entrance. The growth uses only free tiles (loaded, not street, path, crossing, plaza, water or a route, start, finish or gem tile); ordinary house lots it touches are replaced whole. Other kinds grow the same way to their own minimum (church 30, mosque 36, synagogue 28, temple 36, school 30, hospital 48 tiles).
2. THE SYSTEM SHALL draw the town hall façade symmetrical about the entrance: a central bay of five tiles with columns, a balcony on the row above it, double doors with steps, a tall clock tower (crown) with a clock face, two flagpoles in plain colours on the façade ends, a paved forecourt. At night the windows, the clock face and the doorway are lit and the halo is stronger than for other sights.
3. THE SYSTEM SHALL give each other kind its iconic parts: church (slate nave with ridge, bell tower crown, rose window and pointed windows, front doors with steps), mosque (domes on the roof, minaret crown, arched entrance), synagogue (arched façade with a geometric window pattern, no emblem needed), temple (tiered roofs, a red gate with a lintel as entrance), hospital (pale blocks, ribbon windows in many rows, a canopy entrance over an ambulance bay striped green, no red cross), school (brick, a clock and bell in the crown, a fence around the yard with a gate in line with the entrance, steps).
4. THE SYSTEM SHALL draw no name, label or text on the map, and no real emblem, logo or flag.

### Requirement L15: Tests (task 93)

1. THE SYSTEM SHALL test: variants are deterministic and differ between adjacent buildings; the entrance faces the nearest street; the town hall footprint has at least `3 × LOT_TILES` tiles and covers no street, plaza, path, crossing, water or route tile; each kind has its iconic feature flags; no text is drawn; building roles lie only inside the area (and the grown footprint), entrance steps and plaza only on free tiles.
