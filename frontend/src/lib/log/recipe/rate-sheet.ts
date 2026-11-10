/**
 * The rating sheet a logged recipe opens: "cook again?" with three faces, chips for what to
 * change and a note, written as a line under the recipe's `## Gekocht`. Skipped, it comes back
 * once that evening; the format is in `docs/reference/food/recipe-note.md`.
 */

import { updateNote } from "@/lib/core/api";
import { readClock } from "@/lib/core/clock";
import { make } from "@/lib/log/food-math";
import { parseFood } from "@/lib/log/log-lines";
import { appendUnder } from "@/lib/notes/text/note-section";

export const COOKED_HEADING = "## Gekocht";
export const VERDICTS = ["lieber nicht", "geht so", "gern wieder"] as const;
export type Verdict = (typeof VERDICTS)[number];
export const CHIPS = [
  "mehr Würze",
  "weniger Salz",
  "zu trocken",
  "Beilage anders",
  "größere Portion",
] as const;

/** The hour a skipped rating comes back at, once, on the day it was logged. */
export const EVENING_HOUR = 19;
const PENDING_KEY = "kasten.rate.pending";

export interface RateMeal {
  path: string;
  title: string;
  /** The food line the log took, which the sheet reads its meal and kcal from. */
  line: string;
  /** The daily note the line went on, which dates the rating; today when left out. */
  day?: string;
}

interface Pending extends RateMeal {
  /** The day the sheet first showed, which decides whether it may come back. */
  date: string;
  /** Whether the evening's second showing has happened, after which a skip drops it. */
  returned: boolean;
}

/** The line under `## Gekocht`: `- 2026-11-09 gern wieder · mehr Würze, Beilage anders`. */
export function cookedLineFor(
  date: string,
  verdict: Verdict,
  chips: string[],
  note: string,
): string {
  const said = [...chips, note.replace(/\s+/g, " ").trim()].filter((part) => part !== "");
  return `- ${date} ${verdict}${said.length === 0 ? "" : ` · ${said.join(", ")}`}`;
}

/** `lunch · 540 kcal` from a food line, for the sheet's top line. */
export function mealFacts(line: string): string {
  const food = parseFood(line);
  const kcal = food?.kcal === undefined ? undefined : `${Math.round(food.kcal)} kcal`;
  return [food?.meal, kcal].filter(Boolean).join(" · ");
}

function readPending(): Pending | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw === null ? null : (JSON.parse(raw) as Pending);
  } catch (error) {
    // Storage refused (a private window), or a value that is not JSON: no rating waits.
    if (error instanceof DOMException || error instanceof SyntaxError) return null;
    throw error;
  }
}

function writePending(pending: Pending | null): void {
  try {
    if (pending === null) localStorage.removeItem(PENDING_KEY);
    else localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
  }
}

let evening: ReturnType<typeof setTimeout> | undefined;

/** Brings back a rating skipped today, once, from the evening hour on. */
export function comeBackTonight(now = new Date()): void {
  const pending = readPending();
  if (pending === null || document.querySelector(".k-rate") !== null) return;
  if (pending.date !== readClock(now).date) {
    writePending(null);
    return;
  }
  if (pending.returned) return;
  const at = new Date(now);
  at.setHours(EVENING_HOUR, 0, 0, 0);
  clearTimeout(evening);
  if (now >= at) {
    const again = { ...pending, returned: true };
    writePending(again);
    show(again);
  } else {
    evening = setTimeout(() => comeBackTonight(), at.getTime() - now.getTime());
  }
}

/** A face as a small SVG: a circle with a mouth that turns down, stays flat or turns up. */
function face(verdict: Verdict): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 32 32");
  svg.setAttribute("aria-hidden", "true");
  const mouth: Record<Verdict, string> = {
    "lieber nicht": "M11 21 Q16 17 21 21",
    "geht so": "M11 19 L21 19",
    "gern wieder": "M11 18 Q16 23 21 18",
  };
  for (const [tag, attrs] of [
    ["circle", { cx: "16", cy: "16", r: "13" }],
    ["path", { d: mouth[verdict] }],
  ] as const) {
    const part = document.createElementNS(ns, tag);
    for (const [name, value] of Object.entries(attrs)) part.setAttribute(name, value);
    svg.append(part);
  }
  return svg;
}

/** Opens the sheet for a recipe just logged, and keeps it waiting until it is answered. */
export function openRateSheet(meal: RateMeal, now = new Date()): void {
  const pending: Pending = { ...meal, date: readClock(now).date, returned: false };
  writePending(pending);
  show(pending);
}

function show(pending: Pending): void {
  document.querySelector(".k-rate")?.remove();
  let verdict: Verdict | null = null;
  const chosen = new Set<string>();

  const root = make("div", "k-rate");
  const scrim = make("div", "k-rate-scrim");
  const sheet = make("div", "k-rate-sheet");
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", `Rate ${pending.title}`);
  sheet.tabIndex = -1;

  const facts = mealFacts(pending.line);
  if (facts !== "") sheet.append(make("p", "k-rate-facts", facts));
  sheet.append(make("h2", "k-rate-title", `${pending.title}, cook again?`));

  const faces = make("div", "k-rate-faces");
  faces.setAttribute("role", "radiogroup");
  faces.setAttribute("aria-label", "Cook again?");
  const faceButtons = VERDICTS.map((each) => {
    const button = make("button", `k-rate-face k-rate-${each.replace(" ", "-")}`);
    button.type = "button";
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", "false");
    button.append(face(each), make("span", "", each[0]?.toUpperCase() + each.slice(1)));
    button.addEventListener("click", () => {
      verdict = each;
      paint();
    });
    faces.append(button);
    return button;
  });

  const chipRow = make("div", "k-rate-chips");
  const chipButtons = CHIPS.map((chip) => {
    const button = make("button", "k-rate-chip", chip);
    button.type = "button";
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
      if (!chosen.delete(chip)) chosen.add(chip);
      paint();
    });
    chipRow.append(button);
    return button;
  });
  const own = make("input", "k-rate-note");
  own.type = "text";
  own.placeholder = "own note";
  own.setAttribute("aria-label", "Own note");
  own.hidden = true;
  const ownButton = make("button", "k-rate-chip", "+ own note");
  ownButton.type = "button";
  ownButton.addEventListener("click", () => {
    ownButton.hidden = true;
    own.hidden = false;
    own.focus();
  });
  chipRow.append(ownButton);

  const why = make("p", "k-rate-why");
  why.setAttribute("role", "alert");
  const done = make("button", "k-rate-done", "Done");
  done.type = "button";
  const later = make("button", "k-rate-later", "Later");
  later.type = "button";
  const foot = make("div", "k-rate-foot");
  foot.append(later, done);
  const said = pending.returned
    ? "The meal is logged. Skip now and the rating is dropped."
    : "The meal is logged. Skip now and this comes back once tonight.";

  sheet.append(
    faces,
    make("p", "k-rate-label", "What to change? (optional)"),
    chipRow,
    own,
    why,
    foot,
    make("p", "k-rate-said", said),
  );
  root.append(scrim, sheet);

  function paint(): void {
    for (const [at, button] of faceButtons.entries()) {
      const on = VERDICTS[at] === verdict;
      button.classList.toggle("is-on", on);
      button.setAttribute("aria-checked", String(on));
    }
    for (const [at, button] of chipButtons.entries()) {
      const on = chosen.has(CHIPS[at] ?? "");
      button.classList.toggle("is-on", on);
      button.setAttribute("aria-pressed", String(on));
    }
    done.disabled = verdict === null;
  }

  function skip(): void {
    root.remove();
    if (pending.returned) writePending(null);
    // Skipped in the evening already, it waits for the next note opened, not this moment.
    else if (new Date().getHours() < EVENING_HOUR) comeBackTonight();
  }

  done.addEventListener("click", () => {
    if (verdict === null) return;
    const line = cookedLineFor(pending.day ?? pending.date, verdict, [...chosen], own.value);
    done.disabled = true;
    why.textContent = "";
    updateNote(pending.path, (text) => appendUnder(text, COOKED_HEADING, line)).then(
      () => {
        writePending(null);
        root.remove();
      },
      (error: unknown) => {
        if (!(error instanceof Error)) throw error;
        why.textContent = `Nothing written to ${pending.title}: ${error.message}`;
        done.disabled = false;
      },
    );
  });
  later.addEventListener("click", skip);
  scrim.addEventListener("click", skip);
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      skip();
    }
  });

  paint();
  document.body.append(root);
  sheet.focus();
}
