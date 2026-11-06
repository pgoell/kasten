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
 * What the pane asks of foliate's element. Both of its shadow roots are closed, so this list,
 * the events it emits and `create-overlay` are the whole seam.
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
   * Set by `open`. A fixed-layout book has no `setStyles`, and its `getContents` answers up to two
   * pages with no overlayer, so the draw pass walks the list and builds the overlays itself.
   */
  renderer?: HTMLElement & {
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
   * Assigned by `open` after it awaits `makeBook`, so absent while one opens. A section foliate
   * cannot open has no `createDocument`, which its own walk skips (`view.js:533`).
   */
  book?: {
    toc?: TocItem[] | null;
    sections?: { createDocument?: () => Promise<Document> }[];
    /**
     * Frees whatever the format holds open: a pdf's worker. Nothing in foliate calls it,
     * since `close()` frees the renderer alone, so the pane calls it on the way out.
     */
    destroy?: () => unknown;
    /** An epub's creators (`epub.js:294`), or a pdf's `Author` string (`pdf.js:135`). */
    metadata?: { author?: Contributor | Contributor[] };
  };
  /**
   * Set by `open` from the book's `rendition:layout`. A pre-paginated book shows two documents
   * in a spread with scaled frames, so the pane reports no selection there.
   */
  isFixedLayout?: boolean;
  /**
   * Take the reader to an href in the book's contents, or to a page. A number is a spine index,
   * the only thing the pdf seek can give: it reads a page's text without a document, so no cfi.
   */
  goTo(target: string | number): Promise<unknown>;
  /**
   * Where the view says it is, filled by every relocate and nulled by `close`. `tocItem` is the very
   * object `book.toc` holds, and `section` counts the spine for every book this app can open.
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
  /**
   * The section a cfi names, and how to find its place in a document of that
   * section (`view.js:436-445`). A pdf's book answers the page alone.
   */
  resolveCFI?(cfi: string): unknown;
}

/** One creator as foliate gives it: a name, or a name per language. */
type Contributor = string | { name?: string | Record<string, string> } | null;

/** Where the reader is, as the bookmark writes it into the book's note. */
export interface Place {
  cfi: string;
  /** The whole-book fraction, or null with no honest number. */
  progress: number | null;
  /** The book's creators, comma-joined, or undefined when it names none. */
  author: string | undefined;
}

export function placeOf(view: FoliateView, cfi: string): Place {
  const authors = [view.book?.metadata?.author ?? []].flat().map(nameOf).filter(Boolean);
  return { cfi, progress: progressOf(view), author: authors.join(", ") || undefined };
}

function nameOf(contributor: Contributor): string {
  if (typeof contributor === "string") return contributor.trim();
  const name = contributor?.name;
  // A language map: the first language, as foliate's own reader shows it (`reader.js:51-56`).
  const shown = typeof name === "object" ? Object.values(name)[0] : name;
  return (shown ?? "").trim();
}

/**
 * How far through the whole book the view is, or null with no honest number. Read off the view, not
 * the event: the event's fraction is per section. The whole-book number is set by a listener the
 * view registers first (view.js:329-337, progress.js:74-98).
 */
export function progressOf(view: FoliateView): number | null {
  const fraction = view.lastLocation?.fraction;
  // The typeof narrows: Number.isFinite does not, so the multiply below would not compile.
  return typeof fraction === "number" && Number.isFinite(fraction) ? fraction : null;
}

/**
 * Whether something thrown is an error object, from this realm or the book's. `instanceof` misses
 * an error from the book's iframe, so `Object.prototype.toString` reads the internal slot instead.
 */
export function isError(thrown: unknown): boolean {
  return Object.prototype.toString.call(thrown) === "[object Error]";
}

/**
 * Free the renderer and the book, which foliate never frees together. `close` throws on a book with
 * no page yet, and a pane closed during `open` must still free the book that arrives afterwards.
 */
export function closeView(view: FoliateView): void {
  if (view.renderer?.getContents?.().length) view.close();
  view.book?.destroy?.();
}

/**
 * Whether this page was drawn by pdf.js, read off its text layer. The file name cannot say, since
 * foliate picks the format off the bytes. ponytail: an epub with its own `textLayer` class reads as a pdf page.
 */
export function pdfLayer(doc: Document): HTMLElement | null {
  return doc.querySelector(".textLayer");
}
