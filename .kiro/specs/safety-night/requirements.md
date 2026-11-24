# Safety and night: Requirements

Part of the StepQuest specs; see [../README.md](../README.md) for the introduction, glossary and index. Requirement ids S1 to S10 were written in the Nov 2026 review (task 68); the feature itself was built under tasks 43 to 49b.

Related: [routing](../routing/requirements.md) (planner and ±5 % budget, Requirement 3), [quest](../quest/requirements.md) (rerouting), [map-rendering](../map-rendering/requirements.md) (OSM tags in the codec, day-cycle lighting).

Terms: **safety factor** is the cost multiplier of one stretch of street (lower is preferred). **Avoid list** is the user's saved street names. **Night** is the state of the sun at a place and moment: the sun's centre is below −0.833° altitude (`HORIZON`).

Product decisions that these requirements record (from `.kiro/steering/product.md` and `routing.md`, and the product owner): safe routing and night lighting weight are always on and have no toggle. The avoid list is the only user option. Night starts at sunset automatically. The weight values are fixed by the product owner; this spec does not change them.

## Requirements

### Requirement S1: Safe routing is always on

**User Story:** As a walker, I want routes that favour streets that feel safe without having to switch anything on, so that every route is a sensible one by default.

#### Acceptance Criteria

1. THE SYSTEM SHALL apply safety factors to every planned route (loop, A → B and reroute), with no setting to turn them off.
2. THE SYSTEM SHALL offer no other safety setting than the avoid list (S6).
3. THE SYSTEM SHALL explain, in the Info / FAQ panel and in the user's language, what makes a street preferred and what changes at night.

### Requirement S2: A safety factor never changes real length

**User Story:** As a walker, I want my step goal to mean real steps, so that safer streets never make the goal wrong.

#### Acceptance Criteria

1. THE SYSTEM SHALL treat the safety factor only as a multiplier on the search cost of an edge, and SHALL measure route distance, steps and checkpoint spacing in real metres.
2. THE SYSTEM SHALL keep every planned or rerouted route within ±5 % of the target (Requirement 3 of [routing](../routing/requirements.md)) whatever the factors are.
3. THE SYSTEM SHALL keep every safety factor finite and within `MIN_FACTOR` (0.6) and `MAX_FACTOR` (6) for any input, including unknown or missing tags.
4. THE SYSTEM SHALL keep `MIN_FACTOR` at or below 1, so that the A* heuristic (straight-line distance × smallest factor) stays admissible.

### Requirement S3: Street proxies from OpenStreetMap

**User Story:** As a walker, I want the app to prefer lit, lively, pedestrian-friendly streets, so that a route feels comfortable even where there is no crime map.

#### Acceptance Criteria

1. THE SYSTEM SHALL derive each edge's factor only from OpenStreetMap data already loaded: `highway` type, `lit`, `sidewalk` tags, alley-type `service`, tunnels and covered passages, industrial land, parks, and shops and listed amenities within 40 m.
2. THE SYSTEM SHALL prefer pedestrian, living and residential streets, lit streets, streets with a sidewalk, and streets with shops or cafés nearby.
3. THE SYSTEM SHALL penalise alleys and driveways, tunnels and covered passages, industrial or railway land, unlit streets, unlit paths and tracks, and service roads.
4. THE SYSTEM SHALL treat main avenues (primary, secondary, tertiary and their links) as lit unless tagged `lit=no`, and SHALL treat untagged side streets and paths as probably unlit.
5. THE SYSTEM SHALL weigh crossings like ordinary edges (no extra factor).
6. IF a tag is missing, THEN THE SYSTEM SHALL use the neutral or presumed value in the design's tag table and SHALL NOT fail or produce a factor outside the clamp.

### Requirement S4: Night starts at sunset, automatically

**User Story:** As a walker, I want darkness to matter without telling the app, so that an evening route favours lit streets.

#### Acceptance Criteria

1. THE SYSTEM SHALL compute sunrise, sunset and solar altitude on the device from date and place, with no network request.
2. THE SYSTEM SHALL treat a moment as dark exactly when the sun's altitude is below `HORIZON` (−0.833°), with no twilight margin: night starts at sunset and ends at sunrise.
3. WHILE the sun never sets (polar day), THE SYSTEM SHALL treat every moment as day, and WHILE it never rises (polar night), every moment as dark; `sunTimes` SHALL return nothing then.
4. THE SYSTEM SHALL compute sunrise and sunset for the local solar day around the given moment, not the UTC day, so that the answer is right at any longitude.
5. THE SYSTEM SHALL return no times, and no NaN, for a non-finite moment or place.

### Requirement S5: What counts as a night walk

**User Story:** As a walker who sets out at dusk, I want the route to be planned for the dark I will walk in.

#### Acceptance Criteria

1. WHEN a route is planned, THE SYSTEM SHALL use night weights IF the sun is below the horizon at the start place at the planning time OR at the estimated end of the walk (planning time plus distance at 4.8 km/h), so a walk that crosses sunset is a night walk from its first metre.
2. WHEN a route is rerouted during a quest, THE SYSTEM SHALL decide night the same way from the time of the reroute and the remaining distance (at 1.3 m/s), at the walker's current position.
3. THE SYSTEM SHALL NOT re-weight or re-plan a running quest only because sunset passes; the weights change at the next plan or reroute.
4. THE SYSTEM SHALL use the clock of the device and the UTC-based solar maths, so daylight-saving changes and the device's time zone do not shift sunset.

### Requirement S6: Streets to avoid

**User Story:** As a walker, I want to say "not this street" once and have it respected.

#### Acceptance Criteria

1. THE SYSTEM SHALL let the user add a street by searching the street names of the loaded area, or by tapping the map (nearest named walkable street within 35 m), and remove it again.
2. THE SYSTEM SHALL save the list on the device, keep at most 50 names, trim and collapse spaces, and drop duplicates that differ only in case, accents or apostrophe style.
3. THE SYSTEM SHALL compare names ignoring case, accents, typographic apostrophes and extra spaces, and SHALL NOT ignore street-type words: "Calle Mayor", "C/ Mayor" and "Mayor" are different names.
4. THE SYSTEM SHALL give every edge of an avoided street an infinite cost, so the router never chooses it.
5. THE SYSTEM SHALL draw every walkable way of an avoided street on the map as hazard tape with a no-entry sign.
6. WHEN the user taps the map to avoid a street, THE SYSTEM SHALL offer only streets that have a name.

### Requirement S7: Fallbacks that say what happened

**User Story:** As a walker, I want a plain answer when my wishes cannot all be met, and a route that fits anyway.

#### Acceptance Criteria

1. IF no route fits the goal with safety weights and the avoid list, THEN THE SYSTEM SHALL plan with safety weights but without the avoid list, and SHALL name the avoided streets the route still uses.
2. IF safety-weighted routing cannot meet the goal at all, THEN THE SYSTEM SHALL keep the safe attempt as a preview, say so in neutral words, and offer a normal route that fits.
3. WHEN that normal route can only fit by using avoided streets, THE SYSTEM SHALL offer it anyway and name those streets.
4. THE SYSTEM SHALL never return an out-of-budget route silently.

### Requirement S8: Night weighting

**User Story:** As a walker after dark, I want lighting and busy places to count much more.

#### Acceptance Criteria

1. WHILE it is night, THE SYSTEM SHALL weigh lighting, tunnels, alleys, industrial land, paths and tracks, and unlit park paths more heavily than by day, using the values in the design's tag table.
2. WHILE it is night, THE SYSTEM SHALL give a lit avenue only a small bonus, smaller than the factor of a tagged-lit residential or pedestrian street.
3. WHILE it is night, a lit street SHALL NOT cost more than the same street unlit or untagged.
4. THE SYSTEM SHALL report, for the route shown, the share of its length on preferred streets (factor ≤ 1) and on streets mapped `lit`.

### Requirement S9: Data

**User Story:** As a maintainer, I want the tags the weights need to be in the data and the cost to be fast.

#### Acceptance Criteria

1. THE SYSTEM SHALL carry street names, lighting, sidewalks, alley and covered flags, industrial land and shop/amenity points in the live Overpass query, the demo extract and the compact codec.
2. THE SYSTEM SHALL compute per-edge facts once per loaded area and the cost array once per option set, and SHALL NOT modify a cost array after returning it.

### Requirement S10: The day cycle only draws

**User Story:** As a maintainer, I want one rule for "night".

#### Acceptance Criteria

1. THE SYSTEM SHALL let the map's day-cycle lighting reuse `sunAltitude` and `HORIZON` and SHALL NOT let it change any weight.
2. THE SYSTEM SHALL start the map's dusk phase at sunset, where safe routing starts treating the walk as night.
