import { act, render, screen } from "@testing-library/react";
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
