import { render, screen } from "@testing-library/react";
import { RouteError } from "@/lib/chunk-reload";

const CSS = "Unable to preload CSS for /assets/x.css";

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

  it("shows any other error as before without reloading", () => {
    render(<RouteError error={new Error("boom")} reset={() => {}} />);
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByText("Something went wrong!")).toBeInTheDocument();
  });
});
