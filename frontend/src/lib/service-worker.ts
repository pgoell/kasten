/**
 * Register the worker that lets the installed app open offline.
 *
 * Production builds only: the dev server emits no `/sw.js`, and a worker there
 * would answer hot reloads from a cache. Registered on `load` so its precache
 * does not compete with the first paint. A refusal costs the offline start and
 * nothing else, so it is logged and the app goes on.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .catch((error: unknown) => console.warn("kasten: service worker not registered", error));
  });
}

registerServiceWorker();
