import { history, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { type EmbedSource, embedSource } from "@/lib/notes/embeds/embed";
import { noticeHandler } from "@/lib/notes/embeds/image";
import { periodicNote } from "@/lib/notes/text/periodic";
import {
  agentTodoAtCursor,
  cycleTodoAtCursor,
  idElsewhere,
  notePath,
  stampIdAtCursor,
} from "@/lib/todo/todo-commands";

/** A bare view over `doc`, the cursor at `anchor`. No note path, so no log line is written. */
function open(doc: string, anchor: number) {
  return new EditorView({ state: EditorState.create({ doc, selection: { anchor } }) });
}

describe("cycleTodoAtCursor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 16, 9, 30));
  });

  afterEach(() => vi.useRealTimers());

  it("keeps a tab indent, the words and a block id when the key sets done", () => {
    const view = open("- [ ] parent\n\t- [/] call  the part 📅 2026-10-20 ^blk1", 20);

    cycleTodoAtCursor(view, "done");

    expect(view.state.doc.line(2).text).toMatch(
      /^\t- \[x\] call {2}the part 📅 2026-10-20 ✅ 2026-10-16 🆔 kt-[0-9a-f]{6} \^blk1$/,
    );
  });

  it("#534 A4 B1 a press on a twin carrying the other's 🆔 moves its own line and no log or dependent", () => {
    // Today's own note, where the log line and the dependents are buffer edits.
    const doc = "- [/] a 🆔 kt-aaaaaa\n- [/] a 🆔 kt-aaaaaa\n- [b] c ⛔ kt-aaaaaa\n\n## Done\n";
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: { anchor: 0 },
        extensions: [notePath.of(periodicNote("daily", new Date()).path)],
      }),
    });

    cycleTodoAtCursor(view);

    expect(view.state.doc.toString()).toBe(
      "- [x] a ✅ 2026-10-16 🆔 kt-aaaaaa\n- [/] a 🆔 kt-aaaaaa\n- [b] c ⛔ kt-aaaaaa\n\n## Done\n",
    );
  });

  it("#534 A4 B3 a press whose 🆔 another note carries moves its own line and no log or dependent", () => {
    // The other todo is in the vault's listing, not in this buffer.
    const doc = "- [/] a 🆔 kt-aaaaaa\n- [b] c ⛔ kt-aaaaaa\n\n## Done\n";
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: { anchor: 0 },
        extensions: [
          notePath.of(periodicNote("daily", new Date()).path),
          idElsewhere.of((id) => id === "kt-aaaaaa"),
        ],
      }),
    });

    cycleTodoAtCursor(view);

    expect(view.state.doc.toString()).toBe(
      "- [x] a ✅ 2026-10-16 🆔 kt-aaaaaa\n- [b] c ⛔ kt-aaaaaa\n\n## Done\n",
    );
  });
});

describe("stampIdAtCursor", () => {
  it("keeps the line byte for byte but for the id, in one change one undo takes back", () => {
    const doc = "- [ ] parent\n\t- [ ] blocker zork 🜲 words 📅 2026-10-20 ^blk1";
    const view = new EditorView({
      state: EditorState.create({ doc, selection: { anchor: 20 }, extensions: [history()] }),
    });

    stampIdAtCursor(view);

    const text = view.state.doc.toString();
    const id = /🆔 (kt-[0-9a-f]{6})/.exec(text)?.[1];
    expect(id).toBeDefined();
    expect(text).toBe(`- [ ] parent\n\t- [ ] blocker zork 🜲 words 📅 2026-10-20 🆔 ${id} ^blk1`);

    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
  });
});

describe("#537 a ⛔ naming a 🆔 two todos carry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 16, 9, 30));
  });

  afterEach(() => vi.useRealTimers());

  it("#537 A5 <leader>x on another blocker leaves a dependent on a twinned 🆔 in the buffer", () => {
    // The issue's note. The done twin is listed last, the open one still blocks c.
    const lines = [
      "- [ ] a 🆔 kt-aaaaaa",
      "- [x] a 🆔 kt-aaaaaa",
      "- [b] c ⛔ kt-aaaaaa",
      "- [ ] d 🆔 kt-dddddd",
      "- [b] e ⛔ kt-dddddd",
    ];
    const view = open(lines.join("\n"), lines.slice(0, 3).join("\n").length + 1);

    // Open to doing, then doing to done: the second press is the one that closes d.
    cycleTodoAtCursor(view);
    cycleTodoAtCursor(view);

    expect(view.state.doc.toString()).toBe(
      [
        "- [ ] a 🆔 kt-aaaaaa",
        "- [x] a 🆔 kt-aaaaaa",
        "- [b] c ⛔ kt-aaaaaa",
        "- [x] d ✅ 2026-10-16 🆔 kt-dddddd",
        "- [ ] e ⛔ kt-dddddd",
      ].join("\n"),
    );
  });

  it("#537 A5 <leader>x leaves a dependent whose blocker another note carries too", () => {
    // The open twin is in other.md, which only the vault's listing sees.
    const doc = "- [x] a 🆔 kt-aaaaaa\n- [b] c ⛔ kt-aaaaaa ⛔ kt-dddddd\n- [/] d 🆔 kt-dddddd";
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: { anchor: doc.lastIndexOf("- [/] d") },
        extensions: [idElsewhere.of((id) => id === "kt-aaaaaa")],
      }),
    });

    cycleTodoAtCursor(view);

    expect(view.state.doc.toString()).toBe(
      "- [x] a 🆔 kt-aaaaaa\n- [b] c ⛔ kt-aaaaaa ⛔ kt-dddddd\n- [x] d ✅ 2026-10-16 🆔 kt-dddddd",
    );
  });

  it("#544 I3 <leader>x opens a dependent on a twinned 🆔 whose twins in the buffer are closed", () => {
    const doc =
      "- [x] a 🆔 kt-aaaaaa\n- [-] a 🆔 kt-aaaaaa\n- [b] c ⛔ kt-aaaaaa ⛔ kt-dddddd\n- [/] d 🆔 kt-dddddd";
    const view = open(doc, doc.lastIndexOf("- [/] d"));

    cycleTodoAtCursor(view);

    expect(view.state.doc.line(3).text).toBe("- [ ] c ⛔ kt-aaaaaa ⛔ kt-dddddd");
  });
});

describe("the todo keys on a todo's embed line", () => {
  const LINE = "\t- [ ] ![[kt-1277da]] ^blk1";

  /** A view over an embed line, its store calls and notices recorded. */
  function embedded(agentWhy: string | null = null) {
    const source = {
      watch: () => () => {},
      open: vi.fn(),
      cycleTodo: vi.fn(),
      setTodoState: vi.fn(),
      agentTodo: vi.fn(() => agentWhy),
    } satisfies EmbedSource;
    const notice = vi.fn();
    const view = new EditorView({
      state: EditorState.create({
        doc: `# Note\n${LINE}`,
        selection: { anchor: 12 },
        extensions: [embedSource.of(source), noticeHandler.of(notice)],
      }),
    });
    return { view, source, notice };
  }

  it("<leader>x cycles the todo in the store and leaves the line", () => {
    const { view, source } = embedded();
    cycleTodoAtCursor(view);
    expect(source.cycleTodo).toHaveBeenCalledWith("kt-1277da");
    expect(view.state.doc.line(2).text).toBe(LINE);
  });

  it("<leader>sp sets the todo's state in the store and leaves the line", () => {
    const { view, source } = embedded();
    cycleTodoAtCursor(view, "doing");
    expect(source.setTodoState).toHaveBeenCalledWith("kt-1277da", "doing");
    expect(source.cycleTodo).not.toHaveBeenCalled();
    expect(view.state.doc.line(2).text).toBe(LINE);
  });

  it("<leader>@ hands the todo to the store's agent toggle and leaves the line", () => {
    const { view, source, notice } = embedded();
    agentTodoAtCursor(view);
    expect(source.agentTodo).toHaveBeenCalledWith("kt-1277da");
    expect(notice).not.toHaveBeenCalled();
    expect(view.state.doc.line(2).text).toBe(LINE);
  });

  it("<leader>@ the store refuses says why at the foot", () => {
    const { view, notice } = embedded("the agent skips client work");
    agentTodoAtCursor(view);
    expect(notice).toHaveBeenCalledWith("Nothing moved: the agent skips client work");
  });

  it("<leader>i does nothing, the embed carrying the id", () => {
    const { view } = embedded();
    stampIdAtCursor(view);
    expect(view.state.doc.line(2).text).toBe(LINE);
  });
});
