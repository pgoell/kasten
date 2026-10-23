import type { TocItem } from "@/components/book-contents";
// Static, and for the side effect: loading the module runs
// `customElements.define("foliate-view", View)`. Without it
// `document.createElement("foliate-view")` makes an unknown element, `open` is
// undefined, and the failure reads like a broken fetch. The declaration file in
// `src/foliate-js.d.ts` supplies the types and nothing else.
import "foliate-js/view.js";

/** The calls the pane makes on foliate's overlay, and the element it hangs. */
export interface FoliateOverlayer {
  add(key: string, range: Range, draw: unknown, options: object): void;
  remove(key: string): void;
  /** The svg the highlights are drawn into. Only a pdf page's overlay is hung by hand. */
  readonly element: SVGElement;
}

/**
 * What the pane asks of foliate's element, which is all it knows about it.
 *
 * Named here rather than reached for through the library's own types, which it
 * ships none of. Both of foliate's shadow roots are closed, so this list, the
 * events it emits and `create-overlay` among them are the whole seam.
 */
export interface FoliateView extends HTMLElement {
  open(file: File): Promise<void>;
  init(options: object): Promise<void>;
  close(): void;
  next(): void;
  prev(): void;
  /** `prev` and `next` by the side of the page, which the book's direction decides (`view.js:519-524`). */
  goLeft(): void;
  goRight(): void;
  /**
   * Built by `open`, and a fixed-layout book's renderer has no `setStyles`.
   *
   * `getContents` answers the section on screen, or none
   * (`paginator.js:1092-1099`). A flowing book has exactly one; a fixed-layout
   * book has the whole spread, up to two, and its answer carries neither an
   * overlayer nor an index (`fixed-layout.js:308-313`). So the draw pass walks
   * the list rather than taking its head, and builds the overlay foliate did
   * not for every page that turns out to be a pdf.
   */
  renderer?: EventTarget & {
    setStyles?: (css: string) => void;
    getContents?: () => { index?: number; doc: Document; overlayer?: FoliateOverlayer }[];
    /**
     * The paginator's own switches, `flow` and `max-inline-size` among them. A flowing
     * book reads its column width from `max-inline-size` (`paginator.js:716-728`).
     */
    setAttribute(name: string, value: string): void;
    /**
     * In a scrolled flow `distance` is how far the text moves, and with none it moves a
     * screen (`paginator.js:1040-1048`). A paged flow ignores it.
     */
    next(distance?: number): void;
    prev(distance?: number): void;
  };
  /**
   * Assigned by `open` after it awaits `makeBook`, so absent while one opens.
   *
   * A section foliate cannot open carries no `createDocument`, which foliate's
   * own book walk skips rather than throwing over (`view.js:533`).
   */
  book?: {
    toc?: TocItem[] | null;
    sections?: { createDocument?: () => Promise<Document> }[];
    /**
     * Frees whatever the format holds open, which for a pdf is its worker.
     *
     * Nothing in foliate calls it: `close()` frees the renderer alone
     * (`view.js:297-308`). An epub's is a no-op over a zip reader already
     * closed, and a pdf's is `pdf.destroy()` (`pdf.js:178`), so the pane calls
     * it on the way out for both.
     */
    destroy?: () => unknown;
  };
  /**
   * Set by `open` from the book's own `rendition:layout` (`view.js:254`).
   *
   * A pre-paginated book breaks three of the take's assumptions at once: a
   * spread shows two documents, the location names one side and carries no
   * range, and both frames are scaled. So the pane reports no selection there.
   */
  isFixedLayout?: boolean;
  /**
   * Take the reader to an href out of the book's own contents, or to a page.
   *
   * A number is a spine index, which `resolveNavigation` takes as it stands
   * (`view.js:447-448`) and which is the only thing the pdf seek has to give:
   * it walks a page's text without building a document, so there is no range to
   * turn into a cfi.
   */
  goTo(target: string | number): Promise<unknown>;
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
    /** The place the reader is at, as the cfi the note's `reading:` holds. */
    cfi?: string;
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
export function isError(thrown: unknown): boolean {
  return Object.prototype.toString.call(thrown) === "[object Error]";
}

/**
 * Free everything a view holds: the renderer, and the book the library forgets.
 *
 * `close` reaches `Paginator.destroy`, which dereferences the inner view the
 * paginator only builds when a section loads (`paginator.js:667-676,
 * 1121-1124`). So a book that opened and has not rendered a page yet, which is
 * every book for as long as the first `goTo` takes, throws on close. Out of the
 * effect's cleanup that throw lands in React's commit and takes the whole app
 * down: the pane the reader switched away from unmounts, and the page is gone
 * until it is reloaded. `getContents` is empty exactly when that field is unset
 * (`paginator.js:1092-1099`), and there is nothing to free in that case anyway:
 * no iframe was ever built, and the element the cleanup removes takes the rest
 * with it.
 *
 * The book is the second half and it is not foliate's: `close` frees the
 * renderer and stops (`view.js:297-308`), and nothing in the library ever calls
 * `book.destroy`, which for a pdf is `pdf.destroy()` and its worker with it
 * (`pdf.js:178`). Both halves are here rather than at the four call sites,
 * because the one that matters is the hardest to see: a pane closed while
 * `open` is still in flight runs its cleanup against a view with no book yet,
 * and the book arrives afterwards with nobody left to free it.
 */
export function closeView(view: FoliateView): void {
  if (view.renderer?.getContents?.().length) view.close();
  view.book?.destroy?.();
}

/**
 * Whether this page was drawn by pdf.js, which is what its text layer says.
 *
 * The file's suffix would not answer it. foliate picks a format off the first
 * bytes (`view.js:13-27, :106`), and the shell door puts files in the vault
 * under whatever name somebody typed, so an epub called `.pdf` opens as an
 * epub. The class is pdf.js's own and it is the thing every part of this
 * depends on: the text to select, the rects to draw on, the layer to hang an
 * overlay in.
 *
 * ponytail: it is a class name and not a proof, so an epub whose own markup
 * carries `class="textLayer"` reads as a pdf page here, which loses `gf` for
 * that book and offers a take in geometry that is not a pdf's. A real test
 * means asking foliate which format it picked, which it does not say
 * (`view.js:79-118` keeps that to itself), so the answer would be a fork of
 * the library.
 */
export function pdfLayer(doc: Document): HTMLElement | null {
  return doc.querySelector(".textLayer");
}
