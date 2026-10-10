import { act, fireEvent, render, screen } from "@testing-library/react";
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

describe("StatusBar", () => {
  it("says nothing about saving while no note is open", () => {
    // The sample document the app opens with is not a note and is not written
    // anywhere, so a ring reporting it saved would be a lie.
    const { container } = render(<StatusBar />);

    expect(container.querySelector("[data-testid='save-status']")).toBeNull();
    expect(container.querySelector("footer")).not.toBeNull();
  });

  it.each([
    ["saved", "Saved"],
    ["unsaved", "Unsaved changes"],
    ["saving", "Saving"],
    ["error", "Could not save"],
    ["conflict", "Changed on disk"],
  ] as const)("names the %s state for anyone who cannot see the ring", (status, label) => {
    const { container } = render(<StatusBar status={status} />);

    expect(container.querySelector("[data-testid='save-status']")).toHaveAttribute(
      "aria-label",
      label,
    );
  });

  it("names the trouble beside the sign, which a 16px icon on its own does not", () => {
    render(<StatusBar status="conflict" />);

    expect(screen.getByText("Changed on disk")).toBeInTheDocument();
  });

  it("says nothing beside the ring while the writing is going fine", () => {
    render(<StatusBar status="saving" />);

    expect(screen.queryByText("Saving")).toBeNull();
  });

  it("says on hover what the vault answered and what to do about it", () => {
    const { container } = render(
      <StatusBar status="error" reason="PUT /api/files/index.md failed with 500" />,
    );

    const title = container.querySelector("[data-testid='save-status']")?.getAttribute("title");
    expect(title).toContain("PUT /api/files/index.md failed with 500");
    expect(title).toContain(":w");
  });

  it("says on hover both ways out of a note that changed on disk", () => {
    const { container } = render(<StatusBar status="conflict" />);

    const title = container.querySelector("[data-testid='save-status']")?.getAttribute("title");
    expect(title).toContain(":w");
    expect(title).toContain(":e!");
  });

  it("shows the warning sign rather than the ring when the note changed on disk", () => {
    // A spinning ring reads as a write on its way out, and while the note
    // stands conflicted nothing is on its way anywhere until `:w`.
    const { container } = render(<StatusBar status="conflict" />);

    expect(container.querySelector("[data-testid='save-error']")).not.toBeNull();
    expect(container.querySelector("[data-testid='save-spinner']")).toBeNull();
  });
});

describe("the clock in the bar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the weekday, the date, the week and the time", () => {
    vi.setSystemTime(new Date(2026, 7, 5, 15, 52));

    render(<StatusBar />);

    expect(screen.getByText("Wednesday")).toBeInTheDocument();
    expect(screen.getByText("2026-08-05")).toBeInTheDocument();
    expect(screen.getByText("CW 32")).toBeInTheDocument();
    expect(screen.getByText("15:52")).toBeInTheDocument();
  });

  it("turns the minute over when the wall clock does", async () => {
    vi.setSystemTime(new Date(2026, 7, 5, 15, 52, 30));
    render(<StatusBar />);
    expect(screen.getByText("15:52")).toBeInTheDocument();

    // The tick is lined up with the wall clock, so it is due in the 30 seconds
    // left of this minute rather than a full minute from mount.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(screen.getByText("15:53")).toBeInTheDocument();
  });

  it("shows the clock whether or not a note is open", () => {
    vi.setSystemTime(new Date(2026, 7, 5, 15, 52));

    render(<StatusBar status="saved" />);

    expect(screen.getByText("CW 32")).toBeInTheDocument();
  });

  it("puts one sentence about a failure in the bar, with no note open", () => {
    render(<StatusBar notice="A book is already there" />);

    expect(screen.getByText("A book is already there")).toBeInTheDocument();
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

  it("drops the weekday, the week and the version below md", () => {
    BUILD.value = "abc1234";
    render(<StatusBar version="0.36.0" />);

    expect(screen.getByText(/^CW \d+$/)).toHaveClass("max-md:hidden");
    expect(screen.getByTestId("version")).toHaveClass("max-md:hidden");
  });

  it("gives a notice the clock's room below md", () => {
    const { rerender } = render(<StatusBar />);
    const clock = () => screen.getByText(/^CW \d+$/).parentElement;
    expect(clock()).not.toHaveClass("max-md:hidden");

    rerender(<StatusBar notice="A book is already there" />);
    expect(clock()).toHaveClass("max-md:hidden");
  });

  it("opens a notice out in full on a tap, and shuts it on the next", () => {
    // A finger cannot hover, so the `title` that carries the rest is no use.
    render(<StatusBar notice="A book is already there" />);
    expect(screen.queryByTestId("status-detail")).toBeNull();

    fireEvent.click(screen.getByTestId("notice"));
    expect(screen.getByTestId("status-detail")).toHaveTextContent("A book is already there");

    fireEvent.click(screen.getByTestId("status-detail"));
    expect(screen.queryByTestId("status-detail")).toBeNull();
  });

  it("shuts with the notice it showed, so the next one arrives closed", () => {
    const { rerender } = render(<StatusBar notice="A book is already there" />);
    fireEvent.click(screen.getByTestId("notice"));
    expect(screen.getByTestId("status-detail")).toBeInTheDocument();

    rerender(<StatusBar />);
    rerender(<StatusBar notice="The upload was too large" />);
    expect(screen.queryByTestId("status-detail")).toBeNull();

    // One notice replacing another shuts it as well, nobody having asked for
    // the second in full.
    fireEvent.click(screen.getByTestId("notice"));
    rerender(<StatusBar notice="A book is already there" />);
    expect(screen.queryByTestId("status-detail")).toBeNull();
  });

  it("shuts with the failure it showed, so the next one arrives closed", () => {
    const { rerender } = render(<StatusBar status="error" reason="507" />);
    fireEvent.click(screen.getByTestId("save-status"));
    expect(screen.getByTestId("status-detail")).toBeInTheDocument();

    rerender(<StatusBar status="saved" />);
    rerender(<StatusBar status="error" reason="507" />);
    expect(screen.queryByTestId("status-detail")).toBeNull();
  });

  it("opens out why a write failed and what to do about it, on a tap", () => {
    render(<StatusBar status="error" reason="507 the disk is full" />);

    fireEvent.click(screen.getByTestId("save-status"));

    const detail = screen.getByTestId("status-detail");
    expect(detail).toHaveTextContent("Could not save");
    expect(detail).toHaveTextContent("507 the disk is full");
    expect(detail).toHaveTextContent(":w or ctrl+s writes it again");
  });

  it("opens nothing out of a save that went fine", () => {
    render(<StatusBar status="saved" />);

    fireEvent.click(screen.getByTestId("save-status"));

    expect(screen.queryByTestId("status-detail")).toBeNull();
  });

  it("keeps the bar out of the tab order, a keyboard having the hover", () => {
    render(<StatusBar status="error" notice="A book is already there" />);

    for (const button of screen.getAllByRole("button")) {
      expect(button).toHaveAttribute("tabindex", "-1");
    }
  });

  it("cuts a long notice short rather than widen the bar", () => {
    render(<StatusBar notice="A book is already there" />);

    const notice = screen.getByTestId("notice");
    expect(notice).toHaveClass("truncate");
    expect(notice).toHaveAttribute("title", "A book is already there");
  });

  it("draws the notice before the archive tag", () => {
    render(<StatusBar notice="A book is already there" archive />);

    const notice = screen.getByText("A book is already there");
    // The order and not the Tailwind class: a class assertion is a change
    // detector, and the colour is a design choice rather than behaviour.
    expect(notice.compareDocumentPosition(screen.getByTestId("archive-shown"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});
