---
inclusion: always
---

# Technology Stack

## Application

- React 19 + TypeScript (strict, `noUncheckedIndexedAccess`), bundled with Vite. Client-only; deployable to GitHub Pages (`base` defaults to `/stepquest/`, override with `BASE_PATH`).
- Canvas 2D for the map, with `imageSmoothingEnabled = false` and integer-snapped chunk positions so tiles stay crisp at every zoom and device pixel ratio.
- Plain CSS. Pixel font: Press Start 2P from `@fontsource/press-start-2p` (SIL OFL). No UI framework.
- Lightweight i18n in `src/i18n` (English and Spanish, same keys and placeholders, tested).

## Map data

- **Drawing:** OpenFreeMap vector tiles (OpenMapTiles schema, OSM data, no key; `src/vector/`): z12 for the coarse layer, z14 for detail, URL from the TileJSON at run time, decoded with `@mapbox/vector-tile` + `pbf` (BSD-3-Clause) in the download worker, mapped onto the OSM tag rules of `src/osm/classify.ts`, cached in IndexedDB and the HTTP cache. Drawing never waits for Overpass (map-rendering requirement 21).
- **Walking graph (task 78):** the same z14 tiles, `transportation` lines only, made one network by `src/vector/walkNet.ts` (1e-6° snapping, pieces cut at tile edges joined, dead ends within 3 m connected) and loaded by `src/world/walkArea.ts` for the cells a walk needs, as soon as the start is known. Measured on real València tiles: 98.7 % of the length in one component, 98.6 % of random pairs connected, routes 1.04 times the Overpass length (routing design, "Walking graph from tiles"). Overpass (`out geom`, ways only) only **enriches** it: lit, sidewalk, alley, covered flags and names, matched by geometry; tile streets without a match keep flags 0, so the safety and night weights are unchanged. Graph cells along the route ahead still come from Overpass where no walking record exists.
- Polite clients: see `osm-etiquette.md` for every limit (Overpass: cache first, 2 in flight, 1.5 s apart, hedged mirrors, 36 km² cap; OpenFreeMap: 6 in flight, view and route look-ahead only). Browsers send their own Referer and User-Agent; Node scripts must send a descriptive User-Agent with a contact address.
- The offline demo is a compact, delta-encoded extract of Benicalap, València (`src/data/benicalap.osm.json`, rebuilt with `npm run fixture -- <out.json> <overpass.json> [more.json ...]`, merging the main `out geom` extract with the barrier/square and landmark (`out tags center`) extracts). It is ODbL data; keep the attribution.

## App shell

- `src/app`: a typed reducer (`appState.ts`) holds the planning screens' state as plain data; hooks (`useAppState`, `usePlanner`, `useArea`, `useNumberFields`, `useToday`) run the effects. `useAppState` also gives `latest`, the newest state, for handlers and async code. The loaded map (`World`) lives beside the state, not in it.
- Components in `src/ui` are presentational (props in, callbacks out). Modal dialogs use `useModal` (focus in, Tab trap, Escape, focus back); the app behind the onboarding is `inert`. `ErrorBoundary` wraps the app and reads the language itself.
- Production builds write `sw.js` (vite plugin, template in `src/pwa`): the app shell and the bundled demo map work offline; a new version waits for the user's "Update" tap.

## Domain logic (pure TypeScript, no DOM)

- `src/geo`: haversine, destination, local equirectangular projection, steps ↔ metres.
- `src/tiles`: tile grid (5 m per 16×16 tile), rasterization (scanline polygon fill, thick segments, 4-connected lines), auto-tiling (4-bit cardinal masks for paths, 8-bit masks reduced to the 47 "blob" tiles for areas).
- `src/routing`: CSR walking graph, A* with per-edge reuse penalties, loop and A→B planners that tune a size parameter until the route lands within ±5 % of the target, evenly spaced checkpoints.
- `src/render`: original palette, procedural tile painter, hand-drawn sprites, chunked renderer with a lazily painted tile atlas and a 1-px-per-tile overview for far zoom.

## Quest runtime (Phase 2)

- `src/quest`: pure GPS filter, route snapping, quest reducer, storage, simulator; browser adapters for Geolocation (`watchPosition`, high accuracy) and the Screen Wake Lock API.
- Web apps cannot track in the background with the screen off; never promise it. Keep the screen awake and make every state change resumable.

## Sound (Phase 4)

- `src/audio`: everything is synthesized in code with the Web Audio API: the formant voice (`voice/`), the chiptune, the effects. No samples, no third-party speech code (do not port SAM or any other synth).
- The AudioContext is created only inside a user gesture ("Start quest", the sound button). Keep decision logic pure and testable; only `engine.ts` touches Web Audio.
- Every spoken phrase lives in `src/i18n` under `voice.*`, with plural forms; English words must be in `EN_LEXICON` (a test checks it).

## Quality bar

- Test tooling: Vitest, happy-dom, fast-check, and `rolldown` (devDependency, `~1.2` as Vite 8 uses) for `parseAst` in the i18n source scan; keep it in step with Vite. TypeScript 7 has no JS compiler API to parse with.
- `npm test` (Vitest, happy-dom) and `npm run lint` (Oxlint) must be green and `npm run build` must pass before a phase is called done. Do not start the next phase while the current one is broken.
- Tests run on the bundled fixture, so they never touch the network.
- Screenshots for review: `npm run build && npx vite preview --host 127.0.0.1 --port 4188` then `PHASE1_URL=http://127.0.0.1:4188/stepquest/ npm run screenshots`.

## Git hygiene

- Commits are authored and committed only as `Ilias El Jaafari El Idrissi <ilias.el.jaafari.el.idrissi@gmail.com>`; no co-author trailers.
