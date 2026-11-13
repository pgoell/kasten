import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { TodoHit } from "@/lib/core/api";
import { parseTodo } from "@/lib/todo/todo";
import {
  cursorAfter,
  type HeldGroup,
  holdOrder,
  identities,
  sameOrder,
} from "@/lib/todo/todo-hold";
import type { Row } from "@/lib/todo/use-todo-rows";
import { paneHooks, renderPane } from "./todo-pane-fixture";

// The doubles, the same in every todo-pane file: see todo-pane-fixture.tsx.
const { fetchTodos, fetchNote, fetchFiles, createNote } = vi.hoisted(() => ({
  fetchTodos: vi.fn(),
  fetchNote: vi.fn(),
  fetchFiles: vi.fn(),
  createNote: vi.fn(),
}));
vi.mock("@/lib/core/api", () => ({ fetchTodos, fetchNote, fetchFiles, createNote }));

paneHooks();

/** A hit as the backend answers it, with the shared flag the backend adds (#811). */
type Hit = { path: string; line: number; text: string; shared?: boolean };

const LIST: Hit[] = [
  { path: "a.md", line: 1, text: "- [ ] buy milk 📅 2026-08-14" },
  { path: "a.md", line: 2, text: "- [ ] call the dentist 📅 2026-08-07" },
  { path: "a.md", line: 3, text: "- [x] read the spec ✅ 2026-08-08" },
  { path: "a.md", line: 4, text: "- [x] think about it ✅ 2026-08-01" },
];

/** One todo in each state the legend counts, and one shared todo it must not count. */
const STATES: Hit[] = [
  { path: "a.md", line: 1, text: "- [ ] buy milk 📅 2026-08-14" },
  { path: "a.md", line: 2, text: "- [/] wire up the pane 📅 2026-08-10" },
  { path: "a.md", line: 3, text: "- [b] ship it 📅 2026-08-10" },
  { path: "a.md", line: 4, text: "- [x] read the spec ✅ 2026-08-08" },
  { path: "a.md", line: 5, text: "- [-] drop the logo ❌ 2026-08-09" },
  { path: "05 Shared/Einkauf.md", line: 1, text: "- [ ] buy eggs 📅 2026-08-14", shared: true },
];

/** The legend as drawn: each state's count, by the state its box is titled with. */
function legend(): Record<string, string | null> {
  return Object.fromEntries(
    Array.from(document.querySelectorAll<HTMLElement>("ul[aria-label='legend'] li")).map((li) => [
      li.title,
      li.querySelector("span")?.textContent ?? null,
    ]),
  );
}

describe("the todo pane's list", () => {
  it("#811 A3 done this week sits folded after the groups and a click unfolds it", async () => {
    const pane = renderPane(LIST);
    await pane.loaded();
    expect(pane.texts().join()).toContain("buy milk");
    expect(pane.texts().join()).not.toContain("read the spec");

    const region = screen.getByRole("region", { name: "Todos" }).textContent ?? "";
    expect(region).toContain("Done this week");
    expect(region.indexOf("Done this week")).toBeGreaterThan(region.indexOf("buy milk"));

    fireEvent.click(screen.getByRole("button", { name: /^Done this week/ }));
    await waitFor(() => expect(pane.texts().join()).toContain("read the spec"));
  });

  it("#811 A4 the legend counts each state of what is shown", async () => {
    const pane = renderPane(STATES);
    await pane.loaded();
    expect(pane.texts().join()).toContain("buy milk");

    // The shared todo is hidden, so it is not counted; the finished and the
    // rejected ones are, as the Done this week fold and the rejected window show them.
    expect(legend()).toEqual({
      open: "1",
      doing: "1",
      review: "0",
      waiting: "0",
      blocked: "1",
      done: "1",
      rejected: "1",
    });
  });

  it("#811 I3 j and k skip a folded done this week and walk into it unfolded", async () => {
    const pane = renderPane(LIST);
    await pane.loaded();
    expect(pane.texts().join()).toContain("buy milk");
    const at = () => pane.cursor()?.textContent ?? "";

    // Past the last open row the cursor stops there, since the fold is shut.
    pane.press("j");
    pane.press("j");
    pane.press("j");
    const last = at();
    expect(last).not.toContain("read the spec");
    pane.press("j");
    expect(at()).toBe(last);

    fireEvent.click(screen.getByRole("button", { name: /^Done this week/ }));
    pane.press("j");
    expect(at()).toContain("read the spec");
  });
});

describe("where the cursor lands as a held order lets go", () => {
  const open = ["b", "c"];
  const all = [...open, "a", "k", "l"];

  it("an open cursor whose row left goes to the next open row, not the row in the fold", () => {
    expect(cursorAfter({ keys: ["a", "b", "c"], inFold: false }, open, all)).toBe(0);
  });

  it("a cursor in the fold keeps its row there", () => {
    expect(cursorAfter({ keys: ["k", "l"], inFold: true }, open, all)).toBe(3);
  });
});

describe("a held row the list drops while a press holds the order (#2003)", () => {
  const hit = (line: number, text: string): TodoHit => ({
    path: "Plan.md",
    line,
    text,
    project: null,
    shared: false,
  });
  const row = (each: TodoHit, struck?: boolean): Row =>
    ({
      hit: each,
      todo: parseTodo(each.text) ?? { state: "open", text: "", indent: "" },
      struck,
    }) as Row;
  const read = hit(3, "- [ ] read the plan");
  const write = hit(4, "- [ ] write the plan");
  // Each row's identity as the open list names it, which a held row is found again by.
  const ids = identities([read, write]);
  const id = (each: TodoHit) => ids.get(`${each.path}:${each.line}`) ?? "";
  const held = (first: Row): HeldGroup[] => [
    {
      heading: "No date",
      rows: [
        { id: id(read), row: first },
        { id: id(write), row: row(write) },
      ],
    },
  ];
  const drawn = (order: HeldGroup[]) =>
    order.flatMap((group) => group.rows.map((each) => each.row));
  // The list after the press: the read row's line is gone from it, plain words now.
  const after = (first: TodoHit) =>
    drawn(holdOrder(held(row(first)), [{ heading: "No date", rows: [row(write)] }], [write], ids));

  it("keeps a struck row in its place, struck, when its line leaves the list", () => {
    const done = row(hit(3, "- [x] read the plan ✅ 2026-11-13"), true);
    const rows = drawn(
      holdOrder(held(done), [{ heading: "No date", rows: [row(write)] }], [write], ids),
    );
    expect(rows.map((each) => [each.hit.text, each.struck])).toEqual([
      ["- [x] read the plan ✅ 2026-11-13", true],
      ["- [ ] write the plan", undefined],
    ]);
  });

  it("lets an open row go when its line leaves the list, as a refile or a delete elsewhere does", () => {
    expect(after(read).map((each) => each.hit.text)).toEqual(["- [ ] write the plan"]);
  });

  it("draws a struck row open again, unstruck, once its line is open", () => {
    const done = row(hit(3, "- [x] read the plan ✅ 2026-11-13"), true);
    const rows = drawn(
      holdOrder(held(done), [{ heading: "No date", rows: [row(read)] }], [read], ids),
    );
    expect(rows[0]?.struck).toBeUndefined();
  });

  it("reads a row struck since as another order, so the hold learns it", () => {
    const done = row(hit(3, "- [x] read the plan ✅ 2026-11-13"), true);
    expect(sameOrder(held(row(read)), held(done))).toBe(false);
    expect(sameOrder(held(done), held(done))).toBe(true);
  });
});
