/**
 * Where a finger meets the graph's canvas: the hit areas, sized so a finger can
 * hit a note, and the pinch that wins over a note's drag.
 */

import { select } from "d3-selection";
import type ForceGraph from "force-graph";
import { type DrawnLink, type DrawnNode, radiusOf } from "@/lib/graph/graph";
import { FINGER } from "@/lib/graph/graph-zoom";

/**
 * How far from a note's middle a press still hits it, in graph units. A dot can be a few pixels wide,
 * too small for a finger, so for touch the area never shrinks below `FINGER` on screen.
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

/** What `pinchOverDrag` gives the canvas back. */
export interface PinchOverDrag {
  /** Whether the touch going on, or the last one, had two fingers in the box: then its lift is no tap. */
  pinched(): boolean;
  stop(): void;
}

/**
 * A second finger makes a pinch, even when the first is on a note (#1286), since d3-drag would take that finger.
 * Listens in the capture phase so it runs before the canvas's own listeners.
 */
export function pinchOverDrag(
  element: HTMLElement,
  graph: ForceGraph<DrawnNode, DrawnLink>,
): PinchOverDrag {
  let pinched = false;
  const canvas = element.querySelector("canvas");
  if (canvas === null) return { pinched: () => false, stop: () => {} };
  const endDrag = select(canvas).on("touchend.drag");
  const listening = new AbortController();
  const options = { capture: true, signal: listening.signal };
  element.addEventListener(
    "touchstart",
    (event) => {
      const inside = [...event.touches].filter(
        (one) => one.target instanceof Node && element.contains(one.target),
      );
      pinched = inside.length > 1;
      graph.enableNodeDrag(!pinched);
      // force-graph marks the canvas from a drag's start to its end.
      if (!pinched || !canvas.classList.contains("grabbable")) return;
      const landing = new Set([...event.changedTouches].map((one) => one.identifier));
      const held = inside.filter((one) => !landing.has(one.identifier));
      // d3-drag's touchend reads no more of its event than these two.
      const lift = { changedTouches: held, stopImmediatePropagation() {} };
      endDrag?.call(canvas, lift as unknown as TouchEvent, undefined);
    },
    options,
  );
  // A mouse after a pinch, on a screen that has both, clicks as it always did.
  element.addEventListener(
    "pointerdown",
    (event) => {
      if (event.pointerType !== "touch") pinched = false;
    },
    options,
  );
  return { pinched: () => pinched, stop: () => listening.abort() };
}
