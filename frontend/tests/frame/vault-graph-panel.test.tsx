/**
 * The vault graph's side panel in a mounted pane: 300 px beside the canvas on a
 * desktop, under it in a narrow pane or on a phone, each pane of a split with its
 * own, the area strength by theme, Tab's reach, and `m` with vim on and off.
 */

import { userEvent } from "vitest/browser";
import { DESKTOP, need, TOUCH } from "./reader-fixture";
import {
  boxOf,
  DEV_ANSWER,
  mountPane,
  registerVaultFixture,
  rowOf,
  serveGraph,
  setUp,
  untilCanvas,
  untilCounted,
  untilStill,
} from "./vault-graph-fixture";

vi.mock("@/lib/graph-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/graph-api")>()),
  fetchGraph: vi.fn(),
}));

registerVaultFixture();

const COUNTS = "75 notes and 67 links. The archive is left out.";
const FOLDERS_READING = "Places are folders. Colour is the first tag, a ring each further tag.";
const TAGS_READING = "Places are tags. Colour is the first tag, a ring each further tag.";

const panelOf = (host: HTMLElement) =>
  host.querySelector<HTMLElement>("aside[aria-label='graph panel']");
const pressedMode = (host: HTMLElement) =>
  host.querySelector("[aria-label='mode'] [aria-pressed='true']")?.textContent;

/** Where a pane's canvas box ends, and the panel starts, read off the screen. */
function boxesOf(host: HTMLElement) {
  const canvas = need(
    host.querySelector<HTMLElement>("[data-testid='graph-canvas']"),
    "canvas box",
  );
  return { canvas: canvas.getBoundingClientRect(), panel: panelOf(host)?.getBoundingClientRect() };
}

/** Counts the canvas's pixels that carry the area wash: some alpha, and little of it. */
async function washedPixels(host: HTMLElement): Promise<number> {
  const canvas = await untilCanvas(host);
  const context = need(canvas.getContext("2d"), "canvas context");
  const stepX = Math.floor(canvas.width / 60);
  const stepY = Math.floor(canvas.height / 40);
  let washed = 0;
  for (let y = 0; y < canvas.height; y += stepY) {
    for (let x = 0; x < canvas.width; x += stepX) {
      const alpha = context.getImageData(x, y, 1, 1).data[3] ?? 0;
      if (alpha > 0 && alpha <= 40) washed += 1;
    }
  }
  return washed;
}

describe("vault graph panel", () => {
  it("A8 at 1440 by 900 the panel is 300 px wide at the right of the canvas, with its title, counts and reading line", async () => {
    await setUp(DESKTOP, "light");
    serveGraph(DEV_ANSWER);
    const host = boxOf(DESKTOP.width, DESKTOP.height);
    await mountPane(host);
    await untilCounted(host);

    const { canvas, panel } = boxesOf(host);
    expect(panel?.width).toBe(300);
    expect(panel?.left).toBeGreaterThanOrEqual(canvas.right);
    expect(panelOf(host)?.querySelector("h2")?.textContent).toBe("Vault graph");
    expect(panelOf(host)?.textContent).toContain(COUNTS);
    expect(panelOf(host)?.textContent).toContain(FOLDERS_READING);
  });

  it("A9 on a phone at 390 by 844 with touch the panel sits under the canvas at full width", async () => {
    await setUp(TOUCH, "light");
    serveGraph(DEV_ANSWER);
    const host = boxOf(TOUCH.width, TOUCH.height);
    await mountPane(host);
    await untilCounted(host);

    const { canvas, panel } = boxesOf(host);
    expect(panel?.width).toBe(TOUCH.width);
    expect(panel?.top).toBeGreaterThanOrEqual(canvas.bottom);
    expect(panel?.height).toBeLessThanOrEqual(TOUCH.height * 0.45 + 1);
  });

  it("A9 in a split of two panes each draws its own panel, and a pane under 640 px stacks it", async () => {
    await setUp(DESKTOP, "light");
    serveGraph(DEV_ANSWER);
    const row = rowOf(DESKTOP.width, DESKTOP.height);
    const wide = boxOf(900, DESKTOP.height, row);
    const narrow = boxOf(540, DESKTOP.height, row);
    await mountPane(wide);
    await mountPane(narrow);
    await untilCounted(wide);
    await untilCounted(narrow);

    const wideBoxes = boxesOf(wide);
    const narrowBoxes = boxesOf(narrow);
    expect(wideBoxes.panel?.width).toBe(300);
    expect(narrowBoxes.panel?.width).toBe(540);
    expect(narrowBoxes.panel?.top).toBeGreaterThanOrEqual(narrowBoxes.canvas.bottom);
    expect(panelOf(narrow)?.textContent).toContain(COUNTS);
  });

  it("A6 the area strength reads .08 in light and .11 in dark", async () => {
    await setUp(DESKTOP, "light");
    const root = document.documentElement;
    const strength = () => Number(getComputedStyle(root).getPropertyValue("--k-area"));
    for (const palette of ["poel", "russet", "peach", "pansy"]) {
      root.dataset.palette = palette;
      root.dataset.theme = "light";
      expect(strength()).toBe(0.08);
      root.dataset.theme = "dark";
      expect(strength()).toBe(0.11);
    }
    root.dataset.theme = "light";
    delete root.dataset.palette;

    // The wash itself: in light, folders mode, the canvas has pixels that are a faint tint.
    serveGraph(DEV_ANSWER);
    const host = boxOf(DESKTOP.width, DESKTOP.height);
    await mountPane(host);
    await untilCounted(host);
    await untilStill(host);
    expect(await washedPixels(host)).toBeGreaterThan(50);
  });

  it("A9 Tab from the pane reaches the mode buttons and the tag rows", async () => {
    await setUp(DESKTOP, "light");
    serveGraph(DEV_ANSWER);
    const host = boxOf(DESKTOP.width, DESKTOP.height);
    await mountPane(host);
    await untilCounted(host);

    need(host.querySelector<HTMLElement>("[data-graph-pane]"), "graph pane").focus();
    const reached: string[] = [];
    for (let press = 0; press < 12; press++) {
      await userEvent.tab();
      const active = document.activeElement;
      if (active?.closest("[aria-label='mode']")) reached.push("mode");
      else if (active?.closest("[aria-label='tags']")) reached.push("tag row");
    }
    expect(reached).toContain("mode");
    expect(reached).toContain("tag row");
  });

  for (const vim of ["on", "off"] as const) {
    it(`A9 with vim ${vim}, m switches the mode and the reading line follows`, async () => {
      await setUp(DESKTOP, "light", "folders", vim);
      serveGraph(DEV_ANSWER);
      const host = boxOf(DESKTOP.width, DESKTOP.height);
      await mountPane(host);
      await untilCounted(host);

      need(host.querySelector<HTMLElement>("[data-graph-pane]"), "graph pane").focus();
      await userEvent.keyboard("m");
      expect(panelOf(host)?.textContent).toContain(TAGS_READING);
      expect(pressedMode(host)).toBe("Tags");

      await userEvent.keyboard("m");
      expect(panelOf(host)?.textContent).toContain(FOLDERS_READING);
      expect(pressedMode(host)).toBe("Folders");
    });
  }
});
