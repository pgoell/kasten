import { history, undo } from "@codemirror/commands";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Food, fetchLog, type LogDay, readBarcode, searchFood } from "@/lib/food-api";
import { logCard } from "@/lib/log-card";
import { drinkTotals } from "@/lib/log-lines";
import { notePath } from "@/lib/todo-commands";
import { vimKeys, vimModeField, vimModeState } from "@/lib/vim-mode";

vi.mock("@/lib/food-api", () => ({
  searchFood: vi.fn(),
  readBarcode: vi.fn(),
  fetchLog: vi.fn(),
}));

const DAILY = "01 Periodic/00 Daily/2026-10-20.md";
const NOTE = "# 2026-10-20 Tuesday\n\n## Log\n- 💧 500 ml\n\n## Done\n- [ ] write";

const mounted: EditorView[] = [];

afterEach(() => {
  for (const view of mounted.splice(0)) {
    view.destroy();
    view.dom.parentElement?.remove();
  }
});

/** A view on `doc` with the card and `extra`, the cursor at `anchor`. */
function mount(doc: string, path = DAILY, extra: Extension[] = [], anchor = 0): EditorView {
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [notePath.of(path), history(), logCard, ...extra],
    }),
    parent,
  });
  mounted.push(view);
  return view;
}

const text = (view: EditorView) => view.state.doc.toString();
const totals = (view: EditorView) => view.dom.querySelector(".cm-log-totals")?.textContent ?? "";

/** Presses the card's button with this aria-label, or fails the test where there is none. */
function press(view: EditorView, label: string): void {
  const found = view.dom.querySelector<HTMLButtonElement>(`.cm-log button[aria-label='${label}']`);
  if (found === null) throw new Error(`no ${label} button on the card`);
  found.click();
}

/** A Snickers as the barcode read answers it: one serving of 50 g, and what that serving holds. */
const SNICKERS: Food = {
  code: "5000159461122",
  name: "Snickers",
  brand: "Mars Wrigley Confectionery UK Limited",
  serving_g: 50,
  serving_from: "serving_quantity",
  per_100g: { kcal: 481, protein: 8.6, carbs: 60.5, fat: 22.5 },
  per_serving: { kcal: 240, protein: 4.3, carbs: 30.2, fat: 11.2 },
};

/** The same product as a search answers it: no serving, so the grams are the default 100. */
const HIT: Food = {
  ...SNICKERS,
  serving_g: 100,
  serving_from: "default",
  per_serving: { kcal: 481, protein: 8.6, carbs: 60.5, fat: 22.5 },
};

const foodQuery = (view: EditorView) =>
  view.dom.querySelector<HTMLInputElement>(".cm-log-food-query");
const foodWhy = (view: EditorView) => view.dom.querySelector(".cm-log-food-why")?.textContent;
const foodResults = (view: EditorView) =>
  view.dom.querySelector(".cm-log-food-results")?.textContent ?? "";
const previewOf = (view: EditorView) =>
  view.dom.querySelector(".cm-log-food-preview")?.textContent ?? "";

/** The panel's query, or a failed expectation where the panel is not open. */
function queryOf(view: EditorView): HTMLInputElement {
  const query = foodQuery(view);
  expect(query).not.toBeNull();
  return query as HTMLInputElement;
}

/** A field of the serving form, or a failed expectation where the form is not shown. */
function formField(view: EditorView, selector: string): HTMLInputElement {
  const field = view.dom.querySelector<HTMLInputElement>(selector);
  expect(field).not.toBeNull();
  return field as HTMLInputElement;
}

/** The words a form field's label reads, or a failed expectation where the field is not shown. */
function formLabel(view: EditorView, selector: string): string {
  const label = formField(view, selector).closest("label");
  expect(label).not.toBeNull();
  return label?.textContent?.trim() ?? "";
}

/** Presses the card's 🍽 button, or fails the test where there is none. */
function openFood(view: EditorView): void {
  const button = view.dom.querySelector<HTMLButtonElement>(".cm-log button[aria-label='Log food']");
  expect(button).not.toBeNull();
  button?.click();
}

/** Types `text` into the open panel, and lets the pause pass so the search is sent. */
async function typeQuery(view: EditorView, text: string): Promise<void> {
  fireEvent.input(queryOf(view), { target: { value: text } });
  await vi.advanceTimersByTimeAsync(400);
}

/** Presses the first result, and lets the barcode read answer. */
async function pickFirst(view: EditorView): Promise<void> {
  const first = view.dom.querySelector<HTMLButtonElement>(".cm-log-food-results button");
  expect(first).not.toBeNull();
  first?.click();
  await vi.advanceTimersByTimeAsync(0);
}

function logFood(view: EditorView): void {
  const button = view.dom.querySelector<HTMLButtonElement>("button[aria-label='Log this food']");
  expect(button).not.toBeNull();
  button?.click();
}

describe("the food search", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Lunch by the hour, so the meal every test logs under is known.
    vi.setSystemTime(new Date(2026, 9, 20, 12, 30));
    vi.mocked(searchFood).mockReset().mockResolvedValue([HIT]);
    vi.mocked(readBarcode).mockReset().mockResolvedValue(SNICKERS);
    vi.mocked(fetchLog).mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("#621 the 🍽 button opens the food search", () => {
    const view = mount(NOTE);
    openFood(view);
    expect(document.activeElement).toBe(queryOf(view));
  });

  it("#621 typing a word sends one search after the pause", async () => {
    const view = mount(NOTE);
    openFood(view);
    fireEvent.input(queryOf(view), { target: { value: "sn" } });
    await vi.advanceTimersByTimeAsync(100);
    fireEvent.input(queryOf(view), { target: { value: "snickers" } });
    await vi.advanceTimersByTimeAsync(399);
    expect(searchFood).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(searchFood).toHaveBeenCalledTimes(1);
    expect(searchFood).toHaveBeenCalledWith("snickers");
  });

  it("#621 a refusal from Open Food Facts shows in plain words", async () => {
    const refusal =
      "Open Food Facts refused the request (too many requests or busy); try again in a minute";
    vi.mocked(searchFood).mockRejectedValueOnce(new Error(refusal));
    const view = mount(NOTE);
    openFood(view);
    await typeQuery(view, "snickers");
    expect(foodWhy(view)).toBe(refusal);
  });

  it("#621 a pick reads the barcode for its serving and shows per-serving values", async () => {
    const view = mount(NOTE);
    openFood(view);
    await typeQuery(view, "snickers");
    expect(foodResults(view)).toContain("481 kcal per 100 g");
    await pickFirst(view);
    expect(formLabel(view, ".cm-log-food-grams")).toBe("g");
    expect(formLabel(view, ".cm-log-food-servings")).toBe("servings");
    expect(readBarcode).toHaveBeenCalledWith(SNICKERS.code);
    expect(formField(view, ".cm-log-food-grams").value).toBe("50");
    expect(previewOf(view)).toContain("🔥 240 kcal");
  });

  it("#621 changing grams or servings changes kcal and macros", async () => {
    const view = mount(NOTE);
    openFood(view);
    await typeQuery(view, "snickers");
    await pickFirst(view);
    fireEvent.input(formField(view, ".cm-log-food-grams"), { target: { value: "100" } });
    expect(formField(view, ".cm-log-food-servings").value).toBe("2");
    expect(previewOf(view)).toContain("🔥 480 kcal");
    fireEvent.input(formField(view, ".cm-log-food-servings"), { target: { value: "0.5" } });
    expect(formField(view, ".cm-log-food-grams").value).toBe("25");
    expect(previewOf(view)).toContain("🔥 120 kcal");
  });

  it("#621 Log writes one food line at the end of ## Log and the card totals count it", async () => {
    const view = mount(NOTE);
    openFood(view);
    await typeQuery(view, "snickers");
    await pickFirst(view);
    logFood(view);
    expect(text(view)).toBe(
      "# 2026-10-20 Tuesday\n\n## Log\n- 💧 500 ml\n- 🍽 lunch: Snickers (Mars Wrigley Confectionery UK Limited) 50 g 🔥 240 kcal 🥩 4.3 g 🍞 30.2 g 🧈 11.2 g\n\n## Done\n- [ ] write",
    );
    expect(drinkTotals(text(view)).food.kcal).toBe(240);
    expect(totals(view)).toContain("🔥 240 kcal");
  });

  it("#621 the meal defaults by the hour", async () => {
    const cases: [number, number, string][] = [
      [8, 0, "breakfast"],
      [12, 30, "lunch"],
      [19, 0, "dinner"],
      [23, 0, "snack"],
    ];
    for (const [hour, minute, meal] of cases) {
      vi.setSystemTime(new Date(2026, 9, 20, hour, minute));
      const view = mount(NOTE);
      openFood(view);
      await typeQuery(view, "snickers");
      await pickFirst(view);
      expect(formField(view, ".cm-log-food-meal").value).toBe(meal);
    }
  });

  it("#621 recent foods from the last 30 days show first, with no Open Food Facts call", async () => {
    const days = [
      {
        date: "2026-10-19",
        path: "01 Periodic/00 Daily/2026-10-19.md",
        entries: [
          {
            line: 5,
            text: "- 🍽 lunch: Skyr naturel (Skyr) 150 g 🔥 90 kcal 🥩 15 g 🍞 6 g 🧈 0 g",
            kind: "food",
            meal: "lunch",
            words: "Skyr naturel (Skyr) 150 g",
            kcal: 90,
            protein: 15,
            carbs: 6,
            fat: 0,
          },
        ],
      },
    ];
    vi.mocked(fetchLog).mockResolvedValue(days as unknown as LogDay[]);
    const view = mount(NOTE);
    openFood(view);
    await vi.advanceTimersByTimeAsync(0);
    const first = view.dom.querySelector<HTMLButtonElement>(".cm-log-food-results button");
    expect(first?.textContent).toContain("Skyr naturel (Skyr)");
    expect(first?.textContent).toContain("recent");
    first?.click();
    fireEvent.input(formField(view, ".cm-log-food-grams"), { target: { value: "300" } });
    logFood(view);
    expect(text(view)).toContain(
      "- 🍽 lunch: Skyr naturel (Skyr) 300 g 🔥 180 kcal 🥩 30 g 🍞 12 g 🧈 0 g\n",
    );
    expect(fetchLog).toHaveBeenCalledWith("2026-09-20", "2026-10-20");
    expect(searchFood).not.toHaveBeenCalled();
    expect(readBarcode).not.toHaveBeenCalled();
  });

  it("#621 with vim on, keys typed in the search field never reach vim and u takes the food line back", async () => {
    const view = mount(NOTE, DAILY, [vim(), vimModeState()]);
    openFood(view);
    const query = queryOf(view);
    fireEvent.keyDown(query, { key: "i" });
    fireEvent.keyDown(query, { key: "u" });
    expect(view.state.field(vimModeField)).toBe("normal");
    expect(text(view)).toBe(NOTE);
    await typeQuery(view, "snickers");
    await pickFirst(view);
    logFood(view);
    expect(text(view)).not.toBe(NOTE);
    fireEvent.keyDown(view.contentDOM, { key: "u" });
    expect(text(view)).toBe(NOTE);
  });

  it("#621 with vim off, undo takes a food line back and the card's Undo too", async () => {
    const view = mount(NOTE, DAILY, [vimKeys.of(false)]);
    openFood(view);
    await typeQuery(view, "snickers");
    await pickFirst(view);
    logFood(view);
    undo(view);
    expect(text(view)).toBe(NOTE);
    openFood(view);
    await typeQuery(view, "snickers");
    await pickFirst(view);
    logFood(view);
    const undoButton = view.dom.querySelector<HTMLButtonElement>(".cm-log-undo");
    expect(undoButton).not.toBeNull();
    undoButton?.click();
    expect(text(view)).toBe(NOTE);
  });

  it("#621 grams of zero, negative or text write nothing and say why", async () => {
    const view = mount(NOTE);
    openFood(view);
    await typeQuery(view, "snickers");
    await pickFirst(view);
    const refusals: [string, string][] = [
      ["0", "grams must be a number above zero"],
      ["-5", "grams must be a number above zero"],
      ["abc", "grams must be a number above zero"],
      ["99999999999", "grams must be at most 5000"],
    ];
    for (const [typed, message] of refusals) {
      fireEvent.input(formField(view, ".cm-log-food-grams"), { target: { value: typed } });
      logFood(view);
      expect(text(view)).toBe(NOTE);
      expect(foodWhy(view)).toBe(message);
    }
  });

  it("#621 a slower earlier search answer never replaces a later one", async () => {
    let answerFirst: (foods: Food[]) => void = () => {};
    vi.mocked(searchFood)
      .mockReturnValueOnce(
        new Promise<Food[]>((resolve) => {
          answerFirst = resolve;
        }),
      )
      .mockResolvedValueOnce([{ ...HIT, code: "3017620422003", name: "Skyr", brand: null }]);
    const view = mount(NOTE);
    openFood(view);
    await typeQuery(view, "snickers");
    await typeQuery(view, "skyr");
    expect(foodResults(view)).toContain("Skyr");
    answerFirst([HIT]);
    await vi.advanceTimersByTimeAsync(0);
    expect(foodResults(view)).toContain("Skyr");
    expect(foodResults(view)).not.toContain("Snickers");
  });

  it("#621 Escape closes the search without writing", () => {
    const view = mount(NOTE);
    openFood(view);
    fireEvent.keyDown(queryOf(view), { key: "Escape" });
    expect(foodQuery(view)).toBeNull();
    expect(text(view)).toBe(NOTE);
  });

  it("#621 a slow barcode read never replaces a later pick", async () => {
    let answerFirst: (food: Food) => void = () => {};
    const skyr = { ...SNICKERS, code: "3017620422003", name: "Skyr", brand: null };
    vi.mocked(searchFood).mockResolvedValueOnce([HIT, { ...HIT, ...skyr, serving_g: 100 }]);
    vi.mocked(readBarcode)
      .mockReturnValueOnce(
        new Promise<Food>((resolve) => {
          answerFirst = resolve;
        }),
      )
      .mockResolvedValueOnce(skyr);
    const view = mount(NOTE);
    openFood(view);
    await typeQuery(view, "snickers");
    const rows = view.dom.querySelectorAll<HTMLButtonElement>(".cm-log-food-results button");
    expect(rows.length).toBe(2);
    rows[0]?.click();
    rows[1]?.click();
    await vi.advanceTimersByTimeAsync(0);
    const heading = () => view.dom.querySelector(".cm-log-food-heading")?.textContent;
    expect(heading()).toBe("Skyr");
    answerFirst(SNICKERS);
    await vi.advanceTimersByTimeAsync(0);
    expect(heading()).toBe("Skyr");
  });

  it("#621 a drink tap while the food search is open keeps the query and the chosen serving", async () => {
    const view = mount(NOTE);
    openFood(view);
    await typeQuery(view, "snickers");
    await pickFirst(view);
    fireEvent.input(formField(view, ".cm-log-food-grams"), { target: { value: "100" } });
    const panel = view.dom.querySelector(".cm-log-food");
    expect(panel).not.toBeNull();
    press(view, "Log water");
    expect(text(view)).toContain("- 💧 250 ml");
    expect(view.dom.querySelector(".cm-log-food")).toBe(panel);
    expect(foodQuery(view)?.value).toBe("snickers");
    expect(formField(view, ".cm-log-food-grams").value).toBe("100");
    expect(formField(view, ".cm-log-food-servings").value).toBe("2");
  });

  it("#621 a negative nutrient from Open Food Facts is left out of the line", async () => {
    vi.mocked(readBarcode).mockResolvedValueOnce({
      ...SNICKERS,
      per_serving: { ...SNICKERS.per_serving, protein: -4.3 },
    });
    const view = mount(NOTE);
    openFood(view);
    await typeQuery(view, "snickers");
    await pickFirst(view);
    logFood(view);
    expect(text(view)).toContain(
      "- 🍽 lunch: Snickers (Mars Wrigley Confectionery UK Limited) 50 g 🔥 240 kcal 🍞 30.2 g 🧈 11.2 g\n",
    );
  });
});
