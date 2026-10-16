// kasten's service worker, which lets the installed app open with no signal.
//
// Plain JS and a classic script, because nothing bundles it: `sw/plugin.ts`
// copies it into the build as `/sw.js` and writes the two values below. The
// list changes with every release, so every release changes these bytes and
// the browser installs the new worker.
//
// The shell is network-first and the cache only a fallback, so a new release
// still reaches the app on its next start (#368). oauth2-proxy sits in front
// of every path in production, and a session that expired answers a redirect
// to its sign-in page: only a plain 200 from this origin is ever cached, so
// that page is never stored as the app.

/** "/", every file under `/assets/` and the small public files, written in by `sw/plugin.ts`. */
const PRECACHE = __PRECACHE__;
/** A short hash of that list, which names this release's cache. */
const VERSION = __VERSION__;

const PREFIX = "kasten-";
const CACHE = `${PREFIX}${VERSION}`;

// Never answered from here: the API and the agent door must reach the backend
// or fail, the sign-in must reach oauth2-proxy, and the chat and terminal
// hold streams a cache has no business in.
const PASS = ["/api/", "/oauth2/", "/chat/", "/term/", "/agent/", "/.well-known/"];

/**
 * A response fit to keep: a 200 from this origin that was not redirected.
 *
 * 200 rather than `ok`, because nginx answers a range with a 206 and
 * `cache.put` throws on one.
 */
function usable(response) {
  return response.status === 200 && response.type === "basic" && !response.redirected;
}

self.addEventListener("install", (event) => {
  // Fetched one by one rather than with `cache.addAll`, which follows a
  // redirect and stores whatever 200 it lands on, the sign-in page among them.
  // A refusal fails the install and the worker already running stays.
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(
        PRECACHE.map(async (url) => {
          const response = await fetch(url);
          if (!usable(response)) throw new Error(`kasten: ${url} answered ${response.status}`);
          await cache.put(url, response);
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (PASS.some((prefix) => url.pathname.startsWith(prefix))) return;

  if (request.mode === "navigate") event.respondWith(navigate(request));
  else if (url.pathname.startsWith("/assets/")) event.respondWith(hashed(request));
  else event.respondWith(fresh(request));
});

/**
 * Every page is the one shell, so a navigation offline answers "/" whatever
 * route it asked for. Online the network answers as it came, a redirect to
 * the sign-in or a 401 included, and only a usable shell replaces the cached one.
 */
async function navigate(request) {
  const cache = await caches.open(CACHE);
  let response;
  try {
    response = await fetch(request);
  } catch (error) {
    // A network failure is a TypeError; anything else is a fault to surface.
    if (!(error instanceof TypeError)) throw error;
    return (await cache.match("/")) ?? Response.error();
  }
  // Html alone: a navigation to /favicon.svg or /sw.js is a 200 from this
  // origin too, and stored as "/" it would be what the app starts as offline.
  const html = (response.headers.get("Content-Type") ?? "").startsWith("text/html");
  if (usable(response) && html) await cache.put("/", response.clone());
  return response;
}

/** A hashed name never changes its bytes, so the cache answers first. */
async function hashed(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (usable(response)) await cache.put(request, response.clone());
  return response;
}

/** The unhashed public files keep their names across releases, so the network answers first. */
async function fresh(request) {
  const cache = await caches.open(CACHE);
  let response;
  try {
    response = await fetch(request);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return (await cache.match(request)) ?? Response.error();
  }
  if (usable(response)) await cache.put(request, response.clone());
  return response;
}
