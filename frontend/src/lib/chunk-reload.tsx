import { ErrorComponent, type ErrorComponentProps } from "@tanstack/react-router";

/** Vite's message for a stylesheet a lazy chunk depends on that failed to load. */
const CSS_GONE = "Unable to preload CSS for ";

/** Errors this tab has already reloaded for, so StrictMode's second render paints nothing either. */
const reloading = new WeakSet<object>();

/** The release this tab last booted, against which the reload guards below were spent. */
const RELEASE = "kasten:release";

/** Our guard and TanStack's, which `lazyRouteComponent` keeps per message. */
const GUARDS = ["kasten:chunk-reload:", "tanstack_router_reload:"];

/**
 * Give a tab its chunk reloads back when it boots on a new release (#383).
 *
 * Both guards live for the tab's session, so a tab open across several
 * releases would reload for the first only. Safari's message for a gone
 * script names no file, so its one key is spent for good after one release.
 * Booting the same release again keeps the guards: that is the boot right
 * after a reload, and a chunk still gone then shows the error, not a loop.
 * Storage that refuses leaves the guards as they are.
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
 * Reload once for this message on this release, unless this tab already has.
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
 * The router's error screen, with one reload when a release took a route's stylesheet away (#379).
 *
 * A tab open across a release asks for chunks the new image no longer has.
 * A gone script is TanStack's: `lazyRouteComponent` reloads while it renders,
 * with the old route still mounted, so the editor's text is held on
 * `pagehide`; `forgetSpentReloads` lets it do so once per release. This
 * screen renders after the old route has unmounted, and a reload here would
 * cancel the editor's unmount flush, so it leaves scripts alone. A lazy
 * route that depends on a stylesheet fails first with Vite's
 * "Unable to preload CSS", which the router does not reload for. Only `/`,
 * the editor's own route, has such a chunk today, so no editor is unmounting
 * when this reloads.
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
