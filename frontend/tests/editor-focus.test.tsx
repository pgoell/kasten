import { fireEvent, render } from "@testing-library/react";
import { Editor } from "@/components/editor";

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
