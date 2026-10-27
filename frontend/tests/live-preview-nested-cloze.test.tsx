import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { fireEvent, waitFor } from "@testing-library/react";
import { imagePaths } from "@/lib/image";
import { livePreview } from "@/lib/live/live-preview";
import { vaultPaths } from "@/lib/wikilink";
import { liveHooks, mount, plain } from "./live-preview-fixture";

liveHooks();

describe("a nested cloze", () => {
  const NESTED = "{{c1::a {{c2::b::h2}}::h1}}";

  /** The text drawn for the document's last line. */
  function lastLine(view: EditorView): string {
    return [...view.contentDOM.querySelectorAll(".cm-line")].at(-1)?.textContent ?? "";
  }

  it("A7 live preview shows a nested cloze as typed", () => {
    const view = mount(`intro\n\n${NESTED}`, plain(null));

    expect(lastLine(view)).toBe(NESTED);
  });

  it("A8 a nested cloze line stays intact with vim on and off", async () => {
    const on = mount(`intro\n\n${NESTED}`, [
      vim(),
      livePreview(),
      vaultPaths.of([]),
      imagePaths.of([]),
    ]);
    // jsdom sends no text input, so vim's keys carry the cursor to the end of
    // the line and the character goes in as a dispatch, the way typing lands.
    fireEvent.keyDown(on.contentDOM, { key: "G" });
    fireEvent.keyDown(on.contentDOM, { key: "A" });
    const end = on.state.selection.main.head;
    expect(end).toBe(on.state.doc.length);
    on.dispatch({ changes: { from: end, insert: "!" }, userEvent: "input.type" });
    fireEvent.keyDown(on.contentDOM, { key: "Escape" });

    expect(on.state.doc.toString()).toBe(`intro\n\n${NESTED}!`);
    await waitFor(() => expect(lastLine(on)).toBe(`${NESTED}!`));

    const off = mount(`intro\n\n${NESTED}`, plain(null));
    off.dispatch({ selection: EditorSelection.cursor(off.state.doc.length) });
    off.dispatch({
      changes: { from: off.state.doc.length, insert: "!" },
      userEvent: "input.type",
    });

    expect(off.state.doc.toString()).toBe(`intro\n\n${NESTED}!`);
    expect(lastLine(off)).toBe(`${NESTED}!`);
  });
});
