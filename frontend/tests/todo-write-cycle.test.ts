import type { TodoState } from "@/lib/todo/todo";
import type { Closed } from "@/lib/todo/todo-blocked";
import { cycleLines } from "@/lib/todo/todo-write";
import { TODAY, UNKNOWN } from "./todo-write-fixture";

/** One press over a note's lines, which is what the cascade is a rule about. */
function cycle(note: string[], line: number, closed: Closed = UNKNOWN) {
  return cycleLines({ lines: note, line, today: TODAY, id: "kt-3f9a2c", closed });
}

/** The same press, naming a state rather than walking to the next one. */
function set(note: string[], line: number, state: TodoState, closed: Closed = UNKNOWN) {
  return cycleLines({ lines: note, line, today: TODAY, id: "kt-3f9a2c", closed, state });
}

describe("cycleLines", () => {
  it("answers the one line the press moved, where nothing hangs off it", () => {
    expect(cycle(["- [ ] buy milk"], 1)).toEqual(new Map([[1, "- [/] buy milk"]]));
  });

  it("takes every open part into done with the parent", () => {
    const note = [
      "- [/] wire up the pane",
      "  - [x] read the spec ✅ 2026-08-01 🆔 kt-000001",
      "  - [ ] write it",
      "  - [b] ship it",
    ];

    // No entry for the child that was already done: it is where it belongs.
    // The blocked one is not done, so the parent's tick takes it too.
    expect(cycle(note, 1)).toEqual(
      new Map([
        [1, `- [x] wire up the pane ✅ ${TODAY} 🆔 kt-3f9a2c`],
        [3, `  - [x] write it ✅ ${TODAY}`],
        [4, `  - [x] ship it ✅ ${TODAY}`],
      ]),
    );
  });

  it("reaches a grandchild and leaves a rejected part alone", () => {
    const note = ["- [/] a", "  - [ ] b", "    - [ ] c", "  - [-] d ❌ 2026-08-01"];

    expect([...cycle(note, 1).keys()]).toEqual([1, 2, 3]);
  });

  it("stamps no id on a part it ticked, nothing naming one", () => {
    const note = ["- [/] a", "  - [ ] b"];
    const moved = cycle(note, 1);

    expect(moved.get(1)).toContain("🆔 kt-3f9a2c");
    expect(moved.get(2)).not.toContain("🆔");
  });

  it("finishes a part that was waiting on somebody, and drops who it waited on", () => {
    const note = ["- [/] a", "  - [w] b 👤 2026-08-03 [[Ada]]"];

    expect(set(note, 1, "done").get(2)).toBe(`  - [x] b ✅ ${TODAY}`);
  });

  it("leaves the parts where they are when the parent leaves done", () => {
    const note = [`- [x] a ✅ ${TODAY} 🆔 kt-000001`, `  - [x] b ✅ ${TODAY}`];

    expect(set(note, 1, "blocked")).toEqual(new Map([[1, "- [b] a 🆔 kt-000001"]]));
  });

  it("takes a key that names a state through the same rules the walk takes", () => {
    const note = ["- [ ] wire up the pane", "  - [ ] write it", "  - [/] ship it"];

    // Set straight to done from open, and the parts go with it exactly as they
    // do when the walk arrives there.
    expect(set(note, 1, "done")).toEqual(
      new Map([
        [1, `- [x] wire up the pane ✅ ${TODAY} 🆔 kt-3f9a2c`],
        [2, `  - [x] write it ✅ ${TODAY}`],
        [3, `  - [x] ship it ✅ ${TODAY}`],
      ]),
    );
  });

  it("moves what waits on the todo it just closed", () => {
    const note = ["- [/] ship it 🆔 kt-000001", "- [b] write the docs ⛔ kt-000001"];

    expect(cycle(note, 1)).toEqual(
      new Map([
        [1, `- [x] ship it ✅ ${TODAY} 🆔 kt-000001`],
        [2, "- [ ] write the docs ⛔ kt-000001"],
      ]),
    );
  });

  it("puts a dependent back to blocked when the blocker is reopened", () => {
    const note = [`- [x] ship it ✅ ${TODAY} 🆔 kt-000001`, "- [ ] write the docs ⛔ kt-000001"];

    // Reopening is a key naming a state now: the walk out of done writes a
    // plain line, which nothing can resolve, so it moves no dependent.
    expect(set(note, 1, "doing")).toEqual(
      new Map([
        [1, "- [/] ship it 🆔 kt-000001"],
        [2, "- [b] write the docs ⛔ kt-000001"],
      ]),
    );
  });

  it("puts the next copy of a recurring todo above the line it ticked", () => {
    const note = ["- [/] water the plants 🔁 every week 📅 2026-08-10"];

    // One entry holding two lines, not two changes at one offset: the fresh
    // copy first and the line that was ticked under it.
    expect(cycle(note, 1)).toEqual(
      new Map([
        [
          1,
          [
            "- [ ] water the plants 📅 2026-08-17 🔁 every week",
            `- [x] water the plants 🔁 every week 📅 2026-08-10 ✅ ${TODAY} 🆔 kt-3f9a2c`,
          ].join("\n"),
        ],
      ]),
    );
  });

  it("writes the next copy of a recurring todo ticked out of review as open", () => {
    const note = ["- [r] water the plants 🔁 every week 📅 2026-08-10"];

    expect(cycle(note, 1).get(1)?.split("\n")).toEqual([
      "- [ ] water the plants 📅 2026-08-17 🔁 every week",
      `- [x] water the plants 🔁 every week 📅 2026-08-10 ✅ ${TODAY} 🆔 kt-3f9a2c`,
    ]);
  });

  it("ticks a part waiting for review with the parent", () => {
    const note = ["- [/] wire up the pane", "\t- [r] write it ^blk1", "\t- [ ] ship it"];

    expect(set(note, 1, "done")).toEqual(
      new Map([
        [1, `- [x] wire up the pane ✅ ${TODAY} 🆔 kt-3f9a2c`],
        [2, `\t- [x] write it ✅ ${TODAY} ^blk1`],
        [3, `\t- [x] ship it ✅ ${TODAY}`],
      ]),
    );
  });

  it("writes no copy on the press that leaves done", () => {
    const note = [`- [x] water the plants 🔁 every week 📅 2026-08-10 ✅ ${TODAY} 🆔 kt-000001`];

    expect(set(note, 1, "blocked").get(1)).toBe(
      "- [b] water the plants 🔁 every week 📅 2026-08-10 🆔 kt-000001",
    );
  });

  it("cascades and copies in the one map, and gives no part a copy of its own", () => {
    const note = ["- [/] water the plants 🔁 every week 📅 2026-08-10", "  - [ ] the fern"];
    const moved = cycle(note, 1);

    // The copy, the part it carries (#802), and the ticked line.
    expect(moved.get(1)?.split("\n")).toHaveLength(3);
    expect(moved.get(2)).toBe(`  - [x] the fern ✅ ${TODAY}`);
  });

  it("lets the cascade keep a line the writeback also points at", () => {
    // The child waits on its own parent, so both rules name line 2. The map is
    // what stops the two of them handing CodeMirror one line twice.
    const note = ["- [/] ship it 🆔 kt-000001", "  - [b] write the docs ⛔ kt-000001"];

    expect(cycle(note, 1).get(2)).toBe(`  - [x] write the docs ✅ ${TODAY} ⛔ kt-000001`);
  });

  it("keeps the lines of parts it ticks and dependents it moves byte for byte", () => {
    const note = [
      "- [/] ship it 🆔 kt-000001",
      "\t- [ ] part 📅 2026-10-20 ^blk1",
      "\t- [w] wait 👤 2026-08-03 [[Ada]] ^blk2",
      "- [b] write  the docs ⛔ kt-000001 ^blk3",
    ];

    expect(cycle(note, 1)).toEqual(
      new Map([
        [1, `- [x] ship it ✅ ${TODAY} 🆔 kt-000001`],
        [2, `\t- [x] part 📅 2026-10-20 ✅ ${TODAY} ^blk1`],
        [3, `\t- [x] wait ✅ ${TODAY} ^blk2`],
        [4, "- [ ] write  the docs ⛔ kt-000001 ^blk3"],
      ]),
    );
  });

  it("writes the recurring copy at the ticked line's indent, without its block id", () => {
    const note = ["- [/] chores", "\t- [/] water the plants 📅 2026-08-10 🔁 every week ^blk1"];

    expect(cycle(note, 2).get(2)?.split("\n")).toEqual([
      "\t- [ ] water the plants 📅 2026-08-17 🔁 every week",
      `\t- [x] water the plants 📅 2026-08-10 🔁 every week ✅ ${TODAY} 🆔 kt-3f9a2c ^blk1`,
    ]);
  });

  it("leaves the parent alone when the last part is ticked", () => {
    const note = ["- [/] a", `  - [x] b ✅ ${TODAY}`, "  - [/] c"];

    expect(cycle(note, 3)).toEqual(new Map([[3, `  - [x] c ✅ ${TODAY} 🆔 kt-3f9a2c`]]));
  });
});

// #1306: the parts end where Obsidian ends them, so a tick reaches no todo past them.
describe("#1306 the cascade stops where the parts end", () => {
  it("#1306 A1 leaves a todo past a heading open", () => {
    const note = ["- [ ] r", "", "## Other", "  - [ ] far away"];

    expect(set(note, 1, "done")).toEqual(new Map([[1, `- [x] r ✅ ${TODAY} 🆔 kt-3f9a2c`]]));
  });

  it("#1306 A3 leaves a todo under a plain bullet at the parent's indent open", () => {
    const note = ["- [/] r", "- plain", "  - [ ] child of plain"];

    expect([...cycle(note, 1).keys()]).toEqual([1]);
  });

  it("#1306 A3 leaves a todo deeper than a plain bullet nested under the parent open", () => {
    const note = ["- [/] r", "  - plain", "    - [ ] under plain"];

    expect([...cycle(note, 1).keys()]).toEqual([1]);
  });

  it("#1306 A4 leaves an indented todo inside a code fence alone", () => {
    const note = ["- [/] r", "```markdown", "  - [ ] fenced", "```"];

    expect([...cycle(note, 1).keys()]).toEqual([1]);
  });

  it("#1306 A5 still ticks a part directly under its parent, beside a heading further down", () => {
    const note = ["- [/] r", "  - [ ] part", "## Other", "  - [ ] far away"];

    expect([...cycle(note, 1).keys()]).toEqual([1, 2]);
  });

  it("#1306 I1 I2 still ticks a part past a blank line, prose and a deeper plain bullet", () => {
    const note = ["- [/] r", "", "  a note on it", "  - a plain bullet", "  - [ ] part"];

    expect([...cycle(note, 1).keys()]).toEqual([1, 5]);
  });

  it("#1306 I3 still ticks a part after a closed fence", () => {
    const note = ["- [/] r", "```", "  - [ ] fenced", "```", "  - [ ] part"];

    expect([...cycle(note, 1).keys()]).toEqual([1, 5]);
  });
});
