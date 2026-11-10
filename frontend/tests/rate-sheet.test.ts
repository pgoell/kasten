import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateNote } from "@/lib/core/api";
import {
  comeBackTonight,
  cookedLineFor,
  mealFacts,
  openRateSheet,
} from "@/lib/log/recipe/rate-sheet";

vi.mock("@/lib/core/api", () => ({ updateNote: vi.fn() }));

const MEAL = {
  path: "Rezepte/Chili.md",
  title: "Chili sin carne",
  line: "- 🍽 lunch: Chili sin carne 🔥 540 kcal 🥩 32 g",
};
const NOTE = "---\ntype: Recipe\n---\n# Chili sin carne\n\n## Zutaten\n- 500 g Bohnen\n";

const $ = (selector: string) => document.querySelector<HTMLElement>(`.k-rate ${selector}`);
const press = (selector: string) => $(selector)?.click();
const face = (name: string) =>
  [...document.querySelectorAll<HTMLElement>(".k-rate-face")].find((button) =>
    button.textContent?.toLowerCase().includes(name),
  );

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 9, 13, 0));
  localStorage.clear();
  vi.mocked(updateNote).mockReset();
});

afterEach(() => {
  document.querySelector(".k-rate")?.remove();
  vi.useRealTimers();
});

describe("the rating sheet", () => {
  it("writes the line the format names", () => {
    expect(cookedLineFor("2026-11-09", "gern wieder", ["mehr Würze", "Beilage anders"], "")).toBe(
      "- 2026-11-09 gern wieder · mehr Würze, Beilage anders",
    );
    expect(cookedLineFor("2026-11-09", "geht so", [], "  Reis   zu weich ")).toBe(
      "- 2026-11-09 geht so · Reis zu weich",
    );
    expect(cookedLineFor("2026-11-09", "lieber nicht", [], "")).toBe("- 2026-11-09 lieber nicht");
    expect(mealFacts(MEAL.line)).toBe("lunch · 540 kcal");
    expect(mealFacts("- 🍽 Toast")).toBe("");
    expect(mealFacts("- 🍽️ Dinner: Dal 🔥 612,5 kcal")).toBe("dinner · 613 kcal");
  });

  it("asks once a face is picked, and appends the line under ## Gekocht", async () => {
    let written = "";
    vi.mocked(updateNote).mockImplementation(async (_path, change) => {
      written = change(NOTE) ?? "";
      return null;
    });
    openRateSheet(MEAL);
    expect($(".k-rate-title")?.textContent).toBe("Chili sin carne, cook again?");
    expect($(".k-rate-facts")?.textContent).toBe("lunch · 540 kcal");
    expect(($(".k-rate-done") as HTMLButtonElement).disabled).toBe(true);
    face("gern wieder")?.click();
    press(".k-rate-chip");
    press(".k-rate-done");
    await vi.advanceTimersByTimeAsync(0);
    expect(updateNote).toHaveBeenCalledWith("Rezepte/Chili.md", expect.any(Function));
    expect(written).toBe(`${NOTE}\n## Gekocht\n- 2026-11-09 gern wieder · mehr Würze\n`);
    expect(document.querySelector(".k-rate")).toBeNull();
    expect(localStorage.getItem("kasten.rate.pending")).toBeNull();
  });

  it("dates the line by the daily note the meal went on", async () => {
    let written = "";
    vi.mocked(updateNote).mockImplementation(async (_path, change) => {
      written = change(NOTE) ?? "";
      return null;
    });
    openRateSheet({ ...MEAL, day: "2026-11-08" });
    face("geht so")?.click();
    press(".k-rate-done");
    await vi.advanceTimersByTimeAsync(0);
    expect(written).toContain("- 2026-11-08 geht so\n");
  });

  it("keeps the sheet and says why when the write fails", async () => {
    vi.mocked(updateNote).mockRejectedValue(new Error("Changed on disk"));
    openRateSheet(MEAL);
    face("geht so")?.click();
    press(".k-rate-done");
    await vi.advanceTimersByTimeAsync(0);
    expect($(".k-rate-why")?.textContent).toBe(
      "Nothing written to Chili sin carne: Changed on disk",
    );
  });

  it("comes back once that evening when skipped, then lets go", async () => {
    openRateSheet(MEAL);
    press(".k-rate-later");
    expect(document.querySelector(".k-rate")).toBeNull();
    await vi.advanceTimersByTimeAsync(5 * 60 * 60 * 1000);
    expect(document.querySelector(".k-rate")).toBeNull();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect($(".k-rate-said")?.textContent).toContain("the rating is dropped");
    press(".k-rate-later");
    expect(localStorage.getItem("kasten.rate.pending")).toBeNull();
    comeBackTonight();
    expect(document.querySelector(".k-rate")).toBeNull();
  });

  it("drops a rating skipped on another day", () => {
    openRateSheet(MEAL);
    press(".k-rate-later");
    comeBackTonight(new Date(2026, 10, 10, 20, 0));
    expect(document.querySelector(".k-rate")).toBeNull();
    expect(localStorage.getItem("kasten.rate.pending")).toBeNull();
  });

  it("waits for the next note opened when skipped in the evening", () => {
    vi.setSystemTime(new Date(2026, 10, 9, 20, 0));
    openRateSheet(MEAL);
    press(".k-rate-later");
    expect(document.querySelector(".k-rate")).toBeNull();
    comeBackTonight();
    expect(document.querySelector(".k-rate")).not.toBeNull();
  });
});
