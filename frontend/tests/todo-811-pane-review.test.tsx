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

/** Two finished this week, the fold's rows, and one open todo. */
const READ = { path: "a.md", line: 1, text: "- [x] read the spec ✅ 2026-08-08" };
const WRITE = { path: "a.md", line: 2, text: "- [x] write the spec ✅ 2026-08-07" };
const MILK = { path: "a.md", line: 3, text: "- [ ] buy milk 📅 2026-08-14" };
const DONE = [READ, WRITE, MILK];

/** The legend is the one the list draws, if it draws one. */
function legend() {
  return document.querySelector("ul[aria-label='legend']");
}

describe("the todo pane's review fixes", () => {
  it("#811 R7.3 x on a done row in the fold, then x again, acts on the same row", async () => {
    const pane = renderPane(DONE);
    await pane.loaded();
    expect(pane.texts().join()).toContain("buy milk");
    fireEvent.click(screen.getByRole("button", { name: /^Done this week/ }));

    pane.press("j");
    expect(pane.cursor()?.textContent).toContain("read the spec");
    pane.press("x");
    expect(pane.onCycle).toHaveBeenLastCalledWith(expect.objectContaining({ line: 1 }));

    // The write lands: the first line becomes prose, so it is no longer done. A
    // second done row arrives too, as the mark that the answer has been drawn.
    pane.answer([
      { path: "a.md", line: 1, text: "read the spec" },
      WRITE,
      MILK,
      { path: "a.md", line: 4, text: "- [x] ship it ✅ 2026-08-09" },
    ]);
    await waitFor(() => expect(pane.texts().join()).toContain("ship it"));

    expect(pane.cursor()?.textContent).toContain("read the spec");
    pane.press("x");
    expect(pane.onCycle).toHaveBeenCalledTimes(2);
    expect(pane.onCycle).toHaveBeenLastCalledWith(expect.objectContaining({ line: 1 }));
  });

  it("#811 R7.4 an open row checked off with the fold open is drawn once", async () => {
    const pane = renderPane(DONE);
    await pane.loaded();
    expect(pane.texts().join()).toContain("buy milk");
    fireEvent.click(screen.getByRole("button", { name: /^Done this week/ }));

    pane.press("x");
    expect(pane.onCycle).toHaveBeenLastCalledWith(expect.objectContaining({ line: 3 }));
    // The row is done now; a new open row arrives too, as the mark that the answer has been drawn.
    pane.answer([
      READ,
      WRITE,
      { path: "a.md", line: 3, text: "- [x] buy milk ✅ 2026-08-10" },
      { path: "a.md", line: 4, text: "- [ ] file the tax 📅 2026-08-10" },
    ]);
    await waitFor(() => expect(pane.texts().join()).toContain("file the tax"));

    expect(pane.texts().filter((text) => text.includes("buy milk"))).toHaveLength(1);
  });

  it("#811 R7.5 the legend is drawn on the open list, and not on d or n", async () => {
    const pane = renderPane(DONE);
    await pane.loaded();
    expect(pane.texts().join()).toContain("buy milk");
    expect(legend()).not.toBeNull();

    pane.press("d");
    expect(legend()).toBeNull();
    pane.press("n");
    expect(legend()).toBeNull();
  });
});
