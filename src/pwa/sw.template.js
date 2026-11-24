// Service worker for the installed app: the app shell and the bundled demo map work offline.
// The build (vite.config.ts) fills in the two placeholders below and writes the result to `sw.js`.
// Rules: only same-origin GET requests are cached; map downloads (Overpass, OpenFreeMap tiles) go
// straight to the network (their own IndexedDB cache and the browser's HTTP cache handle them); a new version waits until the user taps
// "Update" in the app, so a quest in progress is never reloaded by surprise.
const BUILD = '__BUILD_ID__'
const FILES = /* __PRECACHE__ */ []
const CACHE = `stepquest-${BUILD}`
const scopeUrl = (path) => new URL(path, self.registration.scope).href

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES.map(scopeUrl))))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('stepquest-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (request.mode === 'navigate') {
    // Pages: the network when it answers (so a new version shows up), the cached shell when it does not.
    event.respondWith(fetch(request).catch(() => caches.match(scopeUrl('./'), { ignoreSearch: true }).then((hit) => hit ?? Response.error())))
    return
  }
  // Everything else is content-hashed or static: the cache first, then the network (and remember it).
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        }),
    ),
  )
})
