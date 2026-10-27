import { parseTodo, type Todo } from "@/lib/todo/todo";
import {
  COLUMNS,
  columnOf,
  kindOf,
  laneName,
  onBoard,
  projectChoices,
  withProjectLink,
} from "@/lib/todo/todo-board";
import { pinnedBy } from "@/lib/todo/todo-drag";

/** The day every test below is written against, so no assertion expires. */
const TODAY = "2026-10-16";

/** A todo out of a line, for the tests that want a record rather than a string. */
function todo(line: string): Todo {
  const found = parseTodo(line);
  if (found === null) throw new Error(`not a todo: ${line}`);
  return found;
}

/** A vault with two projects, one folder without an index, and a person. */
const PATHS = [
  "02 Projects/FDE/index.md",
  "02 Projects/FDE/notes/2026/kickoff.md",
  "02 Projects/Atlas/index.md",
  "02 Projects/Loose/plan.md",
  "02 Projects/readme.md",
  "03 Areas/08 People/Louise.md",
  "01 Periodic/2026-10-16.md",
];

describe("kindOf", () => {
  it("takes the todo's own first kind tag", () => {
    expect(kindOf(todo("- [ ] a #next #internal #client"), [])).toBe("#internal");
  });

  it("wins over an ancestor's", () => {
    expect(kindOf(todo("- [ ] a #private"), [todo("- [ ] b #client")])).toBe("#private");
  });

  it("takes the nearest ancestor's when it has none", () => {
    const ancestors = [
      todo("- [ ] parent"),
      todo("- [ ] grand #internal"),
      todo("- [ ] top #client"),
    ];
    expect(kindOf(todo("- [ ] a"), ancestors)).toBe("#internal");
  });

  it("is null with no kind anywhere", () => {
    expect(kindOf(todo("- [ ] a #next"), [todo("- [ ] b")])).toBeNull();
  });
});

describe("onBoard", () => {
  it("shows every open state", () => {
    for (const box of [" ", "/", "r", "w", "b"])
      expect(onBoard(todo(`- [${box}] a`), TODAY)).toBe(true);
  });

  it("shows done from six days back and not seven", () => {
    expect(onBoard(todo("- [x] a ✅ 2026-10-10"), TODAY)).toBe(true);
    expect(onBoard(todo("- [x] a ✅ 2026-10-09"), TODAY)).toBe(false);
  });

  it("shows rejected from six days back and not seven", () => {
    expect(onBoard(todo("- [-] a ❌ 2026-10-10"), TODAY)).toBe(true);
    expect(onBoard(todo("- [-] a ❌ 2026-10-09"), TODAY)).toBe(false);
  });

  it("leaves out done and rejected with no stamp", () => {
    expect(onBoard(todo("- [x] a"), TODAY)).toBe(false);
    expect(onBoard(todo("- [-] a"), TODAY)).toBe(false);
  });
});

describe("columnOf", () => {
  it("puts a todo in the column of its state", () => {
    expect(columnOf(todo("- [w] a"))).toBe("waiting");
    expect(columnOf(todo("- [r] a"))).toBe("review");
    expect(COLUMNS).toEqual(["open", "doing", "review", "waiting", "blocked", "done", "rejected"]);
  });
});

describe("projectChoices", () => {
  it("lists the folders under the link root with an index, by name", () => {
    expect(projectChoices(PATHS)).toEqual([
      { folder: "02 Projects/Atlas", name: "Atlas", index: "02 Projects/Atlas/index.md" },
      { folder: "02 Projects/FDE", name: "FDE", index: "02 Projects/FDE/index.md" },
    ]);
  });
});

describe("withProjectLink", () => {
  const FDE = { folder: "02 Projects/FDE", name: "FDE", index: "02 Projects/FDE/index.md" };

  it("adds the link to the words, ahead of the fields", () => {
    expect(withProjectLink("- [ ] send deck #client 📅 2026-10-20 🆔 kt-abcdef", FDE, PATHS)).toBe(
      "- [ ] send deck #client [[02 Projects/FDE/index|FDE]] 📅 2026-10-20 🆔 kt-abcdef",
    );
  });

  it("keeps the indent and the state", () => {
    expect(withProjectLink("    - [/] a part", FDE, PATHS)).toBe(
      "    - [/] a part [[02 Projects/FDE/index|FDE]]",
    );
  });

  it("keeps a tab indent byte for byte", () => {
    expect(withProjectLink("\t- [ ] part 📅 2026-10-20", FDE, PATHS)).toBe(
      "\t- [ ] part [[02 Projects/FDE/index|FDE]] 📅 2026-10-20",
    );
  });

  it("leaves a block id last", () => {
    expect(withProjectLink("- [ ] a 📅 2026-10-20 ^blk1", FDE, PATHS)).toBe(
      "- [ ] a [[02 Projects/FDE/index|FDE]] 📅 2026-10-20 ^blk1",
    );
    expect(withProjectLink("- [ ] a ^blk1", FDE, PATHS)).toBe(
      "- [ ] a [[02 Projects/FDE/index|FDE]] ^blk1",
    );
  });

  it("keeps double spaces in the words", () => {
    expect(withProjectLink("- [ ] send  the deck", FDE, PATHS)).toBe(
      "- [ ] send  the deck [[02 Projects/FDE/index|FDE]]",
    );
  });

  it("leaves a date inside an existing link untouched", () => {
    expect(withProjectLink("- [ ] read [[📅 plan]] 📅 2026-10-21", FDE, PATHS)).toBe(
      "- [ ] read [[📅 plan]] [[02 Projects/FDE/index|FDE]] 📅 2026-10-21",
    );
  });

  it("leaves a priority glyph inside a code span untouched", () => {
    expect(withProjectLink("- [ ] fix `⏫` icon 📅 2026-10-20", FDE, PATHS)).toBe(
      "- [ ] fix `⏫` icon [[02 Projects/FDE/index|FDE]] 📅 2026-10-20",
    );
  });

  it("goes before a marker typed with no space", () => {
    const line = "- [ ] a📅 2026-10-20";
    const written = withProjectLink(line, FDE, PATHS) ?? "";
    expect(written).toBe("- [ ] a [[02 Projects/FDE/index|FDE]]📅 2026-10-20");
    expect(todo(written).due).toBe("2026-10-20");
  });

  it("reads a marker whose value does not parse as words", () => {
    expect(withProjectLink("- [ ] meet 📅 friday ⏫", FDE, PATHS)).toBe(
      "- [ ] meet 📅 friday [[02 Projects/FDE/index|FDE]] ⏫",
    );
  });

  it("goes ahead of 🏁, which obsidian-tasks reads as a field", () => {
    expect(withProjectLink("- [ ] a 🏁 delete 📅 2026-10-20", FDE, PATHS)).toBe(
      "- [ ] a [[02 Projects/FDE/index|FDE]] 🏁 delete 📅 2026-10-20",
    );
  });

  it("goes ahead of who the todo waits on", () => {
    expect(withProjectLink("- [w] ask 👤 2026-10-14 Louise 📅 2026-10-20", FDE, PATHS)).toBe(
      "- [w] ask [[02 Projects/FDE/index|FDE]] 👤 2026-10-14 Louise 📅 2026-10-20",
    );
  });

  it("is null when a link already lands in the folder", () => {
    expect(
      withProjectLink("- [ ] see [[02 Projects/FDE/notes/2026/kickoff]]", FDE, PATHS),
    ).toBeNull();
  });

  it("is null on a line that is not a todo", () => {
    expect(withProjectLink("- send deck", FDE, PATHS)).toBeNull();
  });
});

describe("laneName", () => {
  it("names a lane by the project's folder, or as no project", () => {
    expect(laneName("02 Projects/FDE")).toBe("FDE");
    expect(laneName(null)).toBe("No project");
  });
});

describe("#617 a hash in a span or an address is no tag", () => {
  it("#617 A6 a #p/x or a kind in a code span puts the card in no lane of it", () => {
    expect.soft(pinnedBy(todo("- [ ] run `ls #p/x log`").tags)).toBe(false);
    expect(kindOf(todo("- [ ] run `grep #client log`"), [])).toBeNull();
  });
});

describe("#627 a tag ends where the editor's tag ends", () => {
  it("#627 I3 a kind lane and a project pin read the tag without the bracket after it", () => {
    expect.soft(kindOf(todo("- [ ] call (#client)"), [])).toBe("#client");
    expect(todo("- [ ] see (#p/x)").tags).toEqual(["#p/x"]);
  });
});
