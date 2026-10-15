/**
 * `![[plan.pdf]]`, a pdf drawn in a note.
 *
 * Drawn with pdf.js onto canvases rather than handed to an `<iframe>`, because
 * a phone browser draws no pdf in a frame: Android Chrome shows a button that
 * downloads it. The widget that holds the box is in `live-preview.ts`; this is
 * what fills it.
 */

import { Facet } from "@codemirror/state";

/**
 * Where the pdf.js files sit, which `vite.config.ts` decides and stages.
 *
 * The one copy outside that file, and it has to agree with it. A document whose
 * fonts need predefined character maps, which is most CJK, draws the wrong
 * glyphs without the two folders under it, and the book pane's seek reads the
 * wrong text: `gf` would answer that a passage you can see is not in the book.
 */
export const PDFJS_BASE = "/pdfjs/";

/** One page, measured at scale 1, drawn onto a canvas at any scale. */
export interface PdfPage {
  width: number;
  height: number;
  draw(canvas: HTMLCanvasElement, scale: number): Promise<void>;
}

/** An opened pdf, its pages counted from one. */
export interface PdfFile {
  pages: number;
  page(number: number): Promise<PdfPage>;
}

/** A pdf on its way in, and what frees it whether or not it has landed. */
export interface PdfOpening {
  file: Promise<PdfFile>;
  destroy(): void;
}

/** Opens the pdf at a URL. A facet so a test can hand the widget a fake. */
export interface PdfRenderer {
  open(url: string): PdfOpening;
}

/** The little of pdf.js this draws with. */
interface Pdfjs {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(options: {
    url: string;
    cMapUrl: string;
    standardFontDataUrl: string;
    isEvalSupported: boolean;
  }): {
    promise: Promise<{
      numPages: number;
      getPage(page: number): Promise<{
        getViewport(options: { scale: number }): { width: number; height: number };
        render(options: {
          canvasContext: CanvasRenderingContext2D;
          viewport: { width: number; height: number };
        }): { promise: Promise<void> };
      }>;
    }>;
    destroy(): Promise<void>;
  };
}

/**
 * pdf.js, opened the way foliate opens its own (`pdf.js:120-127`).
 *
 * The worker is set the way foliate sets it, once, against the same staged
 * file, so whichever of the two opens a pdf first the worker resolves in the
 * build. A URL rather than the bytes, so pdf.js asks
 * for the ranges it needs and a long pdf's first page does not wait on its last.
 * `isEvalSupported` is off because the policy in `csp.ts` has no `'unsafe-eval'`.
 */
const pdfjsRenderer: PdfRenderer = {
  open(url) {
    let task: ReturnType<Pdfjs["getDocument"]> | null = null;
    let gone = false;
    const file = (async () => {
      // The one dynamic import in kasten's own code, which `.claude/CLAUDE.md`
      // allows: a static one put pdf.js, 118 kB gzipped, on every editor page
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
      file: file.then((pdf) => ({
        pages: pdf.numPages,
        async page(number) {
          const page = await pdf.getPage(number);
          const { width, height } = page.getViewport({ scale: 1 });
          return {
            width,
            height,
            async draw(canvas, scale) {
              const viewport = page.getViewport({ scale });
              canvas.width = Math.floor(viewport.width);
              canvas.height = Math.floor(viewport.height);
              const canvasContext = canvas.getContext("2d");
              if (canvasContext === null) return;
              await page.render({ canvasContext, viewport }).promise;
            },
          };
        },
      })),
      // The task and not the document: the document's own `destroy` is this
      // one, and a task freed before its document landed takes its worker with it.
      destroy: () => {
        gone = true;
        void task?.destroy();
      },
    };
  },
};

/** How a pdf embed opens its file, pdf.js unless a test said otherwise. */
export const pdfRenderer = Facet.define<PdfRenderer, PdfRenderer>({
  combine: (values) => values[0] ?? pdfjsRenderer,
});

/**
 * Fill `box` with the pdf at `url`, and return what frees it.
 *
 * Every page gets a slot the shape of the first page at once, so the box
 * scrolls its whole length before anything is drawn, and a page is drawn when
 * its slot scrolls into view and freed when it scrolls out: a hundred-page pdf
 * in a note costs the pages somebody is looking at. The canvas is as wide as the box when the page is drawn,
 * times the pixel ratio, and its style holds it to the box, so a phone gets a
 * page it can read across without scrolling sideways.
 *
 * `measured` is called whenever the box changes height under a line the editor
 * has already measured.
 */
export function showPdf(
  box: HTMLElement,
  renderer: PdfRenderer,
  url: string,
  name: string,
  measured: () => void,
): () => void {
  const opening = renderer.open(url);
  let observer: IntersectionObserver | null = null;
  let gone = false;

  const failed = () => {
    if (gone) return;
    box.classList.add("cm-embed-missing");
    box.textContent = `Could not read ${name}`;
    measured();
  };

  // The canvas of every slot drawn or drawing, by slot. A page that leaves view
  // gives its canvas up: at the box's width times the pixel ratio one is some
  // megabytes, and Safari on a phone stops drawing canvases at all once a long
  // pdf scrolled end to end holds every page.
  const canvases = new Map<Element, HTMLCanvasElement>();

  const free = (slot: Element) => {
    const canvas = canvases.get(slot);
    if (canvas === undefined) return;
    canvases.delete(slot);
    // Shrunk and not only dropped, which is what hands the bitmap back at once
    // rather than whenever the collector gets to it.
    canvas.width = 0;
    canvas.height = 0;
    // The slot keeps its aspect ratio, so the box does not jump.
    slot.replaceChildren();
  };

  const draw = (file: PdfFile, slot: HTMLElement, number: number) => {
    if (canvases.has(slot)) return;
    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvases.set(slot, canvas);
    // Whether the slot still wants this canvas, which a page scrolled past
    // while it drew does not.
    const wanted = () => !gone && canvases.get(slot) === canvas;
    file
      .page(number)
      .then((page) => {
        if (!wanted()) return;
        // jsdom and a box not yet laid out have no width; the page's own
        // keeps the scale off zero.
        const scale = ((box.clientWidth || page.width) / page.width) * window.devicePixelRatio;
        slot.style.aspectRatio = `${page.width} / ${page.height}`;
        return page.draw(canvas, scale);
      })
      // Its own `then`, so a page that fails to draw lands in `failed` too.
      .then(() => {
        if (wanted()) slot.replaceChildren(canvas);
        else {
          canvas.width = 0;
          canvas.height = 0;
        }
      }, failed);
  };

  opening.file
    .then((file) => file.page(1).then((first) => ({ file, first })))
    .then(({ file, first }) => {
      if (gone) return;
      box.textContent = "";
      const slots = new Map<Element, number>();
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const number = slots.get(entry.target);
            if (number === undefined) continue;
            if (entry.isIntersecting) draw(file, entry.target as HTMLElement, number);
            else free(entry.target);
          }
        },
        // A screen ahead, so the next page is drawn before it is scrolled to.
        { root: box, rootMargin: "100% 0px" },
      );
      for (let number = 1; number <= file.pages; number += 1) {
        const slot = document.createElement("div");
        slot.className = "cm-pdf-page";
        slot.style.aspectRatio = `${first.width} / ${first.height}`;
        box.append(slot);
        slots.set(slot, number);
        observer.observe(slot);
      }
      measured();
    }, failed);

  return () => {
    gone = true;
    observer?.disconnect();
    for (const slot of [...canvases.keys()]) free(slot);
    opening.destroy();
  };
}
