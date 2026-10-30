/**
 * Which pane sits in a direction from another, read off their boxes. The split tree
 * cannot say: right of C in a square of four is diagonal B, not the pane beside it.
 * Pure, so the case table needs no DOM.
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
 * How far a neighbour may sit the wrong side of an edge. Flex rounds fractional
 * widths, so meeting panes can overlap by a pixel or two; wider would admit real overlaps.
 */
const EDGE_SLACK = 2;

export function paneToward(rects: PaneRect[], from: string, dir: Direction): string | null {
  const origin = rects.find((rect) => rect.id === from);
  // Not on screen yet: a layout change renders before the browser lays it out.
  if (origin === undefined) return null;

  const vertical = dir === "up" || dir === "down";

  /** Room along the direction of travel; negative when the pane is behind us. */
  const gap = (rect: PaneRect): number => {
    if (dir === "left") return origin.left - rect.right;
    if (dir === "right") return rect.left - origin.right;
    if (dir === "up") return origin.top - rect.bottom;
    return rect.top - origin.bottom;
  };

  /**
   * Whether the two share some of the edge they meet along. A diagonal pane fails
   * this, so a move from the bottom half lands in the bottom half.
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
    // Nearest first, then best-aligned. A tie keeps layout order, so upper or left wins.
    .sort(
      (a, b) =>
        gap(a) - gap(b) ||
        Math.abs(middle(a) - middle(origin)) - Math.abs(middle(b) - middle(origin)),
    );

  return nearest[0]?.id ?? null;
}
