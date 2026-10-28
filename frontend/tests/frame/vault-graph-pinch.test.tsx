/**
 * The vault graph's zoom under fingers on a phone, and under a wheel on a desktop
 * (#992): the first zoom, a pinch about its point inside the phone's limits, a
 * pan, the reset to fit, a note's tap after a pinch, and the wheel as it was.
 *
 * The pinch is `TouchEvent`s made in the page, which reach force-graph's d3-zoom
 * the way a finger's do. A tap and a pan have to be the browser's own touch, since
 * force-graph reads a click off pointer events, so they go through the DevTools
 * protocol (`touchDrag`), as the pdf pane's pan does, and so does the wheel.
 */

import { act } from "react";
import { commands as browser, userEvent } from "vitest/browser";
import type { GraphCanvas } from "@/lib/graph/graph-canvas";
import { DESKTOP, need, picture } from "./reader-fixture";
import {
  boxOf,
  DEV_ANSWER,
  mountPane,
  registerVaultFixture,
  serveGraph,
  setUp,
  untilCounted,
  untilStill,
} from "./vault-graph-fixture";

vi.mock("@/lib/graph/graph-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/graph/graph-api")>()),
  fetchGraph: vi.fn(),
}));

// The canvas the pane makes, kept so a test can read where the view stands.
const made: GraphCanvas[] = [];
vi.mock("@/lib/graph/graph-canvas", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/graph/graph-canvas")>();
  return {
    ...actual,
    drawGraph: (...args: Parameters<typeof actual.drawGraph>) => {
      const canvas = actual.drawGraph(...args);
      made.push(canvas);
      return canvas;
    },
  };
});

registerVaultFixture();
vi.setConfig({ testTimeout: 60_000 });

afterEach(() => {
  made.splice(0);
});

const SHOTS = import.meta.env.VITE_KASTEN_SHOTS === "1";

/** The phone the brief names: 414 by 896, touch. */
const PHONE = { name: "touch-414", width: 414, height: 896, coarse: true };
const SETTLED = { timeout: 30_000, interval: 100 };

/** Where names draw solid, the least first zoom on a phone. */
const NAMES_FULL = 1.8;
/** The phone's closest zoom: the smallest dot, 3 graph units round, a finger (24 px) wide. */
const MOST_ZOOM = 4;

interface Point {
  x: number;
  y: number;
}

const canvasOf = () => need(made.at(-1), "graph canvas");
const view = () => canvasOf().view();
const boxIn = (host: HTMLElement) =>
  need(host.querySelector<HTMLElement>("[data-testid='graph-canvas']"), "canvas box");
const surface = (host: HTMLElement) =>
  need(host.querySelector<HTMLCanvasElement>("[data-testid='graph-canvas'] canvas"), "canvas");
const readout = (host: HTMLElement) => host.querySelector("output[aria-label='zoom']");

/** The graph point under `at`, a point of the box. */
function graphAt(host: HTMLElement, at: Point): Point {
  const { k, x, y } = view();
  const rect = boxIn(host).getBoundingClientRect();
  return { x: x + (at.x - rect.width / 2) / k, y: y + (at.y - rect.height / 2) / k };
}

/** A point of the box in the page's coordinates. */
function inPage(host: HTMLElement, at: Point): Point {
  const rect = boxIn(host).getBoundingClientRect();
  return { x: rect.left + at.x, y: rect.top + at.y };
}

/** A `TouchEvent` of `type` with fingers at `points` (box coordinates) on the canvas. */
function touch(host: HTMLElement, type: string, points: Point[], changed = points): TouchEvent {
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
async function pinch(host: HTMLElement, middle: Point, from: number, to: number) {
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
async function tap(host: HTMLElement, at: Point) {
  await browser.touchDrag([inPage(host, at)]);
}

/** The vault graph on a phone, settled at its first zoom. */
async function phone(vim: "on" | "off" = "on", theme: "light" | "dark" = "light") {
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
async function fitted(host: HTMLElement): Promise<number> {
  await userEvent.click(
    need(host.querySelector<HTMLElement>("nav[aria-label='graph moves'] button"), "fit"),
  );
  return still();
}

/** Waits until the zoom stops moving, and gives it back. */
async function still(): Promise<number> {
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
function hubs(): string[] {
  const degree = new Map<string, number>();
  for (const edge of DEV_ANSWER.edges)
    for (const end of [edge.source, edge.target]) degree.set(end, (degree.get(end) ?? 0) + 1);
  const most = Math.max(...degree.values());
  return [...degree].filter(([, n]) => n === most).map(([path]) => path);
}

describe("#992 the vault graph zooms under fingers on a phone", () => {
  for (const vim of ["on", "off"] as const) {
    it(`#992 A1 with vim ${vim}, the first zoom on a phone draws names solid about the most linked note, with notes on screen`, async () => {
      const { host } = await phone(vim);
      await still();

      const { k } = view();
      expect(k).toBeGreaterThanOrEqual(NAMES_FULL - 0.001);
      const rect = boxIn(host).getBoundingClientRect();
      const middle = hubs()
        .map((path) => need(canvasOf().screenOf(path), path))
        .some((at) => Math.hypot(at.x - rect.width / 2, at.y - rect.height / 2) < 2);
      expect(middle).toBe(true);
      const onScreen = DEV_ANSWER.nodes.filter((node) => {
        const at = canvasOf().screenOf(node.path);
        return at !== null && at.x >= 0 && at.x <= rect.width && at.y >= 0 && at.y <= rect.height;
      });
      expect(onScreen.length).toBeGreaterThanOrEqual(5);
      // The readout sits in the touch row, above the canvas, over no note.
      const shown = need(readout(host), "readout").getBoundingClientRect();
      expect(shown.bottom).toBeLessThanOrEqual(rect.top + 0.5);
      expect(readout(host)?.textContent).toBe(`${Math.round(k * 100)}%`);
    });
  }

  it("#992 A2 two fingers zoom about the pinch point, the app stays unzoomed, and the zoom stops at the phone's closest", async () => {
    const { host } = await phone();
    const before = view().k;
    const at = { x: 120, y: 150 };
    const under = graphAt(host, at);

    const move = await pinch(host, at, 100, 150);

    expect(view().k).toBeCloseTo(before * 1.5, 2);
    const after = graphAt(host, at);
    expect(after.x).toBeCloseTo(under.x, 1);
    expect(after.y).toBeCloseTo(under.y, 1);
    // The pinch is the graph's: the browser is told not to zoom the page.
    expect(move.defaultPrevented).toBe(true);
    expect(getComputedStyle(boxIn(host)).touchAction).toBe("none");
    expect(window.visualViewport?.scale ?? 1).toBe(1);
    await vi.waitFor(() =>
      expect(readout(host)?.textContent).toBe(`${Math.round(view().k * 100)}%`),
    );

    await pinch(host, at, 50, 400);
    expect(view().k).toBeCloseTo(MOST_ZOOM, 3);
    await vi.waitFor(() => expect(readout(host)?.textContent).toBe("400%"));
  });

  it("#992 A4 fit and a double tap on the background put the fit back after a pinch, and a pinch out stops at half the fit", async () => {
    const { host } = await phone();
    const fit = await fitted(host);
    expect(fit).toBeLessThan(NAMES_FULL);
    await vi.waitFor(() => expect(readout(host)?.textContent).toBe(`${Math.round(fit * 100)}%`));

    await pinch(host, { x: 200, y: 200 }, 100, 180);
    expect(view().k).toBeGreaterThan(fit * 1.5);
    expect(await fitted(host)).toBeCloseTo(fit, 3);

    await pinch(host, { x: 200, y: 200 }, 400, 20);
    expect(view().k).toBeCloseTo(fit / 2, 3);

    // The fit's 40 px margin is background, and half the fit leaves more of it.
    const corner = { x: 8, y: 8 };
    await tap(host, corner);
    await tap(host, corner);
    await vi.waitFor(() => expect(view().k).toBeCloseTo(fit, 3), { timeout: 5_000 });
    await vi.waitFor(() => expect(readout(host)?.textContent).toBe(`${Math.round(fit * 100)}%`));
  });

  it("#992 A3 one finger on the background pans the graph, and the zoom shown holds", async () => {
    const { host } = await phone();
    const fit = await fitted(host);
    const before = view();

    await browser.touchDrag(
      [0, 1, 2, 3, 4, 5].map((step) => inPage(host, { x: 10 + step * 20, y: 10 + step * 15 })),
    );

    const after = view();
    expect(after.k).toBeCloseTo(fit, 6);
    expect((before.x - after.x) * fit).toBeCloseTo(100, 0);
    expect((before.y - after.y) * fit).toBeCloseTo(75, 0);
    expect(readout(host)?.textContent).toBe(`${Math.round(fit * 100)}%`);
  });

  for (const vim of ["on", "off"] as const) {
    it(`#992 A6 with vim ${vim}, a note's tap after a pinch picks it and a second opens it`, async () => {
      const { host, onOpen } = await phone(vim);
      await still();
      const rect = boxIn(host).getBoundingClientRect();
      await pinch(host, { x: rect.width / 2 - 60, y: rect.height / 2 + 40 }, 100, 140);
      const hub = need(hubs()[0], "hub");
      const at = need(canvasOf().screenOf(hub), "hub on screen");

      await tap(host, at);
      expect(onOpen).not.toHaveBeenCalled();
      await new Promise((done) => setTimeout(done, 400));
      await tap(host, at);

      await vi.waitFor(() => expect(onOpen).toHaveBeenCalledWith(hub));
    });
  }

  it("#992 I3 a switch to Tags on a phone settles at a readable zoom again", async () => {
    const { host } = await phone();
    await fitted(host);
    const tags = need(
      [...host.querySelectorAll<HTMLButtonElement>("[aria-label='mode'] button")].find(
        (button) => button.textContent?.trim().toLowerCase() === "tags",
      ),
      "Tags button",
    );

    await userEvent.click(tags);

    await vi.waitFor(() => expect(view().k).toBeGreaterThanOrEqual(NAMES_FULL - 0.001), SETTLED);
  });
});

describe("#992 the vault graph on a desktop", () => {
  for (const vim of ["on", "off"] as const) {
    it(`#992 A8 with vim ${vim}, a desktop opens at the fit and the wheel zooms about the pointer with no phone limits`, async () => {
      await setUp(DESKTOP, "light", "folders", vim);
      serveGraph(DEV_ANSWER);
      const host = boxOf(DESKTOP.width, DESKTOP.height);
      await mountPane(host);
      await untilCounted(host);
      // The settle fits, and moves for 400 ms after the drawing stops.
      await untilStill(host);
      const opened = await still();
      need(host.querySelector<HTMLElement>("[data-graph-pane]"), "pane").focus();
      await userEvent.keyboard("f");
      // The fit moves for 300 ms, and would take back a wheel turned before it ends.
      await new Promise((done) => setTimeout(done, 400));
      expect(view().k).toBeCloseTo(opened, 3);
      expect(readout(host)).toBeNull();

      const at = { x: 300, y: 250 };
      const under = graphAt(host, at);
      await browser.wheel(inPage(host, at), -500);
      await vi.waitFor(() => expect(view().k).not.toBeCloseTo(opened, 3), { timeout: 5_000 });
      const wheeled = await still();
      // d3-zoom's wheel: 2 to the power of 0.002 per pixel.
      expect(wheeled).toBeCloseTo(opened * 2, 2);
      const after = graphAt(host, at);
      expect(after.x).toBeCloseTo(under.x, 0);
      expect(after.y).toBeCloseTo(under.y, 0);

      // Out past the phone's least zoom, half the fit, which a mouse never had.
      await browser.wheel(inPage(host, at), 3000);
      await vi.waitFor(() => expect(view().k).toBeLessThan(opened / 4), { timeout: 5_000 });
    });
  }
});

// Pictures to look at by eye, with VITE_KASTEN_SHOTS=1, in node_modules/.cache/kasten-shots.
describe("#992 pictures", () => {
  for (const theme of ["light", "dark"] as const) {
    it.skipIf(!SHOTS)(`vault-graph-zoom-414-${theme}`, async () => {
      const { host } = await phone("on", theme);
      await still();
      await picture(host, `vault-graph-zoom-414-first-${theme}`, PHONE);
      const rect = boxIn(host).getBoundingClientRect();
      await pinch(host, { x: rect.width / 2, y: rect.height / 2 }, 100, 180);
      await still();
      await picture(host, `vault-graph-zoom-414-pinched-${theme}`, PHONE);
    });

    it.skipIf(!SHOTS)(`vault-graph-zoom-1440-${theme}`, async () => {
      await setUp(DESKTOP, theme, "folders");
      serveGraph(DEV_ANSWER);
      const host = boxOf(DESKTOP.width, DESKTOP.height);
      await mountPane(host);
      await untilCounted(host);
      await untilStill(host);
      await picture(host, `vault-graph-zoom-1440-${theme}`, DESKTOP);
    });
  }
});
