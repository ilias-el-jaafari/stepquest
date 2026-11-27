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

1. THE SYSTEM SHALL draw a sight only when its distance to the route polyline is at most `CORRIDOR_M`. With no route, no sight is drawn.
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
3. THE SYSTEM SHALL hide sights below zoom 8 (the overview) and show a name label (Press Start 2P, ink on paper outline) from zoom 20, under the sprite, in the scene.
4. WHEN it is dark, THE SYSTEM SHALL light the windows (warm yellow, drawn after the tint) and add a faint warm glow around the building. Sprites and labels never allocate in the frame loop.
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
