/**
 * The side of an exercise page: its estimated 1RM over the weeks, its records, its last days and
 * the blocks that plan it. Pure reads over `GET /api/training` and the block notes, then the DOM.
 */

import { element, shortDate } from "@/lib/log/training/block/block-calendar";
import type { HeldBlock } from "@/lib/log/training/block/blocks";
import type { TrainingDay } from "@/lib/log/training/exercises";
import { bestsOf, liftWeeks } from "@/lib/log/training/progress";
import { dayLabel, written } from "@/lib/log/training/session/lines";
import type { TrainingEntry } from "@/lib/log/training/training-lines";

const SVG = "http://www.w3.org/2000/svg";
const LAST = 5;
const WIDTH = 300;
const HEIGHT = 80;
const PAD = 6;

/** A block that plans the exercise, by its note's name, and the sessions or cardio it sits in. */
export interface UsedIn {
  name: string;
  path: string;
  where: string[];
}

/** The blocks whose sessions or cardio name `exercise`, newest start first. */
export function blocksWith(blocks: HeldBlock[], exercise: string): UsedIn[] {
  return blocks
    .flatMap(({ path, block }) => {
      const where = [...block.sessions]
        .filter(([, lines]) => lines.some((p) => p.exercise === exercise))
        .map(([letter]) => `session ${letter}`);
      if (block.cardio.some((target) => target.exercise === exercise)) where.push("cardio");
      const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/u, "");
      return where.length === 0 ? [] : [{ name, path, where, start: block.start }];
    })
    .sort((a, b) => b.start.localeCompare(a.start))
    .map(({ name, path, where }) => ({ name, path, where }));
}

/** A day's lines of one exercise in short: sets for a lift, minutes and km for cardio. */
function entryWords(entries: TrainingEntry[]): string {
  const cardio = entries.filter((e) => e.minutes !== undefined);
  if (cardio.length === 0) return dayLabel(entries);
  return cardio
    .map((e) => [`${written(e.minutes ?? 0)} min`, e.km === undefined ? "" : `${written(e.km)} km`])
    .map((parts) => parts.filter((part) => part !== "").join(" · "))
    .join(", ");
}

/** The last days that hold `exercise`, newest first, each in short. */
export function lastDays(days: TrainingDay[], exercise: string): { date: string; words: string }[] {
  return days
    .map((day) => ({ date: day.date, entries: day.entries.filter((e) => e.exercise === exercise) }))
    .filter((day) => day.entries.length > 0)
    .reverse()
    .slice(0, LAST)
    .map((day) => ({ date: day.date, words: entryWords(day.entries) }));
}

/** The weekly e1RM as a line, scaled from its lowest to its highest; null under two weeks. */
function trend(weeks: (number | null)[], label: string): SVGSVGElement | null {
  // From the first week logged, so a lift begun lately still fills the width.
  const first = weeks.findIndex((value) => value !== null);
  const values = first === -1 ? [] : weeks.slice(first);
  const points = values.flatMap((value, index) => (value === null ? [] : [{ index, value }]));
  if (points.length < 2) return null;
  const low = Math.min(...points.map((p) => p.value));
  const high = Math.max(...points.map((p) => p.value));
  const span = high - low || 1;
  const x = (index: number) => PAD + (index / Math.max(1, values.length - 1)) * (WIDTH - 2 * PAD);
  const y = (value: number) => HEIGHT - PAD - ((value - low) / span) * (HEIGHT - 2 * PAD);
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);
  svg.setAttribute("class", "cm-exercise-trend");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", label);
  const line = document.createElementNS(SVG, "polyline");
  line.setAttribute("points", points.map((p) => `${x(p.index)},${y(p.value)}`).join(" "));
  const last = points.at(-1) ?? { index: 0, value: low };
  const dot = document.createElementNS(SVG, "circle");
  dot.setAttribute("cx", `${x(last.index)}`);
  dot.setAttribute("cy", `${y(last.value)}`);
  dot.setAttribute("r", "3.5");
  svg.append(line, dot);
  return svg;
}

function heading(text: string): HTMLElement {
  return element("h3", "cm-exercise-head", text);
}

function records(days: TrainingDay[], exercise: string): HTMLElement {
  const bests = bestsOf(days, exercise);
  const list = element("dl", "cm-exercise-records");
  const rows: [string, string][] = [
    ["Heaviest", bests.heaviest === null ? "—" : `${written(bests.heaviest)} kg`],
    ["Most reps", bests.reps === null ? "—" : `${bests.reps.reps} × ${written(bests.reps.kg)} kg`],
    ["Most volume", bests.volume === null ? "—" : `${Math.round(bests.volume)} kg`],
  ];
  for (const [name, value] of rows) {
    const row = element("div", "cm-exercise-record");
    row.append(element("dt", "", name), element("dd", "", value));
    list.append(row);
  }
  return list;
}

export interface HistoryInput {
  exercise: string;
  strength: boolean;
  days: TrainingDay[];
  blocks: HeldBlock[];
  starts: string[];
}

/** The side panel: the trend and records for a lift, then the last days and the blocks. */
export function historyPanel({ exercise, strength, days, blocks, starts }: HistoryInput) {
  const panel = element("section", "cm-exercise-history");
  panel.dataset.panel = "history";
  if (strength) {
    const weeks = liftWeeks(days, exercise, starts);
    const line = trend(
      weeks,
      `${exercise}: best estimated 1RM per week over ${starts.length} weeks`,
    );
    const last = weeks.filter((v): v is number => v !== null).at(-1);
    panel.append(
      heading(last === undefined ? "Estimated 1RM" : `Estimated 1RM · ${written(last)} kg`),
    );
    panel.append(line ?? element("p", "cm-exercise-quiet", "Fewer than two weeks logged."));
    panel.append(heading("Records"), records(days, exercise));
  }
  panel.append(heading("Last sets"));
  const sessions = lastDays(days, exercise);
  const recent = element("ul", "cm-exercise-list");
  for (const day of sessions) {
    const item = element("li", "");
    item.append(
      element("span", "cm-exercise-date", shortDate(day.date)),
      element("span", "", day.words),
    );
    recent.append(item);
  }
  panel.append(
    sessions.length === 0 ? element("p", "cm-exercise-quiet", "Not logged yet.") : recent,
  );
  const used = blocksWith(blocks, exercise);
  if (used.length > 0) {
    panel.append(heading("In blocks"));
    const list = element("ul", "cm-exercise-list");
    for (const block of used) {
      list.append(element("li", "", `${block.name} · ${block.where.join(", ")}`));
    }
    panel.append(list);
  }
  return panel;
}
