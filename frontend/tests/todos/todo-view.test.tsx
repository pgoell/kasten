import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { TodoView } from "@/components/todo/view/todo-view";
import type { TodoHit, TodoRow } from "@/lib/core/api";
import { stubCommands } from "../stub-commands";
import { row, TODAY } from "./rows";

const api = vi.hoisted(() => ({
  fetchTodos: vi.fn(),
  fetchFiles: vi.fn(),
  patchTodo: vi.fn(),
  setTodoState: vi.fn(),
  toggleTodoTimer: vi.fn(),
}));
vi.mock("@/lib/core/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/api")>()),
  ...api,
}));
const post = vi.hoisted(() => vi.fn());
vi.mock("@/lib/core/api-client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/core/api-client")>();
  return { ...real, client: { ...real.client, POST: post } };
});

const ROWS = [
  row("kt-000001", "write the parser tests", {
    state: "doing",
    version: 3,
    project: "02 Projects/Kasten",
  }),
  row("kt-000002", "file the report", { planned: TODAY }),
];
const hits = (rows: TodoRow[]): TodoHit[] =>
  rows.map((each, at) => ({
    path: each.note ?? "",
    line: at + 1,
    text: "",
    project: each.project,
    shared: false,
    todo: each,
  }));

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TodoView
        commands={stubCommands()}
        onOpen={vi.fn()}
        onNotice={vi.fn()}
        focusSignal={0}
        today={TODAY}
        board={null}
      />
    </QueryClientProvider>,
  );
}

/** The store as the fakes keep it, so a refetch after a write reads the write. */
let store: TodoRow[] = [];

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  store = [...ROWS];
  api.fetchTodos.mockImplementation(async () => hits(store));
  api.fetchFiles.mockResolvedValue(["02 Projects/Kasten/index.md", "03 Areas/Haus/index.md"]);
  api.patchTodo.mockImplementation(async (id: string, change: { version: number }) => {
    const was = store.find((each) => each.id === id) as TodoRow;
    const now = { ...was, ...change, version: change.version + 1 };
    store = store.map((each) => (each.id === id ? now : each));
    return [now];
  });
  api.setTodoState.mockResolvedValue([]);
  post.mockResolvedValue({ data: row("kt-000003", "call the landlord"), response: new Response() });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("the todo view", () => {
  it("groups today's todos by state", async () => {
    renderView();
    expect(await screen.findByRole("region", { name: "Doing" })).toHaveTextContent(
      "write the parser tests",
    );
    expect(screen.getByRole("region", { name: "Open" })).toHaveTextContent("file the report");
  });

  it("saves what is typed in the panel as one change, at the version the list read", async () => {
    renderView();
    fireEvent.click(await screen.findByText("write the parser tests"));
    fireEvent.change(screen.getByRole("textbox", { name: "Words" }), {
      target: { value: "write the parser tests today" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), {
      target: { value: "start with [[The line reader]]" },
    });
    expect(api.patchTodo).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(api.patchTodo).toHaveBeenCalledExactlyOnceWith("kt-000001", {
      words: "write the parser tests today",
      description: "start with [[The line reader]]",
      version: 3,
    });
    expect(screen.getByRole("region", { name: "Notes" })).toHaveTextContent("The line reader");
  });

  it("sends a second change at the version the first one answered", async () => {
    renderView();
    fireEvent.click(await screen.findByText("write the parser tests"));
    fireEvent.change(screen.getByRole("combobox", { name: "Priority" }), {
      target: { value: "high" },
    });
    await act(() => vi.advanceTimersByTimeAsync(50));
    fireEvent.change(screen.getByRole("combobox", { name: "Priority" }), {
      target: { value: "low" },
    });
    await act(() => vi.advanceTimersByTimeAsync(50));
    expect(api.patchTodo.mock.calls.map(([, change]) => change)).toEqual([
      { priority: "high", version: 3 },
      { priority: "low", version: 4 },
    ]);
  });

  it("ticks the cursor's todo on x and adds a new one from its words on a", async () => {
    renderView();
    const pane = await screen.findByRole("region", { name: "Todos" });
    await screen.findByText("write the parser tests");
    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "x" });
    await act(() => vi.advanceTimersByTimeAsync(50));
    expect(api.setTodoState).toHaveBeenCalledWith("kt-000001", "done");

    fireEvent.keyDown(pane, { key: "a" });
    const words = screen.getByRole("textbox", { name: "Words" });
    fireEvent.change(words, { target: { value: "call the landlord tomorrow p2 #Haus" } });
    fireEvent.keyDown(words, { key: "Enter" });
    await act(() => vi.advanceTimersByTimeAsync(50));
    expect(post).toHaveBeenCalledWith("/api/todos", {
      body: {
        words: "call the landlord",
        planned: "2026-11-23",
        priority: "high",
        project: "03 Areas/Haus",
      },
    });
  });

  it("plans the cursor's todo from the date popover on d, and sets its priority on p", async () => {
    renderView();
    const pane = await screen.findByRole("region", { name: "Todos" });
    await screen.findByText("write the parser tests");
    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "d" });
    const dates = screen.getByRole("dialog", { name: "Dates" });
    fireEvent.change(within(dates).getByRole("textbox", { name: "Type a day" }), {
      target: { value: "wed" },
    });
    fireEvent.keyDown(within(dates).getByRole("textbox", { name: "Type a day" }), { key: "Enter" });
    await act(() => vi.advanceTimersByTimeAsync(50));
    expect(api.patchTodo).toHaveBeenLastCalledWith("kt-000001", {
      planned: "2026-11-25",
      version: 3,
    });
    expect(screen.queryByRole("dialog", { name: "Dates" })).toBeNull();

    fireEvent.keyDown(pane, { key: "p" });
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Priority" }), { key: "1" });
    await act(() => vi.advanceTimersByTimeAsync(50));
    expect(api.patchTodo).toHaveBeenLastCalledWith("kt-000001", {
      priority: "highest",
      version: 4,
    });
  });

  it("sets a hard due date from the panel's Due field, on the popover's Due tab", async () => {
    renderView();
    fireEvent.click(await screen.findByText("file the report"));
    fireEvent.click(screen.getByRole("button", { name: "Due: Set a due date" }));
    const dates = screen.getByRole("dialog", { name: "Dates" });
    expect(within(dates).getByRole("button", { name: "Due", pressed: true })).toBeVisible();
    fireEvent.click(within(dates).getByRole("button", { name: /Fri 27 Nov/ }));
    await act(() => vi.advanceTimersByTimeAsync(50));
    expect(api.patchTodo).toHaveBeenLastCalledWith("kt-000002", {
      due: "2026-11-27",
      due_hard: true,
      version: 1,
    });
  });

  it("lists Upcoming by day under the week strip, a day's + planning the new todo on it", async () => {
    store = [...ROWS, row("kt-000009", "order the lamp", { planned: "2026-11-26", estimate: 30 })];
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Upcoming" }));
    expect(screen.getByRole("button", { name: "Thursday 26, 1 · 30m" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Thursday" })).toHaveTextContent("30 m planned");
    fireEvent.click(screen.getByRole("button", { name: "New todo in Thursday" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Words" }), {
      target: { value: "fit the lamp" },
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Words" }), { key: "Enter" });
    await act(() => vi.advanceTimersByTimeAsync(50));
    expect(post).toHaveBeenLastCalledWith("/api/todos", {
      body: { words: "fit the lamp", planned: "2026-11-26" },
    });
  });

  it("links a note into the description from the picker n opens in the panel", async () => {
    renderView();
    fireEvent.click(await screen.findByText("file the report"));
    await screen.findByRole("button", { name: /Link a note/ });
    fireEvent.keyDown(screen.getByRole("complementary", { name: "Todo" }), { key: "n" });
    const picker = screen.getByRole("dialog", { name: "Link a note" });
    const find = within(picker).getByRole("textbox", { name: "Find a note" });
    fireEvent.change(find, { target: { value: "kasten" } });
    fireEvent.keyDown(find, { key: "Enter" });
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue(
      "[[02 Projects/Kasten/index]]",
    );
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(api.patchTodo).toHaveBeenLastCalledWith("kt-000002", {
      description: "[[02 Projects/Kasten/index]]",
      version: 1,
    });
  });
});
