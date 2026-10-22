/**
 * The tab strip's review fixes in the browser, where they need a layout: the
 * width of a tab with its x, the height of a tab's row, and the size of the x
 * under a finger. The rest of the strip is in `tab-strip-frame.test.tsx`.
 */

import { DESKTOP, need, registerReaderFixture, TOUCH, unmount } from "./reader-fixture";
import {
  mountTabs,
  registerTabNotes,
  stripOf,
  twelveTabs,
  twoTabs,
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

it("R5 at 1440 a long title's whole tab, x included, is at most 200 px wide", async () => {
  const mounted = await mountTabs(DESKTOP, "light", twelveTabs());
  try {
    const tab = need(wrappers(mounted.host)[0], "active tab");
    expect(tab.getBoundingClientRect().width).toBeLessThanOrEqual(200);
  } finally {
    await unmount(mounted);
  }
}, 60_000);

it("R6 a tab's button is as tall as the strip, so the hover wash fills the row", async () => {
  for (const size of [DESKTOP, TOUCH]) {
    const mounted = await mountTabs(size, "light", twoTabs());
    try {
      const { host } = mounted;
      const button = need(wrappers(host)[1]?.querySelector<HTMLElement>("[role='tab']"), "tab");
      // The strip is 40 px (44 under a finger) with a 1 px hairline at its foot, which
      // is inside its border box, so the row the tab fills is the strip less that line.
      const strip = stripOf(host);
      expect(strip.getBoundingClientRect().height).toBe(size === TOUCH ? 44 : 40);
      expect(button.getBoundingClientRect().height).toBe(strip.clientHeight);
    } finally {
      await unmount(mounted);
    }
  }
}, 120_000);

it("R8 at 390 touch the close x is 44 px wide and as tall as the strip", async () => {
  const mounted = await mountTabs(TOUCH, "light", twoTabs());
  try {
    const { host } = mounted;
    const close = need(
      host.querySelector<HTMLElement>("button[aria-label='Close Reader']"),
      "close x",
    );
    const box = close.getBoundingClientRect();
    expect(box.width).toBe(44);
    // As tall as the row inside the strip's hairline (see R6).
    expect(box.height).toBe(stripOf(host).clientHeight);
  } finally {
    await unmount(mounted);
  }
}, 60_000);
