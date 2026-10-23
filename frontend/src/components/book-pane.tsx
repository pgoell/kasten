import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ContentsColumn, NoteColumn } from "@/components/book-columns";
import { BookContents, type TocRow, tocRows } from "@/components/book-contents";
import { useBookNoteTake } from "@/components/use-book-note-take";
import { fetchBook } from "@/lib/api";
import type { FoliateView } from "@/lib/foliate-view";
import type { Passage } from "@/lib/highlight";
import type { EditorCommands } from "@/lib/key-bindings";
import { BOOK_SUFFIXES, noteName } from "@/lib/note-path";
import { useBookHighlights } from "@/lib/use-book-highlights";
import { useBookKeys } from "@/lib/use-book-keys";
import { useBookSeek } from "@/lib/use-book-seek";
import { useBookTake } from "@/lib/use-book-take";
import { useBookTurns } from "@/lib/use-book-turns";
import { useBookView } from "@/lib/use-book-view";
import { useViewport } from "@/lib/use-viewport";

/** The reading measure the text is set at, in px (`--k-measure`). */
const MEASURE = 680;
/**
 * The gap foliate pads each side of the scrolled flow by, as a share of the
 * host's width (`paginator.js:292` and `:718`, 7/93 on each side). So the text
 * column is the host less 14% of it, and the host must be `MEASURE / 0.86` wide
 * before the text reaches the measure.
 */
const FLOW_GAP = 0.07;
/** The side columns' widths in px, which are `w-56` and `w-72`. */
const CONTENTS_WIDTH = 224;
const NOTE_WIDTH = 288;
/** The narrowest host the text reaches the measure in, rounded up to a whole px. */
const HOST_FOR_MEASURE = Math.ceil(MEASURE / (1 - 2 * FLOW_GAP));
/**
 * The pane widths at which each column appears: the host the measure needs,
 * plus the columns beside it. Below the first the text has the whole pane,
 * which is the phone's layout too.
 */
const CONTENTS_FROM = HOST_FOR_MEASURE + CONTENTS_WIDTH;
const NOTE_FROM = CONTENTS_FROM + NOTE_WIDTH;

/**
 * The button drawn over a selection, which is the mouse's half of `y`.
 *
 * The transform puts its middle over the middle of the words and its bottom
 * edge on their top, so the placement is one rule rather than "above and to the
 * left". `h-6` is 24px and the label makes it about 40px wide, which is what
 * `INSET` in `use-book-take.ts` is measured against.
 */
const TAKE =
  "absolute flex h-6 -translate-x-1/2 -translate-y-full items-center rounded border border-k-rule bg-k-paper px-2 font-sans text-k-ink text-xs";

/**
 * A button in the footer, which is where a finger finds what a key does.
 *
 * `min-h-11` is the 44px a fingertip needs. The footer and not the page for
 * `Take` as well: the phone draws its own copy menu over a selection and its
 * handles under it, which is where the mouse's button floats.
 */
const TOUCH = "min-h-11 rounded border border-k-muted px-3 font-sans text-k-ink text-xs";

interface BookPaneProps {
  /** The note this reads beside. The vault answers which file sits with it. */
  note: string;
  /** Every note the vault holds, so the pane can see its own note leave. */
  paths?: string[];
  /** What a chord reaches. The route hands down the same object the editors get. */
  commands: EditorCommands;
  /** Raised when the pane this sits in has been moved to. See `Editor`. */
  focusSignal?: number;
  /**
   * Called when a click or a Tab lands inside the book. Neither reaches the
   * route on its own. It answers this the way it answers a click into any other
   * pane.
   */
  onFocus: () => void;
  /** Where the reader turned to, after every move but the one that opened the book. */
  onMoved: (cfi: string) => void;
  /** The pane is going away, so whatever it last reported should be written now. */
  onLeaving: () => void;
  /**
   * Writes a passage the reader took, by the button or by `y`, into the book's
   * note. Resolves to what the take says, which the toast shows.
   */
  onTake: (passage: Passage) => Promise<string | null>;
  /** Whether the archive is listed, which the take's note follows. */
  archive: boolean;
  /** Opens the book's note beside it, as the pdf pane's Note beside does. */
  onNoteBeside: () => void;
  /**
   * A passage `gf` asked for. A new object on every press, and cleared once taken.
   *
   * A prop rather than an imperative handle: the route owns what is open and
   * the pane owns the book, which is the division PR 2 set and PR 5 kept.
   */
  seek?: { quote: string[] };
  /** A sentence for the bar, when a passage the reader asked for is not in the book. */
  onNotice: (message: string) => void;
}

/**
 * One book in one pane, read beside the note it belongs to.
 *
 * Nothing stores the book's path: it is the note's with the suffix swapped, so
 * a folder move carries the pair and a rename of the note alone orphans the
 * book, which this says out loud.
 */
export function BookPane({
  note,
  paths,
  commands,
  focusSignal,
  onFocus,
  onMoved,
  onLeaving,
  onTake,
  archive,
  onNoteBeside,
  seek,
  onNotice,
}: BookPaneProps) {
  const wrapper = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  // A finger has no `t`, no `y` and no `l`, so a touch screen gets each of them
  // as something to tap. A mouse gets none of it.
  const { coarse } = useViewport();
  const viewRef = useRef<FoliateView | null>(null);
  /** The pane's own width, which decides the columns. Zero until measured, so the text has the pane. */
  const [width, setWidth] = useState(0);
  /** A passage the note column asked to seek, which the route's `seek` yields to once it is newer. */
  const [picked, setPicked] = useState<{ quote: string[] } | undefined>(undefined);
  /**
   * Whether the book has been navigated, which `view.book` does not say.
   *
   * `open()` assigns the book before it navigates anywhere
   * (`view.js:233-237`), so a seek testing that would jump and then have
   * `init` land the bookmark on top of the passage.
   */
  const ready = useRef(false);
  /** The book's chapters over the page, or null while the reader has the keys. */
  const [contents, setContents] = useState<{ rows: TocRow[]; start: number } | null>(null);
  // The same thing as a ref, because `onKeyDown` cannot read the state. The
  // effect that builds the view lists the handler in its dependencies, so a
  // handler with a new identity on every `t` would tear the book down and open
  // it again, losing the page.
  const contentsOpen = useRef(false);
  // Read through a ref, so a leave reads the callback as it is when the pane
  // goes. Written in a layout effect, which runs in the commit's own task.
  const onLeavingRef = useRef(onLeaving);
  useLayoutEffect(() => {
    onLeavingRef.current = onLeaving;
  });

  const noteTake = useBookNoteTake({ note, archive, onTake });
  /**
   * The place the button last stood at. A take clears the button before the
   * passage reaches the note, so the place it was taken from is read from here.
   */
  const lastAt = useRef<{ x: number; y: number } | null>(null);

  const { take, at, holding, forgetUnless, select, follow, press } = useBookTake({
    wrapper,
    onTake: (passage) => {
      // The toast goes to the top when the words sat in the lower half of the
      // pane, so it does not cover them.
      const spot = lastAt.current;
      const height = wrapper.current?.getBoundingClientRect().height ?? 0;
      void noteTake.take(passage, spot !== null && spot.y > height / 2);
    },
    onNotice,
  });
  useLayoutEffect(() => {
    if (at !== null) lastAt.current = at;
  });
  const { turn, tap, release, forget, scroll } = useBookTurns({
    wrapper,
    viewRef,
    ready,
    coarse,
    holding,
  });

  /**
   * Draw the book's contents over the page, for `t` and for the footer's button.
   *
   * No dependencies, for the reason `take` has none: `onKeyDown` names it.
   */
  const openContents = useCallback(() => {
    const book = viewRef.current?.book;
    // On the book and not on its toc. The view is in the ref from the moment
    // the element is built, which is a long way before `open` has unzipped a
    // 30MB epub, and an empty list drawn in that window would report a book
    // still loading as a book with no contents.
    if (book === undefined) return;
    contentsOpen.current = true;
    const rows = tocRows(book.toc);
    // foliate's own id, stamped on the toc items by `assignIDs` and handed
    // back on `lastLocation.tocItem`, so this is one number against another
    // rather than kasten matching labels. No match answers -1, which the
    // contents clamp to the first row.
    const current = viewRef.current?.lastLocation?.tocItem?.id;
    setContents({ rows, start: rows.findIndex((row) => row.id === current) });
  }, []);

  const onKeyDown = useBookKeys({
    wrapper,
    viewRef,
    commands,
    contentsOpen,
    turn,
    scroll,
    take,
    openContents,
  });

  /**
   * Put the contents away, and the cursor back on the pane.
   *
   * The wrapper and not whatever held the focus before: both of foliate's
   * shadow roots are closed, so that was the `<foliate-view>` host, and
   * focusing it puts the cursor on the element rather than back inside the
   * chapter. The wrapper answers every key the section document does.
   */
  function closeContents() {
    contentsOpen.current = false;
    setContents(null);
    wrapper.current?.focus();
  }

  /** Take the book to the chapter Enter or a click landed on. */
  function goToChapter(href: string) {
    // Neither awaited nor caught: `goTo` resolves the href itself and swallows
    // its own failures into `console.error` (`view.js:460-470`), so a bad href
    // is a no-op and there is nothing here to handle.
    void viewRef.current?.goTo(href);
    closeContents();
  }

  // A query rather than an effect, so two panes reading one book share the
  // bytes and so an upload has a key to invalidate. Keyed on the note, which is
  // the only half of the pair a pane holds: the vault answers which file is
  // beside it, and `w` and the bookmark's type read that answer back out of
  // this cache under the same key.
  const { data: beside, error } = useQuery({
    queryKey: ["book", note],
    queryFn: () => fetchBook(note),
  });

  // A take forgets the last book's toast and passage when the note or the book
  // bytes change, so a new book in the pane shows no old toast over it.
  const forgetTake = noteTake.forget;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new note or book bytes is what drops the take, and the body does not name either.
  useEffect(() => {
    forgetTake();
  }, [note, beside, forgetTake]);

  // The route's seek until the note column asks for a passage, and the column's
  // until the route asks for another. The route's is new whenever its identity
  // changes, which drops the column's.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `seek` is the trigger; a new route seek is what drops the column's passage, and the body does not read it.
  useEffect(() => {
    setPicked(undefined);
  }, [seek]);

  const { repaint, watchPage, blocks } = useBookHighlights(note, viewRef);

  const resumeSeek = useBookSeek({ seek: picked ?? seek, beside, onNotice, viewRef, ready });

  const { broken, progress, chapter, rows } = useBookView({
    host,
    viewRef,
    ready,
    beside,
    note,
    onFocus,
    onMoved,
    onKeyDown,
    repaint,
    watchPage,
    select,
    follow,
    forgetUnless,
    tap,
    release,
    forget,
    resumeSeek,
  });

  // Mount included, the way the editor and the terminal read the same prop: a
  // freshly split pane is created focused and its first render is the only
  // chance it gets to say so. An unfocused pane is handed 0 and stays put.
  //
  // Not optional in this slice, though the plan filed it under the next one:
  // splitting remounts the editor beside this pane, and that editor takes the
  // cursor back on mount when nothing else holds it. Without this the route
  // never believes the reader is the focused pane.
  useEffect(() => {
    if (focusSignal) wrapper.current?.focus();
  }, [focusSignal]);

  // The pane's own width, read here and not off the window, so each half of a
  // split decides its columns alone.
  useEffect(() => {
    const element = wrapper.current;
    if (element === null) return;
    const watch = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    watch.observe(element);
    return () => watch.disconnect();
  }, []);

  // One effect whose only job is its cleanup. Not folded into the view's, which
  // tears down whenever the file or the note changes and would then say this on
  // a rebuild rather than on the way out. The cleanup belongs to the mount
  // render, so it reads the callback off the ref at the moment it runs: closing
  // over the prop would flush against the note the pane held when it mounted,
  // which a folder move has since changed.
  useEffect(() => () => onLeavingRef.current(), []);

  // The listing having not arrived is not the same as the note being gone, so
  // an undefined `paths` says nothing.
  const orphaned = paths !== undefined && !paths.includes(note);
  const failed =
    broken || error !== null || orphaned || (beside !== undefined && beside.blob.size === 0);

  const percent = progress === null ? null : Math.round(progress * 100);

  return (
    // `tabIndex={-1}` so the wrapper can hold the cursor without joining the
    // tab order, the way `todo-pane.tsx` takes it.
    <div
      ref={wrapper}
      data-book-pane
      tabIndex={-1}
      className="relative flex h-full w-full flex-col outline-none"
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-k-rule px-3 py-1 font-sans text-k-13">
        <span className="shrink-0 text-k-12 tracking-wide text-k-muted uppercase">BOOK</span>
        <span className="min-w-0 flex-1 truncate font-mono text-k-ink" title={note}>
          {noteName(note)}
        </span>
        {chapter !== null && <span className="min-w-0 truncate text-k-muted">{chapter.label}</span>}
        <span className="shrink-0 text-k-muted tabular-nums">
          {percent === null ? "" : `${percent}%`}
        </span>
        {/* The same look as the pdf pane's Note beside, the one other way out of a pane. */}
        <button
          type="button"
          onClick={onNoteBeside}
          className="shrink-0 text-k-12 text-k-link hover:text-k-accent focus-visible:text-k-accent active:text-k-accent pointer-coarse:min-h-11"
        >
          {"The book's note"}
        </button>
      </header>
      <div className="flex min-h-0 flex-1">
        {width >= CONTENTS_FROM && (
          <ContentsColumn rows={rows} current={chapter?.id} onGo={goToChapter} />
        )}
        {/* `min-h-0` so the host takes the room the footer leaves rather than the
            room its own content wants: a paginator columnises to the box it is
            in, and a flex child that will not shrink draws its page off the
            bottom of the pane. */}
        {/* The toast is placed over this column and not the pane, so it sits over
            the text above the footer and never over the contents or the note. */}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div ref={host} className="min-h-0 min-w-0 flex-1" />
          {noteTake.toast}
        </div>
        {width >= NOTE_FROM && (
          <NoteColumn blocks={blocks} onSeek={(quote) => setPicked({ quote })} />
        )}
      </div>
      {/* Not `STATUS`: its 11 px is the overlays' size, and the book's labels are 12. */}
      <footer className="flex items-center gap-3 border-t border-k-rule px-3 py-1 font-sans text-k-12 text-k-muted">
        <span className="min-w-0 flex-1 truncate">{chapter?.label ?? ""}</span>
        <span className="shrink-0">{percent === null ? "" : `${percent}% of the book`}</span>
        {coarse && (
          <span className="flex shrink-0 gap-2">
            {at && (
              <button
                type="button"
                data-take
                {...press}
                onClick={() => void take()}
                className={TOUCH}
              >
                Take
              </button>
            )}
            <button type="button" onClick={openContents} className={TOUCH}>
              Contents
            </button>
          </span>
        )}
      </footer>
      {at && !coarse && (
        // No z-index, so the contents overlay at `z-10` covers it and takes the
        // clicks while it is open, which is the answer the key handler gives by
        // returning early.
        <button
          type="button"
          data-take
          onClick={() => void take()}
          style={{ left: at.x, top: at.y }}
          className={TAKE}
        >
          Take
        </button>
      )}
      {contents && (
        <BookContents
          rows={contents.rows}
          start={contents.start}
          onGo={goToChapter}
          onClose={closeContents}
        />
      )}
      {failed && (
        <div
          role="alert"
          className="absolute inset-0 flex items-center justify-center bg-k-bg p-6 text-center font-mono text-k-muted text-sm"
        >
          <p>
            Nothing to read beside <span className="text-k-ink">{note}</span>
            <br />
            {BOOK_SUFFIXES.join(" or ")} of the same name goes here
          </p>
        </div>
      )}
    </div>
  );
}
