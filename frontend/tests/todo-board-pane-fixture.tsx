import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TodoPane } from "@/components/todo-pane";
import { createNote, fetchFiles, fetchNote, fetchTodos, type TodoHit } from "@/lib/api";
import type { EditorCommands } from "@/lib/key-bindings";
import { DEFAULT_VIEWS, VIEWS_NOTE } from "@/lib/todo-view";

const TODAY = "2026-08-10";
export const DAILY = "01 Periodic/00 Daily/2026-08-10.md";
export const PLAN = "02 Projects/FDE/plan.md";

const FILES = [VIEWS_NOTE, "02 Projects/FDE/index.md", "02 Projects/Kasten/index.md", PLAN, DAILY];

export function boardHooks() {
  beforeEach(() => {
    vi.mocked(fetchNote).mockReset();
    vi.mocked(fetchFiles).mockReset();
    vi.mocked(createNote).mockReset();
    vi.mocked(fetchNote).mockResolvedValue(DEFAULT_VIEWS);
    vi.mocked(fetchFiles).mockResolvedValue(FILES);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
}

/**
 * One project note and one daily note. By kind: the invoice is client work,
 * the deck and its parts internal, `ship it` private and the rest no kind. By
 * project: the deck's tree by its folder, the invoice by its link, the rest
 * none, as the backend answers. The old rejection is past the board's seven
 * days.
 */
export const BOARD: TodoHit[] = [
  {
    path: PLAN,
    line: 1,
    text: "- [ ] write the deck 📅 2026-08-12 ⏫ #internal",
    project: "02 Projects/FDE",
    shared: false,
  },
  {
    path: PLAN,
    line: 2,
    text: "  - [/] draw the chart",
    project: "02 Projects/FDE",
    shared: false,
  },
  {
    path: PLAN,
    line: 3,
    text: "  - [x] gather numbers ✅ 2026-08-09",
    project: "02 Projects/FDE",
    shared: false,
  },
  {
    path: DAILY,
    line: 4,
    text: "- [ ] send the invoice [[02 Projects/FDE/index|FDE]] #client",
    project: "02 Projects/FDE",
    shared: false,
  },
  {
    path: DAILY,
    line: 5,
    text: "- [b] ship it ⛔ kt-000009 #private",
    project: null,
    shared: false,
  },
  { path: DAILY, line: 6, text: "- [ ] fix the tap 🆔 kt-000009", project: null, shared: false },
  { path: DAILY, line: 7, text: "- [-] old idea ❌ 2026-08-01", project: null, shared: false },
  { path: DAILY, line: 8, text: "- [-] drop the logo ❌ 2026-08-09", project: null, shared: false },
];

export const [DECK, CHART, NUMBERS, INVOICE, , TAP] = BOARD;

/** Every command, recording which one was reached. See the list's tests. */
function recorder() {
  const reached: string[] = [];
  const commands = new Proxy({} as EditorCommands, {
    get:
      (_target, name: string) =>
      (...args: unknown[]) =>
        reached.push(args.length === 0 ? name : `${name}:${args[0]}`),
  });
  return { reached, commands };
}

export function renderPane({ hits = BOARD, focusSignal = 0, archive = false } = {}) {
  vi.mocked(fetchTodos).mockResolvedValue(hits);
  const onOpen = vi.fn();
  const onCycle = vi.fn();
  const onEdit = vi.fn();
  const onRefile = vi.fn();
  const onNotice = vi.fn();
  const { reached, commands } = recorder();
  const client = new QueryClient();

  render(
    <QueryClientProvider client={client}>
      <TodoPane
        commands={commands}
        onOpen={onOpen}
        onCycle={onCycle}
        onAdd={vi.fn()}
        onSubtask={vi.fn()}
        onEdit={onEdit}
        onBlock={vi.fn()}
        onTimer={vi.fn()}
        onAgent={vi.fn()}
        onRefile={onRefile}
        onNotice={onNotice}
        focusSignal={focusSignal}
        today={TODAY}
        archive={archive}
      />
    </QueryClientProvider>,
  );

  const panel = () => screen.getByRole("region", { name: "Todos" });
  const cards = () => screen.queryAllByTestId("todo-card");

  return {
    onOpen,
    onCycle,
    onEdit,
    onRefile,
    onNotice,
    reached,
    cards,
    texts: () => cards().map((card) => card.textContent ?? ""),
    /** The card the keyboard cursor is on. */
    cursor: () => cards().find((card) => card.tabIndex === 0)?.textContent ?? "",
    card: (words: string) =>
      cards().find((card) => card.textContent?.includes(words)) as HTMLElement,
    headings: () => screen.queryAllByRole("heading").map((one) => one.textContent),
    columns: () => screen.queryAllByTestId("todo-column").map((one) => one.textContent),
    choices: () =>
      within(screen.getByTestId("todo-project-pick"))
        .queryAllByRole("button")
        // The choices alone, not the `cancel` a touch screen draws beside them.
        .filter((one) => one.hasAttribute("aria-current"))
        .map((one) => one.textContent),
    filter: () => screen.getByLabelText("filter todos") as HTMLInputElement,
    answer: (next: typeof BOARD) => act(() => client.setQueryData(["todos", archive], next)),
    press: (key: string) => fireEvent.keyDown(panel(), { key }),
  };
}

/** A pane switched to the board, its cards drawn. */
export async function boardPane(options?: Parameters<typeof renderPane>[0]) {
  const pane = renderPane(options);
  // A row rather than any button: the strip is a button before the todos come.
  await waitFor(() => expect(document.querySelector("[data-row]")).not.toBeNull());
  pane.press("c");
  await waitFor(() => expect(pane.cards().length).toBeGreaterThan(0));
  return pane;
}

/** The lane a heading names, as the cards drawn under it. */
export function lane(name: string): string {
  const heading = screen.getAllByRole("heading").find((one) => one.textContent === name);
  return heading?.parentElement?.textContent ?? "";
}
