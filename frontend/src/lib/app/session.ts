/**
 * Sends the page through the gate's sign-in once its session has gone. The gate redirects a fetch to
 * another origin, which fails like being offline, so a probe with `redirect: "manual"` tells them apart.
 */

/** Marks the sign-in reload, so the worker waits for the gate rather than open the cached shell. */
const SIGN_IN = "signin";

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
  // A navigation, which the gate sends to its sign-in. The editor holds unsaved text at `pagehide`.
  if (response.type === "opaqueredirect" || response.status === 401) {
    const url = new URL(location.href);
    url.searchParams.set(SIGN_IN, "1");
    location.replace(url.href);
  }
}

/** Probe the session, once at a time however many failures ask. */
export function checkSession(): Promise<void> {
  checking ??= probe().finally(() => {
    checking = null;
  });
  return checking;
}

/**
 * Drop the sign-in mark from the address, and probe whenever the page comes back into view, as a
 * phone app resumed after days does. Before the router reads the address.
 */
export function startSessionCheck(): void {
  const url = new URL(location.href);
  if (url.searchParams.has(SIGN_IN)) {
    url.searchParams.delete(SIGN_IN);
    history.replaceState(history.state, "", url.href);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkSession();
  });
}
