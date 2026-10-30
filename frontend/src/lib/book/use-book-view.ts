import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type TocRow, tocRows } from "@/components/book-contents";
import { type BookBeside, fetchNote } from "@/lib/api";
import { pageStyles } from "@/lib/book/book-backing";
import { trackPages } from "@/lib/book/book-pages";
import { closeView, type FoliateView, isError, pdfLayer } from "@/lib/book/foliate-view";
import type { BookHighlights } from "@/lib/book/use-book-highlights";
import type { BookTake } from "@/lib/book/use-book-take";
import type { BookTurns } from "@/lib/book/use-book-turns";
import { readField } from "@/lib/note-frontmatter";
import { onThemeChange } from "@/lib/theme";

/**
 * Opens a book in foliate, and keeps the reader's place and the view in step.
 *
 * Owns the view's life: built and opened in an effect keyed on the bytes and the
 * note, and closed on the way out. Reports the place the reader moves to, and
 * whether the book could be read at all.
 */
export function useBookView(o: {
  host: RefObject<HTMLDivElement | null>;
  viewRef: RefObject<FoliateView | null>;
  ready: RefObject<boolean>;
  beside: BookBeside | undefined;
  note: string;
  onFocus: () => void;
  onMoved: (cfi: string) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  repaint: BookHighlights["repaint"];
  watchPage: BookHighlights["watchPage"];
  select: BookTake["select"];
  follow: BookTake["follow"];
  forgetUnless: BookTake["forgetUnless"];
  tap: BookTurns["tap"];
  release: BookTurns["release"];
  forget: BookTurns["forget"];
  resumeSeek: () => boolean;
}): {
  broken: boolean;
  progress: number | null;
  /** The contents entry the reader is inside, or null where the book names none. */
  chapter: { id: number | undefined; label: string } | null;
  /** The book's contents, flattened, once the book has opened. */
  rows: TocRow[];
} {
  const {
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
  } = o;
  /** Whether foliate could not read what the vault handed it. */
  const [broken, setBroken] = useState(false);
  /** How far through the book the page is, or null while there is no honest number. */
  const [progress, setProgress] = useState<number | null>(null);
  const [chapter, setChapter] = useState<{ id: number | undefined; label: string } | null>(null);
  const [rows, setRows] = useState<TocRow[]>([]);

  // Read through refs, so the view is not rebuilt when the route's callbacks
  // take new identities. Written in a layout effect, which runs in the commit's
  // own task: a relocate heard between the commit and the passive effects would
  // otherwise write the place through the `onMoved` before, which holds the old
  // path.
  const onFocusRef = useRef(onFocus);
  const onMovedRef = useRef(onMoved);
  useLayoutEffect(() => {
    onFocusRef.current = onFocus;
    onMovedRef.current = onMoved;
  });

  /** That a click or a Tab landed in the book, which no ancestor is told. */
  const report = useCallback(() => onFocusRef.current(), []);

  useEffect(() => {
    const element = host.current;
    // An empty file is a book foliate throws `NotFoundError` for, which reads
    // as a broken library rather than as an empty file. Refused up here.
    if (element === null || beside === undefined || beside.blob.size === 0) return;

    setBroken(false);
    setChapter(null);
    setRows([]);
    let cancelled = false;
    const view = document.createElement("foliate-view") as FoliateView;
    // The mark is drawn at the token's own alpha, not at foliate's .3 of it. The
    // overlay sits in the paginator's shadow root, and a custom property crosses
    // that boundary, so setting it on the view reaches the overlay.
    view.style.setProperty("--overlayer-highlight-opacity", "1");
    viewRef.current = view;
    element.append(view);

    const pages = trackPages(
      view,
      { keydown: onKeyDown, report, selectionchange: onSelectionChange, click: tap },
      { arrived: forgetUnless, watch: (doc) => watchPage(doc, view) },
    );

    function onSelectionChange(event: Event) {
      const doc = event.currentTarget as Document;
      // A pre-paginated **epub** breaks three of the take's assumptions at
      // once: a spread shows two documents, the location names one side and
      // carries no range, and foliate scales both frames with a css transform
      // (`fixed-layout.js:137`), which no rectangle out of the frame survives.
      //
      // A pdf goes through the same renderer and breaks none of them. It is
      // scaled inside the document rather than outside it, `transform: 'none'`
      // on that same line, so a rectangle in the frame is a rectangle on the
      // page; the passage records the words rather than the location; and the
      // selection names which of the two documents it is in, which is the one
      // this is being told about.
      if (view.isFixedLayout && pdfLayer(doc) === null) return;

      select(doc, () => pages.chapterOf(doc));
    }

    function onOverlay() {
      // The defer is load-bearing, and the pass fails silently without it.
      // foliate emits `create-overlay` from inside `#createOverlayer`, before
      // `attach` has hung the overlay on the view (`view.js:264-265, :418`), so
      // a handler reading `getContents()` here finds the right section with no
      // overlay on it and draws nothing at all, which looks exactly like a book
      // holding no highlights. Everything from the emit through `attach` is one
      // unbroken stretch of synchronous code (`paginator.js:989-995`), so a
      // microtask is guaranteed to see the overlay.
      queueMicrotask(() => {
        // A pane closed between the two draws nothing, the way `draw()` checks
        // its own `cancelled` flag.
        if (viewRef.current !== view) return;
        repaint();
      });
    }
    view.addEventListener("create-overlay", onOverlay);

    // The renderer `open` builds, held so the cleanup takes the listener off
    // the object it put it on. `close()` leaves the property in place
    // (`view.js:297-299`), so the two are the same thing either way.
    let renderer: FoliateView["renderer"];
    /** Where the reader was last reported to be, which the first move is not. */
    let last: string | undefined;

    function onRelocate(event: Event) {
      const { reason, index, range } = (
        event as CustomEvent<{ reason?: string; index: number; range: Range | null }>
      ).detail;
      // Read off the view rather than off the event, and set before the two
      // returns below. The event's own `fraction` is how far through the
      // section the page is; the whole-book number is worked out one layer up
      // (`view.js:329-337`, `progress.js:74-98`), by a listener the view
      // registered before it opened the book and which therefore runs first.
      // The returns exist to keep a re-render from writing a bookmark, and
      // neither is a reason to leave the footer where the page used to be.
      const fraction = view.lastLocation?.fraction;
      // The `typeof` is not decoration: `Number.isFinite` takes `unknown` and
      // narrows nothing, so the multiply below would not compile without it.
      setProgress(typeof fraction === "number" && Number.isFinite(fraction) ? fraction : null);
      // Set ahead of the returns below for the same reason as the progress: a
      // page that moved to another chapter is a page that moved, whatever the
      // reason the renderer gave.
      const item = view.lastLocation?.tocItem;
      setChapter(item ? { id: item.id, label: (item.label ?? "").trim() } : null);

      follow();

      // `anchor` is a re-render at the place you were already at, which is what
      // a resize of the pane produces, and `selection` is the page moving to
      // show what you selected. Neither is somewhere you turned to. Everything
      // else is, `navigation` included: turning past the end of a chapter goes
      // through `#goTo` and arrives as that rather than as `page`.
      //
      // Refused by name rather than allowed by name, on purpose. A scrolled
      // flow's keyboard turn carries no reason at all and so does a fixed
      // layout jump, so an allowlist of the three reasons foliate itself calls
      // movement would drop a page turn with no way to see it.
      if (reason === "anchor" || reason === "selection") return;

      // The detail carries no cfi (`paginator.js:960-969`), so the pane builds
      // one with the view's own reading of the index and range it was handed.
      const cfi = view.getCFI(index, range);
      // A turn that moved nothing still reports: `#scrollTo` fires its relocate
      // when the offset it was given is the offset it is already at, which is
      // what a touch fling settling on the same page does.
      if (cfi === last) return;
      const first = last === undefined;
      last = cfi;
      // The first move left is the navigation `init` performs, which is either
      // the place just restored or the front of the book, and neither is
      // somewhere you turned to. Reporting it would write the note on every
      // open, and with a string that differs from the one on disk even when the
      // page is the same.
      if (!first) onMovedRef.current(cfi);
    }

    // `View.open` takes a `File` and calls `makeBook` itself, so kasten imports
    // nothing of the library but the module. Built out here because a hoisted
    // function body does not see the narrowing the guard above did.
    const file = new File([beside.blob], beside.path);

    async function draw() {
      try {
        await view.open(file);
        // Not a bare return: the cleanup already ran while `open` was in
        // flight, and there was neither a renderer nor a book to free then.
        // This is the close that actually frees both.
        if (cancelled) {
          closeView(view);
          return;
        }
        // Where the reader stopped, which is one line of the note's own block.
        // A two-arm `then` and not a catch: a book whose note the vault will
        // not answer for is still a book you can read, and drawing
        // `No book at ...` over a working epub because a `GET` blipped would be
        // a lie. So the failure arm answers with no text and the book opens at
        // the front.
        const text = await fetchNote(note).then(
          (held) => held,
          () => "",
        );
        // On the renderer and not on the view, and this is the one thing here
        // most likely to be built wrong. The view re-emits its renderer's
        // `relocate` without the `reason` (`view.js:329-337`), and without the
        // reason there is no telling a page turn from a re-render: the
        // paginator's own `ResizeObserver` re-renders through `#scrollToAnchor`
        // (`paginator.js:430, 754-761`), so folding the tree or resizing the
        // window would write a bookmark with nobody having moved.
        renderer = view.renderer;
        renderer?.addEventListener("relocate", onRelocate);
        // A flowing book is one column of scrolled text at the reading measure,
        // so `j` and `k` move it a few lines at a time. A pdf and a pre-paginated
        // epub keep the page they were drawn on: a scroll there has no text to
        // move in one piece.
        if (!view.isFixedLayout) {
          const measure = getComputedStyle(document.documentElement)
            .getPropertyValue("--k-measure")
            .trim();
          view.renderer?.setAttribute("flow", "scrolled");
          view.renderer?.setAttribute("max-inline-size", measure);
        }
        setRows(tocRows(view.book?.toc));
        // The `?.` is load-bearing. foliate swaps in `fixed-layout.js` for a
        // pre-paginated book and that renderer has no `setStyles`, so a plain
        // call throws on a valid epub.
        view.renderer?.setStyles?.(pageStyles());
        // Not optional. `View.open` builds the renderer and mounts it but
        // navigates nowhere, so a pane that stops above draws a blank page and
        // every key looks broken. Undefined is the front of the book, which is
        // what `init` falls through to.
        try {
          await view.init({ lastLocation: readField(text, "reading") });
        } catch (error_) {
          // A stale bookmark, not a broken book. A cfi naming a spine item this
          // book has and a node path that chapter has not loads the section and
          // then throws out of `anchor(doc)`, and the reader is left at the top
          // of the chapter the cfi named, which beats the front of the book.
          // Anything that is not an error came from somewhere this cannot
          // report on.
          if (!isError(error_)) throw error_;
        }
        // The pane went away while that was in flight. Checked here as well as
        // after `open`, or the fallback below builds a view over a closed one.
        if (cancelled) {
          closeView(view);
          return;
        }
        // Nothing rendered at all, so nothing loaded. That is the other stale
        // bookmark: a cfi naming a spine item this book has not got resolves to
        // `{ index: -1 }`, which `init` takes and the renderer then refuses, so
        // `init`'s own front-of-book branch never runs and the pane draws a
        // blank page. Only that shape reaches here, because any section that
        // loads at all fills `lastLocation` through the load-time expand
        // (`paginator.js:272-280, 409, 673`), which is why the catch above and
        // not this line is what answers the throw.
        if (!view.lastLocation) await view.init({});
        if (cancelled) {
          closeView(view);
          return;
        }
        // Last, and after the `cancelled` check: the bookmark has landed by
        // now, so a passage parked while the book was opening goes on top of
        // it rather than under it. `data-ready` is that moment where a test sees it.
        ready.current = true;
        element?.setAttribute("data-ready", "");
        const parked = resumeSeek();
        release(view, parked);
      } catch (error_) {
        // Every way a book fails to open arrives as an error: a `NotFoundError`
        // from foliate, a throw from the zip reader for a file that is not an
        // archive, the retry above failing too. Anything else came from
        // somewhere this cannot report on.
        if (!isError(error_)) throw error_;
        if (!cancelled) setBroken(true);
      }
    }
    // The page's colours are read when they are set, so a switch sets them
    // again. Before the renderer exists the `?.` skips, and `draw` reads the
    // theme as it sets the first ones.
    const retheme = onThemeChange(() => view.renderer?.setStyles?.(pageStyles()));
    void draw();

    return () => {
      cancelled = true;
      retheme();
      view.removeEventListener("create-overlay", onOverlay);
      renderer?.removeEventListener("relocate", onRelocate);
      pages.dispose();
      viewRef.current = null;
      // The next view opens a book of its own, so a passage the last one was
      // ready for is not a passage this one is.
      ready.current = false;
      element.removeAttribute("data-ready");
      forget();
      closeView(view);
      view.remove();
    };
    // The callbacks above are `useCallback`s whose identities are fixed, so
    // naming them here rebuilds nothing.
  }, [
    beside,
    follow,
    forget,
    forgetUnless,
    host,
    note,
    onKeyDown,
    ready,
    release,
    repaint,
    report,
    resumeSeek,
    select,
    tap,
    viewRef,
    watchPage,
  ]);

  return { broken, progress, chapter, rows };
}
