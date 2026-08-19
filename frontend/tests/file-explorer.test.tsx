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
  /** The commands these tests drive, wired into the harness's own set. */
  onCreateNote?: (startPath?: string) => void;
  onRenameNote?: (startPath?: string) => void;
  onRenameFolder?: (startPath: string) => void;
  onDeleteNote?: (startPath?: string) => void;
  onDeleteFolder?: (startPath: string) => void;
  onDeleteImage?: (startPath: string) => void;
  onFindNote?: () => void;
  onSearchNotes?: () => void;
  onRevealTree?: () => void;
  onGoToTab?: (index: number) => void;
};

/** Holds the open state the route holds in the app, so folding still works. */
function Harness({
  onCreateNote,
  onRenameNote,
  onRenameFolder,
  onDeleteNote,
  onDeleteFolder,
  onDeleteImage,
  onFindNote,
  onSearchNotes,
  onRevealTree,
  onGoToTab,
  ...props
}: TreeProps) {
  const [open, setOpen] = useState(true);
  // The route folds the panel from two directions, `q` in the tree and the
  // leader from anywhere, and both land on the same callback.
  const onOpenChange = props.onOpenChange ?? setOpen;

  return (
    <FileExplorer
      paths={PATHS}
      onOpenFile={() => {}}
      onOpenImage={() => {}}
      {...props}
      open={props.open ?? open}
      onOpenChange={onOpenChange}
      commands={{
        toggleTree: () => onOpenChange(!open),
        toggleArchive: () => {},
        togglePreview: () => {},
        closeNote: () => {},
        showHelp: () => {},
        focusTree: () => {},
        revealTree: onRevealTree ?? (() => {}),
        createNote: onCreateNote ?? (() => {}),
        renameNote: onRenameNote ?? (() => {}),
        renameFolder: onRenameFolder ?? (() => {}),
        deleteNote: onDeleteNote ?? (() => {}),
        deleteFolder: onDeleteFolder ?? (() => {}),
        deleteImage: onDeleteImage ?? (() => {}),
        restoreDeleted: () => {},
        findNote: onFindNote ?? (() => {}),
        searchNotes: onSearchNotes ?? (() => {}),
        findTodos: () => {},
        openTodos: () => {},
        showBacklinks: () => {},
        showLinksOut: () => {},
        openDaily: () => {},
        openWeekly: () => {},
        openMonthly: () => {},
        openQuarterly: () => {},
        openYearly: () => {},
        openBook: () => {},
        openVideo: () => {},
        toggleVideo: () => {},
        uploadBook: () => {},
        importNotes: () => {},
        exportNote: () => {},
        openExam: () => {},
        openReview: () => {},
        createTab: () => {},
        openTerminal: () => {},
        importPage: () => {},
        splitRight: () => {},
        splitDown: () => {},
        nextPane: () => {},
        paneLeft: () => {},
        paneDown: () => {},
        paneUp: () => {},
        paneRight: () => {},
        nextTab: () => {},
        prevTab: () => {},
        goToTab: onGoToTab ?? (() => {}),
        movePaneLeft: () => {},
        movePaneDown: () => {},
        movePaneUp: () => {},
        movePaneRight: () => {},
        zoomPane: () => {},
      }}
    />
  );
}

/**
 * Unfold every folder, which the tree no longer does on its own.
 *
 * Expanding one reveals the folders inside it, still folded, so this goes round
 * until nothing is left folded. Every folder is opened at most once, which is
 * what ends it.
 */
function expandAll() {
  for (;;) {
    const folded = screen.queryAllByRole("button", { expanded: false });
    if (folded.length === 0) return;
    for (const row of folded) fireEvent.click(row);
  }
}

/**
 * Render the tree with every folder open, which is what most of these are about.
 *
 * The tree itself opens folded, so the rows inside a folder cost nothing until
 * you ask for them. `renderFolded` is for the tests about that.
 */
function renderTree(props: TreeProps = {}) {
  const result = render(<Harness {...props} />);
  expandAll();
  return result;
}

/** Render the tree as a reader first meets it, with the folders folded away. */
function renderFolded(props: TreeProps = {}) {
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

  it("holds the cursor still when a leader sequence ends in g", () => {
    // `gg` is the whole sequence, not whatever key arrives last. A leader
    // sequence that dies on a `g` reaches the same branch, and reading the key
    // alone would send the cursor to the top of the tree.
    renderTree();

    press("j");
    press(" ");
    press("c");
    press("g");

    expect(cursor()).toHaveTextContent("2026-08-04");
  });

  it("drops a g followed by a leader letter rather than waiting on it", () => {
    // Only a leader sequence waits for more letters. `gc` prefixes `<leader>cf`
    // by its letters alone, and a pending buffer that took it would grow
    // forever and swallow every key after it.
    renderTree();

    press("g");
    press("c");
    press("j");

    expect(cursor()).toHaveTextContent("2026-08-04");
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

  it("goes to a tab on the leader and a digit", () => {
    // The digits live in `TAB_KEYS` rather than in `LEADER`, and reading one
    // table and not the other is how they used to reach a tab from a note and
    // nothing at all from in here.
    const onGoToTab = vi.fn();
    renderTree({ onGoToTab });

    press(" ");
    press("3");

    expect(onGoToTab).toHaveBeenCalledWith(2);
  });

  it("opens the note prompt on the leader, c, then f", () => {
    const onCreateNote = vi.fn();
    renderTree({ onCreateNote });

    expect(cursor()).toHaveTextContent("daily");
    press(" ");
    press("c");
    press("f");

    expect(onCreateNote).toHaveBeenCalledWith("daily/");
  });

  it("renames the note under the cursor on the leader, r, then f", () => {
    const onRenameNote = vi.fn();
    renderTree({ onRenameNote });

    press("G");
    press("k");
    // By title, not by name: the folder `projects/kasten/` reads the same.
    expect(cursor()).toHaveAttribute("title", "projects/kasten.md");
    press(" ");
    press("r");
    press("f");

    expect(onRenameNote).toHaveBeenCalledWith("projects/kasten.md");
  });

  it("renames nothing when the cursor is on a folder", () => {
    // `rf` names a file, and the tree has `r` for a row of either kind. Doing
    // nothing is how it says the key does not apply here.
    const onRenameNote = vi.fn();
    const onRenameFolder = vi.fn();
    renderTree({ onRenameNote, onRenameFolder });

    expect(cursor()).toHaveTextContent("daily");
    press(" ");
    press("r");
    press("f");

    expect(onRenameNote).not.toHaveBeenCalled();
    expect(onRenameFolder).not.toHaveBeenCalled();
  });

  it("opens the note prompt on c", () => {
    const onCreateNote = vi.fn();
    renderTree({ onCreateNote });

    expect(cursor()).toHaveTextContent("daily");
    press("c");

    expect(onCreateNote).toHaveBeenCalledWith("daily/");
  });

  it("opens the note prompt on c in the folder holding the note under the cursor", () => {
    const onCreateNote = vi.fn();
    renderTree({ onCreateNote });

    press("G");
    expect(cursor()).toHaveTextContent("index");
    press("c");

    // A note at the root names no folder, so the prompt opens on the vault root.
    expect(onCreateNote).toHaveBeenCalledWith("");
  });

  it("renames the note under the cursor on r", () => {
    const onRenameNote = vi.fn();
    renderTree({ onRenameNote });

    press("G");
    press("k");
    // By title, not by name: the folder `projects/kasten/` reads the same.
    expect(cursor()).toHaveAttribute("title", "projects/kasten.md");
    press("r");

    expect(onRenameNote).toHaveBeenCalledWith("projects/kasten.md");
  });

  it("deletes the note under the cursor on d", () => {
    const onDeleteNote = vi.fn();
    renderTree({ onDeleteNote });

    press("G");
    press("k");
    expect(cursor()).toHaveAttribute("title", "projects/kasten.md");
    press("d");

    expect(onDeleteNote).toHaveBeenCalledWith("projects/kasten.md");
  });

  it("deletes the folder under the cursor on d", () => {
    const onDeleteFolder = vi.fn();
    const onDeleteNote = vi.fn();
    renderTree({ onDeleteFolder, onDeleteNote });

    expect(cursor()).toHaveTextContent("daily");
    press("d");

    expect(onDeleteFolder).toHaveBeenCalledWith("daily");
    expect(onDeleteNote).not.toHaveBeenCalled();
  });

  it("keeps the focus in the tree when the deleted row goes", () => {
    // Without this the keyboard is dead after `d`: the row that had the focus
    // is unmounted when the listing comes back without it, and the browser
    // hands the focus to the body rather than to the row that took its place.
    const { rerender } = render(<Harness paths={["index.md", "other.md"]} />);
    cursor().focus();
    expect(cursor()).toHaveFocus();

    press("d");
    rerender(<Harness paths={["other.md"]} />);

    expect(document.body).not.toHaveFocus();
    expect(cursor()).toHaveFocus();
  });

  it("renames the folder under the cursor on r", () => {
    const onRenameFolder = vi.fn();
    const onRenameNote = vi.fn();
    renderTree({ onRenameFolder, onRenameNote });

    expect(cursor()).toHaveTextContent("daily");
    press("r");

    // No trailing slash: this is the folder's path, not a prefix to type after.
    expect(onRenameFolder).toHaveBeenCalledWith("daily");
    expect(onRenameNote).not.toHaveBeenCalled();
  });

  it("renames a folder nested inside another on r", () => {
    const onRenameFolder = vi.fn();
    renderTree({ onRenameFolder });

    press("G");
    press("k");
    press("k");
    press("k");
    expect(cursor()).toHaveTextContent("kasten");
    press("r");

    expect(onRenameFolder).toHaveBeenCalledWith("projects/kasten");
  });

  it("finds a note on f, whatever the cursor is on", () => {
    // The finder ranks the whole vault, so unlike `c` and `r` it takes nothing
    // from the row the cursor happens to be on.
    const onFindNote = vi.fn();
    renderTree({ onFindNote });

    expect(cursor()).toHaveTextContent("daily");
    press("f");

    expect(onFindNote).toHaveBeenCalledTimes(1);

    press("G");
    press("f");

    expect(onFindNote).toHaveBeenCalledTimes(2);
  });

  it("searches note content on s, whatever the cursor is on", () => {
    // `s` rather than the `g` that `<leader>fg` ends on, because `g` is the
    // first half of `gg` here. Takes nothing from the row, the way `f` does not.
    const onSearchNotes = vi.fn();
    renderTree({ onSearchNotes });

    press("s");

    expect(onSearchNotes).toHaveBeenCalledTimes(1);
  });

  it("still goes to the first row on gg, which the search key must not have eaten", () => {
    renderTree();

    press("G");
    expect(cursor()).not.toHaveTextContent("daily");

    press("g");
    press("g");

    expect(cursor()).toHaveTextContent("daily");
  });

  it("waits for the second letter rather than acting on the leader and c", () => {
    const onCreateNote = vi.fn();
    const onOpenChange = vi.fn();
    renderTree({ onCreateNote, onOpenChange });

    press(" ");
    press("c");

    expect(onCreateNote).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("drops a sequence that reaches no binding, keeping the keys after it", () => {
    const onCreateNote = vi.fn();
    renderTree({ onCreateNote });

    press(" ");
    press("c");
    press("x");
    press("j");

    expect(onCreateNote).not.toHaveBeenCalled();
    expect(cursor()).toHaveTextContent("2026-08-04");
  });

  it("reads a leader key that needs shift", () => {
    // The browser sends a keydown for the shift key itself before it sends the
    // letter, and a pending sequence that took it for a key would be dropped
    // before the letter it was waiting for arrived. Every shifted leader key
    // reachable from here rides on this: `<leader>E`, and `<leader>H` to `L`.
    const onRevealTree = vi.fn();
    renderTree({ onRevealTree });

    press(" ");
    press("Shift");
    press("E");

    expect(onRevealTree).toHaveBeenCalledTimes(1);
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

describe("images in the tree", () => {
  const IMAGES = ["99 Misc/02 Assets/01 Images/2026-08-12-abcdef01.png"];

  it("draws an image row with its suffix, beside the notes", () => {
    renderTree({ images: IMAGES });

    // The suffix stays: the vault holds one kind of note and five kinds of
    // image, so it is news on this row where `.md` is noise on the others.
    expect(screen.getByText("2026-08-12-abcdef01.png")).toBeInTheDocument();
  });

  it("shows an image rather than opening it as a note, on a click", () => {
    const onOpenFile = vi.fn();
    const onOpenImage = vi.fn();
    renderTree({ images: IMAGES, onOpenFile, onOpenImage });

    fireEvent.click(screen.getByText("2026-08-12-abcdef01.png"));

    expect(onOpenImage).toHaveBeenCalledWith(IMAGES[0]);
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("does the same from the keyboard", () => {
    const onOpenFile = vi.fn();
    const onOpenImage = vi.fn();
    renderTree({ images: IMAGES, onOpenFile, onOpenImage });

    // `99 Misc` sorts ahead of `daily`, so the image is three rows in: the
    // folder, the folder inside it, the folder inside that, then the row.
    press("G");
    press("g");
    press("g");
    press("j");
    press("j");
    press("j");
    press("Enter");

    expect(onOpenImage).toHaveBeenCalledWith(IMAGES[0]);
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("deletes an image rather than trying to delete it as a note, on d", () => {
    const onDeleteImage = vi.fn();
    const onDeleteNote = vi.fn();
    renderTree({ images: IMAGES, onDeleteImage, onDeleteNote });

    press("G");
    press("g");
    press("g");
    press("j");
    press("j");
    press("j");
    press("d");

    expect(onDeleteImage).toHaveBeenCalledWith(IMAGES[0]);
    expect(onDeleteNote).not.toHaveBeenCalled();
  });

  it("marks the image the focused pane is showing as the current row", () => {
    renderTree({ images: IMAGES, openPath: IMAGES[0] });

    expect(screen.getByText("2026-08-12-abcdef01.png").closest("button")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
