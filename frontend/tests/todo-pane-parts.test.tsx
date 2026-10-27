import { PRIORITY_SYMBOL } from "@/lib/todo";
import { paneHooks, renderPane } from "./todo-pane-fixture";

// The doubles, the same in every todo-pane file: see todo-pane-fixture.tsx.
const { fetchTodos, fetchNote, fetchFiles, createNote } = vi.hoisted(() => ({
  fetchTodos: vi.fn(),
  fetchNote: vi.fn(),
  fetchFiles: vi.fn(),
  createNote: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ fetchTodos, fetchNote, fetchFiles, createNote }));

paneHooks();

describe("the todo pane", () => {
  it("counts a parent's parts on its row, and counts nothing on a row with none", async () => {
    // The closed parts are off the list themselves, so the count is read off
    // every todo the note holds rather than off the rows on screen.
    const pane = renderPane([
      { path: "a.md", line: 1, text: "- [/] wire up the pane 📅 2026-08-10" },
      { path: "a.md", line: 2, text: "  - [x] read the spec ✅ 2026-08-10" },
      { path: "a.md", line: 3, text: "  - [-] argue about it" },
      { path: "a.md", line: 4, text: "  - [ ] write it" },
    ]);

    await pane.loaded();
    expect(pane.rows()).toHaveLength(2);
    expect(pane.texts()[0]).toContain("2/3");
    expect(pane.texts()[1]).not.toContain("/");
  });

  /**
   * One note whose tree straddles two groups, which is what the nesting reads.
   *
   * `check list` carries a date of its own: a part that spells none takes its
   * parent's and lands in the group beside it, which straddles nothing.
   */
  const NESTED_ROWS = [
    { path: "a.md", line: 1, text: "- [/] finish todo story" },
    { path: "a.md", line: 2, text: "  - [ ] phase2" },
    { path: "a.md", line: 3, text: "    - [ ] phase2a" },
    { path: "a.md", line: 4, text: "- [/] safari preparation 📅 2026-08-10" },
    { path: "a.md", line: 5, text: "  - [ ] check list 📅 2026-08-14" },
  ];

  it("draws a part indented under the todo it belongs to", async () => {
    const pane = renderPane(NESTED_ROWS);
    await pane.loaded();
    expect(pane.rows()).toHaveLength(5);

    // Today holds safari preparation and This week holds check list; the rest
    // are under No date, in note order.
    const [, , root, part, deeper] = pane.rows() as HTMLElement[];
    expect(root?.textContent).toContain("finish todo story");
    expect(part?.textContent).toContain("phase2");
    expect(deeper?.textContent).toContain("phase2a");

    const indent = (row: HTMLElement | undefined) =>
      Number.parseFloat(row?.style.paddingLeft ?? "0");
    expect(indent(part)).toBeGreaterThan(indent(root));
    expect(indent(deeper)).toBeGreaterThan(indent(part));
  });

  it("names the parent of a part whose parent is in another group", async () => {
    const pane = renderPane(NESTED_ROWS);
    await pane.loaded();
    expect(pane.rows()).toHaveLength(5);

    // `check list` hangs off `safari preparation`, which is due today, and its
    // own date puts it a group further out. An indent there would be a lie.
    const rows = pane.rows() as HTMLElement[];
    const orphan = rows.find((row) => row.textContent?.includes("check list"));
    expect(orphan?.textContent).toContain("safari preparation");
    expect(orphan?.style.paddingLeft).toBe(rows[0]?.style.paddingLeft);
  });

  it("draws a part carrying no date of its own with what the todo above it has", async () => {
    const pane = renderPane([
      { path: "a.md", line: 1, text: "- [/] safari preparation 📅 2026-08-10 ⏫" },
      { path: "a.md", line: 2, text: "  - [ ] check list" },
      { path: "a.md", line: 3, text: "- [ ] buy milk" },
    ]);

    await pane.loaded();
    expect(pane.rows()).toHaveLength(3);

    // The part is due when what it is a part of is due, so it sits in that
    // group rather than under No date with the todo that spells nothing.
    // Each heading carries its row count beside the name (#811 A2).
    expect(pane.headings()).toEqual(["Today 2", "No date 1"]);
    expect(pane.texts()[1]).toContain("check list");
    expect(pane.texts()[1]).toContain("08-10");
    expect(pane.texts()[1]).toContain(PRIORITY_SYMBOL.high);
    expect(pane.texts()[2]).toContain("buy milk");
  });

  it("holds a part back behind the start date the todo above it carries", async () => {
    const pane = renderPane([
      { path: "a.md", line: 1, text: "- [/] safari preparation 🛫 2026-08-11" },
      { path: "a.md", line: 2, text: "  - [ ] check list" },
      { path: "a.md", line: 3, text: "- [ ] buy milk" },
    ]);

    await pane.loaded();
    expect(pane.rows()).toHaveLength(1);
    expect(pane.texts().join()).toContain("buy milk");
  });
});
