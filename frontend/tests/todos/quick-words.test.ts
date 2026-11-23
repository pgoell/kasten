// @vitest-environment node
import { newTodoOf, readQuick, settled } from "@/lib/todo/view/rows/quick-words";
import { TODAY } from "./rows";

const PROJECTS = ["03 Areas/Haus", "02 Projects/FDE"];

describe("the words of a new todo", () => {
  it("fill the fields they name and leave the rest as the words", () => {
    const quick = readQuick("call the landlord tomorrow p2 #Haus 30m", TODAY, PROJECTS);
    expect(quick.words).toBe("call the landlord");
    expect(quick.fields).toEqual({
      planned: "2026-11-23",
      priority: "high",
      project: "03 Areas/Haus",
      estimate: 30,
    });
    expect(quick.tokens.map((token) => token.field)).toEqual([
      "planned",
      "priority",
      "project",
      "estimate",
    ]);
    expect(quick.tokens[0]).toMatchObject({ start: 18, end: 26 });
  });

  it("read a weekday as the next one, due: as the due date, and keep a tag that names no project", () => {
    const quick = readQuick("send it friday due:mon weekly #client", TODAY, PROJECTS);
    expect(quick.words).toBe("send it #client");
    expect(quick.fields).toEqual({
      planned: "2026-11-27",
      due: "2026-11-23",
      repeat: "every week",
    });
  });

  it("take the day of the group they were started from, unless the words name one", () => {
    const group = { planned: "2026-11-26" };
    expect(settled(readQuick("order the lamp", TODAY, PROJECTS), {}, group).fields).toEqual({
      planned: "2026-11-26",
    });
    expect(settled(readQuick("order it tomorrow", TODAY, PROJECTS), {}, group).fields).toEqual({
      planned: "2026-11-23",
    });
  });

  it("give way to a field picked by hand, and the group's project fills in where none is named", () => {
    const quick = readQuick("call tomorrow", TODAY, PROJECTS);
    const { fields, from } = settled(
      quick,
      { planned: undefined, priority: "low" },
      { project: "02 Projects/FDE" },
    );
    expect(fields).toEqual({ project: "02 Projects/FDE", priority: "low" });
    expect([...from]).toEqual([]);
    expect(newTodoOf(quick, { ...fields, due: TODAY }, " ")).toEqual({
      words: "call",
      project: "02 Projects/FDE",
      priority: "low",
      due: TODAY,
      due_hard: true,
    });
  });
});
