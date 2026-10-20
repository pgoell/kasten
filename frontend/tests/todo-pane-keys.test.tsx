import { fireEvent, screen, waitFor } from "@testing-library/react";
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

  it("names only the keys this phase binds", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    expect(pane.footer()).toContain("x cycle");
    expect(pane.footer()).toContain("a add");
    expect(pane.footer()).toContain("s part");
    expect(pane.footer()).toContain("i edit");
    expect(pane.footer()).toContain("d done");
    expect(pane.footer()).toContain("n next");
    expect(pane.footer()).toContain("O P V X B W R state");
    expect(pane.footer()).toContain("/ filter");
    expect(pane.footer()).toContain("q close");
    expect(pane.footer()).toContain("t timer");
    expect(pane.footer()).toContain("v view");
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
});
