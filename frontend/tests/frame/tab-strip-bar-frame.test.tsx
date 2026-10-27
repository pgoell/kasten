/**
 * The tab strip's underline (#933) in the browser: the bar stays under the active
 * tab after a new tab, a close, a rename or a resize. These guard the bar's fit,
 * and are green on main too: the report in #933 was not reproduced. The other
 * strip tests are in `tab-strip-frame.test.tsx`.
 *
 * Mounted through `tab-strip-fixture.tsx`, as those are.
 */

import { fireEvent, waitFor } from "@testing-library/react";
import { page } from "vitest/browser";
import {
  DESKTOP,
  leader,
  need,
  PATIENCE,
  registerReaderFixture,
  TOUCH,
  unmount,
} from "./reader-fixture";
import { barOf, mountTabs, registerTabNotes, twoTabs, wrappers } from "./tab-strip-fixture";

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

vi.mock("@/lib/graph/graph-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/graph/graph-api")>()),
  fetchGraph: vi.fn(),
}));

registerReaderFixture();
registerTabNotes();

/** The wrapper of the active tab, which holds its button and its x. */
function activeWrapper(host: HTMLElement): HTMLElement {
  return need(
    wrappers(host).find((wrapper) => wrapper.querySelector("[aria-selected='true']") !== null),
    "active tab",
  );
}

/**
 * The bar sits under the active tab to within a pixel of both its edges, and the
 * next tab starts past the bar's right edge. It throws rather than returns, so a
 * waitFor can retry it while the spring settles.
 */
function expectBarOnActive(host: HTMLElement): void {
  const tab = activeWrapper(host);
  const bar = barOf(host).getBoundingClientRect();
  const box = tab.getBoundingClientRect();
  expect(Math.abs(bar.left - box.left)).toBeLessThan(1);
  expect(Math.abs(bar.right - box.right)).toBeLessThan(1);
  const next = wrappers(host)[wrappers(host).indexOf(tab) + 1];
  if (next !== undefined) {
    expect(next.getBoundingClientRect().left).toBeGreaterThanOrEqual(bar.right - 1);
  }
}

it("#933 A5 the bar spans the active tab and ends at its right edge with a fine pointer", async () => {
  const mounted = await mountTabs(DESKTOP, "light", twoTabs());
  try {
    await waitFor(() => expectBarOnActive(mounted.host), PATIENCE);
  } finally {
    await unmount(mounted);
  }
}, 60_000);

it("#933 A6 the same under a finger at 414", async () => {
  const phone = { ...TOUCH, name: "touch-414", width: 414, height: 896 };
  const mounted = await mountTabs(phone, "light", twoTabs());
  try {
    await waitFor(() => expectBarOnActive(mounted.host), PATIENCE);
  } finally {
    await unmount(mounted);
  }
}, 60_000);

it("#933 A7a the bar fits the new tab after a tab opens", async () => {
  const mounted = await mountTabs(DESKTOP, "light", twoTabs());
  try {
    const { host } = mounted;
    await waitFor(() => expectBarOnActive(host), PATIENCE);
    leader(host, [" ", "c", "t"]);
    await waitFor(() => {
      expect(wrappers(host)).toHaveLength(3);
      expect(wrappers(host).indexOf(activeWrapper(host))).toBe(2);
    }, PATIENCE);
    await waitFor(() => expectBarOnActive(host), PATIENCE);
  } finally {
    await unmount(mounted);
  }
}, 60_000);

it("#933 A7b the bar fits after a tab closes", async () => {
  const mounted = await mountTabs(DESKTOP, "light", twoTabs());
  try {
    const { host } = mounted;
    // The second tab is made active, so closing the first moves the active tab left.
    fireEvent.click(need(wrappers(host)[1]?.querySelector("[role='tab']"), "second tab"));
    await waitFor(() => expect(wrappers(host).indexOf(activeWrapper(host))).toBe(1), PATIENCE);
    await waitFor(() => expectBarOnActive(host), PATIENCE);

    fireEvent.click(need(host.querySelector("button[aria-label='Close Reader']"), "close x"));
    await waitFor(() => {
      expect(wrappers(host)).toHaveLength(1);
      expect(wrappers(host).indexOf(activeWrapper(host))).toBe(0);
    }, PATIENCE);
    await waitFor(() => expectBarOnActive(host), PATIENCE);
  } finally {
    await unmount(mounted);
  }
}, 60_000);

it("#933 A7c the bar fits after the active tab is renamed", async () => {
  const mounted = await mountTabs(DESKTOP, "light", twoTabs());
  try {
    const { host } = mounted;
    await waitFor(() => expectBarOnActive(host), PATIENCE);
    // A note picked in the tree goes into the focused pane, so the active tab takes a
    // new name of another width while the count stays the same. Redesign is not open
    // in a tab, so its row is the only button that names it.
    leader(host, [" ", "b"]);
    const row = () =>
      need(
        [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
          button.textContent?.includes("Redesign"),
        ),
        "Redesign row",
      );
    await waitFor(row, PATIENCE);
    fireEvent.click(row());
    await waitFor(() => expect(activeWrapper(host).textContent).toContain("Redesign"), PATIENCE);
    await waitFor(() => expectBarOnActive(host), PATIENCE);
  } finally {
    await unmount(mounted);
  }
}, 60_000);

it("#933 A7d the bar fits after a resize", async () => {
  const mounted = await mountTabs(DESKTOP, "light", twoTabs());
  try {
    const { host } = mounted;
    await waitFor(() => expectBarOnActive(host), PATIENCE);
    await page.viewport(1000, 900);
    await waitFor(() => expectBarOnActive(host), PATIENCE);
  } finally {
    await unmount(mounted);
  }
}, 60_000);
