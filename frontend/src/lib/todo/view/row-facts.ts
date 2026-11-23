/** What a row of the todo table says in its time, detail and date columns. */

import type { TodoRow } from "@/lib/core/api";
import { shiftDay } from "@/lib/core/clock";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** `23 Nov`; today and tomorrow by name. */
export function shortDay(day: string, today: string): string {
  if (day === today) return "today";
  if (day === shiftDay(today, 1)) return "tomorrow";
  return `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1] ?? ""}`;
}

/** `Mon 23 Nov`, for the panel. */
export function longDay(day: string, today: string): string {
  const weekday = WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()] ?? "";
  const named = day === today ? "Today, " : day === shiftDay(today, 1) ? "Tomorrow, " : "";
  return `${named}${weekday} ${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
}

/** `45 m`, `2 h`, `1 h 30 m`. */
export function minutes(total: number): string {
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest} m`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} m`;
}

export interface DateCell {
  text: string;
  /** A due date rather than a plan, drawn with a flag. */
  due: boolean;
  late: boolean;
}

/**
 * The day a row shows: a hard due date, else the plan, else a soft due date. A soft due
 * date is the store's fallback, so it only shows once it is near.
 */
export function dateCell(row: TodoRow, today: string): DateCell | null {
  const late = row.due !== null && row.due < today && row.state !== "done";
  if (row.due !== null && (row.due_hard || late)) {
    return { text: shortDay(row.due, today), due: true, late };
  }
  if (row.planned !== null) return { text: shortDay(row.planned, today), due: false, late: false };
  if (row.due !== null && row.due <= shiftDay(today, 2)) {
    return { text: shortDay(row.due, today), due: true, late: false };
  }
  if (row.state === "done" && row.done !== null) {
    return { text: shortDay(row.done, today), due: false, late: false };
  }
  return null;
}

export type DetailKind = "time" | "repeat" | "wait" | "blocked";

/** Days from one `YYYY-MM-DD` to another. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** `every week` reads weekly; any other rule reads as written. */
function repeatName(rule: string): string {
  const short: Record<string, string> = {
    "every day": "daily",
    "every week": "weekly",
    "every month": "monthly",
    "every year": "yearly",
  };
  return short[rule] ?? rule.replace(/^every /, "");
}

/** `45 m of 2 h`: time worked against the estimate, either alone where only one is known. */
function timeText(row: TodoRow): string | null {
  if (row.estimate === null && row.worked === null) return null;
  const worked = row.worked ?? 0;
  if (row.estimate === null) return minutes(worked);
  return worked === 0 ? minutes(row.estimate) : `${minutes(worked)} of ${minutes(row.estimate)}`;
}

/** The one thing worth saying in the detail column: whom it waits on, what blocks it, time or repeat. */
export function detailCell(
  row: TodoRow,
  byId: Map<string, TodoRow>,
  today: string,
): { kind: DetailKind; text: string } | null {
  if (row.state === "waiting") {
    const days = row.waiting_since === null ? null : daysBetween(row.waiting_since, today);
    const who = row.waiting_on ?? "someone";
    return { kind: "wait", text: days === null ? who : `${who}, ${days} d` };
  }
  if (row.state === "blocked" && row.blocked_by.length > 0) {
    const first = byId.get(row.blocked_by[0] ?? "");
    return { kind: "blocked", text: first?.words ?? row.blocked_by[0] ?? "" };
  }
  const time = timeText(row);
  if (time !== null) return { kind: "time", text: time };
  if (row.repeat !== null) return { kind: "repeat", text: repeatName(row.repeat) };
  return null;
}

/** A few steady hues a project's dot is drawn in, picked by its name. */
const HUES = [
  "var(--k-accent)",
  "var(--k-danger)",
  "var(--k-ok)",
  "var(--k-warn)",
  "var(--k-info)",
  "var(--k-link)",
];

export function projectHue(project: string | null): string {
  if (project === null) return "var(--k-muted)";
  let sum = 0;
  for (const char of project) sum = (sum * 31 + char.charCodeAt(0)) % 997;
  return HUES[sum % HUES.length] ?? HUES[0] ?? "";
}
