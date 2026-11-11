/**
 * The training card on a daily note: the day's sets in a line and the button that opens the
 * session screen. It sits under `## Training`, or under the title on today's note before one exists.
 */

import { type EditorState, type Extension, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { readClock } from "@/lib/core/clock";
import { openSession } from "@/lib/log/training/session/screen";
import { type TrainingEntry, trainingLines } from "@/lib/log/training/training-lines";
import { cardLine } from "@/lib/notes/note/weather-card";
import { dailyDate } from "@/lib/notes/text/periodic";
import { notePath } from "@/lib/todo/todo-commands";

const HEADING = /^## Training[ \t]*$/;

/** The day in short: `3 exercises · 9 sets · 25 min cardio`, or null before the first line. */
export function summary(entries: TrainingEntry[]): string | null {
  const strength = entries.filter((e) => e.kind === "strength");
  const names = new Set(strength.map((e) => e.exercise));
  const sets = strength.reduce((sum, e) => sum + (e.sets ?? 0), 0);
  const minutes = entries.reduce((sum, e) => sum + (e.minutes ?? 0), 0);
  const parts = [
    names.size > 0 ? `${names.size} ${names.size === 1 ? "exercise" : "exercises"}` : "",
    sets > 0 ? `${sets} ${sets === 1 ? "set" : "sets"}` : "",
    minutes > 0 ? `${Math.round(minutes)} min cardio` : "",
  ].filter((part) => part !== "");
  return parts.length === 0 ? null : parts.join(" · ");
}

class TrainingCard extends WidgetType {
  private readonly day: string;
  private readonly line: string | null;

  constructor(day: string, line: string | null) {
    super();
    this.day = day;
    this.line = line;
  }

  override eq(other: TrainingCard): boolean {
    return other.day === this.day && other.line === this.line;
  }

  toDOM(view: EditorView): HTMLElement {
    const card = document.createElement("div");
    card.className = "cm-training";
    card.setAttribute("contenteditable", "false");
    const words = document.createElement("span");
    words.className = "cm-training-words";
    words.textContent = this.line ?? "No training logged yet";
    const start = document.createElement("button");
    start.type = "button";
    start.className = "cm-training-start";
    start.textContent = this.line === null ? "Start session" : "Continue session";
    start.addEventListener("click", () => openSession(view, this.day));
    card.append(words, start);
    return card;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

function headingLine(state: EditorState): number | null {
  for (let at = 1; at <= state.doc.lines; at += 1) {
    if (HEADING.test(state.doc.line(at).text)) return at;
  }
  return null;
}

function build(state: EditorState): DecorationSet {
  const path = state.facet(notePath);
  const day = path === undefined ? null : dailyDate(path);
  if (day === null) return Decoration.none;
  const heading = headingLine(state);
  const today = day === readClock(new Date()).date;
  const line = heading ?? (today ? cardLine(state.doc) : null);
  if (line === null) return Decoration.none;
  const words = summary(trainingLines(state.doc.toString()).map(({ entry }) => entry));
  // After the log card when both sit under the title, so the day reads food first.
  const widget = Decoration.widget({ widget: new TrainingCard(day, words), block: true, side: 3 });
  return Decoration.set([widget.range(state.doc.line(line).to)]);
}

const field = StateField.define<DecorationSet>({
  create: build,
  update: (value, tr) => (tr.docChanged ? build(tr.state) : value),
  provide: (card) => EditorView.decorations.from(card),
});

/** The card as an editor extension. */
export const trainingCard: Extension = field;
