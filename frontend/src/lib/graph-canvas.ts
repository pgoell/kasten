/**
 * The graph drawn on a canvas, force-directed, the way Obsidian's is.
 *
 * A thin layer over `force-graph`, which owns the simulation, the zoom, the
 * drag and the hit testing. What is here is the look: each note a dot sized by
 * its links and coloured by its type, a typed relation drawn in colour with an
 * arrow and a plain link as a faint line, names that fade in as you zoom, and
 * a hover that lights up one note's neighbourhood and dims the rest.
 *
 * Its own module so the pane can be tested without a canvas: jsdom has none,
 * and a test replaces this file rather than the library under it.
 */

import ForceGraph from "force-graph";
import {
  colourOf,
  type Drawing,
  type DrawnLink,
  type DrawnNode,
  endOf,
  type GraphEdge,
  type GraphNode,
  mergeDrawing,
  neighbourhood,
  radiusOf,
} from "@/lib/graph";

export interface GraphCanvasHandlers {
  /** A note was clicked. */
  onOpen: (node: DrawnNode) => void;
}

export interface GraphCanvas {
  /** Draw a new answer, keeping the positions of every note already drawn. */
  update(nodes: GraphNode[], edges: GraphEdge[], center?: string): void;
  /** Follow the size of the box the canvas sits in. */
  resize(width: number, height: number): void;
  /** Zoom and pan until every note is on screen. */
  fit(): void;
  destroy(): void;
}

/** The zoom at which names begin to show, and the zoom at which they are solid. */
const NAMES_FROM = 0.9;
const NAMES_FULL = 1.8;

/** How much a note outside the lit neighbourhood keeps of its colour. */
const DIMMED = 0.15;

/** A theme variable's value, read once when the canvas is made. */
function themed(variable: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim() || "#abb2bf";
}

export function drawGraph(element: HTMLElement, handlers: GraphCanvasHandlers): GraphCanvas {
  const colours = new Map<string, string>();
  const colour = (variable: string) => {
    let value = colours.get(variable);
    if (value === undefined) {
      value = themed(variable);
      colours.set(variable, value);
    }
    return value;
  };

  let drawing: Drawing = { nodes: [], links: [] };
  let center: string | undefined;
  let lit: Set<string> | null = null;
  let hovered: string | null = null;

  const shown = (path: string) => lit === null || lit.has(path);

  const graph = new ForceGraph<DrawnNode, DrawnLink>(element)
    .backgroundColor(colour("--color-one-bg"))
    .nodeId("path")
    .nodeLabel(() => "")
    // Redrawn on every frame rather than only while the simulation runs, so a
    // hover lights its neighbourhood up once the drawing has settled.
    .autoPauseRedraw(false)
    .cooldownTicks(200)
    .nodeVal((node) => radiusOf(node.degree) ** 2)
    .nodeRelSize(1)
    .nodeCanvasObject((node, ctx, scale) => {
      const radius = radiusOf(node.degree);
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      ctx.globalAlpha = shown(node.path) ? 1 : DIMMED;

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      if (node.missing) {
        // Hollow: a link has promised the note and nobody has written it.
        ctx.lineWidth = 1 / scale;
        ctx.strokeStyle = colour("--color-one-muted");
        ctx.stroke();
      } else {
        ctx.fillStyle = colour(colourOf(node));
        ctx.fill();
      }
      if (node.path === center || node.path === hovered) {
        ctx.lineWidth = 2 / scale;
        ctx.strokeStyle = colour("--color-one-accent");
        ctx.stroke();
      }

      // Names fade in with the zoom, the way Obsidian's do, and always show
      // on the lit neighbourhood and on the centre of a local graph.
      const always = lit?.has(node.path) === true || node.path === center;
      const fade = Math.min(1, Math.max(0, (scale - NAMES_FROM) / (NAMES_FULL - NAMES_FROM)));
      const alpha = always ? 1 : fade;
      if (alpha > 0 && shown(node.path)) {
        ctx.globalAlpha = alpha;
        ctx.font = `${12 / scale}px ui-monospace, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = colour("--color-one-fg");
        ctx.fillText(node.name, x, y + radius + 2 / scale);
      }
      ctx.globalAlpha = 1;
    })
    .nodePointerAreaPaint((node, paint, ctx) => {
      ctx.fillStyle = paint;
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, radiusOf(node.degree) + 2, 0, 2 * Math.PI);
      ctx.fill();
    })
    .linkColor((link) => {
      const on = lit === null || (lit.has(endOf(link.source)) && lit.has(endOf(link.target)));
      const base = link.relation === null ? "--color-one-selection" : "--color-one-purple";
      const touching =
        hovered !== null && [endOf(link.source), endOf(link.target)].includes(hovered);
      if (touching) return colour("--color-one-accent");
      return on ? colour(base) : `${colour(base)}26`;
    })
    .linkWidth((link) => (link.relation === null ? 0.6 : 1.2))
    .linkDirectionalArrowLength((link) => (link.relation === null ? 0 : 4))
    .linkDirectionalArrowRelPos(1)
    // A typed relation says what it is when its neighbourhood is lit. On every
    // edge at once the names would be a wall of words over the lines.
    .linkCanvasObjectMode(() => "after")
    .linkCanvasObject((link, ctx, scale) => {
      if (link.relation === null || hovered === null) return;
      const source = link.source as DrawnNode;
      const target = link.target as DrawnNode;
      if (source.path !== hovered && target.path !== hovered) return;
      ctx.font = `${10 / scale}px ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = colour("--color-one-purple");
      ctx.fillText(
        link.relation,
        ((source.x ?? 0) + (target.x ?? 0)) / 2,
        ((source.y ?? 0) + (target.y ?? 0)) / 2,
      );
    })
    .onNodeHover((node) => {
      hovered = node?.path ?? null;
      lit = node ? neighbourhood(drawing.links, node.path) : null;
      element.style.cursor = node ? "pointer" : "";
    })
    .onNodeClick((node) => handlers.onOpen(node));

  return {
    update(nodes, edges, around) {
      drawing = mergeDrawing(drawing, nodes, edges);
      center = around;
      graph.graphData(drawing);
    },
    resize(width, height) {
      graph.width(width).height(height);
    },
    fit() {
      graph.zoomToFit(300, 40);
    },
    destroy() {
      graph._destructor();
    },
  };
}
