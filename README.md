# StepQuest

Your daily step goal as an 8-bit overworld quest on real streets. Pick a start, choose a loop or an A→B walk, set a goal (10,000 steps by default) and get a pedestrian route within ±5 % of it, with checkpoints along the way, drawn as a pixel-art tile map generated from OpenStreetMap.

Kiroween 2026 entry, **Resurrection** category.

## Status

Phases 1 to 5 are done except the submission items of task 53 (public repo with an OSI licence and Pages deploy, demo video, write-up). Delivered: route planner and tile map, GPS tracking and checkpoints, the overworld look (houses, landmarks, a continuous route path, a walking character and dialogue boxes), and sound (a retro robot voice, chiptune music that follows your pace, sound effects), safer routes (lit, lively streets; a list of streets to avoid), and first-run onboarding. See `.kiro/specs/README.md` for the full plan.

## Walking a quest

- **Use my location** sets the start from your phone's GPS (and downloads the map around you if you are outside the loaded area). If location is already allowed this happens by itself at launch; otherwise a small toast offers it. Pan off the loaded map and **Load this area** appears; the download shows its progress. Typing coordinates is under Settings → Map data → Advanced.
- The route is drawn as **red pixel footprints**, left and right, turned along the path; footprints you have walked turn darker and faded. Their spacing is in screen pixels, so they stay readable at every zoom.
- **Start quest!** follows you on the map (dragging the map pauses following; the target button centres on you and follows again). Collect the numbered gems in order (within about 22 m; a bit more when GPS is weak) and reach the flag.
- **Adaptive rerouting**: if you leave the line but still head for the next gem (within 90° of it, or not getting further from it), the rest of the walk is quietly recalculated from where you are, keeping the remaining step budget (±5 %), the safety weights and the gems still to collect, and avoiding the street you just left. "You left the route" (text and voice) only appears when you walk clearly away for about 60 m; short GPS jumps are ignored.
- The quest is saved on your device, so a reload or a lost signal resumes where you were.
- **Simulate walk (demo)** moves the walker along the route by itself at up to 120× speed, with optional GPS noise, for testing and demo videos.

## Sound

- A robot voice (our own 1980s-style formant synthesizer, English and Spanish) calls out the start, each gem, the distance to the next one, turns about 30 m ahead, going off route, halfway and the finish.
- Chiptune music is generated as you walk; its tempo follows your steps and it pauses when you stop.
- The speaker button (top bar, or the quest's bottom bar) opens the sound panel: master, music, voice and effects volumes, mute and voice only. Settings stay on your device.
- Browsers only allow sound after a tap: it starts with "Start quest!" (or the sound button). On iPhone, a call or locking the screen can pause it; tap anywhere to bring it back.

**Limitation:** a web app cannot track your position in the background. Tracking only works while the page is open and the screen is on. The app asks the browser to keep the screen awake (Screen Wake Lock) where supported; if you lock the phone, the quest pauses and catches up when you come back. Location also requires HTTPS (GitHub Pages is fine).

## On your phone

- The map fills the screen; the step goal and the start button sit in a framed panel above a bottom tab bar: **Map** (planner), **Bag** (quest log, start point, streets to avoid, demo walk), **Hero** (today's steps as a segmented meter, your stride, and your walker's look: boy or girl, with skin, hair, cap, shirt and trousers from small retro palettes; the map walker and the header avatar wear it) and **Settings** (sound, language, help, map data). On wide screens the tab bar becomes a side rail and the active tab shows next to the map.
- During a quest the map is the screen of a plain handheld console (no brand, no extra buttons). Panels and buttons are 8-bit: notched corners, no rounding, every control at least 48 px to press, a press-down step, a quiet click on the effects channel (volume and mute apply) and a tiny buzz on Android. Menus and sheets move in short steps; with reduced motion they do not move.
- **Add to Home Screen** opens it full screen like an app (web app manifest, iPhone meta tags, notch and home-indicator safe areas). The pixel icons are rendered from `public/favicon.svg` with `node scripts/build-icons.mjs`.
- **Steps today** in the header adds up real walks (simulated ones do not count) and resets at midnight.

## Safer routes

- **Safe routes are always on** (a product default, not a setting). They prefer streets that are mapped as lit, have sidewalks, are pedestrian or residential, or have shops and cafés nearby, and steer away from back alleys and driveways, tunnels and underpasses, industrial estates and unlit paths or tracks. Steps are only a small penalty. The step goal and its ±5 % tolerance do not change; if the preferred streets cannot fit it, the app says so in neutral words and offers a walk that fits the goal on any street.
- **From sunset to sunrise** (computed on the device from the date and position; not civil twilight) lighting counts much more, and so do empty parks and industrial areas, automatically. Busy avenues with lighting, sidewalks or shops get a small night bonus that never beats a lit residential or pedestrian street; by day they are neutral. This also applies when the walk will end after dark.
- **Streets to avoid**: search a street by name or tap it on the map. The list is saved on your device, the streets are drawn on the map as amber-and-black hazard tape with a "no entry" sign, and they are never used; if the route is impossible without them, the app plans one anyway and names the streets it had to use.
- **Lighting weighs a lot after dark**: main avenues (primary, secondary, tertiary) count as lit unless tagged `lit=no`; side streets with unknown lighting cost clearly more than lit ones (×1.6 at night, ×1.12 by day) and `lit=no` triples the cost. Extra steps to reach the goal are therefore added on lit, busy streets, not on a dark street parallel to a lit avenue. On 1.2× detours in the demo area at night, the share of dark or unknown side streets fell from 66 % to 20 %.
- **Tram, metro and train tracks** above ground are drawn as rails (gravel bed, sleepers, two steel rails) and are never walkable, even if a highway tag is also present; they are only crossed where a street or crossing is mapped. Tracks in tunnels are not drawn.
- These are proxies from OpenStreetMap tags, not crime data. Lighting is only mapped on part of the streets (about one in eight in the demo area). **Settings → Info** explains all this (EN/ES); the main screens do not show safety notes.

## Day-cycle lighting

The map (not the menus) follows the sun at your location: full daylight, a warm golden tint in the last hours before sunset and after sunrise, a blue-purple dusk, then a dark night with lit house windows, street lamps with soft light pools (on streets mapped `lit=yes` and on main streets) and a small light around the walker and the gems. It uses the same sunrise/sunset maths as the safe-route night rule and never changes routing.

**Preview a time of day** (screenshots, demo video): add `?time=HH:MM` to the URL, for example `http://127.0.0.1:4188/stepquest/?time=19:45`. It uses that local time of today for the lighting only; without it the real clock is used. Dusk falls about at sunset (about 17:40 in Valencia in late November, about 21:30 in June), so pick a time that matches the date.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173/stepquest/
npm test           # unit and property tests (offline, use the bundled map extract)
npm run lint
npm run build
```

Screenshots: `npm run build && npx vite preview --host 127.0.0.1 --port 4188`, then `PHASE1_URL=http://127.0.0.1:4188/stepquest/ npm run screenshots` (phase 1) `PHASE2_URL=http://127.0.0.1:4188/stepquest/ node scripts/screenshot-phase2.mjs` (phase 2) `PHASE3_URL=http://127.0.0.1:4188/stepquest/ PHASE3_TAG=after node scripts/screenshot-phase3.mjs` (phase 3) `PHASE4_URL=http://127.0.0.1:4188/stepquest/ node scripts/screenshot-phase4.mjs` (phase 4, also checks that audio runs) `SAFE_URL=http://127.0.0.1:4188/stepquest/ node scripts/screenshot-safe-route.mjs` (safe routes) `MD_URL=http://127.0.0.1:4188/stepquest/ node scripts/screenshot-mobile-design.mjs` (mobile design: every tab, desktop, quest dialogue) or `RETRO_URL=http://127.0.0.1:4188/stepquest/ node scripts/screenshot-retro.mjs` (retro look: press areas, console screen, Hero tab).

Offline map extract: save Overpass responses for the demo area (the main query with `out geom`, which also fetches industrial land, shops and amenities for safe routing, plus barriers/squares and landmark points with `out tags center`), then `npm run fixture -- src/data/benicalap.osm.json main.json extra.json poi.json`. `KEEP_POIS=old.json` keeps the landmarks of an earlier extract.

## How it works

- **Map data**: the map is drawn from [OpenFreeMap](https://openfreemap.org) vector tiles (OpenMapTiles schema, OpenStreetMap data, no key): z12 tiles for the wide zooms, z14 for streets and houses, decoded in a Web Worker and cached on the device for a week. The walking graph for routes and reroutes comes from the Overpass API (cached for a week, polite limits, hedged mirrors), or from the bundled offline extract of Benicalap, València, which also draws the demo area offline. Open `?demo=1` for a self-playing demo run.
- **Tiles**: features are rasterized into a grid of 16×16 tiles (about 5 m each) and auto-tiled with 4-bit masks (paths) and 8-bit "blob" masks (roads, buildings, parks, water).
- **Town**: building blocks are cut into lots with small houses, gardens and fences; hospitals and health centres, stations, schools, park entrances and supermarkets from OSM get their own special buildings (generic, original designs; no brand names or logos).
- **Art**: every tile, building and sprite is painted procedurally or hand-coded in `src/render/`. No assets from any commercial game.
- **Sound**: the voice, music and effects are synthesized in `src/audio/` with the Web Audio API; there are no audio files.
- **Routing**: A* on the walkable OSM network; loops and A→B detours are tuned until they land within ±5 % of the goal, and checkpoints are spaced evenly along the route. Safe routing multiplies each street's cost by a safety factor (0.6–6×) and closes avoided streets; real lengths are kept for the step count.

## Kiro workflow

The project is set up for [Kiro](https://kiro.dev). Everything lives in `.kiro/`.

- **Specs** (`.kiro/specs/`): one folder per feature (routing, safety-night, map-rendering, voice-audio, retro-ui, quest, ghost-guide, error-copy, halloween-decor, chiptune, demo-mode), each with `requirements.md`, `design.md` and `tasks.md`, indexed in `.kiro/specs/README.md`. Work is done task by task, and a task is ticked only when tests, type check, lint and build pass.
- **Steering** (`.kiro/steering/`): project rules that Kiro reads before it works. `product.md`, `tech.md` and `structure.md` are always included. `visual-style.md` is included only when a file under `src/render/`, `src/ui/` or a `.css` file is in play. `routing.md` (OSM tags, safety weights, roundabouts, the ±5 % budget, rerouting, worker protocol) loads for `src/routing/`, `src/quest/`, `src/osm/` and `src/geo/`. `osm-etiquette.md` (Overpass caching, spacing, mirrors, OpenFreeMap tile use, attribution) loads for `src/osm/`, `src/vector/` and the fixture and probe scripts. `copy-voice.md` (how every player-facing line sounds, including "Mischief in errors") is the voice guide for Wisp's lines.
- **Property-based tests**: each feature spec's `design.md` has a "Correctness properties" section (ids like P-R1, P-RA1, P-I2) linked to requirement ids, and the matching `*.property.test.ts` files check them with [fast-check](https://fast-check.dev) on random routes, roundabouts, reroutes, map data, chunk plans, texts and i18n values. Seeds are fixed (`20261204`); a failure prints the counterexample and the seed. The whole suite stays well under a minute.
- **Hooks** (`.kiro/hooks/`): `lint-on-save` and `run-tests-on-save` run after a TypeScript file in `src/` is saved. `build-on-tasks-save` runs `npx tsc -b && npm run build` when a spec's `tasks.md` is saved. `i18n-parity` asks the agent to compare `src/i18n/en.ts` and `es.ts` after either is saved. `assets-guard` reminds the agent of the no-external-assets rule when an image, audio or font file is created under `src/` or `public/`. `error-copy-voice` asks the agent to check changed error strings against "Mischief in errors" after either dictionary is saved. `walker-progress-tests` runs the walker and ghost property tests when the walker, route walker, overlay or simulator files are saved. `chiptune-tests` runs the music, jingle and loudness tests when the theme, jingles, graph or music player are saved. `spec-sync` is a manual hook that updates the three spec files to match the code.
- **Agent** (`.kiro/agents/qa-reviewer.json`): a read-only reviewer. It can read files and run `npm test`, `npx tsc -b`, `npm run lint`, `npm run build` and read-only git commands, and it checks a diff against the steering rules (original assets only, EN/ES parity, 48 px press areas, no co-author trailers, spec updated). Start it with `kiro-cli --agent qa-reviewer`; check the file with `kiro-cli agent validate --path .kiro/agents/qa-reviewer.json`.

## Credits and licences

- Code: MIT (see `LICENSE`).
- Map data: © OpenStreetMap contributors, available under the [Open Database License](https://www.openstreetmap.org/copyright). The extract in `src/data/` is ODbL data.
- Map tiles (credited on the map as "OpenFreeMap © OpenMapTiles © OpenStreetMap contributors"): [OpenFreeMap](https://openfreemap.org) © [OpenMapTiles](https://www.openmaptiles.org/).
- Vector tile decoding: [`@mapbox/vector-tile`](https://github.com/mapbox/vector-tile-js) and [`pbf`](https://github.com/mapbox/pbf), BSD-3-Clause.
- Font: [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) by CodeMan38, SIL Open Font License 1.1.
