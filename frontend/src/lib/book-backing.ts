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
 */

/** The attribute the page's stylesheet reads. */
export const BACKING = "data-kasten-backing";

/** The longest side of the copy whose alpha is read. A thumbnail answers as well as the whole. */
const SIDE = 64;

/** The image's pixels as RGBA bytes, the shape `getImageData` hands back. */
export type ReadPixels = (img: HTMLImageElement) => Uint8ClampedArray;

/**
 * Draw the image small onto a canvas and read it back.
 *
 * foliate hands every epub resource over as a same-origin `blob:` URL, so the
 * canvas stays clean for an epub's own images. One from another origin taints
 * it, and `getImageData` throws a `SecurityError`, which `backingFor` answers.
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
function inline(img: HTMLImageElement, view: Window): boolean {
  const height = img.getBoundingClientRect().height;
  const font = Number.parseFloat(view.getComputedStyle(img.parentElement ?? img).fontSize);
  return height > 0 && height <= font * 1.5;
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
 * Whether `img` needs a white page behind it.
 *
 * Read through the image's own window, the section living in foliate's iframe.
 */
export async function backingFor(
  img: HTMLImageElement,
  readPixels: ReadPixels = canvasPixels,
): Promise<boolean> {
  const view = img.ownerDocument.defaultView;
  if (view === null) return false;
  // A letterboxed image's box is wider than its picture, and the bars are page.
  // Decided before any load, so a cover is never drawn on white first. Read
  // here, before the first await, for a second reason: foliate's `load` comes
  // before its render, which puts `object-fit: contain` on every image
  // (`paginator.js:341-357`), so a later read would take each one for a letterbox.
  const fit = view.getComputedStyle(img).objectFit;
  if (fit === "contain" || fit === "scale-down") return false;
  if (inline(img, view)) return false;

  // A broken image draws its alt text, black, which needs the white to read.
  if (!(await loaded(img))) return true;
  // The pane closed while the image loaded, and there is no page left to draw.
  const after = img.ownerDocument.defaultView;
  if (after === null) return false;
  // An image with no size of its own lays out at zero until it loads.
  if (inline(img, after)) return false;

  let pixels: Uint8ClampedArray;
  try {
    pixels = readPixels(img);
  } catch (error) {
    // Another origin's image cannot be read, so it keeps the white #469 gave every image.
    // The canvas lives in the chapter's iframe, so what it throws is that
    // window's DOMException and not an instance of this one's.
    const Thrown = (after as Window & typeof globalThis).DOMException;
    if (error instanceof Thrown && error.name === "SecurityError") return true;
    throw error;
  }
  // Every fourth byte is a pixel's alpha.
  return pixels.some((value, index) => index % 4 === 3 && value < 255);
}

/** Decide every image of one section, as each finishes loading. */
export function backImages(doc: Document): void {
  for (const img of doc.querySelectorAll("img"))
    void backingFor(img).then((backed) => img.toggleAttribute(BACKING, backed));
}
