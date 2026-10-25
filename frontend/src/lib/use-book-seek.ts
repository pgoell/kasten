import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { BookBeside } from "@/lib/api";
import { findWritten, holdsWritten } from "@/lib/find-quote";
import { type FoliateView, pdfLayer } from "@/lib/foliate-view";
import { PDFJS_BASE } from "@/lib/pdf-view";

/**
 * The little of pdf.js the seek uses, which is a page's words and nothing else.
 *
 * Read off `globalThis`, where `pdf.js:3-4` puts it: foliate imports its own
 * vendored build for that side effect and keeps the document it opens to
 * itself, `makePDF` closing over it (`pdf.js:115-179`). So this is not a second
 * copy of the library, only a second reading of the same file, and it exists
 * because there is no other way to a page's text without drawing the page.
 */
interface Pdfjs {
  getDocument(options: {
    data: ArrayBuffer;
    cMapUrl: string;
    standardFontDataUrl: string;
    isEvalSupported: boolean;
  }): {
    promise: Promise<{
      numPages: number;
      getPage(
        page: number,
      ): Promise<{ getTextContent(): Promise<{ items: { str?: string; hasEOL?: boolean }[] }> }>;
      destroy(): Promise<void>;
    }>;
    /** Frees the worker the task spawned, which a rejected `promise` leaves running. */
    destroy(): Promise<void>;
  };
}

/** A pdf opened by `readPdf`, as much of it as its readers use. */
type OpenPdf = Awaited<ReturnType<Pdfjs["getDocument"]>["promise"]>;

/**
 * Open `bytes` with pdf.js, hand the document to `read`, and free it.
 *
 * Bytes pdf.js will not open answer `otherwise` rather than throwing. The caller
 * picks a pdf arm by the book carrying no document to walk, and a section of an
 * epub foliate could not build carries none either (`view.js:533`), so the wrong
 * arm is reachable and it must end in the same answer as an honest miss. The
 * document is destroyed on every path out, its worker with it.
 */
export async function readPdf<T>(
  bytes: ArrayBuffer,
  read: (pdf: OpenPdf) => Promise<T>,
  otherwise: T,
): Promise<T> {
  const pdfjs = (globalThis as { pdfjsLib?: Pdfjs }).pdfjsLib;
  // Nothing has opened a pdf in this tab, so nothing set the global. Reachable
  // only if foliate stops loading that module, which would have broken the
  // reader long before it reached this.
  if (pdfjs === undefined) return otherwise;

  // Opened the way foliate opens its own (`pdf.js:120-127`), the two url
  // options included: they are what makes this reading of the file the same
  // reading as the drawn one. `isEvalSupported` is off because the policy in
  // `csp.ts` carries no `'unsafe-eval'` and never will.
  const task = pdfjs.getDocument({
    data: bytes,
    cMapUrl: `${PDFJS_BASE}cmaps/`,
    standardFontDataUrl: `${PDFJS_BASE}standard_fonts/`,
    isEvalSupported: false,
  });
  const opened = await task.promise.then(
    (pdf) => pdf,
    // A two-arm `then` and not a catch, the way the note read in
    // `use-book-view.ts` takes its failure: what is thrown here is pdf.js's own
    // `InvalidPDFException` for a file that is not one.
    () => null,
  );
  // The task and not the document, there being no document. pdf.js spawns the
  // worker before it parses a byte, so a refused file that was not freed here
  // leaves one running for the life of the tab.
  if (opened === null) {
    await task.destroy();
    return otherwise;
  }

  try {
    return await read(opened);
  } finally {
    await opened.destroy();
  }
}

/**
 * Which page of `bytes` holds `quote`, counting from zero, or -1.
 *
 * `getTextContent` is the cheap half of what rendering a page costs: it parses
 * the content stream and hands back the runs, and draws nothing. The runs are
 * joined with nothing between them, which is not a shortcut but the rule: the
 * text layer puts each run in a span of its own and no whitespace between two
 * of them, so a page's own words read the same way whether they are being
 * matched here or in the drawn document.
 *
 * `keep` is asked before every page, so a second press or a closed pane ends
 * the walk rather than finishing a scan nobody is waiting for.
 */
function pdfPageHolding(bytes: ArrayBuffer, quote: string[], keep: () => boolean): Promise<number> {
  return readPdf(
    bytes,
    async (opened) => {
      for (let page = 1; page <= opened.numPages; page += 1) {
        if (!keep()) return -1;
        const content = await (await opened.getPage(page)).getTextContent();
        const text = content.items.map((item) => item.str ?? "").join("");
        if (holdsWritten(text, quote)) return page - 1;
      }
      return -1;
    },
    -1,
  );
}

/**
 * Walks the book for a passage the reader asked for, and takes the reader to it.
 *
 * Answers `resumeSeek`, which the view calls once the book is ready: a passage
 * parked while it opened goes on top of the bookmark, and the answer says
 * whether one was parked.
 */
export function useBookSeek(o: {
  seek?: { quote: string[] };
  beside: BookBeside | undefined;
  onNotice: (message: string) => void;
  viewRef: RefObject<FoliateView | null>;
  ready: RefObject<boolean>;
}): () => boolean {
  const { seek, beside, onNotice, viewRef, ready } = o;
  /** The passage being walked for, which a later press overwrites. */
  const wanted = useRef<string[] | null>(null);
  // Off a ref for the reason the callbacks are: `goToQuote` is a `useCallback`
  // with only stable refs as dependencies, so that the effect naming it rebuilds no book, and a
  // seek into a pdf needs the bytes.
  //
  // Read through refs, written in a layout effect, which runs in the commit's
  // own task.
  const besideRef = useRef<BookBeside | undefined>(undefined);
  const onNoticeRef = useRef(onNotice);
  useLayoutEffect(() => {
    onNoticeRef.current = onNotice;
    besideRef.current = beside;
  });

  /**
   * Take the reader to the first section holding `quote`.
   *
   * Measured on a real book: 76ms to walk all 26 sections and find nothing,
   * 66ms to a hit two thirds of the way in. No progress, no spinner, nothing to
   * cancel. Nothing catches either: `goTo` swallows its own failures, which the
   * contents overlay already relies on.
   */
  const goToQuote = useCallback(
    async (quote: string[]) => {
      const view = viewRef.current;
      wanted.current = quote;
      // A seek arriving before the book is ready, which is every `gf` that opens
      // the reader, waits here. `draw()` reads this ref once its own `init` work
      // has landed and calls again, so the passage overrides where the bookmark
      // put you, which is what was asked for.
      if (view === null || !ready.current) return;

      /** Whether this walk is still the one being waited on. See the epub arm. */
      const mine = () => viewRef.current === view && wanted.current === quote;

      const sections = view.book?.sections ?? [];
      // A pdf's sections carry a `load` that renders a page and no
      // `createDocument` at all (`pdf.js:150-160`), so the walk below would skip
      // every one of them and answer that a passage plainly in the file is not.
      // pdf.js parses a page's text without drawing it, which is the arm this
      // takes. It costs a second reading of the file, whole, where the epub arm
      // costs a section at a time, and it is spent on a keypress rather than on
      // anything the reader is watching.
      //
      // The page on screen decides it, which is the same question `chapterOf` in `book-pages.ts`
      // and `onSelectionChange` ask and the same answer. The spine's head looks
      // like the cheaper test and is a trap: a section foliate could not build
      // carries no `createDocument` either (`view.js:533`), so an epub beginning
      // with one would take this arm and lose `gf` for the whole book. There is
      // always a page by now, `ready` being set after `init` has navigated.
      //
      // ponytail: a press landing in the millisecond between `replaceChildren`
      // and the new page parsing (`fixed-layout.js:167`) sees documents with no
      // text layer yet, takes the epub arm over a pdf and answers that the
      // passage is not in the book. One more press finds it. This is the same
      // non-ordering the walk below already names and refuses to buy.
      const onScreen = view.renderer?.getContents?.() ?? [];
      if (onScreen.some((entry) => pdfLayer(entry.doc) !== null)) {
        const bytes = await besideRef.current?.blob.arrayBuffer();
        const page = bytes === undefined ? -1 : await pdfPageHolding(bytes, quote, mine);
        if (!mine()) return;
        if (page !== -1) {
          wanted.current = null;
          // The page index, which `resolveNavigation` takes as it stands
          // (`view.js:448`). No cfi: a fixed-layout renderer goes to a page and
          // reads no anchor, so building one out of a range this walk never had
          // would be a string nothing looks at.
          void view.goTo(page);
          return;
        }
      } else {
        for (const [index, section] of sections.entries()) {
          if (section.createDocument === undefined) continue;
          const doc = await section.createDocument();
          // A newer press has taken the walk over, or the pane went away while the
          // document was being built. What this does not buy is an order on two
          // `goTo` calls already in flight, which the spec names and refuses.
          if (!mine()) return;
          const [range] = findWritten(doc, [quote]);
          if (range) {
            wanted.current = null;
            void view.goTo(view.getCFI(index, range));
            return;
          }
        }
      }

      // Cleared on a hit and on a miss both, so nothing stays armed for a later
      // rebuild of the view to pick up.
      wanted.current = null;
      // A press gets an answer, which is where this and the draw pass differ: a
      // quote nobody asked about is skipped in silence.
      onNoticeRef.current("That passage is not in the book");
    },
    [viewRef, ready],
  );

  useEffect(() => {
    if (seek) void goToQuote(seek.quote);
  }, [seek, goToQuote]);

  /**
   * Walk for the passage parked while the book opened, once it is ready.
   *
   * Answers whether one was parked, which is what decides whether a parked turn
   * waits behind it.
   */
  const resumeSeek = useCallback(() => {
    const parked = wanted.current;
    if (parked !== null) void goToQuote(parked);
    return parked !== null;
  }, [goToQuote]);

  return resumeSeek;
}
