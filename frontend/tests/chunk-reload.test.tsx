import { lazyRouteComponent } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { forgetSpentReloads, RouteError } from "@/lib/chunk-reload";

const CSS = "Unable to preload CSS for /assets/x.css";

// Safari's whole message for a module that failed to load: no URL in it.
const SAFARI = "Importing a module script failed.";

/**
 * A route whose chunk is gone, rendered once its import has failed.
 *
 * What the render threw comes back boxed: a reload throws a promise that
 * never settles, which an async function would otherwise wait on for ever.
 */
async function renderGoneRoute(): Promise<{ thrown: unknown }> {
  const Lazy = lazyRouteComponent(() => Promise.reject(new TypeError(SAFARI)));
  await Lazy.preload?.();
  try {
    Lazy({});
  } catch (thrown) {
    return { thrown };
  }
  return { thrown: undefined };
}

describe("a gone route chunk across releases", () => {
  let reload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reloads again in Safari on a later release in the same tab", async () => {
    forgetSpentReloads("A");
    await renderGoneRoute();
    expect(reload).toHaveBeenCalledTimes(1);

    forgetSpentReloads("B");
    await renderGoneRoute();
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("shows the error when the chunk is still gone after the reload on the same release", async () => {
    forgetSpentReloads("B");
    await renderGoneRoute();
    forgetSpentReloads("B");
    const { thrown } = await renderGoneRoute();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(thrown).toBeInstanceOf(TypeError);
  });

  it("clears a spent CSS guard on a new release and keeps it on the same one", () => {
    const key = `kasten:chunk-reload:${CSS}`;
    forgetSpentReloads("A");
    sessionStorage.setItem(key, "1");
    forgetSpentReloads("A");
    expect(sessionStorage.getItem(key)).toBe("1");
    forgetSpentReloads("B");
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it("boots when storage refuses to be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    try {
      expect(() => forgetSpentReloads("A")).not.toThrow();
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("RouteError", () => {
  let reload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    reload = vi.fn();
    // jsdom's `location.reload` is unforgeable, so the whole object is swapped.
    vi.stubGlobal("location", { ...window.location, reload });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reloads once when a route's CSS chunk is gone after a release", () => {
    render(<RouteError error={new Error(CSS)} reset={() => {}} />);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("shows the error instead of reloading again for the same chunk", () => {
    render(<RouteError error={new Error(CSS)} reset={() => {}} />).unmount();
    render(<RouteError error={new Error(CSS)} reset={() => {}} />);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Something went wrong!")).toBeInTheDocument();
  });

  it("leaves a gone JS chunk to the router and does not reload itself", () => {
    const error = new Error("Failed to fetch dynamically imported module: /assets/x.js");
    render(<RouteError error={error} reset={() => {}} />);
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByText("Something went wrong!")).toBeInTheDocument();
  });

  it("shows a thrown value that is not an Error as before", () => {
    render(<RouteError error={"boom" as unknown as Error} reset={() => {}} />);
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByText("Something went wrong!")).toBeInTheDocument();
  });

  it("shows any other error as before without reloading", () => {
    render(<RouteError error={new Error("boom")} reset={() => {}} />);
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByText("Something went wrong!")).toBeInTheDocument();
  });
});
