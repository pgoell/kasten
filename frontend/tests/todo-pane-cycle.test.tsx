import { waitFor } from "@testing-library/react";
import { paneHooks, renderPane, TODOS } from "./todo-pane-fixture";

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
  it("cycles the row under the cursor on x", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("j");
    pane.press("x");

    // The hit, not the todo: the write reads the note off disk again, and the
    // path and the line are how it finds the line to cycle.
    expect(pane.onCycle).toHaveBeenCalledWith(TODOS[1]);
  });

  it("sets the state a shifted key names on the row under the cursor", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("B");

    // The walk cannot reach blocked from here: a row leaves this list the
    // moment it is done, which is the state the walk passes through first.
    expect(pane.onCycle).toHaveBeenCalledWith(TODOS[0], "blocked");
  });

  it("sets a row to waiting on W", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("W");

    expect(pane.onCycle).toHaveBeenCalledWith(TODOS[0], "waiting");
  });

  it("sets a row to review on V", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("V");

    expect(pane.onCycle).toHaveBeenCalledWith(TODOS[0], "review");
  });

  it("keeps the bare x walking the cycle", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("x");

    expect(pane.onCycle).toHaveBeenCalledWith(TODOS[0]);
  });
});
