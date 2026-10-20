import { fireEvent, render, screen, within } from "@testing-library/react";
import { cursor, Harness, press, renderFolded, renderTree } from "./file-explorer-fixture";

const DEFAULT_WIDTH = "256px";

/** Notes are buttons too, so `expanded` is what tells a folder apart from one. */
function folderContents(name: string) {
  const row = screen.getByRole("button", { name, expanded: true });
  const item = row.closest("li");
  if (!item) throw new Error(`No list item around the folder ${name}`);
  return within(item);
}

function panel() {
  return screen.getByRole("complementary");
}

function grip() {
  return screen.getByRole("separator", { name: "Resize file tree" });
}

/** Press the grip at `from`, move the pointer to `to`, let go. */
function dragGrip(from: number, to: number) {
  fireEvent.pointerDown(grip(), { clientX: from });
  fireEvent.pointerMove(window, { clientX: to });
  fireEvent.pointerUp(window);
}

describe("the new note button", () => {
  // Rows in display order, with `daily` and `projects` unfolded:
  // daily, 2026-08-04, 2026-08-05, projects, kasten, api-design, kasten.md, index
  function newNote() {
    return screen.getByRole("button", { name: "New note" });
  }

  it("sits in the panel header", () => {
    renderTree();

    expect(within(panel()).getByRole("button", { name: "New note" })).toBeInTheDocument();
  });

  it("starts the note in the folder the cursor is on", () => {
    const onCreateNote = vi.fn();
    renderTree({ onCreateNote });

    fireEvent.click(newNote());

    expect(onCreateNote).toHaveBeenCalledWith("daily/");
  });

  it("starts the note in the folder holding the note the cursor is on", () => {
    const onCreateNote = vi.fn();
    renderTree({ onCreateNote });

    press("G");
    press("k");
    // By title, not by name: the folder `projects/kasten/` reads the same.
    expect(cursor()).toHaveAttribute("title", "projects/kasten.md");

    fireEvent.click(newNote());

    expect(onCreateNote).toHaveBeenCalledWith("projects/");
  });

  it("starts the note at the vault root when the cursor is on a note there", () => {
    const onCreateNote = vi.fn();
    renderTree({ onCreateNote });

    press("G");
    expect(cursor()).toHaveTextContent("index");

    fireEvent.click(newNote());

    expect(onCreateNote).toHaveBeenCalledWith("");
  });
});

describe("FileExplorer", () => {
  it("nests each note under the folders in its path", () => {
    renderTree();

    expect(folderContents("daily").getByText("2026-08-05")).toBeInTheDocument();
    expect(folderContents("kasten").getByText("api-design")).toBeInTheDocument();
  });

  it("keeps a note and a folder of the same name apart", () => {
    renderTree();

    const projects = folderContents("projects");

    expect(projects.getByRole("button", { name: "kasten", expanded: true })).toBeInTheDocument();
    expect(projects.getByTitle("projects/kasten.md")).toBeInTheDocument();
  });

  it("hands back the path of the note that was clicked", () => {
    const onOpenFile = vi.fn();
    renderTree({ onOpenFile });

    fireEvent.click(screen.getByText("api-design"));

    expect(onOpenFile).toHaveBeenCalledWith("projects/kasten/api-design.md");
  });

  it("opens the note, not the folder, when the two share a name", () => {
    const onOpenFile = vi.fn();
    renderTree({ onOpenFile });

    fireEvent.click(screen.getByTitle("projects/kasten.md"));

    expect(onOpenFile).toHaveBeenCalledWith("projects/kasten.md");
  });

  it("marks the open note and leaves the rest unmarked", () => {
    renderTree({ openPath: "projects/kasten.md" });

    expect(screen.getByTitle("projects/kasten.md")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTitle("index.md")).not.toHaveAttribute("aria-current");
  });

  it("marks nothing while no note is open", () => {
    renderTree();

    expect(screen.queryByRole("button", { current: "page" })).toBeNull();
  });

  it("lists notes at the vault root outside any folder", () => {
    renderTree();

    expect(screen.getByText("index")).toBeInTheDocument();
    expect(folderContents("daily").queryByText("index")).toBeNull();
  });

  it("hides a folder's notes once it is collapsed, and brings them back", () => {
    renderTree();

    fireEvent.click(screen.getByRole("button", { name: "daily" }));

    expect(screen.queryByText("2026-08-04")).toBeNull();
    expect(screen.getByText("index")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "daily" }));

    expect(screen.getByText("2026-08-04")).toBeInTheDocument();
  });

  it("folds the whole panel away and back", () => {
    renderTree();

    fireEvent.click(screen.getByRole("button", { name: "Hide file tree" }));

    expect(screen.queryByText("index")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show file tree" }));

    expect(screen.getByText("index")).toBeInTheDocument();
  });

  it("says the vault is empty rather than showing nothing", () => {
    renderTree({ paths: [] });

    expect(screen.getByText("No notes yet")).toBeInTheDocument();
  });

  it("resizes the panel by dragging its grip", () => {
    renderTree();

    dragGrip(256, 340);
    expect(panel()).toHaveStyle({ width: "340px" });

    dragGrip(340, 300);
    expect(panel()).toHaveStyle({ width: "300px" });
  });

  it("keeps the panel between its minimum and maximum width", () => {
    renderTree();

    dragGrip(256, 0);
    expect(panel()).toHaveStyle({ width: "160px" });

    dragGrip(160, 2000);
    expect(panel()).toHaveStyle({ width: "480px" });
  });

  it("stops resizing once the pointer is released", () => {
    renderTree();

    dragGrip(256, 340);
    fireEvent.pointerMove(window, { clientX: 200 });

    expect(panel()).toHaveStyle({ width: "340px" });
  });

  it("resets to the default width on a double click", () => {
    renderTree();

    dragGrip(256, 400);
    fireEvent.doubleClick(grip());

    expect(panel()).toHaveStyle({ width: DEFAULT_WIDTH });
  });

  it("resizes with the arrow keys", () => {
    renderTree();

    fireEvent.keyDown(grip(), { key: "ArrowRight" });
    expect(panel()).toHaveStyle({ width: "272px" });

    fireEvent.keyDown(grip(), { key: "ArrowLeft" });
    expect(panel()).toHaveStyle({ width: DEFAULT_WIDTH });
  });
});

describe("folding on open", () => {
  it("opens with every folder folded away", () => {
    // The rows inside a folder are what a big vault pays for, so none of them
    // is drawn until the folder is asked for.
    renderFolded();

    expect(screen.getByRole("button", { name: "daily" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("2026-08-04")).toBeNull();
    // A note at the vault root is not inside anything, so it still shows.
    expect(screen.getByText("index")).toBeInTheDocument();
  });

  it("unfolds the folders on the way to the open note", () => {
    // A note named in the URL has to be visible, or a reload lands on a tree
    // that has hidden the note it says is open.
    renderFolded({ openPath: "projects/kasten/api-design.md" });

    expect(screen.getByText("api-design")).toBeInTheDocument();
    // Only that path: `daily/` is on nobody's way to it.
    expect(screen.queryByText("2026-08-04")).toBeNull();
  });

  it("leaves the rest folded when the open note is at the vault root", () => {
    renderFolded({ openPath: "index.md" });

    expect(screen.queryByText("2026-08-04")).toBeNull();
    expect(screen.getByText("index")).toBeInTheDocument();
  });
});

describe("revealing the open note", () => {
  it("unfolds the way down to it and puts the cursor on its row", () => {
    // The panel is seeded from the note the page loaded on and never hears of
    // another, so a note reached by the finder or a wikilink sits folded away
    // while the cursor is still on row zero. `<leader>E` is the way to it.
    const { rerender } = render(<Harness revealSignal={0} />);
    expect(screen.queryByText("api-design")).toBeNull();

    rerender(<Harness revealSignal={1} openPath="projects/kasten/api-design.md" />);

    expect(screen.getByText("api-design")).toBeInTheDocument();
    expect(cursor()).toHaveAttribute("title", "projects/kasten/api-design.md");
  });

  it("carries the focus onto the row it lands on", () => {
    // The route raises `focusSignal` in the same render, which is what brings
    // the focus into the panel; this is the half that then puts it on the
    // revealed row rather than on the row the cursor was left at.
    const { rerender } = render(<Harness focusSignal={0} revealSignal={0} />);

    rerender(<Harness focusSignal={1} revealSignal={1} openPath="projects/kasten/api-design.md" />);

    expect(cursor()).toHaveFocus();
    expect(cursor()).toHaveAttribute("title", "projects/kasten/api-design.md");
  });

  it("reveals an image the way it reveals a note", () => {
    const { rerender } = render(<Harness images={["media/diagram.png"]} revealSignal={0} />);

    rerender(
      <Harness images={["media/diagram.png"]} revealSignal={1} openPath="media/diagram.png" />,
    );

    expect(cursor()).toHaveAttribute("title", "media/diagram.png");
  });

  it("leaves the folders it did not need alone", () => {
    // A reveal shows one note. It is not a way to unfold the whole vault, and
    // it does not fold away what you had already opened.
    const { rerender } = render(<Harness revealSignal={0} />);
    fireEvent.click(screen.getByRole("button", { name: "daily" }));
    expect(screen.getByText("2026-08-04")).toBeInTheDocument();

    rerender(<Harness revealSignal={1} openPath="projects/kasten/api-design.md" />);

    expect(screen.getByText("api-design")).toBeInTheDocument();
    expect(screen.getByText("2026-08-04")).toBeInTheDocument();
  });

  it("leaves the cursor alone when the pane holds no note", () => {
    // A terminal, the todos or an empty pane. Nothing to reveal is not an
    // error, it is a key that does nothing.
    const { rerender } = render(<Harness revealSignal={0} />);
    expect(cursor()).toHaveTextContent("daily");

    rerender(<Harness revealSignal={1} />);

    expect(cursor()).toHaveTextContent("daily");
  });

  it("leaves the cursor alone when the open note has no row", () => {
    // The archive filter cuts notes out of `paths` before the tree sees them,
    // so the note the pane holds can be one the tree is not showing.
    const { rerender } = render(<Harness revealSignal={0} />);

    rerender(<Harness revealSignal={1} openPath="archive/gone.md" />);

    expect(cursor()).toHaveTextContent("daily");
  });

  it("leaves the cursor alone until the signal changes", () => {
    // Mounting is not a request, the way it is not one for `focusSignal`: a
    // panel that revealed on the value would drag the cursor back every time
    // the tree was folded away and brought out again.
    const { rerender } = render(
      <Harness revealSignal={3} openPath="projects/kasten/api-design.md" />,
    );
    // Seeded folders still unfold the way down, which is the load-time rule,
    // and the cursor still starts on the first row rather than on the note.
    expect(screen.getByText("api-design")).toBeInTheDocument();
    expect(cursor()).toHaveTextContent("daily");

    rerender(<Harness revealSignal={3} openPath="projects/kasten/api-design.md" />);

    expect(cursor()).toHaveTextContent("daily");
  });
});
