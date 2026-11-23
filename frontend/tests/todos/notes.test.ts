import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { notesMatching } from "@/components/todo/view/pick/note-pick";
import { embedSource } from "@/lib/notes/embeds/embed";
import { noticeSource } from "@/lib/notes/embeds/image";
import { notePath } from "@/lib/todo/todo-commands";
import { makeTodoOnTab, makingTodos, todoLinkCompletions } from "@/lib/todo/view/in-note";
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

function editor(
  doc: string,
  source: Parameters<typeof embedSource.of>[0],
  notice: (message: string) => void = () => {},
) {
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [
        embedSource.of(source),
        notePath.of("03 Areas/FDE/index.md"),
        noticeSource.of(() => notice),
        makingTodos,
      ],
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

  it("keeps a line's ^block id after the embed, so links to it still land", async () => {
    const store = source();
    const view = editor("- [ ] ask Jonas for the room ^room", store);
    makeTodoOnTab(view);
    expect(store.addTodo).toHaveBeenCalledWith(
      "03 Areas/FDE/index.md",
      "- [ ] ask Jonas for the room",
    );
    await vi.waitFor(() => expect(view.state.doc.toString()).toBe("![[kt-abcdef]] ^room"));
  });

  it("sends a line once however often Tab is pressed while the store answers", async () => {
    let answer: (id: string) => void = () => {};
    const store = {
      ...source(),
      addTodo: vi.fn(() => new Promise<string>((done) => (answer = done))),
    };
    const view = editor("- [ ] call back\n- [ ] call back", store);
    expect(makeTodoOnTab(view)).toBe(true);
    expect(makeTodoOnTab(view)).toBe(true);
    expect(store.addTodo).toHaveBeenCalledTimes(1);
    view.dispatch({ changes: { from: 0, insert: "Calls\n" } });
    answer("kt-abcdef");
    // The line pressed on, the second, not the first one with the same words.
    await vi.waitFor(() =>
      expect(view.state.doc.toString()).toBe("Calls\n- [ ] call back\n![[kt-abcdef]]"),
    );
  });

  it("puts the embed under a line edited while the store answered, and says why a failure made none", async () => {
    let answer: (id: string) => void = () => {};
    const store = {
      ...source(),
      addTodo: vi.fn(() => new Promise<string>((done) => (answer = done))),
    };
    const view = editor("- [ ] call back", store);
    makeTodoOnTab(view);
    view.dispatch({ changes: { from: view.state.doc.length, insert: " soon" } });
    answer("kt-abcdef");
    await vi.waitFor(() =>
      expect(view.state.doc.toString()).toBe("- [ ] call back soon\n![[kt-abcdef]]"),
    );

    const notice = vi.fn();
    const failing = {
      ...source(),
      addTodo: vi.fn(async () => Promise.reject(new Error("offline"))),
    };
    const other = editor("- [ ] call back", failing, notice);
    makeTodoOnTab(other);
    await vi.waitFor(() => expect(notice).toHaveBeenCalledWith("Not made a todo: offline"));
    expect(other.state.doc.toString()).toBe("- [ ] call back");
    expect(other.state.field(makingTodos)).toEqual([]);
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
