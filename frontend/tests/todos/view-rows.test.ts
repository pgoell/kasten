// @vitest-environment node
import { dateCell, detailCell } from "@/lib/todo/view/row-facts";
import { countOf, groupsOf } from "@/lib/todo/view/view-rows";
import { row, TODAY } from "./rows";

const ROWS = [
  row("kt-000001", "write the parser tests #internal", { state: "doing", priority: "high" }),
  row("kt-000002", "file the expense report", {
    due: "2026-11-20",
    due_hard: true,
    priority: "highest",
  }),
  row("kt-000003", "draft the offer", { planned: TODAY, project: "02 Projects/FDE" }),
  row("kt-000004", "check the numbers", { parent_id: "kt-000003" }),
  row("kt-000005", "ship the release", { planned: "2026-11-24" }),
  row("kt-000006", "send the invoice", {
    state: "waiting",
    waiting_on: "Ada",
    waiting_since: "2026-11-17",
    look_again: TODAY,
  }),
  row("kt-000007", "paint later", { planned: TODAY, hold_until: "2026-11-30" }),
  row("kt-000008", "pay the rent", { state: "done", done: TODAY }),
  row("kt-000009", "old thing", { state: "done", done: "2026-11-01" }),
  row("kt-000010", "look into backups"),
];

const shape = (groups: ReturnType<typeof groupsOf>) =>
  groups.map((group) => [
    group.label,
    group.lines.map((line) => `${"  ".repeat(line.depth)}${line.row.words}`),
  ]);

describe("the todo table's groups", () => {
  it("lists what is on today by state, a part under its parent, and ends in Done today", () => {
    expect(shape(groupsOf(ROWS, { tab: "today", by: "state", today: TODAY }))).toEqual([
      ["Doing", ["write the parser tests #internal"]],
      ["Open", ["file the expense report", "draft the offer", "  check the numbers"]],
      ["Waiting", ["send the invoice"]],
      ["Done today", ["pay the rent"]],
    ]);
  });

  it("keeps what has no project and no plan in the inbox, held todos out", () => {
    const inbox = groupsOf(ROWS, { tab: "inbox", by: "state", today: TODAY });
    expect(inbox.flatMap((group) => group.lines.map((line) => line.row.words))).toEqual([
      "write the parser tests #internal",
      "file the expense report",
      "look into backups",
      "send the invoice",
    ]);
  });

  it("puts the week ahead under Upcoming and groups by project on request", () => {
    expect(shape(groupsOf(ROWS, { tab: "upcoming", by: "project", today: TODAY }))).toEqual([
      ["No project", ["ship the release"]],
    ]);
  });

  it("counts a part with its parent's plan, and the filter narrows by the words", () => {
    expect(countOf(ROWS, "today", TODAY)).toBe(5);
    const typed = groupsOf(ROWS, { tab: "all", by: "state", today: TODAY, words: "OFFER" });
    expect(shape(typed)).toEqual([["Open", ["draft the offer"]]]);
  });

  it("counts a parent's parts and the notes a todo touches", () => {
    const linked = row("kt-000011", "read [[A]]", { description: "and [[B]], [[A]]" });
    const [open] = groupsOf([...ROWS, linked], { tab: "all", by: "state", today: TODAY }).filter(
      (group) => group.label === "Open",
    );
    const lines = new Map(open?.lines.map((line) => [line.row.id, line]));
    expect(lines.get("kt-000003")?.parts).toEqual({ closed: 0, total: 1 });
    expect(lines.get("kt-000011")?.notes).toBe(3);
  });
});

describe("a row's columns", () => {
  const byId = new Map(ROWS.map((each) => [each.id, each]));

  it("shows a hard or passed due date with its flag, else the plan, and a soft one only when near", () => {
    expect(dateCell(ROWS[1] as never, TODAY)).toEqual({ text: "20 Nov", due: true, late: true });
    expect(dateCell(ROWS[2] as never, TODAY)).toEqual({ text: "today", due: false, late: false });
    expect(dateCell(row("x", "x", { due: "2026-12-06" }), TODAY)).toBeNull();
    expect(dateCell(row("x", "x", { due: "2026-11-23" }), TODAY)?.text).toBe("tomorrow");
  });

  it("says whom a todo waits on, what blocks it, its time or its repeat", () => {
    expect(detailCell(ROWS[5] as never, byId, TODAY)).toEqual({ kind: "wait", text: "Ada, 5 d" });
    const held = row("x", "x", { state: "blocked", blocked_by: ["kt-000005"] });
    expect(detailCell(held, byId, TODAY)).toEqual({ kind: "blocked", text: "ship the release" });
    expect(detailCell(row("x", "x", { estimate: 120, worked: 45 }), byId, TODAY)?.text).toBe(
      "45 m of 2 h",
    );
    expect(detailCell(row("x", "x", { repeat: "every week" }), byId, TODAY)?.text).toBe("weekly");
  });
});
