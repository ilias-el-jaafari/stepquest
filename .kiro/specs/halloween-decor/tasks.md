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
- [ ] 89.9 Measure the 4×-throttled phone profile walking and panning (about 55 to 60 fps, no new long task) in a browser before release
  - _Requirements: H8.2_

## Polish from browser review (València start, 390 × 844 at 2×, default quest zoom)

- [x] 89.10 No decor visible in a city quest. Root causes, found by counting rejections of the lattice sites in the built app (716 sites in the loaded chunks, 15 accepted): (1) the 3×3 street-free rule rejected 63 % of the sites and the terrain rules refused building terrain, which in the town is where the gardens are (houses are drawn on it, so 42 % of the sites sat on it); (2) the per-chunk cap (5 at quest zoom) was set for a screen of about one chunk, but at quest zoom a screen is 0.3 to 0.5 chunk, so only 1 to 3 items were left on screen, half of them under the HUD cards; (3) bats were `#2e2542`, nearly the night ground colour. Fix: small still items need only their tile and the one above free of streets; open yards count as ground (`YardTest` from the town lookup); the lattice accepts 0.55; caps per chunk grow with the zoom; day density 0.8; keep-out 1 tile; bats `#8a78c0`. The canvas shows `data-decor="statics,animated"` for browser checks. Measured at quest zoom in València: 11 to 12 static items on the screen by day and at night, plus 12 moving or flickering at night.
  - _Requirements: H3, H4, H5_
- [x] 89.11 Tests: yard placement, tile and 3×3 clearance by kind, new caps, golden frames updated
  - _Requirements: H10_
