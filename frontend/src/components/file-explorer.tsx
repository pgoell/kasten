import { useEffect, useMemo, useRef, useState } from "react";
import { heldModifier, leaderAction, leaderPrefix, type TreeCommands } from "@/lib/key-bindings";

interface FileExplorerProps {
  /** Vault-relative paths of every note, as served by `GET /api/files`. */
  paths: string[];
  /**
   * Vault-relative paths of every image, as served by `GET /api/images`.
   *
   * Their own prop rather than rows in `paths`, which is what the finder, the
   * search and every wikilink resolve against: the tree is the one place an
   * image belongs beside a note, because it is the one place that shows the
   * vault as it sits on disk.
   */
  images?: string[];
  /** Vault-relative path of the note or image open in the focused pane. */
  openPath?: string;
  onOpenFile: (path: string) => void;
  /** Called with the image a row names, which the route shows in the pane. */
  onOpenImage: (path: string) => void;
  /** Whether the panel is unfolded. Held by the route, because `<leader>b`
   * reaches it from inside the editor. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Reached by the tree's own keys, and by leader sequences typed here. */
  commands: TreeCommands;
  /** Raised by the route to ask the panel for the focus. The change is the
   * request, not the value: mounting must not pull focus out of the editor. */
  focusSignal?: number;
  /** Raised by the route to ask the panel to unfold down to `openPath` and put
   * its cursor on that row. A change is the request, the way `focusSignal` is. */
  revealSignal?: number;
}

interface FolderNode {
  kind: "folder";
  name: string;
  path: string;
  children: TreeNode[];
}

interface FileNode {
  kind: "file";
  /** Display name: the file name without its `.md` suffix. */
  name: string;
  path: string;
  /**
   * Set on a row that is an image rather than a note.
   *
   * A flag and not a third `kind`, so a folder's contents still sort as one
   * alphabetical list: images and notes sit side by side the way `ls` shows
   * them, rather than in two groups nobody arranged.
   */
  image?: boolean;
}

type TreeNode = FolderNode | FileNode;

/**
 * Fold flat vault paths into a folder tree.
 *
 * The backend deliberately serves a flat, sorted list and never models
 * folders, so the nesting is reconstructed here.
 */
export function buildTree(paths: string[], images: string[] = []): TreeNode[] {
  const root: TreeNode[] = [];

  // Two loops over one function rather than one loop over both lists, which
  // would have to ask which list each path came from: at 10,000 notes that
  // question is a scan of the images per note, and this is none.
  function add(path: string, isImage: boolean): void {
    const parts = path.split("/");
    const fileName = parts.pop();
    if (!fileName) return;

    let level = root;
    let prefix = "";

    for (const part of parts) {
      prefix = prefix ? `${prefix}/${part}` : part;
      const existing = level.find(
        (node): node is FolderNode => node.kind === "folder" && node.name === part,
      );
      const folder: FolderNode = existing ?? {
        kind: "folder",
        name: part,
        path: prefix,
        children: [],
      };
      if (!existing) level.push(folder);
      level = folder.children;
    }

    // An image keeps its suffix and a note loses its `.md`: the vault holds one
    // kind of note and five kinds of image, so the suffix is news on one row and
    // noise on the other.
    level.push(
      isImage
        ? { kind: "file", name: fileName, path, image: true }
        : { kind: "file", name: fileName.replace(/\.md$/, ""), path },
    );
  }

  for (const path of paths) add(path, false);
  for (const path of images) add(path, true);

  return sortTree(root);
}

/** Folders first, then notes, each group alphabetical. */
function sortTree(nodes: TreeNode[]): TreeNode[] {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const node of nodes) {
    if (node.kind === "folder") sortTree(node.children);
  }

  return nodes;
}

/** Where a new note goes when the cursor is on this row: "" at the vault root. */
function startFolder(node: TreeNode | undefined): string {
  if (!node) return "";
  if (node.kind === "folder") return `${node.path}/`;

  // A note names the folder it sits in, and a note at the root names none.
  const cut = node.path.lastIndexOf("/");
  return cut === -1 ? "" : node.path.slice(0, cut + 1);
}

interface Row {
  node: TreeNode;
  /** Index of the row holding this one, or -1 at the vault root. */
  parent: number;
}

/**
 * Every row a reader can see, in display order.
 *
 * The nesting is what the tree renders, but `j` and `k` move down a list, so
 * the keyboard needs the same rows flattened. Collapsed folders keep their
 * children out of it, because a cursor cannot sit on a row nobody can see.
 */
function flattenRows(nodes: TreeNode[], expanded: ReadonlySet<string>): Row[] {
  const rows: Row[] = [];

  function walk(level: TreeNode[], parent: number) {
    for (const node of level) {
      const index = rows.length;
      rows.push({ node, parent });
      if (node.kind === "folder" && expanded.has(node.path)) {
        walk(node.children, index);
      }
    }
  }

  walk(nodes, -1);
  return rows;
}

/**
 * Every folder on the way to `path`, which are the ones that have to be open
 * for it to be on screen.
 *
 * `reading/2026/borges.md` names `reading` and `reading/2026`, spelled the way
 * `buildTree` spells a folder's path, which is without a trailing slash. The
 * note prompt's `startFolder` keeps one; these two are not the same string.
 */
function ancestors(path: string | undefined): ReadonlySet<string> {
  const folders = new Set<string>();
  if (path === undefined) return folders;

  let prefix = "";
  for (const segment of path.split("/").slice(0, -1)) {
    prefix = prefix ? `${prefix}/${segment}` : segment;
    folders.add(prefix);
  }
  return folders;
}

/** Identifies a row across the tree and the flat list, which share no shape. */
function rowKey(node: TreeNode) {
  return `${node.kind}:${node.path}`;
}

/** Indent one step per level, on top of the row's own padding. */
function indent(depth: number) {
  return { paddingLeft: `${0.5 + depth * 0.75}rem` };
}

const ROW = "flex w-full items-center gap-1 rounded-sm py-[3px] pr-2 text-left text-[13px]";

/**
 * The keyboard cursor, drawn the way vim draws its own.
 *
 * A hollow outline while the tree is idle, filled in and brighter once it holds
 * the focus, in the same red as the block cursor in the editor. The vim package
 * makes exactly this distinction for the same reason: a cursor you are about to
 * type at should not look like one you left behind.
 */
const CURSOR = [
  "outline-1 -outline-offset-1 outline-one-cursor/45",
  "focus:outline-2 focus:outline-one-cursor focus:bg-one-cursor/15",
].join(" ");

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={`size-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
      fill="currentColor"
    >
      <path d="M6 4l4 4-4 4z" />
    </svg>
  );
}

interface NodeListProps {
  nodes: TreeNode[];
  depth: number;
  expanded: ReadonlySet<string>;
  openPath?: string;
  /** The row the keyboard cursor is on, which is the panel's only tab stop. */
  cursorKey: string;
  onToggleFolder: (path: string) => void;
  onOpenFile: (path: string) => void;
  onOpenImage: (path: string) => void;
}

function NodeList({
  nodes,
  depth,
  expanded,
  openPath,
  cursorKey,
  onToggleFolder,
  onOpenFile,
  onOpenImage,
}: NodeListProps) {
  return (
    <ul>
      {nodes.map((node) => {
        const key = rowKey(node);
        // One tab stop for the whole panel: tab reaches the cursor, and the
        // vim keys move it from there.
        const tabIndex = key === cursorKey ? 0 : -1;

        if (node.kind === "file") {
          const current = node.path === openPath;

          return (
            <li key={key}>
              <button
                type="button"
                data-row={key}
                tabIndex={tabIndex}
                onClick={() => (node.image === true ? onOpenImage : onOpenFile)(node.path)}
                aria-current={current ? "page" : undefined}
                style={indent(depth)}
                title={node.path}
                // An image is muted against the notes, the way a wikilink to a
                // note nobody has written is: what the tree is for is the notes,
                // and this row is the vault admitting it holds something else.
                className={`${ROW} cursor-pointer ${
                  current
                    ? "bg-one-hover text-one-accent"
                    : `${node.image === true ? "text-one-muted" : "text-one-fg"} hover:bg-one-hover`
                } ${tabIndex === 0 ? CURSOR : ""}`}
              >
                {/* Holds the chevron's column so note names line up with folder names. */}
                <span className="size-3 shrink-0" />
                <span className="truncate">{node.name}</span>
              </button>
            </li>
          );
        }

        const open = expanded.has(node.path);

        return (
          <li key={key}>
            <button
              type="button"
              data-row={key}
              tabIndex={tabIndex}
              onClick={() => onToggleFolder(node.path)}
              aria-expanded={open}
              style={indent(depth)}
              className={`${ROW} cursor-pointer text-one-muted hover:bg-one-hover hover:text-one-fg ${
                tabIndex === 0 ? CURSOR : ""
              }`}
            >
              <Chevron open={open} />
              <span className="truncate">{node.name}</span>
            </button>
            {open && (
              <NodeList
                nodes={node.children}
                depth={depth + 1}
                expanded={expanded}
                openPath={openPath}
                cursorKey={cursorKey}
                onToggleFolder={onToggleFolder}
                onOpenFile={onOpenFile}
                onOpenImage={onOpenImage}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Panel widths, in pixels. The default is the `w-64` the panel used to be. */
const DEFAULT_WIDTH = 256;
const MIN_WIDTH = 160;
const MAX_WIDTH = 480;
/** How far one arrow key press moves the grip. */
const KEY_STEP = 16;

function clampWidth(width: number) {
  return Math.min(Math.max(width, MIN_WIDTH), MAX_WIDTH);
}

interface GripProps {
  width: number;
  dragging: boolean;
  onResizeStart: (clientX: number) => void;
  onResizeBy: (delta: number) => void;
  onReset: () => void;
}

/**
 * The drag handle on the panel's right edge.
 *
 * It straddles the border rather than taking layout space of its own, so the
 * tree keeps the full width the panel reports.
 */
function Grip({ width, dragging, onResizeStart, onResizeBy, onReset }: GripProps) {
  function onKeyDown(event: React.KeyboardEvent) {
    const delta = event.key === "ArrowRight" ? KEY_STEP : event.key === "ArrowLeft" ? -KEY_STEP : 0;
    if (!delta) return;
    event.preventDefault();
    onResizeBy(delta);
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: <hr> is a thematic break in prose, not a handle you can grab.
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize file tree"
      aria-valuenow={width}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      tabIndex={0}
      onPointerDown={(event) => onResizeStart(event.clientX)}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      className={`absolute inset-y-0 -right-0.5 z-10 w-1 cursor-col-resize touch-none focus-visible:outline-none ${
        dragging ? "bg-one-accent" : "hover:bg-one-accent focus-visible:bg-one-accent"
      }`}
    />
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="currentColor">
      <path d="M7.25 3h1.5v4.25H13v1.5H8.75V13h-1.5V8.75H3v-1.5h4.25V3z" />
    </svg>
  );
}

function PanelIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="currentColor">
      <path d="M2 3a1 1 0 011-1h10a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3zm1 0v10h3V3H3zm4 0v10h6V3H7z" />
    </svg>
  );
}

/**
 * The vault's file tree, in a panel that folds away to a narrow rail.
 *
 * Clicking a note reports its path and nothing more. Which note is open is the
 * caller's business, and it keeps that in the URL.
 */
export function FileExplorer({
  paths,
  images,
  openPath,
  onOpenFile,
  onOpenImage,
  open,
  onOpenChange,
  commands,
  focusSignal = 0,
  revealSignal = 0,
}: FileExplorerProps) {
  // What is unfolded, rather than what is folded away, which is what makes an
  // unopened folder cost nothing. A folder's children are not rendered until it
  // is in here, so the tree draws the rows you can see and no others: at 10,000
  // notes that is 8 rows on open instead of 10,842.
  //
  // Seeded with the folders on the way to the open note, and only those. A note
  // named in the URL has to be visible, or a reload lands on a tree that has
  // hidden what it is showing you.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => ancestors(openPath));
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  /** Where the pointer went down, and how wide the panel was then. */
  const [drag, setDrag] = useState<{ x: number; width: number } | null>(null);
  /** Which row the vim keys act on. */
  const [active, setActive] = useState(0);
  /** The keys of an unfinished sequence, `g` or the leader and what follows it. */
  const [pending, setPending] = useState("");
  const nav = useRef<HTMLElement>(null);
  /** The signal already answered, so the first render answers nothing. */
  const answered = useRef(focusSignal);
  /** The same, for the reveal. Its own ref: the two signals move apart. */
  const revealed = useRef(revealSignal);
  /** Whether the panel is waiting for a row of its own to go, so it can take
   * the focus back off the body when it does. */
  const deleting = useRef(false);
  const tree = useMemo(() => buildTree(paths, images), [paths, images]);
  const rows = useMemo(() => flattenRows(tree, expanded), [tree, expanded]);
  // Collapsing a folder can strand the cursor past the end of the list.
  const cursor = Math.min(active, Math.max(rows.length - 1, 0));
  const cursorKey = rows[cursor] ? rowKey(rows[cursor].node) : "";

  // `<leader>e`, arriving from the editor. The cursor row is the panel's only
  // tab stop, so that is the row the focus lands on.
  useEffect(() => {
    if (focusSignal === answered.current) return;
    answered.current = focusSignal;
    nav.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  }, [focusSignal]);

  // `<leader>E`. The panel is seeded with the folders on the way to the note the
  // page loaded on and never learns of another, so a note reached by the finder,
  // a wikilink or a backlink can sit folded away while the tree points at row
  // zero. This unfolds the way down to it and moves the cursor there; the route
  // raises `focusSignal` in the same render, and the effect below carries the
  // focus onto the row this one lands on.
  useEffect(() => {
    if (revealSignal === revealed.current) return;
    revealed.current = revealSignal;
    if (openPath === undefined) return;

    // Unfolded on top of what is already open rather than in place of it: the
    // reveal shows one note, it does not fold the rest of the tree away.
    const folders = new Set([...expanded, ...ancestors(openPath)]);
    const index = flattenRows(tree, folders).findIndex(
      (row) => row.node.kind === "file" && row.node.path === openPath,
    );
    // The archive filter hides notes from `paths`, so the open note can have no
    // row to go to. Leaving the cursor where it is beats moving it nowhere.
    if (index === -1) return;

    setExpanded(folders);
    setActive(index);
  }, [revealSignal, openPath, expanded, tree]);

  // Only when the panel already holds the focus. Moving the cursor from inside
  // the editor, which `<leader>b` does, must not drag the focus along with it.
  //
  // A delete from the tree is the one case where it does not hold it any more
  // and should: the row it was on has just gone from the list, and a removed
  // element takes the focus to the body with it. So `d` says it is expecting a
  // row to go, and the focus lands on the cursor row when it does. The body is
  // part of the test, not decoration: it is what nothing holding the focus
  // looks like, and it is what keeps a refused delete from pulling the focus
  // out of the editor later.
  useEffect(() => {
    const panel = nav.current;
    if (!panel) return;

    const deleted = deleting.current;
    deleting.current = false;
    if (
      !panel.contains(document.activeElement) &&
      !(deleted && document.activeElement === document.body)
    ) {
      return;
    }

    panel.querySelector<HTMLElement>(`[data-row="${cursorKey}"]`)?.focus();
  }, [cursorKey]);

  // The pointer leaves the thin grip the moment the drag speeds up, so the rest
  // of the gesture is followed on the window instead.
  useEffect(() => {
    if (!drag) return;
    const origin = drag;

    function onMove(event: PointerEvent) {
      setWidth(clampWidth(origin.width + event.clientX - origin.x));
    }
    function onUp() {
      setDrag(null);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    // Without this the drag selects text and flickers the I-beam over the editor.
    const { cursor, userSelect } = document.body.style;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = cursor;
      document.body.style.userSelect = userSelect;
    };
  }, [drag]);

  /** The prompt opens on the folder the cursor is on, not the focused row: a
   * click puts the focus on the button itself. */
  function newNote() {
    commands.createNote(startFolder(rows[cursor]?.node));
  }

  /** Rename the note the cursor is on, and nothing when it is on a folder.
   *
   * `<leader>rf` names a file, and doing nothing is how the tree says the key
   * does not apply here. `r` is the tree's own key and takes a row of either
   * kind. */
  function renameNote() {
    const node = rows[cursor]?.node;
    if (node?.kind !== "file") return;
    commands.renameNote(node.path);
  }

  /** Rename whatever the cursor is on, which is what `r` does.
   *
   * A folder is a path like a note is, so the same prompt renames both and only
   * the mode differs. */
  function renameRow() {
    const node = rows[cursor]?.node;
    if (!node) return;
    if (node.kind === "file") commands.renameNote(node.path);
    else commands.renameFolder(node.path);
  }

  function deleteRow() {
    const node = rows[cursor]?.node;
    if (!node) return;

    deleting.current = true;
    if (node.kind !== "file") commands.deleteFolder(node.path);
    else if (node.image === true) commands.deleteImage(node.path);
    else commands.deleteNote(node.path);
  }

  /**
   * The vim keys, resolved in the order vim resolves them.
   *
   * A pending sequence comes first, because `gg` and a leader sequence both
   * mean the press is not a command of its own. Anything unrecognised is left
   * alone rather than swallowed, so the browser keeps its own shortcuts.
   */
  function onKeyDown(event: React.KeyboardEvent) {
    const { key } = event;

    // A modifier holds itself down before the key it is held for arrives, and
    // a pending sequence that read it as a key would drop the sequence there.
    if (heldModifier(key)) return;

    if (pending) {
      const sequence = pending + key;
      const typed = sequence.slice(1);
      const leader = sequence.startsWith(" ");
      // Only the tree knows what the cursor sits on, and these two are the
      // commands that ask for it, so the sequence is resolved against a set
      // where they already reach the row rather than the pane.
      const run = leader
        ? leaderAction(typed, { ...commands, createNote: newNote, renameNote })
        : null;
      // A leader key can be more than one letter, so a sequence that still
      // prefixes one waits for the rest instead of being dropped. The exact
      // match is taken first, the way vim takes it.
      const partial = !run && leader && leaderPrefix(typed);
      setPending(partial ? sequence : "");

      if (run) {
        event.preventDefault();
        run();
      } else if (sequence === "gg") {
        event.preventDefault();
        setActive(0);
      }
      return;
    }

    const row = rows[cursor];
    const folder = row?.node.kind === "folder" ? row.node : null;
    const unfolded = folder !== null && expanded.has(folder.path);

    switch (key) {
      case "j":
        setActive(Math.min(cursor + 1, rows.length - 1));
        break;
      case "k":
        setActive(Math.max(cursor - 1, 0));
        break;
      case "G":
        setActive(rows.length - 1);
        break;
      case "g":
      case " ":
        setPending(key);
        break;
      case "c":
        newNote();
        break;
      case "r":
        renameRow();
        break;
      // Both kinds, the way `r` takes both. Nothing asks first: the note goes
      // to the trash rather than away, and `<leader>du` is the way back.
      case "d":
        deleteRow();
        break;
      // Unlike `c` and `r`, this takes nothing from the row the cursor is on:
      // the finder ranks the whole vault and starts from nowhere.
      case "f":
        commands.findNote();
        break;
      // `s`, not the `g` that would match `<leader>fg`: `g` is the first half
      // of `gg` here and cannot also be a command of its own. Takes nothing
      // from the row, for the reason `f` does not: a search reads every note.
      case "s":
        commands.searchNotes();
        break;
      case "q":
        onOpenChange(false);
        break;
      case "Escape":
        // The editor is the only other place focus belongs, and it owns no
        // React handle here, so the panel finds it the way the user sees it.
        document.querySelector<HTMLElement>(".cm-content")?.focus();
        break;
      case "h":
        if (unfolded) toggleFolder(folder.path);
        else if (row && row.parent >= 0) setActive(row.parent);
        break;
      case "l":
      case "Enter":
        if (folder && !unfolded) toggleFolder(folder.path);
        else if (folder) setActive(Math.min(cursor + 1, rows.length - 1));
        else if (row) {
          const file = row.node.kind === "file" ? row.node : null;
          if (file) (file.image === true ? onOpenImage : onOpenFile)(file.path);
        }
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  function toggleFolder(path: string) {
    setExpanded((previous) => {
      const next = new Set(previous);
      // `delete` reports whether the folder was expanded, so one call flips it.
      if (!next.delete(path)) next.add(path);
      return next;
    });
  }

  const toggle = (
    <button
      type="button"
      onClick={() => onOpenChange(!open)}
      aria-label={open ? "Hide file tree" : "Show file tree"}
      title={`${open ? "Hide" : "Show"} file tree (Space B)`}
      className="cursor-pointer rounded-sm p-1 text-one-muted hover:bg-one-hover hover:text-one-accent"
    >
      <PanelIcon />
    </button>
  );

  if (!open) {
    return (
      <div className="flex shrink-0 flex-col items-center border-r border-one-line bg-one-panel p-1">
        {toggle}
      </div>
    );
  }

  return (
    <aside
      style={{ width }}
      className="relative flex shrink-0 flex-col border-r border-one-line bg-one-panel font-mono"
    >
      <header className="flex items-center justify-between border-b border-one-line py-1 pr-1 pl-3">
        <span className="text-[11px] tracking-wider text-one-muted uppercase">Vault</span>
        <div className="flex items-center">
          <button
            type="button"
            onClick={newNote}
            aria-label="New note"
            title="New note (Space C F)"
            className="cursor-pointer rounded-sm p-1 text-one-muted hover:bg-one-hover hover:text-one-accent"
          >
            <PlusIcon />
          </button>
          {toggle}
        </div>
      </header>

      {/* The handler sits on the panel, not the rows: the keys act on the row
          the cursor is on, which is not always the one holding focus. */}
      <nav ref={nav} aria-label="Vault" onKeyDown={onKeyDown} className="flex-1 overflow-auto p-1">
        {tree.length === 0 ? (
          <p className="px-2 py-1 text-[13px] text-one-muted">No notes yet</p>
        ) : (
          <NodeList
            nodes={tree}
            depth={0}
            expanded={expanded}
            openPath={openPath}
            cursorKey={cursorKey}
            onToggleFolder={toggleFolder}
            onOpenFile={onOpenFile}
            onOpenImage={onOpenImage}
          />
        )}
      </nav>

      <Grip
        width={width}
        dragging={drag !== null}
        onResizeStart={(x) => setDrag({ x, width })}
        onResizeBy={(delta) => setWidth(clampWidth(width + delta))}
        onReset={() => setWidth(DEFAULT_WIDTH)}
      />
    </aside>
  );
}
