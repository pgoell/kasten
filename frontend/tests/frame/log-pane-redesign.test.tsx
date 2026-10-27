/**
 * The log pane's redesign in a real browser (#804): Today and Trends as two tabs at a
 * phone and two columns at a desktop, the food search in the shared sheet, and the
 * pane's keys with vim on and off. The pane is reached through the route, as a reader
 * reaches it, so only here can the sheet's drag, the layout and the sideways scroll be
 * measured.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { commands, page } from "vitest/browser";
import { shiftDay } from "@/lib/clock";
import type { LogDay } from "@/lib/log/food-api";
import { periodicNote } from "@/lib/periodic";
import { routeTree } from "@/routeTree.gen";
import { COARSE, NARROW, stubMatchMedia } from "../match-media";
import { centreOf, pointer } from "./sheet-fixture";
import "@/styles/app.css";

const LOG_CONFIG = "99 Misc/01 Config/log.md";
const DAILY = periodicNote("daily", new Date()).path;
const DAILY_TEXT = "---\ntype: Periodic Note\n---\n\n# Today\n\n## TODOs\n";
const REDUCED = "(prefers-reduced-motion: reduce)";

// The kinds the config names: a goal on each, and a kind of the user's own.
const CONFIG = [
  "---",
  "type: Config",
  "---",
  "- 💧 water: 250 ml, min 2000",
  "- ☕ coffee: 1, max 4",
  "- 🍺 alcohol: 1, max 2",
  "- 🍵 tea: 1 cup, min 3",
  "- 🍽 food: kcal max 2200, protein min 120",
].join("\n");

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  const fetchNote = async (path: string) => {
    if (path === LOG_CONFIG) return CONFIG;
    if (path === DAILY) return DAILY_TEXT;
    throw new real.NoteMissing(path);
  };
  return {
    ...real,
    fetchFiles: async () => ["index.md", DAILY],
    fetchNote,
    saveNote: async (path: string, content: string) => ({ path, content }),
    updateNote: async (path: string, change: (text: string) => string | null) => {
      const next = change(await fetchNote(path));
      return next === null ? null : { path, content: next };
    },
    fetchImages: async () => [],
    fetchHtml: async () => [],
    fetchAssets: async () => [],
    fetchTags: async () => [],
    fetchTodos: async () => [],
    fetchTerminals: async () => [],
    fetchVersion: async () => "0.8.0",
    fetchWeather: async () => [],
  };
});

vi.mock("@/lib/trash-api", async (original) => ({
  ...(await original<typeof import("@/lib/trash-api")>()),
  fetchTrash: async () => [],
}));

// Thirty days of the log, with the days at four fixed places left empty so the bars and the
// averages have gaps. Index 0 is the first day asked for, so a one day query is a day with entries.
const EMPTY_DAYS = [4, 11, 19, 26];

const dayOf = (index: number, date: string): LogDay => {
  const water = 500 + ((index * 250) % 1500);
  const coffee = (index % 4) + 1;
  const alcohol = index % 6 === 5 ? 0 : 1;
  const entries: LogDay["entries"] = [
    { line: 8, text: `- 💧 ${water} ml`, kind: "water", ml: water },
    { line: 9, text: `- ☕ ${coffee}`, kind: "coffee", count: coffee },
    { line: 11, text: "- 🍵 1 cup", kind: "mine", mark: "🍵", name: "tea", amount: 1, unit: "cup" },
    {
      line: 12,
      text: "- 🍽 breakfast: Oats 🔥 320 kcal 🥩 12 g 🍞 54 g 🧈 6 g",
      kind: "food",
      meal: "breakfast",
      words: "Oats",
      kcal: 320,
      protein: 12,
      carbs: 54,
      fat: 6,
    },
    {
      line: 13,
      text: "- 🍽 lunch: Skyr 🔥 160 kcal 🥩 27 g",
      kind: "food",
      meal: "lunch",
      words: "Skyr",
      kcal: 160,
      protein: 27,
    },
  ];
  if (alcohol === 1) {
    entries.splice(2, 0, {
      line: 10,
      text: "- 🍺 1 0.5 l 5%",
      kind: "alcohol",
      count: 1,
      ml: 500,
      abv: 5,
      grams: 19.7,
    });
  }
  return {
    date,
    path: `01 Periodic/00 Daily/${date}.md`,
    entries,
    totals: {
      water: { ml: water },
      coffee: { count: coffee },
      alcohol: { count: alcohol, ml: alcohol * 500, grams: alcohol * 19.7 },
      food: { kcal: 480, protein: 39, carbs: 54, fat: 6 },
      mine: [{ mark: "🍵", name: "tea", unit: "cup", total: 1 }],
    },
  };
};

vi.mock("@/lib/log/food-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log/food-api")>()),
  fetchLog: async (from: string, to: string): Promise<LogDay[]> => {
    const days: LogDay[] = [];
    for (let index = 0; ; index += 1) {
      const date = shiftDay(from, index);
      if (date > to) break;
      if (!EMPTY_DAYS.includes(index)) days.push(dayOf(index, date));
    }
    return days;
  },
}));

/** A stream that never says anything, so the route opens no connection. */
class SilentEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  close() {}
}

let root: Root | undefined;
let host: HTMLElement | undefined;

async function mount(width: number, height: number): Promise<void> {
  await page.viewport(width, height);
  vi.stubGlobal("EventSource", SilentEventSource);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [`/?note=${encodeURIComponent(DAILY)}`] }),
  });
  await act(async () => {
    await router.load();
  });
  host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  });
  await expect.poll(() => document.querySelector(".cm-content")).not.toBeNull();
}

/**
 * A finger's tap: the pointer and mouse events before the click, as a touch sends
 * them. Dispatched inside `act`, so the pane has drawn what the tap did when this returns.
 */
async function tap(element: HTMLElement | null): Promise<void> {
  expect(element, "a control to tap").not.toBeNull();
  await act(async () => {
    element?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    element?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    element?.click();
  });
}

/** A key going down or up on an element, as a keyboard sends it, drawn as `tap` is. */
async function press(target: Element, key: string, type = "keydown"): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
  });
}

const pane = () => document.querySelector<HTMLElement>("section[aria-label='Log']");
const today = () => pane()?.querySelector<HTMLElement>("section[aria-label='Today']");
const trends = () => pane()?.querySelector<HTMLElement>("section[aria-label='Trends']");
const rows = () => [...(pane()?.querySelectorAll<HTMLElement>(".log-pane-row-item") ?? [])];
const sheetOf = () =>
  document.querySelector<HTMLElement>("[role='dialog'][aria-label='Food search']");

/** The pane's button with exactly this text, or null. */
function paneButton(text: string): HTMLButtonElement | null {
  return (
    [...(pane()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (one) => one.textContent === text,
    ) ?? null
  );
}

/** The pane's tab with exactly this name, or null where the pane draws no tabs. */
function tabOf(name: string): HTMLButtonElement | null {
  return (
    [...(pane()?.querySelectorAll<HTMLButtonElement>("[role='tab']") ?? [])].find(
      (one) => one.textContent === name,
    ) ?? null
  );
}

/** The page and the pane are no wider than their boxes: nothing scrolls sideways. */
function expectNoSideways(): void {
  const panel = pane() as HTMLElement;
  expect(panel.scrollWidth, "the pane's scroll width").toBeLessThanOrEqual(panel.clientWidth);
  const root = document.documentElement;
  expect(root.scrollWidth, "the page's scroll width").toBeLessThanOrEqual(root.clientWidth);
}

/** The pane at a phone's size, by touch, opened from the toolbar's log button. */
async function openPhone(
  motion: "reduce" | "no-preference" = "no-preference",
): Promise<HTMLElement> {
  stubMatchMedia({ [NARROW]: true, [COARSE]: true, [REDUCED]: motion === "reduce" });
  await commands.emulateMedia({ touch: true, reducedMotion: motion });
  await mount(390, 844);
  await expect
    .poll(() => document.querySelector("button[aria-label='Open the log']"))
    .not.toBeNull();
  await tap(document.querySelector<HTMLElement>("button[aria-label='Open the log']"));
  await expect.poll(pane).not.toBeNull();
  return pane() as HTMLElement;
}

/** The pane at a desktop's size, opened by `<leader>gf` with vim on, its cursor ready for keys. */
async function openDesktop(): Promise<HTMLElement> {
  localStorage.setItem("kasten.vim", "on");
  await mount(1440, 900);
  // Only vim reads Space as the leader, and it marks the editor once it is up.
  await expect
    .poll(() => document.querySelector(".cm-scroller.cm-vimMode .cm-content"))
    .not.toBeNull();
  const editor = document.querySelector(".cm-scroller.cm-vimMode .cm-content") as HTMLElement;
  for (const key of [" ", "g", "f"]) {
    await press(editor, key);
    await press(editor, key, "keyup");
  }
  await expect.poll(pane).not.toBeNull();
  const panel = pane() as HTMLElement;
  panel.focus();
  return panel;
}

afterEach(async () => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = undefined;
  host = undefined;
  localStorage.clear();
  vi.unstubAllGlobals();
  await commands.emulateMedia({});
  await page.viewport(414, 896);
});

beforeEach(() => {
  localStorage.clear();
});

it("#804 A15 at 390x844 by touch the tabs switch Today and Trends and nothing scrolls sideways", async () => {
  await openPhone();
  expectNoSideways();

  expect(tabOf("Trends"), "the Trends tab").not.toBeNull();
  await tap(tabOf("Trends"));
  expect(tabOf("Trends")?.getAttribute("aria-selected")).toBe("true");
  expect(trends()?.hidden).toBe(false);
  expect(today()?.hidden).toBe(true);
  expectNoSideways();

  await tap(paneButton("90d"));
  await expect.poll(() => trends()?.querySelectorAll(".log-chart").length ?? 0).toBeGreaterThan(0);
  expectNoSideways();

  await tap(tabOf("Today"));
  expect(today()?.hidden).toBe(false);
  expectNoSideways();
});

it("#804 A15 at 390x844 a tap on + Food opens the bottom sheet at the screen's foot and a drag down on the grabber closes it", async () => {
  const panel = await openPhone();
  expect(paneButton("+ Food"), "the + Food button").not.toBeNull();
  await tap(paneButton("+ Food"));
  await expect.poll(sheetOf).not.toBeNull();
  const sheet = sheetOf() as HTMLElement;

  // The sheet rises to rest on the foot of the screen, across its width.
  await expect
    .poll(() => Math.abs(sheet.getBoundingClientRect().bottom - window.innerHeight))
    .toBeLessThanOrEqual(1);
  expect(Math.abs(sheet.getBoundingClientRect().width - window.innerWidth)).toBeLessThanOrEqual(1);

  // Past the whole sheet, so the release is a close whatever the speed.
  const grab = sheet.querySelector<HTMLElement>("[data-sheet-drag]") as HTMLElement;
  const start = centreOf(grab);
  const far = start.y + sheet.offsetHeight + 40;
  pointer(grab, "pointerdown", start.x, start.y);
  pointer(grab, "pointermove", start.x, start.y + 20);
  pointer(grab, "pointermove", start.x, far);
  pointer(grab, "pointerup", start.x, far);

  await expect.poll(sheetOf, { timeout: 3000 }).toBeNull();
  expect(document.activeElement).toBe(panel);
});

it("#804 A15 at 1440x900 f opens the food search as the right panel with a scrim inside the pane, Esc closes it and j moves the cursor", async () => {
  const panel = await openDesktop();
  await expect.poll(() => rows().length).toBeGreaterThan(1);
  await press(panel, "f");
  await expect.poll(sheetOf).not.toBeNull();
  const sheet = sheetOf() as HTMLElement;

  // The panel sits at the pane's right edge, 540 px wide, and its scrim covers the pane.
  const frame = panel.getBoundingClientRect();
  await expect
    .poll(() => Math.abs(sheet.getBoundingClientRect().right - frame.right))
    .toBeLessThanOrEqual(1);
  expect(Math.abs(sheet.getBoundingClientRect().width - 540)).toBeLessThanOrEqual(1);
  const scrim = sheet.previousElementSibling as HTMLElement;
  expect(panel.contains(scrim), "the scrim inside the pane").toBe(true);
  const covered = scrim.getBoundingClientRect();
  expect(Math.abs(covered.left - frame.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(covered.top - frame.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(covered.right - frame.right)).toBeLessThanOrEqual(1);
  expect(Math.abs(covered.bottom - frame.bottom)).toBeLessThanOrEqual(1);

  await press(sheet, "Escape");
  await expect.poll(sheetOf, { timeout: 3000 }).toBeNull();
  await press(panel, "j");
  expect(rows()[1]?.classList.contains("log-pane-selected")).toBe(true);
});

it("#804 A15 at 1440x900 Today and Trends stand side by side", async () => {
  await openDesktop();
  expect(today(), "the Today column").not.toBeNull();
  expect(trends(), "the Trends column").not.toBeNull();
  const left = today() as HTMLElement;
  const right = trends() as HTMLElement;
  expect(right.getBoundingClientRect().left).toBeGreaterThan(left.getBoundingClientRect().right);
  expect(
    Math.abs(right.getBoundingClientRect().top - left.getBoundingClientRect().top),
  ).toBeLessThanOrEqual(1);
});

it("#804 A15 with reduced motion the pane's food sheet fades and does not slide", async () => {
  await openPhone("reduce");
  expect(paneButton("+ Food"), "the + Food button").not.toBeNull();
  await tap(paneButton("+ Food"));
  await expect.poll(sheetOf).not.toBeNull();
  const sheet = sheetOf() as HTMLElement;

  expect(getComputedStyle(sheet).transitionProperty).toContain("opacity");
  expect(getComputedStyle(sheet).transitionProperty).not.toContain("transform");
  // It never slid up: it rests on the foot of the screen from the first frame to the last.
  expect(Math.abs(sheet.getBoundingClientRect().bottom - window.innerHeight)).toBeLessThanOrEqual(
    1,
  );
  await expect.poll(() => Number(getComputedStyle(sheet).opacity), { timeout: 3000 }).toBe(1);
  expect(Math.abs(sheet.getBoundingClientRect().bottom - window.innerHeight)).toBeLessThanOrEqual(
    1,
  );
});

it("#804 A15 with vim off the pane's keys and the sheet work the same", async () => {
  localStorage.setItem("kasten.vim", "off");
  const panel = await openPhone();
  await expect.poll(() => rows().length).toBeGreaterThan(1);

  await press(panel, "f");
  await expect.poll(sheetOf).not.toBeNull();
  await press(sheetOf() as HTMLElement, "Escape");
  await expect.poll(sheetOf, { timeout: 3000 }).toBeNull();
  await press(panel, "j");
  expect(rows()[1]?.classList.contains("log-pane-selected")).toBe(true);
});

it("#804 I7 at 390 the 90 day charts and the week table fit with no sideways scroll", async () => {
  await openPhone();
  expect(tabOf("Trends"), "the Trends tab").not.toBeNull();
  await tap(tabOf("Trends"));
  await tap(paneButton("90d"));
  await expect.poll(() => trends()?.querySelectorAll(".log-chart").length ?? 0).toBeGreaterThan(0);
  expectNoSideways();

  const frame = pane()?.getBoundingClientRect() as DOMRect;
  const parts = [
    ...(trends()?.querySelectorAll<HTMLElement>(".log-multiples > *, .log-macros, .log-weeks") ??
      []),
  ];
  expect(parts.length, "the charts, the macro split and the week table").toBeGreaterThan(0);
  for (const part of parts) {
    const box = part.getBoundingClientRect();
    expect(box.right, `${part.className} right edge`).toBeLessThanOrEqual(frame.right + 0.5);
    expect(box.left, `${part.className} left edge`).toBeGreaterThanOrEqual(frame.left - 0.5);
  }
  expect(getComputedStyle(trends() as HTMLElement).fontVariantNumeric).toContain("tabular-nums");
});
