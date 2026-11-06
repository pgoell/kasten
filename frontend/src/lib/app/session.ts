/**
 * Sends the page through the gate's sign-in once its session has gone. The gate redirects a fetch to
 * another origin, which fails like being offline, so a probe with `redirect: "manual"` tells them apart.
 */

let checking: Promise<void> | null = null;

async function probe(): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/health", {
      redirect: "manual",
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch (error) {
    // Offline: there is no sign-in to reach.
    if (!(error instanceof TypeError)) throw error;
    return;
  }
  // A reload is a navigation, which the gate sends to its sign-in. The editor holds unsaved text at
  // `pagehide`, so nothing typed is lost.
  if (response.type === "opaqueredirect" || response.status === 401) location.reload();
}

/** Probe the session, once at a time however many failures ask. */
export function checkSession(): Promise<void> {
  checking ??= probe().finally(() => {
    checking = null;
  });
  return checking;
}

/** Probe whenever the page comes back into view, as a phone app resumed after days does. */
export function startSessionCheck(): void {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkSession();
  });
}
