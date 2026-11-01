import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createNote } from "@/lib/api";
import { folderCandidates, rankCandidates } from "@/lib/fuzzy";
import { moveAndCache } from "@/lib/move";
import { describeFolderPath, describeNotePath, type NotePathVerdict } from "@/lib/note-path";
import {
  BACKDROP,
  closeOnBackdrop,
  HEADER_ROW,
  INPUT,
  LABEL,
  PANEL,
  PANEL_NARROW,
  ROW,
  STATUS,
  TAP,
} from "@/lib/overlay-styles";

/**
 * What the prompt is naming.
 *
 * A note that does not exist yet, a note that does, or the folder a whole
 * subtree of them lives under.
 */
export type PromptMode = "create" | "rename" | "folder";

/**
 * The note the editor should show once the prompt lands, or undefined to stay.
 * A rename or folder move follows only the open note: `?note=` would
 * otherwise name a path the vault no longer has.
 */
export function noteAfterPrompt(
  mode: PromptMode,
  startPath: string,
  landed: string,
  openNote: string | undefined,
): string | undefined {
  if (mode === "create") return landed;

  if (mode === "folder") {
    // The slash keeps this on a segment boundary: `inboxes/` is not `inbox/`.
    const inside = `${startPath}/`;
    if (openNote === undefined || !openNote.startsWith(inside)) return undefined;
    return `${landed}/${openNote.slice(inside.length)}`;
  }

  return startPath === openNote ? landed : undefined;
}

interface NotePromptProps {
  mode: PromptMode;
  /** Every path in the vault, for ranking and for spotting a collision. */
  paths: string[];
  /** A create starts on a folder or "", a rename on the path it is renaming. */
  startPath: string;
  /** The open note, which decides whether the focus is the editor's on the way out. */
  openNote?: string;
  /** Called with the path the prompt landed on, note or folder. */
  onOpen: (path: string) => void;
  onClose: () => void;
}

/** Rows the list will mount. Beyond this, another keystroke narrows faster than a scroll. */
const VISIBLE_FOLDERS = 20;

/** What the prompt calls itself, in the header, to a screen reader, and when it fails. */
const HEADER: Record<PromptMode, string> = {
  create: "new note",
  rename: "rename note",
  folder: "rename folder",
};
const TITLE: Record<PromptMode, string> = {
  create: "New note",
  rename: "Rename note",
  folder: "Rename folder",
};
const REFUSED: Record<PromptMode, string> = {
  create: "could not create the note",
  rename: "could not rename the note",
  folder: "could not rename the folder",
};

/**
 * What the line under the list says, and nothing where it has nothing to say.
 *
 * `moves` is how many notes a folder move would carry, and is read in that mode
 * alone.
 */
function hint(
  verdict: NotePathVerdict,
  mode: PromptMode,
  startPath: string,
  moves: number,
): string {
  switch (verdict.kind) {
    case "blocked":
      return verdict.reason;
    // The one verdict the modes read differently: a move onto a note would overwrite it.
    case "open":
      if (mode === "create") return "already exists, Enter opens it";
      if (verdict.path === startPath) return "";
      return mode === "folder" ? "a folder is already there" : "a note is already there";
    case "create":
      if (mode === "folder") return `moves ${moves} note${moves === 1 ? "" : "s"}`;
      // A new folder is the one thing the write does beyond what was typed.
      return verdict.newFolder ? `creates folder ${verdict.newFolder}` : "";
    case "empty":
      return "";
  }
}

/** Where the name sits inside a path, so a rename opens with it selected. */
function nameRange(path: string, mode: PromptMode): [number, number] {
  const start = path.lastIndexOf("/") + 1;
  // `2026.05` is one folder name, so a folder's whole segment is selected.
  if (mode === "folder") return [start, path.length];

  const dot = path.lastIndexOf(".");
  // The folder and the suffix are what a rename keeps, so only the name is selected.
  return [start, dot > start ? dot : path.length];
}

/**
 * Type where the note goes, and Enter puts it there. Only folders are ranked,
 * since the tree is how you open a note.
 */
export function NotePrompt({ mode, paths, startPath, openNote, onOpen, onClose }: NotePromptProps) {
  const [input, setInput] = useState(startPath);
  /** Which folder Tab would take. */
  const [active, setActive] = useState(0);
  /** Set when the vault refused the write, cleared by anything naming another path. */
  const [failed, setFailed] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  /** Set while a write is in flight, so a held Enter sends the one request. */
  const sending = useRef(false);
  /** Set once a note is on its way open, and the focus then belongs to the editor. */
  const opening = useRef(false);
  const listId = useId();
  const queryClient = useQueryClient();

  const typed = input.trim();
  // Keyed on `paths` alone, so typing does not rebuild the folder set. The caller
  // must pass the same array each render, or this undoes it.
  const prefixes = useMemo(() => folderCandidates(paths), [paths]);
  // A folder cannot move into itself, so its subtree is no place to land.
  const candidates = useMemo(
    () =>
      mode === "folder"
        ? prefixes.filter(({ path }) => !path.startsWith(`${startPath}/`))
        : prefixes,
    [prefixes, mode, startPath],
  );
  // Cut after ranking, so the rows are the vault's best, not its first slice.
  const folders = useMemo(
    () => rankCandidates(candidates, typed).slice(0, VISIBLE_FOLDERS),
    [candidates, typed],
  );
  const moves = useMemo(
    () => (mode === "folder" ? paths.filter((p) => p.startsWith(`${startPath}/`)).length : 0),
    [paths, mode, startPath],
  );
  const verdict =
    mode === "folder"
      ? describeFolderPath(input, paths, startPath)
      : describeNotePath(input, paths);
  // A fresh listing from the tree can shorten the list under the highlight.
  // Typing cannot: it puts the highlight back on the first row.
  const cursor = Math.min(active, Math.max(folders.length - 1, 0));

  // The input takes the focus and hands it back on the way out, to whoever held it.
  // Not when a note opens: the editor behind takes focus only when nobody holds it.
  useEffect(() => {
    const opener = document.activeElement;
    field.current?.focus();
    if (mode !== "create") field.current?.setSelectionRange(...nameRange(startPath, mode));
    return () => {
      if (opening.current) return;
      if (opener instanceof HTMLElement) opener.focus();
    };
    // Neither changes while the prompt is open: the route sets both when it
    // opens one and unmounts it to close.
  }, [mode, startPath]);

  function accept() {
    if (verdict.kind === "open") {
      // A rename onto a taken path does nothing; onto its own path, it closes.
      if (mode !== "create") {
        if (verdict.path === startPath) onClose();
        return;
      }
      opening.current = true;
      onOpen(verdict.path);
      return;
    }
    // `empty` and `blocked` name nothing, and the hint line already says so.
    if (verdict.kind !== "create") return;
    // A held Enter repeats, and each repeat would be another request.
    if (sending.current) return;
    sending.current = true;
    const target = verdict.path;

    // A refused write keeps the typed path, and the guard lifts so Enter retries.
    function refused() {
      sending.current = false;
      setFailed(true);
    }

    /** The tail all three writes share, once the cache holds what the vault does. */
    function landed(path: string) {
      // Only where the editor takes focus itself, so a tree rename keeps it in the tree.
      opening.current = noteAfterPrompt(mode, startPath, path, openNote) !== undefined;
      queryClient.invalidateQueries({ queryKey: ["files"] });
      onOpen(path);
    }

    if (mode === "create") {
      void createNote(target).then((note) => {
        // The vault's spelling of the path, and its text, which saves the editor a read.
        queryClient.setQueryData(["note", note.path], note.content);
        landed(note.path);
      }, refused);
      return;
    }

    void moveAndCache(queryClient, mode, startPath, target).then(landed, refused);
  }

  /** Fold a folder into the input, which is what Tab and a click on a row do. */
  function pick(folder: string) {
    // The folder stands in for the whole query. Its slash leaves the caret where the name goes.
    setInput(folder);
    setActive(0);
    setFailed(false);
    field.current?.focus();
  }

  /** Move the highlight on an arrow or ctrl+n/p. Answers whether the key was one. */
  function moveKey(event: React.KeyboardEvent): boolean {
    const down = event.key === "ArrowDown" || (event.ctrlKey && event.key === "n");
    const up = event.key === "ArrowUp" || (event.ctrlKey && event.key === "p");
    if (!down && !up) return false;
    if (folders.length === 0) return true;
    // Without this the arrows move the caret to one end of the input.
    event.preventDefault();
    // Moving the highlight starts naming another path, so the failure clears.
    setFailed(false);
    setActive(down ? Math.min(cursor + 1, folders.length - 1) : Math.max(cursor - 1, 0));
    return true;
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (moveKey(event)) return;

    switch (event.key) {
      case "Tab": {
        // Prevented even with no folder, or the browser's Tab would leave the dialog.
        event.preventDefault();
        const folder = folders[cursor];
        if (folder) pick(folder);
        break;
      }
      case "Enter":
        event.preventDefault();
        accept();
        break;
      case "Escape":
        event.preventDefault();
        onClose();
        break;
      default:
        return;
    }
  }

  return (
    // Keys land on the dialog, not the input, so a click elsewhere cannot lose them.
    <div
      role="dialog"
      aria-modal="true"
      aria-label={TITLE[mode]}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      {...closeOnBackdrop(onClose, input !== startPath)}
      className={BACKDROP}
    >
      <div className={`${PANEL} ${PANEL_NARROW}`}>
        <div className={HEADER_ROW}>
          <label htmlFor={`${listId}-path`} className={LABEL}>
            {HEADER[mode]}
          </label>
          <input
            id={`${listId}-path`}
            ref={field}
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              setActive(0);
              setFailed(false);
            }}
            role="combobox"
            aria-expanded={folders.length > 0}
            aria-controls={listId}
            aria-activedescendant={folders.length > 0 ? `${listId}-${cursor}` : undefined}
            autoComplete="off"
            spellCheck={false}
            className={INPUT}
          />
        </div>

        {folders.length > 0 && (
          // A div, not a list: a listbox read as a list says it twice.
          <div id={listId} role="listbox" aria-label="Folders" className="overflow-auto py-1">
            {folders.map((folder, index) => (
              <button
                key={folder}
                id={`${listId}-${index}`}
                type="button"
                role="option"
                aria-selected={index === cursor}
                // Out of the tab order: focus stays in the input, and a click takes the folder Tab would.
                tabIndex={-1}
                onClick={() => pick(folder)}
                className={`${ROW} ${TAP} ${
                  index === cursor ? "bg-k-surface text-k-accent" : "text-k-ink"
                }`}
              >
                {folder}
              </button>
            ))}
          </div>
        )}

        {/* An <output>, not a <p role="status">: the element announces without the attribute. */}
        <output className={STATUS}>
          {failed ? REFUSED[mode] : hint(verdict, mode, startPath, moves)}
        </output>
      </div>
    </div>
  );
}
