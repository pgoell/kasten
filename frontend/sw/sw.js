// kasten's service worker, which lets the installed app open with no signal.
//
// Plain JS and a classic script, because nothing bundles it: `sw/plugin.ts`
// copies it into the build as `/sw.js` and writes the two values below. The
// list changes with every release, so every release changes these bytes and
// the browser installs the new worker.
//
// The shell is network-first, so a new release reaches the app on its next
// start (#368), unless the network has not answered within SLOW_MS: then the
// cached shell opens and the late answer is kept for the start after. oauth2-proxy sits in front
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

/** How long a navigation waits for the network before the cached shell opens instead. */
const SLOW_MS = 3000;

/** The query `src/lib/app/session.ts` adds to its sign-in reload, which must reach the gate. */
const SIGN_IN = "signin";

/** Where the manifest's `share_target` posts what the phone shared. */
const SHARE = "/api/finance/receipts/share";

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method === "POST" && new URL(request.url).pathname === SHARE) {
    event.respondWith(share(request));
    return;
  }
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (PASS.some((prefix) => url.pathname.startsWith(prefix))) return;

  if (request.mode === "navigate") event.respondWith(navigate(event, url));
  else if (url.pathname.startsWith("/assets/")) event.respondWith(hashed(request));
  else event.respondWith(fresh(event));
});

/**
 * Every page is the one shell, so a navigation offline answers "/" whatever
 * route it asked for. Online the network answers as it came, a redirect to
 * the sign-in or a 401 included, and only a usable shell replaces the cached one.
 * A network slower than SLOW_MS gets the cached shell, except on the sign-in
 * reload, which would otherwise open the cached shell again and loop.
 */
async function navigate(event, url) {
  const cache = await caches.open(CACHE);
  const network = fetchShell(event.request, cache);
  const cached = url.searchParams.has(SIGN_IN) ? undefined : await cache.match("/");
  return (await soon(event, network, cached)) ?? (await cache.match("/")) ?? Response.error();
}

/**
 * The network's answer, or `cached` when it has not come within SLOW_MS, the late answer still
 * landing in the cache. Undefined offline. With nothing cached it waits for the network.
 */
async function soon(event, network, cached) {
  if (!cached) return network;
  event.waitUntil(network);
  let timer;
  const slow = new Promise((resolve) => {
    timer = setTimeout(() => resolve(cached), SLOW_MS);
  });
  const answer = await Promise.race([network, slow]);
  clearTimeout(timer);
  return answer ?? cached;
}

/** The network's answer to a navigation, kept as the shell when usable, or undefined offline. */
async function fetchShell(request, cache) {
  let response;
  try {
    response = await fetch(request);
  } catch (error) {
    // A network failure is a TypeError; anything else is a fault to surface.
    if (!(error instanceof TypeError)) throw error;
    return undefined;
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

/**
 * The unhashed public files keep their names across releases, so the network answers first. The
 * shell's head blocks on two of them, so a slow network gets the cached copy as a navigation does.
 */
async function fresh(event) {
  const cache = await caches.open(CACHE);
  const network = fetchKept(event.request, cache);
  return (await soon(event, network, await cache.match(event.request))) ?? Response.error();
}

/** The network's answer, kept when usable, or undefined offline. */
async function fetchKept(request, cache) {
  let response;
  try {
    response = await fetch(request);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return undefined;
  }
  if (usable(response)) await cache.put(request, response.clone());
  return response;
}

/** A todo's reminder shows as a notification; a click opens the note it is in. */
self.addEventListener("push", (event) => {
  const { title, body, path, line, tag, text } = event.data.json();
  const url = `/?note=${encodeURIComponent(path)}&line=${line}`;
  // Only a reminder names its line, and only where the browser shows buttons: not iOS.
  const acts = text !== undefined && self.Notification?.maxActions > 0;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      data: acts ? { url, path, text } : { url },
      ...(acts && { actions: ACTIONS }),
    }),
  );
});

const ACTIONS = [
  { action: "done", title: "Done" },
  { action: "tomorrow", title: "Tomorrow" },
];
/** How long a button waits on the backend, so opening the note still counts as the tap's. */
const ACT_WAIT = 4000;

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { url, path, text } = event.notification.data;
  event.waitUntil(event.action ? act(event.action, path, text, url) : openNote(url));
});

/** Write a button through the backend; any answer but its 204 opens the note instead. */
async function act(action, path, text, url) {
  let answer;
  try {
    answer = await fetch("/api/push/act", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, path, text }),
      // A lapsed sign-in answers a redirect, which must not read as done.
      redirect: "manual",
      signal: AbortSignal.timeout(ACT_WAIT),
    });
  } catch (error) {
    if (!(error instanceof TypeError || error?.name === "TimeoutError")) throw error;
  }
  if (answer?.status !== 204) await openNote(url);
}

/** Point an open window of this origin at `url`, or open one when none is open. */
async function openNote(url) {
  const [open] = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  if (!open) return self.clients.openWindow(url);
  await open.focus();
  await open.navigate(url);
}

/**
 * A share from the phone goes to the backend, which keeps its files as receipts and opens
 * `/capture`. With no signal, or files over the backend's size cap (a 413), the text still
 * reaches the capture page, as it did when the share was a plain GET; the page says how many
 * files did not go, and why.
 */
async function share(request) {
  const copy = request.clone();
  let missed = "offline";
  try {
    const answer = await fetch(request);
    // Over the size cap the backend answers JSON, which is no page to land on.
    if (answer.status !== 413) return answer;
    missed = "toolarge";
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
  }
  const form = await copy.formData();
  const params = new URLSearchParams();
  for (const key of ["title", "text", "url"]) {
    const value = form.get(key);
    if (typeof value === "string" && value !== "") params.set(key, value);
  }
  const files = form.getAll("receipts").length;
  if (files > 0) params.set(missed, String(files));
  return Response.redirect(new URL(`/capture?${params}`, self.location.origin).href, 303);
}
