import { screen, waitFor } from "@testing-library/react";
import { paneHooks, renderPane, TODOS, TWINS } from "./todo-pane-fixture";

// The doubles, the same in every todo-pane file: see todo-pane-fixture.tsx.
const { fetchTodos, fetchNote, fetchFiles, createNote } = vi.hoisted(() => ({
  fetchTodos: vi.fn(),
  fetchNote: vi.fn(),
  fetchFiles: vi.fn(),
  createNote: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ fetchTodos, fetchNote, fetchFiles, createNote }));

paneHooks();

describe("the todo pane, picking what blocks a todo", () => {
  it("turns the list into a picker on b, and hands both rows over on enter", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("b");
    expect(pane.picking()).toContain("pick what blocks: call the dentist #health");
    expect(pane.footer()).toContain("Enter pick");

    pane.press("j");
    pane.press("Enter");

    // The row `b` was pressed on waits, and the row under the cursor blocks.
    expect(pane.onBlock).toHaveBeenCalledExactlyOnceWith(TODOS[0], TODOS[1]);
    expect(pane.onOpen).not.toHaveBeenCalled();
    expect(pane.picking()).toBe("");
  });

  it("gives the list back on escape and writes nothing", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("b");
    pane.press("Escape");

    expect(pane.picking()).toBe("");
    expect(pane.onBlock).not.toHaveBeenCalled();
  });

  it("does not let a todo block itself, and stays a picker", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("b");
    pane.press("Enter");

    expect(pane.onBlock).not.toHaveBeenCalled();
    expect(pane.picking()).not.toBe("");
  });

  it("does not name a blocker the todo names already", async () => {
    const pane = renderPane([
      { path: "a.md", line: 1, text: "- [b] write the docs ⛔ kt-c0ffee" },
      { path: "a.md", line: 2, text: "- [ ] ship the release 🆔 kt-c0ffee" },
    ]);
    await waitFor(() => expect(pane.rows()).toHaveLength(2));

    pane.press("b");
    pane.press("j");
    pane.press("Enter");

    expect(pane.onBlock).not.toHaveBeenCalled();
  });

  it("keeps every key that acts on a row off the picker", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("b");
    for (const key of ["x", "X", "t", "a", "s", "i", "d", "q"]) pane.press(key);

    expect(pane.onCycle).not.toHaveBeenCalled();
    expect(pane.onTimer).not.toHaveBeenCalled();
    expect(pane.onAdd).not.toHaveBeenCalled();
    expect(pane.draft()).toBeNull();
    expect(pane.reached).toEqual([]);
    expect(pane.rows()).toHaveLength(6);
  });

  it("offers a todo that cannot be started yet, which the list leaves out", async () => {
    const pane = renderPane([
      { path: "a.md", line: 1, text: "- [ ] write the docs" },
      { path: "a.md", line: 2, text: "- [ ] ship the release 🛫 2026-09-01" },
    ]);
    await waitFor(() => expect(pane.rows()).toHaveLength(1));

    pane.press("b");

    expect(pane.rows()).toHaveLength(2);
  });

  it("picks nothing for a finished todo", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("d");
    pane.press("b");

    expect(pane.picking()).toBe("");
  });

  it("says on a row what it waits for and how many wait for it", async () => {
    const pane = renderPane([
      { path: "a.md", line: 1, text: "- [/] ship the release 🆔 kt-000001" },
      { path: "a.md", line: 2, text: "- [b] write the docs ⛔ kt-000001" },
      { path: "a.md", line: 3, text: "- [b] write the post ⛔ kt-000001 ⛔ kt-ffffff" },
      { path: "a.md", line: 4, text: "- [ ] tag it ⛔ kt-000002" },
      { path: "a.md", line: 5, text: "- [x] cut the branch ✅ 2026-08-01 🆔 kt-000002" },
    ]);
    await waitFor(() => expect(pane.rows()).toHaveLength(4));

    const [ship, docs, post, tag] = pane.texts();
    expect(ship).toContain("→ 2");
    expect(docs).toContain("⛔ ship the release");
    // Two blockers are a count, and the title names both, one to a line.
    expect(post).toContain("⛔ 2");
    expect(screen.getByTitle(/ship the release kt-ffffff/)).toBeDefined();
    // A blocker already closed holds nothing.
    expect(tag).not.toContain("⛔");
  });

  it("#541 A1 holds a row on an id two todos carry, though the done twin is listed last", async () => {
    const pane = renderPane(TWINS);
    await waitFor(() => expect(pane.rows()).toHaveLength(2));

    const [ship, docs] = pane.texts();
    expect(docs).toContain("⛔ kt-aaaaaa");
    // #541 I2: the open twin says something waits for it.
    expect(ship).toContain("→ 1");
    // #541 I3: the title names the id, not the done twin's words.
    expect(screen.getByTitle(/^waits for:\s+kt-aaaaaa$/)).toBeDefined();
    expect(screen.queryByTitle(/cut the branch/)).toBeNull();
  });
});
