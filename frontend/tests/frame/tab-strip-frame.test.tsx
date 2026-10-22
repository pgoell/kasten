/**
 * The tab strip (#780) in the browser: its box and where it sits, the fold at
 * twelve tabs, the hover rules, the underline's glide, the entrance, and a tap
 * on a phone. The pictures are in `tab-strip-pictures.test.tsx`.
 *
 * Mounted through `tab-strip-fixture.tsx`, which seeds the workspace through the
 * reader's `mount`, so each test opens the tabs it needs.
 */

import { fireEvent, waitFor } from "@testing-library/react";
// For its types alone: the provider is what gives `cdp()` a typed `send`.
import type {} from "@vitest/browser-playwright";
import { cdp } from "vitest/browser";
import { resetStripEntrance } from "@/components/tab-strip";
import { resetHeld } from "@/lib/held-text";
import { noteName } from "@/lib/note-path";
import { openInFocused } from "@/lib/pane-contents";
import { addTab, emptyLayout, goToTab, type Layout, splitFocused } from "@/lib/panes";
import {
  DESKTOP,
  leader,
  mount,
  need,
  nextFrame,
  PATIENCE,
  READER,
  registerReaderFixture,
  scrollerOf,
  TOUCH,
  unmount,
  visibleEditor,
} from "./reader-fixture";
import {
  barOf,
  COARSE_KEY,
  DESIGN,
  drawn,
  LONG,
  moreButton,
  mountTabs,
  registerTabNotes,
  stripOf,
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

/** A finger put down and lifted on the middle of `element`, which is a tap. */
async function tapOn(element: Element): Promise<void> {
  const box = element.getBoundingClientRect();
  const point = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  await cdp().send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  await cdp().send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

it("A1 the strip is 40 px and sticky right under the top bar at 1440", async () => {
  for (const [size, height] of [
    [DESKTOP, "40px"],
    [TOUCH, "44px"],
  ] as const) {
    const mounted = await mountTabs(size, "light", twoTabs());
    try {
      const { host } = mounted;
      const strip = stripOf(host);
      const style = getComputedStyle(strip);
      expect(style.height).toBe(height);
      expect(style.position).toBe("sticky");

      const bar = need(host.querySelector<HTMLElement>("header[data-top-bar]"), "top bar");
      const under = bar.getBoundingClientRect().bottom;
      if (size === DESKTOP) expect(under).toBe(56);
      // The entrance slides the strip up from 6 px for 240 ms, so it is measured once that is done.
      await expect.poll(() => strip.getBoundingClientRect().top, PATIENCE).toBe(under);

      // The note scrolls under the strip, and the strip stays where it was.
      scrollerOf(host).scrollTop = 300;
      await nextFrame();
      await nextFrame();
      expect(scrollerOf(host).scrollTop).toBeGreaterThan(0);
      expect(strip.getBoundingClientRect().top).toBe(under);
    } finally {
      await unmount(mounted);
    }
  }
}, 120_000);

it("A7 at 1440 twelve tabs fold behind N more and the active tab stays drawn", async () => {
  const mounted = await mountTabs(DESKTOP, "light", twelveTabs());
  try {
    const { host } = mounted;
    const strip = stripOf(host);
    const box = strip.getBoundingClientRect();
    // Folding is measured before the paint, so the button is there at once; the poll
    // only waits for the first render of the test's own mount.
    await expect.poll(() => moreButton(host)?.textContent ?? "", PATIENCE).toMatch(/^\d+ more$/);
    const shown = drawn(host);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(12);
    expect(moreButton(host)?.textContent).toBe(`${12 - shown.length} more`);
    for (const tab of shown) {
      const at = tab.getBoundingClientRect();
      expect(at.left).toBeGreaterThanOrEqual(box.left);
      expect(at.right).toBeLessThanOrEqual(box.right);
      expect(at.top).toBeGreaterThanOrEqual(box.top);
      expect(at.bottom).toBeLessThanOrEqual(box.bottom);
    }

    fireEvent.click(need(moreButton(host), "N more button"));
    await expect
      .poll(() => host.querySelectorAll("[role='menuitem']").length, PATIENCE)
      .toBe(12 - shown.length);
    const rows = [...host.querySelectorAll<HTMLElement>("[role='menuitem']")];
    fireEvent.click(need(rows.at(-1), "last row"));

    // The last tab is active now, drawn inside the strip, and the underline sits under it.
    await expect
      .poll(
        () => host.querySelector("[role='tab'][aria-selected='true']")?.textContent ?? "",
        PATIENCE,
      )
      .toContain(noteName(LONG[11] ?? ""));
    const picked = need(wrappers(host).at(-1), "last tab");
    expect(picked.getAttribute("aria-hidden")).toBeNull();
    const at = picked.getBoundingClientRect();
    expect(at.left).toBeGreaterThanOrEqual(box.left);
    expect(at.right).toBeLessThanOrEqual(box.right);
    await expect.poll(() => underlineUnder(host, picked), PATIENCE).toBe(true);
  } finally {
    await unmount(mounted);
  }
}, 120_000);

it("A5 A18 the strip's hover rules sit behind hover:hover and move only colour", async () => {
  const mounted = await mountTabs(DESKTOP, "light", twoTabs());
  try {
    const strip = stripOf(mounted.host);
    // A rule counts when it hits an element of the strip, the Today button
    // included. Matched without `:hover`, the way the reader's check matches.
    let checked = 0;
    let washed = 0;
    // Visibility and display are how the close x and the dot take turns on hover;
    // neither moves anything, so they are allowed beside colour.
    const allowed = /color|background|visibility|display|opacity/;
    for (const { rule, parent } of styleRules()) {
      const selector = rule.selectorText;
      if (!selector.includes(":hover")) continue;
      const hits = Array.from(document.querySelectorAll(selector.replace(/:hover/g, "")));
      if (!hits.some((element) => strip.contains(element))) continue;
      checked++;
      expect(parent).toBeInstanceOf(CSSMediaRule);
      expect((parent as CSSMediaRule).conditionText).toContain("hover: hover");
      for (let index = 0; index < rule.style.length; index++) {
        expect(rule.style[index]).toMatch(allowed);
      }
      if (selector.includes("accent-wash")) {
        washed++;
        expect(rule.style.backgroundColor).toContain("accent-wash");
      }
    }
    // A check that finds no hover rule at all would pass without looking, and the
    // wash is the one A5 names.
    expect(checked).toBeGreaterThan(0);
    expect(washed).toBeGreaterThan(0);

    const idle = need(
      wrappers(mounted.host)[1]?.querySelector<HTMLElement>("[role='tab']"),
      "second tab",
    );
    const properties = transitioned(idle);
    expect(properties).not.toContain("all");
    // Press feedback may move (transform), as the reader's check allows; a hover
    // never does, and the rules above are what carry the hover.
    for (const property of properties)
      expect(property).toMatch(/color|background|opacity|transform/);
  } finally {
    await unmount(mounted);
  }
}, 60_000);

it("A15 the underline glides on the tab spring with transform only", async () => {
  const mounted = await mountTabs(DESKTOP, "light", twoTabs());
  try {
    const { host } = mounted;
    const [first, second] = wrappers(host);
    const bar = barOf(host);
    const from = need(first, "first tab").offsetLeft;
    const to = need(second, "second tab").offsetLeft;
    await expect.poll(() => underlineUnder(host, need(first, "first tab")), PATIENCE).toBe(true);

    // One sample per frame, of the bar's transform, from the click until it lands.
    const samples: number[] = [];
    let sampling = true;
    const sample = () => {
      if (!sampling) return;
      const match = /translateX\((-?[\d.]+)px\)/.exec(bar.style.transform);
      if (match?.[1] !== undefined) samples.push(Number(match[1]));
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    fireEvent.click(need(second?.querySelector("[role='tab']"), "second tab"));
    await expect.poll(() => underlineUnder(host, need(second, "second tab")), PATIENCE).toBe(true);
    sampling = false;

    const between = samples.filter(
      (x) => x > Math.min(from, to) + 0.5 && x < Math.max(from, to) - 0.5,
    );
    expect(between.length).toBeGreaterThan(0);
    // Only the transform moves: the bar's left and width are never set inline.
    expect(bar.style.left).toBe("");
    expect(bar.style.width).toBe("");
  } finally {
    await unmount(mounted);
  }
}, 60_000);

it("A15 under reduced motion the underline lands in the first frame", async () => {
  const mounted = await mountTabs(DESKTOP, "light", twoTabs(), true);
  try {
    const { host } = mounted;
    const [first, second] = wrappers(host);
    // The bar is painted from the tab's offsetLeft and offsetWidth, which are whole
    // pixels, so it is checked against those same whole pixels: the transform is
    // exact, and no tolerance is needed. (The rects are fractional, which is why a
    // comparison against them was off by half a pixel.)
    const target = need(second, "second tab");
    const to = target.offsetLeft;
    const width = target.offsetWidth;
    fireEvent.click(need(second?.querySelector("[role='tab']"), "second tab"));
    await nextFrame();
    const painted = barOf(host).style.transform;
    expect(painted).toBe(`translateX(${to}px) scaleX(${width})`);
    expect(
      need(first?.querySelector("[role='tab']"), "first tab button").getAttribute("aria-selected"),
    ).toBe("false");
  } finally {
    await unmount(mounted);
  }
}, 60_000);

it("A20 on a 390 touch phone a tap opens a tab, a tap on Today goes home, and a tap on the x closes the active tab", async () => {
  // Reader, Reader, and an empty tab, one pane each, on a phone with a finger.
  const three = goToTab(addTab(openInFocused(addTab(emptyLayout(READER)), READER)), 0);
  const mounted = await mountTabs(TOUCH, "light", three);
  try {
    const { host } = mounted;
    const selected = () =>
      wrappers(host).findIndex((tab) => tab.querySelector("[aria-selected='true']") !== null);
    // The phone draws the first two tabs and folds the third behind "1 more".
    expect(drawn(host)).toHaveLength(2);
    expect(moreButton(host)?.textContent).toBe("1 more");

    // A tap on the second tab makes it the active one.
    await tapOn(need(drawn(host)[1]?.querySelector("[role='tab']"), "second tab"));
    await expect.poll(selected, PATIENCE).toBe(1);
    await waitFor(() => expect(visibleEditor(host).textContent).toContain("paragraph"), PATIENCE);

    // A tap on Today goes to the empty tab, which the strip brings into view.
    const today = () =>
      need(
        [...host.querySelectorAll<HTMLButtonElement>("button")].find(
          (button) => button.textContent === "Today",
        ),
        "Today",
      );
    await tapOn(today());
    await expect.poll(selected, PATIENCE).toBe(2);
    await waitFor(() => expect(host.querySelector("section[data-today]")).not.toBeNull(), PATIENCE);
    expect(today().className).toContain("text-k-ink");

    // A tap on the x of the active tab closes that tab: one fewer.
    await tapOn(need(host.querySelector("button[aria-label='Close New tab']"), "close x"));
    await expect.poll(() => wrappers(host).length, PATIENCE).toBe(2);
  } finally {
    await unmount(mounted);
  }
}, 120_000);

/** Twelve tabs, the first one split side by side, the right half focused. */
function splitThenTabs(): Layout {
  const first = openInFocused(splitFocused(emptyLayout(READER), "row"), DESIGN);
  return goToTab(
    LONG.slice(1).reduce((layout, path) => openInFocused(addTab(layout), path), first),
    0,
  );
}

it("R3 a split's focus line does not paint over the open N more list", async () => {
  const mounted = await mountTabs(DESKTOP, "light", splitThenTabs());
  try {
    const { host } = mounted;
    await expect.poll(() => moreButton(host)?.textContent ?? "", PATIENCE).toMatch(/^\d+ more$/);
    fireEvent.click(need(moreButton(host), "N more button"));
    await expect.poll(() => host.querySelector("[role='menu']") !== null, PATIENCE).toBe(true);

    // The focus line lies over the focused pane's top edge, two pixels deep, and the
    // list starts 4 px below the strip (`mt-1`), under that edge. So the two never
    // overlap in this layout: the list is below the line, and the line is not a
    // rival for the list's pixels. The stacking itself is the strip's z-10 against
    // the line's z-[1], which only the geometry can show.
    const menu = need(host.querySelector<HTMLElement>("[role='menu']"), "N more list");
    const line = need(
      host.querySelector<HTMLElement>("[data-focus-line].bg-k-accent"),
      "focus line",
    );
    expect(menu.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      line.getBoundingClientRect().bottom,
    );
  } finally {
    await unmount(mounted);
  }
}, 120_000);

it("R4 on a 390 phone the active tab with unsaved text still shows its x", async () => {
  // The note of the first tab, which is the active one, holds text the vault has not
  // got. Held before the mount, in the storage the page reads when it first draws.
  resetHeld();
  const held = JSON.stringify({
    [READER]: [{ content: "typed and not yet saved", reason: "held", conflicted: false }],
  });
  const mounted = await mount(TOUCH, "light", "/", "[role='tablist']", {
    [COARSE_KEY]: JSON.stringify({ layout: twoTabs(), treeOpen: false }),
    "kasten.held.2": held,
  });
  try {
    const { host } = mounted;
    const close = need(
      host.querySelector<HTMLElement>("button[aria-label='Close Reader']"),
      "close x",
    );
    const dot = need(close.parentElement?.querySelector<HTMLElement>(".rounded-full"), "dot");
    await expect.poll(() => getComputedStyle(close).visibility, PATIENCE).toBe("visible");
    expect(getComputedStyle(dot).display).toBe("none");
  } finally {
    resetHeld();
    await unmount(mounted);
  }
}, 60_000);

it("R17 at 390 touch the open tree drawer covers the strip, which is not over it", async () => {
  const mounted = await mountTabs(TOUCH, "light", twoTabs());
  try {
    const { host } = mounted;
    leader(host, [" ", "b"]);
    await expect
      .poll(() => host.querySelector("button[aria-label='Close file tree']") !== null, PATIENCE)
      .toBe(true);

    // The strip is inert while the drawer is open, so a hit test skips it and proves
    // nothing. The stacking order is what paints: the strip must sit under the
    // drawer's backdrop (z-15), which is the drawer's own layer.
    const strip = stripOf(host);
    const backdrop = need(
      host.querySelector<HTMLElement>("button[aria-label='Close file tree']"),
      "backdrop",
    );
    expect(Number(getComputedStyle(strip).zIndex)).toBeLessThan(
      Number(getComputedStyle(backdrop).zIndex),
    );
  } finally {
    await unmount(mounted);
  }
}, 60_000);

it("R20 at 390 touch three short tabs are all drawn, and a tab that is not active takes no room for its x", async () => {
  // Reader, and two tabs named "a" and "b": short names, which a phone has room for
  // in full once the tabs that are not active take no x room.
  const three = goToTab(
    openInFocused(addTab(openInFocused(addTab(emptyLayout(READER)), "a.md")), "b.md"),
    0,
  );
  const mounted = await mountTabs(TOUCH, "light", three);
  try {
    const { host } = mounted;
    expect(drawn(host)).toHaveLength(3);
    expect(moreButton(host)).toBeUndefined();

    // A tab that is not active has its button and its padding, and no x room.
    const wrapper = need(wrappers(host)[1], "second tab");
    const button = need(wrapper.querySelector<HTMLElement>("[role='tab']"), "second tab button");
    expect(
      wrapper.getBoundingClientRect().width - button.getBoundingClientRect().width,
    ).toBeLessThanOrEqual(8.5);
  } finally {
    await unmount(mounted);
  }
}, 60_000);

it("A14 the strip's entrance plays once", async () => {
  // The page is the same one the earlier tests mounted, so the entrance is spent
  // unless this test asks for a first load again.
  resetStripEntrance();
  const mounted = await mountTabs(DESKTOP, "light", twoTabs());
  try {
    const { host } = mounted;
    const strip = stripOf(host);
    // The entrance runs on the first load: the k-enter animation is on the strip now.
    const running = () =>
      strip
        .getAnimations({ subtree: true })
        .filter(
          (animation) =>
            animation.playState === "running" &&
            (animation as CSSAnimation).animationName === "k-enter",
        );
    expect(running().length).toBeGreaterThan(0);
    await expect.poll(() => running().length, PATIENCE).toBe(0);

    // A tab switch and a new tab do not play it again.
    fireEvent.click(need(wrappers(host)[1]?.querySelector("[role='tab']"), "second tab"));
    await nextFrame();
    expect(running()).toHaveLength(0);
    await waitFor(() => expect(visibleEditor(host).textContent).toContain("paragraph"), PATIENCE);

    leader(host, [" ", "c", "t"]);
    await waitFor(() => expect(wrappers(host)).toHaveLength(3), PATIENCE);
    await nextFrame();
    expect(running()).toHaveLength(0);
  } finally {
    await unmount(mounted);
  }
}, 60_000);
