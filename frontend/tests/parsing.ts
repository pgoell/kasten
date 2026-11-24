/**
 * Control over CodeMirror's first parse, for the tests that read what it drew.
 *
 * CodeMirror parses for 20 ms on a new state and leaves the rest to an idle
 * callback that a synchronous test never reaches. These two let a test starve
 * that first parse on purpose and then finish it, so the result does not hang
 * on how busy the machine is (#618, #666).
 */

import { forceParsing } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act, render } from "@testing-library/react";
import type { ReactElement } from "react";

/**
 * Finish parsing the document, the way the browser does when it is idle.
 *
 * On a loaded machine the 20 ms run out before the link is parsed, and then no
 * `.cm-wikilink` is drawn and `gf` finds no link (#618).
 */
export function finishParsing(container: HTMLElement) {
  const view = EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement);
  act(() => forceParsing(view as EditorView, (view as EditorView).state.doc.length, 5000));
}

/**
 * Make the clock jump on every read while `render` runs, so the first parse
 * stops after its first step, the way it does on a loaded machine.
 */
export function renderStarved(ui: ReactElement) {
  let now = Date.now();
  const clock = vi.spyOn(Date, "now").mockImplementation(() => {
    now += 25;
    return now;
  });
  try {
    return render(ui);
  } finally {
    clock.mockRestore();
  }
}

/** The text a line draws, its marks hidden or not. */
export function drawnLine(view: EditorView, number: number): string | null | undefined {
  const { node } = view.domAtPos(view.state.doc.line(number).from);
  const element = node instanceof HTMLElement ? node : node.parentElement;
  return element?.closest(".cm-line")?.textContent;
}

/** Whether a decoration hides `[from, to)`, on screen or not. */
export function hides(view: EditorView, from: number, to: number): boolean {
  let found = false;
  for (const source of view.state.facet(EditorView.decorations)) {
    const set = typeof source === "function" ? source(view) : source;
    set.between(from, to, (start, end, value) => {
      if (start === from && end >= to && value.spec.widget === undefined && !value.spec.class)
        found = true;
    });
  }
  return found;
}

/**
 * Rendered on a clock that jumps `by` at every read inside `EditorState.create`, so CodeMirror's 20 ms
 * first parse stops at its first step. With `open` false the editor's own parse on open is starved too.
 */
export function starved(ui: ReactElement, by = 30, open = true) {
  const real = Date.now.bind(Date);
  const create = EditorState.create.bind(EditorState);
  let now = real();
  let creating = false;
  const parse = vi.spyOn(EditorState, "create").mockImplementation((config) => {
    creating = true;
    try {
      return create(config);
    } finally {
      creating = false;
    }
  });
  const clock = vi.spyOn(Date, "now").mockImplementation(() => {
    if (open && !creating) return real();
    now += by;
    return now;
  });
  try {
    return render(ui);
  } finally {
    clock.mockRestore();
    parse.mockRestore();
  }
}
