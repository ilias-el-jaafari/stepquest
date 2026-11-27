---
inclusion: fileMatch
fileMatchPattern: ["src/i18n/**"]
---

# Copy voice

Everything the player reads (`src/i18n/en.ts`, `es.ts`, speech phrases included) sounds like a finished handheld game: light, playful, never childish. Owning spec: [retro-ui](../specs/retro-ui/requirements.md), requirement 19.

## Rules

1. **Pitch the benefit.** Say what the player gets ("Your routes always favour safer, better-lit streets"), not how it was built.
2. **Explain only what is needed to use it.** One or two short sentences. No history, no reasons behind a decision.
3. **Never describe the product's own constraints.** No settings that cannot be turned off, no toggles that do not exist, no "always on".
4. **No development talk.** Nothing about hackathons, judges, contests, specs, phases, demos for a video, workers, caches, APIs, Overpass, tiles, chunks, graphs or algorithms. OpenStreetMap, OpenFreeMap and OpenMapTiles appear only in the required credit (`map.creditTiles`, `map.creditSchema`, `map.attribution`: "OpenFreeMap © OpenMapTiles © OpenStreetMap contributors").
5. **Errors say what to do next.** Plain words, no codes, no blame.
6. **Buttons stay short.** Never lengthen a button or tab label (`fit.test.ts`).
7. **Spanish is written for Spain, not translated.** Natural phrasing, always "tú", inverted `¡ ¿`, percentages as "5 %" with a no-break space. Same keys, placeholders and plural forms as English.

## The ghost's voice (Wisp)

Wisp is the guide: cheeky, warm, a little spooky, never mean. Rules for every `ghost.*` line and the intro:

1. **Scare first, then help.** A joke or a "Boo!" is fine when the next words say what to do or that all is well ("Boo!" then "Don't worry, this way has street lamps.").
2. **One short sentence**, at most two. It must fit a speech bubble on a 390 px phone (about 45 characters).
3. **Wisp talks to the player, not about the app.** Gems, flag, lantern, pace: yes. Settings, errors in code, development talk: no.
4. **The pace status is gentle.** Behind means "the ghost is waiting for you", never a reproach. No numbers in it.
5. **Spanish is its own joke**, not a translation: "¡Bu!", "Por aquí hay farolas." Always «tú».
6. The ghost is called Wisp in both languages.

| EN | ES |
| --- | --- |
| You are ahead of the ghost! | Vas por delante del fantasma |
| Keeping the ghost's pace | Al ritmo del fantasma |
| Falling behind... the ghost is waiting for you! | Te estás quedando atrás… ¡el fantasma te espera! |

## Do and don't

| Don't (EN) | Do (EN) |
| --- | --- |
| Routes always prefer lit streets. It is always on, no switch needed. | Your routes always favour safer, better-lit streets, especially after dark. |
| This setting cannot be disabled. | (say nothing) |
| Data comes from OpenStreetMap through the Overpass API. | Your location and settings stay on your device. |
| Loaded from this device's cache. | Loaded from your device. |
| For testing and the demo video. | A handy way to preview your quest. |

| No (ES) | Sí (ES) |
| --- | --- |
| Siempre activo, sin interruptor. | Tus rutas siempre priorizan calles más seguras e iluminadas, sobre todo de noche. |
| Esta opción no se puede desactivar. | (no decir nada) |
| Hemos decidido priorizar la seguridad. | Camina con confianza. |
| Descargado de la caché (Overpass). | Cargado desde tu dispositivo. |

## Banned phrases

Enforced by `src/i18n/voice.test.ts`; extend the list there and here together.

- EN: cannot be disabled, can't be turned off, no switch, always on, we decided, by design, hackathon, judges, Kiroween, Resurrection, Overpass, API, cache, worker, spec, A*, graph, tile, chunk, development, developer.
- ES: no se puede desactivar, no se puede apagar, hemos decidido, hemos elegido, sin interruptor, siempre activo, jueces, hackatón, caché, grafo, tesela, desarrollo.
