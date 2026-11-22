# StepQuest

Your daily step goal as an 8-bit overworld quest on real streets. Pick a start, choose a loop or an A→B walk, set a goal (10,000 steps by default) and get a pedestrian route within ±5 % of it, with checkpoints along the way, drawn as a pixel-art tile map generated from OpenStreetMap.

Kiroween 2026 entry, **Resurrection** category.

## Status

Phase 4 of 5 done: route planner and tile map, GPS tracking and checkpoints, the overworld look (houses, landmarks, a continuous route path, a walking character and dialogue boxes), and sound (a retro robot voice, chiptune music that follows your pace, sound effects), plus safer routes (lit, lively streets; a list of streets to avoid). See `.kiro/specs/step-quest/` for the full plan.

## Walking a quest

- **Use my location** sets the start from your phone's GPS (and downloads the map around you if you are outside the loaded area).
- **Start quest!** follows you on the map. Collect the numbered gems in order (within about 22 m; a bit more when GPS is weak) and reach the flag.
- The quest is saved on your device, so a reload or a lost signal resumes where you were.
- **Simulate walk (demo)** moves the walker along the route by itself at up to 120× speed, with optional GPS noise, for testing and demo videos.

## Sound

- A robot voice (our own 1980s-style formant synthesizer, English and Spanish) calls out the start, each gem, the distance to the next one, turns about 30 m ahead, going off route, halfway and the finish.
- Chiptune music is generated as you walk; its tempo follows your steps and it pauses when you stop.
- The speaker button (top bar, or the quest's bottom bar) opens the sound panel: master, music, voice and effects volumes, mute and voice only. Settings stay on your device.
- Browsers only allow sound after a tap: it starts with "Start quest!" (or the sound button). On iPhone, a call or locking the screen can pause it; tap anywhere to bring it back.

**Limitation:** a web app cannot track your position in the background. Tracking only works while the page is open and the screen is on. The app asks the browser to keep the screen awake (Screen Wake Lock) where supported; if you lock the phone, the quest pauses and catches up when you come back. Location also requires HTTPS (GitHub Pages is fine).

## On your phone

- The map fills the screen; the step goal and the start button sit in a framed panel above a bottom tab bar: **Map** (planner), **Bag** (quest log, start point, streets to avoid, demo walk), **Hero** (today's steps and your stride) and **Settings** (sound, language, help, map data). On wide screens the tab bar becomes a side rail and the active tab shows next to the map.
- **Add to Home Screen** opens it full screen like an app (web app manifest, iPhone meta tags, notch and home-indicator safe areas). The pixel icons are rendered from `public/favicon.svg` with `node scripts/build-icons.mjs`.
- **Steps today** in the header adds up real walks (simulated ones do not count) and resets at midnight.

## Safer routes

- **Safe routes are always on** (a product default, not a setting). They prefer streets that are mapped as lit, have sidewalks, are pedestrian or residential, or have shops and cafés nearby, and steers away from back alleys and driveways, tunnels and underpasses, industrial estates and unlit paths or tracks. Steps are only a small penalty. The step goal and its ±5 % tolerance do not change; if no safer route meets it, the app says so and offers the normal route.
- **From sunset to sunrise** (computed on the device from the date and position; not civil twilight) lighting counts much more, and so do empty parks and industrial areas, automatically. Busy avenues with lighting, sidewalks or shops get a small night bonus that never beats a lit residential or pedestrian street; by day they are neutral. This also applies when the walk will end after dark.
- **Streets to avoid**: search a street by name or tap it on the map. The list is saved on your device, the streets are drawn on the map as amber-and-black hazard tape with a "no entry" sign, and they are never used; if the route is impossible without them, the app plans one anyway and names the streets it had to use.
- These are proxies from OpenStreetMap tags, not crime data. Lighting is only mapped on part of the streets (about one in eight in the demo area), so "unknown" is treated as neutral. The **Info** button in the header explains all this (EN/ES); the main screens do not show safety notes.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173/stepquest/
npm test           # unit tests (offline, use the bundled map extract)
npm run lint
npm run build
```

Screenshots: `npm run build && npx vite preview --host 127.0.0.1 --port 4188`, then `PHASE1_URL=http://127.0.0.1:4188/stepquest/ npm run screenshots` (phase 1) `PHASE2_URL=http://127.0.0.1:4188/stepquest/ node scripts/screenshot-phase2.mjs` (phase 2) `PHASE3_URL=http://127.0.0.1:4188/stepquest/ PHASE3_TAG=after node scripts/screenshot-phase3.mjs` (phase 3) `PHASE4_URL=http://127.0.0.1:4188/stepquest/ node scripts/screenshot-phase4.mjs` (phase 4, also checks that audio runs) `SAFE_URL=http://127.0.0.1:4188/stepquest/ node scripts/screenshot-safe-route.mjs` (safe routes) or `MD_URL=http://127.0.0.1:4188/stepquest/ node scripts/screenshot-mobile-design.mjs` (mobile design: every tab, desktop, quest dialogue).

Offline map extract: save Overpass responses for the demo area (the main query with `out geom`, which also fetches industrial land, shops and amenities for safe routing, plus barriers/squares and landmark points with `out tags center`), then `npm run fixture -- src/data/benicalap.osm.json main.json extra.json poi.json`. `KEEP_POIS=old.json` keeps the landmarks of an earlier extract.

## How it works

- **Map data**: OpenStreetMap ways from the Overpass API (cached on the device for a week, throttled), or the bundled offline extract of Benicalap, València.
- **Tiles**: features are rasterized into a grid of 16×16 tiles (about 5 m each) and auto-tiled with 4-bit masks (paths) and 8-bit "blob" masks (roads, buildings, parks, water).
- **Town**: building blocks are cut into lots with small houses, gardens and fences; hospitals and health centres, stations, schools, park entrances and supermarkets from OSM get their own special buildings (generic, original designs; no brand names or logos).
- **Art**: every tile, building and sprite is painted procedurally or hand-coded in `src/render/`. No assets from any commercial game.
- **Sound**: the voice, music and effects are synthesized in `src/audio/` with the Web Audio API; there are no audio files.
- **Routing**: A* on the walkable OSM network; loops and A→B detours are tuned until they land within ±5 % of the goal, and checkpoints are spaced evenly along the route. Safe routing multiplies each street's cost by a safety factor (0.6–6×) and closes avoided streets; real lengths are kept for the step count.

## Credits and licences

- Code: MIT (see `LICENSE`).
- Map data: © OpenStreetMap contributors, available under the [Open Database License](https://www.openstreetmap.org/copyright). The extract in `src/data/` is ODbL data.
- Font: [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) by CodeMan38, SIL Open Font License 1.1.
