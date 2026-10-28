import { undoDepth } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { fireEvent } from "@testing-library/react";
import { periodicNote } from "@/lib/periodic";
import { NOW, open, pinClock, stubCommands, TODAY } from "./keybindings-fixture";

describe("the leader key", () => {
  pinClock();

  it("makes a todo of the line under the cursor on space then x", () => {
    const { editor, doc } = open("plain");

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "x" });

    expect(doc()).toBe(`- [ ] plain ➕ ${TODAY}`);
  });

  it("leaves the cursor on the words rather than inside the box it wrote", () => {
    const { editor, doc } = open("plain");

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "x" });
    // The box is hidden and drawn as a symbol, so a cursor left where it was
    // would sit on a character nobody can see and this press would cut the
    // dash rather than the first letter.
    fireEvent.keyDown(editor, { key: "x" });

    expect(doc()).toBe(`- [ ] lain ➕ ${TODAY}`);
  });

  it("takes a parent's parts into done with it, in one press", () => {
    const { editor, doc } = open("- [/] wire up the pane\n  - [ ] write it\n  - [ ] ship it");

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "x" });

    const lines = doc().split("\n");
    // The parent's id is whatever `newId` made, so it is matched rather than
    // written out. Neither part gets one: nothing names a part.
    expect(lines[0]).toMatch(new RegExp(`^- \\[x\\] wire up the pane ✅ ${TODAY} 🆔 kt-\\w{6}$`));
    expect(lines[1]).toBe(`  - [x] write it ✅ ${TODAY}`);
    expect(lines[2]).toBe(`  - [x] ship it ✅ ${TODAY}`);
  });

  it("puts every line the cascade moved back on one u", () => {
    const note = "- [/] wire up the pane\n  - [ ] write it\n  - [ ] ship it";
    const { editor, doc } = open(note);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "x" });
    fireEvent.keyDown(editor, { key: "u" });

    expect(doc()).toBe(note);
  });

  it("stamps an id on the todo under the cursor on space then i", () => {
    // The spec's second stamp, the one entering done is not: a `⛔` is written
    // by hand and needs an id to name.
    const { editor, doc } = open("- [ ] wire up the pane");

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "i" });

    expect(doc()).toMatch(/^- \[ \] wire up the pane 🆔 kt-\w{6}$/);
  });

  it("leaves the id it wrote on a second press", () => {
    const { editor, doc } = open("- [ ] wire up the pane");

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "i" });
    const stamped = doc();
    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "i" });

    expect(doc()).toBe(stamped);
  });

  it("moves a dependent in the same note in the press that closes its blocker", () => {
    const note = "- [/] ship it 🆔 kt-000001\n- [b] write the docs ⛔ kt-000001";
    const { editor, doc } = open(note);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "x" });

    expect(doc().split("\n")[1]).toBe("- [ ] write the docs ⛔ kt-000001");

    fireEvent.keyDown(editor, { key: "u" });

    // One press, so one undo takes back both lines.
    expect(doc()).toBe(note);
  });

  it("leaves a recurring todo's next copy above it, and takes both back on u", () => {
    const note = "- [/] water the plants 🔁 every week 📅 2999-01-07";
    const { editor, doc } = open(note);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "x" });

    const lines = doc().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("- [ ] water the plants 📅 2999-01-14 🔁 every week");
    expect(lines[1]).toContain("✅");

    fireEvent.keyDown(editor, { key: "u" });

    expect(doc()).toBe(note);
  });

  it("sets the state a leader s key names, from wherever the line was", () => {
    const { editor, doc } = open("- [ ] wire up the pane");

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "s" });
    fireEvent.keyDown(editor, { key: "b" });

    // Blocked is not on the walk, so this key is the only way to it.
    expect(doc()).toBe("- [b] wire up the pane");
  });

  it("sets a todo to waiting on leader s w, stamping the day the wait began", () => {
    const { editor, doc } = open("- [ ] wire up the pane");

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "s" });
    fireEvent.keyDown(editor, { key: "w" });

    expect(doc()).toMatch(/^- \[w\] wire up the pane 👤 \d{4}-\d{2}-\d{2}$/);
  });

  it("sets a todo to waiting for review on leader s v", () => {
    const { editor, doc } = open("- [ ] wire up the pane");

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "s" });
    fireEvent.keyDown(editor, { key: "v" });

    expect(doc()).toBe("- [r] wire up the pane");
  });

  it("takes leader s v back on one u", () => {
    const note = "- [x] wire up the pane ✅ 2026-01-02";
    const { editor, doc } = open(note);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "s" });
    fireEvent.keyDown(editor, { key: "v" });
    expect(doc()).toBe("- [r] wire up the pane");
    fireEvent.keyDown(editor, { key: "u" });

    expect(doc()).toBe(note);
  });

  it("tidies the note's markdown on the leader's format key", () => {
    const { editor, doc } = open("* one   \n\n\n* two");

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "=" });

    expect(doc()).toBe("- one\n\n- two");
  });

  it("takes a part into done with its parent on a key that names done", () => {
    const { editor, doc } = open("- [ ] wire up the pane\n  - [ ] write it");

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "s" });
    fireEvent.keyDown(editor, { key: "x" });

    // Straight to done from open, and the cascade goes with it exactly as it
    // does when the walk arrives there.
    expect(doc().split("\n")[1]).toBe(`  - [x] write it ✅ ${TODAY}`);
  });

  it("waits for the second letter rather than acting on space then s", () => {
    const { editor, doc } = open("- [ ] wire up the pane");

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "s" });

    expect(doc()).toBe("- [ ] wire up the pane");
  });

  it("reports the line it cycled, so the done log can follow it", () => {
    // The press edits the buffer and autosave writes it, which is what keeps
    // `u` working. The `## Done` line lands in another note, so the route has
    // to be told, and it is told what the line read before and after.
    const { editor, onCycleTodo } = open("- [/] wire up the pane 🆔 kt-3f9a2c");

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "x" });

    expect(onCycleTodo).toHaveBeenCalledWith({
      before: "- [/] wire up the pane 🆔 kt-3f9a2c",
      after: `- [x] wire up the pane ✅ ${TODAY} 🆔 kt-3f9a2c`,
      line: 1,
      doc: "- [/] wire up the pane 🆔 kt-3f9a2c",
    });
  });

  it("logs a todo living in today's own note into that same buffer", () => {
    // The one note the route cannot write, this being the buffer being typed
    // into, so the press carries both halves and `u` takes back both.
    const { editor, doc } = open(
      "- [/] wire up the pane 🆔 kt-3f9a2c",
      stubCommands(),
      periodicNote("daily", NOW).path,
    );

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "x" });

    expect(doc()).toBe(
      `- [x] wire up the pane ✅ ${TODAY} 🆔 kt-3f9a2c\n\n## Done\n- ✅ ${TODAY} wire up the pane kt-3f9a2c\n`,
    );
  });

  it("leaves the log to the route for a todo living in any other note", () => {
    const { editor, doc } = open(
      "- [/] wire up the pane 🆔 kt-3f9a2c",
      stubCommands(),
      "kasten.md",
    );

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "x" });

    expect(doc()).toBe(`- [x] wire up the pane ✅ ${TODAY} 🆔 kt-3f9a2c`);
  });

  it("logs nothing for leader s x on a done todo in today's own note, however often", () => {
    const note = `- [x] a ✅ ${TODAY}`;
    const { editor, doc } = open(note, stubCommands(), periodicNote("daily", NOW).path);

    for (const _ of [1, 2]) {
      fireEvent.keyDown(editor, { key: " " });
      fireEvent.keyDown(editor, { key: "s" });
      fireEvent.keyDown(editor, { key: "x" });
    }

    expect(doc()).toBe(note);
  });

  it("reports nothing for leader s x on a done todo in any other note", () => {
    const { editor, onCycleTodo } = open(`- [x] a ✅ ${TODAY}`, stubCommands(), "kasten.md");

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "s" });
    fireEvent.keyDown(editor, { key: "x" });

    expect(onCycleTodo).not.toHaveBeenCalled();
  });

  it("writes and reports nothing for leader s x on a done todo carrying an id", () => {
    const note = `- [x] a ✅ ${TODAY} 🆔 kt-3f9a2c`;
    const { editor, doc, onCycleTodo } = open(note, stubCommands(), "kasten.md");

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "s" });
    fireEvent.keyDown(editor, { key: "x" });

    expect(doc()).toBe(note);
    expect(onCycleTodo).not.toHaveBeenCalled();
  });

  it("leaves the cursor and the undo history alone on leader s b on a blocked todo", () => {
    const note = "- [b] wire up the pane";
    const { container, editor, doc, onCycleTodo } = open(note, stubCommands(), "kasten.md");
    const view = EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement);
    if (view === null) throw new Error("no view");

    // Off the first word, where a press that dispatched would put the cursor.
    fireEvent.keyDown(editor, { key: "$" });
    const head = view.state.selection.main.head;

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "s" });
    fireEvent.keyDown(editor, { key: "b" });

    expect(view.state.selection.main.head).toBe(head);
    expect(undoDepth(view.state)).toBe(0);
    fireEvent.keyDown(editor, { key: "u" });
    expect(doc()).toBe(note);
    expect(view.state.selection.main.head).toBe(head);
    expect(onCycleTodo).not.toHaveBeenCalled();
  });

  it("logs one line for leader s x on an open todo in today's own note", () => {
    const { editor, doc } = open("- [ ] a", stubCommands(), periodicNote("daily", NOW).path);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "s" });
    fireEvent.keyDown(editor, { key: "x" });

    expect(doc()).toMatch(
      new RegExp(
        `^- \\[x\\] a ✅ ${TODAY} 🆔 (kt-[0-9a-f]{6})\\n\\n## Done\\n- ✅ ${TODAY} a \\1\\n$`,
        "u",
      ),
    );
  });

  it("stops space from moving the cursor", () => {
    const { editor, doc } = open("plain");

    // Vim ships `<Space>` bound to `l`. Were it still bound, the space would
    // step onto the `l` and the `x` sequence would never form, leaving "pain".
    // Read through the document rather than the screen: `<Space>x` now hides
    // the box it writes, so the rendered text would look right either way.
    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "x" });

    expect(doc()).toBe(`- [ ] plain ➕ ${TODAY}`);
  });
});

describe("the clock after the leader key's tests", () => {
  // `pinClock` above holds `Date` for that block alone; a later test must read
  // the real clock, or a pin would hide a stamp from the wrong day (#1315).
  it("#1315 reads a running clock again once the pinned block is done", () => {
    // A pinned clock stands still; a released one moves within a few ms.
    const first = Date.now();
    const start = performance.now();
    while (Date.now() === first && performance.now() - start < 100) {}
    expect(Date.now()).toBeGreaterThan(first);
  });
});
