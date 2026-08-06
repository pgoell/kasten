import { skipToken, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { NotePreview } from "@/components/note-preview";
import { fetchNote } from "@/lib/api";
import { noteCandidates, rankCandidates } from "@/lib/fuzzy";
import {
  BACKDROP,
  BODY,
  HEADER_ROW,
  INPUT,
  LABEL,
  LIST,
  PANE,
  PANE_MESSAGE,
  PANEL,
  PANEL_WIDE,
  ROW,
  STATUS,
} from "@/lib/overlay-styles";

interface NoteFinderProps {
  /** The notes to rank against what has been typed. Usually the whole vault. */
  paths: string[];
  /** Called with the note to open. */
  onOpen: (path: string) => void;
  onClose: () => void;
  /**
   * Whether `paths` is what one note links to rather than the whole vault.
   *
   * The list is the same list either way, so this only changes what the panel
   * calls itself and what it says about an empty one: a vault with nothing in
   * it and a note that links nowhere are not the same emptiness.
   */
  outgoing?: boolean;
}

/** Rows the list will mount. Beyond this, another keystroke narrows faster than a scroll. */
const VISIBLE_NOTES = 20;

/**
 * How long the highlight holds still before its note is read.
 *
 * A held ctrl+n walks a row per repeat, and every row it passes through would
 * otherwise be a request for a note nobody is looking at. Short enough that
 * stopping on a row feels like the text was already there.
 */
const PREVIEW_DELAY_MS = 80;

/**
 * What the line under the list says, and nothing where it has nothing to say.
 *
 * An empty list has two reasons and they are not the same problem: a vault with
 * nothing in it yet, and a query that reads into none of what is there.
 */
function hint(listed: number, matches: number, outgoing: boolean): string {
  if (listed === 0) return outgoing ? "this note links nowhere" : "the vault has no notes";
  return matches === 0 ? "no notes match" : "";
}

/**
 * Why the pane has no note to show, which is the only thing left for it to say.
 *
 * A note the vault holds but cannot be read is worth saying out loud, and it is
 * no reason to stop the row being opened: the editor gives its own answer, and
 * it is the one that matters. An empty note is not one of these, being empty
 * rather than missing, and a spinner that never stops is the worse of the two
 * lies.
 */
function previewText(status: "pending" | "error"): string {
  return status === "error" ? "could not read this note" : "reading the note";
}

/**
 * Type a few letters of a note's name, and Enter opens it.
 *
 * The other way round from the note prompt, which is why it is a component of
 * its own rather than a fourth mode of that one. There the input is the answer
 * and the list completes it; here the list is the answer and the input only
 * filters it. Enter takes the highlighted row whatever the input says, so
 * nothing typed here has to name a path, and nothing here ever writes.
 *
 * `outgoing` is the same panel over a shorter list: the notes one note links
 * to. Nothing about ranking, previewing or opening a note changes when the
 * list is twelve notes rather than the vault, which is why that is a mode of
 * this rather than a panel of its own.
 */
export function NoteFinder({ paths, onOpen, onClose, outgoing = false }: NoteFinderProps) {
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

  // The path the preview is reading, which trails the highlight rather than
  // following it. Held apart from `highlighted` because that is what makes
  // walking the list cost one read instead of one per row.
  const [reading, setReading] = useState<string>();

  useEffect(() => {
    if (highlighted === undefined) {
      setReading(undefined);
      return;
    }
    const timer = setTimeout(() => setReading(highlighted), PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [highlighted]);

  // The key `NoteEditor` reads, on purpose: a note that is open is already here
  // and costs nothing to show, and a note read here is one the editor will not
  // have to fetch when Enter opens it. `skipToken` is how a query with nothing
  // to ask for says so without lying to the types about the path.
  const note = useQuery({
    queryKey: ["note", reading],
    queryFn: reading === undefined ? skipToken : () => fetchNote(reading),
    // Walking back up the list must not re-read what was read on the way down.
    // Staleness is per observer, so this buys the pane its quiet and leaves
    // `NoteEditor` to fetch the note afresh when Enter actually opens it, which
    // is the read that has to be right.
    staleTime: 30_000,
    // A preview nobody asked for is not worth three attempts and a backoff. The
    // pane says it could not read the note, and opening the row asks properly.
    retry: false,
  });

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
    // Tab walks the list rather than completing anything, the way it does in a
    // terminal fuzzy finder. There is nothing here to complete: Enter opens the
    // row under the highlight whatever the input says.
    const tab = event.key === "Tab";
    const down =
      event.key === "ArrowDown" || (tab && !event.shiftKey) || (event.ctrlKey && event.key === "n");
    const up =
      event.key === "ArrowUp" || (tab && event.shiftKey) || (event.ctrlKey && event.key === "p");

    if (down || up) {
      // Without this the arrows take the caret to one end of the input, which
      // is where the browser sends them when nothing else does, and Tab takes
      // the focus out of the panel. Prevented before the empty list is checked,
      // because an empty list is where Tab would leave and not come back.
      event.preventDefault();
      if (notes.length === 0) return;
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
      aria-label={outgoing ? "Outgoing links" : "Find note"}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={BACKDROP}
    >
      <div className={`${PANEL} ${PANEL_WIDE}`}>
        <div className={HEADER_ROW}>
          <label htmlFor={`${listId}-query`} className={LABEL}>
            {outgoing ? "links out" : "find note"}
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
            className={INPUT}
          />
        </div>

        {/* A fixed height rather than one the content sets, so the pane does not
            jump about as the list narrows under it. */}
        <div className={BODY}>
          {notes.length > 0 && (
            // A div rather than a list, because a listbox is not a list of items
            // to a screen reader and marking it as both says it twice.
            <div id={listId} role="listbox" aria-label="Notes" className={LIST}>
              {notes.map((path, index) => (
                <button
                  key={path}
                  id={`${listId}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === cursor}
                  // Out of the tab order, because the focus stays in the input
                  // and the highlight is how the list says what Enter would
                  // open. A click still lands here, and opens the same note.
                  tabIndex={-1}
                  onClick={() => accept(path)}
                  className={`${ROW} truncate ${
                    index === cursor ? "bg-one-hover text-one-accent" : "text-one-fg"
                  }`}
                >
                  {path}
                </button>
              ))}
            </div>
          )}

          {highlighted !== undefined && (
            // Rendered the way the editor renders it, so the pane shows the
            // note as opening it will. It used to be plain text, on the
            // grounds that this pane is for telling two notes apart rather
            // than for reading one, and two notes with their syntax showing
            // are harder to tell apart, not easier. The cost is one dropped
            // frame per mount, and the delay above makes that once per row you
            // stop on rather than once per row you pass.
            // A labelled <section> rather than a bare <pre>, which takes no
            // label of its own and leaves the pane something a screen reader
            // can reach but not name.
            <section aria-label="Preview" data-testid="preview" className={PANE}>
              {note.status === "success" ? (
                // Keyed on the path so opening another note builds a fresh
                // view rather than reconfiguring this one.
                <NotePreview key={reading} text={note.data} />
              ) : (
                <p className={PANE_MESSAGE}>{previewText(note.status)}</p>
              )}
            </section>
          )}
        </div>

        {/* An <output> rather than a <p role="status">: same announcement, and
            the element carries it without the attribute. */}
        <output className={STATUS}>{hint(paths.length, notes.length, outgoing)}</output>
      </div>
    </div>
  );
}
