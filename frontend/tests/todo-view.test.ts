import { parseTodo, type Todo } from "@/lib/todo";
import { sectionOf, waiting } from "@/lib/todo-view";

/** The day every test below is written against, so no assertion expires. */
const TODAY = "2026-08-10";

/** A todo out of a line, for the tests that want a record rather than a string. */
function todo(line: string): Todo {
  const found = parseTodo(line);
  if (found === null) throw new Error(`not a todo: ${line}`);
  return found;
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
