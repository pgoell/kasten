/**
 * A pdf page's pictures, drawn as printed over a page the dark theme has recoloured. pdf.js's page colours
 * go over the whole canvas, pictures included, so this puts them back. The pdf view calls it.
 */

/** A six-number matrix, `[a, b, c, d, e, f]`, as pdf.js writes them. */
export type Matrix = [number, number, number, number, number, number];

/** The part of a viewport this reads: where a page's points land on the canvas. */
interface ImageViewport {
  transform: Matrix;
}

/** The part of a pdf.js page this reads: its operators, and a plain draw of it. */
interface ImagePage {
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  render(options: { canvasContext: CanvasRenderingContext2D; viewport: ImageViewport }): {
    promise: Promise<void>;
  };
}

/** A rectangle in canvas pixels: `x`, `y`, `width`, `height`. */
type Box = [number, number, number, number];

/** `x` then `y`, both as pdf.js composes them: `y` is applied first, then `x`. */
function multiply(x: Matrix, y: Matrix): Matrix {
  return [
    x[0] * y[0] + x[2] * y[1],
    x[1] * y[0] + x[3] * y[1],
    x[0] * y[2] + x[2] * y[3],
    x[1] * y[2] + x[3] * y[3],
    x[0] * y[4] + x[2] * y[5] + x[4],
    x[1] * y[4] + x[3] * y[5] + x[5],
  ];
}

/**
 * The canvas boxes, `[x, y, width, height]`, of a page's raster images. The corners of the unit
 * square, carried through the paint matrix, bound each image. A stencil mask is left out: it takes the fill colour.
 */
export function imageBoxes(
  ops: Record<string, number>,
  fnArray: number[],
  argsArray: unknown[][],
  base: Matrix,
): Box[] {
  const boxes: Box[] = [];
  const saved: Matrix[] = [];
  let ctm = base;
  for (let i = 0; i < fnArray.length; i += 1) {
    const args = argsArray[i] ?? [];
    switch (fnArray[i]) {
      case ops.save:
        saved.push(ctm);
        break;
      case ops.restore:
        ctm = saved.pop() ?? ctm;
        break;
      case ops.transform:
        ctm = multiply(ctm, args as Matrix);
        break;
      // A form is saved, then moved by its own matrix, and restored at its end.
      case ops.paintFormXObjectBegin:
        saved.push(ctm);
        ctm = movedBy(ctm, args[0] as Matrix | undefined);
        break;
      case ops.paintFormXObjectEnd:
        ctm = saved.pop() ?? ctm;
        break;
      // A transparency group is moved by its own matrix, as a form is, and its
      // `beginGroup` argument is that group (`pdf.mjs:12074`).
      case ops.beginGroup: {
        saved.push(ctm);
        ctm = movedBy(ctm, (args[0] as { matrix?: Matrix | null } | undefined)?.matrix);
        break;
      }
      case ops.endGroup:
        ctm = saved.pop() ?? ctm;
        break;
      // An annotation is painted from the page's base matrix, not from the one
      // before it, with its own transform and then its matrix (`pdf.mjs:12159`).
      // Its clip is not followed, and nor is the own canvas it may paint on, since
      // the page's canvas is drawn without the annotation canvases.
      case ops.beginAnnotation: {
        saved.push(ctm);
        const [, , transform, matrix] = args as [unknown, unknown, Matrix, Matrix];
        ctm = multiply(multiply(base, transform), matrix);
        break;
      }
      case ops.endAnnotation:
        ctm = saved.pop() ?? ctm;
        break;
      case ops.paintImageXObject:
      case ops.paintInlineImageXObject:
        pushBox(boxes, ctm);
        break;
      case ops.paintImageXObjectRepeat:
        pushTiles(boxes, ctm, args);
        break;
      // A group of inline images: `[imgData, map]`, one entry per image, each drawn
      // under its own transform, as a tile is.
      case ops.paintInlineImageXObjectGroup: {
        const [, map] = args as [unknown, { transform: Matrix }[]];
        for (const entry of map) pushBox(boxes, multiply(ctm, entry.transform));
        break;
      }
    }
  }
  return boxes;
}

/**
 * Puts a page's raster images back as printed, after a draw in page colours. pdf.js's colours go
 * over pictures too, so the page is drawn again plain and each image's box copied over from it.
 */
export async function restoreImages(
  page: ImagePage,
  ops: Record<string, number>,
  context: CanvasRenderingContext2D,
  viewport: ImageViewport,
): Promise<void> {
  const { fnArray, argsArray } = await page.getOperatorList();
  const boxes = imageBoxes(ops, fnArray, argsArray, viewport.transform);
  if (boxes.length === 0) return;
  const plain = document.createElement("canvas");
  plain.width = context.canvas.width;
  plain.height = context.canvas.height;
  const plainContext = plain.getContext("2d");
  if (plainContext === null) return;
  await page.render({ canvasContext: plainContext, viewport }).promise;
  for (const [x, y, width, height] of boxes) {
    context.drawImage(plain, x, y, width, height, x, y, width, height);
  }
  // Shrunk, which hands the bitmap back at once, as `pdf-view.ts` does its own.
  plain.width = 0;
  plain.height = 0;
}

/** Add the box `matrix` carries the unit square to, unless it holds no whole pixel. */
function pushBox(boxes: Box[], matrix: Matrix): void {
  const xs = [
    matrix[4],
    matrix[0] + matrix[4],
    matrix[2] + matrix[4],
    matrix[0] + matrix[2] + matrix[4],
  ];
  const ys = [
    matrix[5],
    matrix[1] + matrix[5],
    matrix[3] + matrix[5],
    matrix[1] + matrix[3] + matrix[5],
  ];
  // Rounded inward, so the box holds only pixels wholly inside the picture: a
  // pixel the picture part covers is copied from the plain draw, and that is white.
  const left = Math.ceil(Math.min(...xs));
  const top = Math.ceil(Math.min(...ys));
  const right = Math.floor(Math.max(...xs));
  const bottom = Math.floor(Math.max(...ys));
  if (right > left && bottom > top) boxes.push([left, top, right - left, bottom - top]);
}

/** A tiled image: `[objId, scaleX, scaleY, positions]`, one tile per pair of positions. */
function pushTiles(boxes: Box[], ctm: Matrix, args: unknown[]): void {
  const [, scaleX, scaleY, positions] = args as [unknown, number, number, number[]];
  for (let j = 0; j < positions.length; j += 2) {
    pushBox(
      boxes,
      multiply(ctm, [scaleX, 0, 0, scaleY, positions[j] as number, positions[j + 1] as number]),
    );
  }
}

/** `ctm` moved by `matrix`, or as it is where there is none. */
function movedBy(ctm: Matrix, matrix: Matrix | null | undefined): Matrix {
  return matrix ? multiply(ctm, matrix) : ctm;
}
