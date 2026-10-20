import { cleanup, waitFor } from "@testing-library/react";
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
  describe("grouped by the name in front", () => {
    it("draws a heading per relation name and leaves the untyped links last", async () => {
      searchNotes.mockResolvedValue([
        { path: "index.md", line: 3, text: "depends-on:: [[borges]]" },
        { path: "index.md", line: 4, text: "see [[borges]]" },
        { path: "archive/notes.md", line: 7, text: "depends-on:: [[borges]]" },
      ]);
      const panel = renderBacklinks();

      await waitFor(() => expect(panel.rows()).toHaveLength(3));
      expect(panel.groups()).toHaveLength(1);
      expect(panel.groups()[0]?.name).toBe("depends-on");
      expect(panel.groups()[0]?.rows).toHaveLength(2);
      // Under no heading of its own, and after the two that have one.
      expect(panel.rows()[2]).toContain("see [[borges]]");
    });

    it("types a line by the target that resolves here, not by the name alone", async () => {
      // The panel keeps this line in both notes' backlinks, and only one end of
      // it is a dependency. Reading the name without the target would tell
      // kafka it is one.
      const line = { path: "index.md", line: 3, text: "depends-on:: [[borges]] because [[kafka]]" };
      searchNotes.mockResolvedValue([line]);
      const borges = renderBacklinks();

      await waitFor(() => expect(borges.rows()).toHaveLength(1));
      expect(borges.groups()[0]?.name).toBe("depends-on");

      cleanup();
      const kafka = renderBacklinks(PATHS, "kafka.md");

      await waitFor(() => expect(kafka.rows()).toHaveLength(1));
      expect(kafka.groups()).toHaveLength(0);
    });

    it("groups a relation written with an alias or a heading under its name", async () => {
      searchNotes.mockResolvedValue([
        { path: "index.md", line: 3, text: "rel:: [[borges|Jorge]]" },
        { path: "index.md", line: 4, text: "rel:: [[borges#Life]]" },
      ]);
      const panel = renderBacklinks();

      await waitFor(() => expect(panel.rows()).toHaveLength(2));
      expect(panel.groups()).toEqual([{ name: "rel", rows: expect.any(Array) }]);
      expect(panel.groups()[0]?.rows).toHaveLength(2);
    });

    it("groups a name nothing has defined under its own spelling", async () => {
      searchNotes.mockResolvedValue([
        { path: "index.md", line: 3, text: "invented-thing:: [[borges]]" },
      ]);
      const panel = renderBacklinks();

      await waitFor(() => expect(panel.rows()).toHaveLength(1));
      expect(panel.groups()[0]?.name).toBe("invented-thing");
    });

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

    // The two below are the ones grouping at render alone would ship broken:
    // the highlight, the preview and Enter all read one array, and moving a row
    // on screen without moving it there points them at another line.
    const MOVED = [
      { path: "index.md", line: 4, text: "see [[borges]]" },
      { path: "archive/notes.md", line: 7, text: "depends-on:: [[borges]]" },
    ];

    it("opens the row drawn first, not the row ranked first", async () => {
      searchNotes.mockResolvedValue(MOVED);
      const panel = renderBacklinks();
      await waitFor(() => expect(panel.rows()).toHaveLength(2));

      panel.press("Enter");

      expect(panel.onOpen).toHaveBeenCalledWith("archive/notes.md", 7);
    });

    it("walks to the row drawn second", async () => {
      searchNotes.mockResolvedValue(MOVED);
      const panel = renderBacklinks();
      await waitFor(() => expect(panel.rows()).toHaveLength(2));

      panel.press("ArrowDown");

      expect(panel.selected()).toBe(1);
      panel.press("Enter");
      expect(panel.onOpen).toHaveBeenCalledWith("index.md", 4);
    });
  });
});
