# StepQuest

Your daily step goal as an 8-bit overworld quest on real streets. Pick a start, choose a loop or an A→B walk, set a goal (10,000 steps by default) and get a pedestrian route within ±5 % of it, with checkpoints along the way, drawn as a pixel-art tile map generated from OpenStreetMap.

Kiroween 2026 entry, **Resurrection** category. *StepQuest is a working name; the display name lives in `src/config/brand.ts`.*

## Status

Phase 1 of 4: route planner and tile map. See `.kiro/specs/step-quest/` for the full plan.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173/stepquest/
npm test           # unit tests (offline, use the bundled map extract)
npm run lint
npm run build
```

Screenshots: `npm run build && npx vite preview --host 127.0.0.1 --port 4188`, then `PHASE1_URL=http://127.0.0.1:4188/stepquest/ npm run screenshots`.

## How it works

- **Map data**: OpenStreetMap ways from the Overpass API (cached on the device for a week, throttled), or the bundled offline extract of Benicalap, València.
- **Tiles**: features are rasterized into a grid of 16×16 tiles (about 5 m each) and auto-tiled with 4-bit masks (paths) and 8-bit "blob" masks (roads, buildings, parks, water).
- **Art**: every tile and sprite is painted procedurally or hand-coded in `src/render/`. No assets from any commercial game.
- **Routing**: A* on the walkable OSM network; loops and A→B detours are tuned until they land within ±5 % of the goal, and checkpoints are spaced evenly along the route.

## Credits and licences

- Code: MIT (see `LICENSE`).
- Map data: © OpenStreetMap contributors, available under the [Open Database License](https://www.openstreetmap.org/copyright). The extract in `src/data/` is ODbL data.
- Font: [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) by CodeMan38, SIL Open Font License 1.1.
