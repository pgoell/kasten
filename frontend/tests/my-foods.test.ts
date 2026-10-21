import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNote, fetchNote, NoteMissing, updateNote } from "@/lib/api";
import {
  addMyFood,
  fetchMyFoods,
  type MyFood,
  myFoodLine,
  parseMyFood,
  parseMyFoods,
} from "@/lib/my-foods";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  fetchNote: vi.fn(),
  updateNote: vi.fn(),
  createNote: vi.fn(),
}));

const NOTE = "99 Misc/01 Config/foods.md";

const CHIPS: MyFood = {
  name: "ja! Choco Chips",
  serving_g: 30,
  code: "4337185123456",
  per_100g: { kcal: 486, protein: 6.4, carbs: 61, fat: 23 },
};
const CHIPS_LINE = "- ja! Choco Chips: 30 g, 🏷 4337185123456, 🔥 486 🥩 6.4 🍞 61 🧈 23";

describe("the foods note", () => {
  it("#799 a full line reads as the food, its figures per 100 g", () => {
    expect(parseMyFood(CHIPS_LINE)).toEqual(CHIPS);
  });

  it("#799 the serving and the barcode are optional, the serving then 100 g", () => {
    expect(parseMyFood("- Skyr: 🔥 62 🥩 11")).toEqual({
      name: "Skyr",
      serving_g: 100,
      code: null,
      per_100g: { kcal: 62, protein: 11, carbs: null, fat: null },
    });
  });

  it("#799 a comma decimal, units and any field order read", () => {
    expect(parseMyFood("- Brot: 50,5 g, 🧈 1,5 g 🔥 240 kcal")?.per_100g).toEqual({
      kcal: 240,
      protein: null,
      carbs: null,
      fat: 1.5,
    });
    expect(parseMyFood("- Brot: 50,5 g, 🔥 240")?.serving_g).toBe(50.5);
  });

  it("#799 a colon in the name stays in the name", () => {
    expect(parseMyFood("- Mix: Nuss 30 g: 25 g, 🔥 600")).toMatchObject({
      name: "Mix: Nuss 30 g",
      serving_g: 25,
    });
  });

  it("#799 lines that name no food are null", () => {
    for (const line of [
      "- Toast",
      "- Toast: 30 g",
      "- : 🔥 100",
      "- Toast: 0 g, 🔥 100",
      "- Toast: 🔥 100 🔥 200",
      "- Toast: 🔥 100 kcal extra",
      "- Toast: 🏷 123, 🔥 100",
      "- Toast: 🥩 5 kcal",
    ]) {
      expect(parseMyFood(line), line).toBeNull();
    }
  });

  it("#799 a note lists its foods and its broken - lines, past the frontmatter", () => {
    const note = `---\nid: x\n- not a food\n---\n# Foods\n\n${CHIPS_LINE}\n- Toast\ntext\n`;
    expect(parseMyFoods(note)).toEqual({
      foods: [CHIPS],
      broken: [{ line: 8, text: "- Toast" }],
    });
  });

  it("#799 a written line reads back to the same food", () => {
    expect(myFoodLine(CHIPS)).toBe(CHIPS_LINE);
    const bare: MyFood = {
      name: "Toast",
      serving_g: 100,
      code: null,
      per_100g: { kcal: 250, protein: null, carbs: null, fat: 0 },
    };
    expect(myFoodLine(bare)).toBe("- Toast: 100 g, 🔥 250 🧈 0");
    expect(parseMyFood(myFoodLine(bare))).toEqual(bare);
  });

  it("#799 a name holding a marker or a line break is written so it reads back", () => {
    const food = { ...CHIPS, name: "Chips 🔥 hot\nbag", code: null };
    const line = myFoodLine(food);
    expect(line).toBe("- Chips hot bag: 30 g, 🔥 486 🥩 6.4 🍞 61 🧈 23");
    expect(parseMyFood(line)?.name).toBe("Chips hot bag");
  });
});

describe("reading and adding foods", () => {
  beforeEach(() => {
    vi.mocked(fetchNote).mockReset();
    vi.mocked(updateNote).mockReset();
    vi.mocked(createNote).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("#799 a missing note is no foods", async () => {
    vi.mocked(fetchNote).mockRejectedValue(new NoteMissing(NOTE));
    expect(await fetchMyFoods()).toEqual({ foods: [], broken: [] });
  });

  it("#799 a note that fails to load is no foods and a console warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(fetchNote).mockRejectedValue(new Error("GET failed with 500"));
    expect(await fetchMyFoods()).toEqual({ foods: [], broken: [] });
    expect(warn).toHaveBeenCalledWith("GET failed with 500");
  });

  it("#799 adding appends the line at the end of the note", async () => {
    vi.mocked(updateNote).mockResolvedValue(null);
    await addMyFood(CHIPS);
    const change = vi.mocked(updateNote).mock.calls[0]?.[1];
    expect(vi.mocked(updateNote).mock.calls[0]?.[0]).toBe(NOTE);
    expect(change?.("# Foods\n")).toBe(`# Foods\n${CHIPS_LINE}\n`);
    expect(change?.("# Foods")).toBe(`# Foods\n${CHIPS_LINE}\n`);
    expect(createNote).not.toHaveBeenCalled();
  });

  it("#799 adding to a missing note makes it with the line", async () => {
    vi.mocked(updateNote).mockRejectedValue(new NoteMissing(NOTE));
    await addMyFood(CHIPS);
    expect(createNote).toHaveBeenCalledWith(NOTE, `${CHIPS_LINE}\n`);
  });
});
