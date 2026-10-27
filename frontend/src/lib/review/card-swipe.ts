/**
 * The arithmetic of a flashcard swiped by a finger: how far it tilts, which
 * stamp shows, and whether a release grades the card. Pure, so the gesture can
 * be tested without a screen.
 */

import { project } from "@/lib/sheet-math";

/** Degrees a card tilts per px it is dragged, so it leans the way it is pulled. */
export const TILT = 0.025;

/** Past this share of the card's width, a release grades the card. */
export const GRADE_AT = 0.38;

/** The tilt in degrees for a drag of `offset` px. */
export function tiltOf(offset: number): number {
  return offset * TILT;
}

/**
 * Which stamp shows for a drag of `offset` px: Good to the right, Again to the
 * left. It fades in over the same distance that grades the card, so the stamp
 * is full at the moment the card would fly off.
 */
export function stampOf(
  offset: number,
  width: number,
): { rating: "good" | "again" | null; opacity: number } {
  const opacity = Math.min(1, Math.abs(offset) / (GRADE_AT * width));
  if (offset > 0) return { rating: "good", opacity };
  if (offset < 0) return { rating: "again", opacity };
  return { rating: null, opacity };
}

/**
 * The grade a release earns. It counts where the card would coast to, so a
 * fast flick grades a short drag, and a drag that comes back does not grade.
 */
export function swipeGrade(
  offset: number,
  velocity: number,
  width: number,
): "good" | "again" | null {
  const end = offset + project(velocity);
  if (end > GRADE_AT * width) return "good";
  if (end < -GRADE_AT * width) return "again";
  return null;
}
