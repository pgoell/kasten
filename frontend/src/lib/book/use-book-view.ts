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
 * Opens a book in foliate and keeps the reader's place in step with the view.
 * Builds the view in an effect keyed on the bytes and the note; closes it on cleanup.
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

  // Read through refs, so the view is not rebuilt when the callbacks change identity.
  // Set in a layout effect, so a relocate before the passive effects sees the current `onMoved`.
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
    // An empty file makes foliate throw `NotFoundError`, which reads as a broken library.
    if (element === null || beside === undefined || beside.blob.size === 0) return;

    setBroken(false);
    setChapter(null);
    setRows([]);
    let cancelled = false;
    const view = document.createElement("foliate-view") as FoliateView;
    // Full alpha, not foliate's .3: the custom property crosses into the paginator's shadow root.
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
      // Skip a pre-paginated epub: spreads and css-scaled frames break the take (fixed-layout.js:137).
      // A pdf is scaled inside its frame, so it keeps the take.
      if (view.isFixedLayout && pdfLayer(doc) === null) return;

      select(doc, () => pages.chapterOf(doc));
    }

    function onOverlay() {
      // foliate emits create-overlay before attach hangs the overlay on the view (view.js:264-265, :418),
      // so the repaint waits a microtask (paginator.js:989-995).
      queueMicrotask(() => {
        // A pane closed in between draws nothing.
        if (viewRef.current !== view) return;
        repaint();
      });
    }
    view.addEventListener("create-overlay", onOverlay);

    // Kept so cleanup removes the listener from the renderer it was added to (view.js:297-299).
    let renderer: FoliateView["renderer"];
    /** Where the reader was last reported to be, which the first move is not. */
    let last: string | undefined;

    function onRelocate(event: Event) {
      const { reason, index, range } = (
        event as CustomEvent<{ reason?: string; index: number; range: Range | null }>
      ).detail;
      // Read off the view, not the event: the event's fraction is per section. The whole-book number
      // is set by a listener the view registers first (view.js:329-337, progress.js:74-98).
      const fraction = view.lastLocation?.fraction;
      // The typeof narrows: Number.isFinite does not, so the multiply below would not compile.
      setProgress(typeof fraction === "number" && Number.isFinite(fraction) ? fraction : null);
      // Set before the returns below: a chapter change is a move, whatever the reason.
      const item = view.lastLocation?.tocItem;
      setChapter(item ? { id: item.id, label: (item.label ?? "").trim() } : null);

      follow();

      // Refused by name: a scrolled keyboard turn has no reason, so an allowlist would drop it.
      // anchor re-renders the same place on resize; selection shows what you selected.
      if (reason === "anchor" || reason === "selection") return;

      // The detail has no cfi (paginator.js:960-969), so build one from the index and range.
      const cfi = view.getCFI(index, range);
      // A same-page relocate, such as a touch fling settling, still fires: drop it.
      if (cfi === last) return;
      const first = last === undefined;
      last = cfi;
      // The first move is init's own navigation, not a turn.
      // Reporting it would write the note on every open.
      if (!first) onMovedRef.current(cfi);
    }

    // View.open takes a File and makes the book, so kasten imports only the module.
    // Built here: a hoisted function body does not see the guard's narrowing of beside.
    const file = new File([beside.blob], beside.path);

    async function draw() {
      try {
        await view.open(file);
        // Not a bare return: cleanup ran during open, so this close frees the book.
        if (cancelled) {
          closeView(view);
          return;
        }
        // A failed read still opens the book, at the front: no error over a readable book.
        const text = await fetchNote(note).then(
          (held) => held,
          () => "",
        );
        // On the renderer: the view's relocate drops `reason`, and a resize re-render would
        // then look like a page turn (view.js:329-337, paginator.js:430).
        renderer = view.renderer;
        renderer?.addEventListener("relocate", onRelocate);
        // A flowing book scrolls a few lines at a time; a pdf or fixed-layout epub keeps its page.
        if (!view.isFixedLayout) {
          const measure = getComputedStyle(document.documentElement)
            .getPropertyValue("--k-measure")
            .trim();
          view.renderer?.setAttribute("flow", "scrolled");
          view.renderer?.setAttribute("max-inline-size", measure);
        }
        setRows(tocRows(view.book?.toc));
        // Load-bearing `?.`: fixed-layout.js has no setStyles, so a plain call throws on a valid epub.
        view.renderer?.setStyles?.(pageStyles());
        // Not optional: open() mounts the renderer but navigates nowhere, so init must run.
        try {
          await view.init({ lastLocation: readField(text, "reading") });
        } catch (error_) {
          // A stale bookmark throws after its chapter loads, leaving the reader at that chapter's top.
          // Anything that is not an Error came from somewhere this cannot report on, so rethrow it.
          if (!isError(error_)) throw error_;
        }
        // Checked again, or the fallback below builds a view over a closed one.
        if (cancelled) {
          closeView(view);
          return;
        }
        // Nothing rendered: a cfi naming a missing spine item gives { index: -1 }, which init leaves blank.
        // Any section that loads fills lastLocation (paginator.js:272-280), so only this shape gets here.
        if (!view.lastLocation) await view.init({});
        if (cancelled) {
          closeView(view);
          return;
        }
        // Last, after the cancelled check: a passage parked while opening lands on top of the bookmark.
        // data-ready is the point a test waits for.
        ready.current = true;
        element?.setAttribute("data-ready", "");
        const parked = resumeSeek();
        release(view, parked);
      } catch (error_) {
        // Every failed open arrives as an Error; anything else came from somewhere this cannot report on.
        if (!isError(error_)) throw error_;
        if (!cancelled) setBroken(true);
      }
    }
    // The colors are read when set, so each theme switch sets them again.
    const retheme = onThemeChange(() => view.renderer?.setStyles?.(pageStyles()));
    void draw();

    return () => {
      cancelled = true;
      retheme();
      view.removeEventListener("create-overlay", onOverlay);
      renderer?.removeEventListener("relocate", onRelocate);
      pages.dispose();
      viewRef.current = null;
      // The next view opens its own book, so readiness does not carry over.
      ready.current = false;
      element.removeAttribute("data-ready");
      forget();
      closeView(view);
      view.remove();
    };
    // The callbacks are useCallbacks with fixed identities, so naming them rebuilds nothing.
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
