import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { BookBeside } from "@/lib/api";
import { findWritten, holdsWritten } from "@/lib/book/find-quote";
import { type FoliateView, pdfLayer } from "@/lib/book/foliate-view";
import { PDFJS_BASE } from "@/lib/book/pdf-view";

/**
 * The little of pdf.js the seek uses: a page's words, reachable without drawing
 * the page. Read off `globalThis`, where foliate's vendored build leaves it, so
 * this is a second reading of the same file, not a second library.
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
 * Open `bytes` with pdf.js, hand the document to `read`, and free it. Bytes it
 * will not open answer `otherwise`. A section foliate could not build is also
 * document-less, so the wrong arm is reachable and must end as an honest miss.
 */
export async function readPdf<T>(
  bytes: ArrayBuffer,
  read: (pdf: OpenPdf) => Promise<T>,
  otherwise: T,
): Promise<T> {
  const pdfjs = (globalThis as { pdfjsLib?: Pdfjs }).pdfjsLib;
  // Only reachable if foliate stops loading that module, which would break the reader first.
  if (pdfjs === undefined) return otherwise;

  // The same options foliate passes, so this reading of the file matches the drawn one.
  // `isEvalSupported` is off: the CSP in `csp.ts` has no `'unsafe-eval'`.
  const task = pdfjs.getDocument({
    data: bytes,
    cMapUrl: `${PDFJS_BASE}cmaps/`,
    standardFontDataUrl: `${PDFJS_BASE}standard_fonts/`,
    isEvalSupported: false,
  });
  const opened = await task.promise.then(
    (pdf) => pdf,
    // Two-arm `then`, not a catch: the error is pdf.js's own, for a file that is not a pdf.
    () => null,
  );
  // Free the task, not the document, which does not exist: pdf.js spawns a worker
  // before it parses, so a refused file would leave one running for the life of the tab.
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
 * Which page of `bytes` holds `quote`, counting from zero, or -1. Reads the text
 * without drawing any page. The runs join with nothing between them, as the text
 * layer does, so matches agree with the drawn document. `keep` ends the walk early.
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
 * Answers `resumeSeek` once the book is ready, and whether a passage was parked
 * while it opened, since a parked turn waits behind it.
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
  // Read through refs: `goToQuote` then has only stable dependencies, so the effect
  // naming it rebuilds no book. The layout effect keeps them current before a key lands.
  const besideRef = useRef<BookBeside | undefined>(undefined);
  const onNoticeRef = useRef(onNotice);
  useLayoutEffect(() => {
    onNoticeRef.current = onNotice;
    besideRef.current = beside;
  });

  /**
   * Take the reader to the first section holding `quote`. A walk costs about 70ms
   * on a real book, so there is no progress, spinner or cancel.
   */
  const goToQuote = useCallback(
    async (quote: string[]) => {
      const view = viewRef.current;
      wanted.current = quote;
      // A seek before the book is ready waits here. `draw()` reads `wanted` once `init`
      // has landed, and the passage then overrides where the bookmark put the reader.
      if (view === null || !ready.current) return;

      /** Whether this walk is still the one being waited on. See the epub arm. */
      const mine = () => viewRef.current === view && wanted.current === quote;

      const sections = view.book?.sections ?? [];
      // A pdf section carries no `createDocument`, so the epub walk would miss every
      // passage. The page on screen decides the arm, not the spine: an epub section
      // foliate could not build lacks one too.
      // ponytail: a press during `replaceChildren` sees no text layer and may answer a miss; one more press finds it.
      const onScreen = view.renderer?.getContents?.() ?? [];
      if (onScreen.some((entry) => pdfLayer(entry.doc) !== null)) {
        const bytes = await besideRef.current?.blob.arrayBuffer();
        const page = bytes === undefined ? -1 : await pdfPageHolding(bytes, quote, mine);
        if (!mine()) return;
        if (page !== -1) {
          wanted.current = null;
          // The page index, which `resolveNavigation` takes as it stands. No cfi: a
          // fixed-layout renderer goes to a page and reads no anchor.
          void view.goTo(page);
          return;
        }
      } else {
        for (const [index, section] of sections.entries()) {
          if (section.createDocument === undefined) continue;
          const doc = await section.createDocument();
          // A newer press or a closed pane ends the walk; in-flight `goTo` calls are unordered.
          if (!mine()) return;
          const [range] = findWritten(doc, [quote]);
          if (range) {
            wanted.current = null;
            void view.goTo(view.getCFI(index, range));
            return;
          }
        }
      }

      // Cleared on hit or miss, so nothing stays armed for a rebuilt view.
      wanted.current = null;
      // A press gets an answer, unlike the draw pass, which skips a quote silently.
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
