import { acceptCompletion, completionStatus, startCompletion } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { getCM } from "@replit/codemirror-vim";
import { act, fireEvent, render } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { vimModeField } from "@/lib/editor/vim-mode";

describe("Editor wikilink completion", () => {
  it("completes the name before an alias and keeps the alias, in vim mode", async () => {
    // Preview off: it hides `[[bor|` until the cursor is in the link, and
    // would walk a caret set straight into it out the far side.
    const { container } = render(
      <Editor initialDoc="[[bor|Jo]]" paths={["reading/borges.md", "index.md"]} preview={false} />,
    );
    const view = EditorView.findFromDOM(
      container.querySelector(".cm-editor") as HTMLElement,
    ) as EditorView;
    expect(getCM(view)).not.toBeNull();

    // Normal mode's block cursor is a selection, and a list only opens on a
    // bare caret, so `i` first: insert mode is where the name gets typed.
    act(() => view.focus());
    fireEvent.keyDown(view.contentDOM, { key: "i" });
    act(() => {
      view.dispatch({ selection: { anchor: "[[bor".length } });
      startCompletion(view);
    });
    // The list opens asynchronously, and accepting is refused for a moment
    // after it opens so a stray keystroke cannot pick from it.
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));
    await vi.waitFor(() => expect(acceptCompletion(view)).toBe(true));

    expect(view.state.doc.toString()).toBe("[[reading/borges|Jo]]");
  });

  it("completes the name before an alias with live preview on, in vim mode", async () => {
    const { container } = render(
      <Editor initialDoc="[[bor|Jo]]" paths={["reading/borges.md", "index.md"]} />,
    );
    const view = EditorView.findFromDOM(
      container.querySelector(".cm-editor") as HTMLElement,
    ) as EditorView;
    expect(getCM(view)).not.toBeNull();

    // The way a person gets there: into insert mode, onto the link so live
    // preview shows its source, and only then into the name. The mode reaches
    // live preview a microtask after the key, so it is waited for.
    act(() => view.focus());
    fireEvent.keyDown(view.contentDOM, { key: "i" });
    await vi.waitFor(() => expect(view.state.field(vimModeField)).toBe("insert"));
    act(() => view.dispatch({ selection: { anchor: view.state.doc.length } }));
    act(() => view.dispatch({ selection: { anchor: "[[bor".length } }));
    expect(view.state.selection.main.head).toBe("[[bor".length);

    act(() => {
      startCompletion(view);
    });
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));
    await vi.waitFor(() => expect(acceptCompletion(view)).toBe(true));

    expect(view.state.doc.toString()).toBe("[[reading/borges|Jo]]");
  });
});
