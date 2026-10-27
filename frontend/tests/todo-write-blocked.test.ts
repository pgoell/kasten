import { parseTodo } from "@/lib/todo/todo";
import {
  applyBlocked,
  blockedLines,
  blockLine,
  type Closed,
  closedAmong,
  unblockedEdit,
} from "@/lib/todo/todo-blocked";
import { todo } from "./todo-write-fixture";

/** A vault where one blocker is done and one is still open. */
const CLOSED: Closed = (id) =>
  id === "kt-000001" || id === "kt-000003" ? true : id === "kt-000002" ? false : undefined;

describe("blockedLines", () => {
  it("holds a dependent at blocked while what blocks it is open", () => {
    expect(blockedLines(["- [ ] ship it ⛔ kt-000002"], CLOSED)).toEqual(
      new Map([[1, "- [b] ship it ⛔ kt-000002"]]),
    );
  });

  it("opens it again once the blocker closes", () => {
    expect(blockedLines(["- [b] ship it ⛔ kt-000001"], CLOSED)).toEqual(
      new Map([[1, "- [ ] ship it ⛔ kt-000001"]]),
    );
  });

  it("answers nothing where the line already agrees with its blockers", () => {
    expect(blockedLines(["- [ ] ship it ⛔ kt-000001", "- [b] a ⛔ kt-000002"], CLOSED)).toEqual(
      new Map(),
    );
  });

  it("leaves a state kasten does not own alone, whatever the blocker says", () => {
    const note = [
      "- [/] one ⛔ kt-000002",
      "- [x] two ✅ 2026-08-01 ⛔ kt-000002",
      "- [-] three ❌ 2026-08-01 ⛔ kt-000001",
    ];

    expect(blockedLines(note, CLOSED)).toEqual(new Map());
  });

  it("opens a line only when every blocker on it is closed", () => {
    const both = ["- [b] ship it ⛔ kt-000001 ⛔ kt-000002"];
    const all = ["- [b] ship it ⛔ kt-000001 ⛔ kt-000003"];
    // A blocker nothing answers for reads as open, so nothing is opened on a
    // guess and a dangling `⛔` changes nothing.
    const dangling = ["- [b] ship it ⛔ kt-000001 ⛔ kt-ffffff"];

    expect(blockedLines(both, CLOSED)).toEqual(new Map());
    expect(blockedLines(all, CLOSED)).toEqual(
      new Map([[1, "- [ ] ship it ⛔ kt-000001 ⛔ kt-000003"]]),
    );
    expect(blockedLines(dangling, CLOSED)).toEqual(new Map());
  });

  it("holds a dependent at blocked while its blocker waits for review", () => {
    const closed = closedAmong([todo("- [r] ship it 🆔 kt-000001")]);

    expect(blockedLines(["- [ ] write the docs ⛔ kt-000001"], closed)).toEqual(
      new Map([[1, "- [b] write the docs ⛔ kt-000001"]]),
    );
    expect(blockedLines(["- [b] write the docs ⛔ kt-000001"], closed)).toEqual(new Map());
  });

  it("leaves a line carrying no blocker alone, hand-set blocked included", () => {
    // A `[b]` with no `⛔` means waiting on something outside the vault.
    expect(blockedLines(["- [b] waiting on the post", "- [ ] buy milk"], CLOSED)).toEqual(
      new Map(),
    );
  });
});

describe("applyBlocked", () => {
  it("gives the note back rewritten where a line moved", () => {
    const note = ["# kasten", "", "- [b] ship it ⛔ kt-000001", ""].join("\n");

    expect(applyBlocked(note, CLOSED)).toBe(
      ["# kasten", "", "- [ ] ship it ⛔ kt-000001", ""].join("\n"),
    );
  });

  it("answers null where nothing moved", () => {
    expect(applyBlocked(["# kasten", "", "- [ ] buy milk", ""].join("\n"), CLOSED)).toBeNull();
  });
});

describe("blockLine", () => {
  const open: Closed = () => false;

  it("names the blocker last on the line and blocks an open todo", () => {
    expect(blockLine("- [ ] write the docs 📅 2026-08-14", "kt-c0ffee", open)).toBe(
      "- [b] write the docs 📅 2026-08-14 ⛔ kt-c0ffee",
    );
  });

  it.each([
    ["doing", "- [/] write the docs"],
    ["waiting", "- [w] write the docs 👤 2026-08-03 Ada"],
  ])("leaves a %s todo in its state", (_state, line) => {
    expect(blockLine(line, "kt-c0ffee", open)).toBe(`${line} ⛔ kt-c0ffee`);
  });

  it("leaves a todo open under a blocker already closed", () => {
    expect(blockLine("- [ ] write the docs", "kt-c0ffee", () => true)).toBe(
      "- [ ] write the docs ⛔ kt-c0ffee",
    );
  });

  it("keeps the blockers the line already names", () => {
    expect(blockLine("- [b] write the docs ⛔ kt-000001", "kt-c0ffee", open)).toBe(
      "- [b] write the docs ⛔ kt-000001 ⛔ kt-c0ffee",
    );
  });

  it("keeps a tab indent, a block id and unknown text, and blocks the box", () => {
    expect(blockLine("\t- [ ] part zork 🜲 words 📅 2026-08-14 ^blk1", "kt-c0ffee", open)).toBe(
      "\t- [b] part zork 🜲 words 📅 2026-08-14 ⛔ kt-c0ffee ^blk1",
    );
  });

  it("puts a third blocker after the last of two, and moves nothing else", () => {
    const line = blockLine(
      "- [b] write ⛔ kt-000001 the docs ⛔ kt-000002 #later ^blk1",
      "kt-c0ffee",
      open,
    );

    expect(line).toBe("- [b] write ⛔ kt-000001 the docs ⛔ kt-000002 ⛔ kt-c0ffee #later ^blk1");
    expect(parseTodo(line ?? "")?.blockedBy).toEqual(["kt-000001", "kt-000002", "kt-c0ffee"]);
  });

  it("reorders nothing on a line whose fields sit out of order", () => {
    expect(
      blockLine("- [ ] 🆔 kt-3f9a2c write ⏫ the docs 📅 2026-08-14 #tag", "kt-c0ffee", open),
    ).toBe("- [b] 🆔 kt-3f9a2c write ⏫ the docs 📅 2026-08-14 ⛔ kt-c0ffee #tag");
  });

  it("answers nothing for a blocker the line names already, or a line that is no todo", () => {
    expect(blockLine("- [b] write the docs ⛔ kt-c0ffee", "kt-c0ffee", open)).toBeNull();
    expect(blockLine("write the docs", "kt-c0ffee", open)).toBeNull();
  });
});

describe("unblockedEdit", () => {
  it("opens a blocked line whose last blocker the edit deleted", () => {
    expect(unblockedEdit("- [b] write the docs ⛔ kt-c0ffee", "- [b] write the docs")).toBe(
      "- [ ] write the docs",
    );
  });

  it("changes the box alone, keeping a tab indent, a block id and fields out of order", () => {
    expect(
      unblockedEdit(
        "\t- [b] ⏫ part zork 📅 2026-08-14 🜲 words ⛔ kt-c0ffee ^blk1",
        "\t- [b] ⏫ part zork 📅 2026-08-14 🜲 words ^blk1",
      ),
    ).toBe("\t- [ ] ⏫ part zork 📅 2026-08-14 🜲 words ^blk1");
  });

  it("leaves a line that still names a blocker", () => {
    const after = "- [b] write the docs ⛔ kt-000001";
    expect(unblockedEdit(`${after} ⛔ kt-c0ffee`, after)).toBe(after);
  });

  it("leaves a blocked line that never named one, which waits on something outside the vault", () => {
    expect(unblockedEdit("- [b] write the docs", "- [b] write the manual")).toBe(
      "- [b] write the manual",
    );
  });

  it("leaves the state the edit itself set", () => {
    expect(unblockedEdit("- [b] write the docs ⛔ kt-c0ffee", "- [/] write the docs")).toBe(
      "- [/] write the docs",
    );
  });
});

describe("#537 a ⛔ naming a 🆔 two todos carry", () => {
  // Each case lists last the twin that would move its dependent, which is the
  // one a resolver going by the last todo listed would have answered with.
  it.each([
    ["an open dependent", "- [ ] c ⛔ kt-aaaaaa", ["- [x] a 🆔 kt-aaaaaa", "- [ ] a 🆔 kt-aaaaaa"]],
    [
      "a blocked dependent",
      "- [b] c ⛔ kt-aaaaaa",
      ["- [ ] a 🆔 kt-aaaaaa", "- [x] a 🆔 kt-aaaaaa"],
    ],
  ])("#537 A4 blockedLines leaves a dependent on a twinned 🆔 as it is, %s", (_, line, twins) => {
    expect(blockedLines([line], closedAmong(twins.map(todo)))).toEqual(new Map());
  });

  it("#537 I4 a dependent with one twinned blocker and one closed blocker stays as it is", () => {
    const closed = closedAmong(
      ["- [ ] a 🆔 kt-aaaaaa", "- [x] a 🆔 kt-aaaaaa", "- [x] b 🆔 kt-bbbbbb"].map(todo),
    );

    expect(blockedLines(["- [b] c ⛔ kt-aaaaaa ⛔ kt-bbbbbb"], closed)).toEqual(new Map());
  });

  /** kt-aaaaaa on two todos, and kt-yyyyyy on one still open. */
  const TWIN_AND_OPEN = closedAmong(
    ["- [x] a 🆔 kt-aaaaaa", "- [x] a 🆔 kt-aaaaaa", "- [ ] y 🆔 kt-yyyyyy"].map(todo),
  );

  it.each([
    [
      "blockedLines on an open dependent",
      () => blockedLines(["- [ ] c ⛔ kt-aaaaaa ⛔ kt-yyyyyy"], TWIN_AND_OPEN).get(1),
    ],
    [
      "blockLine adding an open blocker",
      () => blockLine("- [ ] c ⛔ kt-aaaaaa", "kt-yyyyyy", TWIN_AND_OPEN),
    ],
  ])("#537 B1 a twinned blocker beside an open one still blocks, %s", (_, written) => {
    // Whichever twin the ⛔ meant, the open blocker holds the line on its own.
    expect(written()).toBe("- [b] c ⛔ kt-aaaaaa ⛔ kt-yyyyyy");
  });
});
