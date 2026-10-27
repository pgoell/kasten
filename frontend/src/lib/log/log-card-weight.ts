/**
 * The question a kind that keeps its last value asks on the card, when its button is
 * pressed with no number in the amount field: the words, the placeholder and the focus
 * of the field. The card holds the question in its state as the mark of the kind asked.
 */

import { StateEffect } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { focusInPlace } from "@/lib/log/log-card-view";
import { kindLine, type LogKind } from "@/lib/log/log-kinds";

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

/**
 * Says why an amount is no amount of its kind, in the warn colour. A question the card
 * asks stays, with its field and Enter, so the fixed number can still be written.
 */
export function refuse(view: EditorView, why: string): void {
  const element = view.dom.querySelector<HTMLElement>(".cm-log-why");
  if (element === null) return;
  element.classList.remove("cm-log-ask");
  element.textContent = why;
}

/** Draws the question of `kind` in the why line, as a question and not a refusal. */
export function showQuestion(view: EditorView, kind: LogKind): void {
  const element = view.dom.querySelector<HTMLElement>(".cm-log-why");
  if (element === null) return;
  element.classList.add("cm-log-ask");
  element.textContent = askWords(kind);
}

/**
 * What a view's amount field held and whether it had the focus, kept across redraws of
 * the card that come from any change to the note, not only from the card's own presses.
 */
const amountMemo = new WeakMap<EditorView, { typed: string; focused: boolean }>();

/** Keeps `amount`'s text and focus for the next redraw, and puts back what the last one held. */
export function rememberAmount(view: EditorView, amount: HTMLInputElement): void {
  const memo = amountMemo.get(view);
  const remember = () =>
    amountMemo.set(view, { typed: amount.value, focused: document.activeElement === amount });
  amount.addEventListener("input", remember);
  amount.addEventListener("focus", remember);
  amount.addEventListener("blur", remember);
  if (memo === undefined) return;
  amount.value = memo.typed;
  if (memo.focused) {
    queueMicrotask(() => {
      if (amount.isConnected) focusInPlace(amount);
    });
  }
}

/** Forgets the amount a view held, after the card wrote a line from it. */
export function forgetAmount(view: EditorView): void {
  amountMemo.delete(view);
}
