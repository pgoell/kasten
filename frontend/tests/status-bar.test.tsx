import { act, render, screen } from "@testing-library/react";
import { StatusBar } from "@/components/status-bar";

describe("StatusBar", () => {
  it("says nothing about saving while no note is open", () => {
    // The sample document the app opens with is not a note and is not written
    // anywhere, so a ring reporting it saved would be a lie.
    const { container } = render(<StatusBar />);

    expect(container.querySelector("[data-testid='save-status']")).toBeNull();
    expect(container.querySelector("footer")).not.toBeNull();
  });

  it("names the state for anyone who cannot see the ring", () => {
    const { container } = render(<StatusBar status="unsaved" />);

    expect(container.querySelector("[data-testid='save-status']")).toHaveAttribute(
      "aria-label",
      "Unsaved changes",
    );
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
});
