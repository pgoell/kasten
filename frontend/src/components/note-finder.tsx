import { useEffect, useId, useMemo, useRef, useState } from "react";
import { noteCandidates, rankCandidates } from "@/lib/fuzzy";

interface NoteFinderProps {
  /** Every path in the vault, ranked against what has been typed. */
  paths: string[];
  /** Called with the note to open. */
  onOpen: (path: string) => void;
  onClose: () => void;
}

/** Rows the list will mount. Beyond this, another keystroke narrows faster than a scroll. */
const VISIBLE_NOTES = 20;

/**
 * What the line under the list says, and nothing where it has nothing to say.
 *
 * An empty list has two reasons and they are not the same problem: a vault with
 * nothing in it yet, and a query that reads into none of what is there.
 */
function hint(vaultSize: number, matches: number): string {
  if (vaultSize === 0) return "the vault has no notes";
  return matches === 0 ? "no notes match" : "";
}

/**
 * Type a few letters of a note's name, and Enter opens it.
 *
 * The other way round from the note prompt, which is why it is a component of
 * its own rather than a fourth mode of that one. There the input is the answer
 * and the list completes it; here the list is the answer and the input only
 * filters it. Enter takes the highlighted row whatever the input says, so
 * nothing typed here has to name a path, and nothing here ever writes.
 */
export function NoteFinder({ paths, onOpen, onClose }: NoteFinderProps) {
  const [query, setQuery] = useState("");
  /** Which note Enter would open. */
  const [active, setActive] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  /** Set once a note is on its way open, and the focus then belongs to the editor. */
  const opening = useRef(false);
  const listId = useId();

  const typed = query.trim();
  // Two memos rather than one, because the candidate set follows the vault and
  // not the query. Keyed on `paths` alone it survives every keystroke, which
  // takes preparing 10,000 paths off the typing path entirely. That asks one
  // thing of the caller: hand over the same array each render. The route passes
  // what the query cache holds, and a listing filtered or sorted at the call
  // site would be a new array every time and undo all of this.
  const candidates = useMemo(() => noteCandidates(paths), [paths]);
  // Ranked over the whole vault and cut afterwards, so the rows on screen are
  // the best of it rather than the first slice of it. An empty query matches
  // everything, so without the cut a keystroke reconciles one button per note
  // in the vault, which is most of what it would cost.
  const notes = useMemo(
    () => rankCandidates(candidates, typed).slice(0, VISIBLE_NOTES),
    [candidates, typed],
  );
  // A fresh listing from the tree can shorten the list under the highlight.
  // Typing cannot: it puts the highlight back on the first row.
  const cursor = Math.min(active, Math.max(notes.length - 1, 0));
  const highlighted = notes[cursor];

  // The input takes the focus so the keys reach it rather than whatever was
  // focused when it opened, and hands it back on the way out. Restoring what
  // held it beats naming the editor: the same finder opens from the file tree,
  // and closing there belongs back in the tree.
  //
  // Opening a note is the exception. The editor that mounts behind the finder
  // takes the focus only when nobody holds it, so handing it back there leaves
  // a note you have to click before you can write in it.
  useEffect(() => {
    const opener = document.activeElement;
    field.current?.focus();
    return () => {
      if (opening.current) return;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  /** Open the highlighted note, which is the only thing Enter and a click do. */
  function accept(path: string | undefined) {
    // Nothing ranked means nothing to open, and the line underneath already
    // says which of the two reasons it is.
    if (path === undefined) return;
    opening.current = true;
    onOpen(path);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const down = event.key === "ArrowDown" || (event.ctrlKey && event.key === "n");
    const up = event.key === "ArrowUp" || (event.ctrlKey && event.key === "p");

    if (down || up) {
      if (notes.length === 0) return;
      // Without this the arrows take the caret to one end of the input, which
      // is where the browser sends them when nothing else does.
      event.preventDefault();
      setActive(down ? Math.min(cursor + 1, notes.length - 1) : Math.max(cursor - 1, 0));
      return;
    }

    switch (event.key) {
      case "Enter":
        event.preventDefault();
        accept(highlighted);
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
      aria-label="Find note"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-20 flex items-start justify-center bg-black/50 pt-[15vh] focus:outline-none"
    >
      <div className="flex max-h-[70vh] w-[min(36rem,90vw)] flex-col rounded-md border border-one-line bg-one-panel font-mono shadow-xl">
        <div className="flex items-center gap-3 border-b border-one-line px-3 py-2">
          <label
            htmlFor={`${listId}-query`}
            className="text-[11px] tracking-wider text-one-muted uppercase"
          >
            find note
          </label>
          <input
            id={`${listId}-query`}
            ref={field}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            role="combobox"
            aria-expanded={notes.length > 0}
            aria-controls={listId}
            aria-activedescendant={notes.length > 0 ? `${listId}-${cursor}` : undefined}
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-one-fg outline-none"
          />
        </div>

        {notes.length > 0 && (
          // A div rather than a list, because a listbox is not a list of items
          // to a screen reader and marking it as both says it twice.
          <div id={listId} role="listbox" aria-label="Notes" className="overflow-auto py-1">
            {notes.map((note, index) => (
              <button
                key={note}
                id={`${listId}-${index}`}
                type="button"
                role="option"
                aria-selected={index === cursor}
                // Out of the tab order, because the focus stays in the input and
                // the highlight is how the list says what Enter would open. A
                // click still lands here, and opens the same note.
                tabIndex={-1}
                onClick={() => accept(note)}
                className={`w-full cursor-pointer px-3 py-[3px] text-left text-[13px] ${
                  index === cursor ? "bg-one-hover text-one-accent" : "text-one-fg"
                }`}
              >
                {note}
              </button>
            ))}
          </div>
        )}

        {/* An <output> rather than a <p role="status">: same announcement, and
            the element carries it without the attribute. */}
        <output className="border-t border-one-line px-3 py-1 text-[11px] text-one-muted">
          {hint(paths.length, notes.length)}
        </output>
      </div>
    </div>
  );
}
