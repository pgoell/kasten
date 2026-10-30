import { ErrorComponent, type ErrorComponentProps } from "@tanstack/react-router";

/** Vite's message for a stylesheet a lazy chunk depends on that failed to load. */
const CSS_GONE = "Unable to preload CSS for ";

/** Errors this tab already reloaded for, so StrictMode's second render paints nothing. */
const reloading = new WeakSet<object>();

/** The release this tab last booted; the reload guards are spent per release. */
const RELEASE = "kasten:release";

/** Our guard and TanStack's, which `lazyRouteComponent` keeps per message. */
const GUARDS = ["kasten:chunk-reload:", "tanstack_router_reload:"];

/**
 * Gives a tab its chunk reloads back on a new release (#383). Safari's message names no file,
 * so its one key stays spent unless a release clears it. Booting the same release keeps them.
 */
export function forgetSpentReloads(release: string): void {
  try {
    if (sessionStorage.getItem(RELEASE) === release) return;
    for (const key of Object.keys(sessionStorage)) {
      if (GUARDS.some((prefix) => key.startsWith(prefix))) sessionStorage.removeItem(key);
    }
    sessionStorage.setItem(RELEASE, release);
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
  }
}

/**
 * Reload once per message and release: the guard stops a loop when a chunk is gone on the new
 * release too. Storage that refuses leaves the error on screen.
 */
function claim(message: string): boolean {
  const key = `kasten:chunk-reload:${message}`;
  try {
    if (sessionStorage.getItem(key) !== null) return false;
    sessionStorage.setItem(key, "1");
    return true;
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
    return false;
  }
}

/**
 * The router's error screen. A release that took a route's stylesheet away reloads once (#379).
 * Scripts are not reloaded here: a reload would cancel the editor's unmount flush.
 */
export function RouteError({ error }: ErrorComponentProps) {
  // Anything can be thrown, and the router hands it here as it came.
  const message = error instanceof Error ? error.message : "";
  if (reloading.has(error)) return null;
  if (message.startsWith(CSS_GONE) && claim(message)) {
    reloading.add(error);
    location.reload();
    return null;
  }
  return <ErrorComponent error={error} />;
}
