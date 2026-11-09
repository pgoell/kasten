import { waitFor } from "@testing-library/react";
import { renderBacklinks, searchHooks } from "./note-search-fixture";

const { searchNotes, fetchNote, fetchTodos, fetchMentions } = vi.hoisted(() => ({
  searchNotes: vi.fn(),
  fetchNote: vi.fn(),
  fetchTodos: vi.fn(),
  fetchMentions: vi.fn(),
}));
vi.mock("@/lib/core/api", () => ({ searchNotes, fetchNote, fetchTodos, fetchMentions }));

searchHooks();

describe("backlinks", () => {
  describe("grouped by the name in front", () => {
    // React's key warning prints only in a dev build, and the journeys run the production one.
    it("draws a relation actually named untyped beside the untyped group", async () => {
      // Rule 9 makes `untyped` as legal a name as any other, so the two groups
      // can be siblings. Keyed by a word rather than by position, React would
      // call them the same child and remount one instead of updating it.
      const warned = vi.spyOn(console, "error").mockImplementation(() => {});
      searchNotes.mockResolvedValue([
        { path: "index.md", line: 3, text: "untyped:: [[borges]]" },
        { path: "index.md", line: 4, text: "see [[borges]]" },
      ]);
      const panel = renderBacklinks();

      await waitFor(() => expect(panel.rows()).toHaveLength(2));

      expect(panel.groups().map(({ name }) => name)).toEqual(["untyped"]);
      expect(warned).not.toHaveBeenCalled();
      warned.mockRestore();
    });
  });
});
