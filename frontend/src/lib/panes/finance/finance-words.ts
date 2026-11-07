/**
 * How the finance pane writes money and months. Amounts come from the backend as strings to
 * the cent; the pane writes them in euros the German way, as the to-sort list always has.
 */

import { tagVariable } from "@/lib/graph/graph";

const CENTS = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const EUROS = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

/** The minus sign, wider than the hyphen Intl writes, so a negative amount reads as one. */
const MINUS = "\u2212";

function signed(format: Intl.NumberFormat, value: number): string {
  return value < 0 ? `${MINUS}${format.format(-value)}` : format.format(value);
}

/** An amount to the cent, `1.234,56 €` or `−4,20 €`, in its own currency when one is given. */
export function money(amount: string | number, currency = "EUR"): string {
  const format =
    currency === "EUR" ? CENTS : new Intl.NumberFormat("de-DE", { style: "currency", currency });
  return signed(format, Number(amount));
}

/** An amount in whole euros, `1.235 €` or `−50 €`, for figures read at a glance. */
export function euros(amount: string | number): string {
  // Rounded first, so `-0.4` reads `0 €` and not `−0 €`.
  return signed(EUROS, Math.round(Number(amount)) || 0);
}

/** The month a day falls in, `YYYY-MM`. */
export function monthOf(day: string): string {
  return day.slice(0, 7);
}

/** The month `count` months after `month`, or before it when negative. */
export function shiftMonth(month: string, count: number): string {
  const [year, number] = month.split("-").map(Number);
  const index = (year ?? 0) * 12 + (number ?? 1) - 1 + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** A month as words, `October 2026`, or `Oct` short. Counted in UTC so no zone moves it. */
export function monthName(month: string, short = false): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", {
    month: short ? "short" : "long",
    year: short ? undefined : "numeric",
    timeZone: "UTC",
  });
}

/** A share as a whole percentage, `81%`. */
export function percent(share: string | number): string {
  return `${Math.round(Number(share) * 100)}%`;
}

/** The words a list shows for a booking with no category of its own. */
const UNNAMED = new Set(["Not sorted", "Transfer"]);

/**
 * The colour of a category's dot: the graph's tag slot its name hashes to, as a tag's does, so
 * a category keeps its colour wherever it shows. A booking without one takes the slot for none.
 */
export function categoryColour(name: string): string {
  return `var(${UNNAMED.has(name) ? "--tg-none" : tagVariable(name)})`;
}
