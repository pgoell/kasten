/**
 * The block card's two halves as DOM: the calendar of the block's weeks, a session letter on each
 * planned day, and the exercise library beside it on a wide pane, filtered by muscle.
 */

import { shiftDay } from "@/lib/core/clock";
import { type Block, DAY_NAMES, weekdayOf, weekIndex } from "@/lib/log/training/block/block-note";
import type { Exercise, TrainingDay } from "@/lib/log/training/exercises";

/** What a drag from the library carries: the exercise's name. */
export const EXERCISE_DRAG = "application/x-kasten-exercise";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  made.className = className;
  if (text !== undefined) made.textContent = text;
  return made;
}

/** `2026-11-16` as `16 Nov`. */
export function shortDate(date: string): string {
  return `${Number(date.slice(8))} ${MONTHS[Number(date.slice(5, 7)) - 1] ?? ""}`;
}

interface DayFacts {
  done: boolean;
  cardio: boolean;
}

function factsOf(days: TrainingDay[]): Map<string, DayFacts> {
  return new Map(
    days.map((day) => [
      day.date,
      {
        done: day.entries.some((entry) => entry.kind === "strength"),
        cardio: day.entries.some((entry) => entry.minutes !== undefined),
      },
    ]),
  );
}

export interface CalendarProps {
  block: Block;
  days: TrainingDay[];
  today: string;
  /** A day was chosen, by a click or a drop: Monday 0, and the exercise dropped, if any. */
  onDay: (weekday: number, dropped: string | null) => void;
  picking: boolean;
}

function dayCell(
  date: string,
  letter: string | null,
  facts: DayFacts | undefined,
  props: CalendarProps,
) {
  const cell = element("button", "cm-block-day");
  cell.type = "button";
  const done = facts?.done === true;
  cell.classList.toggle("is-done", done);
  cell.classList.toggle("is-planned", letter !== null && !done);
  cell.classList.toggle("is-today", date === props.today);
  cell.append(element("span", "cm-block-date", String(Number(date.slice(8)))));
  cell.append(element("span", "cm-block-letter", letter ?? (done ? "•" : "")));
  if (facts?.cardio === true) cell.append(element("span", "cm-block-cardio", "♥"));
  const words = [
    `${DAY_NAMES[weekdayOf(date)]} ${shortDate(date)}`,
    letter === null ? "rest day" : `session ${letter}`,
    done ? "done" : letter === null ? "" : "planned",
    facts?.cardio === true ? "cardio" : "",
  ].filter((word) => word !== "");
  cell.setAttribute("aria-label", words.join(", "));
  const weekday = weekdayOf(date);
  cell.addEventListener("click", () => props.onDay(weekday, null));
  cell.addEventListener("dragover", (event) => {
    if (!event.dataTransfer?.types.includes(EXERCISE_DRAG)) return;
    event.preventDefault();
    cell.classList.add("is-target");
  });
  cell.addEventListener("dragleave", () => cell.classList.remove("is-target"));
  cell.addEventListener("drop", (event) => {
    const name = event.dataTransfer?.getData(EXERCISE_DRAG) ?? "";
    cell.classList.remove("is-target");
    if (name === "") return;
    event.preventDefault();
    props.onDay(weekday, name);
  });
  return cell;
}

function weekName(block: Block, monday: string): HTMLElement {
  // A block may start midweek, so a row is named by its first day inside the block.
  const at = weekIndex(block, monday < block.start ? block.start : monday) ?? 0;
  const week = block.weeks[at];
  const label = week?.deload ? "Deload" : week?.rpe ? `RPE ${week.rpe}` : "";
  const name = element("span", "cm-block-week", `W${at + 1}`);
  if (label !== "") name.append(element("span", "cm-block-target", label));
  return name;
}

function weekRow(
  monday: string,
  facts: Map<string, DayFacts>,
  props: CalendarProps,
): HTMLElement[] {
  const { block } = props;
  const cells = [weekName(block, monday)];
  for (let offset = 0; offset < 7; offset += 1) {
    const date = shiftDay(monday, offset);
    const week = weekIndex(block, date);
    if (week === null) {
      cells.push(element("span", "cm-block-out", ""));
      continue;
    }
    const cell = dayCell(date, block.days[offset] ?? null, facts.get(date), props);
    cell.classList.toggle("is-deload", block.weeks[week]?.deload === true);
    cells.push(cell);
  }
  return cells;
}

/** The block's weeks as rows of seven days, a deload week shaded, each row named by its target. */
export function calendar(props: CalendarProps): HTMLElement {
  const { block } = props;
  const facts = factsOf(props.days);
  const grid = element("div", "cm-block-cal");
  grid.classList.toggle("is-picking", props.picking);
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", "Block calendar");
  grid.append(element("span", "cm-block-head", ""));
  const first = shiftDay(block.start, -weekdayOf(block.start));
  for (const name of DAY_NAMES) grid.append(element("span", "cm-block-head", name));
  const rows = Math.ceil((weekdayOf(block.start) + block.weeks.length * 7) / 7);
  for (let row = 0; row < rows; row += 1) {
    grid.append(...weekRow(shiftDay(first, row * 7), facts, props));
  }
  return grid;
}

export interface LibraryProps {
  exercises: Exercise[];
  muscle: string | null;
  picked: string | null;
  onMuscle: (muscle: string | null) => void;
  onPick: (name: string | null) => void;
}

/** The exercises to drag onto a day, or to pick and then click a day, narrowed to one muscle. */
export function library(props: LibraryProps): HTMLElement {
  const usable = props.exercises.filter((e) => e.kind === "strength" || e.kind === "mobility");
  const muscles = [...new Set(usable.flatMap((e) => e.muscles_primary))].sort();
  const side = element("section", "cm-block-lib");
  side.setAttribute("aria-label", "Exercise library");
  const filter = element("select", "cm-block-muscle");
  filter.setAttribute("aria-label", "Muscle");
  filter.append(new Option("All muscles", ""));
  for (const muscle of muscles)
    filter.append(new Option(muscle, muscle, false, muscle === props.muscle));
  filter.addEventListener("change", () =>
    props.onMuscle(filter.value === "" ? null : filter.value),
  );
  const list = element("ul", "cm-block-items");
  const shown = usable.filter(
    (e) => props.muscle === null || e.muscles_primary.includes(props.muscle),
  );
  for (const exercise of shown) {
    const item = element("li", "");
    const pick = element("button", "cm-block-item", exercise.name);
    pick.type = "button";
    pick.draggable = true;
    pick.setAttribute("aria-pressed", String(props.picked === exercise.name));
    pick.addEventListener("click", () =>
      props.onPick(props.picked === exercise.name ? null : exercise.name),
    );
    pick.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData(EXERCISE_DRAG, exercise.name);
      event.dataTransfer?.setData("text/plain", `[[${exercise.name}]]`);
    });
    item.append(pick);
    list.append(item);
  }
  if (shown.length === 0) list.append(element("li", "cm-block-none", "No exercise notes yet"));
  side.append(element("h3", "cm-block-title", "Exercises"), filter, list);
  return side;
}
