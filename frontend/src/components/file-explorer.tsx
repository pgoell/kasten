import { useEffect, useMemo, useState } from "react";

interface FileExplorerProps {
  /** Vault-relative paths of every note, as served by `GET /api/files`. */
  paths: string[];
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
  onToggleFolder: (path: string) => void;
}

function NodeList({ nodes, depth, collapsed, onToggleFolder }: NodeListProps) {
  return (
    <ul>
      {nodes.map((node) => {
        if (node.kind === "file") {
          return (
            <li
              key={`file:${node.path}`}
              style={indent(depth)}
              title={node.path}
              className={`${ROW} text-one-fg hover:bg-one-hover`}
            >
              {/* Holds the chevron's column so note names line up with folder names. */}
              <span className="size-3 shrink-0" />
              <span className="truncate">{node.name}</span>
            </li>
          );
        }

        const open = !collapsed.has(node.path);

        return (
          <li key={`folder:${node.path}`}>
            <button
              type="button"
              onClick={() => onToggleFolder(node.path)}
              aria-expanded={open}
              style={indent(depth)}
              className={`${ROW} cursor-pointer text-one-muted hover:bg-one-hover hover:text-one-fg`}
            >
              <Chevron open={open} />
              <span className="truncate">{node.name}</span>
            </button>
            {open && (
              <NodeList
                nodes={node.children}
                depth={depth + 1}
                collapsed={collapsed}
                onToggleFolder={onToggleFolder}
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
 * Read-only for now: it shows what is in the vault and nothing opens yet.
 */
export function FileExplorer({ paths }: FileExplorerProps) {
  const [open, setOpen] = useState(true);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  /** Where the pointer went down, and how wide the panel was then. */
  const [drag, setDrag] = useState<{ x: number; width: number } | null>(null);
  const tree = useMemo(() => buildTree(paths), [paths]);

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

  // Captured on the way down and stopped there, because CodeMirror's vim mode
  // would otherwise page up on the same key.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "b") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen((previous) => !previous);
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

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
      onClick={() => setOpen(!open)}
      aria-label={open ? "Hide file tree" : "Show file tree"}
      title={`${open ? "Hide" : "Show"} file tree (Ctrl+B)`}
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

      <nav aria-label="Vault" className="flex-1 overflow-auto p-1">
        {tree.length === 0 ? (
          <p className="px-2 py-1 text-[13px] text-one-muted">No notes yet</p>
        ) : (
          <NodeList nodes={tree} depth={0} collapsed={collapsed} onToggleFolder={toggleFolder} />
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
