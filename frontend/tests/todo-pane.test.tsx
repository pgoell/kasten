import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TodoPane } from "@/components/todo-pane";
import type { EditorCommands } from "@/lib/key-bindings";
import { PRIORITY_SYMBOL } from "@/lib/todo";

// Standing in for the module rather than for `fetch`, the way the search
// panel's tests do: what the pane owns is what it asks the vault for, not the
// HTTP underneath.
const { fetchTodos } = vi.hoisted(() => ({ fetchTodos: vi.fn() }));
vi.mock("@/lib/api", () => ({ fetchTodos }));

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
    get: (_target, name: string) => () => reached.push(name),
  });
  return { reached, commands };
}

function renderPane(hits = TODOS, focusSignal = 0) {
  fetchTodos.mockResolvedValue(hits);
  const onOpen = vi.fn();
  const onCycle = vi.fn();
  const onAdd = vi.fn();
  const { reached, commands } = recorder();
  const client = new QueryClient();

  render(
    <QueryClientProvider client={client}>
      <TodoPane
        commands={commands}
        onOpen={onOpen}
        onCycle={onCycle}
        onAdd={onAdd}
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
    reached,
    /** What the vault answers with next, which is how a write reaches the pane. */
    answer: (next: typeof TODOS) => act(() => client.setQueryData(["todos"], next)),
    filter: () => screen.getByLabelText("filter todos") as HTMLInputElement,
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
    expect(pane.footer()).toContain("d done");
    expect(pane.footer()).toContain("/ filter");
    expect(pane.footer()).toContain("q close");
    // `t`, `n` and `v` are later phases. A footer offering a key that does
    // nothing is worse than one that is short.
    expect(pane.footer()).not.toMatch(/\b(next|view|timer)\b/i);
  });

  it("opens the add prompt on a", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("a");

    // No row and no hit: the todo goes into today's note, wherever the cursor
    // happens to be sitting.
    expect(pane.onAdd).toHaveBeenCalledTimes(1);
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

  it("still resolves a leader sequence from inside the list", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press(" ");
    pane.press("c");
    pane.press("t");

    expect(pane.reached).toEqual(["createTab"]);
  });
});
