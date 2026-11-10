import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ingredient, Recipe } from "@/lib/log/food-api";
import { openCookMode } from "@/lib/log/recipe/cook-mode";

function food(text: string, quantity: number, rest: string, name: string): Ingredient {
  return {
    line: 1,
    text,
    group: null,
    quantity,
    quantity_to: null,
    unit: null,
    food: name,
    note: null,
    rest,
    grams: null,
    match: null,
    status: "no_match",
    nutrients: null,
  };
}

const CHILI: Recipe = {
  servings: 4,
  time: null,
  source: null,
  tags: [],
  ingredients: [
    food("2 Zwiebeln", 2, "Zwiebeln", "Zwiebeln"),
    food("500 g Kidneybohnen", 500, "g Kidneybohnen", "Kidneybohnen"),
  ],
  steps: ["Zwiebeln würfeln.", "Bohnen dazu, 8 Minuten köcheln.", "Servieren."],
  cooked: [{ line: 20, date: "2026-10-27", verdict: "gern wieder", note: "mehr Chili" }],
  total: { kcal: null, protein: null, carbs: null, fat: null },
  per_serving: null,
};

let request: ReturnType<typeof vi.fn>;
let release: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  release = vi.fn().mockResolvedValue(undefined);
  request = vi.fn().mockResolvedValue({ release, addEventListener: vi.fn() });
  Object.defineProperty(navigator, "wakeLock", { value: { request }, configurable: true });
});

afterEach(() => {
  for (const open of document.querySelectorAll(".k-cook")) open.remove();
  Reflect.deleteProperty(navigator, "wakeLock");
  vi.useRealTimers();
});

const $ = (selector: string) => document.querySelector<HTMLElement>(`.k-cook ${selector}`);
const press = (selector: string) => $(selector)?.click();

describe("cook mode", () => {
  it("keeps the screen on while open, and lets go on close", async () => {
    openCookMode({ title: "Chili", recipe: CHILI, servings: 4 });
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledWith("screen");
    expect($(".k-cook-lock")?.textContent).toBe("Screen stays on");
    press(".k-cook-close");
    expect(release).toHaveBeenCalled();
    expect(document.querySelector(".k-cook")).toBeNull();
  });

  it("says so when the screen cannot be kept on", async () => {
    request.mockRejectedValue(new DOMException("low battery", "NotAllowedError"));
    openCookMode({ title: "Chili", recipe: CHILI, servings: 4 });
    await vi.advanceTimersByTimeAsync(0);
    expect($(".k-cook-lock")?.textContent).toBe("The screen may turn off");
  });

  it("goes one step at a time with the step's ingredients scaled, and the last note", () => {
    openCookMode({ title: "Chili", recipe: CHILI, servings: 6 });
    expect($(".k-cook-where")?.textContent).toBe("Chili · Step 1 of 3");
    expect($(".k-cook-item")?.textContent).toBe("3 Zwiebeln");
    expect($(".k-cook-label")?.textContent).toBe("For this step · 6 servings");
    expect($(".k-cook-last")?.textContent).toBe("Last time: mehr Chili");
    expect(($(".k-cook-back") as HTMLButtonElement).disabled).toBe(true);
    press(".k-cook-next");
    expect($(".k-cook-step")?.textContent).toBe("Bohnen dazu, 8 Minuten köcheln.");
    expect($(".k-cook-item")?.textContent).toBe("750 g Kidneybohnen");
    expect(document.querySelectorAll(".k-cook-segment.is-done")).toHaveLength(2);
    press(".k-cook-next");
    expect($(".k-cook-next")?.textContent).toBe("Done");
    expect($(".k-cook-uses")?.childElementCount).toBe(0);
    press(".k-cook-next");
    expect(document.querySelector(".k-cook")).toBeNull();
  });

  it("runs the timer a step names, pauses it, and rings at zero", async () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    openCookMode({ title: "Chili", recipe: CHILI, servings: 4 });
    expect($(".k-cook-timer")?.hidden).toBe(true);
    press(".k-cook-next");
    expect($(".k-cook-timer")?.textContent).toBe("Start 8:00 timer");
    press(".k-cook-timer");
    await vi.advanceTimersByTimeAsync(60_000);
    expect($(".k-cook-timer")?.textContent).toBe("7:00 · pause");
    press(".k-cook-timer");
    await vi.advanceTimersByTimeAsync(60_000);
    expect($(".k-cook-timer")?.textContent).toBe("Paused at 7:00 · resume");
    press(".k-cook-timer");
    press(".k-cook-next");
    expect($(".k-cook-chip")?.textContent).toBe("Timer 7:00");
    await vi.advanceTimersByTimeAsync(7 * 60_000);
    expect(vibrate).toHaveBeenCalled();
    expect($(".k-cook-chip")?.textContent).toBe("Time's up");
    press(".k-cook-chip");
    expect($(".k-cook-timer")?.textContent).toBe("Time's up · start 8:00 again");
    Reflect.deleteProperty(navigator, "vibrate");
  });

  it("moves with the arrow keys and closes on Escape", () => {
    openCookMode({ title: "Chili", recipe: CHILI, servings: 4 });
    const root = document.querySelector<HTMLElement>(".k-cook");
    root?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect($(".k-cook-where")?.textContent).toBe("Chili · Step 2 of 3");
    root?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".k-cook")).toBeNull();
  });
});
