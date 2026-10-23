/**
 * A pdf page's pictures, drawn as printed over a page the dark theme has
 * recoloured. The pdf pane's page colours are pdf.js's own, which go over the
 * whole canvas, pictures included; this puts the pictures back. The pdf view
 * calls it, and holds the rest of the drawing.
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
 * The canvas boxes, `[x, y, width, height]`, a page's raster images cover.
 *
 * An image fills the unit square under the matrix it is painted with, so the
 * corners of that square, carried through the matrix, bound it. A stencil mask
 * is left out: it is painted in the fill colour, as text is, and the colours
 * should change it.
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
  const boxAt = (matrix: Matrix) => {
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
    const left = Math.floor(Math.min(...xs));
    const top = Math.floor(Math.min(...ys));
    boxes.push([left, top, Math.ceil(Math.max(...xs)) - left, Math.ceil(Math.max(...ys)) - top]);
  };
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
        if (args[0]) ctm = multiply(ctm, args[0] as Matrix);
        break;
      case ops.paintFormXObjectEnd:
        ctm = saved.pop() ?? ctm;
        break;
      case ops.paintImageXObject:
      case ops.paintInlineImageXObject:
        boxAt(ctm);
        break;
      // A tiled image: `[objId, scaleX, scaleY, positions]`, one tile per pair of positions.
      case ops.paintImageXObjectRepeat: {
        const [, scaleX, scaleY, positions] = args as [unknown, number, number, number[]];
        for (let j = 0; j < positions.length; j += 2) {
          boxAt(
            multiply(ctm, [
              scaleX,
              0,
              0,
              scaleY,
              positions[j] as number,
              positions[j + 1] as number,
            ]),
          );
        }
        break;
      }
    }
  }
  return boxes;
}

/**
 * Puts a page's raster images back as printed, after a draw in page colours.
 *
 * pdf.js's colours go over the whole canvas, pictures included, and a photo
 * should keep its colours in the dark. So the page is drawn again plain, and
 * each image's box is copied over from that; a box takes whatever else lies in
 * it too, which a picture over text does not show.
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
