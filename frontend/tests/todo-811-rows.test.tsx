import { fireEvent, render, screen, within } from "@testing-library/react";
import { TodoLegend } from "@/components/todo-legend";
import { TodoList } from "@/components/todo-list";
import { TodoRow } from "@/components/todo-row";
import { STATE_ORDER, TodoStateBox } from "@/components/todo-state-box";
import type { TodoHit } from "@/lib/api";
import { parseTodo, type Todo } from "@/lib/todo";
import { namedTodos } from "@/lib/todo-view";
import { type Row, type RowFacts, rowKey } from "@/lib/use-todo-rows";

/**
 * The rows, the list, the legend and the state boxes of #811, drawn from plain
 * fixtures: no pane, no vault, no fetch. The pane's own tests read the same
 * components through the pane, and these pin what each one draws on its own.
 */

/** The day every assertion below is written against, so no date expires. */
const TODAY = "2026-10-25";
const PATH = "projects/kasten.md";

/** One row, read from its line the way the pane reads one. */
function rowOf(line: number, text: string, project: string | null = null): Row {
  const hit: TodoHit = { path: PATH, line, text, project, shared: false };
  return { hit, todo: parseTodo(text) as Todo };
}

/** No link, nothing running and nothing progressing, unless a test says so. */
function factsOf(over: Partial<RowFacts> = {}): RowFacts {
  return {
    running: new Map(),
    links: { named: new Map(), closed: () => undefined, dependents: new Map() },
    progress: new Map(),
    ...over,
  };
}

/** A row drawn on its own, with the props the list passes it. */
function drawRow(row: Row, over: { coarse?: boolean; facts?: RowFacts; files?: string[] } = {}) {
  return render(
    <TodoRow
      row={row}
      facts={over.facts ?? factsOf()}
      today={TODAY}
      cursor={false}
      muted={false}
      coarse={over.coarse ?? false}
      indent={{}}
      files={over.files ?? []}
      onClick={vi.fn()}
      onPerson={vi.fn()}
    />,
  );
}

/** The props of the list with nothing in it, which a test fills in where it needs to. */
function listProps(over: Partial<Parameters<typeof TodoList>[0]> = {}) {
  return {
    groups: [],
    empty: null,
    cursorKey: "",
    facts: factsOf(),
    today: TODAY,
    coarse: false,
    picking: false,
    editing: null,
    onEditing: vi.fn(),
    draft: { current: null },
    armed: null,
    onArm: vi.fn(),
    onRow: vi.fn(),
    files: [],
    onPerson: vi.fn(),
    onWrite: vi.fn(),
    onCycle: vi.fn(),
    actions: () => [],
    doneWeek: [],
    doneOpen: false,
    onDoneFold: vi.fn(),
    ...over,
  };
}

describe("the state boxes of the todo list", () => {
  it("#811 A1 each state draws its own box", () => {
    const { container } = render(
      <div>
        {STATE_ORDER.map((state) => (
          <TodoStateBox key={state} state={state} />
        ))}
      </div>,
    );

    const boxes = STATE_ORDER.map((state) => container.querySelector(`svg[data-state="${state}"]`));
    for (const box of boxes) expect(box).not.toBeNull();
    // Seven looks, not seven names over one look.
    expect(new Set(boxes.map((box) => box?.innerHTML)).size).toBe(7);

    // The same box on a row, which is where a reader meets it.
    drawRow(rowOf(1, "- [/] wire the pane"));
    expect(document.querySelector('[data-row] svg[data-state="doing"]')).not.toBeNull();
  });

  it("#811 A1 the touch state button draws the state box", () => {
    const row = rowOf(1, "- [r] write the parser 📅 2026-10-30");
    const key = rowKey(row.hit);
    const { unmount } = render(
      <TodoList
        {...listProps({ coarse: true, groups: [{ heading: "This week", rows: [row] }] })}
      />,
    );

    const state = screen.getByLabelText("cycle write the parser");
    expect(state.querySelector('svg[data-state="review"]')).not.toBeNull();
    unmount();

    // While asking, the box of the state the second tap leaves, and a question mark.
    render(
      <TodoList
        {...listProps({
          coarse: true,
          armed: `${key}\n${row.hit.text}`,
          groups: [{ heading: "This week", rows: [row] }],
        })}
      />,
    );
    const asking = screen.getByLabelText("cycle write the parser");
    expect(asking.querySelector('svg[data-state="done"]')).not.toBeNull();
    expect(asking.textContent).toBe("?");
  });
});

describe("the rows of the todo list", () => {
  it("#811 A2 the meta line holds project, tags, wait, blocker, parts and time", () => {
    const blocker = rowOf(2, "- [ ] ship it 🆔 kt-aaaaaa");
    const row = rowOf(
      1,
      "- [w] wire the API #client ⏱ 1h 👤 2026-10-20 [[Alicia]] ⛔ kt-aaaaaa",
      "projects/kasten",
    );
    const facts = factsOf({
      links: {
        named: namedTodos([blocker.todo]),
        closed: () => undefined,
        dependents: new Map(),
      },
      progress: new Map([[rowKey(row.hit), "1/3"]]),
    });

    drawRow(row, { facts });

    const text = document.querySelector(`[data-row="${PATH}:1"]`)?.textContent ?? "";
    expect(text).toContain("kasten");
    expect(text).toContain("#client");
    expect(text).toContain("👤 5d Alicia");
    expect(text).toContain("⛔ ship it");
    expect(text).toContain("1/3");
    expect(text).toContain("⏱ 1h");
  });

  it("#811 A2 an overdue date is drawn in the danger colour and a later one muted", () => {
    const { unmount } = drawRow(rowOf(1, "- [ ] late thing 📅 2026-10-01"));
    expect(screen.getByText("10-01")).toHaveClass("text-k-danger");
    unmount();

    drawRow(rowOf(2, "- [ ] later thing 📅 2026-11-01"));
    const later = screen.getByText("11-01");
    expect(later).toHaveClass("text-k-muted");
    expect(later).not.toHaveClass("text-k-danger");
  });

  it("#811 A2 a row with an assignee draws the one person chip of #809", () => {
    drawRow(rowOf(1, "- [ ] buy milk 👤 [[Pascal]]", "projects/kasten"));

    const chips = document.querySelectorAll("[data-person]");
    expect(chips).toHaveLength(1);
    expect(chips[0]?.getAttribute("data-person")).toBe("[[Pascal]]");
    // The chip sits on the meta line, where the project is drawn too.
    expect(chips[0]?.parentElement?.textContent).toContain("kasten");
  });

  it("#811 I8 no row draws on the surface ground", () => {
    drawRow(rowOf(1, "- [ ] late thing 📅 2026-10-01"));

    const row = document.querySelector(`[data-row="${PATH}:1"]`) as HTMLElement;
    const date = screen.getByText("10-01");
    expect(date).toHaveClass("text-k-danger");
    expect(row.className).not.toContain("bg-k-surface");
    expect(date.closest(".bg-k-surface")).toBeNull();
  });
});

it("#811 A2 the words drop the trailing tags the meta line shows and keep a tag inside the sentence", () => {
  drawRow(rowOf(1, "- [ ] file #work the expense report #client"));

  // The words stop before the trailing tag, which the meta line holds.
  expect(screen.getByText("file #work the expense report")).toBeInTheDocument();
  // The meta line holds every tag of the todo, in the order written.
  expect(screen.getByText("#work #client")).toBeInTheDocument();
  expect(document.querySelector(`[data-row="${PATH}:1"]`)?.getAttribute("title")).toBe(`${PATH}:1`);
});

it("#811 A2 an overdue date on a phone row is drawn in the danger colour, a muted row too", () => {
  // Blocked is a muted row: its date must still be read as overdue on touch.
  render(
    <TodoList
      {...listProps({
        coarse: true,
        groups: [
          {
            heading: "Overdue",
            rows: [
              rowOf(1, "- [b] ship it 📅 2026-10-20"),
              rowOf(2, "- [ ] buy milk 📅 2026-10-20"),
            ],
          },
        ],
      })}
    />,
  );

  const dates = screen.getAllByText("10-20");
  expect(dates).toHaveLength(2);
  for (const date of dates) expect(date).toHaveClass("text-k-danger");
});

describe("the done this week fold of the todo list", () => {
  it("#811 A3 the done this week heading folds and unfolds and says its count", () => {
    const doneWeek = [rowOf(31, "- [x] read the spec ✅ 2026-10-24"), rowOf(32, "- [x] write it")];
    const onDoneFold = vi.fn();
    const { rerender } = render(<TodoList {...listProps({ doneWeek, onDoneFold })} />);

    const fold = screen.getByRole("button", { name: /Done this week/ });
    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(fold.textContent).toContain("Done this week 2");
    expect(document.querySelector(`[data-row="${PATH}:31"]`)).toBeNull();

    fireEvent.click(fold);
    expect(onDoneFold).toHaveBeenCalledOnce();

    rerender(<TodoList {...listProps({ doneWeek, doneOpen: true, onDoneFold })} />);
    expect(screen.getByRole("button", { name: /Done this week/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(document.querySelector(`[data-row="${PATH}:31"]`)).not.toBeNull();
    expect(document.querySelector(`[data-row="${PATH}:32"]`)).not.toBeNull();
  });
});

describe("the done rows of the todo list by touch", () => {
  it("#811 A1 a done row on touch draws the done box", () => {
    const done = rowOf(31, "- [x] read the spec ✅ 2026-10-24");
    render(<TodoList {...listProps({ coarse: true, doneWeek: [done], doneOpen: true })} />);

    // The box stands beside the row, in the slot the open rows' state buttons take.
    const row = document.querySelector(`[data-row="${PATH}:31"]`) as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.parentElement?.querySelector('svg[data-state="done"]')).not.toBeNull();
  });
});

describe("the legend of the todo list", () => {
  it("#811 A4 the legend draws seven boxes with their counts", () => {
    render(
      <TodoLegend
        counts={{
          open: 3,
          doing: 1,
          review: 0,
          waiting: 2,
          blocked: 0,
          done: 4,
          rejected: 1,
        }}
      />,
    );

    const items = within(screen.getByRole("list", { name: "legend" })).getAllByRole("listitem");
    expect(items).toHaveLength(7);
    expect(items.map((item) => item.textContent)).toEqual(["3", "1", "0", "2", "0", "4", "1"]);
    STATE_ORDER.forEach((state, index) => {
      expect(items[index]?.querySelector(`svg[data-state="${state}"]`)).not.toBeNull();
    });

    // The same box on a row of the list, which the legend counts.
    const waiting = rowOf(1, "- [w] call back 👤 2026-10-20 [[Alicia]]");
    render(<TodoList {...listProps({ groups: [{ heading: "Later", rows: [waiting] }] })} />);
    expect(
      document.querySelector(`[data-row="${PATH}:1"] svg[data-state="waiting"]`),
    ).not.toBeNull();
  });
});
