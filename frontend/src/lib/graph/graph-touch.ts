/**
 * Where a finger meets the graph's canvas: the hit areas, sized so a finger can
 * hit a note, and the pinch that wins over a note's drag.
 */

import { select } from "d3-selection";
import type ForceGraph from "force-graph";
import { type DrawnLink, type DrawnNode, radiusOf } from "@/lib/graph/graph";
import { FINGER } from "@/lib/graph/graph-zoom";

/**
 * How far from a note's middle a press still counts as on it, in graph units.
 *
 * The dot and a little more for a mouse. A dot is a few pixels wide however
 * far out the zoom is, which a finger cannot hit, so for one the area never
 * shrinks below `FINGER` on screen.
 */
export function hitRadius(degree: number, scale: number, coarse: boolean): number {
  const drawn = radiusOf(degree) + 2;
  return coarse ? Math.max(drawn, FINGER / 2 / scale) : drawn;
}

/** The hit area of a radial note: the dot plus 2, and half a finger on a touch screen. */
export function radialHitRadius(dot: number, coarse: boolean): number {
  const drawn = dot + 2;
  return coarse ? Math.max(drawn, FINGER / 2) : drawn;
}

/**
 * A second finger makes a pinch, whatever the fingers are on (#1286).
 *
 * force-graph puts d3-drag and d3-zoom on the same canvas, drag first, and
 * d3-drag stops the touch events of a finger that holds a note from reaching
 * d3-zoom, so a pinch whose first finger was on a note dragged that note and
 * barely zoomed. d3-zoom reads every finger down at each touchstart, so it
 * takes both fingers the moment the second lands, if the drag lets go of the
 * first: its own touchend listener is called with the fingers already down,
 * as if they had lifted. The note stays where the first finger left it. While
 * two fingers or more are down no finger can take a note, so a finger on a
 * note in a pinch is a pinch finger, until every finger has lifted.
 *
 * Listened for in the capture phase on the box, so this runs before both
 * listeners on the canvas inside it.
 */
export function pinchOverDrag(
  element: HTMLElement,
  graph: ForceGraph<DrawnNode, DrawnLink>,
): () => void {
  const canvas = element.querySelector("canvas");
  if (canvas === null) return () => {};
  const endDrag = select(canvas).on("touchend.drag");
  const listening = new AbortController();
  const options = { capture: true, signal: listening.signal };
  element.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length < 2) return;
      graph.enableNodeDrag(false);
      // force-graph marks the canvas from a drag's start to its end.
      if (!canvas.classList.contains("grabbable")) return;
      const landing = new Set([...event.changedTouches].map((one) => one.identifier));
      const held = [...event.touches].filter((one) => !landing.has(one.identifier));
      // d3-drag's touchend reads no more of its event than these two.
      const lift = { changedTouches: held, stopImmediatePropagation() {} };
      endDrag?.call(canvas, lift as unknown as TouchEvent, undefined);
    },
    options,
  );
  const lifted = (event: TouchEvent) => {
    if (event.touches.length === 0) graph.enableNodeDrag(true);
  };
  element.addEventListener("touchend", lifted, options);
  element.addEventListener("touchcancel", lifted, options);
  return () => listening.abort();
}
