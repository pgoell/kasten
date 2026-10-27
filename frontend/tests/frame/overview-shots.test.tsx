/**
 * Pictures of the overview (#806) to look at by eye: a phone at 390 by 844 by touch, and a
 * desktop at 1440 by 900 with a mouse, in both themes and the four palettes, the log pane a
 * tap on Food opens, and the overview of an empty vault. Each picture is its own test, run
 * alone with `-t "shot <name>"`, and lands in node_modules/.cache/kasten-shots with
 * VITE_KASTEN_SHOTS=1. The four `overview-food-no-food-*` pictures (#1122) show the Food card
 * with two drinks-only days, at phone and desktop size, in both themes.
 */

import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/instrument-sans/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { commands, page } from "vitest/browser";
import type { LineHit, TodoHit } from "@/lib/api";
import { readClock, shiftDay } from "@/lib/clock";
import type { LogDay } from "@/lib/log/food-api";
import { applyTheme, PALETTE_KEY, THEME_KEY, type Theme } from "@/lib/theme";
import { routeTree } from "@/routeTree.gen";
import { COARSE, NARROW, stubMatchMedia } from "../match-media";
import { wait } from "./sheet-fixture";
import { shot } from "./shots";
import "@/styles/app.css";

const LOG_CONFIG = "99 Misc/01 Config/log.md";
const REDUCED = "(prefers-reduced-motion: reduce)";
const DAY_MS = 86_400_000;
const TODAY = readClock(new Date()).date;

const CONFIG = [
  "---",
  "type: Config",
  "---",
  "- 💧 water: 250 ml, min 2000",
  "- ☕ coffee: 1, max 4",
  "- 🍽 food: kcal max 2200, protein min 120, carbs max 250, fat max 90",
  "- ⚖ weight: kg, last",
].join("\n");

// The same header with no goal and no kind, so the cards draw their empty words.
const EMPTY_CONFIG = ["---", "type: Config", "---"].join("\n");

// Set by a test before it mounts, so every read answers as an empty vault, or the 2nd and 4th days
// ago have drinks only.
const state = vi.hoisted(() => ({ empty: false, drinksOnly: false }));

/** Days before today, so 0 is today and 1 is yesterday. */
const agoOf = (date: string): number =>
  Math.round((Date.parse(`${TODAY}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / DAY_MS);

/** One logged day: a lunch, water, coffee, and a weigh-in on most days. */
function dayOf(date: string): LogDay {
  const ago = agoOf(date);
  // Kcal runs from 1600 to just under 2500, so some days pass the 2200 max.
  const kcal = 1600 + ((ago * 137) % 900);
  const protein = 80 + ((ago * 13) % 70);
  const carbs = 180 + ((ago * 29) % 120);
  const fat = 50 + ((ago * 7) % 50);
  const water = 800 + ((ago * 250) % 1600);
  const coffee = (ago % 6) + 1;
  const weight = ago % 7 === 3 ? null : Math.round((81.2 + ((ago * 7) % 15) / 10) * 10) / 10;
  const entries: LogDay["entries"] = [
    { line: 8, text: `- 💧 ${water} ml`, kind: "water", ml: water },
    { line: 9, text: `- ☕ ${coffee}`, kind: "coffee", count: coffee },
    {
      line: 12,
      text: `- 🍽 lunch: Meal ${ago} 🔥 ${kcal} kcal`,
      kind: "food",
      meal: "lunch",
      words: `Meal ${ago}`,
      kcal,
      protein,
      carbs,
      fat,
    },
  ];
  if (weight !== null) {
    entries.push({
      line: 15,
      text: `- ⚖ ${weight} kg`,
      kind: "mine",
      mark: "⚖",
      name: "weight",
      amount: weight,
      unit: "kg",
    });
  }
  return {
    date,
    path: `01 Periodic/00 Daily/${date}.md`,
    entries,
    totals: {
      water: { ml: water },
      coffee: { count: coffee },
      alcohol: { count: 0, ml: 0, grams: 0 },
      food: { kcal, protein, carbs, fat },
      mine: weight === null ? [] : [{ mark: "⚖", name: "weight", unit: "kg", total: weight }],
    },
  };
}

/** The day with its food line dropped: the drinks stay, and the food totals read zero (#1122). */
const withoutFood = (day: LogDay): LogDay => ({
  ...day,
  entries: day.entries.filter((entry) => entry.kind !== "food"),
  totals: { ...day.totals, food: { kcal: 0, protein: 0, carbs: 0, fat: 0 } },
});

/** The day as the log answers it: the 2nd and 4th days ago have drinks only when a test asks (#1122). */
function logOn(date: string): LogDay {
  const ago = agoOf(date);
  const day = dayOf(date);
  return state.drinksOnly && (ago === 2 || ago === 4) ? withoutFood(day) : day;
}

// A schedule comment whose rating fell `ago` days back, so the review count lands on that day.
const schedule = (ago: number, interval: number) =>
  `<!--SR:!${shiftDay(TODAY, interval - ago)},${interval},250-->`;

// A note is a deck only when a line carries its tag, so each note starts with one.
// Plain cards rated over the last twenty days, two of every three, and one cloze rated today.
const CARDS: LineHit[] = [
  { path: "01 Flashcards/aws.md", line: 1, text: "#flashcards/aws" },
  ...Array.from({ length: 20 }, (_, ago) => ago)
    .filter((ago) => ago % 3 !== 1)
    .map((ago) => ({
      path: "01 Flashcards/aws.md",
      line: ago + 2,
      text: `What is item ${ago}?::An answer ${schedule(ago, 3)}`,
    })),
  { path: "01 Flashcards/geography.md", line: 1, text: "#flashcards/geography" },
  {
    path: "01 Flashcards/geography.md",
    line: 2,
    text: `The capital of {{c1::France}} is Paris. <!--SR:c1!${shiftDay(TODAY, 2)},2,250-->`,
  },
];

const todo = (line: number, text: string): TodoHit => ({
  path: "00 Inbox/todos.md",
  line,
  text,
  project: null,
  shared: false,
});

// Done today and in the fortnight before, a few a day, then some open ones, two of them overdue.
const TODOS: TodoHit[] = [
  ...Array.from({ length: 14 }, (_, ago) => ago).flatMap((ago) =>
    Array.from({ length: (ago * 5) % 4 }, (_, count) =>
      todo(ago * 4 + count + 1, `- [x] Task ${ago}.${count} ✅ ${shiftDay(TODAY, -ago)}`),
    ),
  ),
  todo(90, `- [ ] Call the dentist 📅 ${shiftDay(TODAY, -2)}`),
  todo(91, `- [ ] Pay the water bill 📅 ${shiftDay(TODAY, -9)}`),
  todo(92, `- [ ] Renew passport 📅 ${shiftDay(TODAY, 5)}`),
  todo(93, "- [ ] Read the paper"),
];

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    fetchFiles: async () => ["index.md"],
    fetchNote: async (path: string) => {
      if (path === LOG_CONFIG) return state.empty ? EMPTY_CONFIG : CONFIG;
      throw new real.NoteMissing(path);
    },
    fetchCards: async () => (state.empty ? [] : CARDS),
    fetchTodos: async () => (state.empty ? [] : TODOS),
    // Every third day and every fifth from the fifth-from-last is left unwritten, so the year has gaps.
    fetchWritten: async (from: string, to: string) => {
      const days: string[] = [];
      for (let index = 0; ; index += 1) {
        const date = shiftDay(from, index);
        if (date > to) break;
        if (!state.empty && index % 3 !== 0 && index % 5 !== 4) days.push(date);
      }
      return days;
    },
    fetchImages: async () => [],
    fetchHtml: async () => [],
    fetchAssets: async () => [],
    fetchTags: async () => [],
    fetchTerminals: async () => [],
    fetchVersion: async () => "0.8.0",
    fetchWeather: async () => [],
  };
});

vi.mock("@/lib/log/food-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log/food-api")>()),
  fetchLog: async (from: string, to: string): Promise<LogDay[]> => {
    if (state.empty) return [];
    const days: LogDay[] = [];
    for (let index = 0; ; index += 1) {
      const date = shiftDay(from, index);
      if (date > to) break;
      const ago = agoOf(date);
      // Some days have no log at all, so the bars and the streak show their gaps.
      if (ago !== 0 && (ago % 9 === 4 || (ago >= 25 && ago <= 27))) continue;
      days.push(logOn(date));
    }
    return days;
  },
}));

vi.mock("@/lib/trash-api", async (original) => ({
  ...(await original<typeof import("@/lib/trash-api")>()),
  fetchTrash: async () => [],
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

/** The route mounted on the home screen, which is where a reader starts. */
async function mount(width: number, height: number): Promise<void> {
  await page.viewport(width, height);
  vi.stubGlobal("EventSource", SilentEventSource);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ["/"] }),
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
  await expect.poll(() => document.querySelector("[data-today]")).not.toBeNull();
}

/** A finger's tap, as a touch sends it, drawn inside `act`. */
async function tap(element: HTMLElement | null): Promise<void> {
  await act(async () => {
    element?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    element?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    element?.click();
  });
}

/** The home screen's Overview button, which opens the overview with no keys at all. */
const overviewButton = () =>
  [...document.querySelectorAll<HTMLElement>("button")].find(
    (button) => button.textContent === "Overview",
  ) ?? null;
const overviewPane = () => document.querySelector<HTMLElement>("section[aria-label='Overview']");
const buttons = () => [...(overviewPane()?.querySelectorAll<HTMLElement>(".overview-open") ?? [])];
const logPane = () => document.querySelector<HTMLElement>("section[aria-label='Log']");
const foodCard = () =>
  [...document.querySelectorAll<HTMLElement>(".overview-card")].find(
    (card) => card.querySelector(".overview-name")?.textContent === "Food",
  ) ?? null;

/** The overview at a size, opened from the home screen's button, in the look asked for. */
async function open(width: number, height: number, theme: Theme, palette = "poel") {
  setLook(theme, palette);
  await mount(width, height);
  await tap(overviewButton());
  await expect.poll(overviewPane).not.toBeNull();
  // The cards slide in once; a picture taken mid-slide would catch them out of place.
  await wait(800);
  return overviewPane() as HTMLElement;
}

/** The overview at a phone's size, by touch. */
async function phone(theme: Theme = "light"): Promise<HTMLElement> {
  stubMatchMedia({ [NARROW]: true, [COARSE]: true });
  await commands.emulateMedia({ touch: true });
  return open(390, 844, theme);
}

afterEach(async () => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = undefined;
  host = undefined;
  state.empty = false;
  state.drinksOnly = false;
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

it("shot phone-overview-top", async () => {
  const panel = await phone();
  expect(await shot(panel, "phone-overview-top")).toBe(390);
});

it("shot phone-overview-bottom", async () => {
  const panel = await phone();
  panel.scrollTop = panel.scrollHeight;
  await wait(200);
  expect(await shot(panel, "phone-overview-bottom")).toBe(390);
});

it("shot phone-card-opened", async () => {
  await phone();
  await tap(buttons()[0] ?? null);
  await expect.poll(logPane).not.toBeNull();
  await wait(500);
  expect(await shot(logPane() as HTMLElement, "phone-card-opened")).toBe(390);
});

it("shot phone-overview-empty", async () => {
  state.empty = true;
  const panel = await phone();
  expect(await shot(panel, "phone-overview-empty")).toBe(390);
});

it("shot desktop-overview-light", async () => {
  const panel = await open(1440, 900, "light");
  expect(await shot(panel, "desktop-overview-light")).toBeGreaterThan(0);
});

it("shot desktop-overview-dark", async () => {
  const panel = await open(1440, 900, "dark");
  expect(await shot(panel, "desktop-overview-dark")).toBeGreaterThan(0);
});

it("shot desktop-overview-russet", async () => {
  const panel = await open(1440, 900, "light", "russet");
  expect(await shot(panel, "desktop-overview-russet")).toBeGreaterThan(0);
});

it("shot desktop-overview-peach", async () => {
  const panel = await open(1440, 900, "light", "peach");
  expect(await shot(panel, "desktop-overview-peach")).toBeGreaterThan(0);
});

it("shot desktop-overview-pansy", async () => {
  const panel = await open(1440, 900, "dark", "pansy");
  expect(await shot(panel, "desktop-overview-pansy")).toBeGreaterThan(0);
});

it("shot desktop-overview-reduced-motion", async () => {
  stubMatchMedia({ [REDUCED]: true });
  await commands.emulateMedia({ reducedMotion: "reduce" });
  const panel = await open(1440, 900, "light");
  expect(await shot(panel, "desktop-overview-reduced-motion")).toBeGreaterThan(0);
});

it("shot overview-food-no-food-light-phone", async () => {
  state.drinksOnly = true;
  await phone("light");
  expect(
    await shot(foodCard() as HTMLElement, "overview-food-no-food-light-phone"),
  ).toBeGreaterThan(0);
});

it("shot overview-food-no-food-dark-phone", async () => {
  state.drinksOnly = true;
  await phone("dark");
  expect(await shot(foodCard() as HTMLElement, "overview-food-no-food-dark-phone")).toBeGreaterThan(
    0,
  );
});

it("shot overview-food-no-food-light-desktop", async () => {
  state.drinksOnly = true;
  await open(1440, 900, "light");
  expect(
    await shot(foodCard() as HTMLElement, "overview-food-no-food-light-desktop"),
  ).toBeGreaterThan(0);
});

it("shot overview-food-no-food-dark-desktop", async () => {
  state.drinksOnly = true;
  await open(1440, 900, "dark");
  expect(
    await shot(foodCard() as HTMLElement, "overview-food-no-food-dark-desktop"),
  ).toBeGreaterThan(0);
});
