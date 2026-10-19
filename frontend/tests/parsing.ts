/**
 * Control over CodeMirror's first parse, for the tests that read what it drew.
 *
 * CodeMirror parses for 20 ms on a new state and leaves the rest to an idle
 * callback that a synchronous test never reaches. These two let a test starve
 * that first parse on purpose and then finish it, so the result does not hang
 * on how busy the machine is (#618, #666).
 */

import { forceParsing } from "@codemirror/language";
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
