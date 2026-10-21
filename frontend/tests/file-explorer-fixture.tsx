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

type TreeProps = Partial<ComponentProps<typeof FileExplorer>> & {
  /** The commands these tests drive, wired into the harness's own set. */
  onCreateNote?: (startPath?: string) => void;
  onRenameNote?: (startPath?: string) => void;
  onRenameFolder?: (startPath: string) => void;
  onDeleteNote?: (startPath?: string) => void;
  onDeleteFolder?: (startPath: string) => void;
  onDeleteImage?: (startPath: string) => void;
  onMoveRow?: (startPath: string, mode: "rename" | "folder", target: string) => void;
  onFindNote?: () => void;
  onSearchNotes?: () => void;
  onRevealTree?: () => void;
  onGoToTab?: (index: number) => void;
};

/** Holds the open state the route holds in the app, so folding still works. */
export function Harness({
  onCreateNote,
  onRenameNote,
  onRenameFolder,
  onDeleteNote,
  onDeleteFolder,
  onDeleteImage,
  onMoveRow,
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
      onOpenHtml={() => {}}
      onOpenPdf={() => {}}
      {...props}
      open={props.open ?? open}
      onOpenChange={onOpenChange}
      commands={{
        toggleTree: () => onOpenChange(!open),
        toggleArchive: () => {},
        togglePreview: () => {},
        closeNote: () => {},
        showHelp: () => {},
        openPalette: () => {},
        openLog: () => {},
        focusTree: () => {},
        revealTree: onRevealTree ?? (() => {}),
        createNote: onCreateNote ?? (() => {}),
        renameNote: onRenameNote ?? (() => {}),
        renameFolder: onRenameFolder ?? (() => {}),
        deleteNote: onDeleteNote ?? (() => {}),
        deleteFolder: onDeleteFolder ?? (() => {}),
        deleteImage: onDeleteImage ?? (() => {}),
        moveRow: onMoveRow ?? (() => {}),
        restoreDeleted: () => {},
        findNote: onFindNote ?? (() => {}),
        searchNotes: onSearchNotes ?? (() => {}),
        findTodos: () => {},
        findBook: () => {},
        openTodos: () => {},
        showBacklinks: () => {},
        showLinksOut: () => {},
        openDaily: () => {},
        logDrink: () => {},
        openWeekly: () => {},
        openMonthly: () => {},
        openQuarterly: () => {},
        openYearly: () => {},
        openBook: () => {},
        openReadingBook: () => {},
        openPerson: () => {},
        openHistory: () => {},
        openGraph: () => {},
        openLocalGraph: () => {},
        openVideo: () => {},
        toggleVideo: () => {},
        uploadBook: () => {},
        importNotes: () => {},
        exportNote: () => {},
        openExam: () => {},
        openReview: () => {},
        createTab: () => {},
        openTerminal: () => {},
        openChat: () => {},
        importPage: () => {},
        captureDump: () => {},
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
export function renderTree(props: TreeProps = {}) {
  const result = render(<Harness {...props} />);
  expandAll();
  return result;
}

/** Render the tree as a reader first meets it, with the folders folded away. */
export function renderFolded(props: TreeProps = {}) {
  return render(<Harness {...props} />);
}

/** The tree itself, which is what the vim keys are typed into. */
export function tree() {
  return screen.getByRole("navigation", { name: "Vault" });
}

/** The row the cursor is on: the only one reachable with a single tab. */
export function cursor() {
  const row = within(tree())
    .getAllByRole("button")
    .find((item) => item.getAttribute("tabindex") === "0");
  if (!row) throw new Error("No row holds the cursor");
  return row;
}

export function press(key: string) {
  fireEvent.keyDown(tree(), { key });
}
