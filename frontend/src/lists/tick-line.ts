import type { Item } from "./lists-store";

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const SIX_DAYS = 6 * 24 * 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * When a tick happened, in local time: the weekday in two letters for the last six
 * days, the date for older. Written out by hand because `Intl` gives "Mo." for a
 * short German weekday, and the line reads "Mo 18:04" with no full stop.
 */
function whenLabel(iso: string, now: number): string {
  const at = new Date(iso);
  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  if (now - at.getTime() > SIX_DAYS) {
    return `${pad(at.getDate())}.${pad(at.getMonth() + 1)}. ${clock}`;
  }
  return `${WEEKDAYS[at.getDay()] ?? ""} ${clock}`;
}

/** The line under a done item: who ticked it and when. Null when the server knows neither. */
export function tickLine(item: Item, now: number): string | null {
  const when = item.ticked_at ? whenLabel(item.ticked_at, now) : null;
  if (item.ticked_by) {
    return when ? `abgehakt von ${item.ticked_by}, ${when}` : `abgehakt von ${item.ticked_by}`;
  }
  return when ? `abgehakt ${when}` : null;
}
