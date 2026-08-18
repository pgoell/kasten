import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TodoPane } from "@/components/todo-pane";
import type { EditorCommands } from "@/lib/key-bindings";
import { PRIORITY_SYMBOL } from "@/lib/todo";
import { DEFAULT_VIEWS, VIEWS_NOTE } from "@/lib/todo-view";

// Standing in for the module rather than for `fetch`, the way the search
// panel's tests do: what the pane owns is what it asks the vault for, not the
// HTTP underneath.
const { fetchTodos, fetchNote, fetchFiles, createNote } = vi.hoisted(() => ({
  fetchTodos: vi.fn(),
  fetchNote: vi.fn(),
  fetchFiles: vi.fn(),
  createNote: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ fetchTodos, fetchNote, fetchFiles, createNote }));

// A vault that already holds the views note, which is what every test below
// but the ones about `v` reads.
beforeEach(() => {
  fetchNote.mockReset();
  fetchFiles.mockReset();
  createNote.mockReset();
  fetchNote.mockResolvedValue(DEFAULT_VIEWS);
  fetchFiles.mockResolvedValue([VIEWS_NOTE]);
  createNote.mockResolvedValue({ path: VIEWS_NOTE, content: DEFAULT_VIEWS });
});

/** The day every test below is written against, so no assertion expires. */
const TODAY = "2026-08-10";

const TODOS = [
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

function renderPane(hits = TODOS, focusSignal = 0) {
  fetchTodos.mockResolvedValue(hits);
  const onOpen = vi.fn();
  const onCycle = vi.fn();
  const onAdd = vi.fn();
  const onSubtask = vi.fn();
  const onEdit = vi.fn();
  const onTimer = vi.fn();
  const { reached, commands } = recorder();
  const client = new QueryClient();

  render(
    <QueryClientProvider client={client}>
      <TodoPane
        commands={commands}
        onOpen={onOpen}
        onCycle={onCycle}
        onAdd={onAdd}
        onSubtask={onSubtask}
        onEdit={onEdit}
        onTimer={onTimer}
        focusSignal={focusSignal}
        today={TODAY}
      />
    </QueryClientProvider>,
  );

  const panel = () => screen.getByRole("region", { name: "Todos" });

  return {
    onOpen,
    onCycle,
    onAdd,
    onSubtask,
    onEdit,
    onTimer,
    reached,
    /** What the vault answers with next, which is how a write reaches the pane. */
    answer: (next: typeof TODOS) => act(() => client.setQueryData(["todos", false], next)),
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
    rows: () => screen.queryAllByRole("button"),
    texts: () => screen.queryAllByRole("button").map((row) => row.textContent ?? ""),
    /** The row the keyboard cursor is on, which is the pane's only tab stop. */
    cursor: () => screen.queryAllByRole("button").find((row) => row.tabIndex === 0),
    footer: () => screen.getByTestId("todo-footer").textContent ?? "",
    press: (key: string) => fireEvent.keyDown(panel(), { key }),
    type: (value: string) =>
      fireEvent.change(screen.getByLabelText("filter todos"), { target: { value } }),
  };
}

describe("the todo pane", () => {
  it("keeps a todo off the list until the day it starts", async () => {
    const pane = renderPane([
      { path: "a.md", line: 1, text: "- [ ] buy milk 📅 2026-08-14 🛫 2026-08-11" },
      { path: "a.md", line: 2, text: "- [ ] call the dentist 📅 2026-08-14" },
    ]);

    await waitFor(() => expect(pane.rows()).toHaveLength(1));
    expect(pane.texts().join()).not.toContain("buy milk");
  });

  it("shows one whose start date has arrived", async () => {
    const pane = renderPane([
      { path: "a.md", line: 1, text: "- [ ] buy milk 📅 2026-08-14 🛫 2026-08-10" },
    ]);

    await waitFor(() => expect(pane.rows()).toHaveLength(1));
    expect(pane.texts()[0]).toContain("buy milk");
  });

  it("counts a parent's parts on its row, and counts nothing on a row with none", async () => {
    // The closed parts are off the list themselves, so the count is read off
    // every todo the note holds rather than off the rows on screen.
    const pane = renderPane([
      { path: "a.md", line: 1, text: "- [/] wire up the pane 📅 2026-08-10" },
      { path: "a.md", line: 2, text: "  - [x] read the spec ✅ 2026-08-10" },
      { path: "a.md", line: 3, text: "  - [-] argue about it" },
      { path: "a.md", line: 4, text: "  - [ ] write it" },
    ]);

    await waitFor(() => expect(pane.rows()).toHaveLength(2));
    expect(pane.texts()[0]).toContain("2/3");
    expect(pane.texts()[1]).not.toContain("/");
  });

  /**
   * One note whose tree straddles two groups, which is what the nesting reads.
   *
   * `check list` carries a date of its own: a part that spells none takes its
   * parent's and lands in the group beside it, which straddles nothing.
   */
  const NESTED_ROWS = [
    { path: "a.md", line: 1, text: "- [/] finish todo story" },
    { path: "a.md", line: 2, text: "  - [ ] phase2" },
    { path: "a.md", line: 3, text: "    - [ ] phase2a" },
    { path: "a.md", line: 4, text: "- [/] safari preparation 📅 2026-08-10" },
    { path: "a.md", line: 5, text: "  - [ ] check list 📅 2026-08-14" },
  ];

  it("draws a part indented under the todo it belongs to", async () => {
    const pane = renderPane(NESTED_ROWS);
    await waitFor(() => expect(pane.rows()).toHaveLength(5));

    // Today holds safari preparation and This week holds check list; the rest
    // are under No date, in note order.
    const [, , root, part, deeper] = pane.rows() as HTMLElement[];
    expect(root?.textContent).toContain("finish todo story");
    expect(part?.textContent).toContain("phase2");
    expect(deeper?.textContent).toContain("phase2a");

    const indent = (row: HTMLElement | undefined) =>
      Number.parseFloat(row?.style.paddingLeft ?? "0");
    expect(indent(part)).toBeGreaterThan(indent(root));
    expect(indent(deeper)).toBeGreaterThan(indent(part));
  });

  it("names the parent of a part whose parent is in another group", async () => {
    const pane = renderPane(NESTED_ROWS);
    await waitFor(() => expect(pane.rows()).toHaveLength(5));

    // `check list` hangs off `safari preparation`, which is due today, and its
    // own date puts it a group further out. An indent there would be a lie.
    const rows = pane.rows() as HTMLElement[];
    const orphan = rows.find((row) => row.textContent?.includes("check list"));
    expect(orphan?.textContent).toContain("safari preparation");
    expect(orphan?.style.paddingLeft).toBe(rows[0]?.style.paddingLeft);
  });

  it("draws a part carrying no date of its own with what the todo above it has", async () => {
    const pane = renderPane([
      { path: "a.md", line: 1, text: "- [/] safari preparation 📅 2026-08-10 ⏫" },
      { path: "a.md", line: 2, text: "  - [ ] check list" },
      { path: "a.md", line: 3, text: "- [ ] buy milk" },
    ]);

    await waitFor(() => expect(pane.rows()).toHaveLength(3));

    // The part is due when what it is a part of is due, so it sits in that
    // group rather than under No date with the todo that spells nothing.
    expect(pane.headings()).toEqual(["Today", "No date"]);
    expect(pane.texts()[1]).toContain("check list");
    expect(pane.texts()[1]).toContain("08-10");
    expect(pane.texts()[1]).toContain(PRIORITY_SYMBOL.high);
    expect(pane.texts()[2]).toContain("buy milk");
  });

  it("holds a part back behind the start date the todo above it carries", async () => {
    const pane = renderPane([
      { path: "a.md", line: 1, text: "- [/] safari preparation 🛫 2026-08-11" },
      { path: "a.md", line: 2, text: "  - [ ] check list" },
      { path: "a.md", line: 3, text: "- [ ] buy milk" },
    ]);

    await waitFor(() => expect(pane.rows()).toHaveLength(1));
    expect(pane.texts().join()).toContain("buy milk");
  });

  /** Two notes, one holding a small tree and one holding a todo on its own. */
  const NESTED = [
    { path: "a.md", line: 1, text: "- [/] wire up the pane 📅 2026-08-10" },
    { path: "a.md", line: 2, text: "  - [x] read the spec ✅ 2026-08-10" },
    { path: "a.md", line: 3, text: "  - [ ] write it" },
    { path: "a.md", line: 4, text: "    - [ ] draft it" },
    { path: "b.md", line: 7, text: "- [ ] buy milk 📅 2026-08-14" },
  ];

  it("shows one next action per top level todo on n", async () => {
    const pane = renderPane(NESTED);
    await waitFor(() => expect(pane.rows()).toHaveLength(4));

    pane.press("n");

    // One row per open root: the tree in `a.md` and the lone todo in `b.md`.
    // The tree's row names the grandchild, that being the first open leaf.
    await waitFor(() => expect(pane.rows()).toHaveLength(2));
    const drafting = pane.texts().find((text) => text.includes("draft it")) ?? "";
    expect(drafting).toContain("wire up the pane");
    expect(pane.texts().join()).toContain("buy milk");
  });

  it("opens the next action's own line rather than the root's", async () => {
    const pane = renderPane(NESTED);
    await waitFor(() => expect(pane.rows()).toHaveLength(4));

    pane.press("n");
    await waitFor(() => expect(pane.rows()).toHaveLength(2));
    // `draft it` takes the root's due date, so its row heads the list, above
    // `buy milk` in This week.
    pane.press("Enter");

    expect(pane.onOpen).toHaveBeenCalledWith("a.md", 4);
  });

  it("swaps the done list for the next actions rather than showing both", async () => {
    const pane = renderPane(NESTED);
    await waitFor(() => expect(pane.rows()).toHaveLength(4));

    pane.press("d");
    await waitFor(() => expect(pane.rows()).toHaveLength(1));
    pane.press("n");

    await waitFor(() => expect(pane.rows()).toHaveLength(2));
    expect(pane.texts().join()).not.toContain("read the spec");
  });

  it("puts the full list back on a second n", async () => {
    const pane = renderPane(NESTED);
    await waitFor(() => expect(pane.rows()).toHaveLength(4));

    pane.press("n");
    await waitFor(() => expect(pane.rows()).toHaveLength(2));
    pane.press("n");

    await waitFor(() => expect(pane.rows()).toHaveLength(4));
  });

  it("draws a scheduled todo under the day it is scheduled for", async () => {
    const pane = renderPane([
      { path: "a.md", line: 1, text: "- [ ] buy milk 📅 2026-08-14 ⏳ 2026-08-10" },
    ]);

    await waitFor(() => expect(pane.rows()).toHaveLength(1));
    expect(pane.headings()).toEqual(["Today"]);
  });

  it("draws one heading per section that has rows, in order", async () => {
    const pane = renderPane();

    await waitFor(() => expect(pane.rows().length).toBeGreaterThan(0));
    expect(pane.headings()).toEqual(["Overdue", "Today", "This week", "Later", "No date"]);
  });

  it("draws no heading for a section with nothing in it", async () => {
    const pane = renderPane([
      { path: "a.md", line: 1, text: "- [ ] call the dentist 📅 2026-08-07" },
      { path: "a.md", line: 2, text: "- [ ] waiting on the API" },
    ]);

    await waitFor(() => expect(pane.rows()).toHaveLength(2));
    expect(pane.headings()).toEqual(["Overdue", "No date"]);
  });

  it("leaves out what is finished and what was never a todo", async () => {
    const pane = renderPane();

    await waitFor(() => expect(pane.rows()).toHaveLength(6));
    expect(pane.texts().join()).not.toContain("read the spec");
    expect(pane.texts().join()).not.toContain("09:12");
  });

  it("puts the important work first inside a group, parts staying under it", async () => {
    const pane = renderPane([
      { path: "a.md", line: 1, text: "- [ ] buy milk 📅 2026-08-10 🔽" },
      { path: "a.md", line: 2, text: "- [ ] file the tax 📅 2026-08-10" },
      { path: "a.md", line: 3, text: "- [ ] call the dentist 📅 2026-08-10 🔺" },
      { path: "a.md", line: 4, text: "  - [ ] find the number 📅 2026-08-10 ⏬" },
    ]);

    await waitFor(() => expect(pane.rows()).toHaveLength(4));
    // No priority sits between medium and low, so the tax beats the milk. The
    // part travels with the dentist however low it is.
    const [first, second, third, fourth] = pane.texts();
    expect(first).toContain("call the dentist");
    expect(second).toContain("find the number");
    expect(third).toContain("file the tax");
    expect(fourth).toContain("buy milk");
  });

  it("draws the priority a row carries, and nothing where it carries none", async () => {
    const pane = renderPane();

    await waitFor(() => expect(pane.rows()).toHaveLength(6));
    // Two glyphs on the row and one on the list: `⏫` beside the dentist, and
    // nothing at all beside the one waiting on the API.
    expect((pane.rows()[0] as HTMLElement).textContent).toContain("⏫");
    const none = pane.texts().find((text) => text.includes("waiting on the API")) ?? "";
    expect(Object.values(PRIORITY_SYMBOL).some((glyph) => none.includes(glyph))).toBe(false);
  });

  it("draws the year on a date outside this one, and drops it on a date in it", async () => {
    // `Later` reaches years out, so `01-01` on two rows says nothing about
    // which is sooner. The year earns its place exactly when it differs.
    const pane = renderPane([
      { path: "a.md", line: 1, text: "- [ ] buy milk 📅 2026-08-14" },
      { path: "a.md", line: 2, text: "- [ ] renew the passport 📅 2027-03-01" },
    ]);

    await waitFor(() => expect(pane.rows()).toHaveLength(2));
    expect(pane.texts()[0]).toContain("08-14");
    expect(pane.texts()[0]).not.toContain("2026-08-14");
    expect(pane.texts()[1]).toContain("2027-03-01");
  });

  it("draws a blocked todo muted, in the section its due date names", async () => {
    const pane = renderPane();

    await waitFor(() => expect(pane.rows()).toHaveLength(6));
    // Third row: overdue holds one, and today holds the doing one before it.
    const blocked = pane.rows()[2] as HTMLElement;
    expect(blocked.textContent).toContain("ship it");
    expect(blocked.className).toContain("text-one-muted");
  });

  it("moves the cursor down on j and up on k", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));
    expect(pane.cursor()?.textContent).toContain("call the dentist");

    pane.press("j");
    expect(pane.cursor()?.textContent).toContain("wire up the pane");

    pane.press("k");
    expect(pane.cursor()?.textContent).toContain("call the dentist");
  });

  it("opens the note the todo is on with enter", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("j");
    pane.press("Enter");

    expect(pane.onOpen).toHaveBeenCalledWith("projects/kasten.md", 12);
  });

  it("takes the focus on the render that opened it", async () => {
    // `<leader>gt` replaces what the pane held, which unmounts the editor and
    // drops the focus on the body. Nothing else can hand it back: this pane's
    // first render is the moment it was moved to, unlike the file tree, which
    // is mounted all along and must not steal the focus from under the editor.
    const pane = renderPane(TODOS, 1);

    await waitFor(() => expect(pane.rows()).toHaveLength(6));
    expect(pane.cursor()).toHaveFocus();
  });

  it("takes the focus back when a write moves the row it was on", async () => {
    // `x` writes, the list is asked again, and the row the cursor was on is
    // gone from it. The browser drops the focus on the body rather than passing
    // it to whatever replaced the row, so without this the pane goes deaf to
    // every key after the first thing you tick off.
    const pane = renderPane(TODOS, 1);
    await waitFor(() => expect(pane.rows()).toHaveLength(6));
    expect(pane.cursor()).toHaveFocus();

    pane.answer(TODOS.filter((hit) => !hit.text.includes("call the dentist")));
    await waitFor(() => expect(pane.rows()).toHaveLength(5));

    // Where the focus is, not whether a key fired at the section works: this
    // test's own `press` dispatches straight at the element and would pass with
    // the focus anywhere at all.
    expect(screen.getByRole("region", { name: "Todos" })).toContainElement(
      document.activeElement as HTMLElement,
    );
  });

  it("moves the focus to the filter line on /", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("/");

    expect(pane.filter()).toHaveFocus();
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

  it("keeps the filter applied once escape hands the list back the focus", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("/");
    pane.type("#kasten");
    await waitFor(() => expect(pane.rows()).toHaveLength(2));

    fireEvent.keyDown(pane.filter(), { key: "Escape" });

    expect(pane.cursor()).toHaveFocus();
    expect(pane.rows()).toHaveLength(2);
    expect(pane.filter().value).toBe("#kasten");
  });

  it("takes the letters of a filter rather than reading them as keys", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("/");
    // `j` and `k` are the list's own keys, and in the input they are letters.
    fireEvent.keyDown(pane.filter(), { key: "j" });

    expect(pane.cursor()?.textContent).toContain("call the dentist");
  });

  it("counts the open and blocked rows in the footer", async () => {
    const pane = renderPane();

    await waitFor(() => expect(pane.rows()).toHaveLength(6));
    expect(pane.footer()).toContain("5 open, 1 blocked");
  });

  it("names only the keys this phase binds", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    expect(pane.footer()).toContain("x cycle");
    expect(pane.footer()).toContain("a add");
    expect(pane.footer()).toContain("s part");
    expect(pane.footer()).toContain("i edit");
    expect(pane.footer()).toContain("d done");
    expect(pane.footer()).toContain("n next");
    expect(pane.footer()).toContain("O P X B R state");
    expect(pane.footer()).toContain("/ filter");
    expect(pane.footer()).toContain("q close");
    expect(pane.footer()).toContain("t timer");
    expect(pane.footer()).toContain("v view");
  });

  it("opens the add prompt on a", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("a");

    // No row and no hit: the todo goes into today's note, wherever the cursor
    // happens to be sitting.
    expect(pane.onAdd).toHaveBeenCalledTimes(1);
  });

  it("opens the same prompt on s, bound to the row under the cursor", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("j");
    pane.press("s");

    // The hit, because the part goes in beside that line rather than into
    // today's note.
    expect(pane.onSubtask).toHaveBeenCalledExactlyOnceWith(TODOS[1]);
    expect(pane.onAdd).not.toHaveBeenCalled();
  });

  it("turns the row under the cursor into its own line on i", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("j");
    pane.press("i");

    // The line as the vault holds it, markdown and all: an edit reaches the
    // fields no shorthand spells by being the line itself.
    expect(pane.draft()).toHaveValue(TODOS[1]?.text);
    expect(pane.draft()).toHaveFocus();
  });

  it("hands the edited line back on enter, and draws a row again", async () => {
    const edited = "- [/] wire up the pane 📅 2026-08-10 ⏳ 2026-08-09 ⏫ #kasten";
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("j");
    pane.press("i");
    pane.write(edited);
    pane.send("Enter");

    // The hit and the line: the write finds the line by path and number, and
    // puts back what the input was left holding.
    expect(pane.onEdit).toHaveBeenCalledExactlyOnceWith(TODOS[1], edited);
    expect(pane.draft()).toBeNull();
  });

  it("writes nothing on escape, and gives the keys back to the row", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    (pane.cursor() as HTMLElement).focus();
    pane.press("i");
    pane.write("- [ ] something else entirely");
    pane.send("Escape");

    expect(pane.onEdit).not.toHaveBeenCalled();
    expect(pane.draft()).toBeNull();
    // The keys are the row's again, so the next one moves the cursor rather
    // than landing in an input that is no longer there.
    expect(pane.cursor()).toHaveFocus();
    pane.press("j");
    pane.press("x");
    expect(pane.onCycle).toHaveBeenCalledWith(TODOS[1]);
  });

  it("keeps the list's keys off the line being edited", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("i");
    // `x` cycles a row and `a` opens the add prompt. In here they are letters.
    fireEvent.keyDown(pane.draft() as HTMLElement, { key: "x" });
    fireEvent.keyDown(pane.draft() as HTMLElement, { key: "a" });

    expect(pane.onCycle).not.toHaveBeenCalled();
    expect(pane.onAdd).not.toHaveBeenCalled();
  });

  it("offers the fields the line has not got, under the line being edited", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("i");

    // The row is overdue and important, so neither the due date nor a priority
    // is a question. Every field a glyph writes and this line has not got is.
    expect(pane.hints()).toEqual([
      "⏳ scheduled",
      "🛫 start",
      "🔁 daily",
      "🔁 weekly",
      "🔁 monthly",
      "⏲ estimate",
    ]);
  });

  it("writes the field a hint names, and offers the days it takes next", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("i");
    pane.take("⏳ scheduled");

    // The marker and the space after it, so the day it takes next stands off it.
    expect(pane.draft()).toHaveValue(`${TODOS[0]?.text} ⏳ `);
    // A marker with no day after it is half a field, so the days are what the
    // same row asks next.
    expect(pane.hints().slice(0, 2)).toEqual(["2026-08-10 today", "2026-08-11 tomorrow"]);

    pane.take("2026-08-11 tomorrow");
    expect(pane.draft()).toHaveValue(`${TODOS[0]?.text} ⏳ 2026-08-11`);
    // And the keys go back to the line, so what a hint wrote can be typed over.
    expect(pane.draft()).toHaveFocus();
  });

  it("keeps the list's keys off a hint", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("i");
    // Tab reaches the hints, and a key pressed on one bubbles to the pane. The
    // list is not what those keys are for while a line is being edited.
    fireEvent.keyDown(screen.getAllByTestId("todo-hint")[0] as HTMLElement, { key: "x" });

    expect(pane.onCycle).not.toHaveBeenCalled();
  });

  it("does nothing on i with no row to press it on", async () => {
    const pane = renderPane([]);
    await waitFor(() => expect(pane.rows()).toHaveLength(0));

    pane.press("i");

    expect(pane.draft()).toBeNull();
  });

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

  it("starts or stops the timer on the row under the cursor on t", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("j");
    pane.press("t");

    expect(pane.onTimer).toHaveBeenCalledWith(TODOS[1]);
  });

  it("does nothing on t with no row to press it on", async () => {
    const pane = renderPane([]);
    await waitFor(() => expect(pane.rows()).toHaveLength(0));

    pane.press("t");

    expect(pane.onTimer).not.toHaveBeenCalled();
  });

  it("keeps the bare x walking the cycle", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("x");

    expect(pane.onCycle).toHaveBeenCalledWith(TODOS[0]);
  });

  it("swaps the list for the last seven days of finished work on d", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("d");

    // Grouped by the day they were finished rather than by when they were due,
    // a finished todo having no due date worth grouping on. Newest day first.
    await waitFor(() => expect(pane.rows()).toHaveLength(2));
    expect(pane.headings()).toEqual(["2026-08-10", "2026-08-08"]);
    expect(pane.texts()[0]).toContain("read the spec");
    expect(pane.texts()[1]).toContain("write the spec");
    // Nine days back is past the window.
    expect(pane.texts().join()).not.toContain("think about it");
  });

  it("puts the open list back on a second d", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("d");
    await waitFor(() => expect(pane.rows()).toHaveLength(2));
    pane.press("d");

    await waitFor(() => expect(pane.rows()).toHaveLength(6));
  });

  it("closes the pane on q", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("q");

    // The route empties the pane rather than removing it, which is one step in
    // from what the same key does on a note.
    expect(pane.reached).toEqual(["closeNote"]);
  });

  it("goes to a tab on the leader and a digit", async () => {
    // The digits live in `TAB_KEYS` rather than in `LEADER`, and reading one
    // table and not the other is how they used to reach a tab from a note and
    // nothing at all from in here.
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press(" ");
    pane.press("3");

    expect(pane.reached).toEqual(["goToTab:2"]);
  });

  it("still resolves a leader sequence from inside the list", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press(" ");
    pane.press("c");
    pane.press("t");

    expect(pane.reached).toEqual(["createTab"]);
  });
  const DAILY = "01 Periodic/00 Daily";

  /** Three todos with a timer going, one without, and the sessions naming them. */
  const RUNNING = [
    { path: "a.md", line: 1, text: "- [/] wire up the pane 📅 2026-08-10 🆔 kt-000001" },
    { path: "a.md", line: 2, text: "- [ ] call the dentist 📅 2026-08-10 🆔 kt-000002" },
    { path: "a.md", line: 3, text: "- [ ] buy milk 📅 2026-08-10 🆔 kt-000003" },
    { path: "a.md", line: 4, text: "- [ ] read the spec 📅 2026-08-10" },
    {
      path: `${DAILY}/2026-08-10.md`,
      line: 9,
      text: "- 09:12-      wire up the pane [[a]] kt-000001",
    },
    {
      path: `${DAILY}/2026-08-10.md`,
      line: 10,
      text: "- 11:00-      call the dentist [[a]] kt-000002",
    },
    { path: `${DAILY}/2026-08-09.md`, line: 9, text: "- 14:03-      buy milk [[a]] kt-000003" },
  ];

  it("marks the rows with a timer going and counts them in the footer", async () => {
    const pane = renderPane(RUNNING);

    // Four rows and not seven: a session line is not a row of its own.
    await waitFor(() => expect(pane.rows()).toHaveLength(4));
    expect(pane.footer()).toContain("3 running");
    expect(pane.texts()[0]).toContain("▶");
    expect(pane.texts()[1]).toContain("▶");
    expect(pane.texts()[3]).not.toContain("▶");
  });

  it("names the day of a session left open on an earlier one", async () => {
    const pane = renderPane(RUNNING);
    await waitFor(() => expect(pane.rows()).toHaveLength(4));

    // A timer nobody stopped yesterday, which is what the day beside the mark
    // is there to say.
    expect(pane.texts()[2]).toContain("▶ 08-09");
    // A session opened today carries no day: only an unstopped one needs it.
    expect(pane.texts()[0]).not.toMatch(/▶ /);
  });

  it("counts nothing running where nothing is", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    expect(pane.footer()).not.toContain("running");
  });

  it("draws the worked total against the estimate", async () => {
    const pane = renderPane([
      { path: "a.md", line: 1, text: "- [/] wire up the pane 📅 2026-08-10 ⏲ 2h ⏱ 1h20m" },
      { path: "a.md", line: 2, text: "- [ ] call the dentist 📅 2026-08-10 ⏱ 1h20m" },
      { path: "a.md", line: 3, text: "- [ ] buy milk 📅 2026-08-10 ⏲ 2h" },
      { path: "a.md", line: 4, text: "- [ ] read the spec 📅 2026-08-10" },
    ]);

    await waitFor(() => expect(pane.rows()).toHaveLength(4));
    expect(pane.texts()[0]).toContain("⏱ 1h20m / 2h");
    expect(pane.texts()[1]).toContain("⏱ 1h20m");
    expect(pane.texts()[1]).not.toContain("/");
    expect(pane.texts()[2]).toContain("⏲ 2h");
    expect(pane.texts()[3]).not.toMatch(/[⏱⏲]/);
  });

  it("puts the first view's terms in the filter line on v", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("v");

    await waitFor(() => expect(pane.view()).toBe("today"));
    expect(fetchNote).toHaveBeenCalledWith("99 Misc/01 Config/todo-views.md");
    expect(pane.filter().value).toBe("due:today");
    // The two due today, and neither of the four that are not.
    expect(pane.rows()).toHaveLength(2);
    expect(pane.texts().join()).toContain("wire up the pane");
    expect(pane.texts().join()).not.toContain("call the dentist");
  });

  it("walks to the next view on a second v", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("v");
    pane.press("v");

    await waitFor(() => expect(pane.view()).toBe("doing"));
    expect(pane.filter().value).toBe("/doing");
    expect(pane.rows()).toHaveLength(1);
  });

  it("gives the whole list back one press past the last view", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    // One press per view the defaults hold, which lands on the last of them.
    pane.press("v");
    pane.press("v");
    pane.press("v");
    await waitFor(() => expect(pane.view()).toBe("important"));
    pane.press("v");

    await waitFor(() => expect(pane.rows()).toHaveLength(6));
    expect(pane.view()).toBe("");
    expect(pane.filter().value).toBe("");
  });

  it("takes the name out of the header when the line is typed into", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("v");
    await waitFor(() => expect(pane.view()).toBe("today"));
    pane.type("#kasten");

    await waitFor(() => expect(pane.view()).toBe(""));
    expect(pane.filter().value).toBe("#kasten");
  });

  it("says so and narrows nothing where the vault answers with no views", async () => {
    fetchNote.mockRejectedValueOnce(new Error("GET /api/files/… failed with 404"));
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("v");

    await waitFor(() => expect(pane.view()).toBe("no views"));
    expect(pane.rows()).toHaveLength(6);
  });

  it("writes the views note on the first v in a vault with none", async () => {
    fetchFiles.mockResolvedValue(["projects/kasten.md"]);
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("v");

    await waitFor(() => expect(pane.view()).toBe("today"));
    expect(createNote).toHaveBeenCalledWith("99 Misc/01 Config/todo-views.md", DEFAULT_VIEWS);
    expect(pane.filter().value).toBe("due:today");
    expect(pane.rows()).toHaveLength(2);
  });

  it("sends one create however fast the second v comes", async () => {
    fetchFiles.mockResolvedValue(["projects/kasten.md"]);
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("v");
    pane.press("v");

    await waitFor(() => expect(pane.view()).toBe("doing"));
    expect(createNote).toHaveBeenCalledTimes(1);
  });

  it("writes nothing where the vault already holds the note", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("v");

    await waitFor(() => expect(pane.view()).toBe("today"));
    expect(createNote).not.toHaveBeenCalled();
  });

  it("says so where the vault refuses the create", async () => {
    fetchFiles.mockResolvedValue(["projects/kasten.md"]);
    createNote.mockRejectedValueOnce(new Error("POST /api/files/… failed with 500"));
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("v");

    await waitFor(() => expect(pane.view()).toBe("no views"));
    expect(pane.rows()).toHaveLength(6);
  });

  it("says so for a note holding no line it can read", async () => {
    fetchNote.mockResolvedValue("# Todo views\n\nNone written yet.\n");
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("v");

    await waitFor(() => expect(pane.view()).toBe("no views"));
    expect(pane.rows()).toHaveLength(6);
  });
});
