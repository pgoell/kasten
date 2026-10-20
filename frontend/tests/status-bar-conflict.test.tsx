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

describe("StatusBar", () => {
  it("opens the diff by itself when the note stands conflicted", () => {
    const conflict = () => ({ vault: "# T\ntheirs\nend", mine: "# T\nmine\nend" });
    const { rerender } = render(<StatusBar status="saved" conflict={conflict} />);
    expect(screen.queryByTestId("status-detail")).toBeNull();

    rerender(<StatusBar status="conflict" conflict={conflict} />);

    expect(screen.getByTestId("status-detail")).toHaveTextContent("Changed on disk");
    const diff = screen.getByTestId("conflict-diff");
    expect(diff).toHaveTextContent("- theirs");
    expect(diff).toHaveTextContent("+ mine");

    rerender(<StatusBar status="saved" conflict={conflict} />);
    expect(screen.queryByTestId("status-detail")).toBeNull();
  });

  it("collapses unchanged lines in the diff", () => {
    const same = Array.from({ length: 12 }, (_, n) => `line ${n + 1}`);
    const vault = ["# T", ...same, "theirs", ...same].join("\n");
    const mine = ["# T", ...same, "mine", ...same].join("\n");
    render(<StatusBar status="conflict" conflict={() => ({ vault, mine })} />);

    const rows = [...screen.getByTestId("conflict-diff").children].map((row) => row.textContent);
    // One line of context either side of the change, the rest one line each.
    expect(rows).toEqual([
      "⋯ 12 lines",
      "  line 12",
      "- theirs",
      "+ mine",
      "  line 1",
      "⋯ 11 lines",
    ]);
  });

  it("keeps the buttons outside the scrolling diff", () => {
    // A long diff on a phone scrolls inside the panel; the two ways out stay
    // below it, where a thumb can reach them however long the diff is.
    const vault = Array.from({ length: 200 }, (_, n) => `vault ${n}`).join("\n");
    const mine = Array.from({ length: 200 }, (_, n) => `mine ${n}`).join("\n");
    render(
      <StatusBar
        status="conflict"
        conflict={() => ({ vault, mine })}
        onWrite={vi.fn()}
        onTakeVault={vi.fn()}
      />,
    );

    const scroller = screen.getByTestId("conflict-diff").closest(".overflow-y-auto");
    expect(scroller).not.toBeNull();
    expect(scroller).toHaveClass("max-h-[50dvh]");
    expect(scroller).not.toContainElement(screen.getByText("Write my text"));
    expect(scroller).not.toContainElement(screen.getByText("Take the vault's"));
  });

  it("writes or takes the vault's from the buttons under the diff", () => {
    const onWrite = vi.fn();
    const onTakeVault = vi.fn();
    const conflict = () => ({ vault: "theirs", mine: "mine" });
    render(
      <StatusBar
        status="conflict"
        conflict={conflict}
        onWrite={onWrite}
        onTakeVault={onTakeVault}
      />,
    );

    const diff = screen.getByTestId("conflict-diff");
    const write = screen.getByText("Write my text");
    expect(diff.compareDocumentPosition(write)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    fireEvent.click(write);
    expect(onWrite).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("conflict-diff")).toBeNull();

    fireEvent.click(screen.getByTestId("save-status"));
    expect(screen.getByTestId("conflict-diff")).toHaveTextContent("- theirs");
    fireEvent.click(screen.getByText("Take the vault's"));
    expect(onTakeVault).toHaveBeenCalledOnce();
  });
});
