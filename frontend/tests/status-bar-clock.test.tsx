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
});
