import { waitFor } from "@testing-library/react";
import { PATHS, renderBacklinks, searchHooks } from "./note-search-fixture";

const { searchNotes, fetchNote, fetchTodos, fetchMentions } = vi.hoisted(() => ({
  searchNotes: vi.fn(),
  fetchNote: vi.fn(),
  fetchTodos: vi.fn(),
  fetchMentions: vi.fn(),
}));
vi.mock("@/lib/core/api", () => ({ searchNotes, fetchNote, fetchTodos, fetchMentions }));

searchHooks();

describe("backlinks", () => {
  // The e2e vault holds no two notes of one name, so the journeys cannot reach this case.
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
});
