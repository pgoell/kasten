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
const OTHER = "02 Projects/Plan.md";
const NOTE = "# 2026-10-20 Tuesday\n\n## Log\n- 💧 500 ml\n\n## Done\n- [ ] write";
const FENCED = "# 2026-10-20 Tuesday\n\n## Log\n- 💧 500 ml\n```\ncode\n";

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

const card = (view: EditorView) => view.dom.querySelector<HTMLElement>(".cm-log");
const amount = (view: EditorView) => view.dom.querySelector(".cm-log-amount") as HTMLInputElement;
const why = (view: EditorView) => view.dom.querySelector(".cm-log-why")?.textContent;
const text = (view: EditorView) => view.state.doc.toString();
const totals = (view: EditorView) => view.dom.querySelector(".cm-log-totals")?.textContent ?? "";

/** Presses the card's button with this aria-label, or fails the test where there is none. */
function press(view: EditorView, label: string): void {
  const found = view.dom.querySelector<HTMLButtonElement>(`.cm-log button[aria-label='${label}']`);
  if (found === null) throw new Error(`no ${label} button on the card`);
  found.click();
}

describe("the log card", () => {
  it("shows the card on a daily note", () => {
    expect(card(mount(NOTE))).not.toBeNull();
  });

  it("shows no card on another note", () => {
    expect(card(mount(NOTE, OTHER))).toBeNull();
  });

  it("totals only the lines under this note's ## Log", () => {
    const view = mount("# 2026-10-20\n\n## Log\n- 💧 500 ml\n\n## Done\n- 💧 300 ml");
    expect(view.dom.querySelector(".cm-log-totals")?.textContent).toContain("💧 500 ml");
  });

  it("a tap appends the default line at the end of ## Log", () => {
    const view = mount(NOTE);
    press(view, "Log water");
    expect(text(view)).toBe(
      "# 2026-10-20 Tuesday\n\n## Log\n- 💧 500 ml\n- 💧 250 ml\n\n## Done\n- [ ] write",
    );
  });

  it("a tap makes ## Log where the note has none", () => {
    const view = mount("# 2026-10-20 Tuesday\n\nsome text");
    press(view, "Log coffee");
    expect(text(view)).toBe("# 2026-10-20 Tuesday\n\nsome text\n\n## Log\n- ☕ 1\n");
  });

  it("writes the amount typed in the field", () => {
    const view = mount(NOTE);
    amount(view).value = "330";
    press(view, "Log water");
    expect(text(view)).toContain("- 💧 330 ml\n\n## Done");
  });

  it("a bad amount writes nothing and shows why", () => {
    const view = mount(NOTE);
    amount(view).value = "500 g";
    press(view, "Log water");
    expect(text(view)).toBe(NOTE);
    expect(why(view)).toBe("not a water amount: 500 g");
  });

  it("two quick taps both land, in order", () => {
    const view = mount(NOTE);
    press(view, "Log water");
    press(view, "Log coffee");
    expect(text(view)).toContain("- 💧 500 ml\n- 💧 250 ml\n- ☕ 1\n\n## Done");
  });

  it("Undo takes the tapped line out", () => {
    const view = mount(NOTE);
    press(view, "Log water");
    view.dom.querySelector<HTMLButtonElement>(".cm-log-undo")?.click();
    expect(text(view)).toBe(NOTE);
  });

  it("no Undo once the tapped line was edited", () => {
    const view = mount(NOTE);
    press(view, "Log water");
    const at = text(view).indexOf("- 💧 250 ml");
    view.dispatch({ changes: { from: at + 2, insert: "x" } });
    expect(view.dom.querySelector(".cm-log-undo")).toBeNull();
  });

  it("a tap leaves the selection where it was", () => {
    const view = mount(NOTE, DAILY, [], NOTE.indexOf("500"));
    press(view, "Log water");
    expect(view.state.selection.main.from).toBe(NOTE.indexOf("500"));
    expect(view.state.selection.main.to).toBe(NOTE.indexOf("500"));
  });

  it("an unrelated edit keeps the typed amount in the field", () => {
    const view = mount(NOTE);
    const field = amount(view);
    field.value = "330";
    view.dispatch({ changes: { from: text(view).length, insert: "\nnote" } });
    expect(amount(view)).toBe(field);
    expect(amount(view).value).toBe("330");
  });

  it("with vim on, a tap leaves vim in normal mode and u takes it back", () => {
    const view = mount(NOTE, DAILY, [vim(), vimModeState()]);
    press(view, "Log water");
    expect(view.state.field(vimModeField)).toBe("normal");
    fireEvent.keyDown(view.contentDOM, { key: "u" });
    expect(text(view)).toBe(NOTE);
  });

  it("with vim off, undo takes a tap back", () => {
    const view = mount(NOTE, DAILY, [vimKeys.of(false)]);
    press(view, "Log water");
    undo(view);
    expect(text(view)).toBe(NOTE);
  });

  it("two quick taps come back one undo each", () => {
    const view = mount(NOTE, DAILY, [vimKeys.of(false)]);
    press(view, "Log water");
    press(view, "Log coffee");
    undo(view);
    expect(text(view)).toBe(
      "# 2026-10-20 Tuesday\n\n## Log\n- 💧 500 ml\n- 💧 250 ml\n\n## Done\n- [ ] write",
    );
    undo(view);
    expect(text(view)).toBe(NOTE);
  });

  it("the totals follow a tap, a typed line and an undo", () => {
    const view = mount(NOTE);
    press(view, "Log water");
    expect(totals(view)).toContain("💧 750 ml");
    const end = text(view).indexOf("- 💧 250 ml") + "- 💧 250 ml".length;
    view.dispatch({ changes: { from: end, insert: "\n- ☕ 1" } });
    expect(totals(view)).toContain("☕ 1");
    undo(view);
    expect(totals(view)).toContain("☕ 0");
    expect(totals(view)).not.toContain("☕ 1");
  });

  it("typing in the amount field leaves the note as it was", () => {
    const view = mount(NOTE);
    const field = amount(view);
    field.focus();
    field.value = "330";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    expect(text(view)).toBe(NOTE);
    expect(amount(view).value).toBe("330");
  });

  it("an edit above the log keeps the typed amount while Undo shows", () => {
    const view = mount(NOTE);
    press(view, "Log water");
    expect(view.dom.querySelector(".cm-log-undo")).not.toBeNull();
    amount(view).value = "500";
    // The end of the title, not the start: a letter before the `#` would stop the title reading as one.
    const at = NOTE.indexOf("\n");
    view.dispatch({ changes: { from: at, insert: "x" } });
    expect(amount(view).value).toBe("500");
    view.dom.querySelector<HTMLButtonElement>(".cm-log-undo")?.click();
    expect(text(view)).toBe(`${NOTE.slice(0, at)}x${NOTE.slice(at)}`);
  });

  it("with vim on, a tap into a ## Log ending in an unclosed fence closes it and u takes both back", () => {
    const view = mount(FENCED, DAILY, [vim(), vimModeState()]);
    press(view, "Log water");
    const after = text(view);
    fireEvent.keyDown(view.contentDOM, { key: "u" });
    expect([after, text(view)]).toEqual([
      "# 2026-10-20 Tuesday\n\n## Log\n- 💧 500 ml\n```\ncode\n```\n- 💧 250 ml\n",
      FENCED,
    ]);
  });

  it("with vim off, a tap into a ## Log ending in an unclosed fence closes it and undo takes both back", () => {
    const view = mount(FENCED, DAILY, [vimKeys.of(false)]);
    press(view, "Log water");
    const after = text(view);
    undo(view);
    expect([after, text(view)]).toEqual([
      "# 2026-10-20 Tuesday\n\n## Log\n- 💧 500 ml\n```\ncode\n```\n- 💧 250 ml\n",
      FENCED,
    ]);
  });
});

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
    for (const typed of ["0", "-5", "abc"]) {
      fireEvent.input(formField(view, ".cm-log-food-grams"), { target: { value: typed } });
      logFood(view);
      expect(text(view)).toBe(NOTE);
      expect(foodWhy(view)).toBe("grams must be a number above zero");
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
});
