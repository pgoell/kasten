/**
 * `![[plan.pdf]]`, a pdf drawn in a note.
 *
 * Drawn with pdf.js onto canvases rather than handed to an `<iframe>`, because
 * a phone browser draws no pdf in a frame: Android Chrome shows a button that
 * downloads it. The widget that holds the box is in `live-preview-embeds.ts`; this is
 * what fills it.
 */

import { Facet } from "@codemirror/state";
import { type Matrix, restoreImages } from "@/lib/pdf-images";

/**
 * Where the pdf.js files sit, which `vite.config.ts` decides and stages.
 *
 * The one copy outside that file, and it has to agree with it. A document whose
 * fonts need predefined character maps, which is most CJK, draws the wrong
 * glyphs without the two folders under it, and the book pane's seek reads the
 * wrong text: `gf` would answer that a passage you can see is not in the book.
 */
export const PDFJS_BASE = "/pdfjs/";

/** The colours a page is drawn in on a dark ground: the paper and the ink. */
export interface PageColors {
  background: string;
  foreground: string;
}

/** One page, measured at scale 1, drawn onto a canvas at any scale. */
export interface PdfPage {
  width: number;
  height: number;
  /** In `colors` when given, and the page as printed when not. */
  draw(canvas: HTMLCanvasElement, scale: number, colors?: PageColors): Promise<void>;
  /** pdf.js's text layer for this page into `container`, at `scale` CSS px per pdf unit. Optional so test fakes may leave it out. */
  text?(container: HTMLElement, scale: number): Promise<void>;
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

/** Frees a canvas's bitmap at once, which dropping the reference would not do. */
function shrink(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * The pane's page colours: the paper and the ink of the dark theme, read off the
 * tokens, or nothing in light, where a page is drawn as printed.
 */
export function pageColors(): PageColors | undefined {
  if (document.documentElement.dataset.theme !== "dark") return undefined;
  const style = getComputedStyle(document.documentElement);
  return {
    background: style.getPropertyValue("--k-paper").trim(),
    foreground: style.getPropertyValue("--k-ink").trim(),
  };
}

/** How a pdf embed opens its file, pdf.js unless a test said otherwise. */
export const pdfRenderer = Facet.define<PdfRenderer, PdfRenderer>({
  combine: (values) => values[0] ?? pdfjsRenderer,
});

/**
 * What the pdf pane adds to `showPdf`, every field optional so the embed passes none.
 */
export interface ShowOptions {
  /** Read at every draw: the colours to draw in, or undefined for the page as printed. */
  colors?: () => PageColors | undefined;
  /** A selectable pdf.js text layer over each drawn page. */
  textLayer?: boolean;
  /** Page width as a share of the box width; 1 (the default) is the page as wide as the box. */
  zoom?: number;
  /** The pdf once open, for thumbnails. */
  onFile?: (file: PdfFile) => void;
  /** The page at the top of the box, from one, whenever it changes. */
  onPage?: (page: number) => void;
  /** A page's text layer finished drawing (also after every redraw), for the take marks. */
  onText?: (page: number, layer: HTMLElement) => void;
}

/** Calling it frees everything, as `showPdf`'s return did before. */
export interface PdfView {
  (): void;
  /** Draws the drawn pages again, in the colours read now. */
  redraw(): void;
  /** Sets the page width as a share of the box, and draws the drawn pages at it. */
  setZoom(zoom: number): void;
  /** Scrolls the box to page `number`, counted from one. */
  goTo(page: number): void;
}

/**
 * Fill `box` with the pdf at `url`, and return a view of it, which frees it.
 *
 * Every page gets a slot the shape of the first page at once, so the box
 * scrolls its whole length before anything is drawn, and a page is drawn when
 * its slot scrolls into view and freed when it scrolls out: a hundred-page pdf
 * in a note costs the pages somebody is looking at. The canvas is as wide as the box when the page is drawn,
 * times the pixel ratio, and its style holds it to the box, so a phone gets a
 * page it can read across without scrolling sideways.
 *
 * `measured` is called whenever the box changes height under a line the editor
 * has already measured. `page` is scrolled to the top of the box, and a page
 * the pdf does not have leaves the first there.
 */
export function showPdf(
  box: HTMLElement,
  renderer: PdfRenderer,
  url: string,
  name: string,
  measured: () => void,
  page?: number,
  options?: ShowOptions,
): PdfView {
  const opening = renderer.open(url);
  let observer: IntersectionObserver | null = null;
  let resizer: ResizeObserver | null = null;
  let gone = false;
  // The pdf once open, and the number of each slot, by slot.
  let file: PdfFile | null = null;
  const numbers = new Map<Element, number>();
  // The page at the top of the box, counted from zero, and how far down it the
  // box is scrolled as a share of its height. `place` scrolls to them.
  let top = 0;
  let share = 0;
  // Whether the resizer last saw the box hidden. Shown again, it is laid out with
  // its scroll at 0, and a browser may say so with a `scroll` before the resizer
  // runs, the event loop taking scroll steps first: that 0 is not a place anyone
  // chose, so no scroll counts until the resizer has put the box back on its place.
  let hidden = false;
  let zoom = options?.zoom ?? 1;

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

  // Gives the slot's canvases and text layer up. Every canvas in it, and not only
  // the one of `canvases`, since a page being drawn again still shows the old one.
  const free = (slot: Element) => {
    for (const canvas of slot.querySelectorAll("canvas")) shrink(canvas);
    canvases.delete(slot);
    // The slot keeps its aspect ratio, so the box does not jump.
    slot.replaceChildren();
  };

  // Draws a page into a new canvas and swaps it in once drawn, so a page drawn
  // again keeps the one it shows until the new one is ready: no blank flash.
  const paint = (pdf: PdfFile, slot: HTMLElement, number: number) => {
    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvases.set(slot, canvas);
    // Whether the slot still wants this canvas, which a page scrolled past
    // while it drew does not.
    const wanted = () => !gone && canvases.get(slot) === canvas;
    pdf
      .page(number)
      .then(async (pdfPage) => {
        if (!wanted()) return;
        // The slot's own width, not the box's: the box's padding is no part of
        // the page, and a scale taken from the padded box lays the text layer
        // wider than its slot, so it overhangs the box and the box scrolls
        // sideways at 100 %. The box's width is the fallback for a slot not yet
        // laid out (jsdom), with the zoom applied since the slot would carry it.
        // The text layer is laid out at the same scale without the pixel ratio,
        // which the canvas alone takes.
        const width = slot.clientWidth || (box.clientWidth || pdfPage.width) * zoom;
        const cssScale = width / pdfPage.width;
        slot.style.aspectRatio = `${pdfPage.width} / ${pdfPage.height}`;
        await pdfPage.draw(canvas, cssScale * window.devicePixelRatio, options?.colors?.());
        if (!wanted()) {
          shrink(canvas);
          return;
        }
        // The text layer goes in with the canvas and is filled after, so the
        // page shows at once and its words follow.
        const layer = options?.textLayer && pdfPage.text ? document.createElement("div") : null;
        if (layer !== null) {
          layer.className = "textLayer";
          // The layer is laid over the page, so the slot is its frame.
          slot.style.position = "relative";
        }
        // Every canvas the slot holds is the one this replaces, a redraw's old
        // one included, so each is shrunk here and not left to the collector.
        for (const old of slot.querySelectorAll("canvas")) shrink(old);
        slot.replaceChildren(...(layer === null ? [canvas] : [canvas, layer]));
        if (layer === null || pdfPage.text === undefined) return;
        await pdfPage.text(layer, cssScale);
        if (wanted()) options?.onText?.(number, layer);
      })
      // Its own `then`, so a page that fails to draw lands in `failed` too.
      .then(undefined, failed);
  };

  // Draws every page drawn or drawing again, in the colours and at the zoom
  // read now.
  const repaint = () => {
    if (file === null) return;
    for (const slot of [...canvases.keys()]) {
      const number = numbers.get(slot);
      if (number !== undefined) paint(file, slot as HTMLElement, number);
    }
  };

  // Scrolls the box to the page `top` and the share down it. The box's own scroll
  // and not `scrollIntoView`, which scrolls every box around it too and would
  // jump the editor. Measured from the first slot, so whatever the slots are
  // placed against drops out.
  const place = () => {
    const pages = [...box.children] as HTMLElement[];
    const head = pages[0] as HTMLElement;
    const slot = pages[top] as HTMLElement;
    box.scrollTop = slot.offsetTop - head.offsetTop + share * slot.offsetHeight;
  };

  opening.file
    .then((pdf) => pdf.page(1).then((first) => ({ pdf, first })))
    .then(({ pdf, first }) => {
      if (gone) return;
      file = pdf;
      options?.onFile?.(pdf);
      box.textContent = "";
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const number = numbers.get(entry.target);
            if (number === undefined) continue;
            if (!entry.isIntersecting) free(entry.target);
            else if (!canvases.has(entry.target)) paint(pdf, entry.target as HTMLElement, number);
          }
        },
        // A screen ahead, so the next page is drawn before it is scrolled to.
        { root: box, rootMargin: "100% 0px" },
      );
      for (let number = 1; number <= pdf.pages; number += 1) {
        const slot = document.createElement("div");
        slot.className = "cm-pdf-page";
        slot.dataset.pdfPage = String(number);
        slot.style.aspectRatio = `${first.width} / ${first.height}`;
        // Left alone at 1, so the embed in a note is laid out as it was.
        if (zoom !== 1) slot.style.width = `${zoom * 100}%`;
        box.append(slot);
        numbers.set(slot, number);
        observer.observe(slot);
      }
      // The box scrolls back to its place whenever it changes size: the browser
      // keeps the scroll in pixels, so a box that changes width, a phone turned
      // or a window resized, would show another page, and one hidden and shown
      // again shows the first. A page and not a share of the whole box, which
      // drifts by the gaps between pages, and those do not grow with the width.
      top = page !== undefined && page <= pdf.pages ? page - 1 : 0;
      share = 0;
      place();
      options?.onPage?.(top + 1);
      const pages = [...box.children] as HTMLElement[];
      box.addEventListener("scroll", () => {
        if (hidden) return;
        // At the end the browser may have cut the scroll short, a last page
        // shorter than the box stopping it inside the page before: that is
        // not a place anyone chose, and the one before it is kept.
        if (box.scrollTop >= box.scrollHeight - box.clientHeight) return;
        const y = box.scrollTop + (pages[0] as HTMLElement).offsetTop;
        let at = 0;
        while (at + 1 < pages.length && (pages[at + 1] as HTMLElement).offsetTop <= y) at += 1;
        const slot = pages[at] as HTMLElement;
        // A hidden box has no layout to read, and keeps the place it had.
        if (slot.offsetHeight === 0) return;
        if (at !== top) options?.onPage?.(at + 1);
        top = at;
        share = (y - slot.offsetTop) / slot.offsetHeight;
      });
      resizer = new ResizeObserver(() => {
        hidden = (pages[top] as HTMLElement).offsetHeight === 0;
        if (!hidden) place();
      });
      resizer.observe(box);
      measured();
    }, failed);

  const setZoom = (next: number) => {
    zoom = next;
    for (const slot of numbers.keys()) (slot as HTMLElement).style.width = `${next * 100}%`;
    if (file !== null && !hidden) place();
    repaint();
  };

  const goTo = (number: number) => {
    if (file === null || number < 1 || number > numbers.size) return;
    if (number - 1 !== top) options?.onPage?.(number);
    top = number - 1;
    share = 0;
    place();
  };

  const dispose = () => {
    gone = true;
    observer?.disconnect();
    resizer?.disconnect();
    for (const slot of numbers.keys()) free(slot);
    opening.destroy();
  };
  return Object.assign(dispose, { redraw: repaint, setZoom, goTo });
}
