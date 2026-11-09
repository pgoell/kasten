import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Ingredient, type Recipe, readRecipe } from "@/lib/log/food-api";
import { isRecipe, RECIPE_PAUSE_MS, recipeCard, scaledLine, shown } from "@/lib/log/recipe-card";

vi.mock("@/lib/log/food-api", () => ({ readRecipe: vi.fn() }));

const NOTE =
  "---\ntype: Recipe\nservings: 4\n---\n# Chili sin carne\n\n## Zutaten\n- 500 g Kidneybohnen\n";

function line(over: Partial<Ingredient>): Ingredient {
  return {
    line: 8,
    text: "500 g Kidneybohnen",
    group: null,
    quantity: 500,
    unit: "g",
    food: "Kidneybohnen",
    note: null,
    rest: "g Kidneybohnen",
    grams: 500,
    match: { source: "mine", name: "Kidneybohnen", code: null },
    status: "counted",
    nutrients: { kcal: 500, protein: 35, carbs: 60, fat: 2.5 },
    ...over,
  };
}

const CHILI: Recipe = {
  servings: 4,
  time: null,
  source: null,
  tags: [],
  steps: [],
  ingredients: [
    line({}),
    line({
      line: 9,
      text: "1 TL Kreuzkümmel",
      quantity: 1,
      unit: "TL",
      food: "Kreuzkümmel",
      rest: "TL Kreuzkümmel",
      grams: null,
      match: null,
      status: "no_match",
      nutrients: null,
    }),
    line({
      line: 10,
      text: "Salz, nach Belieben",
      quantity: null,
      unit: null,
      food: "Salz",
      note: "nach Belieben",
      rest: "Salz, nach Belieben",
      grams: null,
      match: null,
      status: "no_amount",
      nutrients: null,
    }),
  ],
  total: { kcal: 500, protein: 35, carbs: 60, fat: 2.5 },
  per_serving: { kcal: 125, protein: 8.75, carbs: 15, fat: 0.625 },
};

const mounted: EditorView[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(readRecipe).mockReset();
});

afterEach(() => {
  for (const view of mounted.splice(0)) {
    view.destroy();
    view.dom.parentElement?.remove();
  }
  vi.useRealTimers();
});

function mount(doc: string): EditorView {
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [recipeCard] }),
    parent,
  });
  mounted.push(view);
  return view;
}

const card = (view: EditorView) => view.dom.querySelector<HTMLElement>(".cm-recipe");

describe("the recipe card", () => {
  it("reads type: Recipe in any case, and nothing else", () => {
    expect(isRecipe(NOTE)).toBe(true);
    expect(isRecipe("---\ntype: recipe\n---\n")).toBe(true);
    expect(isRecipe('---\ntype: "Recipe"\n---\n')).toBe(true);
    expect(isRecipe("---\ntype: Concept\n---\n# Chili")).toBe(false);
    expect(isRecipe("# Chili\n\n## Zutaten\n- 1 g Salz")).toBe(false);
  });

  it("writes numbers without trailing zeros, and scales a line's quantity by the servings", () => {
    expect(shown(8.75)).toBe("8.8");
    expect(shown(125, 0)).toBe("125");
    expect(shown(2.5)).toBe("2.5");
    expect(scaledLine(line({}), 1.5)).toBe("750 g Kidneybohnen");
    expect(scaledLine(line({ quantity: 2, rest: "Dosen Tomaten (je 400 g), gehackt" }), 1.5)).toBe(
      "3 Dosen Tomaten (je 400 g), gehackt",
    );
    expect(scaledLine(line({ quantity: null, rest: "etwas Mehl" }), 2)).toBe("etwas Mehl");
  });

  it("shows the numbers per serving, and says why a line is not counted", async () => {
    vi.mocked(readRecipe).mockResolvedValue(CHILI);
    const view = mount(NOTE);
    await vi.runAllTimersAsync();
    expect(readRecipe).toHaveBeenCalledWith(NOTE, expect.any(AbortSignal));
    const text = card(view)?.textContent ?? "";
    expect(text).toContain("Per serving");
    expect(text).toContain("125 kcal");
    expect(text).toContain("8.8 g protein");
    expect(text).toContain("no food matches");
    expect(text).toContain("no amount, not counted");
    expect(text).toContain("1 of 3 lines counted");
  });

  it("scales the amounts with the stepper and leaves the note as it is", async () => {
    vi.mocked(readRecipe).mockResolvedValue(CHILI);
    const view = mount(NOTE);
    await vi.runAllTimersAsync();
    for (let press = 0; press < 2; press++) {
      view.dom.querySelector<HTMLButtonElement>("button[aria-label='More servings']")?.click();
    }
    const text = card(view)?.textContent ?? "";
    expect(text).toContain("6 servings");
    expect(text).toContain("the note says 4");
    expect(text).toContain("750 g Kidneybohnen");
    expect(text).toContain("750 kcal");
    expect(text).toContain("125 kcal");
    expect(view.state.doc.toString()).toBe(NOTE);
  });

  it("asks once typing pauses, not on every key", async () => {
    vi.mocked(readRecipe).mockResolvedValue(CHILI);
    const view = mount(NOTE);
    await vi.runAllTimersAsync();
    for (const key of "abc") {
      view.dispatch({ changes: { from: view.state.doc.length, insert: key } });
      await vi.advanceTimersByTimeAsync(RECIPE_PAUSE_MS / 2);
    }
    expect(readRecipe).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RECIPE_PAUSE_MS);
    expect(readRecipe).toHaveBeenCalledTimes(2);
  });

  it("draws nothing and asks nothing on a note that is no recipe", async () => {
    const view = mount("# Chili\n\n## Zutaten\n- 500 g Kidneybohnen\n");
    await vi.runAllTimersAsync();
    expect(card(view)).toBeNull();
    expect(readRecipe).not.toHaveBeenCalled();
  });

  it("names a failed request on the card", async () => {
    vi.mocked(readRecipe).mockRejectedValue(
      new Error("POST /api/recipe/nutrition failed with 500"),
    );
    const view = mount(NOTE);
    await vi.runAllTimersAsync();
    expect(card(view)?.textContent).toContain("failed with 500");
  });
});
