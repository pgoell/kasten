/**
 * The phone's top bar and tab strip (#793 A1, A2, A3, I2) in the browser: eight
 * tabs at 390 touch scroll sideways instead of folding, the picked tab comes into
 * view with the underline under it, the bar's targets are 44 px, and the chrome's
 * text is 15 px on a phone and 13 px at 1440.
 *
 * Mounted through `tab-strip-fixture.tsx`, as the other strip tests are.
 */

import { cdp } from "vitest/browser";
import { noteName } from "@/lib/note-path";
import { openInFocused } from "@/lib/pane-contents";
import { addTab, emptyLayout, goToTab, type Layout } from "@/lib/panes";
import {
  DESKTOP,
  leader,
  need,
  PATIENCE,
  registerReaderFixture,
  TOUCH,
  unmount,
} from "./reader-fixture";
import {
  drawn,
  LONG,
  moreButton,
  mountTabs,
  registerTabNotes,
  twelveTabs,
  twoTabs,
  underlineUnder,
  wrappers,
} from "./tab-strip-fixture";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    fetchFiles: vi.fn(),
    fetchNote: vi.fn(),
    saveNote: async (path: string, content: string) => ({ path, content }),
    searchNotes: vi.fn(),
    fetchTodos: vi.fn(),
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

/** Eight tabs, each holding one long note, the first one active. */
function eightTabs(): Layout {
  const [first = LONG[0], ...rest] = LONG.slice(0, 8);
  return goToTab(
    rest.reduce((layout, path) => openInFocused(addTab(layout), path), emptyLayout(first)),
    0,
  );
}

/** The tab's own box inside the row, so a test can see whether it is on screen. */
function inRow(row: HTMLElement, element: Element): boolean {
  const box = row.getBoundingClientRect();
  const at = element.getBoundingClientRect();
  return at.left >= box.left - 0.5 && at.right <= box.right + 0.5;
}

/** The top bar's field: the button that opens the finder, named for the count. */
function fieldOf(host: HTMLElement): HTMLElement {
  return need(
    host.querySelector<HTMLElement>("[data-top-bar] button[aria-label^='Search']"),
    "search field",
  );
}

/** The top bar's New note button, which is a plus on a phone and is named New note either way. */
function newNoteOf(host: HTMLElement): HTMLElement {
  const buttons = [...host.querySelectorAll<HTMLElement>("[data-top-bar] button")];
  return need(
    buttons.find(
      (button) => (button.getAttribute("aria-label") ?? button.textContent) === "New note",
    ),
    "New note button",
  );
}

describe("#793 the phone strip", () => {
  it("#793 A2 at 390 touch eight tabs are all drawn, the row scrolls, and the page does not", async () => {
    const mounted = await mountTabs(TOUCH, "light", eightTabs());
    try {
      const { host } = mounted;
      const row = need(host.querySelector<HTMLElement>("[role='tablist']"), "tab list");

      expect(drawn(host)).toHaveLength(8);
      expect(moreButton(host)).toBeUndefined();
      expect(row.scrollWidth).toBeGreaterThan(row.clientWidth);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        document.documentElement.clientWidth,
      );
    } finally {
      await unmount(mounted);
    }
  }, 120_000);

  it("#793 I2 at 390 touch a tab cut at the strip's edge, picked by tap, is scrolled whole into view with the underline under it", async () => {
    const mounted = await mountTabs(TOUCH, "light", eightTabs());
    try {
      const { host } = mounted;
      const row = need(host.querySelector<HTMLElement>("[role='tablist']"), "tab list");
      expect(drawn(host)).toHaveLength(8);
      const edge = row.getBoundingClientRect().right;
      // The tab a finger can still reach: its far end is past the row's edge, its near end is not.
      const cut = need(
        wrappers(host).find((tab) => tab.getBoundingClientRect().right > edge + 1),
        "a tab cut at the edge",
      );
      expect(inRow(row, cut)).toBe(false);
      const box = cut.getBoundingClientRect();
      const point = { x: edge - 20, y: box.top + box.height / 2 };
      await cdp().send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
      await cdp().send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

      await expect
        .poll(
          () => host.querySelector("[role='tab'][aria-selected='true']")?.textContent ?? "",
          PATIENCE,
        )
        .toContain(noteName(LONG[Number(cut.dataset.tab)] ?? ""));
      expect(row.scrollLeft).toBeGreaterThan(0);
      expect(inRow(row, cut)).toBe(true);
      await expect.poll(() => underlineUnder(host, cut), PATIENCE).toBe(true);
    } finally {
      await unmount(mounted);
    }
  }, 120_000);

  it("#793 I2 at 390 touch a tab picked by Space and a digit is scrolled into view, its close x too", async () => {
    const mounted = await mountTabs(TOUCH, "light", eightTabs());
    try {
      const { host } = mounted;
      const row = need(host.querySelector<HTMLElement>("[role='tablist']"), "tab list");
      const last = need(wrappers(host).at(-1), "last tab");
      expect(drawn(host)).toHaveLength(8);

      leader(host, [" ", "8"]);

      await expect.poll(() => row.scrollLeft, PATIENCE).toBeGreaterThan(0);
      expect(inRow(row, last)).toBe(true);
      const close = need(
        last.querySelector<HTMLElement>(`button[aria-label='Close ${noteName(LONG[7] ?? "")}']`),
        "close x of the active tab",
      );
      expect(inRow(row, close)).toBe(true);
      await expect.poll(() => underlineUnder(host, last), PATIENCE).toBe(true);
    } finally {
      await unmount(mounted);
    }
  }, 120_000);

  it("#793 A1 at 390 touch the top bar's plus and field are at least 44 px", async () => {
    const mounted = await mountTabs(TOUCH, "light", twoTabs());
    try {
      const { host } = mounted;
      const plus = newNoteOf(host).getBoundingClientRect();
      const field = fieldOf(host).getBoundingClientRect();

      expect(plus.width).toBeGreaterThanOrEqual(44);
      expect(plus.height).toBeGreaterThanOrEqual(44);
      expect(field.height).toBeGreaterThanOrEqual(44);
    } finally {
      await unmount(mounted);
    }
  }, 60_000);

  it("#793 A3 at 390 touch the chrome's text is 15 px, and the mono path and the title keep theirs", async () => {
    const mounted = await mountTabs(TOUCH, "light", twoTabs());
    try {
      const { host } = mounted;
      const sizeOf = (element: Element | null | undefined) =>
        getComputedStyle(need(element, "element")).fontSize;

      expect(sizeOf(fieldOf(host))).toBe("15px");
      expect(sizeOf(need(wrappers(host)[0], "first tab").querySelector("[role='tab'] span"))).toBe(
        "15px",
      );
      expect(sizeOf(host.querySelector("[data-head='meta']"))).toBe("15px");
      expect(sizeOf(host.querySelector("[data-head='graph']"))).toBe("15px");
      expect(sizeOf(host.querySelector("[data-head='mode'] button"))).toBe("15px");
      expect(sizeOf(host.querySelector("[data-head='path']"))).toBe("13px");
    } finally {
      await unmount(mounted);
    }
  }, 60_000);

  it("#793 A3 at 1440 the field is 13 px, and twelve tabs still fold behind N more", async () => {
    const mounted = await mountTabs(DESKTOP, "light", twelveTabs());
    try {
      const { host } = mounted;

      expect(getComputedStyle(fieldOf(host)).fontSize).toBe("13px");
      await expect.poll(() => moreButton(host)?.textContent ?? "", PATIENCE).toMatch(/^\d+ more$/);
    } finally {
      await unmount(mounted);
    }
  }, 60_000);
});
