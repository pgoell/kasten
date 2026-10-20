import { waitFor } from "@testing-library/react";
import { paneHooks, renderPane, TODOS } from "./todo-pane-fixture";

// The doubles, the same in every todo-pane file: see todo-pane-fixture.tsx.
const { fetchTodos, fetchNote, fetchFiles, createNote } = vi.hoisted(() => ({
  fetchTodos: vi.fn(),
  fetchNote: vi.fn(),
  fetchFiles: vi.fn(),
  createNote: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ fetchTodos, fetchNote, fetchFiles, createNote }));

paneHooks();

describe("the todo pane", () => {
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
});
