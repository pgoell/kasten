/**
 * Pictures of the tab strip (#780): many tabs with the N more list open, an
 * unsaved tab, a split side by side and stacked, and a phone with one pane and
 * three tabs. Each picture asserts what it shows before it is taken.
 *
 * Mounted through `tab-strip-fixture.tsx`. Pictures land in
 * node_modules/.cache/kasten-shots with VITE_KASTEN_SHOTS=1.
 */

import { fireEvent } from "@testing-library/react";
import { holdText, resetHeld } from "@/lib/held-text";
import { openInFocused } from "@/lib/pane-contents";
import { addTab, emptyLayout, goToTab, splitFocused } from "@/lib/panes";
import {
  DESKTOP,
  need,
  nextFrame,
  PATIENCE,
  picture,
  READER,
  registerReaderFixture,
  TOUCH,
  unmount,
} from "./reader-fixture";
import {
  DESIGN,
  drawn,
  headers,
  LONG,
  moreButton,
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

vi.mock("@/lib/graph/graph-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/graph/graph-api")>()),
  fetchGraph: vi.fn(),
}));

registerReaderFixture();
registerTabNotes();

it("tabs-many-1440 with N more open in light and dark", async () => {
  for (const theme of ["light", "dark"] as const) {
    const mounted = await mountTabs(DESKTOP, theme, twelveTabs());
    try {
      const { host } = mounted;
      await expect.poll(() => moreButton(host)?.textContent ?? "", PATIENCE).toMatch(/^\d+ more$/);
      const more = need(moreButton(host), "N more button");
      fireEvent.click(more);
      await expect.poll(() => host.querySelector("[role='menu']") !== null, PATIENCE).toBe(true);
      expect(more.getAttribute("aria-expanded")).toBe("true");
      expect(host.querySelectorAll("[role='menuitem']").length).toBeGreaterThan(0);
      await nextFrame();
      await picture(host, `tabs-many-1440-${theme}`, DESKTOP);
    } finally {
      await unmount(mounted);
    }
  }
}, 120_000);

it("tabs-unsaved-1440 in light and dark", async () => {
  for (const theme of ["light", "dark"] as const) {
    const mounted = await mountTabs(DESKTOP, theme, twoTabs());
    try {
      const { host } = mounted;
      // Held text is what has not reached the vault. Held for the note of the
      // second tab, which is in the background, so the picture shows the dot on a
      // tab that is not on screen and not a typing accident.
      holdText(DESIGN, {
        content: "typed and not yet saved",
        reason: "held for the picture",
        conflicted: false,
      });
      const second = need(wrappers(host)[1], "second tab");
      await expect.poll(() => second.querySelector(".rounded-full") !== null, PATIENCE).toBe(true);
      expect(need(second.querySelector("[role='tab']"), "second tab button").textContent).toContain(
        "unsaved",
      );
      await picture(host, `tabs-unsaved-1440-${theme}`, DESKTOP);
    } finally {
      resetHeld();
      await unmount(mounted);
    }
  }
}, 120_000);

it("split-side-1440 in light and dark", async () => {
  // The two notes side by side, the right one focused: the layout Space % leaves
  // when the second note is opened in the new pane.
  const side = openInFocused(splitFocused(emptyLayout(READER), "row"), DESIGN);
  for (const theme of ["light", "dark"] as const) {
    const mounted = await mountTabs(DESKTOP, theme, side);
    try {
      const { host } = mounted;
      await expect.poll(() => headers(host).length, PATIENCE).toBe(2);
      const [left, right] = [...host.querySelectorAll<HTMLElement>("[data-pane]")];
      expect(left?.getBoundingClientRect().right).toBeLessThanOrEqual(
        right?.getBoundingClientRect().left ?? 0,
      );
      const lines = [...host.querySelectorAll<HTMLElement>("[data-focus-line]")];
      expect(lines.map((line) => line.classList.contains("bg-k-accent"))).toEqual([false, true]);
      await picture(host, `split-side-1440-${theme}`, DESKTOP);
    } finally {
      await unmount(mounted);
    }
  }
}, 120_000);

it("split-stacked-1440 in light and dark", async () => {
  // The same two notes one above the other, which is what Space " " leaves.
  const stacked = openInFocused(splitFocused(emptyLayout(READER), "col"), DESIGN);
  for (const theme of ["light", "dark"] as const) {
    const mounted = await mountTabs(DESKTOP, theme, stacked);
    try {
      const { host } = mounted;
      await expect.poll(() => headers(host).length, PATIENCE).toBe(2);
      const [top, bottom] = [...host.querySelectorAll<HTMLElement>("[data-pane]")];
      expect(top?.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        bottom?.getBoundingClientRect().top ?? 0,
      );
      const lines = [...host.querySelectorAll<HTMLElement>("[data-focus-line]")];
      expect(lines.map((line) => line.classList.contains("bg-k-accent"))).toEqual([false, true]);
      await picture(host, `split-stacked-1440-${theme}`, DESKTOP);
    } finally {
      await unmount(mounted);
    }
  }
}, 120_000);

it("tabs-touch-390 with one pane in light and dark", async () => {
  // Three tabs on a phone: the pane is drawn alone, and the strip folds what does not fit.
  const three = goToTab(
    openInFocused(openInFocused(addTab(addTab(emptyLayout(READER))), DESIGN), LONG[0] ?? ""),
    0,
  );
  for (const theme of ["light", "dark"] as const) {
    const mounted = await mountTabs(TOUCH, theme, three);
    try {
      const { host } = mounted;
      await expect.poll(() => wrappers(host).length, PATIENCE).toBe(3);
      expect(getComputedStyle(stripOf(host)).height).toBe("44px");
      const folded = moreButton(host)?.textContent ?? "0 more";
      const hidden = Number.parseInt(folded, 10) || 0;
      expect(drawn(host).length + hidden).toBe(3);
      const panes = [...host.querySelectorAll<HTMLElement>("[data-pane]")].filter(
        (pane) => pane.getClientRects().length > 0,
      );
      expect(panes).toHaveLength(1);
      await picture(host, `tabs-touch-390-one-pane-${theme}`, TOUCH);
    } finally {
      await unmount(mounted);
    }
  }
}, 120_000);
