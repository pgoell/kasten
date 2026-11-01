import { useRef, useState } from "react";
import { type FileNode, type FolderNode, rowKey, type TreeNode } from "@/lib/file-tree";
import type { TreeCommands } from "@/lib/key-bindings";
import { dropTarget, type MoveMode } from "@/lib/move";

/** Indent one step per level, on top of the row's own padding. */
function indent(depth: number) {
  return { paddingLeft: `${0.5 + depth * 0.75}rem` };
}

// 44px under a finger, which is the folder toggle as well: the row is the toggle.
const ROW =
  "k-row flex w-full items-center gap-1 rounded-sm py-[3px] pr-2 text-left text-[13px] pointer-coarse:min-h-11";

/**
 * The keyboard cursor, drawn as vim draws its own: hollow while idle, filled and brighter once
 * focused, so a cursor left behind does not look live.
 */
const CURSOR = [
  "outline-1 -outline-offset-1 outline-k-accent/45",
  "focus:outline-2 focus:outline-k-accent focus:bg-k-accent/15",
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
  /** Called with a file row, which the caller opens as its kind says. */
  onOpen: (node: FileNode) => void;
  drag: DragHandlers;
}

/**
 * What a row needs to take part in a drag, handed down the tree as one prop.
 *
 * A row names the folder it would drop into: a folder its own path, a note the
 * folder it sits in, so a drop on any row lands somewhere a reader can see.
 */
export interface DragHandlers {
  start: (event: React.DragEvent, node: TreeNode) => void;
  over: (event: React.DragEvent, folder: string) => void;
  drop: (event: React.DragEvent, folder: string) => void;
  end: () => void;
  /** The folder the pointer would drop into, `""` for the vault root, or null. */
  target: string | null;
}

/** The folder a note sits in, `""` at the vault root. */
function parentOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}

/** How a row draws the folder it would drop into. */
export const DROP = "bg-k-accent/20 outline-1 -outline-offset-1 outline-k-accent";

export function NodeList(props: NodeListProps) {
  return (
    <ul>
      {props.nodes.map((node) => {
        const key = rowKey(node);
        // One tab stop for the whole panel: tab reaches the cursor, and the
        // vim keys move it from there.
        const tabIndex = key === props.cursorKey ? 0 : -1;

        return node.kind === "file" ? (
          <FileRow key={key} {...props} node={node} row={key} tabIndex={tabIndex} />
        ) : (
          <FolderRow key={key} {...props} node={node} row={key} tabIndex={tabIndex} />
        );
      })}
    </ul>
  );
}

type RowProps<Node> = Omit<NodeListProps, "nodes"> & { node: Node; row: string; tabIndex: number };

function FileRow({ node, row, tabIndex, depth, openPath, onOpen, drag }: RowProps<FileNode>) {
  const current = node.path === openPath;

  return (
    <li>
      <button
        type="button"
        data-row={row}
        tabIndex={tabIndex}
        onClick={() => onOpen(node)}
        // Notes only. An image, a page or a pdf has no route that moves
        // it on its own; the folder it sits in carries it.
        draggable={node.shows === undefined}
        onDragStart={(event) => drag.start(event, node)}
        onDragOver={(event) => drag.over(event, parentOf(node.path))}
        onDrop={(event) => drag.drop(event, parentOf(node.path))}
        onDragEnd={drag.end}
        aria-current={current ? "page" : undefined}
        style={indent(depth)}
        title={node.path}
        // An image or a page is muted against the notes, the way a
        // wikilink to a note nobody has written is: what the tree is for
        // is the notes, and this row is the vault admitting it holds
        // something else.
        className={`${ROW} cursor-pointer ${
          current
            ? "bg-k-surface text-k-accent"
            : `${node.shows !== undefined ? "text-k-muted" : "text-k-ink"} hover:bg-k-surface`
        } ${tabIndex === 0 ? CURSOR : ""}`}
      >
        {/* Holds the chevron's column so note names line up with folder names. */}
        <span className="size-3 shrink-0" />
        <span className="truncate">{node.name}</span>
      </button>
    </li>
  );
}

function FolderRow({ node, row, tabIndex, ...list }: RowProps<FolderNode>) {
  const { depth, expanded, onToggleFolder, drag } = list;
  const open = expanded.has(node.path);

  return (
    <li>
      <button
        type="button"
        data-row={row}
        tabIndex={tabIndex}
        onClick={() => onToggleFolder(node.path)}
        aria-expanded={open}
        draggable
        onDragStart={(event) => drag.start(event, node)}
        onDragOver={(event) => drag.over(event, node.path)}
        onDrop={(event) => drag.drop(event, node.path)}
        onDragEnd={drag.end}
        style={indent(depth)}
        className={`${ROW} cursor-pointer text-k-muted hover:bg-k-surface hover:text-k-ink ${
          tabIndex === 0 ? CURSOR : ""
        } ${drag.target === node.path ? DROP : ""}`}
      >
        <Chevron open={open} />
        <span className="truncate">{node.name}</span>
      </button>
      {open && <NodeList {...list} nodes={node.children} depth={depth + 1} />}
    </li>
  );
}

/**
 * The drag and drop of the tree's rows: what is being dragged, and the folder
 * under the pointer that would take it.
 */
export function useRowDrag({
  expanded,
  unfold,
  commands,
}: {
  expanded: ReadonlySet<string>;
  unfold(folder: string): void;
  commands: TreeCommands;
}): DragHandlers {
  /** The row being dragged, held here because a drag's own data cannot be
   * read until the drop, and every row it passes has to know whether it would
   * take it. */
  const [dragged, setDragged] = useState<{ path: string; mode: MoveMode } | null>(null);
  /** The folder under the pointer that would take the drop. */
  const [dropOn, setDropOn] = useState<string | null>(null);
  /** Unfolds the folder a drag rests on, so a drop can reach inside it. */
  const unfoldTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const rowDrag: DragHandlers = {
    start(event, node) {
      // Set so Firefox starts the drag at all; nothing reads it back.
      event.dataTransfer.setData("text/plain", node.path);
      event.dataTransfer.effectAllowed = "move";
      setDragged({ path: node.path, mode: node.kind === "folder" ? "folder" : "rename" });
    },
    over(event, folder) {
      // Handled here, so the panel behind the row does not take it as a drop
      // on the vault root.
      event.stopPropagation();
      if (!dragged || dropTarget(dragged.path, dragged.mode, folder) === undefined) {
        setDropOn(null);
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (folder === dropOn) return;
      setDropOn(folder);
      clearTimeout(unfoldTimer.current);
      // Long enough that sweeping past a folder leaves it shut.
      if (folder && !expanded.has(folder)) {
        unfoldTimer.current = setTimeout(() => unfold(folder), 600);
      }
    },
    drop(event, folder) {
      event.preventDefault();
      event.stopPropagation();
      const target = dragged && dropTarget(dragged.path, dragged.mode, folder);
      if (dragged && target) commands.moveRow(dragged.path, dragged.mode, target);
      rowDrag.end();
    },
    end() {
      clearTimeout(unfoldTimer.current);
      setDragged(null);
      setDropOn(null);
    },
    target: dropOn,
  };

  return rowDrag;
}
