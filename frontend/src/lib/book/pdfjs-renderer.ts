/**
 * pdf.js, which `showPdf` in `pdf-view.ts` draws pages with, and the little of
 * its interface this uses.
 */

import { type Matrix, restoreImages } from "@/lib/book/pdf-images";
import type { PageColors, PdfRenderer } from "@/lib/book/pdf-view";

/**
 * Where the pdf.js files sit, which `vite.config.ts` decides and stages.
 *
 * The one copy outside that file, and it has to agree with it. A document whose
 * fonts need predefined character maps, which is most CJK, draws the wrong
 * glyphs without the two folders under it, and the book pane's seek reads the
 * wrong text: `gf` would answer that a passage you can see is not in the book.
 */
export const PDFJS_BASE = "/pdfjs/";

/** The little of pdf.js this draws with. */
interface Pdfjs {
  GlobalWorkerOptions: { workerSrc: string };
  /** The operator codes of a page's operator list, by name. */
  OPS: Record<string, number>;
  TextLayer: new (options: {
    textContentSource: ReadableStream;
    container: HTMLElement;
    viewport: PdfjsViewport;
  }) => { render(): Promise<void> };
  getDocument(options: {
    url: string;
    cMapUrl: string;
    standardFontDataUrl: string;
    isEvalSupported: boolean;
  }): {
    promise: Promise<{
      numPages: number;
      getPage(page: number): Promise<PdfjsPage>;
    }>;
    destroy(): Promise<void>;
  };
}

interface PdfjsViewport {
  width: number;
  height: number;
  transform: Matrix;
}

interface PdfjsPage {
  getViewport(options: { scale: number }): PdfjsViewport;
  render(options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfjsViewport;
    pageColors?: PageColors;
  }): { promise: Promise<void> };
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  streamTextContent(): ReadableStream;
  getTextContent(): Promise<{ items: { str?: string; hasEOL?: boolean }[] }>;
}

/**
 * pdf.js, opened the way foliate opens its own (`pdf.js:120-127`).
 *
 * Exported for the pdf pane, which holds no editor state to read the facet off.
 *
 * The worker is set the way foliate sets it, once, against the same staged
 * file, so whichever of the two opens a pdf first the worker resolves in the
 * build. A URL rather than the bytes, so pdf.js asks
 * for the ranges it needs and a long pdf's first page does not wait on its last.
 * `isEvalSupported` is off because the policy in `csp.ts` has no `'unsafe-eval'`.
 */
export const pdfjsRenderer: PdfRenderer = {
  open(url) {
    let task: ReturnType<Pdfjs["getDocument"]> | null = null;
    let gone = false;
    const file = (async () => {
      // A dynamic import, which `.claude/CLAUDE.md` allows, as it does KaTeX's
      // and mermaid's: a static one put pdf.js, 118 kB gzipped, on every editor page
      // whether or not a note held a pdf (#327). Loaded for its side effect,
      // `globalThis.pdfjsLib`; the vendored build exports nothing. The same
      // file foliate's own `pdf.js` imports, through the alias in
      // `vite.config.ts`, so the reader and this share one copy.
      await import("foliate-pdfjs");
      // An embed that left while pdf.js loaded opens nothing, so no task is
      // left behind with nobody to free it.
      if (gone) throw new Error("pdf embed closed before pdf.js loaded");
      const pdfjs = (globalThis as { pdfjsLib?: Pdfjs }).pdfjsLib as Pdfjs;
      pdfjs.GlobalWorkerOptions.workerSrc ||= `${PDFJS_BASE}pdf.worker.mjs`;
      task = pdfjs.getDocument({
        url,
        cMapUrl: `${PDFJS_BASE}cmaps/`,
        standardFontDataUrl: `${PDFJS_BASE}standard_fonts/`,
        isEvalSupported: false,
      });
      return task.promise;
    })();
    return {
      file: file.then((pdf) => {
        // Set by the time a page is asked for, because the file has loaded.
        const lib = (globalThis as { pdfjsLib?: Pdfjs }).pdfjsLib as Pdfjs;
        return {
          pages: pdf.numPages,
          async page(number) {
            const page = await pdf.getPage(number);
            const { width, height } = page.getViewport({ scale: 1 });
            return {
              width,
              height,
              async draw(canvas, scale, colors) {
                const viewport = page.getViewport({ scale });
                canvas.width = Math.floor(viewport.width);
                canvas.height = Math.floor(viewport.height);
                const canvasContext = canvas.getContext("2d");
                if (canvasContext === null) return;
                await page.render({ canvasContext, viewport, pageColors: colors }).promise;
                if (colors !== undefined)
                  await restoreImages(page, lib.OPS, canvasContext, viewport);
              },
              async content() {
                return (await page.getTextContent()).items;
              },
              async text(container, scale) {
                // What pdf.js sizes its text layer with, which foliate sets on the
                // document the same way.
                container.style.setProperty("--total-scale-factor", String(scale));
                container.style.setProperty("--scale-round-x", "1px");
                container.style.setProperty("--scale-round-y", "1px");
                const layer = new lib.TextLayer({
                  textContentSource: page.streamTextContent(),
                  container,
                  viewport: page.getViewport({ scale }),
                });
                await layer.render();
                // The end of the text, which a drag past the last word selects
                // up to, as pdf.js's own viewer and foliate both add it.
                const end = document.createElement("div");
                end.className = "endOfContent";
                container.append(end);
                container.onpointerdown = () => container.classList.add("selecting");
                container.onpointerup = () => container.classList.remove("selecting");
              },
            };
          },
        };
      }),
      // The task and not the document: the document's own `destroy` is this
      // one, and a task freed before its document landed takes its worker with it.
      destroy: () => {
        gone = true;
        void task?.destroy();
      },
    };
  },
};
