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

  it("#396 I3 a note holding the whole block with its id already takes no second copy", () => {
    const block = "- [ ] write 🆔 kt-000001\n  - [ ] draw";

    expect(fileUnderTodos(`## TODOs\n- [ ] old\n${block}\n- [ ] after`, block)).toBeNull();
  });

  it("#396 B1 another todo of the same words is not the todo, so the block lands", () => {
    // A recurring todo's earlier copy, which a match by line took for this one.
    const text = "## TODOs\n- [ ] send minutes";

    expect(fileUnderTodos(text, "- [ ] send minutes\n  - [ ] ask Ada")).toBe(
      "## TODOs\n- [ ] send minutes\n- [ ] send minutes\n  - [ ] ask Ada",
    );
    expect(fileUnderTodos(text, "- [ ] send minutes")).toBe(
      "## TODOs\n- [ ] send minutes\n- [ ] send minutes",
    );
  });

  it("#396 B2 a copy whose parts were changed since takes the block again", () => {
    // A half move, then a part added to the todo left behind: the copy by
    // id is not the whole of it, and taking the source out would lose the part.
    const copy = "## TODOs\n- [ ] write 🆔 kt-000001\n  - [ ] draw";
    const edited = "- [ ] write 🆔 kt-000001\n  - [x] draw ✅ 2026-10-18\n  - [ ] send";

    expect(fileUnderTodos(copy, edited)).toBe(`${copy}\n${edited}`);
    expect(
      fileUnderTodos("## TODOs\n- [/] write it 🆔 kt-000001", "- [ ] write 🆔 kt-000001"),
    ).toBe("## TODOs\n- [/] write it 🆔 kt-000001\n- [ ] write 🆔 kt-000001");
  });

  it("#396 A5 a part indented by spaces under a tab-indented todo moves with it, verbatim", () => {
    const text = ["\t- [ ] x", "    - [ ] sub", "- [ ] next"].join("\n");

    const moved = refileOf(text, 1, FDE);

    expect(moved?.block).toBe(["- [ ] x", "    - [ ] sub"].join("\n"));
    expect(moved?.left).toBe(["\t- x [[02 Projects/FDE/index|FDE]]", "- [ ] next"].join("\n"));
  });

  it("#396 A5 a part indented by tabs under a todo indented by spaces moves with it, verbatim", () => {
    const text = ["  - [ ] x", "\t\t\t- [ ] sub", "- [ ] next"].join("\n");

    const moved = refileOf(text, 1, FDE);

    expect(moved?.block).toBe(["- [ ] x", "\t\t\t- [ ] sub"].join("\n"));
    expect(moved?.left).toBe(["  - x [[02 Projects/FDE/index|FDE]]", "- [ ] next"].join("\n"));
  });
});
