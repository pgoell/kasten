import { imageBoxes, type Matrix } from "@/lib/pdf-images";

/** The operator codes of pdf.js's `OPS` table, for the operators these tests use. */
const ops = {
  save: 10,
  restore: 11,
  transform: 12,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  paintImageMaskXObject: 83,
  paintImageXObject: 85,
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
});
