/**
 * #793 on a phone at 390 by 844 with touch: the top bar and the tab strip stay
 * put while a long note scrolls (A14), the stage clips sideways rather than
 * scrolling (A14), a sideways drag never changes the tab (A15), no local graph is
 * asked for before the Graph button (A4), and a wide table keeps its cells on one
 * line in its own box (A12).
 */

import { cdp, page } from "vitest/browser";
import { fetchMentions } from "@/lib/api";
import { fetchGraph } from "@/lib/graph-api";
import {
  mountNote,
  need,
  nextFrame,
  PATIENCE,
  registerReaderFixture,
  scrollerOf,
  TOUCH,
  unmount,
  visibleEditor,
} from "./reader-fixture";
import { mountTabs, registerTabNotes, stripOf, twoTabs } from "./tab-strip-fixture";
import { mountApp, tableLinkCleanup } from "./table-link-fixture";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    fetchFiles: vi.fn(),
    fetchNote: vi.fn(),
    saveNote: async (path: string, content: string) => ({ path, content }),
    searchNotes: vi.fn(),
    fetchTodos: vi.fn(),
    fetchMentions: vi.fn(),
    fetchImages: async () => [],
    fetchHtml: async () => [],
    fetchAssets: async () => [],
    fetchTags: async () => [],
    fetchTerminals: async () => [],
    fetchVersion: async () => "0.8.0",
    fetchWeather: async () => [],
  };
});

vi.mock("@/lib/trash-api", async (original) => ({
  ...(await original<typeof import("@/lib/trash-api")>()),
  fetchTrash: async () => [],
}));

vi.mock("@/lib/graph-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/graph-api")>()),
  fetchGraph: vi.fn(),
}));

registerReaderFixture();
registerTabNotes();
tableLinkCleanup();

/** A note with a line above a table of `rows` body rows and `columns` columns. */
function wideNote(rows: number, columns = 30): string {
  const cell = (text: string) => ` ${text} |`;
  const header = `|${Array.from({ length: columns }, (_, c) => cell(`column ${c}`)).join("")}`;
  const divider = `|${" --- |".repeat(columns)}`;
  const body = Array.from(
    { length: rows },
    (_, r) =>
      `|${Array.from({ length: columns }, (_, c) =>
        cell(c === 0 ? `item ${r}` : c === 1 ? `${r * 10}` : `cell ${r} ${c}`),
      ).join("")}`,
  );
  return ["before", "", header, divider, ...body].join("\n");
}

/** The box of an element as numbers, so two reads compare by value. */
function rectOf(element: Element) {
  const box = element.getBoundingClientRect();
  return { top: box.top, left: box.left, width: box.width, height: box.height };
}

/** The tab the list shows as selected. */
function activeTab(host: HTMLElement): Element | null {
  return host.querySelector("[role='tab'][aria-selected='true']");
}

/**
 * A touch drag across `target`, as real pointer events a frame apart. It runs at
 * the middle of the target's height, and it moves `to` minus `from` in ten steps.
 */
async function swipe(target: HTMLElement, from: number, to: number) {
  const box = target.getBoundingClientRect();
  const y = box.top + box.height / 2;
  const at = (type: string, x: number) =>
    target.dispatchEvent(
      new PointerEvent(type, {
        clientX: x,
        clientY: y,
        pointerId: 7,
        pointerType: "touch",
        isPrimary: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  at("pointerdown", from);
  for (let step = 1; step <= 10; step++) {
    await nextFrame();
    at("pointermove", from + ((to - from) * step) / 10);
  }
  at("pointerup", to);
  await nextFrame();
  await nextFrame();
}

describe("#793 the phone's pinned frame and its gestures", () => {
  it("#793 A14 at 390 the top bar and the tab strip stay put while a long note scrolls", async () => {
    const mounted = await mountTabs(TOUCH, "light", twoTabs());
    try {
      const bar = need(mounted.host.querySelector<HTMLElement>("[data-top-bar]"), "top bar");
      const strip = stripOf(mounted.host);
      const scroller = scrollerOf(mounted.host);
      const before = [rectOf(bar), rectOf(strip)];

      scroller.scrollTop = 600;
      await expect.poll(() => scroller.scrollTop, PATIENCE).toBe(600);
      await nextFrame();

      expect([rectOf(bar), rectOf(strip)]).toEqual(before);
    } finally {
      await unmount(mounted);
    }
  });

  it("#793 A14 the stage clips sideways and is not a scroll container", async () => {
    const mounted = await mountNote(TOUCH, "light");
    try {
      const stage = need(mounted.host.querySelector<HTMLElement>("main"), "stage");
      expect(getComputedStyle(stage).overflowX).toBe("clip");
    } finally {
      await unmount(mounted);
    }
  });

  it("#793 A15 a sideways touch drag over a note leaves the tab where it is", async () => {
    const mounted = await mountTabs(TOUCH, "light", twoTabs());
    try {
      const before = activeTab(mounted.host);
      expect(before).not.toBeNull();
      const editor = visibleEditor(mounted.host);

      await swipe(editor, 320, 60);
      expect(activeTab(mounted.host)).toBe(before);

      // And back the other way, which a swipe to the previous tab would answer.
      await swipe(editor, 60, 320);
      expect(activeTab(mounted.host)).toBe(before);
    } finally {
      await unmount(mounted);
    }
  });

  it("#793 A4 on a phone no graph is asked before the Graph button", async () => {
    vi.mocked(fetchGraph).mockClear();
    vi.mocked(fetchMentions).mockClear();
    vi.mocked(fetchMentions).mockResolvedValue([]);
    const mounted = await mountNote(TOUCH, "light");
    try {
      expect(vi.mocked(fetchGraph)).not.toHaveBeenCalled();
      expect(vi.mocked(fetchMentions)).not.toHaveBeenCalled();
      expect(mounted.host.querySelector("[role='dialog'][aria-label='Local graph']")).toBeNull();

      need(mounted.host.querySelector<HTMLElement>("[data-head='graph']"), "graph button").click();
      await expect
        .poll(
          () => mounted.host.querySelector("[role='dialog'][aria-label='Local graph']"),
          PATIENCE,
        )
        .not.toBeNull();
      expect(vi.mocked(fetchGraph)).toHaveBeenCalled();
    } finally {
      await unmount(mounted);
    }
  });

  it("#793 A12 at 390 a wide table's cells do not wrap and its box scrolls sideways", async () => {
    await page.viewport(390, 844);
    await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    const host = mountApp(wideNote(3), 700, { vim: "off" });
    host.classList.add("k-reader");
    await expect.poll(() => host.querySelector(".cm-table-block"), PATIENCE).not.toBeNull();

    const scroller = need(
      host.querySelector<HTMLElement>(".cm-table-block .cm-table-scroll"),
      "table box",
    );
    const cells = [...scroller.querySelectorAll<HTMLElement>("th, td")];
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(getComputedStyle(cell).whiteSpace).toBe("nowrap");
    }
    expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);
    // The app's own page is not mounted here, so the editor's box stands for the page.
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  });
});
