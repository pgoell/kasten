import { ARCHIVE, IMAGE_FOLDER, INBOX, type Layout, PERIODIC } from "@/lib/layout";
import type { LogDay } from "@/lib/log/food-api";
import { periodicNote } from "@/lib/periodic";
import { renderApp, settle } from "./home-route-fixture";

/**
 * The shared helpers of the overview's route tests. The doubles (`vi.hoisted` and `vi.mock`)
 * stay in each test file, since `vi.mock` hoists only in its own file; this holds what the
 * files share and nothing that mocks.
 */

export const NOW = new Date(2026, 9, 20, 9, 0);
export const TODAY = periodicNote("daily", NOW).path;
export const YEAR = periodicNote("yearly", NOW).path;
export const LOG_CONFIG = "99 Misc/01 Config/log.md";
/** Eighty-nine days before today: the first of the ninety days the overview reads. */
export const FROM = "2026-07-23";
/** A food goal of at most 2,200 kcal and a water floor of 2,000 ml, as the config note writes them. */
export const GOALS = "- 🍽 food: kcal max 2200\n- 💧 water: 250 ml, min 2000\n";

/** The layout the defaults make, read before any test moves it. */
export const DEFAULT_LAYOUT: Layout = {
  inbox: INBOX,
  periodic: PERIODIC,
  archive: ARCHIVE,
  images: IMAGE_FOLDER,
  config: "99 Misc/01 Config",
};

/**
 * One day of the log as `GET /api/log` answers it, with the kcal and water on it. A day with
 * kcal has a food line, since a day with no food line is no day within the kcal goal.
 */
export function day(date: string, kcal: number, ml = 0): LogDay {
  return {
    date,
    path: `01 Periodic/00 Daily/${date}.md`,
    entries: kcal > 0 ? [{ line: 1, text: `- 🍽 🔥 ${kcal} kcal`, kind: "food", kcal }] : [],
    totals: {
      water: { ml },
      coffee: { count: 0 },
      alcohol: { count: 0, ml: 0, grams: 0 },
      food: { kcal, protein: 0, carbs: 0, fat: 0 },
      mine: [],
    },
  };
}

/** A flashcard line as `GET /api/cards` answers it, with the schedule its text carries. */
export function card(text: string, line = 1) {
  return { path: "00 Inbox/cards.md", line, text };
}

export const NAMES = [
  "Food",
  "Today",
  "Weight",
  "Water",
  "Flashcards",
  "Todos",
  "Writing",
  "This year",
];

export const overview = () => document.querySelector<HTMLElement>("[aria-label='Overview']");

/** A note's path as the route writes it into the URL, where a space is a plus. */
export const encodedPath = (path: string) => encodeURIComponent(path).replaceAll("%20", "+");

/** The card with this name: its article, found by its heading. */
export function cardOf(name: string): HTMLElement {
  const found = [...(overview()?.querySelectorAll<HTMLElement>("article") ?? [])].find(
    (article) => article.querySelector("h2")?.textContent === name,
  );
  if (found === undefined) throw new Error(`no card named ${name}`);
  return found;
}

/** The pane's words under a card, which the card's line of words is. */
export const wordsOf = (name: string) => cardOf(name).querySelector(".overview-words")?.textContent;
export const figureOf = (name: string) =>
  cardOf(name).querySelector(".overview-figure")?.textContent;
/** The visible line under a card's chart, which says what the chart shows. */
export const captionOf = (name: string) =>
  cardOf(name).querySelector(".overview-caption")?.textContent;

/** Open the overview from the home screen with the leader, as a reader does. */
export async function openOverview() {
  const app = await renderApp("/");
  await settle();
  app.leader("g", "a");
  await settle();
  expect(overview()).not.toBeNull();
  return app;
}
