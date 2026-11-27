---
inclusion: fileMatch
fileMatchPattern: ["src/render/**", "src/ui/**", "**/*.css"]
---

# Visual style

A handheld-RPG overworld, in the spirit of Game Boy Color / Game Boy Advance era monster-collecting games, but **entirely original**. Never copy, trace or sample sprites, tiles, palettes or UI from Nintendo, Game Freak or any other commercial game.

## Map

- 16×16 tiles, top-down with a light 3/4 cheat: buildings show a front wall with windows and doors on their south edge.
- Terrains: pale town ground, park grass (with trees and tufts), water with sand shores, asphalt roads with kerbs, sandy footpaths, zebra crossings.
- Auto-tiling everywhere: area terrains use 8-bit blob masks (outer edges, outer and inner corners); paths use 4-bit masks (ends, straights, corners, tees, crossroads).
- One roof colour per building block (flood-filled), from a small palette of five.
- Nearest-neighbour scaling only. Far zoom switches to a 1-pixel-per-tile "town map" in the same palette.
- The route is a trail of red footprints; checkpoints are numbered gold "step gems"; the finish is a chequered flag; the walker is a small kid with a beanie and yellow headphones (our own design); the player dresses it in the Hero tab (boy or girl; skin, hair, cap, shirt and trousers from palettes of 6–8 swatches), and the map walker and header avatar wear that look.
- Shallow diagonal streets get one long asphalt wedge per flat run, so kerbs run straight instead of in stairs.

## The ghost guide (Wisp, ghost-guide spec)

- A small rounded sheet ghost, 16×16, our own design: a domed head with a tiny tuft, a wavy two-frame hem, two separate 2×2 ink eyes, a pink blush on each cheek, a one-pixel mouth below, a gold lantern held on its right (mirrored when it walks left). Nothing from any other game's ghosts. On the map it is drawn 1.5 times the size of a tile sprite with a faint glow at night.
- Colours (`src/ghost/art.ts`): ink `#1b1a2e` outline and eyes, sheet `#e9e4ff`, highlight `#ffffff`, shade `#bdb2ee`, blush `#ff8fa3`, lantern gold `#ffd84a`.
- Frames: float (hem wave every 320 ms), happy (arched eyes, finish), boo (open mouth, night scare). It bobs one art pixel in four steps.
- It floats 6 m ahead of the pace point on the route, under the hero in draw order, with a warm lantern glow at night. HUD bubble: paper fill, ink outline, 8 px Press Start 2P, the ghost's face on its left.
- Motion is a pop (0.45 s, 3 steps) for "Boo!", a spin and three twinkling sparkles at the finish. Reduced motion removes all of it; only the walk along the route remains. Never a jump-scare. The scare has a soft "¡Bu!" jingle (see Sound below), never a loud or sudden sound.

## Sound (chiptune spec)

- **Tone:** spooky-cute. Minor key with a whole-tone wander, short tip-toe motifs, bouncy answers; playful, never menacing, never a stinger. The music is the walk's background, not a soundtrack that demands attention.
- **Loudness:** low. The loop peaks at 0.12 of full scale at full sliders; jingles stay under 0.5 and the scare is the softest of them; the loop steps back to a third while a jingle or the voice plays. Nothing may clip: new voices and jingles are checked against the budget in the tests.
- **Own work only:** every sound is synthesized in code (pulse 12.5 / 25 / 50 %, triangle, LFSR noise). No samples, no recorded audio, no copyrighted or recognisable melodies; write new motifs from scratch.
- **Consent:** sound starts only after a tap and never while muted. "Chiptune music" has its own switch; the jingles belong to the effects channel.

## Halloween decor (halloween-decor spec)

- Original pixel art in code (`src/decor/art.ts`), painted once into a 128 × 52 px atlas (29 frames). Nothing external or trademarked; no characters from other works. Light from the top-left like the tiles. Art is drawn at its own size for the quest zoom (a tree is about 14 art pixels wide, so a pumpkin is about as wide); never scale a small sprite up.
- Sizes in art pixels (a tile is 16): pumpkin 13×12 (and a small one 8×7 beside it), jack-o'-lantern 13×12 (unlit and lit), bat 13×7 (two wing frames, red eyes), cobweb 8×8 (four corners), sitting skeleton 12×15 (two frames, waving), gravestone 10×12 (arched with a cross, slab, cross-shaped; clusters of one to three), crow 11×9, candle 6×11 (unlit and lit), lantern 9×10 (unlit and lit), witch hat 8×6, fog wisp 20×9, glow 16×16 (three stepped rings), scarecrow 13×20, cauldron 14×12 (by day, and lit with a fire at night), haunted signpost 12×17, picket fence 16×11 with a small pumpkin in front, hanging spider 9×12.
- Decor palette (documented here, defined in `DECOR`): pumpkin `#f08a24` / shade `#b3500f` / light `#ffc060` / rib `#d06a14`, stem `#3f7a2a`, carved face `#4a2410`, lit face `#ffd84a`; bone `#efe9d6`, bone shade `#b9b09a`; bat `#8a78c0`, eyes `#ff5a5a`; stone `#a7a3b5` / shade `#6f6b82` / mark `#4d4a60`, moss `#5d8c4a`; web `#e8e6f2`; crow `#25222f`, sheen `#5b5878`, beak `#e0a030`; wax `#f4ecd0`, flame `#ffb02e` / core `#fff0a0`; lantern `#d9412c` / `#8f2a1e` / off `#a05a2a`; hat `#4b2a6e`, band `#ffd84a`; fog `#cfd6ee`; glow `#ffa23c` (rings at 10, 22 and 40 % alpha); scarecrow sack `#d9b16a`, straw `#e6c45a`, shirt `#b5502e`, patch `#4b7aa8`; wood `#8a5a32` / dark `#5a381e` / light `#b98550`; iron `#3a3850` / light `#6a6890`, brew `#7be04a` / `#c8ff8a`, fire `#ff8a1e`; picket `#efe9d6` / shade `#b9b09a`; spider `#3a2a5e`, mark `#ff6a2e`, thread `#d8d8e8`.
- Anchors: green areas (not pitches, playgrounds, farmland; spiders and bats favour woods), plazas, open garden yards (a front fence is fine), ground near landmarks and at lot corners, building corners (cobwebs), cemeteries (graves, fog), garden trees (spiders). Never on a street, path or crossing, on water or on a house, nor within 1 tile of the route, start or finish; low items (12 px or less) may stand against a house wall; a sprite's width counts, so nothing overhangs a street; animated items keep 1.5 tiles from the hero and a street-free 3×3. The witch hat is the one exception: it sits on one lamp post in five, at night, where the post is drawn. Two items are never closer than 3.8 m.
- Density: hidden below zoom 8; static items per 32-tile chunk 3 at zoom 8, 10 at 12, 26 at 16, 90 at 24 (quest zoom), 120 at 32, 150 at 48; a city screen at quest zoom shows about 40, 10 to 20 of them in the map area free of the HUD cards. By day 85 % of the items (by rank), unlit, only waving skeletons move. At night all of them, lit with stepped additive glows (jack 2.8, candle 2, lantern 2.4, cauldron 3.2 tiles), plus up to five bats per chunk, fog at 38 % opacity, flicker and lamp-post hats.
- Motion: at most 16 animated items per frame, stepping at 12 Hz (bats flap at 6 Hz and orbit in 14 to 22 s within 0.55 tile, fog drifts 0.3 tile over 30 s, skeletons wave at 3 Hz). Reduced motion stops everything (first frames, no drift, no flicker, no timer). Static items live in the cached scene, animated ones in the overlay under the route and the hero.
- Settings: "Halloween decor" / "Decoración de Halloween", on by default; `?decor=0` turns it off for a visit.

## Tile rules (task 51)

- Light comes from the top-left: highlights on top and left edges, shade on the bottom and right. Kerbs on the south and east side of a road are bright, north and west are shaded; zebra bars shade their lower or right row.
- Streets: sparse asphalt grain (no checkerboard), pale kerbs with paving joints, a dashed `laneMark` centre line (8 px on, 8 px off) only on streets at least 3 tiles wide. Park paths are packed earth; other footways and plazas are flagstones.
- Grass varies by tile hash only: tufts, stones, flowers, trees with bushes beside them. Never use random numbers or time, so panning never shimmers.
- Water has three ripple frames at 450 ms; with `prefers-reduced-motion` only frame 0 is shown.
- Houses pick one of three roof styles (shingles, seams, clay tiles), shutters, base course, porch and chimney from their seed; some apartment blocks get shop fronts with striped awnings.
- Palette: stay inside `src/render/palette.ts`. Task 51 added `kerbLight #f1f0fa`, `pebble #b7ad9a` and four awning stripe pairs; add colours sparingly and document them here. No external art, nothing resembling another game's tiles.

## UI

- Dark ink background with a subtle dot grid; panels are RPG dialog boxes: black outline with notched 8-bit corners (drawn with offset box-shadows, never border-radius), blue inner rule, warm paper fill, stepped hard drop shadow.
- During a quest the map is the screen of a plain handheld console: plastic body, dark bezel with a power light and two thin stripes. No brand, no logo, no extra console buttons; the existing buttons keep the 8-bit style.
- Press Start 2P for all text, small sizes (7–12 px), no smoothing.
- Buttons are chunky handheld-console buttons, one family on every screen (planner, map controls, quest HUD, Bag/Hero/Settings, dialogs, sound and info menus):
  - **Pill** buttons carry text actions; **round** buttons (48×48) carry icon actions (zoom +/−, fit, home, recenter, sound on/off, info/menu, HUD fold; play/pause art is ready for when a pause control exists).
  - A 3 px near-black outline with stepped pixel corners (a `clip-path` staircase on two pseudo-elements, never `border-radius`), a bright saturated fill, a light bevel on the top and left edges and a dark bevel on the bottom and right edges.
  - Pressed: the bevel inverts and the label or icon moves down 2 px; the button itself does not move. `:focus-visible` keeps a 3 px dashed gold outline offset 5 px.
  - Colours: sky blue (default), gold (selected), coral (primary action), mint (primary action in the planner), orange (danger, sound off), grey (disabled). Labels are always ink `#1b1a2e`, never white, so every label passes WCAG AA (4.5:1) on its fill.
  - Icons are original pixel art (12×12 grids in `src/ui/pixelArt.ts`, drawn as crisp SVG rectangles). No icon fonts, no external images.
  - The press area is at least 48 px on both axes in its own box. Panels keep notched corners; pill and round buttons are the only shapes with larger stepped corners.
- Map data attribution is always visible on the map.

## Palette (see `src/render/palette.ts`)

Ink `#1b1a2e`, paper `#fbf7ec`, frame blue `#5d93c9`, coral `#ff4f6d`, gold `#ffd84a`, grass `#74c45a`, water `#4a8ff0`, asphalt `#8d8ca0`, path `#ecc98f`.

Button colours (CSS variables in `src/index.css`, each as fill / light bevel / dark bevel): sky `#5fc1ff` / `#c4ecff` / `#2a7fc4`, gold `#ffd84a` / `#fff3a8` / `#c99a10`, coral `#ff4f6d` / `#ffb0bd` / `#a8304a`, mint `#4be0b8` / `#b8fff0` / `#12997f`, orange `#ff9a3d` / `#ffd3a0` / `#b34a10`, grey `#c9c6d8` / `#eceaf5` / `#8a879f`. They are mirrored in `src/ui/buttonStyle.ts`, which a test uses to check label contrast.

## Accessibility

- Every control offers at least 48 px to press (its own box, or an invisible `::after` press area for compact buttons). Text remains readable on a 390 px wide phone.
- Presses move the label 2 px down and invert the bevel, click quietly on the effects channel (volume and mute apply) and buzz for 8 ms on Android only.
- Motion is retro and short: 150–250 ms with `steps()` (sheets slide in in steps, the selected tab has a blinking ▶, dialogue boxes a bouncing ▼, the steps meter fills block by block).
- `prefers-reduced-motion` turns all of it off, as well as the walk cycles.
