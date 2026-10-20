/**
 * Drop the lists app's worker and caches. #740: a browser that opened the lists
 * app on the main host before #739 still holds its worker at scope `/` and its
 * `lists-*` cache. The main app never loads on the share host, so the share
 * host's worker is never reached from here.
 */
async function dropListsWorker(): Promise<void> {
  for (const registration of await navigator.serviceWorker.getRegistrations()) {
    const worker = registration.active ?? registration.waiting ?? registration.installing;
    if (worker && new URL(worker.scriptURL).pathname === "/lists-sw.js") {
      await registration.unregister();
    }
  }
  for (const name of await caches.keys()) {
    if (name.startsWith("lists-")) await caches.delete(name);
  }
}

/**
 * Register the worker that lets the installed app open offline.
 *
 * Production builds only: the dev server emits no `/sw.js`, and a worker there
 * would answer hot reloads from a cache. Registered on `load` so its precache
 * does not compete with the first paint. A refusal costs the offline start and
 * nothing else, so it is logged and the app goes on. The lists cleanup runs
 * first and its failure is logged too, so it never blocks the registration.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    dropListsWorker()
      .catch((error: unknown) => console.warn("kasten: lists worker not dropped", error))
      .then(() => navigator.serviceWorker.register("/sw.js"))
      .catch((error: unknown) => console.warn("kasten: service worker not registered", error));
  });
}

registerServiceWorker();
