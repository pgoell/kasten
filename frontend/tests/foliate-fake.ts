/**
 * A `foliate-view` that measures nothing, for the two jsdom files that need one.
 *
 * jsdom lays nothing out and paints nothing, so a real paginator columnises to
 * a box of zero and never draws a page. What the pane actually asks of foliate
 * is small: open a file, navigate once, turn a page, report each section's
 * document. All of that is here.
 *
 * Shared rather than written twice, because `book-pane.test.tsx` and
 * `home-route.test.tsx` both mount the pane and both fire events on the section
 * document this hands out.
 */

import type { TocItem } from "@/components/book-contents";

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

/** A promise a test releases when it chooses, for the teardown cases. */
export function deferred(): Deferred {
  let resolve = () => {};
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** What `open` builds, and what the pane hangs its `relocate` listener on. */
interface FakeRenderer extends EventTarget {
  setStyles?: (css: string) => void;
  getContents?: () => { index: number; doc: Document; overlayer?: FakeOverlayer }[];
}

/** foliate's overlay, as far as the pane is concerned: two calls and a record of them. */
export interface FakeOverlayer {
  /** Every key added, in order, which is what the drawing cases assert on. */
  added: string[];
  /** Every key removed, including the ones an overlay never held. */
  removed: string[];
  /** What the overlay is holding now, the way the real one's map holds it. */
  keys: string[];
  add(key: string, range: Range, draw: unknown, options: object): void;
  remove(key: string): void;
}

function fakeOverlayer(): FakeOverlayer {
  return {
    added: [],
    removed: [],
    keys: [],
    add(key) {
      this.added.push(key);
      // Replacing what it held under that key, which is what the real
      // `Overlayer.add` does (`overlayer.js:18`).
      if (!this.keys.includes(key)) this.keys.push(key);
    },
    remove(key) {
      this.removed.push(key);
      this.keys = this.keys.filter((held) => held !== key);
    },
  };
}

/**
 * A section document holding one paragraph element per string.
 *
 * With a newline and an indent between the elements, the way a real chapter
 * file is written, so a quote spanning two paragraphs has whitespace to
 * collapse.
 */
export function documentOf(...paragraphs: string[]): Document {
  const doc = document.implementation.createHTMLDocument("section");
  for (const text of paragraphs) {
    const element = doc.createElement("p");
    element.textContent = text;
    doc.body.append(doc.createTextNode("\n  "), element);
  }
  return doc;
}

/** One section of the book's spine, as the pane walks it looking for a passage. */
export interface FakeSection {
  createDocument?: () => Promise<Document>;
}

/**
 * The book's spine, one entry per section.
 *
 * A `null` entry stands for a section foliate cannot open: it carries no
 * `createDocument`, and foliate's own book walk skips those (`view.js:533`).
 */
export function sectionsOf(...sections: (string[] | null)[]): FakeSection[] {
  return sections.map((paragraphs) =>
    paragraphs === null ? {} : { createDocument: () => Promise.resolve(documentOf(...paragraphs)) },
  );
}

export class FakeView extends HTMLElement {
  /** Every view built since the last reset, so a test can count the live ones. */
  static made: FakeView[] = [];

  /** What the next view does when it is opened. A test sets this before mounting. */
  static openWith: (() => Promise<void>) | null = null;
  /** The same for `init`, which fails on its own in one case. */
  static initWith: (() => Promise<void>) | null = null;
  /** Whether the next view's renderer has `setStyles`, which a fixed-layout one has not. */
  static withStyles = true;
  /**
   * Whether the next view's `init` navigates nowhere, leaving `lastLocation`
   * falsy. That is what a cfi naming a spine item the book has not got does:
   * the renderer refuses the index and returns without loading a section.
   */
  static navigatesNowhere = false;
  /**
   * What `getCFI` answers, call by call, and a derived one once it runs out.
   *
   * Per call rather than one fixed string, because a fixed answer makes every
   * relocate after the first an unchanged cfi, which the pane refuses: half the
   * cases below would then report nothing against code that is right. A test
   * that wants two equal answers, which is the fling settling on the same page,
   * loads two equal ones here.
   */
  static cfis: string[] = [];
  /**
   * The contents the next view's book carries, which a test writes whole.
   *
   * The ids are the test's own. Real ones come from `assignIDs` inside
   * `TOCProgress.init` (`progress.js:2-10`, `view.js:245-247`), which only the
   * real `View.open` runs, so a fake stamping them here would be inventing
   * foliate's bookkeeping rather than standing in for it.
   */
  static toc: TocItem[] | null | undefined = undefined;
  /** The spine the next view's book carries, which a case hands in whole. */
  static sections: FakeSection[] = [];

  opened: File | null = null;
  /** What `open` builds. Absent until it has, the way the real view's is. */
  book: { toc: TocItem[] | null | undefined; sections: FakeSection[] } | undefined = undefined;
  started = false;
  /**
   * Whether a section has ever loaded, which is what a renderer to close means.
   *
   * The real paginator builds its inner view on the first `goTo` and destroys
   * that view on close, so before then there is no renderer to free and
   * `getContents` says as much.
   */
  loaded = false;
  /** How many times `close` was called, which the teardown cases count. */
  closes = 0;
  nexts = 0;
  prevs = 0;
  styles: string | null = null;
  /**
   * The options of every `init` call, in order.
   *
   * An array rather than a field holding the last: with no `reading:` set, `{}`
   * and `{ lastLocation: undefined }` are equal to `toEqual`, so a last-call
   * field cannot tell a second `init` from a first.
   */
  inits: object[] = [];
  /**
   * Where the view says it is, which stays null while nothing has loaded.
   *
   * `tocItem` is the entry the reader is inside, and nothing here writes it:
   * the real one comes out of `TOCProgress.getProgress` over the very objects
   * `book.toc` holds, so a case that wants one assigns it itself.
   */
  lastLocation: {
    cfi: string;
    tocItem?: TocItem;
    fraction?: number;
    section?: { current: number; total: number };
  } | null = null;
  /**
   * Whether the book is pre-paginated, which the real view reads off its own
   * rendition (`view.js:254`). The pane refuses to report a selection in one.
   */
  isFixedLayout = false;
  /** Every href `goTo` was asked for, in order. */
  gone: string[] = [];
  renderer: FakeRenderer;
  /** Every `getCFI` call, so a test can see what the pane asked about. */
  asked: { index: number; range: Range | null }[] = [];
  /** The document foliate would hand out per section. Tests fire their events on it. */
  section: Document = document.implementation.createHTMLDocument("section");
  /** The overlay hung on the section on screen, absent until `attach` has run. */
  overlayer: FakeOverlayer | undefined = undefined;
  /** Which section the renderer says it is showing, which `emitCreateOverlay` sets. */
  index = 0;

  constructor() {
    super();
    FakeView.made.push(this);
    this.renderer = new EventTarget();
    // Empty until a section has loaded, the way the real one is: the paginator
    // answers off a view it only builds on the first `goTo`
    // (`paginator.js:667-676, 1092-1099`).
    this.renderer.getContents = () =>
      this.loaded ? [{ index: this.index, doc: this.section, overlayer: this.overlayer }] : [];
    if (FakeView.withStyles)
      this.renderer.setStyles = (css: string) => {
        this.styles = css;
      };
  }

  /**
   * A section arriving with an overlay about to be hung on it.
   *
   * **The event goes out before the overlay is attached**, which is the real
   * view's own order: `#createOverlayer` builds the overlay, emits
   * `create-overlay` (`view.js:418`) and returns, and only then does the
   * handler at `view.js:264-265` hand it to `attach`. A fake that attached
   * first would pass a synchronous draw pass that cannot work in a browser.
   */
  emitCreateOverlay(index = 0): void {
    const overlayer = fakeOverlayer();
    this.index = index;
    this.overlayer = undefined;
    this.dispatchEvent(new CustomEvent("create-overlay", { detail: { index } }));
    this.overlayer = overlayer;
  }

  getCFI(index: number, range: Range | null): string {
    this.asked.push({ index, range });
    return FakeView.cfis[this.asked.length - 1] ?? `cfi-${index}-${this.asked.length}`;
  }

  /**
   * What the renderer emits when the page moves, carrying why it moved.
   *
   * `whole` is what lands on `lastLocation.fraction`, and it is an argument of
   * its own rather than a copy of `detail.fraction`. The two are different
   * numbers: the renderer emits the fraction within the section
   * (`paginator.js:960`) and the view converts it to whole-book progress before
   * re-emitting (`view.js:329-337`, `progress.js:74-98`). A fake that copied
   * one into the other could not tell an implementation reading the wrong one
   * from an implementation reading the right one.
   */
  emitRelocate(
    detail: { reason?: string; index?: number; range?: Range | null; fraction?: number } = {},
    whole?: number,
    section: { current: number; total: number } = { current: 0, total: 1 },
  ): void {
    // Written before the dispatch, the way `View.#onRelocate` assigns
    // `lastLocation` and only then re-emits (`view.js:334,337`).
    this.lastLocation = { cfi: "epubcfi(/6/2)", ...this.lastLocation, fraction: whole, section };
    this.renderer.dispatchEvent(
      new CustomEvent("relocate", { detail: { index: 0, range: null, ...detail } }),
    );
  }

  async open(file: File): Promise<void> {
    this.opened = file;
    if (FakeView.openWith) await FakeView.openWith();
    // After the await, the way `View.open` assigns `this.book` only once
    // `makeBook` has resolved (`view.js:233-237`). That window is as long as
    // unzipping a 30MB epub takes, and it is a window a test has to be able to
    // press a key in.
    this.book = { toc: FakeView.toc, sections: FakeView.sections };
  }

  async init(options: object): Promise<void> {
    this.inits.push(options);
    // Filled before the await, the way the real library fills it: a section
    // that loads at all relocates through the load-time expand
    // (`paginator.js:272-280, 409, 673`), which is well before an anchor can
    // throw. Filled after, a rejecting `init` would leave it falsy, the
    // fallback would fire, and the shape this fake exists to model could not
    // be arranged at all.
    if (!FakeView.navigatesNowhere) {
      this.lastLocation = { cfi: "epubcfi(/6/2)" };
      this.loaded = true;
    }
    if (FakeView.initWith) await FakeView.initWith();
    this.started = true;
  }

  async goTo(target: string): Promise<void> {
    this.gone.push(target);
  }

  close(): void {
    // What the real one does with nothing loaded: `close` reaches
    // `Paginator.destroy`, which dereferences a view the paginator has not
    // built (`paginator.js:1121-1124`). Thrown here rather than counted,
    // because out of an effect cleanup that throw takes the app down.
    if (!this.loaded)
      throw new TypeError('can\'t access property "destroy", this[#s] is undefined');
    this.closes += 1;
  }

  next(): void {
    this.nexts += 1;
  }

  prev(): void {
    this.prevs += 1;
  }

  /**
   * What foliate emits per section, which is where the pane hangs its handlers.
   *
   * `doc` is the section's own document, and a case hands over a second one to
   * arrange a chapter turn: crossing a section takes the old document off the
   * page, and a range pointing into it must not be taken from.
   */
  emitLoad(doc: Document = this.section): void {
    this.loaded = true;
    this.dispatchEvent(new CustomEvent("load", { detail: { doc, index: 0 } }));
  }
}

/**
 * Put a selection in a section document and say so, the way a drag does.
 *
 * jsdom implements neither `getSelection` on a document made by
 * `createHTMLDocument` nor the `selectionchange` a browser fires, so both are
 * arranged here. The selection carries its anchor and focus because the pane
 * reads the direction off them, `removeAllRanges` because the take puts the
 * selection away, and a range whose `startContainer` belongs to `doc` because
 * that is how the take finds the document to clear in. A throw inside a
 * listener goes to jsdom's virtual console, so a missing one of these fails
 * somewhere else entirely.
 *
 * The caller wraps this in `act`: the pane answers it with a state update.
 */
export function selectIn(doc: Document, text: string): void {
  const node = doc.createTextNode(text);
  const range = doc.createRange();
  range.selectNodeContents(node);
  doc.getSelection = () =>
    ({
      toString: () => text,
      rangeCount: 1,
      getRangeAt: () => range,
      anchorNode: node,
      anchorOffset: 0,
      focusNode: node,
      focusOffset: text.length,
      removeAllRanges: () => {},
    }) as unknown as Selection;
  doc.dispatchEvent(new Event("selectionchange"));
}

/**
 * Register the element, once per run.
 *
 * A second `customElements.define` under the same name throws, and two test
 * files import this.
 */
export function defineFoliateFake(): void {
  if (!customElements.get("foliate-view")) customElements.define("foliate-view", FakeView);
}

/** Forget the views the last test built, and put the switches back. */
export function resetFoliateFake(): void {
  FakeView.made = [];
  FakeView.openWith = null;
  FakeView.initWith = null;
  FakeView.withStyles = true;
  FakeView.navigatesNowhere = false;
  FakeView.cfis = [];
  FakeView.toc = undefined;
  FakeView.sections = [];
}

/** The view the pane built, which is the last one made. */
export function lastView(): FakeView {
  const view = FakeView.made.at(-1);
  if (!view) throw new Error("the pane built no foliate-view");
  return view;
}
