import { ErrorComponent, type ErrorComponentProps } from "@tanstack/react-router";

/**
 * How a chunk that failed to load begins its message. The first three are
 * the browsers' module messages, copied from router-core's
 * `isModuleNotFoundError`, which `@tanstack/react-router` does not export;
 * the last is Vite's, for a stylesheet a lazy chunk depends on.
 */
const GONE = [
  "Failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "Importing a module script failed",
  "Unable to preload CSS for ",
];

/** Errors this tab has already reloaded for, so StrictMode's second render paints nothing either. */
const reloading = new WeakSet<object>();

/**
 * Reload once for this message, unless this tab already has.
 *
 * The guard is what stops a loop when the chunk is gone on the new release
 * too. Storage that refuses a read or a write leaves the error on screen.
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
 * The router's error screen, with one reload when a release took a route's chunk away (#379).
 *
 * A tab open across a release asks for chunks the new image no longer has.
 * TanStack's `lazyRouteComponent` reloads for a script that failed to load,
 * but only on the browser's module messages, and a lazy route that depends on
 * a stylesheet fails first with Vite's "Unable to preload CSS", which it
 * shows as an error instead. A reload lands on the new release, and text not
 * yet saved is held on `pagehide` as for any reload.
 */
export function RouteError({ error }: ErrorComponentProps) {
  if (reloading.has(error)) return null;
  const gone = GONE.some((prefix) => error.message.startsWith(prefix));
  if (gone && claim(error.message)) {
    reloading.add(error);
    location.reload();
    return null;
  }
  return <ErrorComponent error={error} />;
}
