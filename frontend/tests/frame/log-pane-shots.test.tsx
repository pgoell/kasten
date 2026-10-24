/**
 * Pictures of the log pane (#804) to look at by eye: a phone at 390 by 844 with touch,
 * and a desktop at 1440 by 900 with a mouse, in both themes and the four palettes. Each
 * picture is its own test, run alone with `-t "shot <name>"`, and lands in
 * node_modules/.cache/kasten-shots with VITE_KASTEN_SHOTS=1. A tab, a range button or
 * + Food is pressed only where the pane draws it, so the picture shows the pane as it is.
 */

import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/instrument-sans/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { commands, page } from "vitest/browser";
import { shiftDay } from "@/lib/clock";
import type { LogDay } from "@/lib/food-api";
import { periodicNote } from "@/lib/periodic";
import { applyTheme, PALETTE_KEY, THEME_KEY, type Theme } from "@/lib/theme";
import { routeTree } from "@/routeTree.gen";
import { COARSE, NARROW, stubMatchMedia } from "../match-media";
import { wait } from "./sheet-fixture";
import { shot } from "./shots";
import "@/styles/app.css";

const LOG_CONFIG = "99 Misc/01 Config/log.md";
const DAILY = periodicNote("daily", new Date()).path;
const DAILY_TEXT = "---\ntype: Periodic Note\n---\n\n# Today\n\n## TODOs\n";
const REDUCED = "(prefers-reduced-motion: reduce)";

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

// Set by a test before it mounts, so the one-day read of today answers nothing.
const state = vi.hoisted(() => ({ emptyToday: false }));

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

// Day 0 is the day shown: a full day with three meals, and one max passed (five coffees
// against a max of four). The other days vary, with some days left with no log at all.
const dayOf = (index: number, date: string): LogDay => {
  const full = index === 0;
  const kcal = full ? 900 : 1500 + ((index * 211) % 900);
  const protein = full ? 77 : 60 + ((index * 17) % 60);
  const carbs = full ? 54 : 120 + ((index * 23) % 120);
  const fat = full ? 6 : 40 + ((index * 7) % 50);
  const water = full ? 1500 : 500 + ((index * 250) % 1500);
  const coffee = full ? 5 : (index % 6) + 1;
  const alcohol = full || index % 6 !== 5 ? 1 : 0;
  const drinks: LogDay["entries"] = [
    { line: 8, text: `- 💧 ${water} ml`, kind: "water", ml: water },
    { line: 9, text: `- ☕ ${coffee}`, kind: "coffee", count: coffee },
    { line: 11, text: "- 🍵 1 cup", kind: "mine", mark: "🍵", name: "tea", amount: 1, unit: "cup" },
  ];
  if (alcohol === 1) {
    drinks.splice(2, 0, {
      line: 10,
      text: "- 🍺 1 0.5 l 5%",
      kind: "alcohol",
      count: 1,
      ml: 500,
      abv: 5,
      grams: 19.7,
    });
  }
  const food: LogDay["entries"] = full
    ? [
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
        {
          line: 14,
          text: "- 🍽 dinner: Salmon 🔥 420 kcal 🥩 38 g",
          kind: "food",
          meal: "dinner",
          words: "Salmon",
          kcal: 420,
          protein: 38,
        },
      ]
    : [
        {
          line: 12,
          text: `- 🍽 lunch: Meal ${index} 🔥 ${kcal} kcal 🥩 ${protein} g 🍞 ${carbs} g 🧈 ${fat} g`,
          kind: "food",
          meal: "lunch",
          words: `Meal ${index}`,
          kcal,
          protein,
          carbs,
          fat,
        },
      ];
  return {
    date,
    path: `01 Periodic/00 Daily/${date}.md`,
    entries: [...drinks, ...food],
    totals: {
      water: { ml: water },
      coffee: { count: coffee },
      alcohol: { count: alcohol, ml: alcohol * 500, grams: alcohol * 19.7 },
      food: { kcal, protein, carbs, fat },
      mine: [{ mark: "🍵", name: "tea", unit: "cup", total: 1 }],
    },
  };
};

vi.mock("@/lib/food-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/food-api")>()),
  fetchLog: async (from: string, to: string): Promise<LogDay[]> => {
    if (from === to && state.emptyToday) return [];
    const days: LogDay[] = [];
    for (let index = 0; ; index += 1) {
      const date = shiftDay(from, index);
      if (date > to) break;
      // Every ninth day in a range has no log, so the bars have gaps.
      if (index % 9 !== 4 || index === 0) days.push(dayOf(index, date));
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

/** The theme and the palette, stored the way the app stores a pick, and applied. */
function setLook(theme: Theme, palette = "poel"): void {
  localStorage.setItem(THEME_KEY, theme);
  localStorage.setItem(PALETTE_KEY, palette);
  applyTheme();
}

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

/** A finger's tap, as a touch sends it, drawn inside `act`. */
async function tap(element: HTMLElement | null): Promise<void> {
  await act(async () => {
    element?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    element?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    element?.click();
  });
}

/** A key going down or up on an element, as a keyboard sends it. */
async function press(target: Element, key: string, type = "keydown"): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
  });
}

const pane = () => document.querySelector<HTMLElement>("section[aria-label='Log']");
const trends = () => pane()?.querySelector<HTMLElement>("section[aria-label='Trends']");
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

/** Presses a control the pane draws, and does nothing where it draws none. */
async function pressIfDrawn(element: HTMLElement | null): Promise<void> {
  if (element !== null) await tap(element);
}

/** The pane at a phone's size, by touch, opened from the toolbar's log button. */
async function phone(theme: Theme = "light", motion: "reduce" | "no-preference" = "no-preference") {
  stubMatchMedia({ [NARROW]: true, [COARSE]: true, [REDUCED]: motion === "reduce" });
  await commands.emulateMedia({ touch: true, reducedMotion: motion });
  setLook(theme);
  await mount(390, 844);
  await expect
    .poll(() => document.querySelector("button[aria-label='Open the log']"))
    .not.toBeNull();
  await tap(document.querySelector<HTMLElement>("button[aria-label='Open the log']"));
  await expect.poll(pane).not.toBeNull();
  await wait(500);
  return pane() as HTMLElement;
}

/** The pane at a desktop's size, opened by `<leader>gf` with vim on, in the look asked for. */
async function desktop(theme: Theme, palette = "poel"): Promise<HTMLElement> {
  localStorage.setItem("kasten.vim", "on");
  setLook(theme, palette);
  await mount(1440, 900);
  await expect
    .poll(() => document.querySelector(".cm-scroller.cm-vimMode .cm-content"))
    .not.toBeNull();
  const editor = document.querySelector(".cm-scroller.cm-vimMode .cm-content") as HTMLElement;
  for (const key of [" ", "g", "f"]) {
    await press(editor, key);
    await press(editor, key, "keyup");
  }
  await expect.poll(pane).not.toBeNull();
  await wait(500);
  return pane() as HTMLElement;
}

afterEach(async () => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = undefined;
  host = undefined;
  state.emptyToday = false;
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-palette");
  vi.unstubAllGlobals();
  await commands.emulateMedia({});
  await page.viewport(414, 896);
});

beforeEach(() => {
  localStorage.clear();
});

it("shot phone-today-full", async () => {
  const panel = await phone();
  expect(await shot(panel, "phone-today-full")).toBe(390);
});

it("shot phone-today-empty", async () => {
  state.emptyToday = true;
  const panel = await phone();
  expect(await shot(panel, "phone-today-empty")).toBe(390);
});

it("shot phone-trends-7d", async () => {
  const panel = await phone();
  await pressIfDrawn(tabOf("Trends"));
  await pressIfDrawn(paneButton("7d"));
  await wait(500);
  expect(await shot(panel, "phone-trends-7d")).toBe(390);
});

it("shot phone-trends-90d", async () => {
  const panel = await phone();
  await pressIfDrawn(tabOf("Trends"));
  await pressIfDrawn(paneButton("90d"));
  await wait(500);
  expect(await shot(panel, "phone-trends-90d")).toBe(390);
});

it("shot phone-sheet", async () => {
  const panel = await phone();
  await pressIfDrawn(paneButton("+ Food"));
  await wait(800);
  expect(await shot(panel, "phone-sheet")).toBe(390);
});

it("shot phone-weight-slot", async () => {
  const panel = await phone();
  pane()?.querySelector<HTMLElement>("[data-slot='weight']")?.scrollIntoView({ block: "center" });
  await wait(200);
  expect(await shot(panel, "phone-weight-slot")).toBe(390);
});

it("shot phone-weight-trends", async () => {
  const panel = await phone();
  await pressIfDrawn(tabOf("Trends"));
  trends()?.querySelector<HTMLElement>(".log-chart-slot")?.scrollIntoView({ block: "center" });
  await wait(200);
  expect(await shot(panel, "phone-weight-trends")).toBe(390);
});

it("shot phone-dark-today", async () => {
  const panel = await phone("dark");
  expect(await shot(panel, "phone-dark-today")).toBe(390);
});

it("shot phone-reduced-motion-sheet", async () => {
  const panel = await phone("light", "reduce");
  await pressIfDrawn(paneButton("+ Food"));
  const sheet = sheetOf();
  if (sheet !== null) {
    await expect.poll(() => Number(getComputedStyle(sheet).opacity), { timeout: 3000 }).toBe(1);
  }
  expect(await shot(panel, "phone-reduced-motion-sheet")).toBe(390);
});

it("shot desktop-light", async () => {
  const panel = await desktop("light");
  expect(await shot(panel, "desktop-light")).toBeGreaterThan(0);
});

it("shot desktop-dark", async () => {
  const panel = await desktop("dark");
  expect(await shot(panel, "desktop-dark")).toBeGreaterThan(0);
});

it("shot desktop-panel", async () => {
  const panel = await desktop("light");
  await press(panel, "f");
  await wait(800);
  expect(await shot(panel, "desktop-panel")).toBeGreaterThan(0);
});

for (const [palette, theme] of [
  ["poel", "light"],
  ["russet", "light"],
  ["peach", "light"],
  ["pansy", "dark"],
] as const) {
  it(`shot palette-${palette}`, async () => {
    const panel = await desktop(theme, palette);
    expect(await shot(panel, `palette-${palette}`)).toBeGreaterThan(0);
  });
}
