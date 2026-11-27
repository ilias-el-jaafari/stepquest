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
5. **Errors say what to do next.** Plain words, no codes, no blame. The full rules are in "Mischief in errors" below.
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

## Mischief in errors

Floor Mesters (UX, Kiro): "an error message that makes me laugh. If I smile and still know what to tap next, you've won me over." Owning spec: [error-copy](../specs/error-copy/requirements.md), which lists every state and its key. Every error, empty, offline, permission and loading-failure line follows these rules:

1. **A joke, then the way out.** One short funny line in Wisp's voice (fog, sheets, the afterlife, "even a ghost…"), then what to tap or do. The smile never replaces the instruction.
2. **Name the action.** The line holds a verb from the lists below and, when a button fixes it, the button's own label in quotes (EN “Retry”, ES «Reintentar»). The label must match the real button text.
3. **Two lines at most** on a 390 px phone: 78 characters once the numbers are filled in, counting words that wrap.
4. **No blame.** The streets hide, the map gets lost, Wisp loses sight of you. Never "you denied", "invalid", "you must".
5. **No development talk.** Not a word about servers, caches, requests, codes, permissions APIs or timeouts. "Check your connection" is fine.
6. **Keep the numbers.** Every placeholder the plain line carried (`{min}`, `{max}`, `{steps}`, `{m}`, `{dir}`, `{value}`, `{names}`) stays, with its plural form, in both languages.
7. **Wisp's face goes on error boxes** (`GhostNote`), as decoration. The words carry everything a screen reader needs.
8. **Spanish is its own joke** (¡Ni un fantasma…!), always «tú», not a translation of the English gag.

Action verbs the test accepts (`src/i18n/errorCopy.test.ts`, keep both in step):

- EN: Tap, Raise, Lower, Move, Try, Retry, Turn (on), Pick, Type, Check, Step (outside), Keep, Head, Go, Reload.
- ES: Toca, Sube, Baja, Acerca, Aleja, Mueve, Prueba, Reintentar, Activa/Actívala, Elige, Pon, Escribe, Sal, Ve, Sigue, Mantén, Conéctate, Recarga, Revisa.

| State | Before (EN) | After (EN) |
| --- | --- | --- |
| Goal shorter than the A→B path | Too short: the direct way from A to B is already {min} steps. Pick at least {min} steps or move the finish closer. | Even a ghost needs {min} steps. Tap the button or move the finish closer. |
| Streets would not load | The streets here would not load. Check your connection and try again. | The streets are hiding from me. Check your signal and tap “Retry”. |
| Location denied | Location permission was denied. Allow it in the browser settings, or tap the map to set the start. | Without your location I’m flying blind. Turn it on, or tap the map. |

| Estado | Antes (ES) | Después (ES) |
| --- | --- | --- |
| Objetivo menor que el camino A→B | Demasiado corto: el camino directo de A a B ya son {min} pasos. Pon al menos {min} pasos o acerca la meta. | Ni un fantasma llega así: mínimo {min} pasos. Toca el botón o acerca la meta. |
| Calles sin cargar | No se han podido cargar las calles de aquí. Revisa la conexión e inténtalo de nuevo. | Las calles se me esconden. Revisa la conexión y toca «Reintentar». |
| Ubicación denegada | Has denegado el permiso de ubicación. Actívalo en los ajustes del navegador o toca el mapa para poner la salida. | Sin tu ubicación voy a ciegas. Actívala o toca el mapa. |

Not errors, so left plain: the loading lines ("Loading streets… 3 of 8"), the success notes ("Route ready!") and the clamp notes ("Set to … (allowed: …)").

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
