import { EditorView } from "@codemirror/view";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab and Shift Tab inside `box`, wrapping at either end. True when it took the key. */
export function trapTab(event: KeyboardEvent | React.KeyboardEvent, box: HTMLElement): boolean {
  if (event.key !== "Tab" || event.ctrlKey || event.altKey || event.metaKey) return false;
  const stops = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (first === undefined || last === undefined) {
    event.preventDefault();
    box.focus();
    return true;
  }
  const at = document.activeElement;
  const inside = at instanceof Node && box.contains(at) && at !== box;
  if (event.shiftKey && (!inside || at === first)) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && (!inside || at === last)) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

/**
 * Gives the focus back to what held it before a dialog, a note through its own view: a bare focus
 * on a phone reads the DOM's caret, at the note's start (#2094, #1976, #2311). No keyboardUnasked():
 * the dialog's field raised the keyboard, and the follow-up types (#2312).
 */
export function focusBack(opener: Element | null): void {
  if (!(opener instanceof HTMLElement)) return;
  const view = EditorView.findFromDOM(opener);
  if (view === null) opener.focus();
  else view.focus();
}
