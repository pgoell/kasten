import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Profiler } from "react";
import { TodoPane } from "@/components/todo-pane";
import { createNote, fetchFiles, fetchNote, fetchTodos } from "@/lib/api";
import type { EditorCommands } from "@/lib/key-bindings";
import { DEFAULT_VIEWS, VIEWS_NOTE } from "@/lib/todo/todo-view";

/**
 * The setup every todo-pane test file shares.
 *
 * Standing in for the module rather than for `fetch`, the way the search
 * panel's tests do: what the pane owns is what it asks the vault for, not the
 * HTTP underneath.
 *
 * Each file keeps its own doubles block, because `vi.mock` hoists only in the
 * file it sits in. Each file then calls `paneHooks()` at top level, after that
 * block, so the hooks reach the same fakes the file's tests do.
 */

/** The day every test below is written against, so no assertion expires. */
const TODAY = "2026-08-10";

export const TODOS = [
  { path: "projects/kasten.md", line: 3, text: "- [ ] call the dentist 📅 2026-08-07 ⏫ #health" },
  { path: "projects/kasten.md", line: 12, text: "- [/] wire up the pane 📅 2026-08-10 ⏫ #kasten" },
  { path: "projects/kasten.md", line: 13, text: "- [b] ship it 📅 2026-08-10 #kasten" },
  { path: "projects/kasten.md", line: 20, text: "- [ ] buy milk 📅 2026-08-14 🔽" },
  { path: "projects/kasten.md", line: 21, text: "- [ ] renew the passport 📅 2026-09-01" },
  { path: "projects/kasten.md", line: 30, text: "- [ ] waiting on the API" },
  // None of these is work to do: three are finished and one is a `## Time`
  // line, which the endpoint carries back for phase 3.
  { path: "projects/kasten.md", line: 31, text: "- [x] read the spec ✅ 2026-08-10 🆔 kt-000001" },
  { path: "projects/kasten.md", line: 32, text: "- [x] write the spec ✅ 2026-08-08 🆔 kt-000002" },
  { path: "projects/kasten.md", line: 33, text: "- [x] think about it ✅ 2026-08-01 🆔 kt-000003" },
  { path: "daily/2026-08-10.md", line: 5, text: "- 09:12-10:32 wire up the pane" },
];

/** #541: one id on two todos, the done twin listed last, and a todo waiting on it. */
export const TWINS = [
  { path: "a.md", line: 1, text: "- [ ] ship the release 🆔 kt-aaaaaa" },
  { path: "a.md", line: 2, text: "- [x] cut the branch 🆔 kt-aaaaaa" },
  { path: "a.md", line: 3, text: "- [b] write the docs ⛔ kt-aaaaaa" },
];

/** #544: the issue's note, one id on two todos that are both closed. */
export const CLOSED_TWINS = [
  { path: "a.md", line: 1, text: "- [x] a 🆔 kt-aaaaaa" },
  { path: "a.md", line: 2, text: "- [-] a 🆔 kt-aaaaaa" },
  { path: "a.md", line: 3, text: "- [b] c ⛔ kt-aaaaaa" },
];

/**
 * Every command, recording which one was reached.
 *
 * A proxy rather than an object with a member per command: the pane runs
 * whatever a leader sequence resolves to, so the stub has to answer to the
 * whole of `EditorCommands`, and writing thirty stubs out here is thirty lines
 * to keep in step with an interface this test says nothing about.
 */
function recorder() {
  const reached: string[] = [];
  const commands = new Proxy({} as EditorCommands, {
    // The argument comes with the name where there is one, which only
    // `goToTab` carries: which tab it went to is the whole of what it does.
    get:
      (_target, name: string) =>
      (...args: unknown[]) =>
        reached.push(args.length === 0 ? name : `${name}:${args[0]}`),
  });
  return { reached, commands };
}

/** The strip above the list as a mouse sees it, drawn on every pointer since #419. */
const STRIP = ["d done", "n next", "v view", "c board"];

/**
 * Every button but that strip, the scope chips and toggle (#811), and the Done
 * this week fold, which is a row's heading and not a row: the list drew none of
 * them before they had buttons.
 */
function buttons() {
  return (
    screen
      .queryAllByRole("button")
      .filter((button) => !STRIP.includes(button.textContent ?? ""))
      .filter((button) => button.closest("[data-todo-scope]") === null)
      // The fold's text opens with its chevron, so this reads the words, not the start.
      .filter((button) => !(button.textContent ?? "").includes("Done this week"))
  );
}

/**
 * `hits` may be a fetch still pending, and `onCommit` runs on each commit the
 * pane makes, for a test that counts the commits an answer brings.
 */
export function renderPane(
  hits: typeof TODOS | Promise<typeof TODOS> = TODOS,
  focusSignal = 0,
  onCommit = () => {},
) {
  // The rows carry no `project`, as on main, where the fake was an untyped vi.fn.
  (fetchTodos as ReturnType<typeof vi.fn>).mockReturnValue(Promise.resolve(hits));
  const onOpen = vi.fn();
  const onCycle = vi.fn();
  const onAdd = vi.fn();
  const onSubtask = vi.fn();
  const onEdit = vi.fn();
  const onBlock = vi.fn();
  const onTimer = vi.fn();
  const onRefile = vi.fn();
  const { reached, commands } = recorder();
  const client = new QueryClient();

  render(
    <QueryClientProvider client={client}>
      <Profiler id="pane" onRender={onCommit}>
        <TodoPane
          commands={commands}
          onOpen={onOpen}
          onCycle={onCycle}
          onAdd={onAdd}
          onSubtask={onSubtask}
          onEdit={onEdit}
          onBlock={onBlock}
          onTimer={onTimer}
          onAgent={vi.fn()}
          onRefile={onRefile}
          onNotice={() => {}}
          focusSignal={focusSignal}
          today={TODAY}
        />
      </Profiler>
    </QueryClientProvider>,
  );

  const panel = () => screen.getByRole("region", { name: "Todos" });

  return {
    onOpen,
    onCycle,
    onAdd,
    onSubtask,
    onEdit,
    onBlock,
    onTimer,
    onRefile,
    reached,
    /** What the pane says it is picking a blocker for, or nothing outside the picker. */
    picking: () => screen.queryByTestId("todo-pick")?.textContent ?? "",
    /** What the vault answers with next, which is how a write reaches the pane. */
    answer: (next: typeof TODOS) => act(() => client.setQueryData(["todos", false], next)),
    /**
     * Once the vault's todos have reached the pane: the query settled, then
     * react-query's hand-off to its observers, which it puts on a timeout of 0
     * when the fetch settles, so one more timeout of 0 lands after it. Waits on
     * that state rather than on `waitFor`'s second, which a busy host outruns.
     */
    loaded: () =>
      act(async () => {
        await client.ensureQueryData({
          queryKey: ["todos", false],
          queryFn: () => vi.mocked(fetchTodos)(false),
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }),
    filter: () => screen.getByLabelText("filter todos") as HTMLInputElement,
    /** The row being edited, as the input it turns into, or null where none is. */
    draft: () => screen.queryByLabelText("edit line"),
    /** Type over the line being edited. */
    write: (value: string) =>
      fireEvent.change(screen.getByLabelText("edit line"), { target: { value } }),
    /** A key pressed inside that input, which the list's own keys never see. */
    send: (key: string) => fireEvent.keyDown(screen.getByLabelText("edit line"), { key }),
    /** The fields offered under the line being edited, as they are drawn. */
    hints: () => screen.queryAllByTestId("todo-hint").map((chip) => chip.textContent ?? ""),
    /** Take one of them, the way a click does. */
    take: (label: string) =>
      fireEvent.click(
        screen
          .getAllByTestId("todo-hint")
          .find((chip) => chip.textContent === label) as HTMLElement,
      ),
    /** What the header says the list is showing: a view's name, or nothing. */
    view: () => screen.queryByTestId("todo-view")?.textContent ?? "",
    headings: () => screen.queryAllByRole("heading").map((row) => row.textContent),
    rows: () => buttons(),
    texts: () => buttons().map((row) => row.textContent ?? ""),
    /** The row the keyboard cursor is on, which is the pane's only tab stop. */
    cursor: () => buttons().find((row) => row.tabIndex === 0),
    footer: () => screen.getByTestId("todo-footer").textContent ?? "",
    press: (key: string) => fireEvent.keyDown(panel(), { key }),
    type: (value: string) =>
      fireEvent.change(screen.getByLabelText("filter todos"), { target: { value } }),
  };
}

/**
 * A key pressed on the focused element, with the press a browser makes when the
 * key is not taken: Enter clicks a button on the key down, Space on the key up.
 * jsdom makes neither press, so a test of a button's own press needs them here.
 */
export function pressFocused(key: string) {
  const target = document.activeElement as HTMLElement;
  if (!fireEvent.keyDown(target, { key })) return;
  if (key === " " && !fireEvent.keyUp(target, { key })) return;
  fireEvent.click(target);
}

export function paneHooks() {
  // A vault that already holds the views note, which is what every test below
  // but the ones about `v` reads.
  beforeEach(() => {
    vi.mocked(fetchNote).mockReset();
    vi.mocked(fetchFiles).mockReset();
    vi.mocked(createNote).mockReset();
    vi.mocked(fetchNote).mockResolvedValue(DEFAULT_VIEWS);
    vi.mocked(fetchFiles).mockResolvedValue([VIEWS_NOTE]);
    vi.mocked(createNote).mockResolvedValue({ path: VIEWS_NOTE, content: DEFAULT_VIEWS });
  });
}
