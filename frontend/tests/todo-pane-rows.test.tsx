import { waitFor } from "@testing-library/react";
import { PRIORITY_SYMBOL } from "@/lib/todo";
import { paneHooks, renderPane } from "./todo-pane-fixture";

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

  it("puts client work first among rows of one priority, and never over a higher one", async () => {
    const pane = renderPane([
      { path: "a.md", line: 1, text: "- [ ] tidy the wiki 📅 2026-08-10 ⏫" },
      { path: "a.md", line: 2, text: "- [ ] file the tax 📅 2026-08-10" },
      { path: "a.md", line: 3, text: "- [ ] send the offer #client 📅 2026-08-10" },
      { path: "a.md", line: 4, text: "- [ ] review the draft #client 📅 2026-08-10 ⏫" },
    ]);

    await waitFor(() => expect(pane.rows()).toHaveLength(4));
    const [first, second, third, fourth] = pane.texts();
    expect(first).toContain("review the draft");
    expect(second).toContain("tidy the wiki");
    expect(third).toContain("send the offer");
    expect(fourth).toContain("file the tax");
  });

  it("marks client work, a part of it included, and nothing else", async () => {
    const pane = renderPane([
      { path: "a.md", line: 1, text: "- [ ] send the offer #client 📅 2026-08-10" },
      { path: "a.md", line: 2, text: "  - [ ] check the numbers" },
      { path: "a.md", line: 3, text: "- [ ] file the tax 📅 2026-08-10" },
    ]);

    await waitFor(() => expect(pane.rows()).toHaveLength(3));
    expect(pane.texts().map((text) => text.includes("◆"))).toEqual([true, true, false]);
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
});
