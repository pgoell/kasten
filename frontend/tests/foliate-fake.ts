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

export class FakeView extends HTMLElement {
  /** Every view built since the last reset, so a test can count the live ones. */
  static made: FakeView[] = [];

  /** What the next view does when it is opened. A test sets this before mounting. */
  static openWith: (() => Promise<void>) | null = null;
  /** The same for `init`, which fails on its own in one case. */
  static initWith: (() => Promise<void>) | null = null;
  /** Whether the next view's renderer has `setStyles`, which a fixed-layout one has not. */
  static withStyles = true;

  opened: File | null = null;
  started = false;
  /** How many times `close` was called, which the teardown cases count. */
  closes = 0;
  nexts = 0;
  prevs = 0;
  styles: string | null = null;
  renderer: { setStyles?: (css: string) => void };
  /** The document foliate would hand out per section. Tests fire their events on it. */
  section: Document = document.implementation.createHTMLDocument("section");

  constructor() {
    super();
    FakeView.made.push(this);
    this.renderer = FakeView.withStyles
      ? {
          setStyles: (css: string) => {
            this.styles = css;
          },
        }
      : {};
  }

  async open(file: File): Promise<void> {
    this.opened = file;
    if (FakeView.openWith) await FakeView.openWith();
  }

  async init(_options: object): Promise<void> {
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
}

/** The view the pane built, which is the last one made. */
export function lastView(): FakeView {
  const view = FakeView.made.at(-1);
  if (!view) throw new Error("the pane built no foliate-view");
  return view;
}
