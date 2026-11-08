import { isolateHistory, redo, undo } from "@codemirror/commands";
import { Transaction } from "@codemirror/state";
import { act, fireEvent, render } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { takeVaultText } from "@/lib/notes/editor/buffer-writes";
import { runExCommand } from "./editor-fixture";
import { content, typeAt, viewIn } from "./table-lineup-fixture";

const BODY = "# Welcome\n\nThe front door.\nA second line.\n";
const STAMP =
  "---\nid: 01\ncreated: 2026-11-08T10:00:00+00:00\ntype: Note\nmodified: 2026-11-08T10:00:00+00:00\n---\n";
const LINE = "A line typed by the test.";

/** Vim keys one by one, each its own task as on a keyboard: vim's mode reaches the state a microtask later. */
async function press(el: HTMLElement, keys: string[]) {
  for (const key of keys) {
    fireEvent.keyDown(el, { key });
    await act(async () => {});
  }
}

/** What the save's reply does: the vault's text, here with its `modified` restamped, put in off the undo stack. */
function landSave(view: ReturnType<typeof viewIn>, stamp = STAMP) {
  const doc = view.state.doc.toString();
  const body = doc.startsWith("---\n") ? doc.slice(doc.indexOf("\n---\n") + 5) : doc;
  act(() =>
    takeVaultText(view, stamp.replace("10:00:00+00:00\n---", "10:00:05+00:00\n---") + body),
  );
}

function typeHere(view: ReturnType<typeof viewIn>, text: string, at = Date.now()) {
  const head = view.state.selection.main.head;
  act(() =>
    view.dispatch({
      changes: { from: head, insert: text },
      selection: { anchor: head + text.length },
      userEvent: "input.type",
      annotations: Transaction.time.of(at),
    }),
  );
}

describe("#1662 one u takes back a whole vim insert", () => {
  async function insertThenUndo(doc: string, keys: string[], during = false) {
    const { container } = render(<Editor initialDoc={doc} preview={false} />);
    const view = viewIn(container);
    const el = content(container);
    await press(el, keys);
    typeHere(view, LINE.slice(0, 6));
    if (during) landSave(view);
    typeHere(view, LINE.slice(6));
    await press(el, ["Escape"]);
    const typed = view.state.doc.toString();
    if (!during) landSave(view);
    const saved = view.state.doc.toString();
    await press(el, ["u"]);
    return { view, el, typed, saved, stamped: saved.slice(0, saved.indexOf("\n---\n") + 5) };
  }

  it("Go at the end, a save after Escape, u: the body is byte for byte as before", async () => {
    const { view, stamped } = await insertThenUndo(BODY, ["G", "o"]);
    expect(view.state.doc.toString()).toBe(stamped + BODY);
  });

  it("Go, a save that lands during the insert, u: the body is byte for byte as before", async () => {
    const { view, stamped } = await insertThenUndo(BODY, ["G", "o"], true);
    expect(view.state.doc.toString()).toBe(stamped + BODY);
  });

  it("O above a middle line, a save, u: as before", async () => {
    const { view, stamped } = await insertThenUndo(BODY, ["g", "g", "j", "j", "O"]);
    expect(view.state.doc.toString()).toBe(stamped + BODY);
  });

  it("O on the first line, a save, u: as before", async () => {
    const { view, stamped } = await insertThenUndo(BODY, ["g", "g", "O"]);
    expect(view.state.doc.toString()).toBe(stamped + BODY);
  });

  it("o in the middle of a note, a save, u: as before", async () => {
    const { view, stamped } = await insertThenUndo(BODY, ["g", "g", "j", "j", "o"]);
    expect(view.state.doc.toString()).toBe(stamped + BODY);
  });

  it("Go in a note already stamped, the save restamping modified, u: as before", async () => {
    const { view, saved } = await insertThenUndo(STAMP + BODY, ["G", "o"]);
    expect(view.state.doc.toString()).toBe(saved.slice(0, STAMP.length) + BODY);
  });

  it("ctrl+r after that u puts the whole insert back, and the stamp stays through both", async () => {
    const { view, el, typed, saved, stamped } = await insertThenUndo(BODY, ["G", "o"]);
    fireEvent.keyDown(el, { key: "r", ctrlKey: true });
    expect(view.state.doc.toString()).toBe(saved);
    expect(saved).toBe(stamped + typed);
  });

  it("a pause in the typing still leaves one insert for one u", async () => {
    const { container } = render(<Editor initialDoc={BODY} preview={false} />);
    const view = viewIn(container);
    const el = content(container);
    await press(el, ["G", "o"]);
    typeHere(view, "first ");
    typeHere(view, "second", Date.now() + 5_000);
    await press(el, ["Escape", "u"]);
    expect(view.state.doc.toString()).toBe(BODY);
  });

  it("an insert after dd is its own undo: u takes back the insert and leaves the dd", async () => {
    const { container } = render(<Editor initialDoc={BODY} preview={false} />);
    const view = viewIn(container);
    const el = content(container);
    await press(el, ["g", "g", "d", "d", "i"]);
    const deleted = view.state.doc.toString();
    typeHere(view, LINE);
    await press(el, ["Escape", "u"]);
    expect(view.state.doc.toString()).toBe(deleted);
  });

  it("a click elsewhere mid-insert ends the undo step: u takes back only what came after it", async () => {
    const { container } = render(<Editor initialDoc={BODY} preview={false} />);
    const view = viewIn(container);
    const el = content(container);
    await press(el, ["i"]);
    typeHere(view, "foo");
    const between = view.state.doc.toString();
    act(() =>
      view.dispatch({ selection: { anchor: between.length }, userEvent: "select.pointer" }),
    );
    typeHere(view, "bar");
    await press(el, ["Escape", "u"]);
    expect(view.state.doc.toString()).toBe(between);
  });

  it("an arrow key mid-insert ends the undo step too, after o", async () => {
    const { container } = render(<Editor initialDoc={BODY} preview={false} />);
    const view = viewIn(container);
    const el = content(container);
    await press(el, ["g", "g", "o"]);
    typeHere(view, "foo");
    await press(el, ["ArrowDown"]);
    const between = view.state.doc.toString();
    typeHere(view, "bar");
    await press(el, ["Escape", "u"]);
    expect(view.state.doc.toString()).toBe(between);
  });

  it.each([
    ["i", ["g", "g", "d", "d", "A"]],
    ["o", ["g", "g", "d", "d", "o"]],
  ])("an undo mid-insert after %s ends the join: u then leaves the dd done", async (_, keys) => {
    const { container } = render(<Editor initialDoc={BODY} preview={false} />);
    const view = viewIn(container);
    const el = content(container);
    await press(el, keys.slice(0, 4));
    const deleted = view.state.doc.toString();
    await press(el, keys.slice(4));
    typeHere(view, "foo");
    act(() => undo(view));
    const between = view.state.doc.toString();
    typeHere(view, "bar");
    await press(el, ["Escape", "u"]);
    expect(view.state.doc.toString()).toBe(between);
    await press(el, ["u"]);
    expect(view.state.doc.toString()).not.toBe(deleted);
  });

  it("a redo mid-insert ends the join too: u takes back only the typing after it", async () => {
    const { container } = render(<Editor initialDoc={BODY} preview={false} />);
    const view = viewIn(container);
    const el = content(container);
    await press(el, ["G", "o"]);
    typeHere(view, "foo");
    act(() => undo(view));
    act(() => redo(view));
    const between = view.state.doc.toString();
    typeHere(view, "bar");
    await press(el, ["Escape", "u"]);
    expect(view.state.doc.toString()).toBe(between);
  });

  it("a step kept apart mid-insert, as the table line-up is, keeps its own undo", async () => {
    const { container } = render(<Editor initialDoc={BODY} preview={false} />);
    const view = viewIn(container);
    const el = content(container);
    await press(el, ["G", "o"]);
    typeHere(view, "foo");
    act(() =>
      view.dispatch({ changes: { from: 0, insert: "x" }, annotations: isolateHistory.of("full") }),
    );
    const between = view.state.doc.toString();
    typeHere(view, "bar");
    await press(el, ["Escape", "u"]);
    expect(view.state.doc.toString()).toBe(between);
  });

  it("with vim off, a line typed at the end, a save, ctrl+z: the body as before", async () => {
    localStorage.setItem("kasten.vim", "off");
    const { container } = render(<Editor initialDoc={BODY} preview={false} />);
    const view = viewIn(container);
    typeAt(view, BODY.length, `\n${LINE}`);
    landSave(view);
    const stamped = view.state.doc.toString().slice(0, STAMP.length);
    fireEvent.keyDown(content(container), { key: "z", ctrlKey: true });
    localStorage.clear();
    expect(view.state.doc.toString()).toBe(stamped + BODY);
  });
});

describe("Editor", () => {
  it("starts in vim normal mode, so keys act as commands", () => {
    const { container } = render(<Editor initialDoc={"line one\nline two"} />);
    const content = container.querySelector(".cm-content") as HTMLElement;

    // `dd` in normal mode deletes the line the cursor sits on.
    fireEvent.keyDown(content, { key: "d" });
    fireEvent.keyDown(content, { key: "d" });

    expect(content.textContent).toBe("line two");
  });

  it("mounts a CodeMirror view holding the initial document", () => {
    // No markdown syntax: live preview hides the marks, and what this test is
    // about is that the view mounted holding the document it was given.
    const { container } = render(<Editor initialDoc="hello" />);

    expect(container.querySelector(".cm-editor")).not.toBeNull();
    expect(container.querySelector(".cm-content")?.textContent).toBe("hello");
  });

  it("saves on ctrl+s, and keeps the browser's own save dialog shut", () => {
    const onSave = vi.fn();
    const { container } = render(<Editor initialDoc="# hello" onSave={onSave} />);
    const content = container.querySelector(".cm-content") as HTMLElement;

    const handled = fireEvent.keyDown(content, { key: "s", ctrlKey: true });

    expect(onSave).toHaveBeenCalledWith("# hello");
    // fireEvent returns false once something called preventDefault.
    expect(handled).toBe(false);
  });

  it("saves on :w, because vim mode is on and that is the reflex", () => {
    const onSave = vi.fn();
    const { container } = render(<Editor initialDoc="# hello" onSave={onSave} />);

    runExCommand(container, "w");

    expect(onSave).toHaveBeenCalledWith("# hello");
  });

  it("saves the text as it stands, not the text it opened with", () => {
    const onSave = vi.fn();
    const { container } = render(<Editor initialDoc={"line one\nline two"} onSave={onSave} />);
    const content = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(content, { key: "d" });
    fireEvent.keyDown(content, { key: "d" });
    fireEvent.keyDown(content, { key: "s", ctrlKey: true });

    expect(onSave).toHaveBeenCalledWith("line two");
  });

  it("reports an undo like any other edit, so what you undo is written too", () => {
    const onChange = vi.fn();
    const { container } = render(<Editor initialDoc={"line one\nline two"} onChange={onChange} />);
    const content = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(content, { key: "d" });
    fireEvent.keyDown(content, { key: "d" });
    fireEvent.keyDown(content, { key: "u" });

    expect(content.textContent).toBe("line oneline two");
    expect(onChange).toHaveBeenLastCalledWith("line one\nline two");
  });

  it("tears the view down on unmount", () => {
    const { container, unmount } = render(<Editor initialDoc="# hello" />);

    unmount();

    expect(container.querySelector(".cm-editor")).toBeNull();
  });
});
