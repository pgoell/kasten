/**
 * Pictures of the log card to look at by eye (#803): a phone at 390 by 844 with
 * touch, and a desktop at 1440 by 900 with a mouse, in both themes and the four
 * palettes. Each picture is its own test, run alone with `-t "shot <name>"`, and
 * lands in node_modules/.cache/kasten-shots with VITE_KASTEN_SHOTS=1.
 */

import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/instrument-sans/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { commands, page } from "vitest/browser";
import type { Food, LogDay } from "@/lib/food-api";
import { logCard } from "@/lib/log-card";
import { applyTheme, PALETTE_KEY, THEME_KEY, type Theme } from "@/lib/theme";
import { notePath } from "@/lib/todo-commands";
import { COARSE, NARROW, stubMatchMedia } from "../match-media";
import { shot } from "./shots";
import "@/styles/app.css";

const LOG_CONFIG = "99 Misc/01 Config/log.md";
const DAILY = "01 Periodic/00 Daily/2026-10-20.md";

const CONFIG = [
  "---",
  "type: Config",
  "---",
  "- 💧 water: 250 ml, min 2000",
  "- ☕ coffee: 1, max 3",
  "- 🍵 tea: 1 cup",
  "- 🍽 food: kcal max 2200, protein min 120, carbs max 250, fat max 70",
].join("\n");

const FOODS = [
  "---",
  "type: Config",
  "---",
  "- Oat porridge: 60 g, 🔥 370 🥩 12 🍞 60 🧈 7",
  "- Protein shake: 330 g, 🔥 120 🥩 24 🍞 4 🧈 2",
].join("\n");

/** Open Food Facts answers two hits for any query. */
const OFF: Food[] = [
  {
    code: "5411188112211",
    name: "Oat milk",
    brand: "Oatly",
    serving_g: 250,
    serving_from: "default",
    per_100g: { kcal: 46, protein: 1, carbs: 6.7, fat: 1.5 },
    per_serving: { kcal: 115, protein: 2.5, carbs: 16.8, fat: 3.8 },
  },
  {
    code: "8714100770009",
    name: "Oat flakes",
    brand: null,
    serving_g: 40,
    serving_from: "serving_quantity",
    per_100g: { kcal: 372, protein: 13, carbs: 59, fat: 7 },
    per_serving: { kcal: 149, protein: 5.2, carbs: 23.6, fat: 2.8 },
  },
];

/** Yesterday's dinner, which the card offers to copy into today's empty dinner. */
const YESTERDAY_DAY: LogDay = {
  date: "2026-10-19",
  path: "01 Periodic/00 Daily/2026-10-19.md",
  entries: [
    {
      line: 14,
      text: "- 🍽 dinner: Oat bowl 🔥 510 kcal 🥩 18 g 🍞 62 g 🧈 14 g",
      kind: "food",
      meal: "dinner",
      words: "Oat bowl",
      kcal: 510,
      protein: 18,
      carbs: 62,
      fat: 14,
    },
    {
      line: 15,
      text: "- 🍽 dinner: Salmon 🔥 420 kcal 🥩 38 g",
      kind: "food",
      meal: "dinner",
      words: "Salmon",
      kcal: 420,
      protein: 38,
    },
  ],
  totals: {
    water: { ml: 0 },
    coffee: { count: 0 },
    alcohol: { count: 0, ml: 0, grams: 0 },
    food: { kcal: 930, protein: 56, carbs: 62, fat: 14 },
    mine: [],
  },
};

// The mocks read these lazily, inside their bodies, because `vi.mock` is hoisted
// above the constants and a factory that reads one at load meets its temporal dead zone.
vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    fetchNote: async (path: string) => {
      if (path === LOG_CONFIG) return CONFIG;
      throw new real.NoteMissing(path);
    },
  };
});

vi.mock("@/lib/food-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/food-api")>()),
  searchFood: async () => OFF,
  // A pick reads its food again by barcode, so the read answers from the same two hits.
  readBarcode: async (code: string) => OFF.find((food) => food.code === code) ?? OFF[0],
  fetchLog: async () => [YESTERDAY_DAY],
}));

vi.mock("@/lib/my-foods", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/my-foods")>();
  return { ...real, fetchMyFoods: async () => real.parseMyFoods(FOODS) };
});

/** A note with the given lines under its Log heading. */
function note(lines: string[]): string {
  return [
    "# 2026-10-20 Tuesday",
    "",
    "[[01 Periodic/00 Daily/2026-10-19]] | [[01 Periodic/00 Daily/2026-10-21]]",
    "",
    "## Log",
    ...lines,
    "",
    "## Done",
  ].join("\n");
}

const FULL_DAY = note([
  "- 💧 500 ml",
  "- ☕ 1",
  "- 🍵 1 cup",
  "- 🍽 breakfast: Oats 🔥 320 kcal 🥩 12 g 🍞 54 g 🧈 6 g",
  "- 🍽 lunch: Skyr 🔥 160 kcal 🥩 27 g",
  "- 🍽 snack: Apple 🔥 95 kcal",
]);

const EMPTY_DAY = note([]);

// Past the kcal max (2200) and the fat max (70): 575 kcal and 6 g fat eaten before the pizza.
const OVER_DAY = note([
  "- 💧 500 ml",
  "- ☕ 1",
  "- 🍵 1 cup",
  "- 🍽 breakfast: Oats 🔥 320 kcal 🥩 12 g 🍞 54 g 🧈 6 g",
  "- 🍽 lunch: Skyr 🔥 160 kcal 🥩 27 g",
  "- 🍽 snack: Apple 🔥 95 kcal",
  "- 🍽 dinner: Pizza 🔥 2000 kcal 🥩 40 g 🍞 120 g 🧈 80 g",
]);

// Fat at exactly 70 once the cheese is in, so the serving step's Oat flakes takes it past the max.
const FAT_DAY = note([
  "- 💧 500 ml",
  "- ☕ 1",
  "- 🍵 1 cup",
  "- 🍽 breakfast: Oats 🔥 320 kcal 🥩 12 g 🍞 54 g 🧈 6 g",
  "- 🍽 lunch: Skyr 🔥 160 kcal 🥩 27 g",
  "- 🍽 snack: Apple 🔥 95 kcal",
  "- 🍽 dinner: Cheese 🔥 400 kcal 🥩 25 g 🧈 64 g",
]);

interface Mounted {
  host: HTMLElement;
  view: EditorView;
}

let live: Mounted | undefined;

afterEach(async () => {
  live?.view.destroy();
  live?.host.remove();
  live = undefined;
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-palette");
  vi.unstubAllGlobals();
  await commands.emulateMedia({});
});

/** The theme and the palette, stored the way the app stores a pick, and applied. */
function setLook(theme: Theme, palette = "poel"): void {
  localStorage.setItem(THEME_KEY, theme);
  localStorage.setItem(PALETTE_KEY, palette);
  applyTheme();
}

/** The note in a box of this size, with its card drawn. */
async function mount(width: number, height: number, doc: string): Promise<Mounted> {
  const host = document.body.appendChild(document.createElement("div"));
  host.className = "bg-k-bg";
  host.style.cssText = `position: relative; overflow: hidden; width: ${width}px; height: ${height}px;`;
  const view = new EditorView({
    state: EditorState.create({
      doc,
      // As the app mounts it: a long wikilink line wraps, rather than widening the card.
      extensions: [notePath.of(DAILY), logCard, EditorView.lineWrapping],
    }),
    parent: host,
  });
  const mounted = { host, view };
  live = mounted;
  await expect.poll(() => view.dom.querySelector(".cm-log button")).not.toBeNull();
  return mounted;
}

/** The note at a phone's size, touch on, in the theme asked for. */
async function phone(
  doc: string,
  theme: Theme = "light",
  motion: "reduce" | "no-preference" = "no-preference",
): Promise<Mounted> {
  await page.viewport(390, 844);
  stubMatchMedia({ [NARROW]: true, [COARSE]: true });
  await commands.emulateMedia({ touch: true, reducedMotion: motion });
  setLook(theme);
  return mount(390, 844, doc);
}

/** The note at a desktop's size with a mouse, in the theme and palette asked for. */
async function desktop(doc: string, theme: Theme, palette = "poel"): Promise<Mounted> {
  await page.viewport(1440, 900);
  setLook(theme, palette);
  return mount(1440, 900, doc);
}

/** The card's element, or a failure where the note draws none. */
function cardOf(host: HTMLElement): HTMLElement {
  const card = host.querySelector<HTMLElement>(".cm-log");
  if (!card) throw new Error("the note draws no log card");
  return card;
}

/** Presses the card's 🍽 button and waits for the food search's query field. */
async function openFood(view: EditorView): Promise<void> {
  view.dom.querySelector<HTMLButtonElement>(".cm-log button[aria-label='Log food']")?.click();
  await expect.poll(() => view.dom.querySelector(".cm-log-food-query")).not.toBeNull();
}

/** Types into the search's query the way a keyboard does, then waits for Open Food Facts to answer. */
async function search(view: EditorView, host: HTMLElement, text: string): Promise<void> {
  const query = view.dom.querySelector<HTMLInputElement>(".cm-log-food-query");
  expect(query).not.toBeNull();
  if (query) {
    query.value = text;
    query.dispatchEvent(new Event("input", { bubbles: true }));
  }
  await expect.poll(() => host.textContent ?? "", { timeout: 5000 }).toContain("Oat milk");
}

/** Presses the result row whose text holds `name`, then waits for its serving preview. */
async function pickRow(view: EditorView, name: string): Promise<void> {
  const row = [...view.dom.querySelectorAll<HTMLButtonElement>(".cm-log-food-results button")].find(
    (button) => (button.textContent ?? "").includes(name),
  );
  expect(row, name).toBeDefined();
  row?.click();
  await expect
    .poll(() => view.dom.querySelector(".cm-log-food-preview")?.textContent ?? "")
    .toContain("kcal");
}

/** Presses the card's copy of yesterday's dinner, and waits for its lines in the note. */
async function copyYesterday(view: EditorView): Promise<void> {
  const copy = () =>
    [...view.dom.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      /yesterday/i.test(button.textContent ?? ""),
    );
  await expect.poll(() => copy()).toBeDefined();
  copy()?.click();
  await expect.poll(() => view.state.doc.toString()).toContain("dinner: Oat bowl");
}

/** The food search's sheet on a phone, or null where it is not drawn. */
function sheetOf(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[role='dialog'][aria-label='Food search']");
}

it("shot phone-full-day", async () => {
  const { host } = await phone(FULL_DAY);
  expect(await shot(cardOf(host), "phone-full-day")).toBeGreaterThan(0);
});

it("shot phone-empty-day", async () => {
  const { host } = await phone(EMPTY_DAY);
  await expect.poll(() => cardOf(host).textContent ?? "").toMatch(/yesterday/i);
  expect(await shot(cardOf(host), "phone-empty-day")).toBeGreaterThan(0);
});

it("shot phone-search-sections", async () => {
  const { host, view } = await phone(FULL_DAY);
  await openFood(view);
  await search(view, host, "oat");
  expect(await shot(host, "phone-search-sections")).toBe(390);
});

it("shot phone-serving", async () => {
  const { host, view } = await phone(FULL_DAY);
  await openFood(view);
  await search(view, host, "oat");
  await pickRow(view, "Oat flakes");
  expect(await shot(host, "phone-serving")).toBe(390);
});

it("shot phone-over-goal", async () => {
  const { host } = await phone(OVER_DAY);
  expect(await shot(cardOf(host), "phone-over-goal")).toBeGreaterThan(0);
});

it("shot phone-serving-over", async () => {
  const { host, view } = await phone(FAT_DAY);
  await openFood(view);
  await search(view, host, "oat");
  await pickRow(view, "Oat flakes");
  expect(await shot(host, "phone-serving-over")).toBe(390);
});

it("shot phone-quick-add", async () => {
  const { host, view } = await phone(FULL_DAY);
  await openFood(view);
  // The sheet's own quick add field, not the card's amount field.
  const kcal = document.querySelector<HTMLInputElement>("input[aria-label='Quick add kcal']");
  expect(kcal).not.toBeNull();
  if (kcal) {
    kcal.value = "250";
    kcal.dispatchEvent(new Event("input", { bubbles: true }));
  }
  expect(await shot(host, "phone-quick-add")).toBe(390);
});

it("shot phone-copy-yesterday", async () => {
  const { host, view } = await phone(EMPTY_DAY);
  await copyYesterday(view);
  expect(await shot(cardOf(host), "phone-copy-yesterday")).toBeGreaterThan(0);
});

it("shot phone-raw-fold", async () => {
  const { host, view } = await phone(FULL_DAY);
  const raw = view.dom.querySelector<HTMLDetailsElement>(".cm-log-raw");
  expect(raw).not.toBeNull();
  raw?.querySelector("summary")?.click();
  await expect.poll(() => raw?.open).toBe(true);
  expect(await shot(cardOf(host), "phone-raw-fold")).toBeGreaterThan(0);
});

it("shot phone-dark-full-day", async () => {
  const { host } = await phone(FULL_DAY, "dark");
  expect(await shot(cardOf(host), "phone-dark-full-day")).toBeGreaterThan(0);
});

it("shot phone-reduced-motion-sheet", async () => {
  const { host, view } = await phone(FULL_DAY, "light", "reduce");
  await openFood(view);
  const sheet = sheetOf();
  expect(sheet).not.toBeNull();
  await expect.poll(() => Number(getComputedStyle(sheetOf() ?? document.body).opacity)).toBe(1);
  expect(await shot(host, "phone-reduced-motion-sheet")).toBe(390);
});

it("shot desktop-card-light", async () => {
  const { host } = await desktop(FULL_DAY, "light");
  expect(await shot(host, "desktop-card-light")).toBe(1440);
});

it("shot desktop-card-dark", async () => {
  const { host } = await desktop(FULL_DAY, "dark");
  expect(await shot(host, "desktop-card-dark")).toBe(1440);
});

it("shot desktop-panel-light", async () => {
  const { host, view } = await desktop(FULL_DAY, "light");
  await openFood(view);
  await search(view, host, "oat");
  expect(await shot(host, "desktop-panel-light")).toBe(1440);
});

it("shot desktop-panel-dark", async () => {
  const { host, view } = await desktop(FULL_DAY, "dark");
  await openFood(view);
  await search(view, host, "oat");
  expect(await shot(host, "desktop-panel-dark")).toBe(1440);
});

for (const [palette, theme] of [
  ["poel", "light"],
  ["russet", "light"],
  ["peach", "light"],
  ["pansy", "dark"],
] as const) {
  it(`shot palette-${palette}`, async () => {
    const { host } = await desktop(FULL_DAY, theme, palette);
    expect(await shot(host, `palette-${palette}`)).toBe(1440);
  });
}
