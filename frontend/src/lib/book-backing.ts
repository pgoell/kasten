/**
 * Which of a book's images get a white page of their own (#469, #475).
 *
 * The book's page goes dark, and black line art on a transparent png vanishes
 * into it unless the image brings back the white it was drawn on. White behind
 * every image, though, shows wherever an image's box is larger than its
 * picture: a cover sized to the page with `object-fit: contain` letterboxes
 * itself, and the bars are the img's own box. So the white is decided per
 * image, by its pixels, and the stylesheet in `book-pane.tsx` draws it only
 * under an img carrying `BACKING`.
 *
 * A small image in a line of text gets no white, which would box it out of the
 * line, so a black glyph on transparent there is black on the dark page and
 * close to invisible (#478). Such an image carries `INK` instead, and the
 * stylesheet inverts it, so its black turns pale like the text round it. A
 * small svg drawing such a glyph through an `<image>` is judged the same (#483).
 */

/** The attribute the page's stylesheet reads to draw white behind an image. */
export const BACKING = "data-kasten-backing";

/** The attribute the page's stylesheet reads to invert a small dark glyph. */
export const INK = "data-kasten-ink";

/** What the page does for one image: white behind it, inverted, or nothing. */
export type Treatment = "white" | "ink" | "plain";

/**
 * How dark and how grey a pixel may be and still count as ink.
 *
 * Grey as well as dark, so a navy or maroon icon is left alone: inverted, it
 * would come out a garish complement and not the pale of the text. Most of
 * what is visible and not all, so a glyph with a few lighter or tinted pixels
 * still inverts. Each pixel weighs as much as it shows, by its alpha: a glyph
 * saved against a white matte has light grey edges at partial alpha, which
 * counted whole would outvote a small glyph's solid black, and a faint shadow
 * would count as much as the ink. `getImageData` hands back colour
 * un-premultiplied, so the half-transparent edges of a glyph drawn on nothing
 * read (0,0,0,a) and count as dark.
 */
const INK_MAX = 96;
const INK_SPREAD = 48;
const INK_SHARE = 0.9;

/** The longest side of the copy whose alpha is read. A thumbnail answers as well as the whole. */
const SIDE = 64;

/** The image's pixels as RGBA bytes, the shape `getImageData` hands back. */
export type ReadPixels = (img: HTMLImageElement) => Uint8ClampedArray;

/**
 * Draw the image small onto a canvas and read it back.
 *
 * foliate hands every epub resource over as a same-origin `blob:` URL, so the
 * canvas stays clean for an epub's own images. One from another origin taints
 * it, and `getImageData` throws a `SecurityError`, which `treatmentFor` answers.
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
 * Whether the image is small enough to sit in a line of text.
 *
 * An icon or a glyph set into a sentence is read against the words around it,
 * so a white box round it would stand out of the line.
 */
function inline(element: Element, view: Window): boolean {
  const height = element.getBoundingClientRect().height;
  const font = Number.parseFloat(view.getComputedStyle(element.parentElement ?? element).fontSize);
  return height > 0 && height <= font * 1.5;
}

/**
 * The raster an svg draws through its `<image>`, as an img of its own to read.
 *
 * `backImages` hands over only an svg that holds one.
 */
function raster(svg: SVGSVGElement): HTMLImageElement {
  const image = svg.querySelector("image") as SVGElement;
  const img = svg.ownerDocument.createElement("img");
  img.src = image.getAttribute("href") ?? image.getAttribute("xlink:href") ?? "";
  return img;
}

/**
 * Whether the image is a cover whose box draws bars round its picture.
 *
 * By the bars and not by `object-fit` alone: foliate puts `contain` on every
 * image it lays out (`paginator.js:341-357`), and publishers write it on every
 * img too, and at the picture's own shape it draws nothing round it.
 *
 * Only on a page with no text, which is what a cover page is. In a chapter, a
 * tall diagram under `img { width: 100% }` gets bars too, foliate's
 * `max-height` shrinking its picture and not its box, and white bars beside it
 * are a smaller harm than black line art nobody can read. Alt text is not
 * `textContent`, so a cover's own alt does not count.
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
 * What the page does for an img, or for an svg drawing a raster through its
 * `<image>`: white behind it, inverted, or nothing.
 *
 * Read through the element's own window, the section living in foliate's iframe.
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

  let pixels: Uint8ClampedArray;
  try {
    pixels = readPixels(img);
  } catch (error) {
    // Another origin's image cannot be read, so it keeps the white #469 gave
    // every image, unless it sits in a line of text, which never had white.
    // The canvas lives in the chapter's iframe, so what it throws is that
    // window's DOMException and not an instance of this one's.
    const Thrown = (view as Window & typeof globalThis).DOMException;
    if (error instanceof Thrown && error.name === "SecurityError") return small ? "plain" : "white";
    throw error;
  }
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
 * Decide `element` and mark it, unless a newer decision has started meanwhile.
 *
 * Two decisions of one image can finish out of order, one waiting on a load the
 * other did not, and the older one's verdict is for a size or picture gone.
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
 * Decide every image of one section, and again whenever one changes (#481).
 *
 * The verdict rests on the size an image has now, so it is decided again when
 * its box changes, on a resize, or a hidden block shown round it, and when
 * its parent's does, which is where a font-size change shows: a fixed-px image
 * keeps its box while 1.5em grows past it. A `srcset` or `<picture>` swap
 * brings new pixels, and fires `load` again. An svg is here only when it draws
 * a raster through an `<image>`; every other svg is white by the stylesheet.
 *
 * Answers the observer to disconnect when the section leaves, or nothing for a
 * section with no image, which is every pdf page.
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
      for (const element of [target, ...target.children])
        if (turns.has(element)) changed.add(element as HTMLImageElement | SVGSVGElement);
    for (const element of changed) decide(element);
  });
  for (const element of elements) {
    observer.observe(element);
    if (element.parentElement) observer.observe(element.parentElement);
    if (element.localName === "img") element.addEventListener("load", () => decide(element));
    decide(element);
  }
  return observer;
}
