import { history, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { LEADER_EDITS } from "@/lib/editor/buffer-keys";
import type { TodoState } from "@/lib/todo/todo";
import type { Closed } from "@/lib/todo/todo-blocked";
import { cycleTodoAtCursor } from "@/lib/todo/todo-commands";
import { cycleLines } from "@/lib/todo/todo-write";
import { TODAY, UNKNOWN } from "./todo-write-fixture";

/** A press setting `state` on `line`, the way every writer of the next copy calls it. */
function press(note: string[], line: number, state: TodoState = "done") {
  return cycleLines({ lines: note, line, today: TODAY, id: "kt-3f9a2c", closed: UNKNOWN, state });
}

/** The note as the press leaves it, one string per line. */
function written(note: string[], line: number, state: TodoState = "done"): string[] {
  const lines = [...note];
  for (const [at, insert] of press(note, line, state)) lines[at - 1] = insert;
  return lines.join("\n").split("\n");
}

// #802: a recurring todo's next copy brings its parts along.
describe("#802 the next copy of a recurring todo with parts", () => {
  it("#802 A1 the copy carries both parts reset to [ ] under it at the same indent", () => {
    const note = [
      "- [ ] japanese practice #private 📅 2026-08-10 🔁 every day",
      "  - [ ] Kaishi cards",
      "  - [/] one Speak lesson",
    ];

    expect(written(note, 1)).toEqual([
      "- [ ] japanese practice #private 📅 2026-08-11 🔁 every day",
      "  - [ ] Kaishi cards",
      "  - [ ] one Speak lesson",
      `- [x] japanese practice #private 📅 2026-08-10 🔁 every day ✅ ${TODAY} 🆔 kt-3f9a2c`,
      `  - [x] Kaishi cards ✅ ${TODAY}`,
      `  - [x] one Speak lesson ✅ ${TODAY}`,
    ]);
  });

  it("#802 A2 drops the done, cancel, id, time and assignee fields on the parts", () => {
    const note = [
      "- [ ] routine 📅 2026-08-10 🔁 every week",
      "\t- [x] step one ✅ 2026-08-09 🆔 kt-000001",
      "\t- [-] step two ❌ 2026-08-09",
      "\t- [ ] step three ⏲ 1h ⏱ 20m 👤 [[Ada]] ^blk1",
      "\t- [w] step four 👤 2026-08-03 [[Bo]]",
    ];

    expect(written(note, 1).slice(0, 5)).toEqual([
      "- [ ] routine 📅 2026-08-17 🔁 every week",
      "\t- [ ] step one",
      "\t- [ ] step two",
      "\t- [ ] step three ⏲ 1h",
      "\t- [ ] step four",
    ]);
  });

  it("#802 A3 a dated part moves by the parent's step", () => {
    const note = [
      "- [ ] routine 📅 2026-08-10 🔁 every week",
      "  - [ ] prepare ⏳ 2026-08-08 📅 2026-08-09",
      "  - [ ] follow up 🛫 2026-08-12",
    ];

    expect(written(note, 1).slice(0, 3)).toEqual([
      "- [ ] routine 📅 2026-08-17 🔁 every week",
      "  - [ ] prepare 📅 2026-08-16 ⏳ 2026-08-15",
      "  - [ ] follow up 🛫 2026-08-19",
    ]);
  });

  it("#802 A3 a when done parent moves its parts by the days it moves", () => {
    // Due five days ago and ticked today: the copy is due tomorrow, six days on.
    const note = [
      "- [ ] routine 📅 2026-08-05 🔁 every day when done",
      "  - [ ] part 📅 2026-08-06",
    ];

    expect(written(note, 1).slice(0, 2)).toEqual([
      "- [ ] routine 📅 2026-08-11 🔁 every day when done",
      "  - [ ] part 📅 2026-08-12",
    ]);
  });

  it("#802 A4 the old parts stay ticked under the ticked line", () => {
    const note = [
      "- [ ] routine 📅 2026-08-10 🔁 every week",
      "  - [ ] one",
      `  - [x] two ✅ 2026-08-09`,
    ];
    const moved = press(note, 1);

    expect(moved.get(2)).toBe(`  - [x] one ✅ ${TODAY}`);
    expect(moved.has(3)).toBe(false);
    expect(written(note, 1).slice(3)).toEqual([
      `- [x] routine 📅 2026-08-10 🔁 every week ✅ ${TODAY} 🆔 kt-3f9a2c`,
      `  - [x] one ✅ ${TODAY}`,
      "  - [x] two ✅ 2026-08-09",
    ]);
  });

  it("#802 A5 a recurring todo with no parts writes exactly what main writes", () => {
    // A guard, not a change: this passes on main too.
    const note = ["- [/] water the plants 🔁 every week 📅 2026-08-10 ^blk1", "- [ ] next one"];

    expect(press(note, 1)).toEqual(
      new Map([
        [
          1,
          [
            "- [ ] water the plants 📅 2026-08-17 🔁 every week",
            `- [x] water the plants 🔁 every week 📅 2026-08-10 ✅ ${TODAY} 🆔 kt-3f9a2c ^blk1`,
          ].join("\n"),
        ],
      ]),
    );
  });

  it("#802 I2 carries a part two levels deep at its own indent", () => {
    const note = [
      "\t- [ ] routine 📅 2026-08-10 🔁 every week",
      "\t\t- [ ] part",
      "\t\t\t- [ ] sub part",
      "\t\t- [ ] last",
    ];

    expect(written(note, 1).slice(0, 4)).toEqual([
      "\t- [ ] routine 📅 2026-08-17 🔁 every week",
      "\t\t- [ ] part",
      "\t\t\t- [ ] sub part",
      "\t\t- [ ] last",
    ]);
  });

  it("#802 I3 carries a recurring part once, with its rule, moved by the parent's step", () => {
    const note = [
      "- [ ] routine 📅 2026-08-10 🔁 every week",
      "  - [ ] water 📅 2026-08-10 🔁 every day",
    ];

    expect(written(note, 1)).toEqual([
      "- [ ] routine 📅 2026-08-17 🔁 every week",
      "  - [ ] water 📅 2026-08-17 🔁 every day",
      `- [x] routine 📅 2026-08-10 🔁 every week ✅ ${TODAY} 🆔 kt-3f9a2c`,
      `  - [x] water 📅 2026-08-10 🔁 every day ✅ ${TODAY}`,
    ]);
  });

  it("#802 I4 brings a part done or rejected this round back as [ ]", () => {
    const note = [
      "- [ ] routine 📅 2026-08-10 🔁 every week",
      "  - [x] done ✅ 2026-08-09",
      "  - [-] dropped ❌ 2026-08-09",
    ];

    expect(written(note, 1).slice(0, 3)).toEqual([
      "- [ ] routine 📅 2026-08-17 🔁 every week",
      "  - [ ] done",
      "  - [ ] dropped",
    ]);
  });

  it("#802 I5 leaves a plain bullet or prose under the todo with the ticked line", () => {
    const note = [
      "- [ ] routine 📅 2026-08-10 🔁 every week",
      "  a note on it",
      "  - a plain bullet",
      "  - [ ] part",
    ];

    expect(written(note, 1)).toEqual([
      "- [ ] routine 📅 2026-08-17 🔁 every week",
      "  - [ ] part",
      `- [x] routine 📅 2026-08-10 🔁 every week ✅ ${TODAY} 🆔 kt-3f9a2c`,
      "  a note on it",
      "  - a plain bullet",
      `  - [x] part ✅ ${TODAY}`,
    ]);
  });

  it("#802 R1 a carried part still waiting on an open todo comes back blocked", () => {
    const note = [
      "- [ ] routine 📅 2026-08-10 🔁 every week",
      "  - [b] cook ⛔ kt-zzzzzz",
      "  - [b] eat ⛔ kt-yyyyyy",
      "- [ ] shop 🆔 kt-zzzzzz",
    ];
    const closed: Closed = (id) => id === "kt-yyyyyy" || undefined;
    const moved = cycleLines({
      lines: note,
      line: 1,
      today: TODAY,
      id: "kt-3f9a2c",
      closed,
      state: "done",
    });

    expect(moved.get(1)?.split("\n").slice(0, 3)).toEqual([
      "- [ ] routine 📅 2026-08-17 🔁 every week",
      "  - [b] cook ⛔ kt-zzzzzz",
      "  - [ ] eat ⛔ kt-yyyyyy",
    ]);
  });

  it("#802 I6 a parent closed by ❌ writes no copy and no parts", () => {
    const note = ["- [ ] routine 📅 2026-08-10 🔁 every week", "  - [ ] part"];

    expect(written(note, 1, "rejected")).toEqual([
      `- [-] routine 📅 2026-08-10 🔁 every week ❌ ${TODAY}`,
      "  - [ ] part",
    ]);
  });
});

describe("#802 the editor's key", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 16, 9, 30));
  });

  afterEach(() => vi.useRealTimers());

  it("#802 I1 the editor key writes the copy's parts in one change one undo takes back", () => {
    const doc = "- [ ] routine 📅 2026-10-16 🔁 every day\n  - [ ] part 🆔 kt-000001\n";
    const view = new EditorView({
      state: EditorState.create({ doc, selection: { anchor: 0 }, extensions: [history()] }),
    });

    cycleTodoAtCursor(view, "done");

    const text = view.state.doc.toString();
    const id = /routine .*🆔 (kt-[0-9a-f]{6})/.exec(text)?.[1];
    expect(text).toBe(
      [
        "- [ ] routine 📅 2026-10-17 🔁 every day",
        "  - [ ] part",
        `- [x] routine 📅 2026-10-16 🔁 every day ✅ 2026-10-16 🆔 ${id}`,
        "  - [x] part ✅ 2026-10-16 🆔 kt-000001",
        "",
      ].join("\n"),
    );

    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("#1305 A1 I2 I5 <leader>sx on a waiting recurring todo writes the copy with no dated 👤", () => {
    const doc =
      "- [w] a 📅 2026-10-16 🔁 every week 👤 2026-10-09 [[Ada]]\n  - [w] part 👤 2026-10-09 Bo\n";
    const view = new EditorView({
      state: EditorState.create({ doc, selection: { anchor: 0 }, extensions: [history()] }),
    });

    // The entry the vim leader, the palette and the phone's toolbar all run.
    LEADER_EDITS.find((edit) => edit.key === "sx")?.run(view);

    const text = view.state.doc.toString();
    const id = /- \[x\] a .*🆔 (kt-[0-9a-f]{6})/.exec(text)?.[1];
    expect(text).toBe(
      [
        "- [ ] a 📅 2026-10-23 🔁 every week",
        "  - [ ] part",
        `- [x] a 📅 2026-10-16 🔁 every week ✅ 2026-10-16 🆔 ${id}`,
        "  - [x] part ✅ 2026-10-16",
        "",
      ].join("\n"),
    );

    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
  });
});
