import { render, screen } from "@testing-library/react";
import { StatusBar } from "@/components/status-bar";

// The frontend's own half of the reading is stamped in at build time, so it is
// whatever commit the checkout running these tests is on. Mocked to a fixed one
// rather than read, or the cases below would assert against the working tree.
const { BUILD } = vi.hoisted(() => ({ BUILD: { value: "" } }));
vi.mock("@/lib/app/build", async (actual) => ({
  ...(await actual<typeof import("@/lib/app/build")>()),
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

  it("names no version in production, where the bundle carries no commit", () => {
    render(<StatusBar version="0.8.0" />);

    expect(screen.queryByTestId("version")).toBeNull();
  });

  it("names no version in development while both halves run one commit", () => {
    BUILD.value = "abc1234";

    render(<StatusBar version="abc1234" />);

    expect(screen.queryByTestId("version")).toBeNull();
  });

  it("names both halves in development when the tab's bundle is older than the backend", () => {
    // The shell is left out: it is an image built by hand and has no way to report itself.
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
    render(<StatusBar version="def5678" />);

    expect(screen.getByText(/^CW \d+$/)).toHaveClass("max-md:hidden");
    expect(screen.getByTestId("version")).toHaveClass("max-md:hidden");
  });
});
