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

  it("says a tab is zoomed, and says nothing while none is", () => {
    // A mode with nothing on screen saying so: a zoomed tab of four panes is
    // drawn exactly like a tab of one, and the direction keys have nowhere to
    // go while it is on.
    const { rerender } = render(<StatusBar />);
    expect(screen.queryByTestId("zoom-shown")).toBeNull();

    rerender(<StatusBar zoom />);
    expect(screen.getByTestId("zoom-shown")).toHaveTextContent("zoom");
  });

  it("says which pane of how many is drawn, and nothing where it was not told", () => {
    // A narrow window draws one pane of a split, which looks like a single note.
    const { rerender } = render(<StatusBar />);
    expect(screen.queryByTestId("pane-shown")).toBeNull();

    rerender(<StatusBar pane="1/2" />);
    expect(screen.getByTestId("pane-shown")).toHaveTextContent("pane 1/2");
  });

  it("goes out of reach under an open drawer", () => {
    const { rerender } = render(<StatusBar />);
    expect(screen.getByRole("contentinfo")).not.toHaveAttribute("inert");

    rerender(<StatusBar inert />);
    expect(screen.getByRole("contentinfo")).toHaveAttribute("inert");
  });

  // jsdom applies no media query, so the three below can only read the class
  // that carries one. What it draws is checked in a browser.
  it("is 44px tall under a finger and 24px under a mouse", () => {
    render(<StatusBar />);

    expect(screen.getByRole("contentinfo")).toHaveClass("h-6", "pointer-coarse:h-11");
  });
});
