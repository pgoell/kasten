import { act, waitFor } from "@testing-library/react";
import { followRow, twinsOf } from "@/lib/todo/todo-turns";
import { paneHooks, renderPane, TODOS } from "./todo-pane-fixture";

// The doubles, the same in every todo-pane file: see todo-pane-fixture.tsx.
const { fetchTodos, fetchNote, fetchFiles, createNote } = vi.hoisted(() => ({
  fetchTodos: vi.fn(),
  fetchNote: vi.fn(),
  fetchFiles: vi.fn(),
  createNote: vi.fn(),
}));
vi.mock("@/lib/core/api", () => ({ fetchTodos, fetchNote, fetchFiles, createNote }));

paneHooks();

describe("the todo pane", () => {
  /** Two notes, one holding a small tree and one holding a todo on its own. */
  const NESTED = [
    { path: "a.md", line: 1, text: "- [/] wire up the pane 📅 2026-08-10" },
    { path: "a.md", line: 2, text: "  - [x] read the spec ✅ 2026-08-10" },
    { path: "a.md", line: 3, text: "  - [ ] write it" },
    { path: "a.md", line: 4, text: "    - [ ] draft it 🆔 kt-dddddd" },
    { path: "b.md", line: 7, text: "- [ ] buy milk 📅 2026-08-14" },
  ];

  it("shows one next action per top level todo on n", async () => {
    const pane = renderPane(NESTED);
    await pane.loaded();
    expect(pane.rows()).toHaveLength(4);

    pane.press("n");

    // One row per open root: the tree in `a.md` and the lone todo in `b.md`.
    // The tree's row names the grandchild, that being the first open leaf.
    await waitFor(() => expect(pane.rows()).toHaveLength(2));
    const drafting = pane.texts().find((text) => text.includes("draft it")) ?? "";
    expect(drafting).toContain("wire up the pane");
    expect(pane.texts().join()).toContain("buy milk");
  });

  it("opens the next action's own embed rather than the root's", async () => {
    const views = fetchNote.getMockImplementation();
    fetchNote.mockImplementation((path: string) =>
      path === "a.md"
        ? Promise.resolve("# A\n\n![[kt-aaaaaa]]\n- ![[kt-dddddd]]\n")
        : views?.(path),
    );
    const pane = renderPane(NESTED);
    await pane.loaded();
    expect(pane.rows()).toHaveLength(4);

    pane.press("n");
    await waitFor(() => expect(pane.rows()).toHaveLength(2));
    // `draft it` takes the root's due date, so its row heads the list, above
    // `buy milk` in This week.
    pane.press("Enter");

    await waitFor(() => expect(pane.onOpen).toHaveBeenCalledWith("a.md", 4));
  });

  it("swaps the done list for the next actions rather than showing both", async () => {
    const pane = renderPane(NESTED);
    await pane.loaded();
    expect(pane.rows()).toHaveLength(4);

    pane.press("d");
    await waitFor(() => expect(pane.rows()).toHaveLength(1));
    pane.press("n");

    await waitFor(() => expect(pane.rows()).toHaveLength(2));
    expect(pane.texts().join()).not.toContain("read the spec");
  });

  it("puts the full list back on a second n", async () => {
    const pane = renderPane(NESTED);
    await pane.loaded();
    expect(pane.rows()).toHaveLength(4);

    pane.press("n");
    await waitFor(() => expect(pane.rows()).toHaveLength(2));
    pane.press("n");

    await waitFor(() => expect(pane.rows()).toHaveLength(4));
  });

  it("swaps the list for the last seven days of finished work on d", async () => {
    const pane = renderPane();
    await pane.loaded();
    expect(pane.rows()).toHaveLength(6);

    pane.press("d");

    // Grouped by the day they were finished rather than by when they were due,
    // a finished todo having no due date worth grouping on. Newest day first.
    await waitFor(() => expect(pane.rows()).toHaveLength(2));
    // Each group's heading now carries its row count after the day (#811), so the
    // count is taken off here; the day is what this test is about.
    expect(pane.headings().map((heading) => heading?.replace(/ \d+$/, ""))).toEqual([
      "2026-08-10",
      "2026-08-08",
    ]);
    expect(pane.texts()[0]).toContain("read the spec");
    expect(pane.texts()[1]).toContain("write the spec");
    // Nine days back is past the window.
    expect(pane.texts().join()).not.toContain("think about it");
  });

  it("puts the open list back on a second d", async () => {
    const pane = renderPane();
    await pane.loaded();
    expect(pane.rows()).toHaveLength(6);

    pane.press("d");
    await waitFor(() => expect(pane.rows()).toHaveLength(2));
    pane.press("d");

    await waitFor(() => expect(pane.rows()).toHaveLength(6));
  });
});

describe("#2257 an open edit row whose todo leaves its note", () => {
  // Both at version 1, as every todo no write has touched: a write aimed at the wrong one would land.
  const ONE = {
    path: "a.md",
    line: 1,
    text: "- [ ] one 🆔 kt-000011",
    todo: { id: "kt-000011", version: 1 },
  };
  const TWO = {
    path: "a.md",
    line: 2,
    text: "- [ ] two 🆔 kt-000012",
    todo: { id: "kt-000012", version: 1 },
  };

  async function editingOne() {
    const pane = renderPane([ONE, TWO]);
    await pane.loaded();
    pane.press("i");
    expect((pane.draft() as HTMLInputElement).value).toBe(ONE.text);
    pane.write("- [ ] one more 🆔 kt-000011");
    return pane;
  }

  it("closes, keeping the typed text in the notice, when the todo is deleted and the next takes its line", async () => {
    const pane = await editingOne();
    pane.answer([{ ...TWO, line: 1 }]);

    // The row leaves in the render its todo leaves; the notice goes out in an effect a commit later (#2264).
    await waitFor(() =>
      expect(pane.onNotice).toHaveBeenCalledWith(
        "Nothing moved: that line left the list while it was edited. The edit read: - [ ] one more 🆔 kt-000011",
      ),
    );
    expect(pane.draft()).toBeNull();
    expect(pane.onEdit).not.toHaveBeenCalled();
  });

  it("stays on its own todo moved to another note, and Enter writes that todo, never the one left on its line", async () => {
    const pane = await editingOne();
    pane.answer([
      { ...TWO, line: 1 },
      { ...ONE, path: "b.md" },
    ]);
    // react-query hands the answer to the pane on a timeout of 0.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    pane.send("Enter");

    expect(pane.onEdit).toHaveBeenCalledTimes(1);
    expect(pane.onEdit.mock.calls[0]?.[0]).toMatchObject({ text: ONE.text, todo: ONE.todo });
  });

  it("a tapped state button's question never moves onto the todo that took its line", () => {
    expect(followRow(ONE, twinsOf(ONE, [ONE, TWO]), [{ ...TWO, line: 1 }])).toBeNull();
  });
});

// Counted in commits, not milliseconds, so a loaded box cannot pass or fail it.
it("#1355 A1 the rows of the first todos answer draw in a commit after the one the fetch forces", async () => {
  let answer: (hits: typeof TODOS) => void = () => {};
  const pending = new Promise<typeof TODOS>((resolve) => (answer = resolve));
  // The rows each commit leaves on screen, read as the commit lands.
  const drawn: number[] = [];
  renderPane(pending, 0, () => drawn.push(document.querySelectorAll("[data-row]").length));
  await waitFor(() => expect(fetchTodos).toHaveBeenCalled());
  const before = drawn.length;

  await act(async () => answer(TODOS));
  await waitFor(() => expect(document.querySelectorAll("[data-row]")).toHaveLength(6));

  // The urgent commit the answer forces draws no row; a later one draws them all.
  const after = drawn.slice(before);
  expect(after[0]).toBe(0);
  expect(after.at(-1)).toBe(6);
});
