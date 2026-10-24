import { fireEvent, render } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { content, cursorTo, viewIn } from "./table-lineup-fixture";

/** A table with an emoji outside the BMP in its second row, so every row after it is one unit off in code points. */
const SOURCE = "| a | b |\n|---|---|\n| 😀 | x |\n| c | d |";

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

/** Presses Tab through the editor's keymap, or Shift-Tab when `shift` is set. */
function press(container: HTMLElement, shift = false): void {
  fireEvent.keyDown(content(container), { key: "Tab", shiftKey: shift });
}

describe("Tab through a table with an emoji row", () => {
  it("#921 I5 vim off, Tab and Shift-Tab land right below an emoji row", () => {
    localStorage.setItem("kasten.vim", "off");
    const { container } = render(<Editor initialDoc={SOURCE} preview={false} />);
    const view = viewIn(container);
    cursorTo(view, 2);

    for (let step = 0; step < 4; step++) press(container);
    const { head } = view.state.selection.main;
    expect(view.state.doc.sliceString(head, head + 1)).toBe("c");

    press(container, true);
    const back = view.state.selection.main.head;
    expect(view.state.doc.sliceString(back, back + 1)).toBe("x");
  });

  it("#921 I5 vim on, Tab and Shift-Tab land right below an emoji row", () => {
    localStorage.setItem("kasten.vim", "on");
    const { container } = render(<Editor initialDoc={SOURCE} preview={false} />);
    const view = viewIn(container);
    cursorTo(view, 2);
    // Tab is the same key in insert mode, so the walk is checked there too.
    fireEvent.keyDown(content(container), { key: "i" });

    for (let step = 0; step < 4; step++) press(container);
    const { head } = view.state.selection.main;
    expect(view.state.doc.sliceString(head, head + 1)).toBe("c");

    press(container, true);
    const back = view.state.selection.main.head;
    expect(view.state.doc.sliceString(back, back + 1)).toBe("x");
  });
});
