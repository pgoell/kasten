import { fireEvent, render, screen, within } from "@testing-library/react";
import { type ComponentProps, useState } from "react";
import { FileExplorer } from "@/components/file-explorer";

// Sorted the way the backend serves it. `projects/kasten.md` and the folder
// `projects/kasten/` share a name on purpose: the vault allows both.
const PATHS = [
  "daily/2026-08-04.md",
  "daily/2026-08-05.md",
  "index.md",
  "projects/kasten.md",
  "projects/kasten/api-design.md",
];

const DEFAULT_WIDTH = "256px";

/** Notes are buttons too, so `expanded` is what tells a folder apart from one. */
function folderContents(name: string) {
  const row = screen.getByRole("button", { name, expanded: true });
  const item = row.closest("li");
  if (!item) throw new Error(`No list item around the folder ${name}`);
  return within(item);
}

type TreeProps = Partial<ComponentProps<typeof FileExplorer>> & {
  /** The one command these tests drive, wired into the harness's own set. */
  onCreateNote?: (startPath?: string) => void;
};

/** Holds the open state the route holds in the app, so folding still works. */
function Harness({ onCreateNote, ...props }: TreeProps) {
  const [open, setOpen] = useState(true);
  // The route folds the panel from two directions, `q` in the tree and the
  // leader from anywhere, and both land on the same callback.
  const onOpenChange = props.onOpenChange ?? setOpen;

  return (
    <FileExplorer
      paths={PATHS}
      onOpenFile={() => {}}
      {...props}
      open={props.open ?? open}
      onOpenChange={onOpenChange}
      commands={{
        toggleTree: () => onOpenChange(!open),
        togglePreview: () => {},
        closeNote: () => {},
        showHelp: () => {},
        focusTree: () => {},
        createNote: onCreateNote ?? (() => {}),
      }}
    />
  );
}

function renderTree(props: TreeProps = {}) {
  return render(<Harness {...props} />);
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

/** The tree itself, which is what the vim keys are typed into. */
function tree() {
  return screen.getByRole("navigation", { name: "Vault" });
}

/** The row the cursor is on: the only one reachable with a single tab. */
function cursor() {
  const row = within(tree())
    .getAllByRole("button")
    .find((item) => item.getAttribute("tabindex") === "0");
  if (!row) throw new Error("No row holds the cursor");
  return row;
}

function press(key: string) {
  fireEvent.keyDown(tree(), { key });
}

describe("the tree keyboard", () => {
  // Rows in display order, with `daily` and `projects` unfolded:
  // daily, 2026-08-04, 2026-08-05, projects, kasten, api-design, kasten.md, index
  it("starts the cursor on the first row", () => {
    renderTree();

    expect(cursor()).toHaveTextContent("daily");
  });

  it("moves the cursor down on j and up on k", () => {
    renderTree();

    press("j");
    expect(cursor()).toHaveTextContent("2026-08-04");

    press("j");
    expect(cursor()).toHaveTextContent("2026-08-05");

    press("k");
    expect(cursor()).toHaveTextContent("2026-08-04");
  });

  it("stops at the top rather than wrapping", () => {
    renderTree();

    press("k");

    expect(cursor()).toHaveTextContent("daily");
  });

  it("stops at the bottom rather than wrapping", () => {
    renderTree();

    press("G");
    press("j");

    expect(cursor()).toHaveTextContent("index");
  });

  it("collapses a folder on h and expands it again on l", () => {
    renderTree();

    press("h");
    expect(screen.queryByText("2026-08-04")).toBeNull();

    press("l");
    expect(screen.getByText("2026-08-04")).toBeInTheDocument();
  });

  it("jumps to the parent on h when the row is not an open folder", () => {
    renderTree();

    press("j");
    press("h");

    expect(cursor()).toHaveTextContent("daily");
  });

  it("opens the note under the cursor on enter", () => {
    const onOpenFile = vi.fn();
    renderTree({ onOpenFile });

    press("j");
    press("Enter");

    expect(onOpenFile).toHaveBeenCalledWith("daily/2026-08-04.md");
  });

  it("opens the note under the cursor on l", () => {
    const onOpenFile = vi.fn();
    renderTree({ onOpenFile });

    press("j");
    press("l");

    expect(onOpenFile).toHaveBeenCalledWith("daily/2026-08-04.md");
  });

  it("goes to the last row on G and back to the first on gg", () => {
    renderTree();

    press("G");
    expect(cursor()).toHaveTextContent("index");

    press("g");
    press("g");
    expect(cursor()).toHaveTextContent("daily");
  });

  it("ignores a g that is not followed by another one", () => {
    renderTree();

    press("g");
    press("j");

    expect(cursor()).toHaveTextContent("daily");
  });

  it("closes the panel on q", () => {
    const onOpenChange = vi.fn();
    renderTree({ onOpenChange });

    press("q");

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes the panel on the leader key too", () => {
    const onOpenChange = vi.fn();
    renderTree({ onOpenChange });

    press(" ");
    press("b");

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("hands focus back to the editor on escape", () => {
    renderTree();
    const editor = document.createElement("div");
    editor.className = "cm-content";
    editor.tabIndex = 0;
    document.body.append(editor);

    tree().focus();
    press("Escape");

    expect(document.activeElement).toBe(editor);
  });

  it("takes the focus when the route asks for it", () => {
    // The other half of escape: `<leader>e` is pressed in the editor, so the
    // route raises the signal and the panel puts the focus on its cursor row.
    const { rerender } = render(<Harness focusSignal={0} />);
    expect(cursor()).not.toHaveFocus();

    rerender(<Harness focusSignal={1} />);

    expect(cursor()).toHaveFocus();
  });

  it("leaves the focus alone until the signal changes", () => {
    // Mounting is not a request. A panel that focused on the value rather than
    // the change would grab the cursor back every time the tree was folded
    // away and brought out again.
    const { rerender } = render(<Harness focusSignal={2} />);
    expect(cursor()).not.toHaveFocus();

    rerender(<Harness focusSignal={2} />);

    expect(cursor()).not.toHaveFocus();
  });
});

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
