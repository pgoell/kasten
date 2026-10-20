// The worker of the shared lists app. It lets the app open with no connection,
// and it never answers `/share/*` from a cache: a list read from one would be
// stale, and a tick could look undone when it is not.

const CACHE = "lists-shell-1";
const SHELL = "/";

self.addEventListener("install", (event) => {
  // The shell is fetched up front so the first open can work offline. A failed
  // fetch must not fail the install, so the error is dropped here.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(SHELL).catch(() => undefined)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/share/")) return;
  event.respondWith(networkFirst(request));
});

// Network first, so a deploy shows at once. The cache answers only when the
// network does not, which is what lets the app open on a phone with no signal.
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const navigation = request.mode === "navigate";
  const key = navigation ? SHELL : request;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(key, response.clone());
    return response;
  } catch (error) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw error;
  }
}
