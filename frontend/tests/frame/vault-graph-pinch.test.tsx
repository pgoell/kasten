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

import { commands as browser, userEvent } from "vitest/browser";
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
import {
  backgroundNear,
  blank,
  boxIn,
  canvasOf,
  drawnNotes,
  fingers,
  fitted,
  graphAt,
  hubs,
  inPage,
  MOST_ZOOM,
  made,
  middleOf,
  NAMES_FULL,
  noteWithBackground,
  PHONE,
  phone,
  pinch,
  placeOf,
  readout,
  SETTLED,
  spread,
  still,
  tap,
  twoNotes,
  unmoved,
  view,
  zoomedAbout,
} from "./vault-graph-pinch-fixture";

vi.mock("@/lib/graph/graph-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/graph/graph-api")>()),
  fetchGraph: vi.fn(),
}));

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
    await still();
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

describe("#1286 a pinch that meets a note zooms the vault graph on a phone", () => {
  for (const vim of ["on", "off"] as const) {
    it(`#1286 A1 with vim ${vim}, a pinch whose first finger is on a note zooms about both fingers and leaves the note where it was`, async () => {
      const { host, onOpen } = await phone(vim);
      await still();
      const note = noteWithBackground(host);
      const was = placeOf(host, note.path);
      const a = { id: 0, ...note.at };
      const b = { id: 1, ...note.empty };
      const before = { k: view().k, under: graphAt(host, middleOf(a, b)) };

      await fingers(host, [[a], [a, b], ...spread(a, b, 20)]);

      zoomedAbout(host, before, a, b, 20);
      unmoved(host, note.path, was);
      // I4: the fingers' lift after the pinch is no tap, so it opens nothing and
      // picks nothing: had it picked the note, one tap on it now would open it.
      await new Promise((done) => setTimeout(done, 900));
      expect(onOpen).not.toHaveBeenCalled();
      await tap(host, need(canvasOf().screenOf(note.path), note.path));
      await new Promise((done) => setTimeout(done, 400));
      expect(onOpen).not.toHaveBeenCalled();
    });
  }

  it("#1286 A2 a pinch with both fingers on notes zooms about both fingers and moves neither note", async () => {
    const { host } = await phone();
    await still();
    const [one, two] = twoNotes(host);
    const wasOne = placeOf(host, one.path);
    const wasTwo = placeOf(host, two.path);
    const a = { id: 0, ...one.at };
    const b = { id: 1, ...two.at };
    const before = { k: view().k, under: graphAt(host, middleOf(a, b)) };

    await fingers(host, [[a], [a, b], ...spread(a, b, 20)]);

    zoomedAbout(host, before, a, b, 20);
    unmoved(host, one.path, wasOne);
    unmoved(host, two.path, wasTwo);
  });

  it("#1286 A3 after a pinch begun on a note, one finger still drags a note and a note's tap picks it and a second opens it", async () => {
    const { host, onOpen } = await phone();
    await still();
    const note = noteWithBackground(host);
    const a = { id: 0, ...note.at };
    const b = { id: 1, ...note.empty };
    const before = { k: view().k, under: graphAt(host, middleOf(a, b)) };
    await fingers(host, [[a], [a, b], ...spread(a, b, 20)]);
    zoomedAbout(host, before, a, b, 20);
    await still();
    // The shadow canvas paints the hit areas at most every 800 ms while frames draw.
    await new Promise((done) => setTimeout(done, 900));

    const [moved] = drawnNotes(host).filter(
      ({ at }) => blank({ x: at.x + 60, y: at.y }) && at.x < 300,
    );
    const target = need(moved, "a note with room to its right");
    const was = placeOf(host, target.path);
    await browser.touchDrag(
      [0, 1, 2, 3, 4, 5, 6].map((step) =>
        inPage(host, { x: target.at.x + step * 10, y: target.at.y }),
      ),
    );
    const now = placeOf(host, target.path);
    expect(now.x - was.x).toBeGreaterThan(30 / view().k);
    expect(onOpen).not.toHaveBeenCalled();

    // The drop lets the note go, and the drawing settles round it again.
    await untilStill(host);
    await new Promise((done) => setTimeout(done, 900));
    const at = need(canvasOf().screenOf(target.path), "dragged note");
    await tap(host, at);
    expect(onOpen).not.toHaveBeenCalled();
    await new Promise((done) => setTimeout(done, 400));
    await tap(host, at);
    await vi.waitFor(() => expect(onOpen).toHaveBeenCalledWith(target.path));
  });

  it("#1286 I1 a pinch whose second finger is on a note zooms about both fingers and leaves the note where it was", async () => {
    const { host } = await phone();
    await still();
    const note = noteWithBackground(host);
    const was = placeOf(host, note.path);
    const a = { id: 0, ...note.empty };
    const b = { id: 1, ...note.at };
    const before = { k: view().k, under: graphAt(host, middleOf(a, b)) };

    await fingers(host, [[a], [a, b], ...spread(a, b, 20)]);

    zoomedAbout(host, before, a, b, 20);
    unmoved(host, note.path, was);
  });

  it("#1286 I2 when the second finger lifts first, the first finger, begun on a note, pans and drags no note", async () => {
    const { host } = await phone();
    await still();
    const note = noteWithBackground(host);
    const was = placeOf(host, note.path);
    const a = { id: 0, ...note.at };
    const b = { id: 1, ...note.empty };
    const before = { k: view().k, under: graphAt(host, middleOf(a, b)) };
    const frames = spread(a, b, 20);
    const last = need(frames.at(-1)?.[0], "first finger's last spot");
    const pan = [1, 2, 3].map((step) => [{ id: 0, x: last.x, y: last.y + step * 15 }]);

    await fingers(host, [[a], [a, b], ...frames, [last], ...pan]);

    unmoved(host, note.path, was);
    // The graph point under the first finger when the second lifted is under it
    // still, 45 px further down: the pinch left it there and the pan carried it.
    const { k } = view();
    const middle = middleOf(a, b);
    const under = graphAt(host, { x: last.x, y: last.y + 45 });
    const apart = Math.hypot(b.x - a.x, b.y - a.y);
    expect(k).toBeCloseTo((before.k * (apart + 40)) / apart, 2);
    expect(under.x).toBeCloseTo(before.under.x + (last.x - middle.x) / k, 1);
    expect(under.y).toBeCloseTo(before.under.y + (last.y - middle.y) / k, 1);
  });

  it("#1286 I3 a third finger on a note during a pinch moves no note and the pinch goes on", async () => {
    const { host } = await phone();
    await still();
    const note = noteWithBackground(host);
    const was = placeOf(host, note.path);
    const a = { id: 0, ...note.empty };
    const b = { id: 1, ...backgroundNear(host, a) };
    const c = { id: 2, ...note.at };
    const before = { k: view().k, under: graphAt(host, middleOf(a, b)) };
    const frames = spread(a, b, 15).map((frame, step) => [
      ...frame,
      { id: 2, x: c.x - (step + 1) * 4, y: c.y - (step + 1) * 4 },
    ]);

    await fingers(host, [[a], [a, b], [a, b, c], ...frames]);

    zoomedAbout(host, before, a, b, 15);
    unmoved(host, note.path, was);
  });
});

describe("#1286 the vault graph on a desktop", () => {
  for (const vim of ["on", "off"] as const) {
    it(`#1286 A4 with vim ${vim}, a mouse drag on a desktop still moves a note`, async () => {
      await setUp(DESKTOP, "light", "folders", vim);
      serveGraph(DEV_ANSWER);
      const host = boxOf(DESKTOP.width, DESKTOP.height);
      await mountPane(host);
      await untilCounted(host);
      await untilStill(host);
      await still();
      const [target] = drawnNotes(host).filter(({ at }) => blank({ x: at.x + 60, y: at.y }));
      const note = need(target, "a note with room to its right");
      const was = placeOf(host, note.path);

      await browser.mouseDrag(
        [0, 1, 2, 3, 4, 5, 6].map((step) =>
          inPage(host, { x: note.at.x + step * 10, y: note.at.y }),
        ),
      );

      expect(placeOf(host, note.path).x - was.x).toBeGreaterThan(30 / view().k);
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
