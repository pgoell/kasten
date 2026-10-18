import { history, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { periodicNote } from "@/lib/periodic";
import { cycleTodoAtCursor, notePath, stampIdAtCursor } from "@/lib/todo-commands";

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
