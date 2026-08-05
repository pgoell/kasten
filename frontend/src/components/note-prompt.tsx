import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createNote } from "@/lib/api";
import { folderPrefixes, rankFolderPrefixes } from "@/lib/fuzzy";
import { describeNotePath, type NotePathVerdict } from "@/lib/note-path";

interface NotePromptProps {
  /** Every path in the vault, for ranking and for spotting a collision. */
  paths: string[];
  /** What the input starts with, "" or a folder ending in "/". */
  startPath: string;
  /** Called with the path to put in `?note=`, for a created note or an existing one. */
  onOpen: (path: string) => void;
  onClose: () => void;
}

/** Rows the list will mount. Beyond this, another keystroke narrows faster than a scroll. */
const VISIBLE_FOLDERS = 20;

/** What the line under the list says, and nothing where it has nothing to say. */
function hint(verdict: NotePathVerdict): string {
  switch (verdict.kind) {
    case "blocked":
      return verdict.reason;
    case "open":
      return "already exists, Enter opens it";
    // A folder the vault does not have yet is the one thing a create does that
    // the input does not already spell out.
    case "create":
      return verdict.newFolder ? `creates folder ${verdict.newFolder}` : "";
    case "empty":
      return "";
  }
}

/**
 * Type where the note goes, and Enter puts it there.
 *
 * The list underneath ranks the vault's folders against what has been typed,
 * and the line under that says what Enter will do, which is the same verdict
 * Enter obeys. Notes are not ranked: the tree is how you open one, and the
 * prompt has the one job.
 */
export function NotePrompt({ paths, startPath, onOpen, onClose }: NotePromptProps) {
  const [input, setInput] = useState(startPath);
  /** Which folder Tab would take. */
  const [active, setActive] = useState(0);
  /** Set when the vault refused the write, cleared by anything naming another path. */
  const [failed, setFailed] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  /** Set while a create is in flight, so a held Enter sends the one request. */
  const creating = useRef(false);
  /** Set once a note is on its way open, and the focus then belongs to the editor. */
  const opening = useRef(false);
  const listId = useId();
  const queryClient = useQueryClient();

  const typed = input.trim();
  // Two memos rather than one, because the folder set follows the vault and not
  // the query. Keyed on `paths` alone it survives every keystroke, which takes
  // walking 10,000 paths for 842 folders off the typing path entirely.
  const prefixes = useMemo(() => folderPrefixes(paths), [paths]);
  // Ranked over every folder and cut afterwards, so the rows on screen are the
  // best of the vault rather than the first slice of it. An empty query matches
  // everything, so without the cut a keystroke reconciles one button per folder
  // in the vault, which is most of what it costs.
  const folders = useMemo(
    () => rankFolderPrefixes(prefixes, typed).slice(0, VISIBLE_FOLDERS),
    [prefixes, typed],
  );
  const verdict = describeNotePath(input, paths);
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
  useEffect(() => {
    const opener = document.activeElement;
    field.current?.focus();
    return () => {
      if (opening.current) return;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  function accept() {
    if (verdict.kind === "open") {
      opening.current = true;
      onOpen(verdict.path);
      return;
    }
    // `empty` and `blocked` name no note, and the hint line already says so.
    if (verdict.kind !== "create") return;
    // Enter repeats while it is held, and each repeat would be another POST.
    // The vault refuses the duplicates, but only the first answer opens a note.
    if (creating.current) return;
    creating.current = true;

    void createNote(verdict.path).then(
      (path) => {
        opening.current = true;
        // The vault's spelling of the path, not the typed one, everywhere from
        // here on. The note was just written empty, so seeding the cache saves
        // the editor a read of a file we already know the text of.
        queryClient.setQueryData(["note", path], "");
        queryClient.invalidateQueries({ queryKey: ["files"] });
        onOpen(path);
      },
      // The prompt stays open with the typed path still in it, so a create that
      // bounced off a stale listing or a dead network costs no typing, and the
      // guard lifts so the next Enter tries again.
      () => {
        creating.current = false;
        setFailed(true);
      },
    );
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
      aria-label="New note"
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
            new note
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
          {failed ? "could not create the note" : hint(verdict)}
        </output>
      </div>
    </div>
  );
}
