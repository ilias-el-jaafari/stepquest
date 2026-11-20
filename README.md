# StepQuest

Your daily step goal as an 8-bit overworld quest on real streets. Pick a start, choose a loop or an A→B walk, set a goal (10,000 steps by default) and get a pedestrian route within ±5 % of it, with checkpoints along the way, drawn as a pixel-art tile map generated from OpenStreetMap.

Kiroween 2026 entry, **Resurrection** category.

## Status

Phase 3 of 5 done: route planner and tile map, GPS tracking and checkpoints, and the overworld look (houses, landmarks, a continuous route path, a walking character and dialogue boxes). See `.kiro/specs/step-quest/` for the full plan.

## Walking a quest

- **Use my location** sets the start from your phone's GPS (and downloads the map around you if you are outside the loaded area).
- **Start quest!** follows you on the map. Collect the numbered gems in order (within about 22 m; a bit more when GPS is weak) and reach the flag.
- The quest is saved on your device, so a reload or a lost signal resumes where you were.
- **Simulate walk (demo)** moves the walker along the route by itself at up to 120× speed, with optional GPS noise, for testing and demo videos.

**Limitation:** a web app cannot track your position in the background. Tracking only works while the page is open and the screen is on. The app asks the browser to keep the screen awake (Screen Wake Lock) where supported; if you lock the phone, the quest pauses and catches up when you come back. Location also requires HTTPS (GitHub Pages is fine).

## Run it

```bash
npm install
npm run dev        # http://localhost:5173/stepquest/
npm test           # unit tests (offline, use the bundled map extract)
npm run lint
npm run build
```

Screenshots: `npm run build && npx vite preview --host 127.0.0.1 --port 4188`, then `PHASE1_URL=http://127.0.0.1:4188/stepquest/ npm run screenshots` (phase 1) `PHASE2_URL=http://127.0.0.1:4188/stepquest/ node scripts/screenshot-phase2.mjs` (phase 2) or `PHASE3_URL=http://127.0.0.1:4188/stepquest/ PHASE3_TAG=after node scripts/screenshot-phase3.mjs` (phase 3).

Offline map extract: save Overpass responses for the demo area (the main query with `out geom`, plus barriers/squares and landmark points with `out tags center`), then `npm run fixture -- src/data/benicalap.osm.json main.json extra.json poi.json`.

## How it works

- **Map data**: OpenStreetMap ways from the Overpass API (cached on the device for a week, throttled), or the bundled offline extract of Benicalap, València.
- **Tiles**: features are rasterized into a grid of 16×16 tiles (about 5 m each) and auto-tiled with 4-bit masks (paths) and 8-bit "blob" masks (roads, buildings, parks, water).
- **Town**: building blocks are cut into lots with small houses, gardens and fences; hospitals and health centres, stations, schools, park entrances and supermarkets from OSM get their own special buildings (generic, original designs; no brand names or logos).
- **Art**: every tile, building and sprite is painted procedurally or hand-coded in `src/render/`. No assets from any commercial game.
- **Routing**: A* on the walkable OSM network; loops and A→B detours are tuned until they land within ±5 % of the goal, and checkpoints are spaced evenly along the route.

## Credits and licences

- Code: MIT (see `LICENSE`).
- Map data: © OpenStreetMap contributors, available under the [Open Database License](https://www.openstreetmap.org/copyright). The extract in `src/data/` is ODbL data.
- Font: [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) by CodeMan38, SIL Open Font License 1.1.
