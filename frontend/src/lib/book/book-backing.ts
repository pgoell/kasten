/**
 * Which images get a white page of their own (#469, #475), decided per image by its
 * pixels, since white behind a letterboxed cover shows as bars. Small glyphs get `INK` (#478, #483).
 */

import { fontFaces } from "@/lib/book/book-fonts";
import { currentTheme } from "@/lib/theme";

/** The attribute the page's stylesheet reads to draw white behind an image. */
export const BACKING = "data-kasten-backing";

/** The attribute the page's stylesheet reads to invert a small dark glyph. */
export const INK = "data-kasten-ink";

/** What the page does for one image: white behind it, inverted, or nothing. */
export type Treatment = "white" | "ink" | "plain";

/**
 * How dark and grey a pixel may be and still count as ink. Each pixel weighs by its
 * alpha, so a white matte's light edges do not outvote a small glyph's solid black.
 */
const INK_MAX = 96;
const INK_SPREAD = 48;
const INK_SHARE = 0.9;

/** The longest side of the copy whose alpha is read. A thumbnail answers as well as the whole. */
const SIDE = 64;

/** The image's pixels as RGBA bytes, the shape `getImageData` hands back. */
export type ReadPixels = (img: HTMLImageElement) => Uint8ClampedArray;

/**
 * Draw the image small onto a canvas and read it back. Epub resources are same-origin
 * `blob:` URLs, so a cross-origin image taints the canvas and `treatmentFor` answers the throw.
 */
function canvasPixels(img: HTMLImageElement): Uint8ClampedArray {
  const scale = Math.min(1, SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = img.ownerDocument.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  // A fresh canvas has no other context yet, the one case `getContext` answers null.
  const context = canvas.getContext("2d", {
    willReadFrequently: true,
  }) as CanvasRenderingContext2D;
  context.drawImage(img, 0, 0, width, height);
  return context.getImageData(0, 0, width, height).data;
}

/**
 * Whether the image is small enough to sit in a line of text. An icon set into a sentence
 * is read against its words, so a white box would stand out of the line.
 */
function inline(element: Element, view: Window): boolean {
  const height = element.getBoundingClientRect().height;
  const font = Number.parseFloat(view.getComputedStyle(element.parentElement ?? element).fontSize);
  return height > 0 && height <= font * 1.5;
}

/** The raster an svg draws through its `<image>`, read as an img of its own. */
function raster(svg: SVGSVGElement): HTMLImageElement {
  const image = svg.querySelector("image") as SVGElement;
  const img = svg.ownerDocument.createElement("img");
  img.src = image.getAttribute("href") ?? image.getAttribute("xlink:href") ?? "";
  return img;
}

/**
 * A cover whose box draws bars round its picture, judged by the bars, since every img
 * carries `object-fit`. Only a text-free page counts: a chapter diagram's bars are a smaller harm.
 */
function letterboxed(img: HTMLImageElement, view: Window): boolean {
  if (img.ownerDocument.body?.textContent?.trim() !== "") return false;
  const fit = view.getComputedStyle(img).objectFit;
  if (fit !== "contain" && fit !== "scale-down") return false;
  const box = img.getBoundingClientRect();
  const picture = img.naturalWidth / img.naturalHeight;
  return Math.abs(box.width / box.height - picture) > picture * 0.02;
}

/** Wait for the image to load or fail. True for a picture, false for a broken one. */
function loaded(img: HTMLImageElement): Promise<boolean> {
  if (img.complete) return Promise.resolve(img.naturalWidth > 0);
  return new Promise((resolve) => {
    img.addEventListener("load", () => resolve(img.naturalWidth > 0), { once: true });
    img.addEventListener("error", () => resolve(false), { once: true });
  });
}

/**
 * What the pixels show: whether any is see-through, and how much is visible
 * and how much of that dark ink.
 */
function survey(pixels: Uint8ClampedArray): { seeThrough: boolean; visible: number; dark: number } {
  let seeThrough = false;
  // Both summed in alpha, not counted in pixels.
  let visible = 0;
  let dark = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    // In bounds, `getImageData` handing back whole RGBA quads.
    const r = pixels[index] as number;
    const g = pixels[index + 1] as number;
    const b = pixels[index + 2] as number;
    const alpha = pixels[index + 3] as number;
    if (alpha < 255) seeThrough = true;
    visible += alpha;
    const max = Math.max(r, g, b);
    if (max <= INK_MAX && max - Math.min(r, g, b) <= INK_SPREAD) dark += alpha;
  }
  return { seeThrough, visible, dark };
}

/**
 * What the page does for an img, or an svg's `<image>`: white behind it, inverted, or nothing.
 * Read through the element's own window, since the section lives in foliate's iframe.
 */
export async function treatmentFor(
  element: HTMLImageElement | SVGSVGElement,
  readPixels: ReadPixels = canvasPixels,
): Promise<Treatment> {
  const svg = element.localName === "svg";
  const img = svg ? raster(element as SVGSVGElement) : (element as HTMLImageElement);
  // Everything below reads layout, so it waits even for an image already
  // loaded. foliate's `load` arrives while the iframe is hidden and before its
  // render, and the await resumes once that render has laid the chapter out
  // (`paginator.js:256-272`). Until then every box is zero.
  // A broken image draws its alt text, black, which needs the white to read.
  // An svg has no alt text to keep legible.
  if (!(await loaded(img))) return svg ? "plain" : "white";
  // The pane closed while the image loaded, and there is no page left to draw.
  const view = element.ownerDocument.defaultView;
  if (view === null) return "plain";
  if (!svg && letterboxed(img, view)) return "plain";
  const small = inline(element, view);
  // A larger svg holding an image is a calibre cover page, a raster fitted
  // into a page-sized svg, and the bars round the picture are page (#474).
  if (svg && !small) return "plain";

  const pixels = pixelsOf(img, view, readPixels);
  // Another origin's image keeps the white #469 gave every image, unless it
  // sits in a line of text, which never had white.
  if (pixels === null) return small ? "plain" : "white";
  return verdict(pixels, small);
}

/**
 * The image's pixels, or null for another origin's image, which cannot be read. The canvas lives
 * in the chapter's iframe, so what it throws is that window's DOMException and not this one's.
 */
function pixelsOf(
  img: HTMLImageElement,
  view: Window,
  readPixels: ReadPixels,
): Uint8ClampedArray | null {
  try {
    return readPixels(img);
  } catch (error) {
    const Thrown = (view as Window & typeof globalThis).DOMException;
    if (error instanceof Thrown && error.name === "SecurityError") return null;
    throw error;
  }
}

/** What the pixels of a readable image call for. */
function verdict(pixels: Uint8ClampedArray, small: boolean): Treatment {
  const { seeThrough, visible, dark } = survey(pixels);
  // A spacer, however far it is stretched, shows nothing to back or invert (#482).
  if (visible === 0) return "plain";
  // An opaque image is a picture of its own, not ink.
  if (small) return seeThrough && dark >= visible * INK_SHARE ? "ink" : "plain";
  return seeThrough ? "white" : "plain";
}

/**
 * The latest decision started for each element watched, which is also the
 * mark that `backImages` watches it already.
 */
const turns = new WeakMap<Element, number>();

/**
 * Decide `element` and mark it, unless a newer decision has started. Two decisions of one image
 * can finish out of order, and the older verdict is for a size or picture already gone.
 */
function decide(element: HTMLImageElement | SVGSVGElement): void {
  const turn = (turns.get(element) ?? 0) + 1;
  turns.set(element, turn);
  void treatmentFor(element).then((treatment) => {
    if (turns.get(element) !== turn) return;
    element.toggleAttribute(BACKING, treatment === "white");
    element.toggleAttribute(INK, treatment === "ink");
  });
}

/**
 * Decide each image again when its box, or its block's box, changes (#481), since an
 * inline parent reports 0x0. Answers the observer, or nothing for a section with no image.
 */
export function backImages(doc: Document): ResizeObserver | undefined {
  const svgs = [...doc.querySelectorAll("svg image")].map(
    (image) => image.closest("svg") as SVGSVGElement,
  );
  // A set, since an svg holding two images is found twice.
  const elements = [...new Set([...doc.querySelectorAll("img"), ...svgs])].filter(
    (element) => !turns.has(element),
  );
  if (elements.length === 0) return undefined;

  // From the section's window, as `treatmentFor` takes its DOMException.
  const view = doc.defaultView as Window & typeof globalThis;
  const observer = new view.ResizeObserver((entries) => {
    const changed = new Set<HTMLImageElement | SVGSVGElement>();
    for (const { target } of entries)
      for (const element of [target, ...target.querySelectorAll("img, svg")])
        if (turns.has(element)) changed.add(element as HTMLImageElement | SVGSVGElement);
    for (const element of changed) decide(element);
  });
  for (const element of elements) {
    observer.observe(element);
    let block = element.parentElement;
    while (block?.parentElement && view.getComputedStyle(block).display === "inline")
      block = block.parentElement;
    if (block) observer.observe(block);
    if (element.localName === "img") element.addEventListener("load", () => decide(element));
    decide(element);
  }
  return observer;
}

/**
 * Fit a picture-only section to the pane's height (#902). foliate's max-height is NaNpx
 * in a scrolled flow, so the browser drops it and the cover runs off the pane's foot.
 */
export function fitCover(doc: Document, renderer: HTMLElement): ResizeObserver | undefined {
  const body = doc.body;
  if (body?.textContent?.trim() !== "") return undefined;
  // The attribute is a length such as `48px`, as foliate takes it.
  const margin = Number.parseFloat(renderer.getAttribute("margin") ?? "48");
  const sizeToPane = () => {
    const height = `${renderer.getBoundingClientRect().height - margin * 2}px`;
    for (const element of body.querySelectorAll<HTMLElement | SVGElement>("img, svg"))
      element.style.setProperty("max-height", height, "important");
  };
  sizeToPane();
  // Foliate's own `NaNpx` is dropped on every render, so this value stands.
  const observer = new ResizeObserver(sizeToPane);
  observer.observe(renderer);
  return observer;
}

/**
 * The app's colours, `!important` with an id's weight so a book's stylesheet cannot put black on the dark page (#467, #470, #471, #475).
 * `<mark>` keeps its own colours; the image and svg rules carry a second `:not(#\#)` to outweigh the link rule.
 */
export function pageStyles(): string {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  const fg = read("--k-ink");
  const serif = read("--k-serif");
  const mono = read("--k-mono");
  const leading = read("--k-leading-reading");

  const rules = [
    `html:not(#\\#), html:not(#\\#) body { background: ${read("--k-bg")} !important; color: ${fg} !important; }`,
    `body:not(#\\#) :not(mark, mark *) { color: ${fg} !important; background-color: transparent !important; }`,
    `body:not(#\\#) :is(a:any-link, a:any-link *) { color: ${read("--k-link")} !important; }`,
    `body:not(#\\#) :is(img, picture, svg:not(:has(image)), object):not(#\\#) { color: #000 !important; }`,
    `body:not(#\\#) :is(img[${BACKING}], picture:has(> img[${BACKING}]), svg:not(:has(image)), object):not(#\\#) { background-color: #fff !important; }`,
    `body:not(#\\#) :is(svg, svg *):not(#\\#) { color: #000 !important; }`,
    `body:not(#\\#) { font-family: ${serif} !important; font-size: ${read("--k-text-read")} !important; line-height: ${leading} !important; }`,
    // Descendants of code too, so a span coloured inside a block of code keeps the mono it inherits.
    `body:not(#\\#) :not(code, pre, kbd, samp, code *, pre *, kbd *, samp *):not(#\\#) { font-family: ${serif} !important; }`,
    `body:not(#\\#) :is(code, pre, kbd, samp):not(#\\#) { font-family: ${mono} !important; }`,
    `body:not(#\\#) :is(p, li, blockquote, dd, dt, td, th, figcaption, div, h1, h2, h3, h4, h5, h6):not(#\\#) { line-height: ${leading} !important; }`,
    `body:not(#\\#) ::selection { background: ${read("--k-highlight")} !important; }`,
  ];
  // Only on the dark page: an ink glyph is black already, and inverting it there
  // would turn the one dark mark on a light page white.
  if (currentTheme() === "dark") {
    rules.push(`body:not(#\\#) :is(img, svg)[${INK}]:not(#\\#) { filter: invert(1) !important; }`);
  }
  return [fontFaces([serif, mono]), ...rules].join("\n");
}
