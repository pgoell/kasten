/**
 * What the recipe view and cook mode read out of a recipe beyond its numbers: the ingredients a
 * step names, the time a step names, and the meals cooked under `## Gekocht`.
 */

import type { Ingredient, Recipe } from "@/lib/log/food-api";

export type Cooked = Recipe["cooked"][number];

/** A number as the card writes it: at most `places` decimals, and no trailing zeros. */
export function shown(value: number, places = 1): string {
  return String(Number(value.toFixed(places)));
}

/** Every `🏷` barcode pinned to a line, which the card leaves out, as the backend's `PIN` does. */
const PIN = /[ \t]*🏷️?[ \t]*[0-9]{8,14}\b/gu;

/**
 * The line as written at the note's own servings; otherwise its quantity, and the upper end of
 * a range, times `factor`, as `3-4.5 Zwiebeln`.
 */
export function scaledLine(item: Ingredient, factor: number): string {
  if (factor === 1 || item.quantity === null) return item.text.replace(PIN, "").trim();
  const upper = item.quantity_to === null ? "" : `-${shown(item.quantity_to * factor, 2)}`;
  return `${shown(item.quantity * factor, 2)}${upper} ${item.rest}`.trim();
}

/** Plural and case endings, as the backend's `SUFFIXES`, so `Zwiebeln` finds `Zwiebel`. */
const SUFFIXES = ["en", "n", "e", "s"];

function stem(word: string): string {
  const key = word.toLowerCase();
  for (const suffix of SUFFIXES) {
    if (key.endsWith(suffix) && key.length > suffix.length + 2) return key.slice(0, -suffix.length);
  }
  return key;
}

/** A capitalised word: in German that is a noun, the only kind of word that names a food. */
const NOUN = /\p{Lu}[\p{L}-]*/gu;

/**
 * The ingredients `step` names, in the recipe's order. A noun of the step names a food when the
 * food's word ends in it, so `Bohnen` finds `Kidneybohnen` and `Öl` finds `Olivenöl`.
 */
export function stepIngredients(step: string, ingredients: Ingredient[]): Ingredient[] {
  const nouns = [...step.matchAll(NOUN)].map((found) => stem(found[0]));
  return ingredients.filter((item) => {
    const words = item.food
      .split(/[\s-]+/)
      .filter(Boolean)
      .map(stem);
    return words.some((word) => nouns.some((noun) => word.endsWith(noun)));
  });
}

const [MINUTE, HOUR] = [60, 3600];
const TIME =
  /(\d+(?:[.,]\d+)?)(?:\s*(?:-|–|bis)\s*\d+(?:[.,]\d+)?)?\s*(sekunden|sek\b\.?|seconds?|minuten|minute|min\b\.?|minutes?|stunden|stunde|std\b\.?|hours?)/iu;

/** The seconds the first time a step names takes, its lower end for a range, or null for none. */
export function stepSeconds(step: string): number | null {
  const [, number = "", word = ""] = TIME.exec(step) ?? [];
  if (number === "") return null;
  const amount = Number(number.replace(",", "."));
  const unit = word.toLowerCase();
  const each = /^(st|h)/.test(unit) ? HOUR : unit.startsWith("s") ? 1 : MINUTE;
  const seconds = Math.round(amount * each);
  return seconds > 0 ? seconds : null;
}

/** Seconds as a clock: `8:00`, or `1:30:00` past an hour. */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  const [hours, minutes, rest] = [
    Math.floor(whole / 3600),
    Math.floor(whole / 60) % 60,
    whole % 60,
  ];
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

/** The cooked lines, newest first; two on one day keep the note's order. */
export function newestFirst(cooked: Cooked[]): Cooked[] {
  return [...cooked].sort((a, b) => b.date.localeCompare(a.date) || a.line - b.line);
}

const DAY_MS = 86_400_000;

/** Whole days from the day `iso` to `today`, both read as local days. */
export function daysSince(iso: string, today: Date): number {
  const [year = 0, month = 1, day = 1] = iso.split("-").map(Number);
  const then = Date.UTC(year, month - 1, day);
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((now - then) / DAY_MS);
}

function ago(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/** The view's line of facts: the last answer, how often and how long ago, the time, the site. */
export function recipeFacts(recipe: Recipe, today: Date): string[] {
  const facts: string[] = [];
  const cooked = newestFirst(recipe.cooked);
  const answered = cooked.find((item) => item.verdict !== null);
  if (answered?.verdict) facts.push(answered.verdict);
  const [newest] = cooked;
  if (newest !== undefined) {
    facts.push(`cooked ${cooked.length}×, last ${ago(daysSince(newest.date, today))}`);
  }
  if (recipe.time) facts.push(recipe.time);
  const site = host(recipe.source);
  if (site) facts.push(site);
  return facts;
}

function host(source: string | null): string | null {
  if (!source) return null;
  try {
    return new URL(source).hostname.replace(/^www\./, "");
  } catch (error) {
    if (error instanceof TypeError) return source;
    throw error;
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A cooked line as the view lists it: `27 Oct · geht so · mehr Chili`. */
export function cookedLine(item: Cooked): string {
  const [, month = 1, day = 1] = item.date.split("-").map(Number);
  return [`${day} ${MONTHS[month - 1] ?? ""}`, item.verdict, item.note].filter(Boolean).join(" · ");
}

/** The note from the newest cooked line that has one, to read while cooking. */
export function lastNote(cooked: Cooked[]): string | null {
  return newestFirst(cooked).find((item) => item.note !== null)?.note ?? null;
}
