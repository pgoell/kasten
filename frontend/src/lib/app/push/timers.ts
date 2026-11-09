import type { components } from "@/lib/api-types";
import { client, reason } from "@/lib/core/api-client";

/** A running timer; `due` is when it rings next, and `every` is set for a repeat. */
export type Timer = components["schemas"]["TimerOut"];

/** A timer started once before, which a tap starts again. */
export type Recent = { label: string; seconds: number };

export const RECENT_KEY = "kasten.timers.recent";
const RECENT_COUNT = 4;

/** Every running timer, the next to ring first. */
export async function fetchTimers(): Promise<Timer[]> {
  const { data, response } = await client.GET("/api/push/timers");

  if (!data) {
    throw new Error(`GET /api/push/timers failed with ${response.status}`);
  }

  return data;
}

/** Start a timer that rings `seconds` from `now` with its label as the push. */
export async function startTimer(label: string, seconds: number, now = new Date()): Promise<Timer> {
  const due = new Date(now.getTime() + seconds * 1000).toISOString();
  const { data, error, response } = await client.POST("/api/push/timers", {
    body: { label, due },
  });

  if (!data) {
    throw new Error(reason(error) ?? `POST /api/push/timers failed with ${response.status}`);
  }

  return data;
}

/** Start a repeat that rings at once, then every `every` seconds until `until`. */
export async function startRepeat(
  label: string,
  every: number,
  until: Date,
  now = new Date(),
): Promise<Timer> {
  const { data, error, response } = await client.POST("/api/push/timers", {
    body: { label, due: now.toISOString(), every, until: until.toISOString() },
  });

  if (!data) {
    throw new Error(reason(error) ?? `POST /api/push/timers failed with ${response.status}`);
  }

  return data;
}

/** Stop a timer before it rings. */
export async function stopTimer(id: number): Promise<void> {
  const { response } = await client.DELETE("/api/push/timers/{timer_id}", {
    params: { path: { timer_id: id } },
  });

  if (!response.ok) {
    throw new Error(`DELETE /api/push/timers/${id} failed with ${response.status}`);
  }
}

const UNITS: Record<string, number> = { h: 3600, m: 60, s: 1 };
const PART = /\s*(\d+)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)(?![a-z])/y;

/**
 * Seconds from what a person types: `90` is minutes, `1:25` hours and minutes,
 * and `1h 25m`, `45 min` or `30s` name their units. Null for anything else or zero.
 */
export function parseDuration(text: string): number | null {
  const typed = text.trim().toLowerCase();
  if (/^\d+$/.test(typed)) return positive(Number(typed) * 60);

  const clock = /^(\d+):([0-5]\d)$/.exec(typed);
  if (clock) return positive(Number(clock[1]) * 3600 + Number(clock[2]) * 60);

  PART.lastIndex = 0;
  let total = 0;
  while (PART.lastIndex < typed.length) {
    const found = PART.exec(typed);
    if (!found) return null;
    const [, count = "", unit = ""] = found;
    total += Number(count) * (UNITS[unit.charAt(0)] ?? 0);
  }
  return positive(total);
}

function positive(seconds: number): number | null {
  return seconds > 0 ? seconds : null;
}

/** `1h 25m`, `45m` or `30s`: a duration as a recent timer's chip names it. */
export function durationLabel(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const parts = [hours && `${hours}h`, minutes && `${minutes}m`, rest && `${rest}s`];
  return parts.filter(Boolean).join(" ");
}

/** What is left as a clock: `1:24:59`, `42:13`, or `0:00` once rung. */
export function remaining(due: string, now: Date): string {
  const left = Math.max(0, Math.ceil((new Date(due).getTime() - now.getTime()) / 1000));
  const hours = Math.floor(left / 3600);
  const minutes = Math.floor((left % 3600) / 60);
  const seconds = String(left % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

/** The last timers started on this device, newest first; none where storage is blocked. */
export function readRecent(): Recent[] {
  let value: string | null;
  try {
    value = localStorage.getItem(RECENT_KEY);
  } catch (error) {
    if (error instanceof DOMException) return [];
    throw error;
  }
  if (value === null) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(isRecent).slice(0, RECENT_COUNT) : [];
  } catch (error) {
    if (error instanceof SyntaxError) return [];
    throw error;
  }
}

/** Put a timer at the front of the recent ones, once; a blocked store keeps nothing. */
export function keepRecent(recent: Recent): Recent[] {
  const kept = [
    recent,
    ...readRecent().filter((old) => old.label !== recent.label || old.seconds !== recent.seconds),
  ].slice(0, RECENT_COUNT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(kept));
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
  }
  return kept;
}

function isRecent(value: unknown): value is Recent {
  if (typeof value !== "object" || value === null) return false;
  const { label, seconds } = value as Partial<Recent>;
  return typeof label === "string" && typeof seconds === "number" && seconds > 0;
}
