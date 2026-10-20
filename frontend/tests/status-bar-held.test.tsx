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
  it("sends the reader back to a note left behind whose write failed", () => {
    // That text is held for its own note, so the `:w` here, which writes the
    // open note, is not the way to it: opening that note is.
    const { container } = render(
      <StatusBar
        status="saved"
        held={[{ path: "Notes/index.md", reason: "PUT failed with 500" }]}
      />,
    );

    // The open note's own reading is left alone by it.
    expect(container.querySelector("[data-testid='save-status']")).toHaveAttribute(
      "aria-label",
      "Saved",
    );
    const held = screen.getByTestId("held");
    expect(held).toHaveTextContent("Not saved: index");
    const title = held.getAttribute("title");
    expect(title).toContain("Notes/index.md: PUT failed with 500");
    expect(title).toContain("Open the note to write it again, or :e! there to drop it.");
  });

  it("lists every held note, and drops each from the list when its text goes", () => {
    const one = { path: "a.md", reason: "PUT failed with 500" };
    const two = { path: "Sub/b.md", reason: "PUT failed with 502" };
    const { rerender } = render(<StatusBar held={[one, two]} />);

    const held = screen.getByTestId("held");
    expect(held).toHaveTextContent("Not saved: 2 notes");
    expect(held.getAttribute("title")).toContain("a.md: PUT failed with 500");
    expect(held.getAttribute("title")).toContain("Sub/b.md: PUT failed with 502");

    rerender(<StatusBar held={[two]} />);
    expect(screen.getByTestId("held")).toHaveTextContent("Not saved: b");
    expect(screen.getByTestId("held").getAttribute("title")).not.toContain("a.md");

    rerender(<StatusBar held={[]} />);
    expect(screen.queryByTestId("held")).toBeNull();
  });

  it("names a note holding two texts once, and lists both", () => {
    render(
      <StatusBar
        held={[
          { path: "a.md", reason: "PUT failed with 500" },
          { path: "a.md", reason: "PUT failed with 502" },
        ]}
      />,
    );

    const held = screen.getByTestId("held");
    expect(held).toHaveTextContent("Not saved: a");
    expect(held.getAttribute("title")).toContain("a.md: PUT failed with 500");
    expect(held.getAttribute("title")).toContain("a.md: PUT failed with 502");
  });

  it("opens the held list out on a tap, a finger having no hover", () => {
    render(<StatusBar held={[{ path: "a.md", reason: "PUT failed with 500" }]} />);

    fireEvent.click(screen.getByTestId("held"));
    const detail = screen.getByTestId("status-detail");
    expect(detail).toHaveTextContent("a.md: PUT failed with 500");
    expect(detail).toHaveTextContent("Open the note to write it again");

    fireEvent.click(detail);
    expect(screen.queryByTestId("status-detail")).toBeNull();
  });

  it("lists a conflict left behind under its own label", () => {
    render(
      <StatusBar
        held={[{ path: "Notes/index.md", reason: "Changed on disk", conflicted: true }]}
      />,
    );

    expect(screen.queryByTestId("held")).toBeNull();
    const conflict = screen.getByTestId("held-conflict");
    expect(conflict).toHaveTextContent("Changed on disk: index");

    fireEvent.click(conflict);
    const detail = screen.getByTestId("status-detail");
    expect(detail).toHaveTextContent("Notes/index.md: Changed on disk");
    expect(detail).toHaveTextContent(":w keeps your text, :e! takes the vault's.");
  });

  it("lists failed saves and conflicts side by side", () => {
    render(
      <StatusBar
        held={[
          { path: "a.md", reason: "PUT failed with 500", conflicted: false },
          { path: "b.md", reason: "Changed on disk", conflicted: true },
          { path: "c.md", reason: "Changed on disk", conflicted: true },
        ]}
      />,
    );

    expect(screen.getByTestId("held")).toHaveTextContent("Not saved: a");
    expect(screen.getByTestId("held-conflict")).toHaveTextContent("Changed on disk: 2 notes");

    fireEvent.click(screen.getByTestId("held"));
    const failedDetail = screen.getByTestId("status-detail");
    expect(failedDetail).toHaveTextContent("a.md: PUT failed with 500");
    expect(failedDetail).not.toHaveTextContent("b.md");

    fireEvent.click(screen.getByTestId("held-conflict"));
    const conflictDetail = screen.getByTestId("status-detail");
    expect(conflictDetail).toHaveTextContent("b.md: Changed on disk");
    expect(conflictDetail).toHaveTextContent("c.md: Changed on disk");
    expect(conflictDetail).not.toHaveTextContent("a.md");
    // Both crowd the clock out on a phone, either one losing text if left.
    expect(screen.getByText(/^CW /).parentElement).toHaveClass("max-md:hidden");
  });
});
