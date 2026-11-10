/**
 * Recipes in the food search (#1724): listed first, logged at their numbers per serving, and
 * handed to the rating sheet once the line is in.
 */

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchLog, searchFood } from "@/lib/log/food-api";
import { logCard } from "@/lib/log/log-card";
import { fetchMyFoods } from "@/lib/log/my-foods";
import { openRateSheet } from "@/lib/log/recipe/rate-sheet";
import { fetchRecipes, type RecipeEntry } from "@/lib/log/recipe/recipe-api";
import { notePath } from "@/lib/todo/todo-commands";

vi.mock("@/lib/log/food-api", () => ({
  searchFood: vi.fn(),
  readBarcode: vi.fn(),
  fetchLog: vi.fn(),
}));
vi.mock("@/lib/log/my-foods", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log/my-foods")>()),
  fetchMyFoods: vi.fn(),
}));
vi.mock("@/lib/log/recipe/recipe-api", () => ({ fetchRecipes: vi.fn() }));
vi.mock("@/lib/log/recipe/rate-sheet", () => ({
  openRateSheet: vi.fn(),
  comeBackTonight: vi.fn(),
}));

const DAILY = "01 Periodic/00 Daily/2026-10-20.md";
const NOTE = "# 2026-10-20 Tuesday\n\n## Log\n- 💧 500 ml\n";

const CHILI: RecipeEntry = {
  path: "Rezepte/Chili.md",
  title: "Chili sin carne",
  servings: 4,
  per_serving: { kcal: 540, protein: 32, carbs: 62, fat: 14 },
  total: { kcal: 2160, protein: 128, carbs: 248, fat: 56 },
};
const DAL: RecipeEntry = {
  path: "Rezepte/Dal.md",
  title: "Dal",
  servings: null,
  per_serving: null,
  total: { kcal: 900, protein: 40, carbs: 120, fat: 20 },
};

const mounted: EditorView[] = [];

function mount(): EditorView {
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({
    state: EditorState.create({ doc: NOTE, extensions: [notePath.of(DAILY), logCard] }),
    parent,
  });
  mounted.push(view);
  return view;
}

function find<T extends HTMLElement>(view: EditorView, selector: string): T {
  const found = view.dom.querySelector<T>(selector);
  expect(found, selector).not.toBeNull();
  return found as T;
}

const results = (view: EditorView) =>
  view.dom.querySelector(".cm-log-food-results")?.textContent ?? "";

async function openFood(view: EditorView): Promise<void> {
  find<HTMLButtonElement>(view, ".cm-log button[aria-label='Log food']").click();
  await vi.advanceTimersByTimeAsync(0);
}

describe("recipes in the food search", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 20, 12, 30));
    vi.mocked(searchFood).mockReset().mockResolvedValue([]);
    vi.mocked(fetchLog).mockReset().mockResolvedValue([]);
    vi.mocked(fetchMyFoods).mockReset().mockResolvedValue({ foods: [], broken: [] });
    vi.mocked(fetchRecipes).mockReset().mockResolvedValue([CHILI, DAL]);
    vi.mocked(openRateSheet).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const view of mounted.splice(0)) {
      view.destroy();
      view.dom.parentElement?.remove();
    }
  });

  it("lists recipes first, by the words typed", async () => {
    const view = mount();
    await openFood(view);
    expect(results(view)).toContain("Recipes");
    expect(results(view)).toContain("540 kcal per serving");
    expect(results(view)).toContain("900 kcal per serving");
    const query = find<HTMLInputElement>(view, ".cm-log-food-query");
    fireEvent.input(query, { target: { value: "chili" } });
    await vi.advanceTimersByTimeAsync(400);
    expect(results(view)).toContain("Chili sin carne");
    expect(results(view)).not.toContain("Dal");
  });

  it("logs a serving at the recipe's numbers and opens the rating sheet", async () => {
    const view = mount();
    await openFood(view);
    const pick = [...view.dom.querySelectorAll<HTMLElement>(".cm-log-food-pick")].find((row) =>
      row.textContent?.includes("Chili sin carne"),
    );
    pick?.click();
    find<HTMLButtonElement>(view, "button[aria-label='Log this food']").click();
    const line = "- 🍽 lunch: Chili sin carne 🔥 540 kcal 🥩 32 g 🍞 62 g 🧈 14 g";
    expect(view.state.doc.toString()).toContain(line);
    expect(openRateSheet).toHaveBeenCalledWith({
      path: "Rezepte/Chili.md",
      title: "Chili sin carne",
      line,
    });
  });

  it("says nothing and lists no recipes when they cannot be read", async () => {
    vi.mocked(fetchRecipes).mockRejectedValue(new Error("GET /api/recipes failed with 500"));
    const view = mount();
    await openFood(view);
    expect(results(view)).not.toContain("Recipes");
    expect(view.dom.querySelector(".cm-log-food-why")?.textContent).toBe("");
  });
});
