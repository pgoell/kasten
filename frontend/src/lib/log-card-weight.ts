/**
 * The question a kind that keeps its last value asks on the card, when its button is
 * pressed with no number in the amount field: the words, the placeholder and the focus
 * of the field. The card holds the question in its state as the mark of the kind asked.
 */

import { StateEffect } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { focusInPlace } from "@/lib/log-card-view";
import { kindLine, type LogKind } from "@/lib/log-kinds";

/** The mark of the last kind the card asks a number for, or null once the question is taken back. */
export const asking = StateEffect.define<string | null>();

/** The words a last kind's question shows: the ones `kindLine` gives an empty amount. */
export function askWords(kind: LogKind): string {
  const line = kindLine(kind, "");
  return typeof line === "string" ? "" : line.why;
}

/** The placeholder of the amount field while a kind asks for its number, which names the unit. */
export function askPlaceholder(kind: LogKind): string {
  return kind.unit === "" ? kind.name : `${kind.name} in ${kind.unit}`;
}

/**
 * Redraws the card with `effect`, keeping what the amount field holds: its text and
 * its focus. A redraw makes a new field, which is otherwise empty and unfocused.
 */
export function keepingField(view: EditorView, effect: StateEffect<unknown>): void {
  const field = view.dom.querySelector<HTMLInputElement>(".cm-log-amount");
  const typed = field?.value ?? "";
  const focused = field !== null && document.activeElement === field;
  view.dispatch({ effects: effect });
  const next = view.dom.querySelector<HTMLInputElement>(".cm-log-amount");
  if (next !== null) {
    next.value = typed;
    if (focused) next.focus({ preventScroll: true });
  }
}

/** Puts the focus in the card's amount field, when the card is drawn. */
export function focusAmount(view: EditorView): void {
  const field = view.dom.querySelector<HTMLInputElement>(".cm-log-amount");
  if (field !== null) focusInPlace(field);
}

/** Asks for the number `mark`'s kind needs: its words and placeholder show, and the field takes the focus. */
export function askFor(view: EditorView, mark: string): void {
  keepingField(view, asking.of(mark));
  focusAmount(view);
}
