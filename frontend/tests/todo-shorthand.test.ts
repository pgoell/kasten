import { formatTodo, parseTodo, type Todo } from "@/lib/todo";
import { expandShorthand, matchesFilter, parseFilter } from "@/lib/todo-shorthand";

/** A Monday, which is what the weekday cases below are counted from. */
const TODAY = "2026-08-10";

function todo(line: string): Todo {
  const parsed = parseTodo(line);
  if (parsed === null) throw new Error(`not a todo: ${line}`);
  return parsed;
}

function matches(line: string, input: string): boolean {
  return matchesFilter(todo(line), parseFilter(input), TODAY);
}

describe("parseFilter", () => {
  it("reads a tag", () => {
    expect(parseFilter("#kasten").has.tags).toEqual(["#kasten"]);
  });

  it("reads each priority", () => {
    expect(parseFilter("!highest !high !med !low !lowest").has.priorities).toEqual([
      "highest",
      "high",
      "medium",
      "low",
      "lowest",
    ]);
  });

  it("reads each state", () => {
    expect(parseFilter("/open /doing /done /blocked /rejected").has.states).toEqual([
      "open",
      "doing",
      "done",
      "blocked",
      "rejected",
    ]);
  });

  it("reads each due window", () => {
    expect(parseFilter("due:today due:overdue due:<7d").has.due).toEqual([
      "today",
      "overdue",
      "week",
    ]);
  });

  it("puts a negated term on the other side", () => {
    const filter = parseFilter("-#kasten -!high -/done -due:today");

    expect(filter.hasNot).toEqual({
      tags: ["#kasten"],
      priorities: ["high"],
      states: ["done"],
      due: ["today"],
    });
    expect(filter.has).toEqual({ tags: [], priorities: [], states: [], due: [] });
  });

  it("leaves what is not a term as text", () => {
    const filter = parseFilter("#kasten !high wire pane");

    expect(filter.has.tags).toEqual(["#kasten"]);
    expect(filter.has.priorities).toEqual(["high"]);
    expect(filter.text).toBe("wire pane");
  });

  it("keeps a word that only looks like a term", () => {
    expect(parseFilter("due:whenever /nothing -later").text).toBe("due:whenever /nothing -later");
  });
});

describe("matchesFilter", () => {
  it("takes only what carries every group", () => {
    expect(matches("- [ ] wire up the pane #kasten ⏫", "#kasten !high")).toBe(true);
    expect(matches("- [ ] wire up the pane #kasten", "#kasten !high")).toBe(false);
    expect(matches("- [ ] call the dentist #health ⏫", "#kasten !high")).toBe(false);
  });

  it("takes a row carrying either term of one group", () => {
    expect(matches("- [/] wire up the pane", "/open /doing")).toBe(true);
    expect(matches("- [b] wire up the pane", "/open /doing")).toBe(false);
  });

  it("drops a row carrying a negated term", () => {
    expect(matches("- [ ] wire up the pane #kasten", "-#kasten")).toBe(false);
    expect(matches("- [ ] call the dentist #health", "-#kasten")).toBe(true);
  });

  it("takes everything when nothing was typed", () => {
    expect(matches("- [ ] wire up the pane", "wire")).toBe(true);
  });

  it("reads due:overdue as before today", () => {
    expect(matches("- [ ] wire up the pane 📅 2026-08-09", "due:overdue")).toBe(true);
    expect(matches("- [ ] wire up the pane 📅 2026-08-10", "due:overdue")).toBe(false);
    expect(matches("- [ ] wire up the pane", "due:overdue")).toBe(false);
  });

  it("reads due:today as today", () => {
    expect(matches("- [ ] wire up the pane 📅 2026-08-10", "due:today")).toBe(true);
    expect(matches("- [ ] wire up the pane 📅 2026-08-11", "due:today")).toBe(false);
  });

  it("reads due:<7d as less than seven days out", () => {
    expect(matches("- [ ] wire up the pane 📅 2026-08-16", "due:<7d")).toBe(true);
    expect(matches("- [ ] wire up the pane 📅 2026-08-18", "due:<7d")).toBe(false);
    expect(matches("- [ ] wire up the pane", "due:<7d")).toBe(false);
  });
});

/** What the prompt shows under the input, which is the line the vault will get. */
function written(input: string): string {
  return formatTodo(expandShorthand(input, TODAY));
}

describe("parseFilter and est:", () => {
  it("leaves est:2h in the text, there being nothing useful to filter on", () => {
    expect(parseFilter("est:2h #kasten").text).toBe("est:2h");
  });
});

describe("expandShorthand", () => {
  it("reads the spec's own line", () => {
    expect(written("call the dentist due:08-14 !high #health")).toBe(
      "- [ ] call the dentist #health 📅 2026-08-14 ⏫ ➕ 2026-08-10",
    );
    expect(expandShorthand("call the dentist due:08-14 !high #health", TODAY).tags).toEqual([
      "#health",
    ]);
  });

  it("takes a due date in each shape it is written", () => {
    expect(written("pay rent due:2026-09-01")).toBe("- [ ] pay rent 📅 2026-09-01 ➕ 2026-08-10");
    expect(written("pay rent due:09-01")).toBe("- [ ] pay rent 📅 2026-09-01 ➕ 2026-08-10");
    expect(written("pay rent due:today")).toBe("- [ ] pay rent 📅 2026-08-10 ➕ 2026-08-10");
    expect(written("pay rent due:tomorrow")).toBe("- [ ] pay rent 📅 2026-08-11 ➕ 2026-08-10");
  });

  it("reads a weekday as the next such day, never today", () => {
    // TODAY is a Monday.
    expect(written("pay rent due:friday")).toBe("- [ ] pay rent 📅 2026-08-14 ➕ 2026-08-10");
    expect(written("pay rent due:fri")).toBe("- [ ] pay rent 📅 2026-08-14 ➕ 2026-08-10");
    expect(written("pay rent due:monday")).toBe("- [ ] pay rent 📅 2026-08-17 ➕ 2026-08-10");
  });

  it("leaves a due: that is not a date in the words", () => {
    const todo = expandShorthand("pay rent due:whenever", TODAY);

    expect(todo.due).toBeUndefined();
    expect(todo.text).toBe("pay rent due:whenever");
  });

  it("leaves a day the calendar does not have in the words", () => {
    // `2026-02-30` parses as the second of March, so the shape alone is not
    // enough to take it as a date.
    expect(written("pay rent due:02-30")).toBe("- [ ] pay rent due:02-30 ➕ 2026-08-10");
  });

  it("reads an estimate, in each spelling a duration is written in", () => {
    // `⏲` after `➕`, which is the field order `todo.ts` writes every line in.
    expect(written("write the docs est:2h")).toBe("- [ ] write the docs ➕ 2026-08-10 ⏲ 2h");
    expect(written("write the docs est:1h20m")).toBe("- [ ] write the docs ➕ 2026-08-10 ⏲ 1h20m");
    expect(written("call the dentist due:08-14 est:45m !high")).toBe(
      "- [ ] call the dentist 📅 2026-08-14 ⏫ ➕ 2026-08-10 ⏲ 45m",
    );
  });

  it("leaves an estimate it cannot read in the words", () => {
    const todo = expandShorthand("write the docs est:soon", TODAY);

    expect(todo.estimate).toBeUndefined();
    expect(todo.text).toBe("write the docs est:soon");
  });
});
