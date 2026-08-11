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

  opened: File | null = null;
  started = false;
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
  /** Where the view says it is, which stays null while nothing has loaded. */
  lastLocation: { cfi: string } | null = null;
  renderer: FakeRenderer;
  /** Every `getCFI` call, so a test can see what the pane asked about. */
  asked: { index: number; range: Range | null }[] = [];
  /** The document foliate would hand out per section. Tests fire their events on it. */
  section: Document = document.implementation.createHTMLDocument("section");

  constructor() {
    super();
    FakeView.made.push(this);
    this.renderer = new EventTarget();
    if (FakeView.withStyles)
      this.renderer.setStyles = (css: string) => {
        this.styles = css;
      };
  }

  getCFI(index: number, range: Range | null): string {
    this.asked.push({ index, range });
    return FakeView.cfis[this.asked.length - 1] ?? `cfi-${index}-${this.asked.length}`;
  }

  /** What the renderer emits when the page moves, carrying why it moved. */
  emitRelocate(detail: { reason?: string; index?: number; range?: Range | null } = {}): void {
    this.renderer.dispatchEvent(
      new CustomEvent("relocate", { detail: { index: 0, range: null, ...detail } }),
    );
  }

  async open(file: File): Promise<void> {
    this.opened = file;
    if (FakeView.openWith) await FakeView.openWith();
  }

  async init(options: object): Promise<void> {
    this.inits.push(options);
    // Filled before the await, the way the real library fills it: a section
    // that loads at all relocates through the load-time expand
    // (`paginator.js:272-280, 409, 673`), which is well before an anchor can
    // throw. Filled after, a rejecting `init` would leave it falsy, the
    // fallback would fire, and the shape this fake exists to model could not
    // be arranged at all.
    if (!FakeView.navigatesNowhere) this.lastLocation = { cfi: "epubcfi(/6/2)" };
    if (FakeView.initWith) await FakeView.initWith();
    this.started = true;
  }

  close(): void {
    this.closes += 1;
  }

  next(): void {
    this.nexts += 1;
  }

  prev(): void {
    this.prevs += 1;
  }

  /** What foliate emits per section, which is where the pane hangs its handlers. */
  emitLoad(): void {
    this.dispatchEvent(new CustomEvent("load", { detail: { doc: this.section, index: 0 } }));
  }
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
}

/** The view the pane built, which is the last one made. */
export function lastView(): FakeView {
  const view = FakeView.made.at(-1);
  if (!view) throw new Error("the pane built no foliate-view");
  return view;
}
