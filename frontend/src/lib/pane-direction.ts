/**
 * Which pane sits in a given direction from another, read off their boxes.
 *
 * Geometry rather than the split tree, because the tree cannot answer this. It
 * spells a square of four panes `row[col[A,C], col[B,D]]`, and walking it to
 * find what is right of C steps up to the row, across to the second column and
 * down to its first pane, which is B. B is diagonally across from C; D is the
 * one beside it. vim and tmux both resolve these against the screen, and so
 * does this.
 *
 * Pure, and boxes in rather than elements, so the whole table of cases answers
 * to a unit test with no DOM in it. `pane-layout.tsx` reads the real boxes,
 * being the file that writes the attribute they are found by.
 */

export interface PaneRect {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type Direction = "left" | "right" | "up" | "down";

/**
 * How far a neighbour may sit the wrong side of an edge and still count.
 *
 * The panes are laid out by flex, which hands out fractional widths, so two
 * that meet can round to a small overlap. Wider than the one pixel rule drawn
 * between them and it would start admitting panes that genuinely overlap.
 */
const EDGE_SLACK = 2;

export function paneToward(rects: PaneRect[], from: string, dir: Direction): string | null {
  const origin = rects.find((rect) => rect.id === from);
  // The pane is not on screen, which happens for the render between a layout
  // changing and the browser laying it out. Moving nowhere beats guessing.
  if (origin === undefined) return null;

  const vertical = dir === "up" || dir === "down";

  /** The room between the two along the way we are travelling, below zero when the pane is behind us. */
  const gap = (rect: PaneRect): number => {
    if (dir === "left") return origin.left - rect.right;
    if (dir === "right") return rect.left - origin.right;
    if (dir === "up") return origin.top - rect.bottom;
    return rect.top - origin.bottom;
  };

  /**
   * Whether the two share any of the edge they would meet along.
   *
   * This is the whole of what the tree could not say: it tells the pane beside
   * you from the one diagonally past it, and it is why moving right out of the
   * bottom half arrives in the bottom half.
   */
  const meets = (rect: PaneRect): boolean =>
    vertical
      ? rect.right > origin.left && rect.left < origin.right
      : rect.bottom > origin.top && rect.top < origin.bottom;

  /** The middle of the edge, across the way we are travelling. */
  const middle = (rect: PaneRect): number =>
    vertical ? (rect.left + rect.right) / 2 : (rect.top + rect.bottom) / 2;

  const nearest = rects
    .filter((rect) => rect.id !== from && gap(rect) >= -EDGE_SLACK && meets(rect))
    // Nearest along the way first, then the one whose middle lines up best.
    // `sort` is stable, so two that tie on both stay in the order they were
    // laid out in and a tie lands on the upper or left pane.
    .sort(
      (a, b) =>
        gap(a) - gap(b) ||
        Math.abs(middle(a) - middle(origin)) - Math.abs(middle(b) - middle(origin)),
    );

  return nearest[0]?.id ?? null;
}
