/**
 * The week plan's two requests, and the words its card shows: a batch's band, a meal's cell,
 * the week's dates and the protein on training days. The format is
 * `docs/reference/food/meal-plan.md`.
 */

import type { components } from "@/lib/api-types";
import { client, reason } from "@/lib/core/api-client";
import { readField } from "@/lib/notes/text/note-frontmatter";

export type MealPlan = components["schemas"]["MealPlan"];
export type PlannedMeal = components["schemas"]["PlannedMeal"];
export type Batch = components["schemas"]["Batch"];
export type ShoppingWritten = components["schemas"]["ShoppingWritten"];

export const DAY_NAMES = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

/** Whether the note's frontmatter says it is a week plan: `type: Meal Plan`, in any case. */
export function isMealPlan(text: string): boolean {
  const type = readField(text, "type")?.replace(/["']/g, "").toLowerCase();
  return type === "meal plan";
}

export async function readMealPlan(text: string, signal?: AbortSignal): Promise<MealPlan> {
  const { data, error, response } = await client.POST("/api/meal-plan", { body: { text }, signal });
  if (!data) throw new Error(reason(error) ?? `POST /api/meal-plan failed with ${response.status}`);
  return data;
}

export async function writeShopping(text: string): Promise<ShoppingWritten> {
  const { data, error, response } = await client.POST("/api/meal-plan/shopping", {
    body: { text },
  });
  if (!data) {
    throw new Error(reason(error) ?? `POST /api/meal-plan/shopping failed with ${response.status}`);
  }
  return data;
}

/** `Woche 46 · 9.–15. Nov`, or `Woche` alone for a plan that names no week. */
export function weekTitle(plan: MealPlan): string {
  const first = plan.days[0]?.date;
  const last = plan.days[6]?.date;
  if (plan.week === null || !first || !last) return "Woche";
  const [, , day1 = "1"] = first.split("-");
  const [, month = "1", day7 = "1"] = last.split("-");
  const number = Number(plan.week.split("W")[1]);
  return `Woche ${number} · ${Number(day1)}.–${Number(day7)}. ${MONTHS[Number(month) - 1]}`;
}

/** The meal's words without its link brackets: `[[Linsen-Dal|Dal]]` reads `Dal`. */
export function plainText(text: string): string {
  return text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, name: string, alias?: string) =>
    (alias ?? name).trim(),
  );
}

/** What a meal's cell says: the dish to cook and how many, the batch it eats from, or its words. */
export function cellText(meal: PlannedMeal): string {
  if (meal.kind === "cook" && meal.recipe !== null) {
    return meal.servings === null
      ? `${meal.recipe} kochen`
      : `${meal.recipe} kochen ×${meal.servings}`;
  }
  if (meal.kind === "from" && meal.recipe !== null) return meal.recipe;
  return plainText(meal.text).replace(/👤.*$/u, "").trim();
}

/** What a band says under its dish: the days it covers and the servings left after them. */
export function bandText(batch: Batch): string {
  if (batch.state === "earlier") return `aus der Vorwoche · bis ${DAY_NAMES[batch.last_day]}`;
  const first = batch.first_day;
  const days =
    first === batch.last_day
      ? DAY_NAMES[first]
      : `${DAY_NAMES[first]}–${DAY_NAMES[batch.last_day]}`;
  if (batch.left === null) return `${days} · ${batch.eaten} Mahlzeiten`;
  if (batch.left < 0) return `${days} · ${-batch.left} zu wenig`;
  return `${days} · ${batch.left} übrig`;
}

/** The band's warning for its first meal past the fridge limit, as `Sa ist Tag 3: einfrieren?`. */
export function freezeWarning(index: number, meals: PlannedMeal[]): string | null {
  const late = meals.find((meal) => meal.batch === index && meal.freeze);
  if (late?.fridge_day == null) return null;
  return `${DAY_NAMES[late.day]} ist Tag ${late.fridge_day}: einfrieren?`;
}

/** `Ø 128 g · Ziel 120` over the training days the plan gives protein for, or null for none. */
export function trainingProtein(plan: MealPlan): string | null {
  const grams = plan.days
    .filter((day) => day.training && day.protein !== null)
    .map((day) => day.protein ?? 0);
  if (grams.length === 0) return null;
  const mean = Math.round(grams.reduce((sum, value) => sum + value, 0) / grams.length);
  const goal = plan.protein_goal;
  return goal === null ? `Ø ${mean} g` : `Ø ${mean} g · Ziel ${Math.round(goal.value)}`;
}

/** Each batch's lane, so bands whose days overlap sit side by side, and how many lanes. */
export function lanes(plan: MealPlan): { lane: number[]; count: number } {
  const ends: number[] = [];
  const lane = plan.batches.map((batch) => {
    const first = batch.first_day;
    let at = ends.findIndex((end) => end < first);
    if (at === -1) at = ends.length;
    ends[at] = batch.last_day;
    return at;
  });
  return { lane, count: Math.max(1, ends.length) };
}
