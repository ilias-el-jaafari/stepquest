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
