/**
 * Pictures of the reader layout (#779) at desktop, split and phone widths, and
 * the computed values the layout depends on: the top bar, the three-column
 * grid, the margins, the reading face, the container query's breaks and the
 * hover and transition rules. The Today screen is in `today-shots.test.tsx`.
 *
 * Mounted the way `motion-shots.test.tsx` mounts it. Pictures land in
 * node_modules/.cache/kasten-shots with VITE_KASTEN_SHOTS=1.
 */

import { waitFor } from "@testing-library/react";
import { userEvent } from "vitest/browser";
import {
  closeTree,
  DESKTOP,
  fontsIn,
  leader,
  mountNote,
  need,
  nextFrame,
  PATIENCE,
  picture,
  registerReaderFixture,
  resolved,
  scrollerOf,
  TOUCH,
  unmount,
  visibleEditor,
} from "./reader-fixture";

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

/** Every style rule in the page, with the rule it sits in (a media rule, or none). */
function styleRules(): { rule: CSSStyleRule; parent: CSSRule | null }[] {
  const found: { rule: CSSStyleRule; parent: CSSRule | null }[] = [];
  const walk = (rules: CSSRuleList, parent: CSSRule | null) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) found.push({ rule, parent });
      if (rule instanceof CSSGroupingRule) walk(rule.cssRules, rule);
    }
  };
  for (const sheet of Array.from(document.styleSheets)) walk(sheet.cssRules, null);
  return found;
}

/** The properties a transition names, as the browser lists them. */
function transitioned(element: HTMLElement): string[] {
  return getComputedStyle(element)
    .transitionProperty.split(",")
    .map((property) => property.trim());
}

it("reader-desktop-1440 in light and dark", async () => {
  for (const theme of ["light", "dark"] as const) {
    const mounted = await mountNote(DESKTOP, theme);
    try {
      await closeTree(mounted.host);
      const { host } = mounted;

      const header = need(host.querySelector<HTMLElement>("header[data-top-bar]"), "top bar");
      const bar = getComputedStyle(header);
      expect(bar.height).toBe("56px");
      expect(bar.position).toBe("sticky");
      expect(bar.top).toBe("0px");

      const grid = need(host.querySelector<HTMLElement>("[data-reader-grid]"), "reader grid");
      const gridStyle = getComputedStyle(grid);
      const tracks = gridStyle.gridTemplateColumns.split(" ");
      expect(tracks).toHaveLength(3);
      const [leftTrack = "", middleTrack = ""] = tracks;
      expect(parseFloat(middleTrack)).toBeCloseTo(680, 0);
      expect(gridStyle.columnGap).toBe("48px");

      const outline = need(
        host.querySelector<HTMLElement>('aside[data-margin="outline"]'),
        "outline margin",
      );
      const links = need(
        host.querySelector<HTMLElement>('aside[data-margin="links"]'),
        "links margin",
      );
      expect(getComputedStyle(outline).display).not.toBe("none");
      expect(outline.getBoundingClientRect().width).toBeCloseTo(190, 0);
      expect(getComputedStyle(links).display).not.toBe("none");
      expect(links.getBoundingClientRect().width).toBeCloseTo(256, 0);

      // The middle track starts after the left track and one gap.
      const content = need(host.querySelector<HTMLElement>(".cm-content"), "editor content");
      const middleLeft =
        grid.getBoundingClientRect().left + parseFloat(leftTrack) + parseFloat(gridStyle.columnGap);
      const box = content.getBoundingClientRect();
      expect(Math.abs(box.left - middleLeft)).toBeLessThan(1);
      expect(Math.abs(box.width - 680)).toBeLessThan(1);

      const scroller = getComputedStyle(scrollerOf(host));
      expect(scroller.fontSize).toBe("19px");
      expect(scroller.lineHeight).toBe("30.4px");
      expect(scroller.fontFamily.startsWith('"Newsreader')).toBe(true);

      const tag = need(host.querySelector<HTMLElement>(".cm-note-tag"), "tag pill");
      expect(getComputedStyle(tag).backgroundColor).toBe(
        resolved("backgroundColor", "var(--k-accent-wash)"),
      );

      const meta = need(host.querySelector<HTMLElement>('[data-head="meta"]'), "meta line");
      expect(getComputedStyle(meta).fontSize).toBe("13px");

      const path = need(host.querySelector<HTMLElement>('[data-head="path"]'), "path");
      expect(getComputedStyle(path).fontFamily.startsWith('"JetBrains Mono')).toBe(true);

      await picture(host, `reader-desktop-1440-${theme}`, DESKTOP);
    } finally {
      await unmount(mounted);
    }
  }
}, 120_000);

it("reader margins stay in view while the note scrolls", async () => {
  const mounted = await mountNote(DESKTOP, "light");
  try {
    const { host } = mounted;
    await closeTree(host);
    const outline = need(
      host.querySelector<HTMLElement>('aside[data-margin="outline"]'),
      "outline margin",
    );
    const links = need(
      host.querySelector<HTMLElement>('aside[data-margin="links"]'),
      "links margin",
    );
    const boxes = () =>
      [outline, links].map((aside) => {
        const box = aside.getBoundingClientRect();
        return [box.x, box.y, box.width, box.height];
      });
    const current = () =>
      need(
        host.querySelector<HTMLElement>('nav[aria-label="Outline"] [aria-current="location"]'),
        "current outline row",
      );

    // The margin's graph and lists are asked only once the closed tree makes the
    // pane wide (#781), so they arrive after it; measured before, the margin grows.
    // The graph's answer can land after two quiet frames under load, so wait for
    // its rows first: the loop would otherwise settle on the margin before them.
    await waitFor(() => {
      expect(links.textContent).toContain("Tokens");
      expect(links.textContent).toContain("Redesign");
    }, PATIENCE);
    await fontsIn();
    // Settled once two frames in a row leave its height alone.
    let settled = -1;
    while (links.getBoundingClientRect().height !== settled) {
      settled = links.getBoundingClientRect().height;
      await nextFrame();
      await nextFrame();
    }
    const before = boxes();
    const firstRow = current().textContent;

    scrollerOf(host).scrollTop = 600;
    await nextFrame();
    await nextFrame();

    expect(boxes()).toEqual(before);
    expect(current().textContent).not.toBe(firstRow);
  } finally {
    await unmount(mounted);
  }
}, 60_000);

it("reader-split-1440 drops the right margin in a pane under 1320 px", async () => {
  for (const theme of ["light", "dark"] as const) {
    const mounted = await mountNote(DESKTOP, theme);
    try {
      const { host } = mounted;
      await closeTree(host);
      // The note is already open in the first pane, so the split only adds one.
      leader(host, [" ", "%"]);
      await waitFor(
        () => expect(host.querySelectorAll(".cm-content").length).toBeGreaterThan(1),
        PATIENCE,
      );
      // The new pane fades in over a few hundred milliseconds: wait for its opacity to land.
      await expect
        .poll(
          () =>
            [...host.querySelectorAll<HTMLElement>("[data-pane]")].every(
              (pane) => getComputedStyle(pane).opacity === "1",
            ),
          PATIENCE,
        )
        .toBe(true);
      await nextFrame();
      await nextFrame();

      const links = host.querySelectorAll<HTMLElement>('[data-margin="links"]');
      expect(links.length).toBeGreaterThan(0);
      for (const aside of links) {
        const pane = need(aside.closest<HTMLElement>("[data-reader]"), "pane");
        expect(pane.getBoundingClientRect().width).toBeLessThan(1320);
        expect(getComputedStyle(aside).display).toBe("none");
      }

      await picture(host, `reader-split-1440-${theme}`, DESKTOP);
    } finally {
      await unmount(mounted);
    }
  }
}, 120_000);

it("reader-touch-390 keeps a full-width body", async () => {
  for (const theme of ["light", "dark"] as const) {
    const mounted = await mountNote(TOUCH, theme);
    try {
      const { host } = mounted;
      const outline = need(
        host.querySelector<HTMLElement>('aside[data-margin="outline"]'),
        "outline margin",
      );
      const links = need(
        host.querySelector<HTMLElement>('aside[data-margin="links"]'),
        "links margin",
      );
      expect(getComputedStyle(outline).display).toBe("none");
      expect(getComputedStyle(links).display).toBe("none");

      // Below 776 px the line-number gutter stays in the flow, so the body is the
      // scroller less the gutter and 16 px on the right.
      const content = need(host.querySelector<HTMLElement>(".cm-content"), "editor content");
      const scroller = scrollerOf(host).getBoundingClientRect().width;
      const gutter = need(
        host.querySelector<HTMLElement>(".cm-gutters"),
        "line-number gutter",
      ).getBoundingClientRect().width;
      expect(
        Math.abs(content.getBoundingClientRect().width - (scroller - gutter - 16)),
      ).toBeLessThan(2);

      // Typing still edits the note at this width.
      const before = visibleEditor(host).textContent;
      visibleEditor(host).focus();
      await userEvent.keyboard("i");
      await userEvent.keyboard("x");
      expect(visibleEditor(host).textContent).not.toBe(before);

      await picture(host, `reader-touch-390-${theme}`, TOUCH);
    } finally {
      await unmount(mounted);
    }
  }
}, 120_000);

it("reader hover rules ask for hover:hover and move only colour", async () => {
  const mounted = await mountNote(DESKTOP, "light");
  try {
    const { host } = mounted;
    // A rule counts when it hits an element inside one of these: the top bar,
    // the margins, the note header or Today. Tailwind's class names do not say
    // where they apply, so the match is made on the element.
    const scope = "[data-top-bar], [data-margin], .cm-note-head, [data-today]";

    let checked = 0;
    for (const { rule, parent } of styleRules()) {
      const selector = rule.selectorText;
      if (!selector.includes(":hover")) continue;
      // Matched without `:hover`: nothing is under the pointer, so `:hover` would match nothing.
      const hits = Array.from(document.querySelectorAll(selector.replace(/:hover/g, "")));
      if (!hits.some((element) => element.closest(scope) !== null)) continue;
      checked++;
      expect(parent).toBeInstanceOf(CSSMediaRule);
      expect((parent as CSSMediaRule).conditionText).toContain("hover: hover");
    }
    // A check that finds no hover rule at all would pass without looking.
    expect(checked).toBeGreaterThan(0);

    // Press feedback may move (transform); everything else is colour or opacity.
    const outlineRow = need(
      host.querySelector<HTMLElement>('aside[data-margin="outline"] button'),
      "outline row button",
    );
    const topButton = need(
      host.querySelector<HTMLElement>("header[data-top-bar] button"),
      "top bar button",
    );
    for (const element of [outlineRow, topButton]) {
      const properties = transitioned(element);
      expect(properties).not.toContain("all");
      for (const property of properties) {
        expect(property).toMatch(
          /color|background|border|opacity|transform|fill|stroke|outline|box-shadow|text-decoration/,
        );
      }
    }
  } finally {
    await unmount(mounted);
  }
}, 60_000);
