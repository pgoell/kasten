import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { fireEvent, render } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { focusBack } from "@/lib/ui/focus-trap";

describe("the editor focus", () => {
  /** Somewhere else on the page that can hold the focus, as the tree does. */
  function elsewhere() {
    const button = document.createElement("button");
    document.body.append(button);
    return button;
  }

  it("takes the focus on mount, so the first key lands in the note", () => {
    const { container } = render(<Editor initialDoc="plain" />);

    expect(container.querySelector(".cm-content")).toHaveFocus();
  });

  it("editor: A4 an editor of a pane without the focus takes no focus on mount", () => {
    // A restored tab mounts every pane at once. Whichever mounted first would
    // take the focus, and the route would follow it there and drop the zoom.
    const { container } = render(<Editor initialDoc="plain" focused={false} />);

    expect(container.querySelector(".cm-content")).not.toHaveFocus();
    expect(document.body).toHaveFocus();
  });

  it("leaves the focus alone when something else already holds it", () => {
    // Opening a note from the tree remounts the editor. Taking the focus on
    // every mount would end browsing with `j` and Enter after one note.
    const tree = elsewhere();
    tree.focus();

    const { container } = render(<Editor initialDoc="plain" />);

    expect(tree).toHaveFocus();
    expect(container.querySelector(".cm-content")).not.toHaveFocus();
    tree.remove();
  });

  it("takes the focus back when the tab returns to nothing focused", () => {
    const { container } = render(<Editor initialDoc="plain" />);
    const content = container.querySelector(".cm-content") as HTMLElement;
    content.blur();

    fireEvent.focus(window);

    expect(content).toHaveFocus();
  });

  it("leaves the focus alone when the tab returns to the tree", () => {
    const { container } = render(<Editor initialDoc="plain" />);
    const tree = elsewhere();
    tree.focus();

    fireEvent.focus(window);

    expect(tree).toHaveFocus();
    expect(container.querySelector(".cm-content")).not.toHaveFocus();
    tree.remove();
  });
});

describe("coming back to the tab", () => {
  /** Leave the page with nothing focused, then return to it. */
  function leaveAndComeBack() {
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent(window, new Event("focus"));
  }

  it("takes the cursor back when this pane is the focused one", () => {
    // The window lands on the body when the page had nothing focused as you
    // left it, and the cursor is dead until you click. This is what revives it.
    const { container } = render(<Editor initialDoc="one" focused />);

    leaveAndComeBack();

    expect(container.querySelector(".cm-content")).toHaveFocus();
  });

  it("leaves the focus alone when another pane holds it", () => {
    // Every pane mounts one of these, and without the guard all of them race
    // for the focus on the way back in. The pane that wins is arbitrary, and a
    // terminal pane loses every time, because it has no editor to race with:
    // the shell silently stops receiving keys and only a click brings it back.
    const { container } = render(<Editor initialDoc="one" focused={false} />);

    leaveAndComeBack();

    expect(container.querySelector(".cm-content")).not.toHaveFocus();
    expect(document.body).toHaveFocus();
  });
});

describe("the focus a dialog gives back (#2311)", () => {
  function note() {
    const parent = document.createElement("div");
    document.body.append(parent);
    const state = EditorState.create({ doc: "# Walk\n\nThe walk:", selection: { anchor: 17 } });
    return new EditorView({ state, parent });
  }

  it("goes to a note through its view, which keeps its own caret", () => {
    const view = note();
    const focus = vi.spyOn(view, "focus");

    focusBack(view.contentDOM);

    expect(focus).toHaveBeenCalledOnce();
    expect(view.contentDOM).toHaveFocus();
    expect(view.state.selection.main.head).toBe(17);
    view.destroy();
  });

  it("goes to any other opener by its own focus", () => {
    const button = document.createElement("button");
    document.body.append(button);

    focusBack(button);

    expect(button).toHaveFocus();
    button.remove();
  });

  it("is a no-op for a note closed while the dialog was open, or no opener at all", () => {
    const view = note();
    view.destroy();
    view.dom.remove();

    expect(() => focusBack(view.contentDOM)).not.toThrow();
    expect(() => focusBack(null)).not.toThrow();
    expect(document.body).toHaveFocus();
  });
});
