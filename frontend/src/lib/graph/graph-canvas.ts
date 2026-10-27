/**
 * The graph drawn on a canvas, force-directed, the way Obsidian's is.
 *
 * A thin layer over `force-graph`, which owns the simulation, the zoom, the
 * drag and the hit testing, by finger as by mouse: one finger pans or drags a
 * note, two pinch, a tap opens. What is here is the look: each note a dot sized by
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
  radialLayout,
  radiusOf,
  tagColourOf,
  tagVariable,
} from "@/lib/graph/graph";
import {
  CHARGE,
  CHARGE_REACH,
  type ClusterForces,
  clusterForces,
  groupsOf,
  type Spot,
  seedPositions,
  spotsOf,
} from "@/lib/graph/graph-clusters";
import type { GraphMode } from "@/lib/graph/graph-mode";
import { areasOf, paintDiscs, paintNames, ringed } from "@/lib/graph/graph-paint";
import { onThemeChange } from "@/lib/theme";

export interface GraphCanvasHandlers {
  /** A note was clicked, or tapped. */
  onOpen: (node: DrawnNode) => void;
  /** The background was clicked, or tapped: no note at all. */
  onBlank: () => void;
  /** Whether a finger is doing the pointing, asked on every paint of the hit areas. */
  coarse: () => boolean;
  /** A note was hovered, or the pointer left one: where it is, in CSS px inside the canvas box. */
  onHover?: (hovered: { node: DrawnNode; x: number; y: number } | null) => void;
  /** The engine stopped: the drawn notes, where they settled, in every mode. */
  onSettle?: (nodes: readonly DrawnNode[]) => void;
}

export interface GraphCanvas {
  /** Draw a new answer, keeping the positions of every note already drawn. */
  update(nodes: GraphNode[], edges: GraphEdge[], center?: string): void;
  /** Follow the size of the box the canvas sits in. */
  resize(width: number, height: number): void;
  /** Zoom and pan until every note is on screen. */
  fit(): void;
  /**
   * Group the notes by folder or by tag, or back to the type colours with null.
   * The drawing keeps its canvas: the notes move from where they are to their spots.
   */
  cluster(mode: GraphMode | null): void;
  destroy(): void;
}

/** The zoom at which names begin to show, and the zoom at which they are solid. */
const NAMES_FROM = 0.9;
const NAMES_FULL = 1.8;

/** How much a note outside the lit neighbourhood keeps of its colour. */
const DIMMED = 0.15;

/**
 * How much of its colour a plain link keeps. `--k-rule` sits about 1.2:1 on the
 * page and vanishes, so a plain link is the muted grey at half strength.
 */
const PLAIN_LINK = 0.5;

/**
 * The least a note's hit area measures across on a touch screen, in CSS pixels.
 *
 * The smallest target WCAG 2.2 allows, and no more: a touch that lands in a
 * hit area drags that note, so every pixel given to tapping is taken from
 * panning and pinching, and a zoomed-out vault is mostly notes.
 */
const FINGER = 24;

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

/**
 * The dot radii of a radial drawing, in CSS pixels: the middle note, the first
 * ring and every ring after. Zoom is fixed there, so these are on screen as
 * they are written.
 */
const CENTRE_DOT = 7;
const RING_ONE_DOT = 5;
const OUTER_DOT = 3.5;

/**
 * The accent ring of a radial drawing: a gap of 2.5 CSS px outside the dot and
 * 1.5 px wide, so the dot's own colour shows between it and the ring.
 */
const RING_GAP = 2.5;
const RING_WIDTH = 1.5;

/** The hit area of a radial note: the dot plus 2, and half a finger on a touch screen. */
function radialHitRadius(dot: number, coarse: boolean): number {
  const drawn = dot + 2;
  return coarse ? Math.max(drawn, FINGER / 2) : drawn;
}

/** A theme variable's value, read until the theme changes. */
function themed(variable: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
}

/**
 * A hex colour at a fraction of its strength, for the links a dimmed note keeps.
 *
 * Canvas takes a colour as a string, and force-graph hands one back to it as
 * the link colour, so the alpha has to be written into the string. The tokens
 * are hex, so this reads the digits and leaves the rest to the browser.
 */
function faded(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * A radial drawing is the margin's: the note in the middle, its links on rings
 * around it, filled by first tag, and no names on the canvas. The lists beside
 * the canvas name the notes, so the canvas only shows where they are.
 */
export function drawGraph(
  element: HTMLElement,
  handlers: GraphCanvasHandlers,
  options: { radial?: boolean } = {},
): GraphCanvas {
  const radial = options.radial === true;
  const colours = new Map<string, string>();
  const colour = (variable: string) => {
    let value = colours.get(variable);
    if (value === undefined) {
      value = themed(variable);
      colours.set(variable, value);
    }
    return value;
  };

  // A radial drawing sits on the margin's own paper, so it paints no background
  // and the page shows through; the list graph keeps the page colour it always had.
  const background = () => (radial ? "rgba(0, 0, 0, 0)" : colour("--k-bg"));

  let drawing: Drawing = { nodes: [], links: [] };
  let center: string | undefined;
  let lit: Set<string> | null = null;
  let hovered: string | null = null;

  const shown = (path: string) => lit === null || lit.has(path);

  // Cluster mode's state. Null is the drawing the canvas always was. The spots and
  // their members are worked out again for each answer, since a filter can take
  // a place away, and the fit waits for the first settle of each mode switch.
  let mode: GraphMode | null = null;
  let spotList: Spot[] = [];
  let groups = new Map<string, { name: string; members: DrawnNode[] }>();
  let fitPending = false;
  const tagged = () => radial || mode !== null;

  // A radial drawing's layout is kept with the box it was laid out in, so a
  // resize can lay it out again: the rings scale to the box.
  let boxWidth = element.clientWidth;
  let boxHeight = element.clientHeight;
  let laid: { nodes: GraphNode[]; edges: GraphEdge[]; center: string } | null = null;
  const ringOf = new Map<string, number>();

  /** The dot a note is drawn as: by its ring in a radial drawing, by its links otherwise. */
  const dotOf = (node: DrawnNode): number => {
    if (!radial) return radiusOf(node.degree);
    const ring = ringOf.get(node.path);
    if (ring === 0) return CENTRE_DOT;
    if (ring === 1) return RING_ONE_DOT;
    return OUTER_DOT;
  };

  const placeRadially = () => {
    if (!radial || laid === null) return;
    const layout = radialLayout(laid.nodes, laid.edges, laid.center);
    let outer = 1;
    for (const point of layout.values()) outer = Math.max(outer, point.ring);
    // Half the box, less a margin for the outer dots, one ring's width per ring.
    const unit = (Math.min(boxWidth, boxHeight) / 2 - 16) / outer;
    ringOf.clear();
    for (const node of drawing.nodes) {
      const point = layout.get(node.path);
      if (point === undefined) continue;
      ringOf.set(node.path, point.ring);
      node.x = point.x * unit;
      node.y = point.y * unit;
      // Fixed in place: a radial note never settles or gets dragged.
      node.fx = node.x;
      node.fy = node.y;
    }
  };

  // The library fits a fresh drawing to its size inside graphData, so the
  // centre and the zoom are set after it, or it would win and the notes would
  // sit off the middle.
  const recentre = () => {
    if (!radial) return;
    graph.centerAt(0, 0);
    graph.zoom(1);
  };

  // The spots, their members and the forces, from the drawing as it is now. The
  // forces are made again for each answer, and a note that has no position yet
  // is seeded round its spot first, so the simulation starts from there.
  const clusterUp = (active: GraphMode) => {
    spotList = spotsOf(drawing.nodes, active);
    const spotMap = new Map(spotList.map((spot) => [spot.key, spot]));
    groups = groupsOf(drawing.nodes, active);
    seedPositions(drawing.nodes, active, spotMap);
    const forces: ClusterForces = clusterForces(active, spotMap);
    forces.attract.links(drawing.links);
    graph
      .d3Force("attract", forces.attract)
      .d3Force("anchor", forces.anchor)
      .d3Force("gravity", forces.gravity);
  };

  // The areas are worked out again each frame, as the notes move. The discs go
  // under the notes, so the dots sit on the wash; the names go over them.
  const underNotes = (ctx: CanvasRenderingContext2D) => {
    if (mode === null) return;
    paintDiscs(ctx, areasOf(spotList, groups), colour);
  };
  const overNotes = (ctx: CanvasRenderingContext2D, scale: number) => {
    if (mode === null) return;
    paintNames(ctx, areasOf(spotList, groups), scale, colour);
  };

  const graph = new ForceGraph<DrawnNode, DrawnLink>(element)
    .backgroundColor(background())
    .nodeId("path")
    .nodeLabel(() => "")
    // Redrawn on every frame rather than only while the simulation runs, so a
    // hover lights its neighbourhood up once the drawing has settled. A radial
    // drawing is still, so it pauses, and asks for its one repaint by a zoom.
    .autoPauseRedraw(radial)
    .cooldownTicks(200)
    .nodeVal((node) => radiusOf(node.degree) ** 2)
    .nodeRelSize(1)
    .nodeCanvasObject((node, ctx, scale) => {
      const radius = dotOf(node);
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      ctx.globalAlpha = shown(node.path) ? 1 : DIMMED;

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      if (node.missing) {
        // Hollow: a link has promised the note and nobody has written it.
        ctx.lineWidth = 1 / scale;
        ctx.strokeStyle = colour("--k-muted");
        ctx.stroke();
      } else {
        ctx.fillStyle = colour(tagged() ? tagColourOf(node) : colourOf(node));
        ctx.fill();
        // Each tag past the first is a thin ring outside the dot, each further out.
        if (mode !== null) {
          // Tags are counted by their lowercased key, so a tag written again in another
          // case is the first tag, not a further one, and gets no ring of its own.
          const further = [...new Set(node.tags.map((tag) => tag.toLowerCase()))].slice(1);
          further.forEach((tag, i) => {
            ctx.beginPath();
            ctx.arc(x, y, radius + (2 + i * 2.5) / scale, 0, 2 * Math.PI);
            ctx.lineWidth = 1.25 / scale;
            ctx.strokeStyle = colour(tagVariable(tag));
            ctx.stroke();
          });
        }
      }
      if (node.path === center || node.path === hovered) {
        if (radial) {
          // A ring with a gap from the dot: on its edge it reads as a dark rim
          // on the light sheet, and the dot's own colour is what should show.
          ctx.beginPath();
          ctx.arc(x, y, radius + RING_GAP, 0, 2 * Math.PI);
          ctx.lineWidth = RING_WIDTH;
        } else {
          ctx.lineWidth = 2 / scale;
        }
        ctx.strokeStyle = colour("--k-accent");
        ctx.stroke();
      }

      // Names fade in with the zoom, the way Obsidian's do, and always show
      // on the lit neighbourhood and on the centre of a local graph.
      const always = lit?.has(node.path) === true || node.path === center;
      const fade = Math.min(1, Math.max(0, (scale - NAMES_FROM) / (NAMES_FULL - NAMES_FROM)));
      const alpha = always ? 1 : fade;
      if (!radial && alpha > 0 && shown(node.path)) {
        ctx.globalAlpha = alpha;
        ctx.font = `${12 / scale}px ${colour("--k-mono")}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = colour("--k-ink-soft");
        ringed(ctx, node.name, x, y + radius + 2 / scale, colour("--k-bg"), scale);
      }
      ctx.globalAlpha = 1;
    })
    .nodePointerAreaPaint((node, paint, ctx, scale) => {
      ctx.fillStyle = paint;
      ctx.beginPath();
      ctx.arc(
        node.x ?? 0,
        node.y ?? 0,
        radial
          ? radialHitRadius(dotOf(node), handlers.coarse())
          : hitRadius(node.degree, scale, handlers.coarse()),
        0,
        2 * Math.PI,
      );
      ctx.fill();
    })
    .linkColor((link) => {
      const on = lit === null || (lit.has(endOf(link.source)) && lit.has(endOf(link.target)));
      const plain = link.relation === null;
      const base = plain ? "--k-muted" : "--tg-7";
      const touching =
        hovered !== null && [endOf(link.source), endOf(link.target)].includes(hovered);
      if (touching) return colour("--k-accent");
      if (!on) return faded(colour(base), DIMMED);
      return plain ? faded(colour(base), PLAIN_LINK) : colour(base);
    })
    .linkWidth((link) => {
      if (link.relation !== null) return 1.2;
      // A plain link at 0.6 px vanishes on the light sheet, so a radial drawing
      // draws it at a full pixel.
      return radial ? 1 : 0.6;
    })
    .linkDirectionalArrowLength((link) => (link.relation === null ? 0 : 4))
    .linkDirectionalArrowRelPos(1)
    // A typed relation says what it is when its neighbourhood is lit. On every
    // edge at once the names would be a wall of words over the lines.
    .linkCanvasObjectMode(() => "after")
    .linkCanvasObject((link, ctx, scale) => {
      if (radial || link.relation === null || hovered === null) return;
      const source = link.source as DrawnNode;
      const target = link.target as DrawnNode;
      if (source.path !== hovered && target.path !== hovered) return;
      ctx.font = `${10 / scale}px ${colour("--k-mono")}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = colour("--tg-7");
      ringed(
        ctx,
        link.relation,
        ((source.x ?? 0) + (target.x ?? 0)) / 2,
        ((source.y ?? 0) + (target.y ?? 0)) / 2,
        colour("--k-bg"),
        scale,
      );
    })
    .onNodeHover((node) => {
      hovered = node?.path ?? null;
      lit = node ? neighbourhood(drawing.links, node.path) : null;
      element.style.cursor = node ? "pointer" : "";
      // A paused radial canvas repaints when its zoom changes, and zoom 1 is
      // where it already is, so the hover shows once and nothing moves.
      if (radial) graph.zoom(1);
      handlers.onHover?.(
        node ? { node, ...graph.graph2ScreenCoords(node.x ?? 0, node.y ?? 0) } : null,
      );
    })
    .onNodeClick((node) => handlers.onOpen(node))
    .onBackgroundClick(() => handlers.onBlank())
    .onRenderFramePre(underNotes)
    .onRenderFramePost(overNotes)
    // Fitted once the cluster has settled, so the areas fill the pane. A plain
    // answer is left where the user has put it.
    .onEngineStop(() => {
      if (fitPending) {
        fitPending = false;
        graph.zoomToFit(400, 40);
      }
      handlers.onSettle?.(drawing.nodes);
    });

  // What force-graph sets by default, kept so cluster(null) can put it back.
  const defaults = {
    link: graph.d3Force("link")?.strength(),
    charge: graph.d3Force("charge")?.strength(),
    reach: graph.d3Force("charge")?.distanceMax(),
    centre: graph.d3Force("center"),
  };

  if (radial) {
    // Nothing moves in a radial drawing: the notes sit where the layout put
    // them, so no pan, zoom, drag or settling.
    graph
      .enableZoomInteraction(false)
      .enablePanInteraction(false)
      .enableNodeDrag(false)
      .cooldownTicks(0)
      // The library re-zooms a fresh drawing to fit its node count, and it does
      // so after the update's own debounce, long after our zoom(1). Every zoom
      // it makes comes through here, so each one is put back to 1 at once.
      .onZoom((transform) => {
        if (transform.k !== 1) graph.zoom(1);
      });
  }

  // A theme switch changes no node, so the canvas repaints on the next frame
  // and only the cached values and the background need new reads. A paused
  // radial canvas has no next frame, so it is asked for one by the same zoom.
  const unlisten = onThemeChange(() => {
    colours.clear();
    graph.backgroundColor(background());
    if (radial) graph.zoom(1);
  });

  return {
    update(nodes, edges, around) {
      const first = drawing.nodes.length === 0;
      drawing = mergeDrawing(drawing, nodes, edges);
      center = around;
      laid = { nodes, edges, center: around ?? "" };
      placeRadially();
      if (mode !== null) {
        // A mode set before the answer arrives settles on an empty drawing, so the
        // first answer that has notes is fitted when it settles, not the empty one.
        if (first && drawing.nodes.length > 0) fitPending = true;
        clusterUp(mode);
      }
      graph.graphData(drawing);
      recentre();
    },
    resize(width, height) {
      boxWidth = width;
      boxHeight = height;
      graph.width(width).height(height);
      placeRadially();
      recentre();
    },
    fit() {
      graph.zoomToFit(300, 40);
    },
    cluster(next) {
      // A radial drawing is fixed on its rings, so it never takes a cluster mode.
      if (radial) return;
      mode = next;
      if (next === null) {
        fitPending = false;
        graph
          .d3Force("attract", null)
          .d3Force("anchor", null)
          .d3Force("gravity", null)
          .d3Force("center", defaults.centre ?? null);
        graph.d3Force("link")?.strength(defaults.link);
        graph.d3Force("charge")?.strength(defaults.charge).distanceMax(defaults.reach);
        graph.cooldownTicks(200).cooldownTime(15000);
      } else {
        // The link force stays, at no strength, since force-graph resolves each
        // link's ends with it. The centre would pull the clusters back to one point.
        graph.d3Force("link")?.strength(0);
        graph.d3Force("center", null);
        graph.d3Force("charge")?.strength(CHARGE).distanceMax(CHARGE_REACH);
        // The wall clock never cuts a run, so the layout is the same on every open.
        graph.cooldownTicks(300).cooldownTime(Number.POSITIVE_INFINITY).warmupTicks(0);
        fitPending = true;
        clusterUp(next);
      }
      graph.d3ReheatSimulation();
    },
    destroy() {
      unlisten();
      graph._destructor();
    },
  };
}
