import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TodoPane } from "@/components/todo-pane";
import type { EditorCommands } from "@/lib/key-bindings";
import { boardHooks, renderPane as renderBoardPane } from "./todo-board-pane-fixture";
import { paneHooks } from "./todo-pane-fixture";

// The doubles, the same in every todo-pane file: see todo-pane-fixture.tsx.
const { fetchTodos, fetchNote, fetchFiles, createNote } = vi.hoisted(() => ({
  fetchTodos: vi.fn(),
  fetchNote: vi.fn(),
  fetchFiles: vi.fn(),
  createNote: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ fetchTodos, fetchNote, fetchFiles, createNote }));

paneHooks();
boardHooks();

const TODAY = "2026-08-10";

/** A hit as the backend answers it, with the shared flag the backend adds (#811). */
type Hit = { path: string; line: number; text: string; shared?: boolean };

const HITS: Hit[] = [
  { path: "a.md", line: 1, text: "- [ ] buy milk 📅 2026-08-14" },
  { path: "a.md", line: 2, text: "- [ ] call the dentist 📅 2026-08-07 #client" },
  { path: "a.md", line: 3, text: "- [x] read the spec ✅ 2026-08-08" },
  { path: "05 Shared/Einkauf.md", line: 1, text: "- [ ] buy eggs 📅 2026-08-14", shared: true },
];

/**
 * The pane with every write prop held in a spy this test can read. The list
 * fixture hands `onAgent` a spy it never returns, so this one mounts the pane
 * itself to see that prop too.
 */
function renderWatched(hits: Hit[]) {
  vi.mocked(fetchTodos).mockResolvedValue(hits);
  const writes = {
    onCycle: vi.fn(),
    onAdd: vi.fn(),
    onSubtask: vi.fn(),
    onEdit: vi.fn(),
    onBlock: vi.fn(),
    onTimer: vi.fn(),
    onAgent: vi.fn(),
    onRefile: vi.fn(),
  };
  const commands = new Proxy({} as EditorCommands, { get: () => () => undefined });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TodoPane
        commands={commands}
        onOpen={vi.fn()}
        onNotice={vi.fn()}
        focusSignal={0}
        today={TODAY}
        {...writes}
      />
    </QueryClientProvider>,
  );
  return writes;
}

describe("the todo pane's guards", () => {
  it("#811 A9 c flips between list and board", async () => {
    const pane = renderBoardPane();
    await waitFor(() => expect(document.querySelector("[data-row]")).not.toBeNull());

    pane.press("c");
    await waitFor(() => expect(pane.cards().length).toBeGreaterThan(0));

    pane.press("c");
    await waitFor(() => expect(pane.cards().length).toBe(0));
    expect(document.querySelector("[data-row]")).not.toBeNull();
  });

  it("#811 A11 folding, filtering, the toggle and c write nothing", async () => {
    const writes = renderWatched(HITS);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Done this week/ })).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("button", { name: /^Done this week/ }));
    fireEvent.change(screen.getByLabelText("filter todos"), { target: { value: "buy" } });
    fireEvent.click(screen.getByRole("button", { name: "#client" }));
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    fireEvent.click(screen.getByRole("button", { name: /^Shared lists/ }));
    fireEvent.keyDown(screen.getByRole("region", { name: "Todos" }), { key: "c" });
    fireEvent.keyDown(screen.getByRole("region", { name: "Todos" }), { key: "c" });

    for (const write of Object.values(writes)) expect(write).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
  });
});
