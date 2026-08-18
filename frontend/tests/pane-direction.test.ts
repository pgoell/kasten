import { type PaneRect, paneToward } from "@/lib/pane-direction";

/** A pane's box, written the way the tests read: `[left, top, right, bottom]`. */
function box(id: string, left: number, top: number, right: number, bottom: number): PaneRect {
  return { id, left, top, right, bottom };
}

/**
 * Four panes in a square, which is the layout the split tree gets wrong.
 *
 * The tree spells this `row[col[A,C], col[B,D]]`. Walking it to answer "what is
 * right of C" steps up to the row, over to the second column and down to its
 * first pane, which is B. On screen B is diagonally across from C and D is the
 * one beside it. The gap between panes is the one pixel rule the layout draws.
 */
const GRID = [
  box("A", 0, 0, 49, 49),
  box("B", 51, 0, 100, 49),
  box("C", 0, 51, 49, 100),
  box("D", 51, 51, 100, 100),
];

describe("moving across a square of four panes", () => {
  it("goes right along the top", () => {
    expect(paneToward(GRID, "A", "right")).toBe("B");
  });

  it("goes right along the bottom rather than diagonally", () => {
    // The one a tree walk answers with B.
    expect(paneToward(GRID, "C", "right")).toBe("D");
  });

  it("goes left along the bottom", () => {
    expect(paneToward(GRID, "D", "left")).toBe("C");
  });

  it("goes down the left column", () => {
    expect(paneToward(GRID, "A", "down")).toBe("C");
  });

  it("goes up the right column", () => {
    expect(paneToward(GRID, "D", "up")).toBe("B");
  });

  it("stays put at the edge of the window", () => {
    expect(paneToward(GRID, "A", "left")).toBeNull();
    expect(paneToward(GRID, "A", "up")).toBeNull();
    expect(paneToward(GRID, "D", "right")).toBeNull();
    expect(paneToward(GRID, "D", "down")).toBeNull();
  });
});

describe("moving across three panes in a row", () => {
  const ROW = [box("A", 0, 0, 33, 100), box("B", 34, 0, 66, 100), box("C", 67, 0, 100, 100)];

  it("stops at the next one rather than crossing the whole row", () => {
    expect(paneToward(ROW, "A", "right")).toBe("B");
    expect(paneToward(ROW, "C", "left")).toBe("B");
  });

  it("has nowhere to go up or down", () => {
    expect(paneToward(ROW, "B", "up")).toBeNull();
    expect(paneToward(ROW, "B", "down")).toBeNull();
  });
});

describe("moving into a column from a pane spanning it", () => {
  // A down the whole left side, B and C stacked on the right.
  const UNEVEN = [box("A", 0, 0, 49, 100), box("B", 51, 0, 100, 49), box("C", 51, 51, 100, 100)];

  it("takes the nearer of the two, which is the first when they tie", () => {
    // A's middle sits exactly between B's and C's, so neither is nearer. The
    // order settles it, and that is the order the panes are laid out in, so a
    // tie lands on the upper pane rather than somewhere arbitrary.
    expect(paneToward(UNEVEN, "A", "right")).toBe("B");
  });

  it("comes back to the pane spanning both", () => {
    expect(paneToward(UNEVEN, "B", "left")).toBe("A");
    expect(paneToward(UNEVEN, "C", "left")).toBe("A");
  });

  it("still moves between the two stacked panes", () => {
    expect(paneToward(UNEVEN, "B", "down")).toBe("C");
    expect(paneToward(UNEVEN, "C", "up")).toBe("B");
  });
});

describe("a pane hidden behind a zoomed one", () => {
  // `display: none` measures zero on every side, so a zoomed tab hands this
  // one real box and a zero box per pane behind it. None of them is a place a
  // direction key can arrive in, which is what leaves the four directions with
  // nowhere to go while a pane is zoomed.
  const ZOOMED = [box("A", 0, 0, 100, 100), box("B", 0, 0, 0, 0), box("C", 0, 0, 0, 0)];

  it("is never the pane a direction arrives at", () => {
    for (const dir of ["left", "right", "up", "down"] as const) {
      expect(paneToward(ZOOMED, "A", dir)).toBeNull();
    }
  });
});

describe("a pane the layout has not drawn yet", () => {
  it("moves nowhere rather than guessing", () => {
    expect(paneToward(GRID, "nobody", "left")).toBeNull();
  });
});
