/**
 * Drop the lists app's worker and caches, left by #740 on browsers that opened it before #739.
 */
async function dropListsWorker(): Promise<void> {
  // Offline, the lists worker serves the page: dropping it leaves none for the next start.
  if (!navigator.onLine) return;
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
 * Register the offline worker. Production only: a dev worker would answer hot reloads from a cache.
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
