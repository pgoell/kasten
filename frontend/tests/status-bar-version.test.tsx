import { render, screen } from "@testing-library/react";
import { StatusBar } from "@/components/status-bar";

// The frontend's own half of the reading is stamped in at build time, so it is
// whatever commit the checkout running these tests is on. Mocked to a fixed one
// rather than read, or the cases below would assert against the working tree.
const { BUILD } = vi.hoisted(() => ({ BUILD: { value: "" } }));
vi.mock("@/lib/build", () => ({
  get BUILD() {
    return BUILD.value;
  },
}));

afterEach(() => {
  BUILD.value = "";
});

describe("the clock in the bar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("names the release in production, where the bundle carries no commit", () => {
    // Nothing to tell apart there: the three images ship under one tag, so the
    // backend's release is the whole reading.
    render(<StatusBar version="0.8.0" />);

    expect(screen.getByTestId("version")).toHaveTextContent("0.8.0");
  });

  it("names both services in development, where each runs its own code", () => {
    // The shell is left out: it is an image built by hand and has no way to
    // report itself. These two are what a `mise run dev:up` moves.
    BUILD.value = "def5678";

    render(<StatusBar version="abc1234" />);

    expect(screen.getByTestId("version")).toHaveTextContent("be abc1234 fe def5678");
  });

  it("says nothing about a version the backend has not answered for yet", () => {
    render(<StatusBar />);

    expect(screen.queryByTestId("version")).toBeNull();
  });

  it("drops the weekday, the week and the version below md", () => {
    BUILD.value = "abc1234";
    render(<StatusBar version="0.36.0" />);

    expect(screen.getByText(/^CW \d+$/)).toHaveClass("max-md:hidden");
    expect(screen.getByTestId("version")).toHaveClass("max-md:hidden");
  });
});
