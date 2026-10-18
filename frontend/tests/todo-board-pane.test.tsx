import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TodoPane } from "@/components/todo-pane";
import type { EditorCommands } from "@/lib/key-bindings";
import { DEFAULT_VIEWS, parseViews, VIEWS_NOTE } from "@/lib/todo-view";
import { toggleVim } from "@/lib/vim-setting";
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
 * none, as the backend answers. The old rejection is past the board's seven
 * days.
 */
const BOARD = [
  {
    path: PLAN,
    line: 1,
    text: "- [ ] write the deck 📅 2026-08-12 ⏫ #internal",
    project: "02 Projects/FDE",
  },
  { path: PLAN, line: 2, text: "  - [/] draw the chart", project: "02 Projects/FDE" },
  { path: PLAN, line: 3, text: "  - [x] gather numbers ✅ 2026-08-09", project: "02 Projects/FDE" },
  {
    path: DAILY,
    line: 4,
    text: "- [ ] send the invoice [[02 Projects/FDE/index|FDE]] #client",
    project: "02 Projects/FDE",
  },
  { path: DAILY, line: 5, text: "- [b] ship it ⛔ kt-000009 #private", project: null },
  { path: DAILY, line: 6, text: "- [ ] fix the tap 🆔 kt-000009", project: null },
  { path: DAILY, line: 7, text: "- [-] old idea ❌ 2026-08-01", project: null },
  { path: DAILY, line: 8, text: "- [-] drop the logo ❌ 2026-08-09", project: null },
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
  const onRefile = vi.fn();
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
        onRefile={onRefile}
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
  // A row rather than any button: the strip is a button before the todos come.
  await waitFor(() => expect(document.querySelector("[data-row]")).not.toBeNull());
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
    await waitFor(() => expect(document.querySelector("[data-row]")).not.toBeNull());
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

  it("A2 draws the seven columns and leaves out what was finished before the last seven days", async () => {
    const pane = await boardPane();

    expect(pane.columns()).toEqual([
      "Open 3",
      "Doing 1",
      "Review 0",
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
      "Review 0",
      "Waiting 0",
      "Blocked 1",
      "Done 1",
      "Rejected 1",
    ]);
    expect(pane.cards()).toHaveLength(3);

    fireEvent.click(screen.getByRole("tab", { name: "Done 1" }));
    expect(pane.texts()).toEqual([expect.stringContaining("gather numbers")]);

    fireEvent.click(screen.getByLabelText("more for gather numbers"));
    for (const label of [
      "open",
      "doing",
      "review",
      "done",
      "blocked",
      "waiting",
      "rejected",
      "project",
    ]) {
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
    // Review holds nothing.
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
    for (const key of ["l", "l", "l", "l", "l"]) pane.press(key);
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

  it("#429 A4 a review card sits in a Review column after Doing, in a grid of seven", async () => {
    const pane = await boardPane({
      hits: [...BOARD, { path: DAILY, line: 9, text: "- [r] write the parser", project: null }],
    });

    expect(pane.columns().slice(0, 3)).toEqual(["Open 3", "Doing 1", "Review 1"]);
    // Seven columns, so the grid and every lane's span count seven.
    const grid = screen.getAllByTestId("todo-column")[0]?.parentElement;
    expect(grid?.className).toContain("grid-cols-7");
    expect(grid?.innerHTML).not.toContain("col-span-6");
  });

  it("#429 A4 V moves the card to review through onCycle", async () => {
    const pane = await boardPane();
    expect(pane.cursor()).toContain("send the invoice");

    pane.press("V");

    expect(pane.onCycle).toHaveBeenCalledExactlyOnceWith(INVOICE, "review");
  });

  it("#429 A4 a phone has a Review tab, and the card's strip sets review on one tap", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const review = { path: DAILY, line: 9, text: "- [r] write the parser", project: null };
    const pane = await boardPane({ hits: [...BOARD, review] });

    fireEvent.click(screen.getByRole("tab", { name: "Review 1" }));
    expect(pane.texts()).toEqual([expect.stringContaining("write the parser")]);

    fireEvent.click(screen.getByRole("tab", { name: "Doing 1" }));
    fireEvent.click(screen.getByLabelText("more for draw the chart"));
    const states = ["open", "doing", "review", "done", "blocked", "waiting", "rejected"];
    const labels = screen
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? "")
      .filter((label) => states.some((one) => label === `${one} draw the chart`));
    expect(labels).toEqual(states.map((one) => `${one} draw the chart`));

    fireEvent.click(screen.getByLabelText("review draw the chart"));
    expect(pane.onCycle).toHaveBeenCalledExactlyOnceWith(CHART, "review");
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

  it("A3 the lanes button does what g does: cursor to the top, focus on its card", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await boardPane({ focusSignal: 1 });
    pane.press("j");
    expect(pane.cursor()).toContain("write the deck");

    const lanes = screen.getByRole("button", { name: "lanes" });
    lanes.focus();
    fireEvent.click(lanes);

    // Row 1 would be the deck again, the second card of the open column.
    expect(pane.cursor()).toContain("fix the tap");
    expect(document.activeElement?.textContent).toContain("fix the tap");
  });

  it("B4 cancel hands the focus back to the card under the cursor", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await boardPane({ focusSignal: 1 });
    await waitFor(() => expect(document.activeElement?.textContent).toContain("send the invoice"));

    fireEvent.click(screen.getByLabelText("more for fix the tap"));
    fireEvent.click(screen.getByLabelText("project fix the tap"));
    const cancel = screen.getByRole("button", { name: "cancel" });
    cancel.focus();
    fireEvent.click(cancel);

    expect(document.activeElement).toBe(pane.card("send the invoice"));
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
        { path: "02 Projects/Foo/a.md", line: 1, text: "- [ ] one", project: "02 Projects/Foo" },
        { path: "03 Areas/Foo/b.md", line: 1, text: "- [ ] two", project: "03 Areas/Foo" },
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

  it("#488 the board footer on a phone drops its key hints", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    await boardPane();

    expect(screen.getByTestId("todo-footer").textContent).not.toContain("h l column");
  });

  it("#488 the board footer on a desktop keeps its key hints", async () => {
    await boardPane();

    expect(screen.getByTestId("todo-footer").textContent).toContain("h l column");
  });

  it("#488 the list footer on a phone drops its key hints", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    renderPane();
    await waitFor(() => expect(document.querySelector("[data-row]")).not.toBeNull());

    expect(screen.getByTestId("todo-footer").textContent).not.toContain("x cycle");
  });
});

describe("the board by mouse (#419)", () => {
  // The vim setting lives in localStorage, so the two tests that set it put
  // it back for whoever runs next.
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  /** The pane with its rows drawn, which a strip of buttons no longer says. */
  async function listPane(options?: Parameters<typeof renderPane>[0]) {
    const pane = renderPane(options);
    await waitFor(() => expect(document.querySelector("[data-row]")).not.toBeNull());
    return pane;
  }

  const button = (name: string) => screen.getByRole("button", { name });

  it("#419 A1 A4 the strip names its keys on a fine pointer and stays bare on a coarse one", async () => {
    const media = stubMatchMedia();
    await listPane();

    for (const name of ["d done", "n next", "v view", "c board"]) {
      expect(button(name).className).not.toContain("min-h-11");
    }

    media.set(COARSE, true);

    for (const name of ["done", "next", "view", "board"]) {
      expect(button(name).className).toContain("min-h-11 px-3");
      expect(button(name).tabIndex).toBe(-1);
    }
    expect(screen.queryByRole("button", { name: "c board" })).toBeNull();
  });

  it("#419 A6 c and the c board button reach the board, vim on", async () => {
    toggleVim();
    toggleVim();
    expect(localStorage.getItem("kasten.vim")).toBe("on");
    const pane = await listPane();

    pane.press("c");
    await waitFor(() => expect(pane.cards().length).toBeGreaterThan(0));
    pane.press("c");
    expect(pane.cards()).toHaveLength(0);
    fireEvent.click(button("c board"));
    expect(pane.cards().length).toBeGreaterThan(0);
  });

  it("#419 A6 c and the c board button reach the board, vim off", async () => {
    toggleVim();
    expect(localStorage.getItem("kasten.vim")).toBe("off");
    const pane = await listPane();

    pane.press("c");
    await waitFor(() => expect(pane.cards().length).toBeGreaterThan(0));
    pane.press("c");
    expect(pane.cards()).toHaveLength(0);
    fireEvent.click(button("c board"));
    expect(pane.cards().length).toBeGreaterThan(0);
  });

  it("#419 I1 a click on c board leaves the keys on the board, and c goes back to the list", async () => {
    const pane = await listPane({ focusSignal: 1 });
    // What a browser does with a mouse down on a button that jsdom does not.
    act(() => button("c board").focus());

    fireEvent.click(button("c board"));
    await waitFor(() => expect(pane.cards().length).toBeGreaterThan(0));
    const card = document.activeElement as HTMLElement;
    expect(card.hasAttribute("data-card")).toBe(true);
    expect(card.tabIndex).toBe(0);

    fireEvent.keyDown(card, { key: "c" });
    expect(pane.cards()).toHaveLength(0);
    expect(document.activeElement?.hasAttribute("data-row")).toBe(true);
  });

  it("#419 I2 the list footer names c board on a desktop", async () => {
    await listPane();

    expect(screen.getByTestId("todo-footer").textContent).toContain("c board");
  });

  it("#419 B1 a click on the strip while a row is an input leaves the edit be", async () => {
    const pane = await listPane();
    pane.press("i");
    expect(screen.getByLabelText("edit line")).not.toBeNull();

    fireEvent.click(button("c board"));
    fireEvent.click(button("d done"));

    expect(pane.cards()).toHaveLength(0);
    expect(button("d done").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByLabelText("edit line")).not.toBeNull();
  });

  it("#419 B2 a click on the strip while picking a blocker leaves the picker be", async () => {
    const pane = await listPane();
    pane.press("b");
    expect(screen.getByTestId("todo-pick")).not.toBeNull();

    fireEvent.click(button("c board"));
    fireEvent.click(button("d done"));

    expect(pane.cards()).toHaveLength(0);
    expect(button("d done").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("todo-pick")).not.toBeNull();
  });

  /** Every word on the touch strip, tapped once. */
  function tapStrip() {
    for (const name of ["board", "done", "next", "view"]) fireEvent.click(button(name));
  }

  /**
   * The views read and walked back round to none. The vault is only asked at
   * the first `view`, so without this a stray tap would change nothing until
   * the answer came, and a check right after it would pass either way.
   */
  async function viewsInHand(pane: ReturnType<typeof renderPane>) {
    fireEvent.click(button("view"));
    await waitFor(() => expect(pane.filter().value).toBe("due:today"));
    // A tap for each view after the first, and one more past the last.
    const views = parseViews(DEFAULT_VIEWS).length;
    for (let left = 0; left < views; left++) fireEvent.click(button("view"));
    expect(pane.filter().value).toBe("");
  }

  /** What tapStrip must not have changed, the list's own state and the view. */
  function stripUnmoved(pane: ReturnType<typeof renderPane>) {
    expect(pane.cards()).toHaveLength(0);
    expect(button("done").getAttribute("aria-pressed")).toBe("false");
    expect(button("next").getAttribute("aria-pressed")).toBe("false");
    expect(pane.filter().value).toBe("");
    expect(screen.queryByTestId("todo-view")).toBeNull();
  }

  it("#421 A1 I4 a tap on the strip while a row is edited leaves the edit be, vim on", async () => {
    toggleVim();
    toggleVim();
    expect(localStorage.getItem("kasten.vim")).toBe("on");
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await listPane();
    await viewsInHand(pane);
    fireEvent.click(screen.getByLabelText("more for fix the tap"));
    fireEvent.click(screen.getByLabelText("edit fix the tap"));
    expect(screen.getByLabelText("edit line")).not.toBeNull();

    tapStrip();

    stripUnmoved(pane);
    expect(screen.getByLabelText("edit line")).not.toBeNull();
  });

  it("#421 A2 I4 a tap on the strip while picking a blocker leaves the picker be, vim off", async () => {
    toggleVim();
    expect(localStorage.getItem("kasten.vim")).toBe("off");
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await listPane();
    await viewsInHand(pane);
    fireEvent.click(screen.getByLabelText("more for fix the tap"));
    fireEvent.click(screen.getByLabelText("blocked by fix the tap"));
    expect(screen.getByTestId("todo-pick")).not.toBeNull();

    tapStrip();

    stripUnmoved(pane);
    expect(screen.getByTestId("todo-pick")).not.toBeNull();
  });

  it("#421 I1 once the edit ends a tap on the strip works again", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await listPane();
    fireEvent.click(screen.getByLabelText("more for fix the tap"));
    fireEvent.click(screen.getByLabelText("edit fix the tap"));
    fireEvent.keyDown(screen.getByLabelText("edit line"), { key: "Escape" });
    expect(screen.queryByLabelText("edit line")).toBeNull();

    fireEvent.click(button("board"));
    expect(pane.cards().length).toBeGreaterThan(0);
  });

  it("#421 I1 once the edit is written with Enter a tap on the strip works again", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await listPane();
    fireEvent.click(screen.getByLabelText("more for fix the tap"));
    fireEvent.click(screen.getByLabelText("edit fix the tap"));
    fireEvent.keyDown(screen.getByLabelText("edit line"), { key: "Enter" });
    expect(pane.onEdit).toHaveBeenCalledWith(TAP, TAP?.text);
    expect(screen.queryByLabelText("edit line")).toBeNull();

    fireEvent.click(button("board"));
    expect(pane.cards().length).toBeGreaterThan(0);
  });

  it("#421 I2 once the picker is cancelled a tap on the strip works again", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await listPane();
    fireEvent.click(screen.getByLabelText("more for fix the tap"));
    fireEvent.click(screen.getByLabelText("blocked by fix the tap"));
    fireEvent.click(button("cancel"));

    expect(screen.queryByTestId("todo-pick")).toBeNull();
    expect(button("done").getAttribute("aria-pressed")).toBe("false");
    expect(button("next").getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button("board"));
    expect(pane.cards().length).toBeGreaterThan(0);
  });

  it("#419 I3 the desktop strip stays out of the tab order", async () => {
    await listPane();

    for (const name of ["d done", "n next", "v view", "c board"]) {
      expect(button(name).tabIndex).toBe(-1);
    }
  });

  it("#419 I5 the desktop strip says which of done, next and board is on", async () => {
    const pane = await listPane();
    const pressed = (name: string) => button(name).getAttribute("aria-pressed");
    expect([pressed("d done"), pressed("n next"), pressed("c board")]).toEqual([
      "false",
      "false",
      "false",
    ]);

    pane.press("d");
    expect([pressed("d done"), pressed("n next")]).toEqual(["true", "false"]);
    pane.press("n");
    expect([pressed("d done"), pressed("n next")]).toEqual(["false", "true"]);
    pane.press("c");
    expect(pressed("c board")).toBe("true");
  });
});

describe("lanes by the project the backend names (#395, #394)", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  const KASTEN = "02 Projects/Kasten/plan.md";

  /**
   * In the Kasten folder, but its tag names FDE, and the backend says so. The
   * A4 tests put it beside the deck and its doing part, both FDE by folder.
   */
  const TAGGED = {
    path: KASTEN,
    line: 1,
    text: "- [ ] send the deck #p/fde",
    project: "02 Projects/FDE",
  };

  it("A2 #395 a daily todo with no link sits in the lane the API names", async () => {
    const pane = await boardPane({
      hits: [
        { path: DAILY, line: 4, text: "- [ ] send the deck", project: "02 Projects/FDE" },
        { path: DAILY, line: 6, text: "- [ ] fix the tap", project: null },
      ],
    });

    pane.press("g");

    expect(pane.headings()).toEqual(["No project", "FDE"]);
    expect(lane("FDE")).toContain("send the deck");
    expect(lane("No project")).toContain("fix the tap");
  });

  it("A3 #394 a todo tagged #p/fde in the Kasten folder sits in the FDE lane", async () => {
    const pane = await boardPane({
      hits: [
        TAGGED,
        { path: KASTEN, line: 2, text: "- [ ] fix the tap", project: "02 Projects/Kasten" },
      ],
    });

    pane.press("g");

    expect(pane.headings()).toEqual(["FDE", "Kasten"]);
    expect(lane("FDE")).toContain("send the deck");
    expect(lane("Kasten")).not.toContain("send the deck");
    expect(lane("Kasten")).toContain("fix the tap");
  });

  // The board never reads the vim setting, its keys landing on the pane, so
  // the two runs below differ in the setting alone.
  for (const vim of ["on", "off"]) {
    it(`A4 #394 g then j k h l reach the tagged card in its FDE lane on a desktop, vim ${vim}`, async () => {
      toggleVim();
      if (vim === "on") toggleVim();
      expect(localStorage.getItem("kasten.vim")).toBe(vim);
      const pane = await boardPane({ hits: [...BOARD.slice(0, 2), TAGGED] });

      pane.press("g");
      expect(pane.headings()).toEqual(["FDE"]);
      expect(lane("FDE")).toContain("send the deck");

      expect(pane.cursor()).toContain("write the deck");
      pane.press("j");
      expect(pane.cursor()).toContain("send the deck");
      pane.press("l");
      expect(pane.cursor()).toContain("draw the chart");
      pane.press("h");
      pane.press("j");
      expect(pane.cursor()).toContain("send the deck");
      pane.press("k");
      expect(pane.cursor()).toContain("write the deck");
      pane.press("j");
      pane.press("Enter");
      expect(pane.onOpen).toHaveBeenLastCalledWith(KASTEN, 1);
    });
  }

  it("A4 #394 a phone shows the tagged card in its FDE lane, one column, lanes by finger", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await boardPane({ hits: [...BOARD.slice(0, 2), TAGGED] });

    fireEvent.click(screen.getByRole("button", { name: "lanes" }));

    expect(pane.headings()).toEqual(["FDE"]);
    expect(screen.getAllByRole("tab")[0]?.textContent).toBe("Open 2");
    expect(pane.texts()).toEqual([
      expect.stringContaining("write the deck"),
      expect.stringContaining("send the deck"),
    ]);
    expect(lane("FDE")).toContain("send the deck");

    fireEvent.click(pane.card("send the deck"));
    expect(pane.onOpen).toHaveBeenCalledWith(KASTEN, 1);
  });
});

describe("refiling one todo (#396)", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  /** A daily todo the backend files under FDE, beside one it files nowhere. */
  const SEND = {
    path: DAILY,
    line: 4,
    text: "- [ ] send the invoice",
    project: "02 Projects/FDE",
  };
  const LOOSE = { path: DAILY, line: 6, text: "- [ ] fix the tap", project: null };

  /** The list with its rows drawn. */
  async function listPane(options?: Parameters<typeof renderPane>[0]) {
    const pane = renderPane(options);
    await waitFor(() => expect(document.querySelector("[data-row]")).not.toBeNull());
    return pane;
  }

  // The pane's keys land on the section and never in CodeMirror, so the two
  // runs differ in the setting alone, which is what A2 and A3 ask to see.
  for (const vim of ["on", "off"]) {
    it(`#396 ${vim === "on" ? "A2" : "A3"} A5 m on a list row hands that one row on, vim ${vim}`, async () => {
      toggleVim();
      if (vim === "on") toggleVim();
      expect(localStorage.getItem("kasten.vim")).toBe(vim);
      const pane = await listPane({ hits: [SEND, LOOSE] });

      pane.press("m");

      expect(pane.onRefile).toHaveBeenCalledExactlyOnceWith(SEND);
      expect(pane.onEdit).not.toHaveBeenCalled();
      expect(pane.onCycle).not.toHaveBeenCalled();
    });

    it(`#396 ${vim === "on" ? "A2" : "A3"} A5 m on a board card hands that one card on, vim ${vim}`, async () => {
      toggleVim();
      if (vim === "on") toggleVim();
      expect(localStorage.getItem("kasten.vim")).toBe(vim);
      const pane = await boardPane({ hits: [SEND, LOOSE] });
      pane.press("j");
      expect(pane.cursor()).toContain("fix the tap");

      pane.press("m");

      expect(pane.onRefile).toHaveBeenCalledExactlyOnceWith(LOOSE);
    });
  }

  it("#396 A4 a phone's row strip holds refile, and a tap refiles", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await listPane({ hits: [SEND, LOOSE] });

    fireEvent.click(screen.getByLabelText("more for send the invoice"));
    fireEvent.click(screen.getByLabelText("refile send the invoice"));

    expect(pane.onRefile).toHaveBeenCalledExactlyOnceWith(SEND);
  });

  it("#396 A4 a phone's card strip holds refile, and a tap refiles", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await boardPane({ hits: [SEND, LOOSE] });

    fireEvent.click(screen.getByLabelText("more for send the invoice"));
    fireEvent.click(screen.getByLabelText("refile send the invoice"));

    expect(pane.onRefile).toHaveBeenCalledExactlyOnceWith(SEND);
  });

  it("#396 A1 both footers on a desktop name m refile", async () => {
    const pane = await listPane({ hits: [SEND] });
    expect(screen.getByTestId("todo-footer").textContent).toContain("m refile");

    pane.press("c");
    await waitFor(() => expect(pane.cards().length).toBeGreaterThan(0));
    expect(screen.getByTestId("todo-footer").textContent).toContain("m refile");
  });
});
