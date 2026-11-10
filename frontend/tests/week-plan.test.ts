import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RECIPE_PAUSE_MS } from "@/lib/log/recipe/recipe-card";
import { weekPlanCard } from "@/lib/log/recipe/week-plan";
import {
  type Batch,
  bandText,
  cellText,
  isMealPlan,
  lanes,
  type MealPlan,
  type PlannedMeal,
  plainText,
  readMealPlan,
  trainingProtein,
  weekTitle,
  writeShopping,
} from "@/lib/log/recipe/week-plan-data";

/** The week plan card (#1726): days by lunch and dinner, batches as bands, the shopping button. */

vi.mock("@/lib/log/recipe/week-plan-data", async (actual) => ({
  ...(await actual<object>()),
  readMealPlan: vi.fn(),
  writeShopping: vi.fn(),
}));

const NOTE =
  "---\ntype: Meal Plan\nweek: 2026-W46\n---\n# Woche 46\n\n- Mo dinner: cook [[Dal]] x4\n";

function meal(over: Partial<PlannedMeal>): PlannedMeal {
  return {
    line: 7,
    day: 0,
    slot: "dinner",
    kind: "cook",
    text: "cook [[Linsen-Dal]] x4 👤 [[Alicia]]",
    recipe: "Linsen-Dal",
    path: "Rezepte/Linsen-Dal.md",
    servings: 4,
    cook: "Alicia",
    batch: 0,
    fridge_day: 1,
    freeze: false,
    ...over,
  };
}

function batch(over: Partial<Batch>): Batch {
  return {
    recipe: "Linsen-Dal",
    path: "Rezepte/Linsen-Dal.md",
    day: 0,
    slot: "dinner",
    servings: 4,
    first_day: 0,
    eaten: 3,
    left: 1,
    last_day: 2,
    cook: "Alicia",
    state: "cooked",
    ...over,
  };
}

const days = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
  day,
  date: `2026-11-${String(9 + day).padStart(2, "0")}`,
  training: day === 0 || day === 4,
  protein: day === 0 ? 120 : day === 4 ? 136 : null,
}));

const PLAN: MealPlan = {
  week: "2026-W46",
  fridge_days: 2,
  days,
  meals: [
    meal({}),
    meal({ day: 1, kind: "from", text: "from [[Linsen-Dal]]", servings: null, fridge_day: 2 }),
    meal({ day: 2, kind: "from", text: "from [[Linsen-Dal]]", fridge_day: 3, freeze: true }),
    meal({ day: 3, slot: "lunch", kind: "other", text: "Kantine", recipe: null, batch: null }),
  ],
  batches: [batch({})],
  protein_goal: { type: "floor", value: 120 },
  ingredients: 17,
};

const mounted: EditorView[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(readMealPlan).mockReset();
  vi.mocked(writeShopping).mockReset();
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
    state: EditorState.create({ doc, extensions: [weekPlanCard] }),
    parent,
  });
  mounted.push(view);
  return view;
}

describe("the week plan's words", () => {
  it("reads type: Meal Plan in any case, and nothing else", () => {
    expect(isMealPlan(NOTE)).toBe(true);
    expect(isMealPlan('---\ntype: "meal plan"\n---\n')).toBe(true);
    expect(isMealPlan("---\ntype: Recipe\n---\n")).toBe(false);
  });

  it("names the week, the cells and the bands as the mock does", () => {
    expect(weekTitle(PLAN)).toBe("Woche 46 · 9.–15. Nov");
    expect(cellText(PLAN.meals[0] as PlannedMeal)).toBe("Linsen-Dal kochen ×4");
    expect(cellText(PLAN.meals[1] as PlannedMeal)).toBe("Linsen-Dal");
    expect(plainText("Essen bei [[Mama|Mama]] 👤 [[Pascal]]")).toBe("Essen bei Mama 👤 Pascal");
    expect(bandText(batch({}))).toBe("Mo–Mi · 1 übrig");
    expect(bandText(batch({ left: -2 }))).toBe("Mo–Mi · 2 zu wenig");
    expect(bandText(batch({ state: "earlier", day: null, servings: null, left: null }))).toBe(
      "aus der Vorwoche · bis Mi",
    );
  });

  it("averages protein over training days against the goal", () => {
    expect(trainingProtein(PLAN)).toBe("Ø 128 g · Ziel 120");
    expect(trainingProtein({ ...PLAN, days: days.map((d) => ({ ...d, training: false })) })).toBe(
      null,
    );
  });

  it("sets overlapping bands side by side", () => {
    const two = {
      ...PLAN,
      batches: [
        batch({}),
        batch({ first_day: 1, last_day: 3 }),
        batch({ first_day: 4, last_day: 5 }),
      ],
    };
    expect(lanes(two)).toEqual({ lane: [0, 1, 0], count: 2 });
  });
});

describe("the week plan card", () => {
  it("draws the grid, a band with what is left, the warning and the protein", async () => {
    vi.mocked(readMealPlan).mockResolvedValue(PLAN);
    const view = mount(NOTE);
    await vi.advanceTimersByTimeAsync(0);
    const card = view.dom.querySelector<HTMLElement>(".cm-plan");
    expect(card?.querySelector(".cm-plan-week")?.textContent).toBe("Woche 46 · 9.–15. Nov");
    expect(card?.querySelectorAll(".cm-plan-training")).toHaveLength(2);
    expect(card?.querySelector(".cm-plan-cook .cm-plan-who")?.textContent).toBe("Alicia");
    expect(card?.querySelectorAll(".cm-plan-from")).toHaveLength(2);
    expect(card?.querySelectorAll(".cm-plan-empty")).toHaveLength(10);
    const band = card?.querySelector<HTMLElement>(".cm-plan-band");
    expect(band?.style.gridRow).toBe("2 / 5");
    expect(band?.querySelector(".cm-plan-warn")?.textContent).toBe("Mi ist Tag 3: einfrieren?");
    expect(card?.querySelector(".cm-plan-grams")?.textContent).toBe("Ø 128 g · Ziel 120");
  });

  it("asks again after typing pauses, and writes the shopping list on a press", async () => {
    vi.mocked(readMealPlan).mockResolvedValue(PLAN);
    vi.mocked(writeShopping).mockResolvedValue({
      path: "05 Shared/Einkauf.md",
      added: 6,
      merged: 1,
      skipped: 0,
    });
    const view = mount(NOTE);
    await vi.advanceTimersByTimeAsync(0);
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "- Di lunch: from [[Dal]]\n" },
    });
    await vi.advanceTimersByTimeAsync(RECIPE_PAUSE_MS);
    expect(readMealPlan).toHaveBeenCalledTimes(2);
    const button = view.dom.querySelector<HTMLButtonElement>(".cm-plan-shop");
    expect(button?.textContent).toBe("17 in den Einkauf");
    button?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(writeShopping).toHaveBeenCalledWith(view.state.doc.toString());
    expect(view.dom.querySelector(".cm-plan-said")?.textContent).toBe("Einkauf: 6 neu, 1 ergänzt");
  });

  it("stays away from a note that is no week plan", async () => {
    const view = mount("---\ntype: Recipe\n---\n# Dal\n");
    await vi.advanceTimersByTimeAsync(0);
    expect(readMealPlan).not.toHaveBeenCalled();
    expect(view.dom.querySelector(".cm-plan")).toBeNull();
  });
});
