import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TodoPane } from "@/components/todo-pane";
import type { EditorCommands } from "@/lib/key-bindings";
import { DEFAULT_VIEWS, VIEWS_NOTE } from "@/lib/todo-view";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";

// The module rather than `fetch`, as the list's own tests stand it in.
const { fetchTodos, fetchNote, fetchFiles, createNote } = vi.hoisted(() => ({
  fetchTodos: vi.fn(),
  fetchNote: vi.fn(),
  fetchFiles: vi.fn(),
  createNote: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ fetchTodos, fetchNote, fetchFiles, createNote }));

const TODAY = "2026-08-10";
const DAILY = "01 Periodic/00 Daily/2026-08-10.md";
const PLAN = "02 Projects/FDE/plan.md";

const FILES = [VIEWS_NOTE, "02 Projects/FDE/index.md", "02 Projects/Kasten/index.md", PLAN, DAILY];

beforeEach(() => {
  fetchNote.mockReset();
  fetchFiles.mockReset();
  createNote.mockReset();
  fetchNote.mockResolvedValue(DEFAULT_VIEWS);
  fetchFiles.mockResolvedValue(FILES);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * One project note and one daily note. By kind: the invoice is client work,
 * the deck and its parts internal, `ship it` private and the rest no kind. By
 * project: the deck's tree by its folder, the invoice by its link, the rest
 * none. The old rejection is past the board's seven days.
 */
const BOARD = [
  { path: PLAN, line: 1, text: "- [ ] write the deck 📅 2026-08-12 ⏫ #internal" },
  { path: PLAN, line: 2, text: "  - [/] draw the chart" },
  { path: PLAN, line: 3, text: "  - [x] gather numbers ✅ 2026-08-09" },
  { path: DAILY, line: 4, text: "- [ ] send the invoice [[02 Projects/FDE/index|FDE]] #client" },
  { path: DAILY, line: 5, text: "- [b] ship it ⛔ kt-000009 #private" },
  { path: DAILY, line: 6, text: "- [ ] fix the tap 🆔 kt-000009" },
  { path: DAILY, line: 7, text: "- [-] old idea ❌ 2026-08-01" },
  { path: DAILY, line: 8, text: "- [-] drop the logo ❌ 2026-08-09" },
];

const [DECK, CHART, NUMBERS, INVOICE, , TAP] = BOARD;

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

function renderPane({ hits = BOARD, focusSignal = 0, archive = false } = {}) {
  fetchTodos.mockResolvedValue(hits);
  const onOpen = vi.fn();
  const onCycle = vi.fn();
  const onEdit = vi.fn();
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
async function boardPane(options?: Parameters<typeof renderPane>[0]) {
  const pane = renderPane(options);
  await waitFor(() => expect(screen.queryAllByRole("button").length).toBeGreaterThan(0));
  pane.press("c");
  await waitFor(() => expect(pane.cards().length).toBeGreaterThan(0));
  return pane;
}

/** The lane a heading names, as the cards drawn under it. */
function lane(name: string): string {
  const heading = screen.getAllByRole("heading").find((one) => one.textContent === name);
  return heading?.parentElement?.textContent ?? "";
}

describe("the todo board", () => {
  it("A1 c turns the list into the board and back, and so does board on a touch screen", async () => {
    const pane = renderPane();
    await waitFor(() => expect(screen.queryAllByRole("button").length).toBeGreaterThan(0));
    expect(pane.cards()).toHaveLength(0);

    pane.press("c");
    await waitFor(() => expect(pane.cards().length).toBeGreaterThan(0));
    pane.press("c");
    expect(pane.cards()).toHaveLength(0);
  });

  it("A1 the board button on a touch screen switches to the board and back", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = renderPane();
    const button = await screen.findByRole("button", { name: "board" });

    fireEvent.click(button);
    await waitFor(() => expect(pane.cards().length).toBeGreaterThan(0));
    expect(button.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button);
    expect(pane.cards()).toHaveLength(0);
  });

  it("A2 draws the six columns and leaves out what was finished before the last seven days", async () => {
    const pane = await boardPane();

    expect(pane.columns()).toEqual([
      "Open 3",
      "Doing 1",
      "Waiting 0",
      "Blocked 1",
      "Done 1",
      "Rejected 1",
    ]);
    expect(pane.texts().join()).not.toContain("old idea");
    expect(pane.texts().join()).toContain("drop the logo");
  });

  it("A3 lanes by kind, a part taking its parent's, and g switches to lanes by project", async () => {
    const pane = await boardPane();

    expect(pane.headings()).toEqual(["#client", "#internal", "#private", "No kind"]);
    expect(lane("#internal")).toContain("draw the chart");

    pane.press("g");

    expect(pane.headings()).toEqual(["No project", "FDE"]);
    // The invoice by its link, the chart by its folder.
    expect(lane("FDE")).toContain("send the invoice");
    expect(lane("FDE")).toContain("draw the chart");
    expect(lane("No project")).toContain("fix the tap");

    pane.press("g");
    expect(pane.headings()).toEqual(["#client", "#internal", "#private", "No kind"]);
  });

  it("A5 a card shows priority, due date, parts, what it waits for and the parent", async () => {
    const pane = await boardPane();

    const deck = pane.card("write the deck").textContent;
    expect(deck).toContain("⏫");
    expect(deck).toContain("08-12");
    expect(deck).not.toContain("2026-08-12");
    expect(deck).toContain("1/2");
    expect(pane.card("ship it").textContent).toContain("⛔ fix the tap");
    expect(pane.card("draw the chart").textContent).toContain("↳ write the deck");
  });

  it("A6 X moves the card to done through onCycle, and x cycles it", async () => {
    const pane = await boardPane();
    expect(pane.cursor()).toContain("send the invoice");

    pane.press("X");
    expect(pane.onCycle).toHaveBeenLastCalledWith(INVOICE, "done");
    pane.press("W");
    expect(pane.onCycle).toHaveBeenLastCalledWith(INVOICE, "waiting");
    pane.press("x");
    expect(pane.onCycle).toHaveBeenLastCalledWith(INVOICE);
  });

  it("A7 Enter or a click on a card opens its line", async () => {
    const pane = await boardPane();

    pane.press("Enter");
    expect(pane.onOpen).toHaveBeenCalledWith(DAILY, 4);

    fireEvent.click(pane.card("write the deck"));
    expect(pane.onOpen).toHaveBeenLastCalledWith(PLAN, 1);
  });

  it("A8 p opens the project picker, Enter picks, Escape closes", async () => {
    const pane = await boardPane();
    pane.press("j");
    pane.press("j");
    expect(pane.cursor()).toContain("fix the tap");

    pane.press("p");
    expect(pane.choices()).toEqual(["FDE", "Kasten"]);
    pane.press("Escape");
    expect(screen.queryByTestId("todo-project-pick")).toBeNull();
    expect(pane.onEdit).not.toHaveBeenCalled();

    pane.press("p");
    pane.press("j");
    pane.press("Enter");
    expect(pane.onEdit).toHaveBeenCalledWith(
      TAP,
      expect.stringContaining("fix the tap [[02 Projects/Kasten/index|Kasten]]"),
    );
    expect(screen.queryByTestId("todo-project-pick")).toBeNull();
  });

  it("A8 a click picks, and a card already filed there writes nothing", async () => {
    const pane = await boardPane();

    pane.press("p");
    fireEvent.click(screen.getByRole("button", { name: "FDE" }));

    expect(pane.onEdit).not.toHaveBeenCalled();
    expect(screen.queryByTestId("todo-project-pick")).toBeNull();
  });

  it("A9 h l move between columns and j k between the cards of one, across lanes", async () => {
    // The keys land on the pane, never in CodeMirror, so vim mode is not a
    // setting this test needs to turn.
    const pane = await boardPane();

    pane.press("l");
    expect(pane.cursor()).toContain("draw the chart");
    pane.press("h");
    expect(pane.cursor()).toContain("send the invoice");
    pane.press("j");
    expect(pane.cursor()).toContain("write the deck");
    pane.press("j");
    expect(pane.cursor()).toContain("fix the tap");
    pane.press("j");
    expect(pane.cursor()).toContain("fix the tap");
    pane.press("k");
    expect(pane.cursor()).toContain("write the deck");
  });

  it("A10 a phone shows one column, a tab per column and a strip under each card", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await boardPane();

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Open 3",
      "Doing 1",
      "Waiting 0",
      "Blocked 1",
      "Done 1",
      "Rejected 1",
    ]);
    expect(pane.cards()).toHaveLength(3);

    fireEvent.click(screen.getByRole("tab", { name: "Done 1" }));
    expect(pane.texts()).toEqual([expect.stringContaining("gather numbers")]);

    fireEvent.click(screen.getByLabelText("more for gather numbers"));
    for (const label of ["open", "doing", "done", "blocked", "waiting", "rejected", "project"]) {
      expect(screen.getByLabelText(`${label} gather numbers`)).toBeDefined();
    }
    fireEvent.click(screen.getByLabelText("project gather numbers"));
    expect(pane.choices()).toEqual(["FDE", "Kasten"]);
  });

  it("A11 the filter line and the views narrow the cards", async () => {
    const pane = await boardPane();

    fireEvent.change(pane.filter(), { target: { value: "#client" } });
    expect(pane.texts()).toEqual([expect.stringContaining("send the invoice")]);

    fireEvent.change(pane.filter(), { target: { value: "" } });
    pane.press("v");
    pane.press("v");
    await waitFor(() => expect(pane.filter().value).toBe("/doing"));
    expect(pane.texts()).toEqual([expect.stringContaining("draw the chart")]);
  });

  it("I1 a card moved out of its column leaves the cursor and the focus on one that is there", async () => {
    const pane = await boardPane({ focusSignal: 1 });
    await waitFor(() => expect(document.activeElement?.textContent).toContain("send the invoice"));

    pane.press("X");
    pane.answer(
      BOARD.map((hit) =>
        hit === INVOICE ? { ...hit, text: `${hit.text.replace("[ ]", "[x]")} ✅ 2026-08-10` } : hit,
      ),
    );

    await waitFor(() => expect(pane.cursor()).toContain("write the deck"));
    expect(document.activeElement?.textContent).toContain("write the deck");
  });

  it("I3 an empty board and an empty column draw, and keys on them do nothing", async () => {
    const pane = renderPane({ hits: [] });
    await waitFor(() => expect(fetchTodos).toHaveBeenCalled());
    pane.press("c");
    expect(screen.getByText("nothing on the board")).toBeDefined();
    for (const key of ["j", "k", "h", "l", "x", "X", "Enter", "p", "g"]) pane.press(key);
    expect(pane.onCycle).not.toHaveBeenCalled();
    expect(pane.onOpen).not.toHaveBeenCalled();

    cleanup();
    const full = await boardPane();
    // Waiting holds nothing.
    full.press("l");
    full.press("l");
    for (const key of ["j", "k", "x", "O", "Enter", "p"]) full.press(key);
    expect(full.onCycle).not.toHaveBeenCalled();
    expect(full.onOpen).not.toHaveBeenCalled();
    expect(screen.queryByTestId("todo-project-pick")).toBeNull();
  });

  it("I4 q, Escape, / and a leader sequence still work on the board", async () => {
    const editor = document.createElement("div");
    editor.className = "cm-content";
    editor.tabIndex = -1;
    document.body.append(editor);
    const pane = await boardPane();

    pane.press(" ");
    pane.press("c");
    pane.press("t");
    expect(pane.reached).toEqual(["createTab"]);
    // The `c` went to the leader, so the board is still up.
    expect(pane.cards().length).toBeGreaterThan(0);

    pane.press("/");
    expect(document.activeElement).toBe(pane.filter());

    pane.press("Escape");
    expect(document.activeElement).toBe(editor);

    pane.press("q");
    expect(pane.reached).toEqual(["createTab", "closeNote"]);
    editor.remove();
  });

  it("I5 a done card moved with O goes back to open through onCycle", async () => {
    const pane = await boardPane();
    for (const key of ["l", "l", "l", "l"]) pane.press(key);
    expect(pane.cursor()).toContain("gather numbers");

    pane.press("O");
    expect(pane.onCycle).toHaveBeenCalledWith(NUMBERS, "open");
  });

  it("I6 the board hands on the hit the vault answered with, never a rebuilt todo", async () => {
    const pane = await boardPane();
    pane.press("j");

    pane.press("P");
    expect(pane.onCycle.mock.calls[0]?.[0]).toBe(DECK);

    pane.press("j");
    pane.press("p");
    pane.press("Enter");
    expect(pane.onEdit.mock.calls[0]?.[0]).toBe(TAP);
  });

  it("I7 the board reads the archive the pane was opened with", async () => {
    const pane = await boardPane({ archive: true });

    expect(fetchTodos).toHaveBeenCalledWith(true);
    expect(pane.texts().join()).toContain("send the invoice");
  });

  it("I8 a state picked from the strip moves the card on one tap", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await boardPane();

    fireEvent.click(screen.getByRole("tab", { name: "Doing 1" }));
    fireEvent.click(screen.getByLabelText("more for draw the chart"));
    fireEvent.click(screen.getByLabelText("done draw the chart"));

    expect(pane.onCycle).toHaveBeenCalledTimes(1);
    expect(pane.onCycle).toHaveBeenCalledWith(CHART, "done");
  });

  it("A3 the lanes button switches lanes on a touch screen", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await boardPane();
    expect(pane.headings()).toEqual(["#client", "#internal", "No kind"]);

    fireEvent.click(screen.getByRole("button", { name: "lanes" }));
    expect(pane.headings()).toEqual(["No project", "FDE"]);

    fireEvent.click(screen.getByRole("button", { name: "lanes" }));
    expect(pane.headings()).toEqual(["#client", "#internal", "No kind"]);
  });

  it("B4 cancel on a touch screen shuts the project picker and writes nothing", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await boardPane();

    fireEvent.click(screen.getByLabelText("more for fix the tap"));
    fireEvent.click(screen.getByLabelText("project fix the tap"));
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));

    expect(screen.queryByTestId("todo-project-pick")).toBeNull();
    expect(pane.onEdit).not.toHaveBeenCalled();
  });

  it("B5 two project folders of one name under two roots draw two lanes", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const pane = await boardPane({
      hits: [
        { path: "02 Projects/Foo/a.md", line: 1, text: "- [ ] one" },
        { path: "03 Areas/Foo/b.md", line: 1, text: "- [ ] two" },
      ],
    });

    pane.press("g");

    expect(pane.headings()).toEqual(["Foo", "Foo"]);
    expect(pane.texts()).toHaveLength(2);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("D7 a card on a touch screen is a full tap target", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await boardPane();

    expect(pane.card("fix the tap").className).toContain("min-h-11");
  });
});
