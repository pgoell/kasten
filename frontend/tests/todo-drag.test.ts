import { dropOf, pinnedBy, type Spot } from "@/lib/todo/todo-drag";

const FDE = "02 Projects/FDE";
const KASTEN = "02 Projects/Kasten";

const at = (lane: string, column: Spot["column"]): Spot => ({ lane, column });

describe("where a dragged card lands (#397)", () => {
  it("#397 A1 a drop on another column sets that column's state", () => {
    expect(dropOf(at(FDE, "open"), at(FDE, "done"), true, false)).toEqual({
      kind: "state",
      state: "done",
    });
  });

  it("#397 A2 a drop on another project lane in the same column refiles there, from No project too", () => {
    expect(dropOf(at(KASTEN, "open"), at(FDE, "open"), true, false)).toEqual({
      kind: "refile",
      project: FDE,
    });
    expect(dropOf(at("", "doing"), at(FDE, "doing"), true, false)).toEqual({
      kind: "refile",
      project: FDE,
    });
  });

  it("#397 I1 a drop on the cell the card left writes nothing", () => {
    expect(dropOf(at(FDE, "open"), at(FDE, "open"), true, false)).toEqual({ kind: "none" });
    expect(dropOf(at("#client", "doing"), at("#client", "doing"), false, false)).toEqual({
      kind: "none",
    });
  });

  it("#397 I6 a drop carries the state or the project alone, no position", () => {
    expect(Object.keys(dropOf(at(FDE, "open"), at(FDE, "review"), true, false))).toEqual([
      "kind",
      "state",
    ]);
    expect(Object.keys(dropOf(at(KASTEN, "open"), at(FDE, "open"), true, false))).toEqual([
      "kind",
      "project",
    ]);
  });

  it("#397 I7 a drop that changes lane and column at once is refused and says why", () => {
    expect(dropOf(at(KASTEN, "open"), at(FDE, "done"), true, false)).toEqual({
      kind: "refused",
      why: "Nothing moved: drop in the same column to refile, or in the same lane to set the state",
    });
  });

  it("#397 I7 a drop on No project is refused and says why", () => {
    expect(dropOf(at(FDE, "open"), at("", "open"), true, false)).toEqual({
      kind: "refused",
      why: "Nothing moved: there is no project to file it into",
    });
  });

  it("#397 I7 a card a #p tag pins is refused on another project lane, and still takes a state", () => {
    expect(dropOf(at(FDE, "open"), at(KASTEN, "open"), true, true)).toEqual({
      kind: "refused",
      why: "Nothing moved: its #p tag decides its lane",
    });
    expect(dropOf(at(FDE, "open"), at(FDE, "done"), true, true)).toEqual({
      kind: "state",
      state: "done",
    });
  });

  it("#397 I7 a #p/x tag pins a card, and other tags do not", () => {
    expect(pinnedBy(["#client", "#p/fde"])).toBe(true);
    expect(pinnedBy(["#P/Kasten/docs"])).toBe(true);
    expect(pinnedBy(["#client", "#prio"])).toBe(false);
  });

  it("#397 I8 lanes by kind: another kind lane writes nothing, another column sets the state", () => {
    expect(dropOf(at("#client", "open"), at("#internal", "open"), false, false)).toEqual({
      kind: "none",
    });
    expect(dropOf(at("#client", "open"), at("#internal", "waiting"), false, false)).toEqual({
      kind: "state",
      state: "waiting",
    });
  });
});
