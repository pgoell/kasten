import { waitFor } from "@testing-library/react";
import { PATHS, renderBacklinks, searchHooks } from "./note-search-fixture";

const { searchNotes, fetchNote, fetchTodos, fetchMentions } = vi.hoisted(() => ({
  searchNotes: vi.fn(),
  fetchNote: vi.fn(),
  fetchTodos: vi.fn(),
  fetchMentions: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ searchNotes, fetchNote, fetchTodos, fetchMentions }));

searchHooks();

describe("backlinks", () => {
  it("asks the vault for the note's name without waiting to be typed into", async () => {
    renderBacklinks();

    // Every link to the note carries its name, whether it spelled the path out
    // or not, so the name is the one query that cannot miss one.
    await waitFor(() => expect(searchNotes).toHaveBeenCalledWith("borges", false));
  });

  it("keeps the lines that link here and drops the ones that only say the name", async () => {
    searchNotes.mockResolvedValue([
      { path: "index.md", line: 3, text: "see [[borges]]" },
      { path: "index.md", line: 9, text: "borges wrote the library" },
    ]);
    const panel = renderBacklinks();

    await waitFor(() => expect(panel.rows()).toHaveLength(1));
    expect(panel.rows()[0]).toContain("see [[borges]]");
  });

  it("keeps a link that spelled the path out", async () => {
    searchNotes.mockResolvedValue([{ path: "index.md", line: 3, text: "see [[reading/borges]]" }]);
    const panel = renderBacklinks();

    await waitFor(() => expect(panel.rows()).toHaveLength(1));
  });

  it("keeps a link written with an alias or a heading, embedded or not", async () => {
    searchNotes.mockResolvedValue([
      { path: "index.md", line: 3, text: "see [[borges|Jorge]]" },
      { path: "index.md", line: 4, text: "see [[borges#Life]]" },
      { path: "index.md", line: 5, text: "![[borges#Life]]" },
      { path: "index.md", line: 6, text: "![[reading/borges|Jorge]]" },
    ]);
    const panel = renderBacklinks();

    await waitFor(() => expect(panel.rows()).toHaveLength(4));
  });

  it("drops a link that names another note of a similar name", async () => {
    searchNotes.mockResolvedValue([
      { path: "index.md", line: 3, text: "see [[archive/borges]]" },
      { path: "index.md", line: 4, text: "see [[borges]]" },
    ]);
    // With a `borges.md` at the root, a bare name names that one, so neither
    // line is a link to the note in `reading/`.
    const panel = renderBacklinks([...PATHS, "borges.md"]);

    await waitFor(() => expect(panel.hint()).toBe("nothing links here"));
    expect(panel.rows()).toHaveLength(0);
  });

  it("narrows what links here as you type", async () => {
    searchNotes.mockResolvedValue([
      { path: "index.md", line: 3, text: "see [[borges]]" },
      { path: "archive/notes.md", line: 7, text: "the library of [[borges]]" },
    ]);
    const panel = renderBacklinks();
    await waitFor(() => expect(panel.rows()).toHaveLength(2));

    panel.type("library");

    // Typing filters the answer already in hand. Nothing is asked of the vault
    // a second time: what links here is a fixed set.
    await waitFor(() => expect(panel.rows()).toHaveLength(1));
    expect(searchNotes).toHaveBeenCalledTimes(1);
  });

  it("walks the rows on tab", async () => {
    searchNotes.mockResolvedValue([
      { path: "index.md", line: 3, text: "see [[borges]]" },
      { path: "archive/notes.md", line: 7, text: "and [[borges]]" },
    ]);
    const panel = renderBacklinks();
    await waitFor(() => expect(panel.rows()).toHaveLength(2));

    panel.press("Tab");
    panel.press("Enter");

    expect(panel.onOpen).toHaveBeenCalledWith("archive/notes.md", 7);
  });

  it("walks back up on shift tab", async () => {
    searchNotes.mockResolvedValue([
      { path: "index.md", line: 3, text: "see [[borges]]" },
      { path: "archive/notes.md", line: 7, text: "and [[borges]]" },
    ]);
    const panel = renderBacklinks();
    await waitFor(() => expect(panel.rows()).toHaveLength(2));

    panel.press("Tab");
    panel.press("Tab", { shiftKey: true });
    panel.press("Enter");

    expect(panel.onOpen).toHaveBeenCalledWith("index.md", 3);
  });

  it("says so when nothing links here", async () => {
    searchNotes.mockResolvedValue([]);
    const panel = renderBacklinks();

    await waitFor(() => expect(panel.hint()).toBe("nothing links here"));
  });
});
