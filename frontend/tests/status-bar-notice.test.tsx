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

  it("puts one sentence about a failure in the bar, with no note open", () => {
    render(<StatusBar notice="A book is already there" />);

    expect(screen.getByText("A book is already there")).toBeInTheDocument();
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
