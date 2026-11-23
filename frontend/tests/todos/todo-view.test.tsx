import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
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

  it("reads the list again after a stale version and sends the change once more", async () => {
    renderView();
    fireEvent.click(await screen.findByText("write the parser tests"));
    store = store.map((each) => (each.id === "kt-000001" ? { ...each, version: 7 } : each));
    api.patchTodo.mockRejectedValueOnce(new Error("that todo changed since it was read"));
    fireEvent.change(screen.getByRole("combobox", { name: "Priority" }), {
      target: { value: "high" },
    });
    await act(() => vi.advanceTimersByTimeAsync(50));
    expect(api.patchTodo.mock.calls.map(([, change]) => change)).toEqual([
      { priority: "high", version: 3 },
      { priority: "high", version: 7 },
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

  it("opens the todo Enter added, once the list holds it", async () => {
    renderView();
    const pane = await screen.findByRole("region", { name: "Todos" });
    await screen.findByText("write the parser tests");
    post.mockImplementationOnce(async () => {
      store = [...store, row("kt-000003", "call the landlord")];
      const slow = hits(store);
      api.fetchTodos.mockImplementationOnce(
        () => new Promise((done) => setTimeout(done, 300, slow)),
      );
      return { data: row("kt-000003", "call the landlord"), response: new Response() };
    });
    fireEvent.keyDown(pane, { key: "a" });
    const words = screen.getByRole("textbox", { name: "Words" });
    fireEvent.change(words, { target: { value: "call the landlord" } });
    fireEvent.keyDown(words, { key: "Enter" });
    await act(() => vi.advanceTimersByTimeAsync(50));
    // Until the slow refetch lands, the new todo's panel stays rather than vanishing.
    expect(screen.getByRole("textbox", { name: "Words" })).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(screen.getByRole("textbox", { name: "Words" })).toHaveValue("call the landlord");
    expect(screen.getByRole("textbox", { name: "Description" })).toBeInTheDocument();
  });

  it("leaves Enter on a focused button to the button", async () => {
    renderView();
    fireEvent.click(await screen.findByText("write the parser tests"));
    const close = screen.getByRole("button", { name: "Close" });
    expect(fireEvent.keyDown(close, { key: "Enter" })).toBe(true);
    expect(fireEvent.keyDown(close, { key: " " })).toBe(true);
  });
});
