/**
 * The todo view's table: which store rows each tab keeps, the groups they sit in and what
 * each row's columns say. Pure, so the pane and its tests read the same answer.
 */

import type { TodoRow } from "@/lib/core/api";
import { shiftDay } from "@/lib/core/clock";
import { wikiLinkTargets } from "@/lib/notes/links/wikilink";
import type { TodoState } from "@/lib/todo/todo";
import {
  DAYS_AHEAD,
  dayGroupKey,
  dayHeading,
  dayOf,
  LAST_AHEAD,
  plannedOf,
  type WeekDay,
  weekStrip,
} from "@/lib/todo/view/rows/upcoming";

export type Tab = "today" | "upcoming" | "inbox" | "all";
export type GroupBy = "state" | "project" | "day";

export const TABS: { tab: Tab; label: string }[] = [
  { tab: "today", label: "Today" },
  { tab: "upcoming", label: "Upcoming" },
  { tab: "inbox", label: "Inbox" },
  { tab: "all", label: "All" },
];

/** One drawn row: the todo, how deep under its parent, and its column facts. */
export interface Line {
  row: TodoRow;
  depth: number;
  parts: { closed: number; total: number } | null;
  notes: number;
}

export interface Group {
  key: string;
  label: string;
  /** The state a state group gathers, which a new todo from its `+` starts in. */
  state?: TodoState;
  /** The project a project group gathers. */
  project?: string | null;
  /** The day a day group gathers, which a new todo from its `+` is planned on. */
  day?: string;
  /** The dates beside a day group's name. */
  sub?: string;
  /** A day group's estimates added up, and its hard due dates. */
  minutes?: number;
  deadlines?: number;
  lines: Line[];
}

/** Done and rejected are over: no list but Done today shows them. */
export function closed(row: TodoRow): boolean {
  return row.state === "done" || row.state === "rejected";
}

/** Put off: held until a later day, or waiting with its look-again day still ahead. */
export function held(row: TodoRow, today: string): boolean {
  if (row.hold_until !== null && row.hold_until > today) return true;
  return row.state === "waiting" && row.look_again !== null && row.look_again > today;
}

/** Whether a tab lists a todo still open. Upcoming is two weeks ahead, Today what is on now. */
function listed(tab: Tab, row: TodoRow, today: string, byId: Map<string, TodoRow>): boolean {
  if (closed(row) || row.round_of !== null) return false;
  if (tab === "all") return true;
  if (held(row, today)) return false;
  const planned = plannedOf(row, byId);
  if (tab === "inbox") return row.project === null && planned === null && row.parent_id === null;
  if (tab === "upcoming") {
    const day = dayOf(row, byId);
    return day !== null && day > today && day <= shiftDay(today, LAST_AHEAD);
  }
  if (row.state === "doing" || row.state === "review") return true;
  if (row.state === "waiting") return true;
  return (planned !== null && planned <= today) || (row.due !== null && row.due <= today);
}

const STATE_GROUPS: { state: TodoState; label: string }[] = [
  { state: "doing", label: "Doing" },
  { state: "review", label: "Review" },
  { state: "open", label: "Open" },
  { state: "waiting", label: "Waiting" },
  { state: "blocked", label: "Blocked" },
];

const RANK: Record<string, number> = { highest: 0, high: 1, medium: 2, none: 3, low: 4, lowest: 5 };

/** Important first, then the nearer day, then the order the store keeps. */
function order(a: TodoRow, b: TodoRow): number {
  const rank = (RANK[a.priority ?? "none"] ?? 3) - (RANK[b.priority ?? "none"] ?? 3);
  if (rank !== 0) return rank;
  const day = (a.planned ?? a.due ?? "9999").localeCompare(b.planned ?? b.due ?? "9999");
  return day !== 0 ? day : a.position - b.position;
}

/** The folder's own name: `02 Projects/FDE` reads FDE. */
export function projectName(project: string | null): string {
  if (project === null) return "No project";
  return project.slice(project.lastIndexOf("/") + 1);
}

/** Each note the todo touches, once: the note it lives in and every `[[link]]` in its text. */
export function noteCount(row: TodoRow): number {
  const links = new Set(wikiLinkTargets(`${row.words}\n${row.description ?? ""}`));
  return links.size + (row.note === null ? 0 : 1);
}

/** The rows of one group, each part under its parent where both are in the group. */
function treeLines(rows: TodoRow[], children: Map<string, TodoRow[]>): Line[] {
  const inGroup = new Set(rows.map((row) => row.id));
  const lines: Line[] = [];
  const visit = (row: TodoRow, depth: number) => {
    const kids = children.get(row.id) ?? [];
    const total = kids.length;
    const parts = total === 0 ? null : { closed: kids.filter(closed).length, total };
    lines.push({ row, depth, parts, notes: noteCount(row) });
    for (const kid of [...kids].sort(order)) if (inGroup.has(kid.id)) visit(kid, depth + 1);
  };
  const tops = rows.filter((row) => row.parent_id === null || !inGroup.has(row.parent_id));
  for (const row of tops.sort(order)) visit(row, 0);
  return lines;
}

/**
 * The groups a tab draws, each named and in order, empty ones left out. Today and All end
 * in Done today, so a tick stays in sight for the rest of the day.
 */
export function groupsOf(
  rows: TodoRow[],
  o: { tab: Tab; by: GroupBy; today: string; words?: string },
): Group[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const children = new Map<string, TodoRow[]>();
  for (const row of rows) {
    if (row.parent_id === null || row.round_of !== null) continue;
    children.set(row.parent_id, [...(children.get(row.parent_id) ?? []), row]);
  }
  const typed = o.words?.trim().toLowerCase() ?? "";
  const matches = (row: TodoRow) => typed === "" || row.words.toLowerCase().includes(typed);
  const kept = rows.filter((row) => listed(o.tab, row, o.today, byId) && matches(row));

  const groups = byGroups(kept, children, o.by, o.today, byId);

  if (o.tab === "today" || o.tab === "all") {
    const done = rows.filter((row) => row.state === "done" && row.done === o.today && matches(row));
    groups.push({
      key: "done",
      label: "Done today",
      state: "done",
      lines: treeLines(done, children),
    });
  }
  return groups.filter((group) => group.lines.length > 0);
}

function byGroups(
  kept: TodoRow[],
  children: Map<string, TodoRow[]>,
  by: GroupBy,
  today: string,
  byId: Map<string, TodoRow>,
): Group[] {
  if (by === "project") return projectGroups(kept, children);
  if (by === "day") return dayGroups(kept, children, today, byId);
  return STATE_GROUPS.map(({ state, label }) => ({
    key: state,
    label,
    state,
    lines: treeLines(
      kept.filter((row) => row.state === state),
      children,
    ),
  }));
}

/** A group for each day of the week ahead, then one for the week after; a todo with no day sits last. */
function dayGroups(
  kept: TodoRow[],
  children: Map<string, TodoRow[]>,
  today: string,
  byId: Map<string, TodoRow>,
): Group[] {
  const keyOf = (row: TodoRow) => {
    const day = dayOf(row, byId);
    return day === null || day <= today ? "none" : dayGroupKey(day, today);
  };
  const keys = [
    ...Array.from({ length: DAYS_AHEAD }, (_, at) => shiftDay(today, at + 1)),
    "later",
    "none",
  ];
  return keys.map((key) => {
    const rows = kept.filter((row) => keyOf(row) === key);
    const heading = key === "none" ? { label: "No day", sub: "" } : dayHeading(key, today);
    const inRange = (due: string | null) =>
      due !== null && (key === "later" ? dayGroupKey(due, today) === "later" : due === key);
    return {
      key,
      ...heading,
      ...(key === "none" || key === "later" ? {} : { day: key }),
      minutes: rows.reduce((sum, row) => sum + (row.estimate ?? 0), 0),
      deadlines: rows.filter((row) => row.due_hard && inRange(row.due)).length,
      lines: treeLines(rows, children),
    };
  });
}

function projectGroups(kept: TodoRow[], children: Map<string, TodoRow[]>): Group[] {
  const projects = [...new Set(kept.map((row) => row.project))].sort((a, b) =>
    a === null ? 1 : b === null ? -1 : projectName(a).localeCompare(projectName(b)),
  );
  return projects.map((project) => ({
    key: project ?? "none",
    label: projectName(project),
    project,
    lines: treeLines(
      kept.filter((row) => row.project === project),
      children,
    ),
  }));
}

/** How many todos a tab lists, for the count beside its name. */
export function countOf(rows: TodoRow[], tab: Tab, today: string): number {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return rows.filter((row) => listed(tab, row, today, byId)).length;
}

/** The week strip over the rows Upcoming lists, so a day's count matches its group below. */
export function upcomingWeek(rows: TodoRow[], today: string, words = ""): WeekDay[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const typed = words.trim().toLowerCase();
  const kept = rows.filter(
    (row) => listed("upcoming", row, today, byId) && row.words.toLowerCase().includes(typed),
  );
  return weekStrip(kept, byId, today);
}
