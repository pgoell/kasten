import { useEffect, useMemo, useRef, useState } from "react";
import { TreePanel } from "@/components/tree-panel";
import { DROP, NodeList, useRowDrag } from "@/components/tree-rows";
import {
  ancestors,
  type FileNode,
  type FolderNode,
  flattenRows,
  rowKey,
  type Shows,
  startFolder,
  type TreeNode,
} from "@/lib/file-tree";
import type { TreeCommands } from "@/lib/key-bindings";
import { heldModifier, leaderAction, leaderPrefix } from "@/lib/leader-keys";
import { useViewport } from "@/lib/use-viewport";
import { beginLeader, paneOpener } from "@/lib/which-key";

interface FileExplorerProps {
  /** Vault-relative paths of every note, as served by `GET /api/files`. */
  paths: string[];
  /** Its own prop, not rows in `paths`: the tree is where an image sits beside its note. */
  images?: string[];
  /** Vault-relative paths of every HTML page, as served by `GET /api/html`. Rows the way `images` are. */
  html?: string[];
  /** Vault-relative paths of every pdf, the `.pdf` half of `GET /api/vault-assets`. Rows the way `images` are. */
  pdfs?: string[];
  /** Vault-relative path of the note, image, page or pdf open in the focused pane. */
  openPath?: string;
  onOpenFile: (path: string) => void;
  /** Called with the image a row names, which the route shows in the pane. */
  onOpenImage: (path: string) => void;
  /** Called with the HTML page a row names, the way `onOpenImage` is. */
  onOpenHtml: (path: string) => void;
  /** Called with the pdf a row names, the way `onOpenImage` is. */
  onOpenPdf: (path: string) => void;
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
  /** Escape in the drawer: close it and hand the focus to the pane on screen. */
  onLeave?: () => void;
}

/**
 * Fold flat vault paths into a folder tree.
 *
 * The backend deliberately serves a flat, sorted list and never models
 * folders, so the nesting is reconstructed here.
 */
export function buildTree(
  paths: string[],
  images: string[] = [],
  html: string[] = [],
  pdfs: string[] = [],
): TreeNode[] {
  const root: TreeNode[] = [];

  // A loop per list over one function rather than one loop over all of them,
  // which would have to ask which list each path came from: at 10,000 notes
  // that question is a scan of the images per note, and this is none.
  function add(path: string, shows?: Shows): void {
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

    // An image, a page or a pdf keeps its suffix and a note loses its `.md`: the
    // vault holds one kind of note and seven kinds of everything else, so the
    // suffix is news on one row and noise on the other. A page keeping `.html`
    // is also what sets `report.html` apart from the `report` note beside it,
    // and a pdf keeping `.pdf` what sets a paper apart from the note about it.
    level.push(
      shows !== undefined
        ? { kind: "file", name: fileName, path, shows }
        : { kind: "file", name: fileName.replace(/\.md$/, ""), path },
    );
  }

  for (const path of paths) add(path);
  for (const path of images) add(path, "image");
  for (const path of html) add(path, "html");
  for (const path of pdfs) add(path, "pdf");

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

/**
 * The vault's file tree, in a panel that folds away to a narrow rail.
 *
 * Clicking a note reports its path and nothing more. Which note is open is the
 * caller's business, and it keeps that in the URL.
 */
export function FileExplorer({
  paths,
  images,
  html,
  pdfs,
  openPath,
  onOpenFile,
  onOpenImage,
  onOpenHtml,
  onOpenPdf,
  open,
  onOpenChange,
  commands,
  focusSignal = 0,
  revealSignal = 0,
  onLeave,
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
  const { narrow } = useViewport();
  /** Which row the vim keys act on. */
  const [active, setActive] = useState(0);
  const rowDrag = useRowDrag({
    expanded,
    unfold: (folder) => setExpanded((previous) => new Set([...previous, folder])),
    commands,
  });
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
  const tree = useMemo(() => buildTree(paths, images, html, pdfs), [paths, images, html, pdfs]);
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

  /** The callback a row's click and its Enter both reach. */
  function openRow(node: FileNode) {
    if (node.shows === "image") onOpenImage(node.path);
    else if (node.shows === "html") onOpenHtml(node.path);
    else if (node.shows === "pdf") onOpenPdf(node.path);
    else onOpenFile(node.path);
  }

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
    // A page is left where it is: it belongs to whatever wrote it, and the
    // folder it sits in moves it along with everything else. A pdf the same,
    // the note rename being the only rename there is and a pdf no note.
    if (node.kind === "file" && (node.shows === "html" || node.shows === "pdf")) return;
    if (node.kind === "file") commands.renameNote(node.path);
    else commands.renameFolder(node.path);
  }

  function deleteRow() {
    const node = rows[cursor]?.node;
    if (!node) return;

    // A pdf has no delete of its own, and the note delete would ask the vault
    // for `plan.pdf` as a note it does not hold.
    if (node.kind === "file" && (node.shows === "html" || node.shows === "pdf")) return;

    deleting.current = true;
    if (node.kind !== "file") commands.deleteFolder(node.path);
    else if (node.shows === "image") commands.deleteImage(node.path);
    else commands.deleteNote(node.path);
  }

  /** A pending sequence resolves first. Unknown keys are left for the browser's own shortcuts. */
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
        setPending(key);
        break;
      case " ":
        // The tree's own create and rename, so the panel's `cf` seeds a note
        // with the cursor's folder the way the tree's leader does.
        if (beginLeader(paneOpener({ ...commands, createNote: newNote, renameNote }))) {
          event.preventDefault();
          return;
        }
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
        //
        // A drawer asks the route instead. The page under it is inert until
        // it has closed, so nothing there can take the focus yet, and the
        // first editor in the document may be in a pane that is not drawn.
        if (narrow) onLeave?.();
        else document.querySelector<HTMLElement>(".cm-content")?.focus();
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
          if (file) openRow(file);
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

  return (
    <TreePanel open={open} onOpenChange={onOpenChange} onNewNote={newNote}>
      {/* The handler sits on the panel, not the rows: the keys act on the row
          the cursor is on, which is not always the one holding focus. */}
      {/* The space around the rows is the vault root, as a place to drop on. */}
      <nav
        ref={nav}
        aria-label="Vault"
        onKeyDown={onKeyDown}
        onDragOver={(event) => rowDrag.over(event, "")}
        onDrop={(event) => rowDrag.drop(event, "")}
        className={`flex-1 overflow-auto p-1 ${rowDrag.target === "" ? DROP : ""}`}
      >
        {tree.length === 0 ? (
          <p className="px-2 py-1 text-[13px] text-k-muted">No notes yet</p>
        ) : (
          <NodeList
            nodes={tree}
            depth={0}
            expanded={expanded}
            openPath={openPath}
            cursorKey={cursorKey}
            onToggleFolder={toggleFolder}
            onOpen={openRow}
            drag={rowDrag}
          />
        )}
      </nav>
    </TreePanel>
  );
}
