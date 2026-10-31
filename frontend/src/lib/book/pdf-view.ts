/**
 * `![[plan.pdf]]`, a pdf drawn in a note with pdf.js onto canvases. An iframe would not draw a pdf
 * on a phone, where Android Chrome shows a download button. The widget is in `live-preview-embeds.ts`.
 */

import { Facet } from "@codemirror/state";
import { type BoxPoint, listenForPinch } from "@/lib/book/pdf-pinch";
import { pdfjsRenderer } from "@/lib/book/pdfjs-renderer";

// pdf.js itself, kept in its own file; named here too, where the pane and the
// seek have always found it.
export { PDFJS_BASE, pdfjsRenderer } from "@/lib/book/pdfjs-renderer";

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
  /** The page's text items, parsed and not drawn, for RSVP. Optional for the reason `text` is. */
  content?(): Promise<{ str?: string; hasEOL?: boolean }[]>;
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
  /** Two fingers zoom the page and a double tap toggles fit width and `READING_ZOOM` (#991). */
  pinch?: boolean;
  /** The zoom a pinch or a double tap landed on, once the fingers are off. */
  onZoom?: (zoom: number) => void;
}

/** The narrowest and widest a pinch takes the page, as a share of the box: the zoom buttons' ends. */
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3;
/** Where a double tap at fit width goes: a phone's A4 page at about 88 % of its print size. */
export const READING_ZOOM = 2;
/** How long after a ctrl+wheel the zoom waits for the next before it is rounded and drawn. */
const WHEEL_SETTLE_MS = 150;

/** Calling it frees everything, as `showPdf`'s return did before. */
export interface PdfView {
  (): void;
  /** Draws the drawn pages again, in the colours read now. */
  redraw(): void;
  /**
   * Sets the page width as a share of the box, and draws the drawn pages at it.
   * With `at`, the point of the page under `at` stays there; without, the page at the top does.
   */
  setZoom(zoom: number, at?: BoxPoint): void;
  /** Scrolls the box to page `number`, counted from one. */
  goTo(page: number): void;
}

/**
 * Fill `box` with the pdf at `url`, and return a view of it, which frees it. Every page gets a slot
 * the shape of the first, so the box scrolls its full length, and a page is drawn in view and freed out of it.
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
  // The page and the point on it that sat between the fingers, while a pinch is under way.
  let pinching: { slot: HTMLElement; fx: number; fy: number } | null = null;
  // Where the fingers or the pointer were last, which the point under them goes back to after the rounding.
  let last: BoxPoint = { x: 0, y: 0 };
  // The wait after a ctrl+wheel for the next one, which ends its zoom when it runs out.
  let settle: ReturnType<typeof setTimeout> | undefined;
  // The scroll the last wheel turn left, so a scroll made before its zoom ends is kept.
  let wheeled: { left: number; top: number } | null = null;

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
        const cssScale = slotWidth(slot, box, pdfPage.width, zoom) / pdfPage.width;
        slot.style.aspectRatio = `${pdfPage.width} / ${pdfPage.height}`;
        await pdfPage.draw(canvas, cssScale * window.devicePixelRatio, options?.colors?.());
        if (!wanted()) {
          shrink(canvas);
          return;
        }
        // The text layer goes in with the canvas and is filled after, so the
        // page shows at once and its words follow.
        const layer = textLayerFor(slot, Boolean(options?.textLayer && pdfPage.text));
        swapIn(slot, canvas, layer);
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

  // Draws a page as it comes within a screen of the box, and frees it as it leaves.
  const seen = (pdf: PdfFile, entry: IntersectionObserverEntry) => {
    const number = numbers.get(entry.target);
    if (number === undefined) return;
    if (!entry.isIntersecting) free(entry.target);
    // Not while fingers pinch: every move is another zoom, and pdf.js
    // would draw each one. The pages are drawn once the fingers are off.
    else if (!canvases.has(entry.target) && pinching === null)
      paint(pdf, entry.target as HTMLElement, number);
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
          for (const entry of entries) seen(pdf, entry);
        },
        // A screen ahead, so the next page is drawn before it is scrolled to.
        { root: box, rootMargin: "100% 0px" },
      );
      for (let number = 1; number <= pdf.pages; number += 1) {
        const slot = slotFor(number, first, zoom);
        box.append(slot);
        numbers.set(slot, number);
        observer.observe(slot);
      }
      // The box scrolls back to its place whenever it changes size: the browser
      // keeps the scroll in pixels, so a box that changes width, a phone turned
      // or a window resized, would show another page, and one hidden and shown
      // again shows the first. A page and not a share of the whole box, which
      // drifts by the gaps between pages, and those do not grow with the width.
      top = firstShown(page, pdf.pages);
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
        const at = pageAt(pages, y);
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

  const resize = (next: number) => {
    zoom = next;
    for (const slot of numbers.keys()) (slot as HTMLElement).style.width = `${next * 100}%`;
  };

  // The slot under `at` and where in it `at` falls, as shares of its width and height.
  const under = (at: BoxPoint) => {
    const x = box.scrollLeft + at.x;
    const y = box.scrollTop + at.y;
    const slots = [...numbers.keys()] as HTMLElement[];
    let slot = slots[0] as HTMLElement;
    for (const one of slots) if (one.offsetTop <= y) slot = one;
    return {
      slot,
      fx: (x - slot.offsetLeft) / slot.offsetWidth,
      fy: (y - slot.offsetTop) / slot.offsetHeight,
    };
  };

  // Scrolls so the point `fx`, `fy` of `slot` sits under `at`. The scroll
  // listener then reads the page at the top off it, as after any scroll.
  const pin = (slot: HTMLElement, fx: number, fy: number, at: BoxPoint) => {
    box.scrollLeft = slot.offsetLeft + fx * slot.offsetWidth - at.x;
    box.scrollTop = slot.offsetTop + fy * slot.offsetHeight - at.y;
  };

  // Ends a pinch or a wheel zoom: the zoom is rounded, the pages drawn at it and
  // the pane told. `quiet` only lets go of it, for a zoom set straight after,
  // which draws and tells the pane itself.
  const settled = (quiet = false) => {
    clearTimeout(settle);
    settle = undefined;
    const moved =
      wheeled !== null && (box.scrollLeft !== wheeled.left || box.scrollTop !== wheeled.top);
    wheeled = null;
    if (pinching === null) return;
    const { slot, fx, fy } = pinching;
    pinching = null;
    // A whole percent, which the readout shows and the buttons step from.
    // The gaps between pages do not grow with the zoom, so far down a long
    // pdf even that small step moves the page: it is pinned again, unless the
    // reader scrolled since the last wheel turn, a scroll that pin would undo.
    resize(Math.round(zoom * 100) / 100);
    if (!moved) pin(slot, fx, fy, last);
    if (!quiet) repaint();
    // Every slot again, so the ones the pinch brought into view are drawn
    // and the ones it pushed out are freed.
    if (observer !== null) {
      observer.disconnect();
      for (const slot of numbers.keys()) observer.observe(slot);
    }
    if (!quiet) options?.onZoom?.(zoom);
  };

  const setZoom = (next: number, at?: BoxPoint) => {
    // A button pressed while a wheel zoom waits for its next turn ends that zoom
    // first, so it cannot pin a stale point after the button's; the button's
    // zoom is the one the pane holds, so the wheel's is not reported over it.
    if (settle !== undefined) settled(true);
    if (file === null || hidden || at === undefined) {
      resize(next);
      if (file !== null && !hidden) place();
    } else {
      const { slot, fx, fy } = under(at);
      resize(next);
      pin(slot, fx, fy, at);
    }
    repaint();
  };

  if (options?.pinch) {
    const clamp = (value: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
    let start = 1;
    listenForPinch(box, {
      ready: () => file !== null && !hidden,
      begin(at) {
        settled();
        start = zoom;
        last = at;
        pinching = under(at);
      },
      move(scale, at) {
        if (pinching === null) return;
        last = at;
        resize(clamp(start * scale));
        pin(pinching.slot, pinching.fx, pinching.fy, at);
      },
      end: () => settled(),
      doubleTap(at) {
        setZoom(zoom === 1 ? READING_ZOOM : 1, at);
        options.onZoom?.(zoom);
      },
      // About the pointer where it is now, the mouse being free to move between
      // notches, and from the zoom now, so a wheel turned back at a limit zooms
      // back at once. The pages are drawn once the turns stop.
      wheel(factor, at) {
        last = at;
        pinching = under(at);
        resize(clamp(zoom * factor));
        pin(pinching.slot, pinching.fx, pinching.fy, at);
        wheeled = { left: box.scrollLeft, top: box.scrollTop };
        clearTimeout(settle);
        settle = setTimeout(settled, WHEEL_SETTLE_MS);
      },
    });
  }

  const goTo = (number: number) => {
    if (file === null || number < 1 || number > numbers.size) return;
    if (number - 1 !== top) options?.onPage?.(number);
    top = number - 1;
    share = 0;
    place();
  };

  const dispose = () => {
    gone = true;
    clearTimeout(settle);
    observer?.disconnect();
    resizer?.disconnect();
    for (const slot of numbers.keys()) free(slot);
    opening.destroy();
  };
  return Object.assign(dispose, { redraw: repaint, setZoom, goTo });
}

/**
 * The width a page is drawn at. The slot's own width, not the box's: the box's padding is no part of
 * the page, and a scale taken from the padded box lays the text layer wider than its slot, so it
 * overhangs the box and the box scrolls sideways at 100 %. The box's width is the fallback for a slot
 * not yet laid out (jsdom), with the zoom applied since the slot would carry it.
 */
function slotWidth(slot: HTMLElement, box: HTMLElement, pageWidth: number, zoom: number): number {
  return slot.clientWidth || (box.clientWidth || pageWidth) * zoom;
}

/** A page's text layer, laid over its slot, or null for none. */
function textLayerFor(slot: HTMLElement, wanted: boolean): HTMLDivElement | null {
  if (!wanted) return null;
  const layer = document.createElement("div");
  layer.className = "textLayer";
  // The layer is laid over the page, so the slot is its frame.
  slot.style.position = "relative";
  return layer;
}

/**
 * Show `canvas`, and `layer` over it, in `slot`. Every canvas the slot holds is the one this
 * replaces, a redraw's old one included, so each is shrunk here and not left to the collector.
 */
function swapIn(slot: HTMLElement, canvas: HTMLCanvasElement, layer: HTMLDivElement | null): void {
  for (const old of slot.querySelectorAll("canvas")) shrink(old);
  slot.replaceChildren(...(layer === null ? [canvas] : [canvas, layer]));
}

/** Page `number`'s empty slot, shaped like the first page. */
function slotFor(
  number: number,
  first: { width: number; height: number },
  zoom: number,
): HTMLDivElement {
  const slot = document.createElement("div");
  slot.className = "cm-pdf-page";
  slot.dataset.pdfPage = String(number);
  slot.style.aspectRatio = `${first.width} / ${first.height}`;
  // Left alone at 1, so the embed in a note is laid out as it was.
  if (zoom !== 1) slot.style.width = `${zoom * 100}%`;
  return slot;
}

/** The index of the page to open at: `page`'s, or the first. */
function firstShown(page: number | undefined, pages: number): number {
  return page !== undefined && page <= pages ? page - 1 : 0;
}

/** The index of the last page whose top is at or above `y`. */
function pageAt(pages: HTMLElement[], y: number): number {
  let at = 0;
  while (at + 1 < pages.length && (pages[at + 1] as HTMLElement).offsetTop <= y) at += 1;
  return at;
}
