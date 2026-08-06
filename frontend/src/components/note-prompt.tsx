import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createNote, moveFolder, renameNote } from "@/lib/api";
import { folderCandidates, rankCandidates } from "@/lib/fuzzy";
import { describeFolderPath, describeNotePath, type NotePathVerdict } from "@/lib/note-path";

/**
 * What the prompt is naming.
 *
 * A note that does not exist yet, a note that does, or the folder a whole
 * subtree of them lives under.
 */
export type PromptMode = "create" | "rename" | "folder";

/**
 * The note the editor should show once the prompt lands, or undefined to stay.
 *
 * A create always opens what it made: there was nothing to leave. A rename only
 * follows the note that was open, and then it must, because `?note=` would
 * otherwise point at a path the vault no longer has. Renaming any other note,
 * which is what the file tree does with its cursor on a row you are not
 * editing, leaves the editor where it is.
 *
 * A folder move follows the same rule read one level up. The open note has a
 * new path if it sat inside the folder, and that path is the folder's new one
 * with the rest of the old path on the end. Nothing else about the note
 * changed, so this is worked out here rather than asked of the vault.
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
    // The one verdict the modes read differently. A create opens the note that
    // is there; a move onto one would overwrite it, and the vault refuses that,
    // so the prompt says so before the request rather than after. The path it
    // started on is not a collision, and Enter closes on it.
    case "open":
      if (mode === "create") return "already exists, Enter opens it";
      if (verdict.path === startPath) return "";
      return mode === "folder" ? "a folder is already there" : "a note is already there";
    case "create":
      // How far a folder move reaches is the thing the input does not spell
      // out, and the one worth knowing before Enter.
      if (mode === "folder") return `moves ${moves} note${moves === 1 ? "" : "s"}`;
      // A folder the vault does not have yet is the same kind of surprise for a
      // note: the one thing the write does beyond what was typed.
      return verdict.newFolder ? `creates folder ${verdict.newFolder}` : "";
    case "empty":
      return "";
  }
}

/** Where the name sits inside a path, so a rename opens with it selected. */
function nameRange(path: string, mode: PromptMode): [number, number] {
  const start = path.lastIndexOf("/") + 1;
  // A folder has a name and not a name and a suffix, so the whole segment is
  // selected. `2026.05` is one folder name, not `2026` with something after it.
  if (mode === "folder") return [start, path.length];

  const dot = path.lastIndexOf(".");
  // The folder and the suffix are what a rename usually keeps, so neither is
  // selected. A name with no suffix is selected to its end.
  return [start, dot > start ? dot : path.length];
}

/**
 * Type where the note goes, and Enter puts it there.
 *
 * The list underneath ranks the vault's folders against what has been typed,
 * and the line under that says what Enter will do, which is the same verdict
 * Enter obeys. Notes are not ranked: the tree is how you open one, and the
 * prompt has the one job.
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
  // Two memos rather than one, because the folder set follows the vault and not
  // the query. Keyed on `paths` alone it survives every keystroke, which takes
  // walking 10,000 paths for 842 folders off the typing path entirely. That
  // asks one thing of the caller: hand over the same array each render. The
  // route passes what the query cache holds, and a listing filtered or sorted
  // at the call site would be a new array every time and undo all of this.
  const prefixes = useMemo(() => folderCandidates(paths), [paths]);
  // A folder cannot go inside itself, so neither it nor anything under it is a
  // place this move can land, and completing to one would only be a way to type
  // a refusal faster. Off the keystroke path with the derivation above, because
  // the mode and the folder both hold still while the prompt is open.
  const candidates = useMemo(
    () =>
      mode === "folder"
        ? prefixes.filter(({ path }) => !path.startsWith(`${startPath}/`))
        : prefixes,
    [prefixes, mode, startPath],
  );
  // Ranked over every folder and cut afterwards, so the rows on screen are the
  // best of the vault rather than the first slice of it. An empty query matches
  // everything, so without the cut a keystroke reconciles one button per folder
  // in the vault, which is most of what it costs.
  const folders = useMemo(
    () => rankCandidates(candidates, typed).slice(0, VISIBLE_FOLDERS),
    [candidates, typed],
  );
  // How far a folder move reaches, for the hint. Same shape as the filter
  // above, and the same reason it costs nothing per keystroke.
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

  // The input takes the focus so the keys reach it rather than whatever was
  // focused when it opened, and hands it back on the way out. Restoring what
  // held it beats naming the editor: the same prompt opens from the file tree,
  // and closing there belongs back in the tree.
  //
  // Opening a note is the exception. The editor that mounts behind the prompt
  // takes the focus only when nobody holds it, so handing it back there leaves
  // a new note you have to click before you can write in it.
  //
  // A rename opens on the whole path and selects the name inside it, so the
  // common edit is one word of typing and the folder is still there to change.
  // A create has no name to select and leaves the caret where it lands.
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
      // A create opens the note that is already there. Neither rename can land
      // on something taken, and the path it started on is nothing to do, so
      // Enter just closes.
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
    // Enter repeats while it is held, and each repeat would be another request.
    // The vault refuses the duplicates, but only the first answer opens a note.
    if (sending.current) return;
    sending.current = true;
    const target = verdict.path;

    // The prompt stays open with the typed path still in it, so a write that
    // bounced off a stale listing or a dead network costs no typing, and the
    // guard lifts so the next Enter tries again.
    function refused() {
      sending.current = false;
      setFailed(true);
    }

    /** The tail all three writes share, once the cache holds what the vault does. */
    function landed(path: string) {
      // Only where the editor is about to take the focus itself. A folder
      // renamed from the tree with nothing of it open leaves the focus in the
      // tree, which is where the next key belongs.
      opening.current = noteAfterPrompt(mode, startPath, path, openNote) !== undefined;
      queryClient.invalidateQueries({ queryKey: ["files"] });
      onOpen(path);
    }

    if (mode === "folder") {
      void moveFolder(startPath, target).then((folder) => {
        // Every note under the folder is at a new path, and the answer carries
        // no text to move with them. They are dropped rather than remapped: the
        // vault is the only thing that knows what is in a note, and a copy left
        // stale by a write outside kasten must not survive the move.
        const moved = `${startPath}/`;
        queryClient.removeQueries({
          queryKey: ["note"],
          predicate: ({ queryKey }) =>
            typeof queryKey[1] === "string" && queryKey[1].startsWith(moved),
        });
        landed(folder.path);
      }, refused);
      return;
    }

    void (mode === "rename" ? renameNote(startPath, target) : createNote(target)).then((note) => {
      // The vault's spelling of the path, not the typed one, from here on. The
      // text comes from the answer rather than from the cache, so a create
      // saves the editor a read of a file it already knows and a rename carries
      // the note across without trusting a copy that may be stale.
      queryClient.setQueryData(["note", note.path], note.content);
      // The note is not at the old path any more, so a cache entry there would
      // answer for a note the vault no longer has.
      if (mode === "rename") queryClient.removeQueries({ queryKey: ["note", startPath] });
      landed(note.path);
    }, refused);
  }

  /** Fold a folder into the input, which is what Tab and a click on a row do. */
  function pick(folder: string) {
    // The whole input was the query the folder was ranked against, so the
    // folder stands in for all of it. Its trailing slash leaves the caret where
    // the note name goes.
    setInput(folder);
    setActive(0);
    setFailed(false);
    // A click leaves the focus on the row it landed on, and the name is typed
    // next.
    field.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const down = event.key === "ArrowDown" || (event.ctrlKey && event.key === "n");
    const up = event.key === "ArrowUp" || (event.ctrlKey && event.key === "p");

    if (down || up) {
      if (folders.length === 0) return;
      // Without this the arrows take the caret to one end of the input, which
      // is where the browser sends them when nothing else does.
      event.preventDefault();
      // The failure named the path that was tried, and the highlight moving is
      // the start of naming another one.
      setFailed(false);
      setActive(down ? Math.min(cursor + 1, folders.length - 1) : Math.max(cursor - 1, 0));
      return;
    }

    switch (event.key) {
      case "Tab": {
        // Before the empty list bows out: the browser's own tab would take the
        // focus off the dialog, and every key that closes it goes with it.
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
        // Everything else is typing, and belongs to the input.
        return;
    }
  }

  return (
    // The dialog reads the keys, not the input, so they still land once a click
    // has moved the focus to a row or to the backdrop. Its own tabIndex is what
    // lets it hold the focus in that case.
    <div
      role="dialog"
      aria-modal="true"
      aria-label={TITLE[mode]}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-20 flex items-start justify-center bg-black/50 pt-[15vh] focus:outline-none"
    >
      <div className="flex max-h-[70vh] w-[min(36rem,90vw)] flex-col rounded-md border border-one-line bg-one-panel font-mono shadow-xl">
        <div className="flex items-center gap-3 border-b border-one-line px-3 py-2">
          <label
            htmlFor={`${listId}-path`}
            className="text-[11px] tracking-wider text-one-muted uppercase"
          >
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
            className="min-w-0 flex-1 bg-transparent text-[13px] text-one-fg outline-none"
          />
        </div>

        {folders.length > 0 && (
          // A div rather than a list, because a listbox is not a list of items
          // to a screen reader and marking it as both says it twice.
          <div id={listId} role="listbox" aria-label="Folders" className="overflow-auto py-1">
            {folders.map((folder, index) => (
              <button
                key={folder}
                id={`${listId}-${index}`}
                type="button"
                role="option"
                aria-selected={index === cursor}
                // Out of the tab order, because the focus stays in the input
                // and the highlight is how the list says where Tab would go. A
                // click still lands here, and takes the folder Tab would take.
                tabIndex={-1}
                onClick={() => pick(folder)}
                className={`w-full cursor-pointer px-3 py-[3px] text-left text-[13px] ${
                  index === cursor ? "bg-one-hover text-one-accent" : "text-one-fg"
                }`}
              >
                {folder}
              </button>
            ))}
          </div>
        )}

        {/* An <output> rather than a <p role="status">: same announcement, and
            the element carries it without the attribute. */}
        <output className="border-t border-one-line px-3 py-1 text-[11px] text-one-muted">
          {failed ? REFUSED[mode] : hint(verdict, mode, startPath, moves)}
        </output>
      </div>
    </div>
  );
}
