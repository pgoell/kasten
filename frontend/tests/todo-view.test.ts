import { parseTodo, type Todo } from "@/lib/todo";
import {
  type Node,
  nextActionOf,
  type Placed,
  progressOf,
  sectionOf,
  treeOf,
  waiting,
} from "@/lib/todo-view";

/** The day every test below is written against, so no assertion expires. */
const TODAY = "2026-08-10";

/** A todo out of a line, for the tests that want a record rather than a string. */
function todo(line: string): Todo {
  const found = parseTodo(line);
  if (found === null) throw new Error(`not a todo: ${line}`);
  return found;
}

/** A note's todo lines, numbered from one the way a hit is. */
function placed(...lines: string[]): Placed[] {
  return lines.map((line, index) => ({ line: index + 1, todo: todo(line) }));
}

/** The first root of those lines, for a test about one tree rather than a list. */
function root(...lines: string[]): Node {
  const [first] = treeOf(placed(...lines));
  if (first === undefined) throw new Error("no todo in those lines");
  return first;
}

describe("sectionOf", () => {
  it("reads a due date before today as overdue", () => {
    expect(sectionOf(todo("- [ ] a 📅 2026-08-09"), TODAY)).toBe("overdue");
  });

  it("reads today as today", () => {
    expect(sectionOf(todo("- [ ] a 📅 2026-08-10"), TODAY)).toBe("today");
  });

  it("reads the next seven days as this week", () => {
    expect(sectionOf(todo("- [ ] a 📅 2026-08-11"), TODAY)).toBe("week");
    expect(sectionOf(todo("- [ ] a 📅 2026-08-16"), TODAY)).toBe("week");
  });

  it("reads anything further out as later", () => {
    // Seven days out is the first day past the window, the way `due:<7d` reads.
    expect(sectionOf(todo("- [ ] a 📅 2026-08-17"), TODAY)).toBe("later");
  });

  it("reads a todo with no date at all as no date", () => {
    expect(sectionOf(todo("- [ ] a"), TODAY)).toBe("none");
  });

  it("groups a scheduled todo on the day it is scheduled for", () => {
    // Due Friday, scheduled Tuesday: Tuesday is the day you have to act.
    expect(sectionOf(todo("- [ ] a 📅 2026-08-14 ⏳ 2026-08-11"), TODAY)).toBe("week");
    expect(sectionOf(todo("- [ ] a 📅 2026-08-14 ⏳ 2026-08-10"), TODAY)).toBe("today");
  });

  it("lands a past due date in overdue whatever it was scheduled for", () => {
    expect(sectionOf(todo("- [ ] a 📅 2026-08-07 ⏳ 2026-08-20"), TODAY)).toBe("overdue");
  });

  it("reads a scheduled date in the past as overdue on its own", () => {
    expect(sectionOf(todo("- [ ] a ⏳ 2026-08-07"), TODAY)).toBe("overdue");
  });
});

describe("waiting", () => {
  it("holds back a todo whose start date has not arrived", () => {
    expect(waiting(todo("- [ ] a 🛫 2026-08-11"), TODAY)).toBe(true);
  });

  it("lets one through on the day it starts, and after it", () => {
    expect(waiting(todo("- [ ] a 🛫 2026-08-10"), TODAY)).toBe(false);
    expect(waiting(todo("- [ ] a 🛫 2026-08-09"), TODAY)).toBe(false);
  });

  it("lets a todo with no start date through", () => {
    expect(waiting(todo("- [ ] a"), TODAY)).toBe(false);
  });
});

describe("treeOf", () => {
  it("reads a flat list as roots with no children", () => {
    const roots = treeOf(placed("- [ ] a", "- [ ] b", "- [ ] c"));

    expect(roots.map((root) => root.todo.text)).toEqual(["a", "b", "c"]);
    expect(roots.every((root) => root.children.length === 0)).toBe(true);
  });

  it("hangs each todo off the nearest one above it with a smaller indent", () => {
    const roots = treeOf(placed("- [ ] a", "  - [ ] b", "  - [ ] c", "    - [ ] d"));

    expect(roots).toHaveLength(1);
    expect(roots[0]?.children.map((child) => child.todo.text)).toEqual(["b", "c"]);
    expect(roots[0]?.children[1]?.children.map((child) => child.todo.text)).toEqual(["d"]);
    expect(roots[0]?.children[0]?.children).toEqual([]);
  });

  it("lifts a line back out to whichever todo above it is shallower", () => {
    // The one at indent 2 follows a todo at indent 4 and belongs to neither it
    // nor the root: the nearest smaller indent above it is `b`.
    const roots = treeOf(placed("- [ ] a", "  - [ ] b", "      - [ ] c", "    - [ ] d"));

    expect(roots).toHaveLength(1);
    const b = roots[0]?.children[0];
    expect(b?.todo.text).toBe("b");
    expect(b?.children.map((child) => child.todo.text)).toEqual(["c", "d"]);
  });

  it("reads an indented todo with nothing above it as a root", () => {
    const roots = treeOf(placed("  - [ ] a", "    - [ ] b"));

    expect(roots).toHaveLength(1);
    expect(roots[0]?.todo.text).toBe("a");
  });

  it("keeps the line numbers the note gave it", () => {
    const roots = treeOf(placed("- [ ] a", "  - [ ] b"));

    expect(roots[0]?.line).toBe(1);
    expect(roots[0]?.children[0]?.line).toBe(2);
  });
});

describe("progressOf", () => {
  it("counts every descendant, and reads rejected as closed", () => {
    // Five under the parent, of which the done, the rejected and the done
    // grandchild are closed.
    const parent = root(
      "- [/] a",
      "  - [x] b",
      "  - [-] c",
      "  - [ ] d",
      "    - [x] e",
      "    - [b] f",
    );

    expect(progressOf(parent)).toEqual({ closed: 3, total: 5 });
  });

  it("counts a grandchild through a parent that is open itself", () => {
    expect(progressOf(root("- [ ] a", "  - [ ] b", "    - [x] c"))).toEqual({
      closed: 1,
      total: 2,
    });
  });

  it("answers nothing for a todo with no parts", () => {
    expect(progressOf(root("- [ ] a"))).toBeNull();
  });
});

describe("nextActionOf", () => {
  it("answers the first part that is still open", () => {
    const parent = root("- [ ] a", "  - [x] b", "  - [ ] c", "  - [ ] d");

    expect(nextActionOf(parent, TODAY)?.todo.text).toBe("c");
  });

  it("lets a #next anywhere under it win over the obvious order", () => {
    const flat = root("- [ ] a", "  - [ ] b", "  - [ ] c", "  - [ ] d #next");
    const deep = root("- [ ] a", "  - [ ] b", "  - [ ] c", "    - [ ] d #next");

    expect(nextActionOf(flat, TODAY)?.todo.text).toBe("d #next");
    expect(nextActionOf(deep, TODAY)?.todo.text).toBe("d #next");
  });

  it("answers a leaf rather than the parent holding it", () => {
    const parent = root("- [ ] a", "  - [ ] b", "    - [ ] c", "  - [ ] d");

    expect(nextActionOf(parent, TODAY)?.todo.text).toBe("c");
  });

  it("reads a todo with no parts as its own next action", () => {
    expect(nextActionOf(root("- [ ] a"), TODAY)?.todo.text).toBe("a");
  });

  it("passes over a part that has not started yet", () => {
    const parent = root("- [ ] a", "  - [ ] b 🛫 2026-08-11", "  - [ ] c");

    expect(nextActionOf(parent, TODAY)?.todo.text).toBe("c");
  });

  it("answers nothing where every part is closed", () => {
    expect(nextActionOf(root("- [ ] a", "  - [x] b", "  - [-] c"), TODAY)).toBeNull();
  });
});
