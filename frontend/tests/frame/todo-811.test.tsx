/**
 * The overview and board redesign in a real browser (#811): the overdue date's
 * contrast in every palette, the tap targets and sideways scroll at a phone's width,
 * the reduced-motion transitions, and a finger's swipe on the phone board. Touch is
 * sent through the DevTools protocol, which makes the browser's own pointer events.
 */

import { commands, page } from "vitest/browser";
import { applyTheme, PALETTE_KEY, PALETTES, THEME_KEY, type Theme } from "@/lib/theme";
import { DEFAULT_VIEWS } from "@/lib/todo-view";
import {
  FILES,
  HITS,
  mount,
  pagePoint,
  press,
  touchDown,
  touchTo,
  touchUp,
} from "./todo-811-fixture";

const { fetchTodos, fetchNote, fetchFiles, createNote, searchNotes } = vi.hoisted(() => ({
  fetchTodos: vi.fn(),
  fetchNote: vi.fn(),
  fetchFiles: vi.fn(),
  createNote: vi.fn(),
  searchNotes: vi.fn(),
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  fetchTodos,
  fetchNote,
  fetchFiles,
  createNote,
  searchNotes,
}));

const THEMES: Theme[] = ["light", "dark"];
/** The one overdue todo every look reads its date from. */
const OVERDUE = "file the expense report";

beforeEach(() => {
  fetchTodos.mockResolvedValue(HITS);
  fetchFiles.mockResolvedValue(FILES);
  fetchNote.mockResolvedValue(DEFAULT_VIEWS);
  createNote.mockResolvedValue(undefined);
  searchNotes.mockResolvedValue([]);
});

afterEach(async () => {
  // The next test in this browser page would still read the touch, motion and look set here.
  await commands.emulateMedia({});
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-palette");
  await page.viewport(1440, 900);
});

type Rgba = [number, number, number, number];

/** Read a computed rgb() or rgba() string. */
function parse(css: string): Rgba {
  const match = css.match(/rgba?\(([^)]+)\)/);
  if (!match) throw new Error(`not a colour: ${css}`);
  const [r = 0, g = 0, b = 0, a = 1] = (match[1] ?? "")
    .split(",")
    .map((part) => Number.parseFloat(part));
  return [r, g, b, a];
}

/** A translucent colour laid over an opaque base, as the screen shows it. */
function over(top: Rgba, base: Rgba): Rgba {
  const [r, g, b, a] = top;
  return [r * a + base[0] * (1 - a), g * a + base[1] * (1 - a), b * a + base[2] * (1 - a), 1];
}

/** WCAG relative luminance of an opaque colour. */
function luminance([r, g, b]: Rgba): number {
  const [R = 0, G = 0, B = 0] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** WCAG contrast ratio of two opaque colours. */
function ratio(a: Rgba, b: Rgba): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** "ok" when the ratio meets the minimum, else the ratio, so a failure shows the number. */
function grade(r: number, min: number): string {
  return r >= min ? "ok" : r.toFixed(2);
}

/**
 * The colour a text sits on: the nearest background that is not clear, with any
 * translucent one above it laid over the next, down to the page.
 */
function groundOf(element: Element): Rgba {
  const layers: Rgba[] = [];
  for (let node: Element | null = element; node !== null; node = node.parentElement) {
    const color = parse(getComputedStyle(node).backgroundColor);
    if (color[3] === 0) continue;
    layers.push(color);
    if (color[3] === 1) break;
  }
  return layers.reduceRight((base, top) => over(top, base), [255, 255, 255, 1] as Rgba);
}

/** The first element matching `selector` under `host`, or the test says which one is missing. */
function need<T extends Element = HTMLElement>(host: ParentNode, selector: string): T {
  const found = host.querySelector<T>(selector);
  if (!found) throw new Error(`no ${selector} on the page`);
  return found;
}

/** The overdue todo's own element among `selector`'s, read as its date's grade. */
function overdueDate(host: Element, selector: string): string {
  const element = [...host.querySelectorAll<HTMLElement>(selector)].find((one) =>
    one.textContent?.includes(OVERDUE),
  );
  if (!element) throw new Error(`no overdue todo under ${selector}`);
  const date = need(element, ".text-k-danger");
  return grade(ratio(parse(getComputedStyle(date).color), groundOf(date)), 4.5);
}

/** The visible buttons of the pane that are shorter than a finger's 44 px, named with their height. */
function tooSmall(host: Element): string[] {
  return [...host.querySelectorAll<HTMLElement>("section[aria-label='Todos'] button")]
    .filter((button) => button.getClientRects().length > 0)
    .map((button) => ({ button, height: button.getBoundingClientRect().height }))
    .filter(({ height }) => height < 44)
    .map(({ button, height }) => `${button.textContent?.trim() || button.ariaLabel}: ${height}`);
}

/** The page's and the pane's sideways scroll width, which must be no wider than the phone at 390 px. */
function overflow(host: Element) {
  return {
    page: document.scrollingElement?.scrollWidth ?? 0,
    pane: need(host, "section[aria-label='Todos']").scrollWidth,
  };
}

/** The `translateX` a column is drawn at, in CSS pixels. */
function offsetOf(element: HTMLElement): number {
  const match = /translateX\((-?[\d.]+)px\)/.exec(element.style.transform);
  if (!match) throw new Error(`no offset in "${element.style.transform}"`);
  return Number(match[1]);
}

describe("the todo overview and board in a browser (#811)", () => {
  it("#811 I8 an overdue date reads at 4.5:1 on its ground in every palette and both themes", async () => {
    const looks: Record<string, Record<string, string>> = {};
    for (const palette of PALETTES) {
      for (const theme of THEMES) {
        localStorage.setItem(THEME_KEY, theme);
        localStorage.setItem(PALETTE_KEY, palette);
        applyTheme();
        const pane = await mount(1440, 900);
        try {
          const list = overdueDate(pane.host, "[data-row]");
          press(pane.host, "c");
          await expect.poll(() => pane.host.querySelector("[data-card]")).not.toBeNull();
          looks[`${palette} ${theme}`] = { list, card: overdueDate(pane.host, "[data-card]") };
        } finally {
          pane.unmount();
        }
      }
    }
    const ok = { list: "ok", card: "ok" };
    expect(looks).toEqual(
      Object.fromEntries(
        PALETTES.flatMap((palette) => THEMES.map((theme) => [`${palette} ${theme}`, ok])),
      ),
    );
  }, 120_000);

  it("#811 I6 at 390x844 by touch every tap target of the list and the board is at least 44 px tall and nothing scrolls sideways", async () => {
    await commands.emulateMedia({ touch: true });
    const pane = await mount(390, 844, { coarse: true });
    try {
      expect(tooSmall(pane.host)).toEqual([]);
      expect(overflow(pane.host).page).toBeLessThanOrEqual(390);
      expect(overflow(pane.host).pane).toBeLessThanOrEqual(390);

      press(pane.host, "c");
      await expect.poll(() => pane.host.querySelector("[data-card]")).not.toBeNull();
      expect(tooSmall(pane.host)).toEqual([]);
      expect(overflow(pane.host).page).toBeLessThanOrEqual(390);
      expect(overflow(pane.host).pane).toBeLessThanOrEqual(390);
    } finally {
      pane.unmount();
    }
  });

  it("#811 A14 with reduced motion the fold chevron and the swipe have no transition", async () => {
    await commands.emulateMedia({ touch: true, reducedMotion: "reduce" });
    const pane = await mount(390, 844, { coarse: true, reduced: true });
    try {
      const chevron = need(pane.host, "h3 button[aria-expanded] span[aria-hidden='true']");
      const style = getComputedStyle(chevron);
      const chevronNow = { property: style.transitionProperty, duration: style.transitionDuration };

      press(pane.host, "c");
      await expect.poll(() => pane.host.querySelector("[role='tablist']")).not.toBeNull();
      const column = need<HTMLElement>(pane.host, "[role='tablist'] + div");
      const card = need(column, "[data-card]");
      // A release past a quarter of the width is a step, which reduced motion takes at once.
      const [x, y] = pagePoint(card);
      await touchDown(x, y);
      await touchTo(x - 150, y);
      // The move lands a frame after the call returns, so the release waits for it to be drawn.
      await expect.poll(() => offsetOf(column)).toBeCloseTo(-150, 0);
      await touchUp();
      const tabs = pane.host.querySelectorAll("[role='tab']");
      await expect.poll(() => tabs[1]?.getAttribute("aria-selected")).toBe("true");
      // Both answers in one comparison, so a failure shows the chevron and the swipe together.
      expect({ chevron: chevronNow, swipe: column.style.transform }).toEqual({
        chevron: { property: "none", duration: "0s" },
        swipe: "translateX(0px)",
      });
    } finally {
      pane.unmount();
    }
  });

  it("#811 A8 at 390x844 a touch swipe on the column follows the finger and changes the state tab", async () => {
    await commands.emulateMedia({ touch: true });
    const pane = await mount(390, 844, { coarse: true, board: true });
    try {
      const tabs = pane.host.querySelectorAll("[role='tab']");
      const column = need<HTMLElement>(pane.host, "[role='tablist'] + div");
      const card = need(column, "[data-card]");
      const [x, y] = pagePoint(card);

      await touchDown(x, y);
      // Each move is drawn a frame after its call returns, so each reading waits for it.
      await touchTo(x - 80, y);
      await expect.poll(() => offsetOf(column)).toBeCloseTo(-80, 0);
      // The column is under the finger, and the tab has not moved yet.
      expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");

      await touchTo(x - 160, y);
      await expect.poll(() => offsetOf(column)).toBeCloseTo(-160, 0);

      await touchUp();
      await expect.poll(() => tabs[1]?.getAttribute("aria-selected")).toBe("true");
      expect(tabs[0]?.getAttribute("aria-selected")).toBe("false");
    } finally {
      pane.unmount();
    }
  });
});
