import { useEffect, useMemo, useRef, useState } from "react";
import { type EditorCommands, LEADER } from "@/lib/key-bindings";

interface FileExplorerProps {
  /** Vault-relative paths of every note, as served by `GET /api/files`. */
  paths: string[];
  /** Vault-relative path of the open note, absent while none is open. */
  openPath?: string;
  onOpenFile: (path: string) => void;
  /** Whether the panel is unfolded. Held by the route, because `<leader>b`
   * reaches it from inside the editor. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Reached by leader sequences typed here rather than in the editor. */
  commands: EditorCommands;
  /** Raised by the route to ask the panel for the focus. The change is the
   * request, not the value: mounting must not pull focus out of the editor. */
  focusSignal?: number;
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
}

type TreeNode = FolderNode | FileNode;

/**
 * Fold flat vault paths into a folder tree.
 *
 * The backend deliberately serves a flat, sorted list and never models
 * folders, so the nesting is reconstructed here.
 */
function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const path of paths) {
    const parts = path.split("/");
    const fileName = parts.pop();
    if (!fileName) continue;

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

    level.push({ kind: "file", name: fileName.replace(/\.md$/, ""), path });
  }

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
function flattenRows(nodes: TreeNode[], collapsed: ReadonlySet<string>): Row[] {
  const rows: Row[] = [];

  function walk(level: TreeNode[], parent: number) {
    for (const node of level) {
      const index = rows.length;
      rows.push({ node, parent });
      if (node.kind === "folder" && !collapsed.has(node.path)) {
        walk(node.children, index);
      }
    }
  }

  walk(nodes, -1);
  return rows;
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
  collapsed: ReadonlySet<string>;
  openPath?: string;
  /** The row the keyboard cursor is on, which is the panel's only tab stop. */
  cursorKey: string;
  onToggleFolder: (path: string) => void;
  onOpenFile: (path: string) => void;
}

function NodeList({
  nodes,
  depth,
  collapsed,
  openPath,
  cursorKey,
  onToggleFolder,
  onOpenFile,
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
                onClick={() => onOpenFile(node.path)}
                aria-current={current ? "page" : undefined}
                style={indent(depth)}
                title={node.path}
                className={`${ROW} cursor-pointer ${
                  current ? "bg-one-hover text-one-accent" : "text-one-fg hover:bg-one-hover"
                } ${tabIndex === 0 ? "outline-1 -outline-offset-1 outline-one-selection" : ""}`}
              >
                {/* Holds the chevron's column so note names line up with folder names. */}
                <span className="size-3 shrink-0" />
                <span className="truncate">{node.name}</span>
              </button>
            </li>
          );
        }

        const open = !collapsed.has(node.path);

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
                tabIndex === 0 ? "outline-1 -outline-offset-1 outline-one-selection" : ""
              }`}
            >
              <Chevron open={open} />
              <span className="truncate">{node.name}</span>
            </button>
            {open && (
              <NodeList
                nodes={node.children}
                depth={depth + 1}
                collapsed={collapsed}
                openPath={openPath}
                cursorKey={cursorKey}
                onToggleFolder={onToggleFolder}
                onOpenFile={onOpenFile}
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
  openPath,
  onOpenFile,
  open,
  onOpenChange,
  commands,
  focusSignal = 0,
}: FileExplorerProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  /** Where the pointer went down, and how wide the panel was then. */
  const [drag, setDrag] = useState<{ x: number; width: number } | null>(null);
  /** Which row the vim keys act on. */
  const [active, setActive] = useState(0);
  /** The first half of a two-key sequence, `g` or the leader, once pressed. */
  const [pending, setPending] = useState<string | null>(null);
  const nav = useRef<HTMLElement>(null);
  /** The signal already answered, so the first render answers nothing. */
  const answered = useRef(focusSignal);
  const tree = useMemo(() => buildTree(paths), [paths]);
  const rows = useMemo(() => flattenRows(tree, collapsed), [tree, collapsed]);
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

  // Only when the panel already holds the focus. Moving the cursor from inside
  // the editor, which `<leader>b` does, must not drag the focus along with it.
  useEffect(() => {
    const panel = nav.current;
    if (!panel?.contains(document.activeElement)) return;
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

  /**
   * The vim keys, resolved in the order vim resolves them.
   *
   * A pending key comes first, because `gg` and a leader sequence both mean the
   * second press is not a command of its own. Anything unrecognised is left
   * alone rather than swallowed, so the browser keeps its own shortcuts.
   */
  function onKeyDown(event: React.KeyboardEvent) {
    const { key } = event;

    if (pending) {
      setPending(null);
      if (pending === " ") {
        const binding = LEADER.find((entry) => entry.key === key);
        if (binding) {
          event.preventDefault();
          commands[binding.command]();
        }
      } else if (key === "g") {
        event.preventDefault();
        setActive(0);
      }
      return;
    }

    const row = rows[cursor];
    const folder = row?.node.kind === "folder" ? row.node : null;
    const unfolded = folder !== null && !collapsed.has(folder.path);

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
        else if (row) onOpenFile(row.node.path);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  function toggleFolder(path: string) {
    setCollapsed((previous) => {
      const next = new Set(previous);
      // `delete` reports whether the folder was collapsed, so one call flips it.
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
        {toggle}
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
            collapsed={collapsed}
            openPath={openPath}
            cursorKey={cursorKey}
            onToggleFolder={toggleFolder}
            onOpenFile={onOpenFile}
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
