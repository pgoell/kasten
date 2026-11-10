import { describe, expect, it } from "vitest";
import type { Ingredient } from "@/lib/log/food-api";
import {
  clock,
  cookedLine,
  daysSince,
  lastNote,
  stepIngredients,
  stepSeconds,
} from "@/lib/log/recipe/recipe-steps";

function food(name: string): Ingredient {
  return {
    line: 1,
    text: name,
    group: null,
    quantity: 1,
    quantity_to: null,
    unit: null,
    food: name,
    note: null,
    rest: name,
    grams: null,
    match: null,
    status: "no_match",
    nutrients: null,
  };
}

const FOODS = ["Sojagranulat", "rote Paprika", "Olivenöl", "Kidneybohnen", "Zwiebel", "Salz"].map(
  food,
);

describe("the ingredients a step names", () => {
  it.each([
    ["Sojagranulat und Paprika in den Topf, 8 Minuten anbraten.", ["Sojagranulat", "rote Paprika"]],
    ["Zwiebeln würfeln und im Öl glasig braten.", ["Olivenöl", "Zwiebel"]],
    ["Bohnen dazu und mit Salz abschmecken.", ["Kidneybohnen", "Salz"]],
    ["Alles 30 Minuten köcheln lassen.", []],
    ["den topf vom herd nehmen", []],
  ])("%s", (step, names) => {
    expect(stepIngredients(step, FOODS).map((item) => item.food)).toEqual(names);
  });
});

describe("the time a step names", () => {
  it.each([
    ["8 Minuten scharf anbraten", 480],
    ["30 Min. köcheln", 1800],
    ["10-12 Minuten backen", 600],
    ["10 bis 12 min garen", 600],
    ["1,5 Stunden schmoren", 5400],
    ["2 Std. ziehen lassen", 7200],
    ["45 Sekunden mixen", 45],
    ["bake for 20 minutes", 1200],
    ["2 Dosen Tomaten dazu", null],
    ["bei 180 Grad backen", null],
  ])("%s", (step, seconds) => {
    expect(stepSeconds(step)).toBe(seconds);
  });

  it("writes seconds as a clock", () => {
    expect(clock(480)).toBe("8:00");
    expect(clock(59.2)).toBe("1:00");
    expect(clock(5400)).toBe("1:30:00");
    expect(clock(-3)).toBe("0:00");
  });
});

describe("the meals cooked", () => {
  it("counts days between local days and lists a line with what it holds", () => {
    expect(daysSince("2026-10-29", new Date(2026, 10, 10, 23, 30))).toBe(12);
    expect(daysSince("2026-11-10", new Date(2026, 10, 10, 0, 5))).toBe(0);
    expect(
      cookedLine({ line: 1, date: "2026-10-27", verdict: "geht so", note: "mehr Chili" }),
    ).toBe("27 Oct · geht so · mehr Chili");
    expect(cookedLine({ line: 1, date: "2026-01-02", verdict: null, note: null })).toBe("2 Jan");
  });

  it("takes the last note from the newest line that has one", () => {
    expect(
      lastNote([
        { line: 1, date: "2026-10-02", verdict: null, note: "mit Limette" },
        { line: 2, date: "2026-10-27", verdict: "gern wieder", note: "mehr Chili" },
        { line: 3, date: "2026-11-01", verdict: "geht so", note: null },
      ]),
    ).toBe("mehr Chili");
    expect(lastNote([])).toBeNull();
  });
});
