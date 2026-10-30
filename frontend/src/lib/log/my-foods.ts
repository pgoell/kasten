/**
 * Foods of your own, one per line in `99 Misc/01 Config/foods.md`, so they can be read and fixed by hand.
 * The figures are per 100 g. The serving (100 g when left out) and the barcode are optional.
 */

import { createNote, fetchNote, NoteMissing, updateNote } from "@/lib/api";
import { FOODS_NOTE } from "@/lib/layout";
import type { Choice } from "@/lib/log/food-search";
import type { BrokenLine } from "@/lib/log/log-kinds";
import { parseFood, tenth } from "@/lib/log/log-lines";

/** The four nutrients, null where the line gives none. */
export interface Nutrients {
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}

export interface MyFood {
  name: string;
  serving_g: number;
  code: string | null;
  per_100g: Nutrients;
}

export interface MyFoods {
  foods: MyFood[];
  broken: BrokenLine[];
}

const NUMBER = "[0-9]{1,9}(?:[.,][0-9]{1,9})?";
// The name is lazy and the rest anchored, so a colon inside the name is passed over
// until the part after a colon reads as serving, barcode and fields.
const LINE = new RegExp(
  `^- (.+?):[ \\t]+(?:(${NUMBER})[ \\t]*g,[ \\t]+)?(?:🏷️?[ \\t]+([0-9]{8,14}),[ \\t]+)?([🔥🥩🍞🧈].*)$`,
  "u",
);
/** What a name may not hold, since the line would read it as its own syntax. */
const SYNTAX = /[🔥🥩🍞🧈🏷]️?|[\r\n\t]/gu;

/** The food a line names, or null for a line that does not read as one. */
export function parseMyFood(line: string): MyFood | null {
  const found = LINE.exec(line);
  if (found === null) return null;
  const name = (found[1] ?? "").trim();
  const serving_g = found[2] === undefined ? 100 : Number(found[2].replace(",", "."));
  // The fields read as a food line's fields do, so the two formats cannot drift apart.
  const fields = parseFood(`- 🍽 x ${found[4]}`);
  if (name === "" || serving_g <= 0 || fields === null || fields.words !== "x") return null;
  return {
    name,
    serving_g,
    code: found[3] ?? null,
    per_100g: {
      kcal: fields.kcal ?? null,
      protein: fields.protein ?? null,
      carbs: fields.carbs ?? null,
      fat: fields.fat ?? null,
    },
  };
}

/** The foods a note names, and its `- ` lines that name none. The frontmatter holds no food. */
export function parseMyFoods(note: string): MyFoods {
  const lines = note.split("\n");
  const close = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
  const foods: MyFood[] = [];
  const broken: BrokenLine[] = [];
  for (const [index, text] of lines.entries()) {
    if (index <= close || !text.startsWith("- ")) continue;
    const food = parseMyFood(text);
    if (food === null) broken.push({ line: index + 1, text });
    else foods.push(food);
  }
  return { foods, broken };
}

/** A food of your own as the form takes it, its figures scaled from 100 g to its serving. */
export function myChoice(food: MyFood): Choice {
  const scale = (value: number | null) => (value === null ? null : (value * food.serving_g) / 100);
  const { kcal, protein, carbs, fat } = food.per_100g;
  return {
    name: food.name,
    brand: null,
    serving_g: food.serving_g,
    per_serving: {
      kcal: scale(kcal),
      protein: scale(protein),
      carbs: scale(carbs),
      fat: scale(fat),
    },
  };
}

/** A name with nothing the line would read as syntax left in. */
export function cleanName(name: string): string {
  return name.replace(SYNTAX, " ").replace(/ {2,}/g, " ").trim();
}

/** The line `parseMyFood` reads back to the same food, figures to a tenth. */
export function myFoodLine(food: MyFood): string {
  const { kcal, protein, carbs, fat } = food.per_100g;
  const fields: [string, number | null][] = [
    ["🔥", kcal],
    ["🥩", protein],
    ["🍞", carbs],
    ["🧈", fat],
  ];
  const written = fields.flatMap(([mark, value]) =>
    value === null ? [] : [`${mark} ${tenth(value)}`],
  );
  const code = food.code === null ? "" : `🏷 ${food.code}, `;
  return `- ${cleanName(food.name)}: ${tenth(food.serving_g)} g, ${code}${written.join(" ")}`;
}

/**
 * The foods of the note. A missing note is none, and one that fails to load is
 * named in the console and none too, so the search still runs on Open Food Facts.
 */
export async function fetchMyFoods(): Promise<MyFoods> {
  try {
    return parseMyFoods(await fetchNote(FOODS_NOTE));
  } catch (error) {
    if (error instanceof NoteMissing) return { foods: [], broken: [] };
    if (!(error instanceof Error)) throw error;
    console.warn(error.message);
    return { foods: [], broken: [] };
  }
}

/** Adds the food's line at the end of the note, making the note where there is none. */
export async function addMyFood(food: MyFood): Promise<void> {
  const line = myFoodLine(food);
  try {
    await updateNote(FOODS_NOTE, (text) =>
      text === "" || text.endsWith("\n") ? `${text}${line}\n` : `${text}\n${line}\n`,
    );
  } catch (error) {
    if (!(error instanceof NoteMissing)) throw error;
    await createNote(FOODS_NOTE, `${line}\n`);
  }
}
