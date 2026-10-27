import { EditorView } from "@codemirror/view";
import type { LineHit, TodoHit } from "@/lib/api";
import type { LogDay } from "@/lib/log/food-api";
import { periodicNote } from "@/lib/periodic";
import type { ModelUseLine } from "@/lib/review-api";
import type { WrittenNote } from "@/lib/review-year";
import { renderApp, settle } from "./home-route-fixture";

/**
 * The shared data of the periodic review tests: one yearly note and one weekly note, the
 * reads the vault would answer for them, and the helpers that find what the review drew.
 * The doubles (`vi.hoisted` and `vi.mock`) stay in each test file, since `vi.mock` hoists
 * only in its own file; this holds what the files share and nothing that mocks.
 */

export { renderApp, settle };

/** Sunday, 25 October 2026: the week of the weekly note is the current one, and it is whole. */
export const NOW = new Date(2026, 9, 25, 9, 0);
export const YEAR_NOTE = "01 Periodic/04 Yearly/2026.md";
export const LAST_YEAR_NOTE = "01 Periodic/04 Yearly/2025.md";
export const NEXT_YEAR_NOTE = "01 Periodic/04 Yearly/2027.md";
export const WEEK_NOTE = "01 Periodic/01 Weekly/2026-W43.md";
export const NEXT_WEEK_NOTE = "01 Periodic/01 Weekly/2026-W44.md";
export const LOG_CONFIG = "99 Misc/01 Config/log.md";
export const TODAY = periodicNote("daily", NOW).path;

/** The log's config: a kcal ceiling, water, and a weight kind that is the last line of a day. */
export const CONFIG = "- 🍽 food: kcal max 2200\n- 💧 water: 250 ml\n- ⚖ weight: kg, last\n";

/** A note's own words, under the title and its link row, which the review must sit above. */
export const YEAR_TEXT =
  "# 2026\n\n[[01 Periodic/04 Yearly/2025]] | [[01 Periodic/04 Yearly/2027]]\n\nmy own line\n";
export const WEEK_TEXT = "# 2026-W43\n\nmy own line\n";

/** The day a daily note is named for, as the route reads it. */
export function dailyOf(date: string): string {
  return periodicNote("daily", new Date(`${date}T12:00:00`)).path;
}

/** One logged day: kcal on its food line, and a weigh-in when one is given. */
export function logged(date: string, kcal: number, weight?: number): LogDay {
  const mine =
    weight === undefined ? [] : [{ mark: "⚖", name: "weight", unit: "kg", total: weight }];
  return {
    date,
    path: dailyOf(date),
    entries: [{ line: 1, text: "- 🍽 lunch", kind: "food", kcal }],
    totals: {
      water: { ml: 0 },
      coffee: { count: 0 },
      alcohol: { count: 0, ml: 0, grams: 0 },
      food: { kcal, protein: 0, carbs: 0, fat: 0 },
      mine,
    },
  } as unknown as LogDay;
}

/** The days of the year that carry a log line, with the weigh-ins the year has. */
export const YEAR_LOG: LogDay[] = [
  logged("2026-01-05", 2000, 82.4),
  logged("2026-06-01", 2100, 81),
  logged("2026-10-20", 2300, 80.2),
];

/** The todos the year's review counts: two done in the FDE project, one done outside it, one open. */
export const YEAR_TODOS: TodoHit[] = [
  {
    path: "02 Projects/FDE/tasks.md",
    line: 3,
    text: "- [x] ship the export ✅ 2026-02-11 ⏱ 1h30m",
    project: "02 Projects/FDE",
    shared: false,
  },
  {
    path: "02 Projects/FDE/tasks.md",
    line: 4,
    text: "- [x] write the spec ✅ 2026-03-01 ⏱ 45m",
    project: "02 Projects/FDE",
    shared: false,
  },
  {
    path: "00 Inbox/tasks.md",
    line: 1,
    text: "- [x] tidy the inbox ✅ 2026-10-02",
    project: null,
    shared: false,
  },
  { path: "00 Inbox/tasks.md", line: 2, text: "- [ ] open thing", project: null, shared: false },
];

/** The notes written in the year, one each, with the tags and the project folder each one carries. */
export const YEAR_NOTES: WrittenNote[] = [
  { path: "02 Projects/FDE/a.md", day: "2026-01-05", tags: ["work"], project: "02 Projects/FDE" },
  {
    path: "02 Projects/FDE/b.md",
    day: "2026-02-10",
    tags: ["work", "fde"],
    project: "02 Projects/FDE",
  },
  { path: "00 Inbox/c.md", day: "2026-02-11", tags: ["fde"], project: null },
  { path: "00 Inbox/d.md", day: "2026-02-12", tags: ["reading"], project: null },
  { path: "00 Inbox/e.md", day: "2026-03-01", tags: ["reading"], project: null },
  { path: "00 Inbox/f.md", day: "2026-10-03", tags: [], project: null },
];

/** The flashcards: the deck note marked with a tag, and two cards rated in the year. */
export const CARDS: LineHit[] = [
  { path: "00 Inbox/cards.md", line: 1, text: "#flashcards/aws" },
  { path: "00 Inbox/cards.md", line: 2, text: "Q :: A <!--SR:!2026-10-20,3,270-->" },
  { path: "00 Inbox/cards.md", line: 3, text: "Q2 :: A <!--SR:!2026-03-11,4,270-->" },
];

/** GitHub's answer for the year, which the grid counts. */
export const YEAR_GITHUB = { on: true, days: { "2026-01-05": 3, "2026-10-20": 5 } };

/**
 * The collector's lines for the year: kasten in February and October, blattwerk in both, its
 * October line with no price, and scratch with no price at all. The sums the review draws:
 * 1,551,100 tokens (1.6M) and $1,205.05; kasten 1.2M and $1,204.55; 340,100 tokens unpriced.
 */
export const YEAR_MODEL_USE: ModelUseLine[] = [
  {
    day: "2026-02-11",
    model: "claude-opus-5-5",
    project: "kasten",
    input: 1000,
    output: 2000,
    cache_write: 3000,
    cache_read: 4000,
    cost: 4.1,
    unpriced: 0,
  },
  {
    day: "2026-02-12",
    model: "claude-haiku-5-5",
    project: "blattwerk",
    input: 500,
    output: 500,
    cache_write: 0,
    cache_read: 0,
    cost: 0.5,
    unpriced: 0,
  },
  {
    day: "2026-10-03",
    model: "claude-opus-5-5",
    project: "kasten",
    input: 1000000,
    output: 200000,
    cache_write: 0,
    cache_read: 0,
    cost: 1200.45,
    unpriced: 0,
  },
  {
    day: "2026-10-04",
    model: "claude-haiku-5-5",
    project: "blattwerk",
    input: 300000,
    output: 40000,
    cache_write: 0,
    cache_read: 0,
    cost: null,
    unpriced: 0,
  },
  {
    day: "2026-10-06",
    model: "claude-haiku-5-5",
    project: "scratch",
    input: 60,
    output: 20,
    cache_write: 10,
    cache_read: 10,
    cost: null,
    unpriced: 0,
  },
];

/** The week's log: the weigh-in before it, then five logged days, one of them over the kcal ceiling. */
export const WEEK_LOG: LogDay[] = [
  logged("2026-10-12", 0, 80.8),
  logged("2026-10-19", 2100, 80.6),
  logged("2026-10-20", 2300),
  logged("2026-10-21", 1800),
  logged("2026-10-23", 2000),
  logged("2026-10-25", 2150, 80.2),
];

/** The daily notes of the week that hold time: 90 minutes on the 20th. */
export const WEEK_DAILY: Record<string, string> = {
  [dailyOf("2026-10-20")]: "# 2026-10-20 Tuesday\n\n## Time\n- 09:00-10:30 wire\n",
};

/** The todos the week counts: two done in it and one open with a due date in it, carried over. */
export const WEEK_TODOS: TodoHit[] = [
  {
    path: "02 Projects/FDE/tasks.md",
    line: 3,
    text: "- [x] ship the export ✅ 2026-10-20",
    project: "02 Projects/FDE",
    shared: false,
  },
  {
    path: "00 Inbox/tasks.md",
    line: 7,
    text: "- [x] reply to Anna ✅ 2026-10-22 ⏱ 10m",
    project: null,
    shared: false,
  },
  {
    path: "00 Inbox/tasks.md",
    line: 8,
    text: "- [ ] send the deck 📅 2026-10-22",
    project: null,
    shared: false,
  },
];

/** One flashcard rated on the 22nd, in the deck. */
export const WEEK_CARDS: LineHit[] = [
  { path: "00 Inbox/cards.md", line: 1, text: "#flashcards/aws" },
  { path: "00 Inbox/cards.md", line: 2, text: "Q :: A <!--SR:!2026-10-23,1,270-->" },
];

/** GitHub's answer for the week: 23 contributions across two days. */
export const WEEK_GITHUB = { on: true, days: { "2026-10-20": 4, "2026-10-22": 19 } };

/** The text the editor holds, which is the note's own text and never the review's words. */
export function docText(): string {
  const view = EditorView.findFromDOM(
    document.querySelector<HTMLElement>(".cm-content") as HTMLElement,
  );
  return view?.state.doc.toString() ?? "";
}

/** The label of the chart drawn under a section's heading, or the empty string if none. */
export function labelIn(heading: string): string {
  const section = [...document.querySelectorAll<HTMLElement>(".review-section")].find(
    (each) => each.querySelector(".review-heading")?.textContent === heading,
  );
  return section?.querySelector("svg")?.getAttribute("aria-label") ?? "";
}

/** The year's numbers beside the main column, each as its label and its figure. */
export function statsOf(): string[][] {
  return [...document.querySelectorAll<HTMLElement>(".review-aside .review-number")].map((stat) => [
    stat.querySelector(".review-tile-label")?.textContent ?? "",
    stat.querySelector(".review-figure")?.textContent ?? "",
  ]);
}

/** Every word the review block drew, or the empty string while nothing is drawn. */
export function reviewText(): string {
  return document.querySelector(".cm-review")?.textContent ?? "";
}

/** The section of the review under `heading`, as its text, or the empty string if none. */
export function sectionText(heading: string): string {
  const section = [...document.querySelectorAll<HTMLElement>(".review-section")].find(
    (each) => each.querySelector(".review-heading")?.textContent === heading,
  );
  return section?.textContent ?? "";
}
