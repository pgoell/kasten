import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { TodoHit } from "@/lib/core/api";
import { useTodoActions } from "@/lib/todo/use-todo-actions";

const { cycleTodoInVault, toggleTimerInVault } = vi.hoisted(() => ({
  cycleTodoInVault: vi.fn(),
  toggleTimerInVault: vi.fn(),
}));
vi.mock("@/lib/todo/todo-api", () => ({
  agentTodoIn: vi.fn(),
  cycleTodoAside: vi.fn(),
  cycleTodoInVault,
  toggleTimerInVault,
}));

const ALPHA: TodoHit = { path: "a.md", line: 2, text: "- [/] alpha", project: null, shared: false };
const BRAVO: TodoHit = { path: "a.md", line: 3, text: "- [ ] bravo", project: null, shared: false };

/** The hook over a client whose list holds two rows, and a way to land each press by hand. */
function mount() {
  const client = new QueryClient();
  client.setQueryData(["todos", false], [ALPHA, BRAVO]);
  const landings: (() => void)[] = [];
  const held = () => new Promise<void>((resolve) => landings.push(() => resolve()));
  cycleTodoInVault.mockImplementation(held);
  toggleTimerInVault.mockImplementation(held);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(
    () =>
      useTodoActions({
        data: ["a.md"],
        archive: false,
        write: async (_note, work) => work(),
        focusedNote: { current: { path: undefined, isWriting: () => false } },
        setNotice: () => {},
      }),
    { wrapper },
  );
  const rows = () => client.getQueryData<TodoHit[]>(["todos", false]) ?? [];
  const stale = () => client.getQueryState(["todos", false])?.isInvalidated;
  const land = async (index: number) => {
    await act(async () => landings[index]?.());
  };
  return { press: result.current.cycleTodo, timer: result.current.toggleTimer, rows, stale, land };
}

describe("a press on the todo list", () => {
  beforeEach(() => {
    cycleTodoInVault.mockReset();
  });

  it("draws the new state on the row before the vault has the write", async () => {
    const pane = mount();

    await act(async () => pane.press(ALPHA));

    const [alpha] = pane.rows();
    expect(alpha?.text).toMatch(/^- \[x\] alpha/);
    // The id drawn is the one the write stamps, so the answer redraws nothing.
    const id = cycleTodoInVault.mock.calls[0]?.[5];
    expect(alpha?.text).toContain(id);
    expect(pane.stale()).toBe(false);
  });

  it("asks for the list once the last of two presses lands", async () => {
    const pane = mount();

    await act(async () => {
      pane.press(ALPHA);
      pane.press(BRAVO, "doing");
    });
    expect(pane.rows().map((row) => row.text.slice(0, 5))).toEqual(["- [x]", "- [/]"]);

    await pane.land(0);
    expect(pane.stale()).toBe(false);
    await pane.land(1);
    expect(pane.stale()).toBe(true);
  });

  it("waits for a press of x when a press of t on another row lands first", async () => {
    const pane = mount();

    await act(async () => {
      pane.press(ALPHA);
      pane.timer(BRAVO);
    });

    await pane.land(1);
    expect(pane.stale()).toBe(false);
    await pane.land(0);
    expect(pane.stale()).toBe(true);
  });
});
