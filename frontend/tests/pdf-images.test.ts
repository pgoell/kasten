import { imageBoxes, type Matrix } from "@/lib/book/pdf-images";

/** The operator codes of pdf.js's `OPS` table, for the operators these tests use. */
const ops = {
  save: 10,
  restore: 11,
  transform: 12,
  paintFormXObjectBegin: 74,
  beginGroup: 76,
  endGroup: 77,
  paintFormXObjectEnd: 75,
  beginAnnotation: 80,
  endAnnotation: 81,
  paintImageMaskXObject: 83,
  paintImageXObject: 85,
  paintInlineImageXObjectGroup: 87,
  paintImageXObjectRepeat: 88,
};

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

describe("the pictures a page paints", () => {
  it("covers the unit square under the matrix each picture is painted with", () => {
    // A picture is drawn in the unit square, so the matrix before it gives its box.
    const boxes = imageBoxes(
      ops,
      [ops.transform, ops.paintImageXObject],
      [[100, 0, 0, 50, 10, 20], [1]],
      IDENTITY,
    );
    expect(boxes).toEqual([[10, 20, 100, 50]]);
  });

  it("applies each matrix to the ones before it, the later one in the earlier one's space", () => {
    // Scaled by 2, then moved 5 in that scaled space: the picture's corner is at 10.
    const boxes = imageBoxes(
      ops,
      [ops.transform, ops.transform, ops.paintImageXObject],
      [[2, 0, 0, 2, 0, 0], [1, 0, 0, 1, 5, 5], [1]],
      IDENTITY,
    );
    expect(boxes).toEqual([[10, 10, 2, 2]]);
  });

  it("puts back the matrix a save and restore took", () => {
    const boxes = imageBoxes(
      ops,
      [ops.save, ops.transform, ops.restore, ops.paintImageXObject],
      [[], [2, 0, 0, 2, 0, 0], [], [1]],
      IDENTITY,
    );
    expect(boxes).toEqual([[0, 0, 1, 1]]);
  });

  it("moves a form by its own matrix, and puts the matrix back at its end", () => {
    const boxes = imageBoxes(
      ops,
      [
        ops.paintFormXObjectBegin,
        ops.paintImageXObject,
        ops.paintFormXObjectEnd,
        ops.paintImageXObject,
      ],
      [[[1, 0, 0, 1, 30, 40], null], [1], [], [2]],
      IDENTITY,
    );
    expect(boxes).toEqual([
      [30, 40, 1, 1],
      [0, 0, 1, 1],
    ]);
  });

  it("gives each tile of a repeated picture its own box, and leaves out stencil masks", () => {
    const repeated = imageBoxes(
      ops,
      [ops.paintImageXObjectRepeat],
      [[1, 10, 10, [0, 0, 50, 0]]],
      IDENTITY,
    );
    expect(repeated).toEqual([
      [0, 0, 10, 10],
      [50, 0, 10, 10],
    ]);
    const masked = imageBoxes(ops, [ops.paintImageMaskXObject], [[1]], IDENTITY);
    expect(masked).toEqual([]);
  });

  it("moves a group by its own matrix, and puts the matrix back at its end", () => {
    // A transparency group is drawn under its matrix, as a form is (`pdf.mjs:12074`).
    const group = { matrix: [1, 0, 0, 1, 30, 40], bbox: [0, 0, 1, 1], isolated: true };
    const boxes = imageBoxes(
      ops,
      [ops.beginGroup, ops.paintImageXObject, ops.endGroup, ops.paintImageXObject],
      [[group], [1], [group], [2]],
      IDENTITY,
    );
    expect(boxes).toEqual([
      [30, 40, 1, 1],
      [0, 0, 1, 1],
    ]);
  });

  it("paints an annotation from the page's base matrix, and puts back the one before it at its end", () => {
    // An annotation starts again from the base matrix and not from the one before (`pdf.mjs:12159`).
    const boxes = imageBoxes(
      ops,
      [
        ops.transform,
        ops.beginAnnotation,
        ops.paintImageXObject,
        ops.endAnnotation,
        ops.paintImageXObject,
      ],
      [
        [2, 0, 0, 2, 0, 0],
        [7, null, [1, 0, 0, 1, 10, 10], [1, 0, 0, 1, 5, 0], false],
        [1],
        [],
        [2],
      ],
      IDENTITY,
    );
    expect(boxes).toEqual([
      [15, 10, 1, 1],
      [0, 0, 2, 2],
    ]);
  });

  it("boxes each image of an inline image group under that image's own transform", () => {
    const boxes = imageBoxes(
      ops,
      [ops.paintInlineImageXObjectGroup],
      [[{}, [{ transform: [10, 0, 0, 10, 0, 0] }, { transform: [1, 0, 0, 1, 50, 0] }]]],
      IDENTITY,
    );
    expect(boxes).toEqual([
      [0, 0, 10, 10],
      [50, 0, 1, 1],
    ]);
  });

  it("leaves the matrix alone for a form or a group that carries none", () => {
    const boxes = imageBoxes(
      ops,
      [
        ops.transform,
        ops.paintFormXObjectBegin,
        ops.paintImageXObject,
        ops.paintFormXObjectEnd,
        ops.beginGroup,
        ops.paintImageXObject,
        ops.endGroup,
      ],
      [[1, 0, 0, 1, 5, 5], [null, null], [1], [], [{ matrix: null }], [2], []],
      IDENTITY,
    );
    expect(boxes).toEqual([
      [5, 5, 1, 1],
      [5, 5, 1, 1],
    ]);
  });

  it("gives no box to a picture squeezed to less than a whole pixel", () => {
    const boxes = imageBoxes(
      ops,
      [ops.transform, ops.paintImageXObject],
      [[0.5, 0, 0, 50, 10.2, 20], [1]],
      IDENTITY,
    );
    expect(boxes).toEqual([]);
  });
});
