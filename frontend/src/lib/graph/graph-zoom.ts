/**
 * Where the vault graph's view stands, and the fits and zooms the canvas asks
 * of force-graph, with the touch screen's limits (#992).
 */

import type ForceGraph from "force-graph";
import { type DrawnLink, type DrawnNode, radiusOf } from "@/lib/graph/graph";

/** Where the view stands: the scale, and the graph point at the middle of the box. */
export interface GraphView {
  k: number;
  x: number;
  y: number;
}

/** The zoom at which names are solid, the least first zoom on a touch screen. */
export const NAMES_FULL = 1.8;

/**
 * The least a note's hit area measures across on a touch screen, in CSS pixels.
 *
 * The smallest target WCAG 2.2 allows, and no more: a touch that lands in a
 * hit area drags that note, so every pixel given to tapping is taken from
 * panning and pinching, and a zoomed-out vault is mostly notes.
 */
export const FINGER = 24;

/**
 * The touch screen's zoom limits, worked out from the fit each time it is.
 *
 * Out to half the fit, so a pinch can shrink the whole vault a little and no
 * further, where it used to fall to a speck. In to where the smallest dot,
 * `radiusOf(0)` across twice, is a finger wide; past that a pinch only spreads
 * the notes apart, and a small vault whose fit is already closer keeps its fit.
 */
const LEAST_OF_FIT = 0.5;
const MOST_ZOOM = FINGER / (2 * radiusOf(0));

/** The space kept round the notes by a fit, in CSS px. */
export const FIT_PADDING = 40;

/** The zooms of one canvas's graph; `coarse` says whether a finger points. */
export function zoomsOf(graph: ForceGraph<DrawnNode, DrawnLink>, coarse: () => boolean) {
  /**
   * The zoom at which every note is on screen, as `zoomToFit` works it out, and
   * the box's middle in graph units at that zoom. Under touch the limits follow
   * it, since force-graph's zoom clamps to them and a fixed least zoom would
   * keep a big vault from fitting.
   */
  const fitted = () => {
    const box = graph.getGraphBbox();
    if (box === null) return null;
    const k = Math.min(
      (graph.width() - FIT_PADDING * 2) / (box.x[1] - box.x[0]),
      (graph.height() - FIT_PADDING * 2) / (box.y[1] - box.y[0]),
    );
    if (coarse()) graph.minZoom(k * LEAST_OF_FIT).maxZoom(Math.max(MOST_ZOOM, k));
    return { k, x: (box.x[0] + box.x[1]) / 2, y: (box.y[0] + box.y[1]) / 2 };
  };

  return {
    /** Zoom and pan until every note is on screen. */
    fit(duration: number) {
      const fit = fitted();
      if (fit === null) return;
      graph.centerAt(fit.x, fit.y, duration);
      graph.zoom(fit.k, duration);
    },
    /**
     * A touch screen's first zoom: close enough that the names draw solid, never
     * further out than the fit, about the note with the most links. A phone's fit
     * of a big vault draws every note as a speck under a nameless smear, and the
     * middle of a clustered drawing can be empty space between the areas.
     */
    readable(duration: number, nodes: readonly DrawnNode[]) {
      const fit = fitted();
      if (fit === null) return;
      let hub = nodes[0];
      for (const node of nodes) if (hub === undefined || node.degree > hub.degree) hub = node;
      const k = Math.max(fit.k, NAMES_FULL);
      const close = k > fit.k;
      graph.centerAt(close ? (hub?.x ?? 0) : fit.x, close ? (hub?.y ?? 0) : fit.y, duration);
      graph.zoom(k, duration);
    },
    /** Where the note at `path` is drawn, in CSS px inside the box. */
    screenOf(nodes: readonly DrawnNode[], path: string) {
      const node = nodes.find((one) => one.path === path);
      return node === undefined ? null : graph.graph2ScreenCoords(node.x ?? 0, node.y ?? 0);
    },
    view(): GraphView {
      const { x, y } = graph.centerAt();
      return { k: graph.zoom(), x, y };
    },
  };
}
