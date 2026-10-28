/**
 * The vault graph's pinch tests share this rig: a phone mounted at its first
 * zoom, where the view stands, and fingers made in the page or by the browser,
 * with the notes and the background they land on.
 *
 * The test file mocks `drawGraph` to keep each canvas in `made`, since vitest
 * hoists `vi.mock` there.
 */

import { act } from "react";
import { commands as browser, userEvent } from "vitest/browser";
import type { GraphCanvas } from "@/lib/graph/graph-canvas";
import { need } from "./reader-fixture";
import {
  boxOf,
  DEV_ANSWER,
  mountPane,
  serveGraph,
  setUp,
  untilCounted,
} from "./vault-graph-fixture";

/** The canvases the pane made, the last the one on screen. */
export const made: GraphCanvas[] = [];

/** The phone the brief names: 414 by 896, touch. */
export const PHONE = { name: "touch-414", width: 414, height: 896, coarse: true };
export const SETTLED = { timeout: 30_000, interval: 100 };

/** Where names draw solid, the least first zoom on a phone. */
export const NAMES_FULL = 1.8;
/** The phone's closest zoom: the smallest dot, 3 graph units round, a finger (24 px) wide. */
export const MOST_ZOOM = 4;

export interface Point {
  x: number;
  y: number;
}

export const canvasOf = () => need(made.at(-1), "graph canvas");
export const view = () => canvasOf().view();
export const boxIn = (host: HTMLElement) =>
  need(host.querySelector<HTMLElement>("[data-testid='graph-canvas']"), "canvas box");
export const surface = (host: HTMLElement) =>
  need(host.querySelector<HTMLCanvasElement>("[data-testid='graph-canvas'] canvas"), "canvas");
export const readout = (host: HTMLElement) => host.querySelector("output[aria-label='zoom']");

/** The graph point under `at`, a point of the box. */
export function graphAt(host: HTMLElement, at: Point): Point {
  const { k, x, y } = view();
  const rect = boxIn(host).getBoundingClientRect();
  return { x: x + (at.x - rect.width / 2) / k, y: y + (at.y - rect.height / 2) / k };
}

/** A point of the box in the page's coordinates. */
export function inPage(host: HTMLElement, at: Point): Point {
  const rect = boxIn(host).getBoundingClientRect();
  return { x: rect.left + at.x, y: rect.top + at.y };
}

/** A `TouchEvent` of `type` with fingers at `points` (box coordinates) on the canvas. */
export function touch(
  host: HTMLElement,
  type: string,
  points: Point[],
  changed = points,
): TouchEvent {
  const target = surface(host);
  const make = (point: Point, index: number) => {
    const { x, y } = inPage(host, point);
    return new Touch({ identifier: index, target, clientX: x, clientY: y });
  };
  const event = new TouchEvent(type, {
    touches: points.map(make),
    changedTouches: changed.map(make),
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

/** Two fingers about `middle`, `from` px apart, spread in steps to `to`. Returns the last move. */
export async function pinch(host: HTMLElement, middle: Point, from: number, to: number) {
  const fingers = (spread: number): Point[] => [
    { x: middle.x - spread / 2, y: middle.y },
    { x: middle.x + spread / 2, y: middle.y },
  ];
  let last: TouchEvent | undefined;
  await act(async () => {
    touch(host, "touchstart", fingers(from));
    for (let step = 1; step <= 6; step += 1)
      last = touch(host, "touchmove", fingers(from + ((to - from) * step) / 6));
    touch(host, "touchend", [], fingers(to));
  });
  return need(last, "last touchmove");
}

/** One real finger's tap at `at`, a point of the box. */
export async function tap(host: HTMLElement, at: Point) {
  await browser.touchDrag([inPage(host, at)]);
}

/** The vault graph on a phone, settled at its first zoom. */
export async function phone(vim: "on" | "off" = "on", theme: "light" | "dark" = "light") {
  await setUp(PHONE, theme, "folders", vim);
  serveGraph(DEV_ANSWER);
  const host = boxOf(PHONE.width, PHONE.height);
  const spies = await mountPane(host);
  await untilCounted(host);
  // The first zoom is made when the engine stops, and moves for 400 ms.
  await vi.waitFor(
    () => expect(readout(host)?.textContent).toBe(`${Math.round(view().k * 100)}%`),
    SETTLED,
  );
  await vi.waitFor(() => expect(view().k).toBeGreaterThanOrEqual(NAMES_FULL - 0.001), SETTLED);
  return { host, ...spies };
}

/** Taps fit, and gives back the zoom it settles at. */
export async function fitted(host: HTMLElement): Promise<number> {
  await userEvent.click(
    need(host.querySelector<HTMLElement>("nav[aria-label='graph moves'] button"), "fit"),
  );
  return still();
}

/** Waits until the zoom stops moving, and gives it back. */
export async function still(): Promise<number> {
  let last = Number.NaN;
  await vi.waitFor(
    () => {
      const now = view().k;
      const same = Math.abs(now - last) < 1e-6;
      last = now;
      expect(same).toBe(true);
    },
    { timeout: 5_000, interval: 150 },
  );
  return last;
}

/** The notes with the most links in the dev vault, by both ends. */
export function hubs(): string[] {
  const degree = new Map<string, number>();
  for (const edge of DEV_ANSWER.edges)
    for (const end of [edge.source, edge.target]) degree.set(end, (degree.get(end) ?? 0) + 1);
  const most = Math.max(...degree.values());
  return [...degree].filter(([, n]) => n === most).map(([path]) => path);
}

/** A finger of `browser.touches`, at a point of the box. */
export interface Finger extends Point {
  id: number;
}

/** The hit area's half width on a phone, and some room, in CSS px. */
export const CLEAR = 30;

/** The notes drawn inside the box, away from its edges, with where they are on screen. */
export function drawnNotes(host: HTMLElement): { path: string; at: Point }[] {
  const rect = boxIn(host).getBoundingClientRect();
  return DEV_ANSWER.nodes.flatMap((node) => {
    const at = canvasOf().screenOf(node.path);
    if (at === null) return [];
    const inside = at.x > 60 && at.x < rect.width - 60 && at.y > 60 && at.y < rect.height - 60;
    return inside ? [{ path: node.path, at }] : [];
  });
}

/** Whether `at` is clear of every drawn note's hit area. */
export function blank(at: Point): boolean {
  return DEV_ANSWER.nodes.every((node) => {
    const spot = canvasOf().screenOf(node.path);
    return spot === null || Math.hypot(spot.x - at.x, spot.y - at.y) > CLEAR;
  });
}

/** A background point 70 to 110 px from `from`, with the room past it a spread needs clear too. */
export function clearNear(host: HTMLElement, from: Point): Point | null {
  const rect = boxIn(host).getBoundingClientRect();
  for (const reach of [80, 70, 90, 100, 110])
    for (let turn = 0; turn < 24; turn += 1) {
      const angle = (turn * Math.PI) / 12;
      const at = { x: from.x + reach * Math.cos(angle), y: from.y + reach * Math.sin(angle) };
      const inside = at.x > 60 && at.x < rect.width - 60 && at.y > 60 && at.y < rect.height - 60;
      if (inside && blank(at)) return at;
    }
  return null;
}

export function backgroundNear(host: HTMLElement, from: Point): Point {
  return need(clearNear(host, from), `background near ${from.x}, ${from.y}`);
}

/** A note with a clear background point near it. */
export function noteWithBackground(host: HTMLElement): { path: string; at: Point; empty: Point } {
  for (const note of drawnNotes(host)) {
    const empty = clearNear(host, note.at);
    if (empty !== null) return { ...note, empty };
  }
  throw new Error("no note with background beside it");
}

/** Two notes 70 to 160 px apart, each clear of every other note's hit area. */
export function twoNotes(
  host: HTMLElement,
): [{ path: string; at: Point }, { path: string; at: Point }] {
  const notes = drawnNotes(host);
  const alone = (one: { path: string; at: Point }) =>
    notes.every(
      (other) =>
        other.path === one.path || Math.hypot(other.at.x - one.at.x, other.at.y - one.at.y) > CLEAR,
    );
  for (const a of notes)
    for (const b of notes) {
      const apart = Math.hypot(a.at.x - b.at.x, a.at.y - b.at.y);
      if (a.path < b.path && apart > 70 && apart < 160 && alone(a) && alone(b)) return [a, b];
    }
  throw new Error("no two notes apart");
}

/** Where the note at `path` is in graph units. */
export function placeOf(host: HTMLElement, path: string): Point {
  return graphAt(host, need(canvasOf().screenOf(path), path));
}

/**
 * Frames of two fingers spreading from `a` and `b` along the line between them,
 * each by `by` px in six steps, the way a pinch moves both fingers at once.
 */
export function spread(a: Finger, b: Finger, by: number): Finger[][] {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  return [1, 2, 3, 4, 5, 6].map((step) => {
    const d = (by * step) / 6;
    return [
      { id: a.id, x: a.x - ux * d, y: a.y - uy * d },
      { id: b.id, x: b.x + ux * d, y: b.y + uy * d },
    ];
  });
}

/** The fingers' frames in the page's coordinates, for the protocol. */
export async function fingers(host: HTMLElement, frames: Finger[][]) {
  await browser.touches(
    frames.map((frame) => frame.map((finger) => ({ ...finger, ...inPage(host, finger) }))),
  );
}

export const middleOf = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Expects the pinch from `a`, `b` spread by `by` to have zoomed about the fingers. */
export function zoomedAbout(
  host: HTMLElement,
  before: { k: number; under: Point },
  a: Point,
  b: Point,
  by: number,
) {
  const apart = Math.hypot(b.x - a.x, b.y - a.y);
  expect(view().k).toBeCloseTo((before.k * (apart + 2 * by)) / apart, 2);
  const after = graphAt(host, middleOf(a, b));
  expect(after.x).toBeCloseTo(before.under.x, 1);
  expect(after.y).toBeCloseTo(before.under.y, 1);
}

/** Expects the note at `path` to be at `was`, in graph units. */
export function unmoved(host: HTMLElement, path: string, was: Point) {
  const now = placeOf(host, path);
  expect(Math.hypot(now.x - was.x, now.y - was.y)).toBeLessThan(0.5);
}
