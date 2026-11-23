import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { notesMatching } from "@/components/todo/view/pick/note-pick";
import { embedSource } from "@/lib/notes/embeds/embed";
import { notePath } from "@/lib/todo/todo-commands";
import { makeTodoOnTab, todoLinkCompletions } from "@/lib/todo/view/in-note";
import { linkTo, todosLinking } from "@/lib/todo/view/rows/note-links";
import { row } from "./rows";

const FILES = ["03 Areas/FDE/index.md", "02 Projects/Kasten/index.md", "October sheet.md"];

describe("todos and the notes they link", () => {
  it("lists the todos elsewhere that link a note, open ones first, and not those living in it", () => {
    const rows = [
      row("kt-000001", "sign the contract [[October sheet]]", { state: "done" }),
      row("kt-000002", "file the report", { description: "numbers in [[october sheet]]" }),
      row("kt-000003", "lives there [[October sheet]]", { note: "October sheet.md" }),
      row("kt-000004", "unrelated"),
    ];
    expect(todosLinking(rows, "October sheet.md", FILES).map((each) => each.id)).toEqual([
      "kt-000002",
      "kt-000001",
    ]);
  });

  it("links a note by its name, or by its path where the name finds another", () => {
    expect(linkTo("October sheet.md", FILES)).toBe("[[October sheet]]");
    expect(linkTo("02 Projects/Kasten/index.md", FILES)).toBe("[[02 Projects/Kasten/index]]");
  });

  it("finds notes by part of their name, those that start with it first", () => {
    expect(notesMatching([...FILES, "Sheets of music.md"], "sheet")).toEqual([
      "Sheets of music.md",
      "October sheet.md",
    ]);
  });
});

function editor(doc: string, source: Parameters<typeof embedSource.of>[0]) {
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [embedSource.of(source), notePath.of("03 Areas/FDE/index.md")],
    }),
  });
}

const source = (todos: ReturnType<typeof row>[] = []) => ({
  watch: () => () => {},
  open: () => {},
  todos: () => todos,
  addTodo: vi.fn(async () => "kt-abcdef"),
});

describe("a note's ways to a store todo", () => {
  it("makes the checkbox line the cursor ends a todo of this note on Tab, and its embed", async () => {
    const store = source();
    const view = editor("Intro\n- [ ] ask Jonas for the room", store);
    expect(makeTodoOnTab(view)).toBe(true);
    expect(store.addTodo).toHaveBeenCalledWith(
      "03 Areas/FDE/index.md",
      "- [ ] ask Jonas for the room",
    );
    await vi.waitFor(() => expect(view.state.doc.toString()).toBe("Intro\n![[kt-abcdef]]"));
  });

  it("leaves Tab to indent off a checkbox line's end", () => {
    const store = source();
    expect(makeTodoOnTab(editor("- plain item", store))).toBe(false);
    expect(makeTodoOnTab(editor("- [ ] ", store))).toBe(false);
    expect(makeTodoOnTab(editor("- [x] done already", store))).toBe(false);
    expect(store.addTodo).not.toHaveBeenCalled();
  });

  it("offers the todos after [[todo, open first, each put in as its embed", () => {
    const todos = [
      row("kt-000001", "review last year's offer", { state: "done" }),
      row("kt-000002", "draft the offer for Ada"),
    ];
    const view = editor("see [[todo off", source(todos));
    const result = todoLinkCompletions(
      new CompletionContext(view.state, view.state.doc.length, true),
    );
    expect(result?.options.map((option) => option.label)).toEqual([
      "draft the offer for Ada",
      "review last year's offer",
    ]);
    expect(view.state.sliceDoc(result?.from)).toBe("off");
    const apply = result?.options[0]?.apply;
    if (result === null || typeof apply !== "function") throw new Error("no apply");
    apply(view, result.options[0] as never, result.from, view.state.doc.length);
    expect(view.state.doc.toString()).toBe("see ![[kt-000002]]");
  });
});
