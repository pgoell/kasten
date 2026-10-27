/**
 * The painting the graph canvas does by hand: a label ringed in the page colour,
 * and the cluster areas, a wash round each cluster's notes with its name over it.
 * The canvas decides when each is drawn; this says how.
 */

import type { DrawnNode } from "@/lib/graph/graph";
import { areaOf, gapOf, nameBaselines, type Spot } from "@/lib/graph/graph-clusters";

/**
 * A label in the fill the caller set, with the page colour stroked round its
 * letters first, so a dot or a line behind it does not run into the letters.
 */
export function ringed(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  page: string,
  scale: number,
): void {
  ctx.strokeStyle = page;
  ctx.lineWidth = 3 / scale;
  ctx.lineJoin = "round";
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
}

/** One cluster's area: its spot, and the disc it is drawn as. */
export interface Area {
  spot: Spot;
  x: number;
  y: number;
  radius: number;
}

/** Each spot's area, round the notes it holds as they stand now. */
export function areasOf(
  spots: readonly Spot[],
  groups: ReadonlyMap<string, { members: readonly DrawnNode[] }>,
): Area[] {
  const gap = gapOf(spots);
  return spots.map((spot) => ({ spot, ...areaOf(groups.get(spot.key)?.members ?? [], gap) }));
}

/** The discs, drawn under the notes: each in its spot's colour at the area strength. */
export function paintDiscs(
  ctx: CanvasRenderingContext2D,
  areas: readonly Area[],
  colour: (variable: string) => string,
): void {
  for (const area of areas) {
    ctx.globalAlpha = Number(colour("--k-area"));
    ctx.fillStyle = colour(area.spot.variable);
    ctx.beginPath();
    ctx.arc(area.x, area.y, area.radius, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * The names, drawn over the notes so no dot or link runs through a letter. A name
 * that would print on another moves up a line, as nameBaselines says.
 */
export function paintNames(
  ctx: CanvasRenderingContext2D,
  areas: readonly Area[],
  scale: number,
  colour: (variable: string) => string,
): void {
  ctx.globalAlpha = 1;
  ctx.font = `italic ${12 / scale}px ${colour("--k-serif")}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = colour("--k-muted");
  const baselines = nameBaselines(
    areas.map((area) => ({
      x: area.x,
      y: area.y - area.radius,
      half: ctx.measureText(area.spot.name).width / 2,
    })),
    14 / scale,
    12 / scale,
  );
  areas.forEach((area, i) => {
    ringed(ctx, area.spot.name, area.x, baselines[i] ?? 0, colour("--k-bg"), scale);
  });
}
