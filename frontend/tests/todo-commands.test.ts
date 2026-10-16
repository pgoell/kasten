import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { cycleTodoAtCursor } from "@/lib/todo-commands";

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
});
