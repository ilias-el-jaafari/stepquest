# Halloween decor: tasks

- [x] 89.1 Spec and steering: this folder, `visual-style.md` (decor palette, sizes, density), specs index
  - _Requirements: H1 to H10_
- [x] 89.2 `decor/art.ts`: sprites, palette, atlas layout and its golden
  - _Requirements: H1, H2_
- [x] 89.3 `decor/place.ts`: seeded lattice placement, categories, chunk cache, `forgetDecor` from `forgetLamps`
  - _Requirements: H3_
- [x] 89.4 `decor/budget.ts` and `decor/anim.ts`: caps by zoom and light, 12 Hz ticks, motion functions
  - _Requirements: H4, H5, H6, H7_
- [x] 89.5 `render/decorLayer.ts` and `MapRenderer` wiring: static pass in the scene, night pass, animated pass in the overlay, keep-out
  - _Requirements: H3.4, H5, H6, H8_
- [x] 89.6 Setting: `decor/pref.ts`, Settings checkbox, `?decor=`, EN/ES strings
  - _Requirements: H9_
- [x] 89.7 Tests: determinism property, street clearance, caps per screen, zoom, day/night, reduced motion, timer, keep-out, atlas golden, two golden frames (older goldens drawn with decor off)
  - _Requirements: H10_
- [x] 89.8 `npm test`, `npx tsc -b`, `npm run lint`, `npm run build`
- [x] 89.9 Measure the 4×-throttled phone profile walking and panning (about 55 to 60 fps, no new long task) in a browser before release: walking 55 to 57 fps, panning 50 to 56 (five runs, `SIMSPEED=20`, 22:30), the pan runs have 6 to 27 long tasks of at most 285 ms against 3 to 7 before the second review; see 89.15
  - _Requirements: H8.2_

## Polish from browser review (València start, 390 × 844 at 2×, default quest zoom)

- [x] 89.10 No decor visible in a city quest. Root causes, found by counting rejections of the lattice sites in the built app (716 sites in the loaded chunks, 15 accepted): (1) the 3×3 street-free rule rejected 63 % of the sites and the terrain rules refused building terrain, which in the town is where the gardens are (houses are drawn on it, so 42 % of the sites sat on it); (2) the per-chunk cap (5 at quest zoom) was set for a screen of about one chunk, but at quest zoom a screen is 0.3 to 0.5 chunk, so only 1 to 3 items were left on screen, half of them under the HUD cards; (3) bats were `#2e2542`, nearly the night ground colour. Fix: small still items need only their tile and the one above free of streets; open yards count as ground (`YardTest` from the town lookup); the lattice accepts 0.55; caps per chunk grow with the zoom; day density 0.8; keep-out 1 tile; bats `#8a78c0`. The canvas shows `data-decor="statics,animated"` for browser checks. Measured at quest zoom in València: 11 to 12 static items on the screen by day and at night, plus 12 moving or flickering at night.
  - _Requirements: H3, H4, H5_
- [x] 89.11 Tests: yard placement, tile and 3×3 clearance by kind, new caps, golden frames updated
  - _Requirements: H10_

## Quest-zoom visibility (second browser review, requirement H11)

- [x] 89.12 Spec first: requirements H3 (spacing, widths, low items, spiders), H4 (caps), H5, H6, H8, new H11; design "Quest-zoom visibility"; `visual-style.md` decor section
  - _Requirements: H1 to H11_
- [x] 89.13 Art: pumpkin and jack-o'-lantern 13 × 12 by rule, larger bat, skeleton, gravestones (rule), crow, candle, lantern, fog; new scarecrow, cauldron (day and lit), signpost, picket fence with pumpkin, spider, small pumpkin; atlas 128 × 52, 29 frames
  - _Requirements: H1, H2, H11.1_
- [x] 89.14 Placement and budget: denser lattice with hash spacing, new categories (wood, tree), sprite half widths, low and tall kinds, one web per corner, caps 3, 10, 26, 90, 120, 150, animated 1, 3, 5 per chunk and 16 per frame, bigger glows, slimmer bat orbit and fog drift
  - _Requirements: H3, H4, H5, H6_
- [x] 89.15 Tests: sizes, new sprites, spacing, widths against streets, quest-zoom budget, `forgetDecor` with a rectangle, goldens (the two decor frames changed on purpose; every other golden is unchanged). Browser check, València start 390 × 844: 41 static and 16 moving items on the screen at 22:30, 41 and 0 at 12:00 (HUD cards cover about 40 %)
  - _Requirements: H10, H11_

## CI note: decor counted as pool images

- [x] 89.16 `nightRender.test.ts` counted decor images (still items, glows, hats, flicker) in the lamp-pool budget, and decor is drawn only on painted chunks, whose number depends on the frame-time budget (`CHUNK_BUDGET_MS`); that made the count differ between a fast and a slow machine (CI red on a762456 and 64171ff). The lamp test now runs with decor off; a separate test holds decor to its own strict budget (by day `2 × staticPerChunk × 4 + animated`, at night `3 × staticPerChunk × 4 + MAX_LAMPS_PER_CHUNK × 4 + animated`, where the factors are the item, its second pumpkin, and the glow) under a frozen and a slow clock; a third test shows the counts ignore the stored decor setting.
  - _Requirements: H4, H10_
