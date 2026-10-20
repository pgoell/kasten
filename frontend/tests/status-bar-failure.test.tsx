import { fireEvent, render, screen } from "@testing-library/react";
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
});
