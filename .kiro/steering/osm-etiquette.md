---
inclusion: fileMatch
fileMatchPattern: ["src/osm/**", "scripts/build-fixture.ts", "scripts/route-probe.ts"]
---

# OpenStreetMap and Overpass etiquette

StepQuest runs no server. Every live map comes from public Overpass instances run by volunteers, so the client must stay polite. The rules below are implemented in `src/osm/overpass.ts` and `src/osm/download.ts`; keep them intact.

- **Cache first.** Look in IndexedDB (7-day TTL, `CACHE_TTL_MS`) and in the area index for a cached area that already covers the request before any network call. Cache keys round the box to about 100 m so nearby requests share an entry.
- **One request at a time per tab.** A second download while one runs is refused (`busy`), not queued.
- **Spacing.** At least `MIN_REQUEST_GAP_MS` (10 s) between downloads from a tab; otherwise `rateLimited`.
- **Size cap.** Refuse areas above `MAX_AREA_KM2` (36 km²). Ask only for the area a walk needs (`areaForWalk`), and `out geom` for ways only: highways, buildings, parks and green landuse, water, waterways.
- **Mirrors.** The public mirrors in `OVERPASS_ENDPOINTS` are each asked once and the first good answer wins; a mirror has a timeout (`MIRROR_TIMEOUT_MS`). Answer 429 and 504 as `rateLimited`, never retry in a loop. Do not add mirrors that forbid this use, and do not add a retry storm.
- **Identification.** Browsers send their own Referer and User-Agent. Node scripts must send a descriptive User-Agent with a contact address.
- **Tests and CI never touch the network.** They use the bundled fixture or a mocked `fetch`.
- **Attribution (ODbL).** The text "Map data © OpenStreetMap contributors (ODbL)" (`OSM_ATTRIBUTION`, and `map.attribution` in both languages) is always visible on the map, in the bundled demo and in live data. Never hide, shrink to unreadable size or move it behind a menu. The bundled extract `src/data/benicalap.osm.json` is ODbL data: keep it credited, and rebuild it only with `npm run fixture`.
