import { EditorView } from "@codemirror/view";
import { fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import cases from "@/lib/person-field-cases.json";
import { cycleLine, formatTodo, nameAt, parseTodo, setStateOn, type TodoState } from "@/lib/todo";
import { cycleTodoAtCursor } from "@/lib/todo-commands";
import { expandShorthand } from "@/lib/todo-shorthand";
import { cycleLines } from "@/lib/todo-write";
import { open } from "./keybindings-fixture";
import { FRESH } from "./todo-fixture";
import { paneHooks, renderPane } from "./todo-pane-fixture";

// The pane's doubles, as each pane test file keeps its own: `vi.mock` hoists
// only within the file that calls it.
const { fetchTodos, fetchNote, fetchFiles, createNote } = vi.hoisted(() => ({
  fetchTodos: vi.fn(),
  fetchNote: vi.fn(),
  fetchFiles: vi.fn(),
  createNote: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ fetchTodos, fetchNote, fetchFiles, createNote }));
paneHooks();

const TODAY = "2026-10-25";

describe("#809 the person field table", () => {
  it("#809 A1 readFields reads every case of the person field table", () => {
    const read = Object.fromEntries(
      cases.map((each) => {
        const todo = parseTodo(`- [ ] ${each.rest}`);
        return [
          each.id,
          {
            text: todo?.text ?? null,
            assignee: todo?.assignee ?? null,
            waitingSince: todo?.waitingSince ?? null,
            waitingOn: todo?.waitingOn ?? null,
          },
        ];
      }),
    );

    expect(read).toEqual(
      Object.fromEntries(
        cases.map((each) => [
          each.id,
          {
            text: each.text,
            assignee: each.assignee,
            waitingSince: each.waitingSince,
            waitingOn: each.waitingOn,
          },
        ]),
      ),
    );
  });
});

describe("#809 the assignee through a state change", () => {
  it("#809 A2 entering [w] on a line with an assignee keeps it and stamps the wait after it", () => {
    expect(setStateOn("- [ ] buy paint 👤 [[Pascal]] 📅 2026-10-30", "waiting", TODAY, FRESH)).toBe(
      "- [w] buy paint 👤 [[Pascal]] 👤 2026-10-25 📅 2026-10-30",
    );
  });

  it("#809 A2 leaving [w] by a key drops only the dated 👤", () => {
    const line = "- [w] buy paint 👤 [[Pascal]] 👤 2026-10-25 [[Alicia]] 📅 2026-10-30";

    expect(setStateOn(line, "doing", TODAY, FRESH)).toBe(
      "- [/] buy paint 👤 [[Pascal]] 📅 2026-10-30",
    );
    expect(setStateOn(line, "open", TODAY, FRESH)).toBe(
      "- [ ] buy paint 👤 [[Pascal]] 📅 2026-10-30",
    );
  });

  it("#809 A2 the cycle out of [w] drops only the dated 👤", () => {
    expect(
      cycleLine(
        "- [w] buy paint 👤 [[Pascal]] 👤 2026-10-25 [[Alicia]] 📅 2026-10-30",
        TODAY,
        FRESH,
      ),
    ).toBe("- [/] buy paint 👤 [[Pascal]] 📅 2026-10-30");
  });

  it("#809 A2 the done cascade frees a waiting part and keeps its assignee", () => {
    const lines = [
      "- [/] wire up the pane",
      "  - [w] write it 👤 [[Pascal]] 👤 2026-10-20 [[Alicia]]",
    ];

    const moved = cycleLines({ lines, line: 1, today: TODAY, id: FRESH, closed: () => false });

    expect(moved.get(1)).toBe("- [x] wire up the pane ✅ 2026-10-25 🆔 kt-000001");
    expect(moved.get(2)).toBe("  - [x] write it 👤 [[Pascal]] ✅ 2026-10-25");
  });

  it("#809 A2 every other state change carries the assignee byte for byte", () => {
    const states: TodoState[] = ["doing", "done", "review", "blocked", "rejected", "open"];
    const out: Record<string, string> = {};
    let line = "- [ ] buy paint 👤 [[Pascal]]";
    for (const state of states) {
      line = setStateOn(line, state, TODAY, FRESH);
      out[state] = line;
    }

    expect(out).toEqual({
      doing: "- [/] buy paint 👤 [[Pascal]]",
      done: "- [x] buy paint 👤 [[Pascal]] ✅ 2026-10-25 🆔 kt-000001",
      review: "- [r] buy paint 👤 [[Pascal]] 🆔 kt-000001",
      blocked: "- [b] buy paint 👤 [[Pascal]] 🆔 kt-000001",
      rejected: "- [-] buy paint 👤 [[Pascal]] ❌ 2026-10-25 🆔 kt-000001",
      open: "- [ ] buy paint 👤 [[Pascal]] 🆔 kt-000001",
    });
  });

  it("#809 A2 a waiting line of today reads and writes back exactly as before", () => {
    // Every state a key can set, and the walk's press, on the two live shapes.
    const every = (line: string) => ({
      open: setStateOn(line, "open", TODAY, FRESH),
      doing: setStateOn(line, "doing", TODAY, FRESH),
      done: setStateOn(line, "done", TODAY, FRESH),
      blocked: setStateOn(line, "blocked", TODAY, FRESH),
      review: setStateOn(line, "review", TODAY, FRESH),
      rejected: setStateOn(line, "rejected", TODAY, FRESH),
      waiting: setStateOn(line, "waiting", TODAY, FRESH),
      cycle: cycleLine(line, TODAY, FRESH),
    });

    expect({
      "wait-dated-and-named": every(
        "- [w] the SynnoDB basics in writing 👤 2026-10-18 [[Timo Eckmann]] ⏳ 2026-10-31 #private ➕ 2026-10-18 🆔 kt-c41391",
      ),
      "wait-dated-only": every(
        "- [w] ask pop for his pictures 👤 2026-10-20 ⏳ 2026-10-25 ➕ 2026-10-11 ⏲ 15m",
      ),
    }).toEqual({
      "wait-dated-and-named": {
        open: "- [ ] the SynnoDB basics in writing ⏳ 2026-10-31 #private ➕ 2026-10-18 🆔 kt-c41391",
        doing:
          "- [/] the SynnoDB basics in writing ⏳ 2026-10-31 #private ➕ 2026-10-18 🆔 kt-c41391",
        done: "- [x] the SynnoDB basics in writing ⏳ 2026-10-31 #private ➕ 2026-10-18 ✅ 2026-10-25 🆔 kt-c41391",
        blocked:
          "- [b] the SynnoDB basics in writing ⏳ 2026-10-31 #private ➕ 2026-10-18 🆔 kt-c41391",
        review:
          "- [r] the SynnoDB basics in writing ⏳ 2026-10-31 #private ➕ 2026-10-18 🆔 kt-c41391",
        rejected:
          "- [-] the SynnoDB basics in writing ⏳ 2026-10-31 #private ➕ 2026-10-18 ❌ 2026-10-25 🆔 kt-c41391",
        waiting:
          "- [w] the SynnoDB basics in writing 👤 2026-10-18 [[Timo Eckmann]] ⏳ 2026-10-31 #private ➕ 2026-10-18 🆔 kt-c41391",
        cycle:
          "- [/] the SynnoDB basics in writing ⏳ 2026-10-31 #private ➕ 2026-10-18 🆔 kt-c41391",
      },
      "wait-dated-only": {
        open: "- [ ] ask pop for his pictures ⏳ 2026-10-25 ➕ 2026-10-11 ⏲ 15m",
        doing: "- [/] ask pop for his pictures ⏳ 2026-10-25 ➕ 2026-10-11 ⏲ 15m",
        done: "- [x] ask pop for his pictures ⏳ 2026-10-25 ➕ 2026-10-11 ✅ 2026-10-25 ⏲ 15m 🆔 kt-000001",
        blocked: "- [b] ask pop for his pictures ⏳ 2026-10-25 ➕ 2026-10-11 ⏲ 15m",
        review: "- [r] ask pop for his pictures ⏳ 2026-10-25 ➕ 2026-10-11 ⏲ 15m",
        rejected: "- [-] ask pop for his pictures ⏳ 2026-10-25 ➕ 2026-10-11 ❌ 2026-10-25 ⏲ 15m",
        waiting: "- [w] ask pop for his pictures 👤 2026-10-20 ⏳ 2026-10-25 ➕ 2026-10-11 ⏲ 15m",
        cycle: "- [/] ask pop for his pictures ⏳ 2026-10-25 ➕ 2026-10-11 ⏲ 15m",
      },
    });
  });
});

describe("#809 the assignee in the editor and the implied paths", () => {
  // CodeMirror merges edits made within half a second into one undo step, and a
  // test makes them in the same instant, so the clock moves on between the set
  // and the leave, as a person's keys would.
  let clock = 0;
  beforeEach(() => {
    clock = 0;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem("kasten.vim");
  });

  it("#809 I4 setting [w] by key in the editor and undoing gives back the line with its assignee, vim on", () => {
    const { editor, doc } = open("- [ ] buy paint 👤 [[Pascal]]");

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "s" });
    fireEvent.keyDown(editor, { key: "w" });
    expect(doc()).toMatch(/^- \[w\] buy paint 👤 \[\[Pascal\]\] 👤 \d{4}-\d{2}-\d{2}$/);

    clock += 1000;
    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "x" });
    expect(doc()).toMatch(/^- \[\/\] buy paint 👤 \[\[Pascal\]\]$/);

    fireEvent.keyDown(editor, { key: "u" });
    expect(doc()).toMatch(/^- \[w\] buy paint 👤 \[\[Pascal\]\] 👤 \d{4}-\d{2}-\d{2}$/);

    fireEvent.keyDown(editor, { key: "u" });
    expect(doc()).toBe("- [ ] buy paint 👤 [[Pascal]]");
  });

  it("#809 I4 setting [w] by key in the editor and undoing gives back the line with its assignee, vim off", () => {
    localStorage.setItem("kasten.vim", "off");
    const { editor, doc } = open("- [ ] buy paint 👤 [[Pascal]]");
    // Vim's leader keys are not bound without vim, so this is the command the
    // palette runs for `s w`, on the view the editor holds.
    const view = EditorView.findFromDOM(editor) as EditorView;

    cycleTodoAtCursor(view, "waiting");
    expect(doc()).toMatch(/^- \[w\] buy paint 👤 \[\[Pascal\]\] 👤 \d{4}-\d{2}-\d{2}$/);

    clock += 1000;
    cycleTodoAtCursor(view, "doing");
    expect(doc()).toMatch(/^- \[\/\] buy paint 👤 \[\[Pascal\]\]$/);

    fireEvent.keyDown(editor, { key: "z", ctrlKey: true });
    expect(doc()).toMatch(/^- \[w\] buy paint 👤 \[\[Pascal\]\] 👤 \d{4}-\d{2}-\d{2}$/);

    fireEvent.keyDown(editor, { key: "z", ctrlKey: true });
    expect(doc()).toBe("- [ ] buy paint 👤 [[Pascal]]");
  });

  it("#809 I5 ticking a recurring todo with an assignee writes the next occurrence with the assignee", () => {
    const lines = ["- [/] water 👤 [[Pascal]] 🔁 every week 📅 2026-10-20"];

    const moved = cycleLines({ lines, line: 1, today: TODAY, id: FRESH, closed: () => false });

    expect(moved.get(1)?.split("\n")[0]).toBe(
      "- [ ] water 👤 [[Pascal]] 📅 2026-10-27 🔁 every week",
    );
  });

  it("#809 I6 entering [w] on a line with an assignee puts the name place after the new date", () => {
    const line = setStateOn("- [ ] buy paint 👤 [[Pascal]] 📅 2026-10-30", "waiting", TODAY, FRESH);

    expect(line.slice(0, nameAt(line) ?? 0)).toBe("- [w] buy paint 👤 [[Pascal]] 👤 2026-10-25");
  });

  it("#809 I1 a state change on a line with a bare 👤 before a block id keeps the id at the end", () => {
    expect(setStateOn("- [/] buy paint 👤 ^milk", "done", TODAY, FRESH)).toBe(
      "- [x] buy paint 👤 ✅ 2026-10-25 🆔 kt-000001 ^milk",
    );
  });

  it("#809 I6 the name place skips an assignee that starts with today's date", () => {
    const line = setStateOn(
      "- [ ] buy paint 👤 2026-10-25-review 📅 2026-10-30",
      "waiting",
      TODAY,
      FRESH,
    );

    expect(line.slice(0, nameAt(line) ?? 0)).toBe(
      "- [w] buy paint 👤 2026-10-25-review 👤 2026-10-25",
    );
  });

  it("#809 I8 quick add keeps a typed 👤 [[name]] as the assignee", () => {
    const line = formatTodo(expandShorthand("buy paint 👤 [[Pascal]] due:10-30", TODAY));

    expect(parseTodo(line)).toMatchObject({ text: "buy paint", assignee: "[[Pascal]]" });
  });
});

describe("#809 the assignee in the pane", () => {
  it("#809 A10 the pane's filter finds a todo by its assignee", async () => {
    const pane = renderPane([
      { path: "a.md", line: 1, text: "- [ ] x 👤 [[Pascal]] 👤 2026-10-20 [[Alicia]]" },
      { path: "a.md", line: 2, text: "- [ ] buy milk" },
    ]);
    await waitFor(() => expect(pane.rows()).toHaveLength(2));

    fireEvent.change(pane.filter(), { target: { value: "Pascal" } });

    await waitFor(() => expect(pane.rows()).toHaveLength(1));
  });
});
