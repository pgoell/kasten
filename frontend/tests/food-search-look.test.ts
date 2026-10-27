import { readFileSync } from "node:fs";
import path from "node:path";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchNote, NoteMissing } from "@/lib/api";
import { type Food, fetchLog, type LogDay, readBarcode, searchFood } from "@/lib/log/food-api";
import { logCard, reloadLogConfig } from "@/lib/log/log-card";
import { parseFood } from "@/lib/log/log-lines";
import { fetchMyFoods, type MyFood } from "@/lib/log/my-foods";
import { notePath } from "@/lib/todo/todo-commands";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  fetchNote: vi.fn(),
}));
vi.mock("@/lib/log/food-api", () => ({
  searchFood: vi.fn(),
  readBarcode: vi.fn(),
  fetchLog: vi.fn(),
}));
vi.mock("@/lib/log/my-foods", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log/my-foods")>()),
  fetchMyFoods: vi.fn(),
  addMyFood: vi.fn(),
}));

const DAILY = "01 Periodic/00 Daily/2026-10-20.md";
const LOG = "99 Misc/01 Config/log.md";
const NOTE = "# 2026-10-20 Tuesday\n\n## Log\n- 💧 500 ml\n\n## Done\n- [ ] write";
/** The same day with a breakfast already logged: 1000 kcal and 40 g of protein eaten. */
const EATEN =
  "# 2026-10-20 Tuesday\n\n## Log\n- 🍽 breakfast: Oats 🔥 1000 kcal 🥩 40 g\n\n## Done\n- [ ] write";
const SKYR_LINE = "- 🍽 lunch: Skyr naturel (Skyr) 150 g 🔥 90 kcal 🥩 15 g 🍞 6 g 🧈 0 g";

/** A food of your own, which the Mine section lists for a query it matches. */
const MINE: MyFood = {
  name: "Skyr mix",
  serving_g: 200,
  code: null,
  per_100g: { kcal: 70, protein: 9, carbs: 5, fat: 1 },
};

/** A food Open Food Facts answers a search with: a hit with no serving, so 100 g. */
const HIT: Food = {
  code: "3017620422003",
  name: "Skyr",
  brand: null,
  serving_g: 100,
  serving_from: "default",
  per_100g: { kcal: 63, protein: 11, carbs: 4, fat: 0.2 },
  per_serving: { kcal: 63, protein: 11, carbs: 4, fat: 0.2 },
};

/** Yesterday's Skyr, which the Recent section lists: a line that names its 150 g. */
const SKYR_DAY = {
  date: "2026-10-19",
  path: "01 Periodic/00 Daily/2026-10-19.md",
  entries: [
    {
      line: 5,
      text: SKYR_LINE,
      kind: "food",
      meal: "lunch",
      words: "Skyr naturel (Skyr) 150 g",
      kcal: 90,
      protein: 15,
      carbs: 6,
      fat: 0,
    },
  ],
} as unknown as LogDay;

const mounted: EditorView[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  // Lunch by the hour, so the meal a quick add writes is known.
  vi.setSystemTime(new Date(2026, 9, 20, 12, 30));
  vi.mocked(searchFood).mockReset().mockResolvedValue([]);
  vi.mocked(readBarcode).mockReset().mockResolvedValue(HIT);
  vi.mocked(fetchLog).mockReset().mockResolvedValue([]);
  vi.mocked(fetchMyFoods).mockReset().mockResolvedValue({ foods: [], broken: [] });
  // A vault with no config note: the card draws its defaults, with no food goals.
  vi.mocked(fetchNote).mockReset().mockRejectedValue(new NoteMissing(LOG));
});

afterEach(() => {
  for (const view of mounted.splice(0)) {
    view.destroy();
    view.dom.parentElement?.remove();
  }
  vi.useRealTimers();
});

/** A view on `doc` with the card and `extra`. */
function mount(doc: string, note = DAILY, extra: Extension[] = []): EditorView {
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [notePath.of(note), logCard, ...extra],
    }),
    parent,
  });
  mounted.push(view);
  return view;
}

const text = (view: EditorView) => view.state.doc.toString();
const whyOf = (view: EditorView) => view.dom.querySelector(".cm-log-food-why")?.textContent ?? "";
const titles = (view: EditorView) =>
  [...view.dom.querySelectorAll(".cm-log-food-section-title")].map((el) => el.textContent);

/** The field, button or select with this selector, or a failed expectation where the card shows none. */
function need<T extends Element>(view: EditorView, selector: string): T {
  const found = view.dom.querySelector<T>(selector);
  expect(found, selector).not.toBeNull();
  return found as T;
}

/** Presses the card's 🍽 button, and lets the card draw the sheet it opens. */
async function openFood(view: EditorView): Promise<void> {
  need<HTMLButtonElement>(view, ".cm-log button[aria-label='Log food']").click();
  await vi.advanceTimersByTimeAsync(0);
}

/** Presses the first row of the results, and lets the answer come back. */
async function pickFirst(view: EditorView): Promise<void> {
  need<HTMLButtonElement>(view, ".cm-log-food-results button").click();
  await vi.advanceTimersByTimeAsync(0);
}

/** Types a kcal into the quick add and presses its Add. */
function quickAdd(view: EditorView, kcal: string): void {
  fireEvent.input(need(view, "input[aria-label='Quick add kcal']"), { target: { value: kcal } });
  need<HTMLButtonElement>(view, "button[aria-label='Quick add']").click();
}

/** The serving chip with this label. */
function chip(view: EditorView, label: string): HTMLButtonElement {
  const found = [...view.dom.querySelectorAll<HTMLButtonElement>(".cm-log-food-chip")].find(
    (button) => button.textContent === label,
  );
  expect(found, label).toBeDefined();
  return found as HTMLButtonElement;
}

it("#803 A10 results come in sections mine, recent, Open Food Facts in that order", async () => {
  vi.mocked(fetchMyFoods).mockResolvedValue({ foods: [MINE], broken: [] });
  vi.mocked(fetchLog).mockResolvedValue([SKYR_DAY]);
  vi.mocked(searchFood).mockResolvedValue([HIT]);
  const view = mount(NOTE);
  await openFood(view);
  await vi.advanceTimersByTimeAsync(0);
  fireEvent.input(need(view, ".cm-log-food-query"), { target: { value: "skyr" } });
  // Open Food Facts has not answered yet, so its section is not drawn.
  expect(titles(view)).toEqual(["Mine", "Recent"]);
  await vi.advanceTimersByTimeAsync(400);
  expect(titles(view)).toEqual(["Mine", "Recent", "Open Food Facts"]);
});

it("#803 A11 quick add writes - 🍽 <meal>: 🔥 250 kcal under the meal of the hour", async () => {
  const view = mount(NOTE);
  await openFood(view);
  quickAdd(view, "250");
  expect(text(view)).toContain("\n- 🍽 lunch: 🔥 250 kcal\n");
});

it("#803 A11 the quick add meal picker changes the meal written", async () => {
  const view = mount(NOTE);
  await openFood(view);
  fireEvent.change(need(view, "select[aria-label='Quick add meal']"), {
    target: { value: "dinner" },
  });
  quickAdd(view, "250");
  expect(text(view)).toContain("\n- 🍽 dinner: 🔥 250 kcal\n");
});

it("#803 I6 quick add of zero, a negative, text or ten digits writes nothing and says why", async () => {
  const view = mount(NOTE);
  await openFood(view);
  for (const typed of ["0", "-5", "abc", "1234567890"]) {
    quickAdd(view, typed);
    expect(text(view)).toBe(NOTE);
    expect(whyOf(view), typed).not.toBe("");
  }
});

it("#803 A16 the preview says over in words when a serving passes a max goal", async () => {
  // Breakfast already eaten 65 g of fat, against a ceiling of 70 g.
  const FAT_EATEN =
    "# 2026-10-20 Tuesday\n\n## Log\n- 🍽 breakfast: Butter 🔥 500 kcal 🧈 65 g\n\n## Done\n- [ ] write";
  vi.mocked(fetchNote).mockResolvedValue("- 🍽 food: fat max 70\n");
  reloadLogConfig();
  // A cheese of 8 g of fat takes the day to 73 g: three grams over.
  const CHEESE = {
    date: "2026-10-19",
    path: "01 Periodic/00 Daily/2026-10-19.md",
    entries: [
      {
        line: 5,
        text: "- 🍽 lunch: Cheese 100 g 🔥 300 kcal 🥩 25 g 🍞 1 g 🧈 8 g",
        kind: "food",
        meal: "lunch",
        words: "Cheese 100 g",
        kcal: 300,
        protein: 25,
        carbs: 1,
        fat: 8,
      },
    ],
  } as unknown as LogDay;
  vi.mocked(fetchLog).mockResolvedValue([CHEESE]);
  const view = mount(FAT_EATEN);
  await openFood(view);
  await vi.advanceTimersByTimeAsync(0);
  await pickFirst(view);
  expect(need(view, ".cm-log-food-preview").textContent).toContain(
    "Fat 8 g, 3 g over, at most 70 g",
  );
});

it("#803 I6 quick add of 999999999.5 writes nothing and says why", async () => {
  const view = mount(NOTE);
  await openFood(view);
  quickAdd(view, "999999999.5");
  expect(text(view)).toBe(NOTE);
  expect(whyOf(view)).not.toBe("");
});

it("#803 A12 the amount chips set grams or servings", async () => {
  vi.mocked(fetchLog).mockResolvedValue([SKYR_DAY]);
  const view = mount(NOTE);
  await openFood(view);
  await vi.advanceTimersByTimeAsync(0);
  await pickFirst(view);

  expect(
    [...view.dom.querySelectorAll(".cm-log-food-chip")].map((button) => button.textContent),
  ).toEqual(["100 g", "150 g", "1 serving", "250 g"]);
  expect(view.dom.querySelectorAll(".cm-log-food-meal option")).toHaveLength(4);

  chip(view, "100 g").click();
  expect(need<HTMLInputElement>(view, ".cm-log-food-grams").value).toBe("100");
  expect(need<HTMLInputElement>(view, ".cm-log-food-servings").value).toBe("0.67");

  chip(view, "1 serving").click();
  expect(need<HTMLInputElement>(view, ".cm-log-food-servings").value).toBe("1");
  expect(need<HTMLInputElement>(view, ".cm-log-food-grams").value).toBe("150");

  chip(view, "250 g").click();
  expect(need<HTMLInputElement>(view, ".cm-log-food-grams").value).toBe("250");
  expect(need<HTMLInputElement>(view, ".cm-log-food-servings").value).toBe("1.67");
});

it("#803 A13 the preview shows kcal, kcal left after and the exact line in mono", async () => {
  vi.mocked(fetchNote).mockResolvedValue("- 🍽 food: kcal max 2000, protein min 120\n");
  reloadLogConfig();
  vi.mocked(fetchLog).mockResolvedValue([SKYR_DAY]);
  const view = mount(EATEN);
  await vi.advanceTimersByTimeAsync(0);
  await openFood(view);
  await vi.advanceTimersByTimeAsync(0);
  await pickFirst(view);

  expect(need(view, ".cm-log-food-kcal-big").textContent).toBe("🔥 90 kcal");
  // 2000 goal, 1000 eaten and this 90.
  expect(need(view, ".cm-log-food-left").textContent).toBe("kcal left after: 910");
  expect(need(view, ".cm-log-food-preview").textContent).toContain(
    "Protein 15 g of 120 g, at least",
  );
  expect(need(view, ".cm-log-food-line").textContent).toBe(SKYR_LINE);
  // The line is set in the mono face, which the stylesheet names for it.
  const css = readFileSync(
    path.resolve(import.meta.dirname, "../src/styles/food-sheet.css"),
    "utf8",
  );
  expect(css).toMatch(/\.cm-log-food-line\s*\{[^}]*font-family:\s*var\(--k-mono\)/);
});

it("#803 A17 every line the search writes parses back to its fields by log-cases.json rules", async () => {
  vi.mocked(fetchLog).mockResolvedValue([SKYR_DAY]);
  const view = mount(NOTE);
  await openFood(view);
  await vi.advanceTimersByTimeAsync(0);
  await pickFirst(view);
  need<HTMLButtonElement>(view, "button[aria-label='Log this food']").click();
  const food = text(view)
    .split("\n")
    .find((line) => line.startsWith("- 🍽 lunch: Skyr"));
  expect(food).toBe(SKYR_LINE);
  expect(parseFood(SKYR_LINE)).toMatchObject({
    kind: "food",
    meal: "lunch",
    words: "Skyr naturel (Skyr) 150 g",
    kcal: 90,
    protein: 15,
    carbs: 6,
    fat: 0,
  });

  await openFood(view);
  quickAdd(view, "250");
  const quick = text(view)
    .split("\n")
    .find((line) => line.endsWith("🔥 250 kcal"));
  expect(quick).toBe("- 🍽 lunch: 🔥 250 kcal");
  expect(parseFood(quick ?? "")).toMatchObject({ kind: "food", meal: "lunch", kcal: 250 });
});
