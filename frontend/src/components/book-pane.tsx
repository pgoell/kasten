import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookContents, type TocItem, type TocRow, tocRows } from "@/components/book-contents";
import { fetchBook, fetchNote } from "@/lib/api";
import { findQuotes } from "@/lib/find-quote";
import { type HighlightBlock, highlightBlocks, type Passage } from "@/lib/highlight";
import { type EditorCommands, TERMINAL, TERMINAL_CHORD } from "@/lib/key-bindings";
import { readField } from "@/lib/note-frontmatter";
import { bookPath } from "@/lib/note-path";
import { STATUS } from "@/lib/overlay-styles";
// Static, and for the side effect: loading the module runs
// `customElements.define("foliate-view", View)`. Without it
// `document.createElement("foliate-view")` makes an unknown element, `open` is
// undefined, and the failure reads like a broken fetch. The declaration file in
// `src/foliate-js.d.ts` supplies the types and nothing else.
import "foliate-js/view.js";
// The drawing half of the same seam: `Overlayer.highlight` is the function that
// paints a range, handed to the overlay rather than called here.
import { Overlayer } from "foliate-js/overlayer.js";

/** The two calls the pane makes on foliate's overlay. */
interface FoliateOverlayer {
  add(key: string, range: Range, draw: unknown, options: object): void;
  remove(key: string): void;
}

/**
 * What the pane asks of foliate's element, which is all it knows about it.
 *
 * Named here rather than reached for through the library's own types, which it
 * ships none of. Both of foliate's shadow roots are closed, so this list, the
 * events it emits and `create-overlay` among them are the whole seam.
 */
interface FoliateView extends HTMLElement {
  open(file: File): Promise<void>;
  init(options: object): Promise<void>;
  close(): void;
  next(): void;
  prev(): void;
  /**
   * Built by `open`, and a fixed-layout book's renderer has no `setStyles`.
   *
   * `getContents` answers the one section on screen, or none
   * (`paginator.js:1092-1099`), which is why the draw pass draws one section:
   * it is all foliate offers. A fixed-layout book's answer carries no overlayer
   * and no index (`fixed-layout.js:308-313`), so the optional field is the
   * whole of the refusal to draw in one.
   */
  renderer?: EventTarget & {
    setStyles?: (css: string) => void;
    getContents?: () => { index: number; doc: Document; overlayer?: FoliateOverlayer }[];
  };
  /** Assigned by `open` after it awaits `makeBook`, so absent while one opens. */
  book?: { toc?: TocItem[] | null };
  /**
   * Set by `open` from the book's own `rendition:layout` (`view.js:254`).
   *
   * A pre-paginated book breaks three of the take's assumptions at once: a
   * spread shows two documents, the location names one side and carries no
   * range, and both frames are scaled. So the pane reports no selection there.
   */
  isFixedLayout?: boolean;
  /** Take the reader to an href out of the book's own contents. */
  goTo(target: string): Promise<unknown>;
  /**
   * Where the view says it is. Filled by every relocate, nulled by `close`.
   *
   * `tocItem` is the entry the reader is inside, which is the very object
   * `book.toc` holds rather than a copy of it. `fraction` is how far through
   * the whole book the page is, which the renderer's own event does not carry.
   * `section` counts the spine, and is there for every book this app can open
   * (`view.js:240-247`, `epub.js:1056`).
   */
  lastLocation?: {
    tocItem?: TocItem;
    fraction?: number;
    section?: { current: number; total: number };
  } | null;
  /** The cfi for a place the renderer reported. A null range answers the section's own. */
  getCFI(index: number, range: Range | null): string;
}

/**
 * Whether something thrown is an error object, from this realm or the book's.
 *
 * `instanceof Error` is not enough here, and the difference is not academic. A
 * stale bookmark ends in `range.setStart(null, …)` on a range built in the
 * book's own iframe, so the `TypeError` that comes back carries that document's
 * `Error` and reads as false against this one. `Object.prototype.toString` asks
 * about the internal slot instead, which no realm boundary hides.
 */
function isError(thrown: unknown): boolean {
  return Object.prototype.toString.call(thrown) === "[object Error]";
}

/**
 * Whether the selection runs backwards, which says which end the hand is at.
 *
 * The way foliate reads it (`selectionIsBackward`, `paginator.js:153-158`): a
 * range built from the anchor to the focus collapses when the focus lies before
 * the anchor. A `Range` is always in document order, so nothing later can
 * recover which end a drag finished at.
 */
function runsBackward(doc: Document, selection: Selection): boolean {
  const { anchorNode, focusNode } = selection;
  if (anchorNode === null || focusNode === null) return false;
  const probe = doc.createRange();
  probe.setStart(anchorNode, selection.anchorOffset);
  probe.setEnd(focusNode, selection.focusOffset);
  return probe.collapsed;
}

/**
 * The button drawn over a selection, which is the mouse's half of `y`.
 *
 * The transform puts its middle over the middle of the words and its bottom
 * edge on their top, so the placement is one rule rather than "above and to the
 * left". `h-6` is 24px and the label makes it about 40px wide, which is what
 * `INSET` below is measured against.
 */
const TAKE =
  "absolute flex h-6 -translate-x-1/2 -translate-y-full items-center rounded border border-one-muted bg-one-bg px-2 font-mono text-one-fg text-xs";

/**
 * How far from the pane's edges the button's own point is kept.
 *
 * It has to cover **half the button's width and the whole of its height**,
 * because the transform above moves the box by both. Written beside the class
 * list for that reason: 24px tall and about 40px wide, so this is comfortably
 * over the larger of 24 and 20. A selection off the drawn page maps well
 * outside the pane, the paginator having expanded the iframe to the whole
 * columnised chapter, and the wrapper hides no overflow of its own.
 */
const INSET = 32;

interface BookPaneProps {
  /** The literature note this reads beside. The book is its path, suffix swapped. */
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
  /** A passage the reader took, by the button or by `y`. */
  onTake: (passage: Passage) => void;
}

/**
 * The book's page in the app's own colours.
 *
 * The same CSS variables `oneTheme()` in `terminal-pane.tsx` reads, so the page
 * matches the editor beside it and the palette stays in `app.css`. That
 * function is private to its file, hence the second reader rather than an
 * export. Nothing sets a font, a size or a column count: the book's own
 * typography is the book's, and fitting is foliate's job.
 */
function pageStyles(): string {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();

  return [
    `html, body { background: ${read("--color-one-bg")}; color: ${read("--color-one-fg")}; }`,
    `a { color: ${read("--color-one-accent")}; }`,
  ].join("\n");
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
}: BookPaneProps) {
  const wrapper = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<FoliateView | null>(null);
  /** Whether foliate could not read what the vault handed it. */
  const [broken, setBroken] = useState(false);
  /** How far through the book the page is, or null while there is no honest number. */
  const [progress, setProgress] = useState<number | null>(null);
  /** The book's chapters over the page, or null while the reader has the keys. */
  const [contents, setContents] = useState<{ rows: TocRow[]; start: number } | null>(null);
  // The same thing as a ref, because `onKeyDown` cannot read the state. The
  // effect that builds the view lists the handler in its dependencies, so a
  // handler with a new identity on every `t` would tear the book down and open
  // it again, losing the page.
  const contentsOpen = useRef(false);
  /** Where to draw the button, or null to draw none. The only part of this that renders. */
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  /**
   * What is selected in the book now, or null for nothing.
   *
   * A ref for the same reason `contentsOpen` is one, and the argument is worth
   * the lines because both wrong answers look right: `onKeyDown` is a
   * `useCallback` with no dependencies, so a `y` branch closing over a piece of
   * state would read the mount value, which is nothing, for the life of the
   * pane, and naming that state in the callback's dependencies would rebuild
   * the reader on every drag.
   *
   * The whole passage is decided here, at the moment the selection is made,
   * and never asked about again: everything true of a passage is true when you
   * select it and may not be a second later.
   */
  const taking = useRef<{ passage: Passage; range: Range; backward: boolean } | null>(null);

  // Read through refs, the way `terminal-pane.tsx` reads the same prop. The
  // view is built in one effect keyed on the bytes, and naming these in its
  // dependencies would rebuild it every time the route's memo took a new
  // identity, which is on every vault write.
  const commandsRef = useRef(commands);
  const onFocusRef = useRef(onFocus);
  const onMovedRef = useRef(onMoved);
  const onLeavingRef = useRef(onLeaving);
  const onTakeRef = useRef(onTake);
  useEffect(() => {
    commandsRef.current = commands;
    onFocusRef.current = onFocus;
    onMovedRef.current = onMoved;
    onLeavingRef.current = onLeaving;
    onTakeRef.current = onTake;
  });

  /**
   * Report what is selected and put the selection away.
   *
   * One path for the button and for `y`, so there is one answer to what is
   * selected. It asks foliate nothing: the passage was decided when the
   * selection was made. Clearing the selection is the only signal the pane
   * gives that the press landed, and the document to clear it in comes off the
   * range rather than out of a fourth field on the ref.
   */
  const take = useCallback(() => {
    const held = taking.current;
    if (held === null) return;
    onTakeRef.current(held.passage);
    taking.current = null;
    setAt(null);
    held.range.startContainer.ownerDocument?.getSelection()?.removeAllRanges();
  }, []);

  /**
   * Every key the reader answers, whichever document it was pressed in.
   *
   * The modifiers are compared for equality rather than tested for truth, the
   * way `terminal-pane.tsx` compares them: Chrome spends `Ctrl+H` on its
   * history window, and a handler reading `event.key` alone would turn that
   * into a page turn.
   */
  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // The contents render inside the wrapper, whose listener is a native one,
      // while React delegates every event from the root container above it. So a
      // key pressed in the contents reaches this handler first, and without this
      // `q` in there closes the reader and `l` turns a page behind the panel.
      if (contentsOpen.current) return;

      const chord =
        event.ctrlKey === TERMINAL_CHORD.ctrlKey &&
        event.shiftKey === TERMINAL_CHORD.shiftKey &&
        event.altKey === TERMINAL_CHORD.altKey &&
        event.metaKey === TERMINAL_CHORD.metaKey;

      if (chord) {
        // From `TERMINAL` rather than a table of this pane's own, so retuning a
        // chord retunes both panes.
        const binding = TERMINAL.find((row) => row.key === event.key);
        if (binding === undefined) return;
        event.preventDefault();
        commandsRef.current[binding.command]();
        return;
      }

      if (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;

      // No leader: the pane holds a document you page with the space bar in every
      // other reader, and the chords already carry the way out.
      if (event.key === "l") viewRef.current?.next();
      else if (event.key === "h") viewRef.current?.prev();
      else if (event.key === "q") commandsRef.current.closeNote();
      // Nothing selected is nothing to take, the way `t` on a book still opening
      // is nothing to draw.
      else if (event.key === "y") take();
      else if (event.key === "t") {
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
      } else return;

      event.preventDefault();
      // `take` is the only name here that is not a ref, and it is a `useCallback`
      // with no dependencies of its own, so this handler's identity is still
      // fixed for the life of the pane and the view effect naming it rebuilds
      // nothing.
    },
    [take],
  );

  /** That a click or a Tab landed in the book, which no ancestor is told. */
  const report = useCallback(() => onFocusRef.current(), []);

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

  // On the wrapper as well as on every section, and in an effect of its own so
  // it survives a book that never opened: the error panel answers `q` too.
  useEffect(() => {
    const element = wrapper.current;
    element?.addEventListener("keydown", onKeyDown);
    return () => element?.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown]);

  // A query rather than an effect, so two panes reading one book share the blob
  // and so an upload has a key to invalidate.
  const { data: blob, error } = useQuery({
    queryKey: ["book", bookPath(note)],
    queryFn: () => fetchBook(bookPath(note)),
  });

  // The same key the editor beside it writes and the events stream
  // invalidates, so a highlight deleted by hand and saved stops being drawn
  // with no word between the panes. The `reading:` field is still read a
  // second time inside `draw()`: that is PR 2's tested path, and one small
  // `GET` does not buy either putting the note's text in the view effect's
  // dependencies or routing that read through the query client.
  const { data: text } = useQuery({ queryKey: ["note", note], queryFn: () => fetchNote(note) });

  /** Every highlight the note holds, and a stable identity for the effect below. */
  const blocks = useMemo(() => highlightBlocks(text ?? ""), [text]);
  // Read off a ref by the `create-overlay` listener, which is built with the
  // view and cannot name a value that changes without tearing the book down.
  const blocksRef = useRef(blocks);
  /** The ids the last pass drew, so the next one can take them off first. */
  const drawn = useRef<string[]>([]);

  /**
   * Draw `blocks` on the section on screen, in one walk of its document.
   *
   * No entry, or an entry with no overlayer, is nothing to draw on: a book
   * still opening, or a fixed-layout book, which is the whole of that guard.
   */
  const redraw = useCallback((blocks: HighlightBlock[]) => {
    const shown = viewRef.current?.renderer?.getContents?.()[0];
    const overlayer = shown?.overlayer;
    if (shown === undefined || overlayer === undefined) return;

    // Read the way `pageStyles` reads the palette, so the book, the app and the
    // highlight stay one set of colours in `app.css`.
    // Removing an id from an overlay that never held it does nothing
    // (`overlayer.js:26`), so a fresh section needs no bookkeeping beyond this.
    for (const id of drawn.current) overlayer.remove(id);
    drawn.current = [];

    // Read the way `pageStyles` reads the palette, so the book, the app and the
    // highlight stay one set of colours in `app.css`.
    const colour = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-one-accent")
      .trim();
    const found = findQuotes(
      shown.doc,
      blocks.map((block) => block.quote),
    );
    for (const [at, range] of found.entries()) {
      const block = blocks[at];
      // A quote the book no longer holds is skipped in silence. A pass nobody
      // asked for gets no answer, which is where drawing and `gf` differ.
      if (range === null || block === undefined) continue;
      overlayer.add(block.id, range, Overlayer.highlight, { color: colour });
      drawn.current.push(block.id);
    }
  }, []);

  // The second trigger, and neither covers the other: the first section's
  // overlay is often built before the note query has answered, and a page into
  // a new chapter is the other way round with the blocks not having moved.
  useEffect(() => {
    blocksRef.current = blocks;
    redraw(blocks);
  }, [blocks, redraw]);

  useEffect(() => {
    const element = host.current;
    // An empty file is a book foliate throws `NotFoundError` for, which reads
    // as a broken library rather than as an empty file. Refused up here.
    if (element === null || blob === undefined || blob.size === 0) return;

    setBroken(false);
    let cancelled = false;
    const view = document.createElement("foliate-view") as FoliateView;
    viewRef.current = view;
    element.append(view);

    // Registered before the book opens, so the first section's document does
    // not slip past. Keys pressed inside foliate's iframe reach neither this
    // wrapper nor the window, an event not crossing a document boundary, and a
    // click inside it fires no focus event on any ancestor either. This is the
    // only seam: foliate builds both iframes behind closed shadow roots.
    const sections: Document[] = [];
    function onLoad(event: Event) {
      const { doc } = (event as CustomEvent<{ doc: Document }>).detail;
      doc.addEventListener("keydown", onKeyDown);
      // Two listeners for two ways in, and neither covers the other. A
      // paragraph cannot hold focus, so a real click fires `pointerdown`,
      // `mousedown` and `click` here and nothing else; Tab into one of the
      // book's links fires only `focusin`.
      doc.addEventListener("pointerdown", report);
      doc.addEventListener("focusin", report);
      doc.addEventListener("selectionchange", onSelectionChange);
      // Another section is on the page, so a held range points into a document
      // that has been removed from the tree (`paginator.js:666-676`). The
      // chapter travels with the passage, so this is no longer about the
      // label; it is about the range.
      if (taking.current?.range.startContainer.ownerDocument !== doc) taking.current = null;
      sections.push(doc);
    }
    view.addEventListener("load", onLoad);

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
        redraw(blocksRef.current);
      });
    }
    view.addEventListener("create-overlay", onOverlay);

    /**
     * Where the button goes for a selection, or null where the iframe is out
     * of reach, which is jsdom and nothing else.
     *
     * The rectangle at the end the drag finished at: `getClientRects` answers
     * in document order, so that is the last one running forwards and the
     * first one running backwards, and the button belongs at the end the hand
     * is at.
     */
    function place(range: Range, backward: boolean): { x: number; y: number } | null {
      const frame = range.startContainer.ownerDocument?.defaultView?.frameElement;
      const pane = wrapper.current;
      if (!frame || pane === null) return null;

      const rects = range.getClientRects();
      const rect = backward ? rects[0] : rects[rects.length - 1];
      if (rect === undefined) return null;

      const outer = frame.getBoundingClientRect();
      const box = pane.getBoundingClientRect();
      const x = outer.left + rect.left + rect.width / 2 - box.left;
      const y = outer.top + rect.top - box.top;
      return {
        x: Math.min(Math.max(x, INSET), box.width - INSET),
        y: Math.min(Math.max(y, INSET), box.height),
      };
    }

    /** The chapter the page is in, as the note is to name it. */
    function chapterNow(): string {
      const label = view.lastLocation?.tocItem?.label;
      // `trim` and not foliate's own normaliser, which strips ASCII whitespace
      // alone (`epub.js:64-67`) while the nav path falls back to a raw `title`
      // attribute nothing normalises. A label of one non-breaking space is
      // truthy to the library and empty here, which is what keeps the chapter
      // line from being a bare caret.
      if (label !== undefined && label !== null && label.trim() !== "") return label;
      // The book's own words or a number, and never the section document's
      // `<title>`: a great many books put the book's title in every chapter
      // file, so that fallback would write the same wrong words throughout.
      return `Section ${(view.lastLocation?.section?.current ?? 0) + 1}`;
    }

    function onSelectionChange(event: Event) {
      // Not a fixed-layout book. A spread shows two documents, the location
      // names one side and carries no range, and both frames are scaled, so
      // every part of a take there would be wrong rather than missing.
      if (view.isFixedLayout) return;

      const doc = event.currentTarget as Document;
      const selection = doc.getSelection();
      // `selection.toString()` and never `range.toString()`: measured in
      // Chromium, a range runs two paragraphs together where a selection keeps
      // the break, and that break is what the whole format rests on.
      const text = selection === null ? "" : selection.toString();
      if (selection === null || selection.rangeCount === 0 || text.trim() === "") {
        taking.current = null;
        setAt(null);
        return;
      }

      // The chapter is written on the first change of a selection and kept.
      // A chapter can change with no document loading, one spine file often
      // holding several, so a drag that runs past a boundary would otherwise
      // be named for wherever it came to rest.
      const chapter = taking.current?.passage.chapter ?? chapterNow();
      const range = selection.getRangeAt(0);
      const backward = runsBackward(doc, selection);
      taking.current = { passage: { text, chapter }, range, backward };
      setAt(place(range, backward));
    }

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

      // The button follows the words. foliate turns the page up to 700ms after
      // you let go of a selection that ran past the edge
      // (`checkPointerSelection`, `paginator.js:586-594`), so without this the
      // button would go on pointing at a place the words have left. Off the
      // ref, which is the other reason the ref exists: this closure is built
      // once with the view and would otherwise read the selection the pane had
      // when the book opened, which is nothing.
      const held = taking.current;
      setAt(held === null ? null : place(held.range, held.backward));

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
    const file = new File([blob], bookPath(note));

    async function draw() {
      try {
        await view.open(file);
        // Not a bare return: the cleanup already ran while `open` was in
        // flight, and there was no renderer to close then. This is the close
        // that actually frees one.
        if (cancelled) {
          view.close();
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
          view.close();
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
        if (cancelled) view.close();
      } catch (error_) {
        // Every way a book fails to open arrives as an error: a `NotFoundError`
        // from foliate, a throw from the zip reader for a file that is not an
        // archive, the retry above failing too. Anything else came from
        // somewhere this cannot report on.
        if (!isError(error_)) throw error_;
        if (!cancelled) setBroken(true);
      }
    }
    void draw();

    return () => {
      cancelled = true;
      view.removeEventListener("load", onLoad);
      view.removeEventListener("create-overlay", onOverlay);
      renderer?.removeEventListener("relocate", onRelocate);
      for (const doc of sections) {
        doc.removeEventListener("keydown", onKeyDown);
        doc.removeEventListener("pointerdown", report);
        doc.removeEventListener("focusin", report);
        doc.removeEventListener("selectionchange", onSelectionChange);
      }
      viewRef.current = null;
      view.close();
      view.remove();
    };
    // `redraw` is a `useCallback` with no dependencies, so its identity is fixed
    // and naming it here rebuilds nothing.
  }, [blob, note, onKeyDown, redraw, report]);

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

  // One effect whose only job is its cleanup. Not folded into the view's, which
  // tears down whenever the blob or the note changes and would then say this on
  // a rebuild rather than on the way out. The cleanup belongs to the mount
  // render, so it reads the callback off the ref at the moment it runs: closing
  // over the prop would flush against the note the pane held when it mounted,
  // which a folder move has since changed.
  useEffect(() => () => onLeavingRef.current(), []);

  // The listing having not arrived is not the same as the note being gone, so
  // an undefined `paths` says nothing.
  const orphaned = paths !== undefined && !paths.includes(note);
  const failed = broken || error !== null || orphaned || (blob !== undefined && blob.size === 0);

  return (
    // `tabIndex={-1}` so the wrapper can hold the cursor without joining the
    // tab order, the way `todo-pane.tsx` takes it.
    <div
      ref={wrapper}
      data-book-pane
      tabIndex={-1}
      className="relative flex h-full w-full flex-col outline-none"
    >
      {/* `min-h-0` so the host takes the room the footer leaves rather than the
          room its own content wants: a paginator columnises to the box it is
          in, and a flex child that will not shrink draws its page off the
          bottom of the pane. */}
      <div ref={host} className="min-h-0 w-full flex-1" />
      <footer className={STATUS}>
        {progress === null ? "" : `${Math.round(progress * 100)}%`}
      </footer>
      {at && (
        // No z-index, so the contents overlay at `z-10` covers it and takes the
        // clicks while it is open, which is the answer the key handler gives by
        // returning early.
        <button
          type="button"
          data-take
          onClick={take}
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
          className="absolute inset-0 flex items-center justify-center bg-one-bg p-6 text-center font-mono text-one-muted text-sm"
        >
          <p>
            No book at <span className="text-one-fg">{bookPath(note)}</span>
          </p>
        </div>
      )}
    </div>
  );
}
