/** The exercise notes the session screen picks from, and the days it reads "last time" off. */

import type { components } from "@/lib/api-types";
import { client } from "@/lib/core/api-client";
import { shiftDay } from "@/lib/core/clock";
import type { TrainingEntry } from "@/lib/log/training/training-lines";

/** One exercise note: `name` is what a training line links. */
export type Exercise = components["schemas"]["Exercise"];

/** A day that holds training lines, with its entries in line order. */
export interface TrainingDay {
  date: string;
  entries: TrainingEntry[];
}

/** How far back "last time" and the recent list look. */
export const LOOK_BACK_DAYS = 90;

/** Every exercise note outside the archive, by name. */
export async function fetchExercises(): Promise<Exercise[]> {
  const { data, response } = await client.GET("/api/training/exercises");
  if (!data) throw new Error(`GET /api/training/exercises failed with ${response.status}`);
  return data;
}

/** The days before `today` within the look-back that hold training, oldest first. */
export async function fetchEarlier(today: string): Promise<TrainingDay[]> {
  const query = { from: shiftDay(today, -LOOK_BACK_DAYS), to: shiftDay(today, -1) };
  const { data, response } = await client.GET("/api/training", { params: { query } });
  if (!data) throw new Error(`GET /api/training failed with ${response.status}`);
  return data.map((day) => ({ date: day.date, entries: day.entries.map(bare) }));
}

/** An entry with the nulls the API sends left out, as the browser's parser gives one. */
function bare(entry: components["schemas"]["TrainingEntry"]): TrainingEntry {
  return Object.fromEntries(
    Object.entries(entry).filter(([, value]) => value !== null),
  ) as unknown as TrainingEntry;
}

/** The last earlier day's lines for one exercise, or null when there is none. */
export function lastTime(
  days: TrainingDay[],
  exercise: string,
): { date: string; entries: TrainingEntry[] } | null {
  for (const day of [...days].reverse()) {
    const entries = day.entries.filter((e) => e.kind === "strength" && e.exercise === exercise);
    if (entries.length > 0) return { date: day.date, entries };
  }
  return null;
}

/** The exercises trained in the look-back, most recent first, each once. */
export function recentNames(days: TrainingDay[]): string[] {
  const names = [...days].reverse().flatMap((day) => day.entries.map((e) => e.exercise));
  return [...new Set(names)];
}

/** Whether an exercise's name or one of its aliases holds `query`, ignoring case. */
export function matches(exercise: Exercise, query: string): boolean {
  const wanted = query.trim().toLowerCase();
  if (wanted === "") return true;
  return [exercise.name, ...exercise.aliases].some((name) => name.toLowerCase().includes(wanted));
}
