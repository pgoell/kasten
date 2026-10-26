/**
 * The arithmetic of the phone board's column swiped sideways by a finger: how
 * far the column sits off its rest, and which neighbour a release shows. Pure,
 * so the gesture can be tested without a screen.
 */

import { project, rubberBand } from "@/lib/sheet-math";

/**
 * The share of the width a release must reach before the column changes. A
 * quarter is far enough that a sloppy flick does not flip a state by accident.
 */
const QUARTER = 0.25;

/**
 * Where the column sits for a finger that has moved `dx` px. Past the first
 * column to the right, or the last to the left, there is no neighbour to show,
 * so the column gives less than the finger does, as a sheet does past its top.
 */
export function swipeOffset(dx: number, width: number, index: number, count: number): number {
  const pastFirst = dx > 0 && index === 0;
  const pastLast = dx < 0 && index === count - 1;
  return pastFirst || pastLast ? rubberBand(dx, width) : dx;
}

/**
 * Which column a release shows, as a step: -1 for the previous, 1 for the next,
 * 0 to stay. The release counts its coast, so a fast flick goes further than the
 * finger did, and a step is taken only toward a column that exists.
 */
export function swipeTarget(
  offset: number,
  velocity: number,
  width: number,
  index: number,
  count: number,
): number {
  const landing = offset + project(velocity);
  if (landing > width * QUARTER && index > 0) return -1;
  if (landing < -width * QUARTER && index < count - 1) return 1;
  return 0;
}
