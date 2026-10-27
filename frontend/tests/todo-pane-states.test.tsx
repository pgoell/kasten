import { fireEvent, screen, waitFor } from "@testing-library/react";
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
  it("draws a blocked todo muted, in the section its due date names", async () => {
    const pane = renderPane();

    await pane.loaded();
    expect(pane.rows()).toHaveLength(6);
    // Third row: overdue holds one, and today holds the doing one before it.
    const blocked = pane.rows()[2] as HTMLElement;
    expect(blocked.textContent).toContain("ship it");
    expect(blocked.className).toContain("text-k-muted");
  });

  it("draws a waiting todo muted, with who it is on and for how long", async () => {
    const pane = renderPane([
      { path: "a.md", line: 1, text: "- [w] decision record 📅 2026-08-10 👤 2026-08-03 [[Ada]]" },
      { path: "a.md", line: 2, text: "- [ ] buy milk 📅 2026-08-10" },
    ]);

    await pane.loaded();
    expect(pane.rows()).toHaveLength(2);
    const waiting = pane.rows().find((row) => row.textContent?.includes("decision record"));
    // The state is drawn as its box now (#811), not as its symbol in the words.
    expect(waiting?.querySelector("[data-state='waiting']")).not.toBeNull();
    expect(waiting?.textContent).toContain("👤 7d Ada");
    expect(waiting?.className).toContain("text-k-muted");
    expect(pane.footer()).toContain("1 open, 0 blocked, 1 waiting");
  });

  it("opens the edit of a waiting row that names nobody with the cursor where the name goes", async () => {
    const line = "- [w] decision record 👤 2026-08-03 📅 2026-08-10";
    const pane = renderPane([{ path: "a.md", line: 1, text: line }]);
    await pane.loaded();
    expect(pane.rows()).toHaveLength(1);

    pane.press("i");

    const input = (await screen.findByLabelText("edit line")) as HTMLInputElement;
    await waitFor(() =>
      expect(input.selectionStart).toBe("- [w] decision record 👤 2026-08-03".length),
    );
  });

  it("finds what waits on somebody by the name typed into the filter", async () => {
    const pane = renderPane([
      { path: "a.md", line: 1, text: "- [w] decision record 👤 2026-08-03 [[Ada]]" },
      { path: "a.md", line: 2, text: "- [ ] buy milk" },
    ]);
    await pane.loaded();
    expect(pane.rows()).toHaveLength(2);

    fireEvent.change(pane.filter(), { target: { value: "ada" } });

    await waitFor(() => expect(pane.rows()).toHaveLength(1));
    expect(pane.rows()[0]?.textContent).toContain("decision record");
  });

  it("counts the open and blocked rows in the footer", async () => {
    const pane = renderPane();

    await pane.loaded();
    expect(pane.rows()).toHaveLength(6);
    expect(pane.footer()).toContain("5 open, 1 blocked");
  });

  it("draws a review row with its symbol, and not muted", async () => {
    const pane = renderPane([
      { path: "a.md", line: 1, text: "- [r] write the parser 📅 2026-08-10" },
      { path: "a.md", line: 2, text: "- [ ] buy milk 📅 2026-08-10" },
    ]);

    await pane.loaded();
    expect(pane.rows()).toHaveLength(2);
    const review = pane.rows().find((row) => row.textContent?.includes("write the parser"));
    // The state is drawn as its box now (#811), not as its symbol in the words.
    expect(review?.querySelector("[data-state='review']")).not.toBeNull();
    // Not held as blocked and waiting are: what it waits for is the owner's
    // eye, so it has to stand out rather than fade.
    expect(review?.className).toContain("text-k-ink");
    expect(review?.className).not.toContain("text-k-muted");
  });

  it("counts the rows waiting for review in the footer", async () => {
    const pane = renderPane([
      { path: "a.md", line: 1, text: "- [r] write the parser 📅 2026-08-10" },
      { path: "a.md", line: 2, text: "- [ ] buy milk 📅 2026-08-10" },
    ]);

    await pane.loaded();
    expect(pane.rows()).toHaveLength(2);
    expect(pane.footer()).toContain("1 open, 0 blocked, 1 to review");
  });
});
