/**
 * Foods of your own in the food search (#799): listed first from the foods note,
 * found by a typed or scanned barcode, and saved from the add form.
 */

import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchLog, type LogDay, readBarcode, searchFood } from "@/lib/log/food-api";
import { logCard } from "@/lib/log/log-card";
import { addMyFood, fetchMyFoods, type MyFood } from "@/lib/log/my-foods";
import { notePath } from "@/lib/todo/todo-commands";
import { vimModeField, vimModeState } from "@/lib/vim-mode";

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
const NOTE = "# 2026-10-20 Tuesday\n\n## Log\n- 💧 500 ml\n\n## Done\n- [ ] write";

/** One food of your own: ja! Choco Chips, per 100 g as the pack prints it, 30 g a serving. */
const CHIPS: MyFood = {
  name: "ja! Choco Chips",
  serving_g: 30,
  code: "4337185123456",
  per_100g: { kcal: 486, protein: 6.4, carbs: 61, fat: 23 },
};

const mounted: EditorView[] = [];

afterEach(() => {
  for (const view of mounted.splice(0)) {
    view.destroy();
    view.dom.parentElement?.remove();
  }
});

function mount(doc: string, path = DAILY, extra: Extension[] = []): EditorView {
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [notePath.of(path), logCard, ...extra] }),
    parent,
  });
  mounted.push(view);
  return view;
}

const text = (view: EditorView) => view.state.doc.toString();
const foodWhy = (view: EditorView) => view.dom.querySelector(".cm-log-food-why")?.textContent;
const foodResults = (view: EditorView) =>
  view.dom.querySelector(".cm-log-food-results")?.textContent ?? "";
const servingOf = (view: EditorView) => view.dom.querySelector<HTMLElement>(".cm-log-food-serving");

/** The element `selector` finds, or a failed expectation where there is none. */
function find<T extends HTMLElement>(view: EditorView, selector: string): T {
  const found = view.dom.querySelector<T>(selector);
  expect(found, selector).not.toBeNull();
  return found as T;
}

const formField = (view: EditorView, selector: string) => find<HTMLInputElement>(view, selector);
const addOf = (view: EditorView) => find<HTMLButtonElement>(view, ".cm-log-food-new");
const saveOf = (view: EditorView) =>
  find<HTMLButtonElement>(view, "button[aria-label='Save this food']");
// The sheet is drawn in a microtask after the press, so the call waits for that one turn.
const openFood = async (view: EditorView) => {
  find<HTMLButtonElement>(view, ".cm-log button[aria-label='Log food']").click();
  await Promise.resolve();
};
const logFood = (view: EditorView) =>
  find<HTMLButtonElement>(view, "button[aria-label='Log this food']").click();

/** Types `text` into the open panel, and lets the pause pass so the search is sent. */
async function typeQuery(view: EditorView, text: string): Promise<void> {
  fireEvent.input(formField(view, ".cm-log-food-query"), { target: { value: text } });
  await vi.advanceTimersByTimeAsync(400);
}

/** Types `value` into the add form's field with this aria-label. */
function fill(view: EditorView, label: string, value: string): void {
  fireEvent.input(formField(view, `.cm-log-food-add input[aria-label='${label}']`), {
    target: { value },
  });
}

/** A camera whose first frame reads `code`, as the scan tests stub it. */
function stubCamera(code: string): void {
  const tracks = [{ stop: vi.fn() }];
  const stream = {
    getTracks: () => tracks,
    getVideoTracks: () => tracks,
  } as unknown as MediaStream;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
  });
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
  Object.defineProperty(globalThis, "BarcodeDetector", {
    configurable: true,
    value: class {
      static getSupportedFormats = async () => ["ean_13", "ean_8", "upc_a", "upc_e"];
      detect = vi.fn().mockResolvedValueOnce([{ rawValue: code, format: "ean_13" }]);
    },
  });
}

async function scan(view: EditorView): Promise<void> {
  find<HTMLButtonElement>(view, ".cm-log-food-scan").click();
  await vi.advanceTimersByTimeAsync(0);
}

const playOriginal = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "play");

describe("foods of your own", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Lunch by the hour, so the meal every test logs under is known.
    vi.setSystemTime(new Date(2026, 9, 20, 12, 30));
    vi.mocked(searchFood).mockReset().mockResolvedValue([]);
    vi.mocked(readBarcode).mockReset();
    vi.mocked(fetchLog).mockReset().mockResolvedValue([]);
    vi.mocked(fetchMyFoods).mockReset().mockResolvedValue({ foods: [], broken: [] });
    vi.mocked(addMyFood).mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(navigator, "mediaDevices");
    Reflect.deleteProperty(globalThis, "BarcodeDetector");
    if (playOriginal) Object.defineProperty(HTMLMediaElement.prototype, "play", playOriginal);
  });

  it("#799 foods of your own show first, marked mine, and log scaled to their serving", async () => {
    vi.mocked(fetchMyFoods).mockResolvedValue({ foods: [CHIPS], broken: [] });
    const view = mount(NOTE);
    await openFood(view);
    await vi.advanceTimersByTimeAsync(0);
    const first = view.dom.querySelector<HTMLButtonElement>(".cm-log-food-results button");
    expect(first?.textContent).toContain("ja! Choco Chips");
    expect(first?.textContent).toContain("146 kcal per 30 g");
    expect(first?.textContent).toContain("mine");
    first?.click();
    expect(formField(view, ".cm-log-food-grams").value).toBe("30");
    logFood(view);
    expect(text(view)).toContain(
      "- 🍽 lunch: ja! Choco Chips 30 g 🔥 146 kcal 🥩 1.9 g 🍞 18.3 g 🧈 6.9 g\n",
    );
    expect(searchFood).not.toHaveBeenCalled();
    expect(readBarcode).not.toHaveBeenCalled();
  });

  it("#799 a food of your own logged lately is listed once, as mine", async () => {
    vi.mocked(fetchMyFoods).mockResolvedValue({ foods: [CHIPS], broken: [] });
    const days = [
      {
        date: "2026-10-19",
        path: "01 Periodic/00 Daily/2026-10-19.md",
        entries: [
          {
            line: 5,
            text: "- 🍽 snack: ja! Choco Chips 30 g 🔥 146 kcal",
            kind: "food",
            meal: "snack",
            words: "ja! Choco Chips 30 g",
            kcal: 146,
          },
        ],
      },
    ];
    vi.mocked(fetchLog).mockResolvedValue(days as unknown as LogDay[]);
    const view = mount(NOTE);
    await openFood(view);
    await vi.advanceTimersByTimeAsync(0);
    const rows = view.dom.querySelectorAll(".cm-log-food-results button");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain("mine");
  });

  it("#799 a typed barcode finds a food of your own", async () => {
    vi.mocked(fetchMyFoods).mockResolvedValue({ foods: [CHIPS], broken: [] });
    vi.mocked(searchFood).mockResolvedValue([]);
    const view = mount(NOTE);
    await openFood(view);
    await typeQuery(view, "4337185123456");
    expect(foodResults(view)).toContain("ja! Choco Chips");
  });

  it("#799 a broken line of foods.md is named, and the rest still list", async () => {
    vi.mocked(fetchMyFoods).mockResolvedValue({
      foods: [CHIPS],
      broken: [{ line: 3, text: "- toast" }],
    });
    const view = mount(NOTE);
    await openFood(view);
    await vi.advanceTimersByTimeAsync(0);
    expect(foodWhy(view)).toBe("Skipped line 3 of foods.md: - toast");
    expect(foodResults(view)).toContain("ja! Choco Chips");
  });

  it("#799 Add food saves the food with the query as its name and opens it in the serving form", async () => {
    vi.mocked(searchFood).mockResolvedValue([]);
    const view = mount(NOTE);
    await openFood(view);
    await typeQuery(view, "ja! Choco Chips");
    addOf(view).click();
    expect(formField(view, "input[aria-label='Name']").value).toBe("ja! Choco Chips");
    expect(document.activeElement).toBe(formField(view, "input[aria-label='Name']"));
    fill(view, "Serving", "30");
    fill(view, "kcal", "486");
    fill(view, "Protein", "6,4");
    fill(view, "Carbs", "61");
    fill(view, "Fat", "23");
    fill(view, "Barcode", "4337185123456");
    saveOf(view).click();
    await vi.advanceTimersByTimeAsync(0);
    expect(addMyFood).toHaveBeenCalledWith(CHIPS);
    expect(view.dom.querySelector<HTMLElement>(".cm-log-food-serving")?.hidden).toBe(false);
    expect(formField(view, ".cm-log-food-grams").value).toBe("30");
    logFood(view);
    expect(text(view)).toContain("- 🍽 lunch: ja! Choco Chips 30 g 🔥 146 kcal");
  });

  it("#799 Add food with no kcal, a bad barcode or no name saves nothing and says why", async () => {
    const view = mount(NOTE);
    await openFood(view);
    addOf(view).click();
    fill(view, "kcal", "486");
    saveOf(view).click();
    expect(foodWhy(view)).toBe("the food needs a name");
    fill(view, "Name", "Toast");
    fill(view, "kcal", "");
    saveOf(view).click();
    expect(foodWhy(view)).toBe("kcal per 100 g is needed");
    fill(view, "kcal", "abc");
    saveOf(view).click();
    expect(foodWhy(view)).toBe(
      "kcal, protein, carbs and fat per 100 g must be numbers from 0 to 1000",
    );
    fill(view, "kcal", "250");
    fill(view, "Barcode", "123");
    saveOf(view).click();
    expect(foodWhy(view)).toBe("a barcode is 8 to 14 digits");
    expect(addMyFood).not.toHaveBeenCalled();
    expect(text(view)).toBe(NOTE);
  });

  it("#799 a failed save says why and keeps the form", async () => {
    vi.mocked(addMyFood).mockRejectedValue(new Error("PUT /api/files/foods.md failed with 500"));
    const view = mount(NOTE);
    await openFood(view);
    addOf(view).click();
    fill(view, "Name", "Toast");
    fill(view, "kcal", "250");
    saveOf(view).click();
    await vi.advanceTimersByTimeAsync(0);
    expect(foodWhy(view)).toBe("PUT /api/files/foods.md failed with 500");
    expect(view.dom.querySelector<HTMLElement>(".cm-log-food-add")?.hidden).toBe(false);
  });

  it("#799 with vim on, keys typed in the add form never reach vim", async () => {
    const view = mount(NOTE, DAILY, [vim(), vimModeState()]);
    await openFood(view);
    addOf(view).click();
    for (const label of ["Name", "Serving", "kcal", "Protein", "Carbs", "Fat", "Barcode"]) {
      const input = formField(view, `.cm-log-food-add input[aria-label='${label}']`);
      fireEvent.keyDown(input, { key: "i" });
      fireEvent.keyDown(input, { key: "x" });
    }
    expect(view.state.field(vimModeField)).toBe("normal");
    expect(text(view)).toBe(NOTE);
  });
  it("#799 a scanned barcode of a food of your own opens it without asking Open Food Facts", async () => {
    vi.mocked(fetchMyFoods).mockResolvedValue({ foods: [CHIPS], broken: [] });
    stubCamera("4337185123456");
    const view = mount(NOTE);
    await openFood(view);
    await vi.advanceTimersByTimeAsync(0);
    await scan(view);
    expect(readBarcode).not.toHaveBeenCalled();
    expect(servingOf(view)?.hidden).toBe(false);
    logFood(view);
    expect(text(view)).toContain("- 🍽 lunch: ja! Choco Chips 30 g 🔥 146 kcal");
  });

  it("#799 Add food after an unknown barcode takes that barcode", async () => {
    stubCamera("4006381333931");
    vi.mocked(readBarcode).mockRejectedValueOnce(
      new Error("No food with barcode 4006381333931 on Open Food Facts"),
    );
    const view = mount(NOTE);
    await openFood(view);
    await scan(view);
    view.dom.querySelector<HTMLButtonElement>(".cm-log-food-new")?.click();
    const code = view.dom.querySelector<HTMLInputElement>(
      ".cm-log-food-add input[aria-label='Barcode']",
    );
    expect(code?.value).toBe("4006381333931");
    expect(addMyFood).not.toHaveBeenCalled();
  });
});
