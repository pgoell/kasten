import { waitFor } from "@testing-library/react";
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
  it("narrows to client work or to internal work, parts going with their parent", async () => {
    const pane = renderPane([
      { path: "a.md", line: 1, text: "- [ ] send the offer #client 📅 2026-08-10" },
      { path: "a.md", line: 2, text: "  - [ ] check the numbers" },
      { path: "a.md", line: 3, text: "- [ ] file the tax 📅 2026-08-10" },
    ]);
    await waitFor(() => expect(pane.rows()).toHaveLength(3));

    pane.type("#client");
    expect(pane.texts().join()).not.toContain("file the tax");
    expect(pane.rows()).toHaveLength(2);

    pane.type("-#client");
    expect(pane.rows()).toHaveLength(1);
    expect(pane.texts()[0]).toContain("file the tax");
  });

  it("narrows the list to the rows carrying every term", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.type("#kasten !high");

    // `#kasten` alone would keep the blocked row too, and `!high` alone the
    // dentist. Across groups the terms are an and.
    await waitFor(() => expect(pane.rows()).toHaveLength(1));
    expect(pane.texts()[0]).toContain("wire up the pane");
  });

  it("#627 A2 the #next filter lists a todo tagged in brackets", async () => {
    const pane = renderPane([
      { path: "a.md", line: 1, text: "- [ ] see (#next)" },
      { path: "a.md", line: 2, text: "- [ ] buy milk" },
    ]);
    await waitFor(() => expect(pane.rows()).toHaveLength(2));

    pane.type("#next");

    await waitFor(() => expect(pane.texts()).toEqual([expect.stringContaining("see")]));
  });
});
