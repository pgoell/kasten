import { skipToken, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { NotePreview } from "@/components/note-preview";
import { fetchNote } from "@/lib/api";
import { bookNoteOf, type FileKind, fileKind } from "@/lib/file-kind";
import { noteCandidates, rankCandidates } from "@/lib/fuzzy";
import { noteName } from "@/lib/note-path";
import {
  BACKDROP,
  BODY,
  closeOnBackdrop,
  HEADER_ROW,
  INPUT,
  LABEL,
  LIST,
  PANE,
  PANE_MESSAGE,
  PANEL,
  PANEL_NARROW,
  PANEL_WIDE,
  ROW,
  STATUS,
  TAP,
} from "@/lib/overlay-styles";
import { useViewport } from "@/lib/use-viewport";

interface NoteFinderProps {
  /** The notes to rank against what has been typed. Usually the whole vault. */
  paths: string[];
  /** Called with the note to open. */
  onOpen: (path: string) => void;
  onClose: () => void;
  /** Set when `paths` is one note's links, not the vault: changes the title and empty hint. */
  outgoing?: boolean;
  /**
   * The vault's assets, which makes this the book finder over the notes in `paths` with an epub
   * beside them. `paths` still decides what is listed, so the archive stays out.
   */
  books?: string[];
  /** The vault's pdfs, epubs and html pages, ranked with the notes. The book finder ignores it. */
  files?: string[];
  /** Every note, archive included. An epub's preview checks this list, as the opener does. */
  vaultNotes?: string[];
}

/** Rows the list will mount. Beyond this, another keystroke narrows faster than a scroll. */
const VISIBLE_NOTES = 20;

/** The highlight holds this long before its note is read, so a held ctrl+n skips rows unread. */
const PREVIEW_DELAY_MS = 80;

/** The line under the list. An empty list has two causes: nothing to list, or no match. */
function hint(listed: number, matches: number, outgoing: boolean, book: boolean): string {
  if (listed === 0) {
    if (book) return "the vault has no books";
    return outgoing ? "this note links nowhere" : "the vault has no notes";
  }
  if (matches > 0) return "";
  return book ? "no books match" : "no notes match";
}

/**
 * The notes in `paths` with an epub beside them, paired as the backend's `resolve_book` does,
 * suffix and case alike. A pdf is a document, not a book (`note-path.ts`), so it stays out.
 */
function withBooks(paths: string[], books: string[]): string[] {
  const epubs = new Set(books);
  return paths.filter((path) => path.endsWith(".md") && epubs.has(`${path.slice(0, -3)}.epub`));
}

/** A file is opened, not read, so its preview names where it goes rather than its text. */
function fileOpens(kind: FileKind, noted: boolean): string {
  if (kind === "pdf") return "pdf, opens in the pdf pane";
  if (kind === "html") return "html, opens as a page";
  return noted ? "epub, opens in the reader" : "epub, opens in a new tab";
}

/** The folder a book sits in, and nothing for one at the vault's root. */
function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/**
 * What the pane says when it has no note. An unreadable note still opens from its row, since the
 * editor answers that. An empty note is not an error, and a spinner that never stops is worse.
 */
function previewText(status: "pending" | "error"): string {
  return status === "error" ? "could not read this note" : "reading the note";
}

/**
 * Type a few letters of a name; Enter opens the highlighted row. The list is the answer and the
 * input only filters it, unlike the note prompt. `outgoing` shortens it; `books` drops the preview.
 */
export function NoteFinder({
  paths,
  onOpen,
  onClose,
  outgoing = false,
  books,
  files,
  vaultNotes,
}: NoteFinderProps) {
  const book = books !== undefined;
  const [query, setQuery] = useState("");
  /** Which note Enter would open. */
  const [active, setActive] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  /** Set once a note is on its way open, and the focus then belongs to the editor. */
  const opening = useRef(false);
  const listId = useId();

  const typed = query.trim();
  // Candidates follow the vault, not the query, so they are keyed on `paths` alone. The caller
  // must pass the same array each render, or every keystroke prepares the vault again.
  const listed = useMemo(() => {
    if (books !== undefined) return withBooks(paths, books);
    // Files join the notes so one ranking covers both.
    return files === undefined ? paths : [...paths, ...files];
  }, [paths, books, files]);
  const noted = useMemo(() => new Set(vaultNotes), [vaultNotes]);
  const candidates = useMemo(() => noteCandidates(listed), [listed]);
  // Ranked over the whole vault, then cut: an empty query matches every note, and a button each
  // is most of the cost. Books go uncut: a shelf is tens, and one past the cut would be lost.
  const notes = useMemo(() => {
    const ranked = rankCandidates(candidates, typed);
    return book ? ranked : ranked.slice(0, VISIBLE_NOTES);
  }, [candidates, typed, book]);
  // A fresh listing can shorten the list under the highlight; typing resets it to the first row.
  const cursor = Math.min(active, Math.max(notes.length - 1, 0));
  const highlighted = notes[cursor];

  // Trails the highlight, so walking the list costs one read, not one per row.
  const [reading, setReading] = useState<string>();

  // No preview in a narrow window or for a book: neither has a pane for one.
  const { narrow } = useViewport();
  const previewing = !narrow && !book;

  // A file is never read as a note, so a file row holds no read either.
  const kind = highlighted === undefined ? undefined : fileKind(highlighted);

  useEffect(() => {
    if (!previewing || highlighted === undefined || fileKind(highlighted) !== undefined) {
      setReading(undefined);
      return;
    }
    const timer = setTimeout(() => setReading(highlighted), PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [highlighted, previewing]);

  // The same key `NoteEditor` reads, so an open note is already cached and Enter does not fetch it
  // again. `skipToken` says there is nothing to ask for without lying to the types about the path.
  const note = useQuery({
    queryKey: ["note", reading],
    queryFn: reading === undefined ? skipToken : () => fetchNote(reading),
    // Walking back up must not re-read; staleness is per observer, so `NoteEditor` still fetches.
    staleTime: 30_000,
    // A preview nobody asked for gets no retries; opening the row asks properly.
    retry: false,
  });

  // Restore the opener's focus on close, since the file tree opens this finder too.
  // Not when a note opens: the editor takes focus only when nobody holds it.
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
    // Nothing ranked, nothing to open: the hint line says why.
    if (path === undefined) return;
    opening.current = true;
    onOpen(path);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    // Tab walks the list, since nothing completes; Enter opens the highlight whatever the input
    // says. Ctrl+J and Ctrl+K are vim's j and k; bare keys are letters of a name.
    const tab = event.key === "Tab";
    const ctrl = (key: string) => event.ctrlKey && event.key === key;
    const down = event.key === "ArrowDown" || (tab && !event.shiftKey) || ctrl("n") || ctrl("j");
    const up = event.key === "ArrowUp" || (tab && event.shiftKey) || ctrl("p") || ctrl("k");

    if (down || up) {
      // Prevent before the empty check: arrows would move the caret, and Tab would leave for good.
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
    // The dialog reads the keys, so they still land after a click moves focus to a row or backdrop.
    <div
      role="dialog"
      aria-modal="true"
      aria-label={book ? "Find book" : outgoing ? "Outgoing links" : "Find note"}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      {...closeOnBackdrop(onClose)}
      className={BACKDROP}
    >
      {/* One column for books, which have no pane to sit beside. */}
      <div className={`${PANEL} ${book ? PANEL_NARROW : PANEL_WIDE}`}>
        <div className={HEADER_ROW}>
          <label htmlFor={`${listId}-query`} className={LABEL}>
            {book ? "find book" : outgoing ? "links out" : "find note"}
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

        {/* A fixed height, so the pane does not jump as the list narrows. Books have no pane and
            take what they need. */}
        <div className={book ? "flex min-h-0" : BODY}>
          {notes.length > 0 && (
            // A div, not a list: a screen reader would announce a listbox marked as both twice.
            <div
              id={listId}
              role="listbox"
              aria-label={book ? "Books" : "Notes"}
              className={book ? "w-full overflow-auto py-1" : LIST}
            >
              {notes.map((path, index) => {
                const rowKind = fileKind(path);
                return (
                  <button
                    key={path}
                    id={`${listId}-${index}`}
                    type="button"
                    role="option"
                    aria-selected={index === cursor}
                    // Out of the tab order: focus stays in the input; a click still opens it.
                    tabIndex={-1}
                    onClick={() => accept(path)}
                    className={`${ROW} ${TAP} ${book || rowKind !== undefined ? "flex gap-3" : "truncate"} ${
                      index === cursor ? "bg-k-surface text-k-accent" : "text-k-ink"
                    }`}
                  >
                    {book ? (
                      // The folder, dimmed. It gives way first: an even split clipped short names
                      // on a phone.
                      <>
                        <span className="max-w-full shrink-0 truncate">{noteName(path)}</span>
                        <span className="ml-auto min-w-0 truncate text-k-muted">
                          {folderOf(path)}
                        </span>
                      </>
                    ) : rowKind === undefined ? (
                      path
                    ) : (
                      // The kind, dimmed like a book's folder: it only says what Enter opens.
                      <>
                        <span className="min-w-0 truncate">{path}</span>
                        <span className="ml-auto shrink-0 text-k-muted">
                          {rowKind.toUpperCase()}
                        </span>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {previewing && highlighted !== undefined && (
            // Rendered as the editor renders it, so it matches what opening shows; the delay keeps
            // the dropped frame per mount to rows you stop on. A section, as a pre cannot be named.
            <section aria-label="Preview" data-testid="preview" className={PANE}>
              {kind !== undefined && highlighted !== undefined ? (
                <p className={PANE_MESSAGE}>
                  {fileOpens(kind, noted.has(bookNoteOf(highlighted)))}
                </p>
              ) : note.status === "success" ? (
                // Keyed on the path, so opening another note builds a fresh view.
                <NotePreview key={reading} text={note.data} />
              ) : (
                <p className={PANE_MESSAGE}>{previewText(note.status)}</p>
              )}
            </section>
          )}
        </div>

        {/* An <output>: a live status with no role attribute needed. */}
        <output className={STATUS}>{hint(listed.length, notes.length, outgoing, book)}</output>
      </div>
    </div>
  );
}
