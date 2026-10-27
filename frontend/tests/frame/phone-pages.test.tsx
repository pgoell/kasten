/**
 * The phone layout of #793 at 390 by 844 with touch, in a real browser: the vault
 * graph's canvas over its panel (A6, I8), the review's answer side (A11), and an
 * opted-in HTML page whose marked blocks stack under 640 px, a page that does not
 * opt in being left alone (A10, I7).
 */

import "./html-take-api";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { commands, page } from "vitest/browser";
import { ReviewAnswer } from "@/components/review-answer";
import "@/styles/app.css";
import {
  ask,
  frameOf,
  type Mounted,
  ready,
  render,
  setUp as setUpHtml,
  tearDown,
} from "./html-take-fixture";
import { DESKTOP, need, TOUCH } from "./reader-fixture";
import {
  boxOf,
  DEV_ANSWER,
  mountPane,
  registerVaultFixture,
  serveGraph,
  setUp as setUpVault,
  untilCounted,
} from "./vault-graph-fixture";

vi.mock("@/lib/graph/graph-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/graph/graph-api")>()),
  fetchGraph: vi.fn(),
}));

registerVaultFixture();

describe("vault graph on a phone (#793 A6, I8)", () => {
  it("#793 A6 on a phone the canvas is full width and about 118vw high, with the uncapped panel under it", async () => {
    await setUpVault(TOUCH, "light");
    serveGraph(DEV_ANSWER);
    const host = boxOf(TOUCH.width, TOUCH.height);
    await mountPane(host);
    await untilCounted(host);

    const canvas = need(
      host.querySelector<HTMLElement>("[data-testid='graph-canvas']"),
      "graph canvas",
    ).getBoundingClientRect();
    const panel = need(
      host.querySelector<HTMLElement>("aside[aria-label='graph panel']"),
      "graph panel",
    ).getBoundingClientRect();
    expect(canvas.width).toBe(TOUCH.width);
    // 118vw at 390 is 460 px: the canvas is as high as the width allows.
    expect(canvas.height).toBeGreaterThanOrEqual(TOUCH.width * 1.18 - 2);
    expect(canvas.height).toBeLessThanOrEqual(TOUCH.width * 1.18 + 2);
    expect(panel.top).toBeGreaterThanOrEqual(canvas.bottom);
    expect(panel.width).toBe(TOUCH.width);
    // No 45 % cap: the panel is as tall as its rows, and the pane scrolls, not the panel.
    const element = need(
      host.querySelector<HTMLElement>("aside[aria-label='graph panel']"),
      "graph panel",
    );
    expect(element.scrollHeight).toBeLessThanOrEqual(element.clientHeight + 1);
  });

  it("#793 R1 at 1440 with a mouse a vault graph pane under 640 px keeps the panel capped and the canvas filling the pane", async () => {
    // A split's narrow pane with a mouse: 590 px wide, so the container query
    // matches, but the pointer is fine, so the desktop layout must hold.
    await setUpVault(DESKTOP, "light");
    serveGraph(DEV_ANSWER);
    const host = boxOf(590, DESKTOP.height);
    await mountPane(host);
    await untilCounted(host);

    const canvas = need(
      host.querySelector<HTMLElement>("[data-testid='graph-canvas']"),
      "graph canvas",
    ).getBoundingClientRect();
    const panel = need(
      host.querySelector<HTMLElement>("aside[aria-label='graph panel']"),
      "graph panel",
    ).getBoundingClientRect();
    const footer = need(
      host.querySelector<HTMLElement>("footer"),
      "pane footer",
    ).getBoundingClientRect();
    // The panel holds to 45 % of the pane, and stops above the pane's footer.
    expect(panel.height).toBeLessThanOrEqual(host.getBoundingClientRect().height * 0.45 + 1);
    expect(panel.bottom).toBeLessThanOrEqual(footer.top + 1);
    // The canvas takes what the panel leaves: the two fill the space above the footer.
    expect(Math.abs(canvas.height + panel.height - (footer.top - canvas.top))).toBeLessThan(2);
  });

  it("#793 I8 on a phone the canvas keeps touch-action none, so a drag and a pinch move the graph", async () => {
    await setUpVault(TOUCH, "light");
    serveGraph(DEV_ANSWER);
    const host = boxOf(TOUCH.width, TOUCH.height);
    await mountPane(host);
    await untilCounted(host);

    const canvas = need(
      host.querySelector<HTMLElement>("[data-testid='graph-canvas']"),
      "graph canvas",
    );
    expect(getComputedStyle(canvas).touchAction).toBe("none");
  });
});

describe("review answer on a phone (#793 A11)", () => {
  // The footer as a card's answer side draws it, with no interval known yet.
  const ANSWER = {
    typing: false,
    typed: "",
    onTyped: () => {},
    undoing: false,
    jotOpen: false,
    next: null,
    onReveal: () => {},
    onRate: () => {},
    onPark: () => {},
    onCapture: () => {},
  };

  let review: Root | undefined;
  let reviewHost: HTMLElement | undefined;

  /** Mounts the footer, shown with its four grades or with the reveal, and returns its host. */
  function mountAnswer(shown: boolean): HTMLElement {
    const div = document.body.appendChild(document.createElement("div"));
    const root = createRoot(div);
    review = root;
    reviewHost = div;
    act(() => root.render(<ReviewAnswer {...ANSWER} shown={shown} />));
    return div;
  }

  afterEach(() => {
    if (review) act(() => review?.unmount());
    reviewHost?.remove();
    review = undefined;
    reviewHost = undefined;
  });

  it("#793 A11 on a phone the four grades share one row, each at least 64 px high", async () => {
    await page.viewport(TOUCH.width, TOUCH.height);
    await commands.emulateMedia({ touch: true });
    const host = mountAnswer(true);

    const buttons = [...host.querySelectorAll<HTMLButtonElement>("button[data-rating]")];
    expect(buttons.map((button) => button.dataset.rating)).toEqual([
      "again",
      "hard",
      "good",
      "easy",
    ]);
    expect(
      new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top))).size,
    ).toBe(1);
    for (const button of buttons) {
      expect(button.getBoundingClientRect().height, button.dataset.rating).toBeGreaterThanOrEqual(
        64,
      );
    }
  });

  it("#793 A11 on a phone Show the answer is full width, with no Space hint", async () => {
    await page.viewport(TOUCH.width, TOUCH.height);
    await commands.emulateMedia({ touch: true });
    const host = mountAnswer(false);

    const reveal = need(
      host.querySelector<HTMLButtonElement>("button[aria-label='Show the answer']"),
      "Show the answer",
    );
    const hint = need(reveal.querySelector<HTMLElement>("kbd"), "Space hint");
    expect(getComputedStyle(hint).display).toBe("none");
    const width = need(reveal.parentElement, "answer row").getBoundingClientRect().width;
    expect(Math.abs(reveal.getBoundingClientRect().width - width)).toBeLessThan(1);
  });
});

describe("HTML page stacking (#793 A10, I7)", () => {
  const PATH = "stack.html";
  const GRID = `<section class="k-columns"><div>one</div><div>two</div><div>three</div></section>`;
  // The page reports where its three children sit, when the frame asks.
  const PROBE = `<script>
addEventListener("message", (event) => {
  if (event.data?.probe !== "columns") return;
  const boxes = [...document.querySelectorAll(".k-columns > div")].map((box) => {
    const { left, top } = box.getBoundingClientRect();
    return { left, top };
  });
  parent.postMessage({ fixture: "columns", boxes }, "*");
});
</script>`;
  const CSS =
    "<style>.k-columns { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }</style>";
  const OPTED = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="kasten-theme" content="tokens"><title>stack</title>${CSS}</head><body>${GRID}${PROBE}</body></html>`;
  const PLAIN = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>stack</title>${CSS}</head><body>${GRID}${PROBE}</body></html>`;

  interface Box {
    left: number;
    top: number;
  }

  let mounted: Mounted | undefined;

  afterEach(async () => {
    if (mounted) await tearDown(mounted);
    mounted = undefined;
  });

  /** Serves `html`, mounts it in a pane at a phone's width with touch, and asks where its children sit. */
  async function boxesAt(html: string): Promise<Box[]> {
    mounted = await setUpHtml();
    await page.viewport(TOUCH.width, TOUCH.height);
    await commands.emulateMedia({ touch: true });
    await commands.servePage(PATH, html);
    render(mounted, [PATH]);
    const frame = frameOf(mounted, 0);
    await ready(frame);
    return (await ask(frame, { probe: "columns" }, "columns")).boxes as Box[];
  }

  it("#793 A10 an opted-in page stacks its k-columns children under 640 px, and keeps them across at 1440", async () => {
    const phone = await boxesAt(OPTED);
    expect(phone).toHaveLength(3);
    expect(new Set(phone.map((box) => box.left)).size).toBe(1);
    expect(phone[1]?.top).toBeGreaterThan(phone[0]?.top ?? Number.POSITIVE_INFINITY);

    await page.viewport(1440, 900);
    await commands.emulateMedia({});
    const frame = frameOf(need(mounted, "mounted pane"), 0);
    await expect.poll(() => frame.getBoundingClientRect().width).toBe(1440);
    const desktop = (await ask(frame, { probe: "columns" }, "columns")).boxes as Box[];
    expect(new Set(desktop.map((box) => box.top)).size).toBe(1);
    expect(new Set(desktop.map((box) => box.left)).size).toBe(3);
  });

  it("#793 I7 a page without the meta keeps its three children across at 390", async () => {
    const plain = await boxesAt(PLAIN);
    expect(plain).toHaveLength(3);
    expect(new Set(plain.map((box) => box.top)).size).toBe(1);
    expect(new Set(plain.map((box) => box.left)).size).toBe(3);
  });
});
