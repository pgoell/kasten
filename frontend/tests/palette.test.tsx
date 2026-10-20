import { CompletionContext } from "@codemirror/autocomplete";
import { history, undo } from "@codemirror/commands";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { fireEvent, render, screen } from "@testing-library/react";
import { CommandPalette } from "@/components/command-palette";
import { readClock } from "@/lib/clock";
import { editorCommands } from "@/lib/editor-commands";
import { INSERTS, paletteEntries, slashCompletions, writeInsert } from "@/lib/palette";
import { periodicNote } from "@/lib/periodic";
import { notePath, todoCycled } from "@/lib/todo-commands";
import { stubCommands } from "./stub-commands";

function viewOf(doc: string, cursor = doc.length) {
  return new EditorView({ state: EditorState.create({ doc, selection: { anchor: cursor } }) });
}

function slashAt(doc: string) {
  const state = EditorState.create({ doc, extensions: [editorCommands.of(stubCommands())] });
  return slashCompletions(new CompletionContext(state, doc.length, false));
}

const table = INSERTS.find((insert) => insert.label === "Table");
const heading = INSERTS.find((insert) => insert.label === "Heading 2");

describe("the slash menu", () => {
  it("opens on a slash at the start of a line", () => {
    expect(slashAt("first\n/ta")?.from).toBe(7);
  });

  it("opens on a slash after a space", () => {
    expect(slashAt("some text /h")?.from).toBe(11);
  });

  it("stays shut inside a path or a URL", () => {
    expect(slashAt("see notes/inbox")).toBeNull();
    expect(slashAt("https://example.com/a")).toBeNull();
  });

  it("offers the inserts, the edits and the leader commands", () => {
    const labels = slashAt("/")?.options.map((option) => option.label) ?? [];
    expect(labels).toContain("Table");
    expect(labels).toContain("Cycle the todo on this line");
    expect(labels).toContain("Open today's note");
  });

  it("takes the slash out before running a command", () => {
    const commands = stubCommands();
    const view = new EditorView({
      state: EditorState.create({ doc: "x /gd", extensions: [editorCommands.of(commands)] }),
    });
    const result = slashCompletions(new CompletionContext(view.state, 5, false));
    const option = result?.options.find((entry) => entry.label === "Open today's note");
    if (typeof option?.apply !== "function") throw new Error("no apply");
    option.apply(view, option, result?.from ?? 0, 5);

    expect(view.state.doc.toString()).toBe("x ");
    expect(commands.openDaily).toHaveBeenCalledTimes(1);
  });
});

describe("an insert", () => {
  it("writes a table over the typed slash", () => {
    const view = viewOf("/table");
    if (!table) throw new Error("no table");
    writeInsert(view, table, 0, 6);
    expect(view.state.doc.toString()).toBe("| Column | Column |\n| --- | --- |\n|  |  |");
  });

  it("starts a line of its own when typed mid-line", () => {
    const view = viewOf("words ");
    if (!heading) throw new Error("no heading");
    writeInsert(view, heading, 6, 6);
    expect(view.state.doc.toString()).toBe("words \n## ");
  });
});

describe("the palette", () => {
  it("lists only the route's commands without an editor", () => {
    const labels = paletteEntries(stubCommands(), null).map((entry) => entry.label);
    expect(labels).toContain("Find a note");
    expect(labels).not.toContain("Table");
    // It cannot list itself: running it from inside it would do nothing.
    expect(labels).not.toContain("Run a command by name");
  });

  it("lists the inserts and edits over an editor", () => {
    const labels = paletteEntries(stubCommands(), viewOf("")).map((entry) => entry.label);
    expect(labels).toContain("Table");
    expect(labels).toContain("Bold");
  });

  it("narrows by fuzzy match, and Enter runs the highlighted row", () => {
    const commands = stubCommands();
    const onClose = vi.fn();
    render(<CommandPalette entries={paletteEntries(commands, null)} onClose={onClose} />);

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "graph vault" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(commands.openGraph).toHaveBeenCalledTimes(1);
  });

  it("runs the row that is tapped", () => {
    const commands = stubCommands();
    const onClose = vi.fn();
    render(<CommandPalette entries={paletteEntries(commands, null)} onClose={onClose} />);

    const row = screen.getByRole("option", { name: /Find a note/ });
    fireEvent.click(row);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(commands.findNote).toHaveBeenCalledTimes(1);
    // jsdom applies no media query, so the height is read off the class.
    expect(row).toHaveClass("pointer-coarse:min-h-11");
  });

  it("offers Read the current book and runs it from a tapped row", () => {
    const commands = stubCommands();
    render(<CommandPalette entries={paletteEntries(commands, null)} onClose={() => {}} />);

    // Looked up rather than got, so a missing row is an assertion that fails.
    const row = screen.queryByRole("option", { name: /^Read the current book/ });
    expect.soft(row).not.toBeNull();
    if (row) fireEvent.click(row);

    expect(commands.openReadingBook).toHaveBeenCalledTimes(1);
  });

  it("sets a todo to waiting for review from a tapped row, no vim in the editor", () => {
    // A bare view: no vim, so the row is the whole way in, as on a phone.
    const view = viewOf("- [ ] wire up the pane", 0);
    const onClose = vi.fn();
    render(<CommandPalette entries={paletteEntries(stubCommands(), view)} onClose={onClose} />);

    fireEvent.click(screen.getByRole("option", { name: /Set this todo to waiting for review/ }));

    expect(view.state.doc.toString()).toBe("- [r] wire up the pane");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("#523 A9 sends a todo to the agent from a tapped row, no vim in the editor", () => {
    // A bare view, as on a phone or with vim off: the row is the whole way in.
    const view = viewOf("- [ ] wire up the pane 📅 2026-10-20", 0);
    render(<CommandPalette entries={paletteEntries(stubCommands(), view)} onClose={vi.fn()} />);

    const row = screen.queryByRole("option", { name: /Send this todo to the agent/ });
    expect.soft(row).not.toBeNull();
    if (row) fireEvent.click(row);

    expect(view.state.doc.toString()).toBe("- [ ] wire up the pane #agent 📅 2026-10-20");
  });

  it("writes and reports nothing from a tapped done row on a done todo, no vim in the editor", () => {
    const tap = (path: string) => {
      const note = `- [x] a ✅ ${readClock(new Date()).date}`;
      const cycled = vi.fn();
      const view = new EditorView({
        state: EditorState.create({
          doc: note,
          extensions: [notePath.of(path), todoCycled.of(cycled)],
        }),
      });
      const { unmount } = render(
        <CommandPalette entries={paletteEntries(stubCommands(), view)} onClose={vi.fn()} />,
      );
      fireEvent.click(screen.getByRole("option", { name: /Set this todo to done/ }));
      unmount();
      return { note, doc: view.state.doc.toString(), cycled };
    };

    // Today's note, where the log would land in this buffer.
    const today = tap(periodicNote("daily", new Date()).path);
    expect(today.doc).toBe(today.note);
    // Any other note, where the route would be told to write it.
    const other = tap("kasten.md");
    expect(other.doc).toBe(other.note);
    expect(other.cycled).not.toHaveBeenCalled();
  });

  it("prints the key beside the command", () => {
    render(<CommandPalette entries={paletteEntries(stubCommands(), null)} onClose={vi.fn()} />);
    expect(screen.getByRole("option", { name: /Find a note/ }).textContent).toContain("Space f f");
  });
});

describe("the drink entries", () => {
  /** A view holding `path` as its note, the way the editor does. */
  function noteView(path: string, doc: string, extensions: Extension[] = []) {
    return new EditorView({
      state: EditorState.create({ doc, extensions: [notePath.of(path), ...extensions] }),
    });
  }

  /** Run the palette row called `label` over `view`, or over no editor. */
  function runDrink(
    label: string,
    commands: ReturnType<typeof stubCommands>,
    view: EditorView | null,
  ) {
    const entry = paletteEntries(commands, view).find((row) => row.label === label);
    if (!entry) throw new Error(`no ${label} row`);
    entry.run();
  }

  const today = periodicNote("daily", new Date()).path;

  it("lists the three drinks with no editor open", () => {
    const labels = paletteEntries(stubCommands(), null).map((entry) => entry.label);
    expect(labels).toEqual(expect.arrayContaining(["Log water", "Log coffee", "Log alcohol"]));
  });

  it("writes today's own note in its buffer as one change, and calls no route", () => {
    const view = noteView(today, "## TODOs\n");
    const dispatch = vi.spyOn(view, "dispatch");
    const commands = stubCommands();

    runDrink("Log water", commands, view);

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(view.state.doc.toString()).toBe("## TODOs\n\n## Log\n- 💧 250 ml\n");
    expect(commands.logDrink).not.toHaveBeenCalled();
  });

  it("takes a drink back with undo over today's own note", () => {
    const view = noteView(today, "## TODOs\n", [history()]);

    runDrink("Log water", stubCommands(), view);
    undo(view);

    expect(view.state.doc.toString()).toBe("## TODOs\n");
  });

  it("takes a drink back with u in vim over today's own note", () => {
    const view = noteView(today, "## TODOs\n", [history(), vim()]);
    document.body.appendChild(view.dom);

    runDrink("Log water", stubCommands(), view);
    fireEvent.keyDown(view.contentDOM, { key: "u" });

    expect(view.state.doc.toString()).toBe("## TODOs\n");
    view.destroy();
  });

  it("hands a drink to the route over any other note", () => {
    const view = noteView("kasten.md", "x");
    const commands = stubCommands();

    runDrink("Log coffee", commands, view);

    expect(commands.logDrink).toHaveBeenCalledWith("coffee");
    expect(view.state.doc.toString()).toBe("x");
  });
});
