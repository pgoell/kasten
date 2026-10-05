import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { fireEvent, render, screen } from "@testing-library/react";
import { CommandPalette } from "@/components/command-palette";
import { editorCommands } from "@/lib/editor-commands";
import { INSERTS, paletteEntries, slashCompletions, writeInsert } from "@/lib/palette";
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

  it("prints the key beside the command", () => {
    render(<CommandPalette entries={paletteEntries(stubCommands(), null)} onClose={vi.fn()} />);
    expect(screen.getByRole("option", { name: /Find a note/ }).textContent).toContain("Space f f");
  });
});
