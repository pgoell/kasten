import { EditorView } from "@codemirror/view";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { content, liveHooks, parsed, renderEditor } from "./live-preview-fixture";

liveHooks();

describe("live preview", () => {
  it("renders blockquotes and list bullets", () => {
    const { container } = renderEditor(<Editor initialDoc={"> quoted\n\n- first\n- second"} />);

    expect(content(container)).toBe("quotedfirstsecond");
  });

  it("stops drawing the bullet on the line that shows its dash", async () => {
    const { container } = renderEditor(<Editor initialDoc={"- first\n- second"} />);
    const editor = container.querySelector(".cm-content") as HTMLElement;

    expect(container.querySelectorAll(".cm-bullet")).toHaveLength(2);

    fireEvent.keyDown(editor, { key: "i" });

    // The revealed line puts the real `- ` back on screen, and the drawn dot
    // beside it would be a second bullet on the same line.
    await waitFor(() => expect(container.querySelectorAll(".cm-bullet")).toHaveLength(1));
    expect(content(container)).toContain("- first");
  });

  it("draws every bullet once the parse that ran out of time is forced to the end", () => {
    // A clock that leaps a second each read spends the first parse's 20ms after
    // one step, the way a starved machine does (#365).
    let now = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => (now += 1000));
    const { container } = render(<Editor initialDoc={"- first\n- second"} />);
    clock.mockRestore();
    expect(container.querySelectorAll(".cm-bullet").length).toBeLessThan(2);

    parsed(
      EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement) as EditorView,
    );

    expect(container.querySelectorAll(".cm-bullet")).toHaveLength(2);
  });

  it("hides the whitespace that nests a list item", () => {
    const { container } = renderEditor(<Editor initialDoc={"- first\n  - nested"} />);

    expect(content(container)).toBe("firstnested");
  });

  it("indents a nested bullet past its parent", () => {
    // The spaces that nest the item are hidden with the dash, so the indent
    // has to be drawn or the nesting disappears from the render.
    const { container } = renderEditor(<Editor initialDoc={"- first\n  - nested"} />);
    const [parent, nested] = container.querySelectorAll<HTMLElement>(".cm-bullet");

    expect(parent?.style.paddingLeft).toBe("1.6em");
    expect(nested?.style.paddingLeft).toBe("3.2em");
  });

  it("draws each of the five todo states in place of its box", () => {
    // The symbol is a `::before` the way the bullet's dot is, and jsdom
    // computes neither, so the class that carries it is what is read here.
    for (const [box, state] of [
      [" ", "open"],
      ["/", "doing"],
      ["x", "done"],
      ["b", "blocked"],
      ["-", "rejected"],
    ]) {
      const { container, unmount } = renderEditor(<Editor initialDoc={`- [${box}] task`} />);

      expect(content(container)).toBe("task");
      expect(container.querySelector(`.cm-todo-${state}`)).not.toBeNull();
      unmount();
    }
  });

  it("draws a bullet holding a wikilink as a bullet, that being no todo", () => {
    const { container } = renderEditor(<Editor initialDoc="- [[borges]]" />);

    expect(container.querySelector("[class*='cm-todo']")).toBeNull();
    expect(container.querySelector(".cm-bullet")).not.toBeNull();
  });

  it("hands the box back on the line being edited", async () => {
    const { container } = renderEditor(<Editor initialDoc={"- [/] task"} />);

    fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "i" });

    // The symbol goes with it, or the line carries the drawing and its source.
    await waitFor(() => expect(content(container)).toContain("- [/] "));
    expect(container.querySelector("[class*='cm-todo']")).toBeNull();
  });

  it("leaves a todo's box to the bullet, link brackets and all", async () => {
    // `- [/] task` parses `[/]` as a link. The box is the bullet's to draw, and
    // a revealed line showed the box back without its brackets while the link
    // rendering had them.
    const { container } = renderEditor(<Editor initialDoc={"- [/] task"} />);

    fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "i" });

    await waitFor(() => expect(content(container)).toBe("- [/] task"));
  });

  it("keeps the cursor out of the box it hid", () => {
    // The hidden run on a todo is six characters rather than the bullet's two,
    // so the walk that keeps a cursor off them has further to go.
    const { container } = renderEditor(<Editor initialDoc="- [ ] task" />);
    const editor = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(editor, { key: "0" });
    fireEvent.keyDown(editor, { key: "x" });

    expect(content(container)).toBe("ask");
  });

  it("counts a parent's parts after its line, reaching the grandchildren", () => {
    const lines = [
      "- [/] parent",
      "  - [x] one",
      "  - [-] two",
      "  - [ ] three",
      "    - [x] four",
      "    - [ ] five",
    ];
    const { container } = renderEditor(<Editor initialDoc={lines.join("\n")} />);

    const counts = container.querySelectorAll(".cm-todo-progress");
    expect(counts).toHaveLength(2);
    // The parent's own count, and `three` carrying its two of its own.
    expect(counts[0]?.textContent).toBe("3/5");
    expect(counts[1]?.textContent).toBe("1/2");
  });

  it("counts nothing on a list of todos that nest under nothing", () => {
    const lines = ["- [ ] one", "- [x] two", "- [ ] three"];
    const { container } = renderEditor(<Editor initialDoc={lines.join("\n")} />);

    expect(container.querySelectorAll(".cm-todo-progress")).toHaveLength(0);
  });
});
