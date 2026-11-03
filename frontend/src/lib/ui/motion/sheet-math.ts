/** The arithmetic of a finger-dragged bottom sheet. Pure, so tests need no screen. */

import { FLICK_SPEED } from "./spring";

/** px a finger travels before a drag is decided. Short of this, a tap stays a tap. */
export const SLOP = 10;

/** ms of finger samples the release speed is read from. */
export const WINDOW = 100;

/** ms without a move after which the finger counts as stopped, so speed is 0. */
export const STOP = 90;

/** The per-millisecond decay a released sheet coasts with, as iOS scrolling does. */
export const DECELERATION = 0.99;

/** How stiff the sheet is past its top. Lower is stiffer. */
export const RUBBER = 0.55;

/** Where a release would coast to, in px, given its speed in px/s. */
export function project(velocity: number): number {
  return ((velocity / 1000) * DECELERATION) / (1 - DECELERATION);
}

/** The sheet's offset past its top: it gives, but less the further it is pulled. */
export function rubberBand(offset: number, height: number): number {
  return (offset * height * RUBBER) / (height + RUBBER * Math.abs(offset));
}

/** Down follows the finger 1:1. Up is rubber-banded, since the sheet cannot rise past its top. */
export function follow(travel: number, height: number): number {
  return travel >= 0 ? travel : rubberBand(travel, height);
}

export interface Sample {
  /** ms */
  t: number;
  /** px */
  y: number;
}

/** px/s of the finger over the last WINDOW ms before `now`. 0 when it has stopped. */
export function speed(samples: readonly Sample[], now: number): number {
  const recent = samples.filter((s) => s.t >= now - WINDOW);
  const first = recent[0];
  const last = recent[recent.length - 1];
  if (!first || !last || recent.length < 2 || now - last.t >= STOP) return 0;
  const dt = last.t - first.t;
  return dt > 0 ? ((last.y - first.y) / dt) * 1000 : 0;
}

/** Vertical drag, sideways scroll, or pending until the finger has moved SLOP px. */
export function axis(dx: number, dy: number): "pending" | "drag" | "scroll" {
  const x = Math.abs(dx);
  const y = Math.abs(dy);
  if (Math.max(x, y) < SLOP) return "pending";
  return y >= x ? "drag" : "scroll";
}

/** Closes on a downward flick, or when the sheet would coast past half its height. */
export function closes(offset: number, velocity: number, height: number): boolean {
  return velocity > FLICK_SPEED || offset + project(velocity) > height / 2;
}

/** The backdrop's opacity: full while the sheet is up, none once it is down. */
export function backdrop(offset: number, height: number): number {
  return Math.min(1, Math.max(0, 1 - offset / height));
}
