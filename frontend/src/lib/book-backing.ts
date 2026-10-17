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
 * stylesheet inverts it, so its black turns pale like the text round it.
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
 * would come out a garish complement and not the pale of the text. Most of the
 * visible pixels and not all, so a glyph with a few lighter or tinted pixels
 * still inverts. `getImageData` hands back colour un-premultiplied, so the
 * half-transparent edges of a black glyph read (0,0,0,a) and count as dark.
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
function inline(img: HTMLImageElement, view: Window): boolean {
  const height = img.getBoundingClientRect().height;
  const font = Number.parseFloat(view.getComputedStyle(img.parentElement ?? img).fontSize);
  return height > 0 && height <= font * 1.5;
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
 * Whether the pixels are a dark glyph on a transparent ground.
 *
 * An opaque image is a picture of its own, not ink, and one with no visible
 * pixel, a spacer, has nothing to invert.
 */
function ink(pixels: Uint8ClampedArray): boolean {
  let seeThrough = false;
  let visible = 0;
  let dark = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const [r = 0, g = 0, b = 0, alpha = 0] = pixels.subarray(index, index + 4);
    if (alpha < 255) seeThrough = true;
    if (alpha === 0) continue;
    visible += 1;
    const max = Math.max(r, g, b);
    if (max <= INK_MAX && max - Math.min(r, g, b) <= INK_SPREAD) dark += 1;
  }
  return seeThrough && visible > 0 && dark >= visible * INK_SHARE;
}

/**
 * What the page does for `img`: white behind it, inverted, or nothing.
 *
 * Read through the image's own window, the section living in foliate's iframe.
 */
export async function treatmentFor(
  img: HTMLImageElement,
  readPixels: ReadPixels = canvasPixels,
): Promise<Treatment> {
  // Everything below reads layout, so it waits even for an image already
  // loaded. foliate's `load` arrives while the iframe is hidden and before its
  // render, and the await resumes once that render has laid the chapter out
  // (`paginator.js:256-272`). Until then every box is zero.
  // A broken image draws its alt text, black, which needs the white to read.
  if (!(await loaded(img))) return "white";
  // The pane closed while the image loaded, and there is no page left to draw.
  const view = img.ownerDocument.defaultView;
  if (view === null) return "plain";
  if (letterboxed(img, view)) return "plain";
  const small = inline(img, view);

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
  if (small) return ink(pixels) ? "ink" : "plain";
  // Every fourth byte is a pixel's alpha.
  return pixels.some((value, index) => index % 4 === 3 && value < 255) ? "white" : "plain";
}

/** Decide every image of one section, as each finishes loading. */
export function backImages(doc: Document): void {
  for (const img of doc.querySelectorAll("img"))
    void treatmentFor(img).then((treatment) => {
      img.toggleAttribute(BACKING, treatment === "white");
      img.toggleAttribute(INK, treatment === "ink");
    });
}
