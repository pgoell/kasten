import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NoteSearch } from "@/components/note-search";
import { searchHooks } from "./note-search-fixture";

const { searchNotes, fetchNote, fetchTodos, fetchMentions } = vi.hoisted(() => ({
  searchNotes: vi.fn(),
  fetchNote: vi.fn(),
  fetchTodos: vi.fn(),
  fetchMentions: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ searchNotes, fetchNote, fetchTodos, fetchMentions }));

searchHooks();

describe("todos", () => {
  const TODOS = [
    { path: "projects/kasten.md", line: 12, text: "- [ ] wire up the pane 📅 2026-08-14" },
    { path: "projects/kasten.md", line: 20, text: "- [/] write the docs" },
    { path: "projects/kasten.md", line: 21, text: "- [x] read the spec" },
    // A `## Time` line. The endpoint carries these back for phase 3, and they
    // are not todos, so this panel must not draw one.
    { path: "daily/2026-08-10.md", line: 5, text: "- 09:12-10:32 wire up the pane" },
  ];

  function renderTodos() {
    const onOpen = vi.fn();
    const onClose = vi.fn();

    render(
      <QueryClientProvider client={new QueryClient()}>
        <NoteSearch todos onOpen={onOpen} onClose={onClose} />
      </QueryClientProvider>,
    );

    const input = screen.getByLabelText("todos") as HTMLInputElement;

    return {
      onOpen,
      onClose,
      type: (value: string) => fireEvent.change(input, { target: { value } }),
      press: (key: string, init?: KeyboardEventInit) => fireEvent.keyDown(input, { key, ...init }),
      rows: () => screen.queryAllByRole("option").map((row) => row.textContent),
    };
  }

  it("lists the open todos, drawing the state and the words", async () => {
    fetchTodos.mockResolvedValue(TODOS);
    const panel = renderTodos();

    await waitFor(() => expect(panel.rows()).toHaveLength(2));
    expect(panel.rows()[0]).toContain("☐");
    expect(panel.rows()[0]).toContain("wire up the pane");
    expect(panel.rows()[0]).toContain("2026-08-14");
    expect(panel.rows()[1]).toContain("◐");
  });

  it("leaves out what is finished and what was never a todo", async () => {
    fetchTodos.mockResolvedValue(TODOS);
    const panel = renderTodos();

    await waitFor(() => expect(panel.rows()).toHaveLength(2));
    expect(panel.rows().join()).not.toContain("read the spec");
    expect(panel.rows().join()).not.toContain("09:12");
  });

  it("narrows the list as you type without asking the vault again", async () => {
    fetchTodos.mockResolvedValue(TODOS);
    const panel = renderTodos();
    await waitFor(() => expect(panel.rows()).toHaveLength(2));

    panel.type("docs");

    // What the vault holds is a fixed set, so typing ranks the answer in hand.
    await waitFor(() => expect(panel.rows()).toHaveLength(1));
    expect(fetchTodos).toHaveBeenCalledTimes(1);
  });

  it("opens the note on the line the todo sits on", async () => {
    fetchTodos.mockResolvedValue(TODOS);
    const panel = renderTodos();
    await waitFor(() => expect(panel.rows()).toHaveLength(2));

    panel.press("Enter");

    expect(panel.onOpen).toHaveBeenCalledWith("projects/kasten.md", 12);
  });
});
