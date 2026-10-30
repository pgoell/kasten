import type { TokenUse } from "@/lib/token-api";

/** How many days a token may sit unused before the page marks it. */
export const UNUSED_DAYS = 30;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long ago `at` was, in the tokens page's words, read against `now` so tests agree. Under a
 * minute says "just now": a seconds count moves on every render and reads as noise.
 */
export function lastUse(at: string | null, now: Date): string {
  if (at === null) return "never";
  const elapsed = now.getTime() - new Date(at).getTime();
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h ago`;
  const days = Math.floor(elapsed / DAY);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/**
 * Whether a token has gone unused for `UNUSED_DAYS`. A never-used token is judged by its creation
 * date, so one minted last week and not yet connected does not show as unused.
 */
export function unused(token: TokenUse, now: Date): boolean {
  const since = token.last_used ?? token.created;
  return now.getTime() - new Date(since).getTime() > UNUSED_DAYS * DAY;
}
