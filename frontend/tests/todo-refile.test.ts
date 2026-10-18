import { fileUnderTodos, projectNote, refileOf } from "@/lib/todo-refile";

const FDE = "02 Projects/FDE";

/** A daily note: a todo with a part, a note under the part, and one after it. */
const DAILY = [
  "# 2026-10-18",
  "",
  "## TODOs",
  "- [ ] call the bank",
  "  - [ ] write the deck 📅 2026-10-20 🆔 kt-000001",
  "    - [ ] draw the chart",
  "    the chart needs Q3",
  "  - [ ] book the room",
  "- [ ] buy milk",
].join("\n");

describe("refiling one todo (#396)", () => {
  it("#396 A1 A5 moves the todo and every line under it, and leaves a link at its indent", () => {
    const moved = refileOf(DAILY, 5, FDE);

    expect(moved?.block).toBe(
      [
        "- [ ] write the deck 📅 2026-10-20 🆔 kt-000001",
        "  - [ ] draw the chart",
        "  the chart needs Q3",
      ].join("\n"),
    );
    expect(moved?.left).toBe(
      [
        "# 2026-10-18",
        "",
        "## TODOs",
        "- [ ] call the bank",
        "  - write the deck [[02 Projects/FDE/index|FDE]]",
        "  - [ ] book the room",
        "- [ ] buy milk",
      ].join("\n"),
    );
  });

  it("#396 A5 a todo with nothing under it moves alone", () => {
    const moved = refileOf(DAILY, 9, FDE);

    expect(moved?.block).toBe("- [ ] buy milk");
    expect(moved?.left.split("\n").at(-1)).toBe("- buy milk [[02 Projects/FDE/index|FDE]]");
    expect(moved?.left.split("\n")).toHaveLength(9);
  });

  it("#396 A1 a blank line inside the block goes with it, one after it stays", () => {
    const text = ["- [ ] plan", "  - [ ] a", "", "  - [ ] b", "", "after"].join("\n");

    const moved = refileOf(text, 1, FDE);

    expect(moved?.block).toBe(["- [ ] plan", "  - [ ] a", "", "  - [ ] b"].join("\n"));
    expect(moved?.left).toBe(["- plan [[02 Projects/FDE/index|FDE]]", "", "after"].join("\n"));
  });

  it("#396 A1 the bullet keeps a link p already wrote, once, and drops a block id", () => {
    const text = "- [ ] send it [[02 Projects/FDE/index|FDE]] ⏫ ^abc";

    expect(refileOf(text, 1, FDE)?.left).toBe("- send it [[02 Projects/FDE/index|FDE]]");
  });

  it("#396 A1 a line that is not a todo moves nothing", () => {
    expect(refileOf(DAILY, 1, FDE)).toBeNull();
    expect(refileOf(DAILY, 40, FDE)).toBeNull();
  });

  it("#396 A1 the project's note is its index.md", () => {
    expect(projectNote(FDE)).toBe("02 Projects/FDE/index.md");
  });

  it("#396 A1 the block lands under ## TODOs, which is made where there is none", () => {
    const block = "- [ ] buy milk\n  - [ ] oat";

    expect(fileUnderTodos("# FDE\n\n## TODOs\n- [ ] old\n\n## Notes\nx", block)).toBe(
      "# FDE\n\n## TODOs\n- [ ] old\n- [ ] buy milk\n  - [ ] oat\n\n## Notes\nx",
    );
    expect(fileUnderTodos("# FDE", block)).toBe("# FDE\n\n## TODOs\n- [ ] buy milk\n  - [ ] oat\n");
  });

  it("#396 I3 a note holding the todo already, by id or by line, takes no second copy", () => {
    expect(
      fileUnderTodos("## TODOs\n- [/] write it 🆔 kt-000001", "- [ ] write 🆔 kt-000001"),
    ).toBe(null);
    expect(fileUnderTodos("## TODOs\n- [ ] buy milk", "- [ ] buy milk")).toBeNull();
    expect(fileUnderTodos("## TODOs\n- [ ] buy oat", "- [ ] buy milk")).not.toBeNull();
  });
});
