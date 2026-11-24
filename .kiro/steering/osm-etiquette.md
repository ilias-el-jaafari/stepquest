---
inclusion: fileMatch
fileMatchPattern: ["src/osm/**", "scripts/build-fixture.ts", "scripts/route-probe.ts"]
---

# OpenStreetMap and Overpass etiquette

StepQuest runs no server. Every live map comes from public Overpass instances run by volunteers, so the client must stay polite. The rules below are implemented in `src/osm/overpass.ts` and `src/osm/download.ts`; keep them intact.

- **Cache first.** Look in IndexedDB (7-day TTL, `CACHE_TTL_MS`) and in the area index for a cached area that already covers the request before any network call. Cache keys include the codec version and grow the box outwards to a 0.001° grid (about 100 m) so nearby requests share an entry and an entry always covers its key; the grown box is what is downloaded and what the size cap measures. Expired, evicted and older-version entries are deleted locally after a save; this never sends a request. A damaged entry counts as a miss.
- **One request at a time per tab.** A second download while one runs is refused (`busy`), not queued.
- **Spacing.** At least `MIN_REQUEST_GAP_MS` (10 s) between downloads from a tab; otherwise `rateLimited`.
- **Size cap.** Refuse areas above `MAX_AREA_KM2` (36 km²). Ask only for the area a walk needs (`areaForWalk`), and `out geom` for ways only: highways, buildings, parks and green landuse, water, waterways. Relations are not requested (bigger answers); the parser reads multipolygon relations if an extract has them, so adding them to the query is an owner decision.
- **Mirrors.** The public mirrors in `OVERPASS_ENDPOINTS` are each asked once and the first good answer wins; a mirror has a timeout (`MIRROR_TIMEOUT_MS`). Answer 429 and 504 as `rateLimited`, never retry in a loop. An answer without an `elements` array is `badResponse` and a timeout remark is `busy`; neither is cached. Do not add mirrors that forbid this use, and do not add a retry storm.
- **Streaming cells (requirement 19).** The map loads fixed 0.01° cells around the view through the same `OverpassClient` (so the in-flight flag and the 10 s gap are shared with area downloads). Cache first per cell (`v<codec>:cell:i,j`, 7-day TTL, at most `MAX_CELL_ENTRIES` cells). Nothing is sent while the view moves (`SETTLE_MS`), at most `MAX_BATCH_CELLS` (4) cells per request and `MAX_CELLS_PER_MINUTE` (12) per minute, only cells in view, nearest first, and never while offline. Any failure puts its cells in a back-off (30 s doubling to 5 min); a 429 or 504 pauses every request for that time. Do not add look-ahead prefetching or retries outside this back-off.
- **Identification.** Browsers send their own Referer and User-Agent. Node scripts must send a descriptive User-Agent with a contact address.
- **Tests and CI never touch the network.** They use the bundled fixture or a mocked `fetch`.
- **Attribution (ODbL).** The text "Map data © OpenStreetMap contributors (ODbL)" (`OSM_ATTRIBUTION`, and `map.attribution` in both languages) is always visible on the map, in the bundled demo and in live data. Never hide, shrink to unreadable size or move it behind a menu. The bundled extract `src/data/benicalap.osm.json` is ODbL data: keep it credited, and rebuild it only with `npm run fixture`.
