import { fireEvent, screen, waitFor } from "@testing-library/react";
import { NARROW, stubMatchMedia } from "./match-media";
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
  describe("unlinked mentions", () => {
    const LINKED = { path: "index.md", line: 3, text: "see [[borges]]" };
    const MENTION = {
      path: "kafka.md",
      line: 5,
      text: "Borges wrote the library",
      start: 0,
      end: 6,
      name: "borges",
    };
    const OTHER = {
      path: "archive/notes.md",
      line: 2,
      text: "a story by borges",
      start: 11,
      end: 17,
      name: "borges",
    };

    it("#424 lists them in a group of their own after the links", async () => {
      searchNotes.mockResolvedValue([LINKED]);
      fetchMentions.mockResolvedValue([MENTION]);
      const panel = renderBacklinks();

      await waitFor(() => expect(panel.rows()).toHaveLength(2));
      expect(fetchMentions).toHaveBeenCalledWith("reading/borges.md", false);
      expect(panel.rows()[0]).toContain("see [[borges]]");
      expect(panel.groups()).toEqual([{ name: "unlinked mentions", rows: [expect.any(String)] }]);
      expect(panel.groups()[0]?.rows[0]).toContain("kafka.md:5");
      expect(panel.groups()[0]?.rows[0]).toContain("Borges wrote the library");
    });

    it("#424 shows the mentions under a note with more links than the list holds", async () => {
      searchNotes.mockResolvedValue(
        Array.from({ length: 25 }, (_, i) => ({
          path: `links/${i}.md`,
          line: 1,
          text: `see [[borges]] ${i}`,
        })),
      );
      fetchMentions.mockResolvedValue([MENTION]);
      const panel = renderBacklinks();

      await waitFor(() =>
        expect(panel.groups().find((group) => group.name === "unlinked mentions")?.rows).toEqual([
          expect.stringContaining("Borges wrote the library"),
        ]),
      );
    });

    it("#424 still says nothing links here when there are only mentions", async () => {
      searchNotes.mockResolvedValue([]);
      fetchMentions.mockResolvedValue([MENTION]);
      const panel = renderBacklinks();

      await waitFor(() => expect(panel.rows()).toHaveLength(1));
      await waitFor(() => expect(panel.hint()).toBe("nothing links here"));
    });

    it("#424 narrows the mentions as you type, and Enter opens one on its line", async () => {
      searchNotes.mockResolvedValue([LINKED]);
      fetchMentions.mockResolvedValue([MENTION, OTHER]);
      const panel = renderBacklinks();
      await waitFor(() => expect(panel.rows()).toHaveLength(3));

      panel.type("story");
      await waitFor(() => expect(panel.rows()).toHaveLength(1));
      panel.press("Enter");

      expect(panel.onOpen).toHaveBeenCalledWith("archive/notes.md", 2);
      expect(panel.onLink).not.toHaveBeenCalled();
    });

    it("#424 links the highlighted mention on ctrl or cmd enter", async () => {
      searchNotes.mockResolvedValue([LINKED]);
      fetchMentions.mockResolvedValue([MENTION, OTHER]);
      const panel = renderBacklinks();
      await waitFor(() => expect(panel.rows()).toHaveLength(3));

      panel.press("Tab");
      panel.press("Enter", { ctrlKey: true });
      await waitFor(() => expect(panel.onLink).toHaveBeenCalledWith(MENTION));
      panel.press("Tab");
      panel.press("Enter", { metaKey: true });
      await waitFor(() => expect(panel.onLink).toHaveBeenLastCalledWith(OTHER));

      expect(panel.onOpen).not.toHaveBeenCalled();
    });

    it("#424 links on a tap of the row's link button, keeping the focus and not opening", async () => {
      stubMatchMedia({ [NARROW]: true });
      try {
        searchNotes.mockResolvedValue([]);
        fetchMentions.mockResolvedValue([MENTION]);
        const panel = renderBacklinks();
        await waitFor(() => expect(panel.rows()).toHaveLength(1));

        const button = screen.getByRole("button", { name: "link" });
        expect(button).toHaveClass("pointer-coarse:min-h-11");
        // A press that moved the focus would be one the browser was let do.
        expect(fireEvent.mouseDown(button)).toBe(false);
        fireEvent.click(button);

        await waitFor(() => expect(panel.onLink).toHaveBeenCalledWith(MENTION));
        expect(panel.onOpen).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(panel.input);
        expect(screen.queryByTestId("preview")).toBeNull();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("#424 says why a link was not written, keeps the row, and sends one at a time", async () => {
      let answer: (reason: string | null) => void = () => {};
      const onLink = vi.fn(
        () =>
          new Promise<string | null>((resolve) => {
            answer = resolve;
          }),
      );
      searchNotes.mockResolvedValue([]);
      fetchMentions.mockResolvedValue([MENTION]);
      const panel = renderBacklinks(PATHS, "reading/borges.md", onLink);
      await waitFor(() => expect(panel.rows()).toHaveLength(1));

      panel.press("Enter", { ctrlKey: true });
      panel.press("Enter", { ctrlKey: true });
      fireEvent.click(screen.getByRole("button", { name: "link" }));
      expect(onLink).toHaveBeenCalledTimes(1);

      answer("That note is still being saved");
      await waitFor(() => expect(panel.hint()).toBe("That note is still being saved"));
      expect(panel.rows()).toHaveLength(1);
    });

    it("#424 lets go of the reason a link was not written once the query changes", async () => {
      const onLink = vi.fn(async () => "That note is still being saved");
      searchNotes.mockResolvedValue([]);
      fetchMentions.mockResolvedValue([MENTION]);
      const panel = renderBacklinks(PATHS, "reading/borges.md", onLink);
      await waitFor(() => expect(panel.rows()).toHaveLength(1));
      panel.press("Enter", { ctrlKey: true });
      await waitFor(() => expect(panel.hint()).toBe("That note is still being saved"));

      panel.type("library");

      expect(panel.hint()).toBe("nothing links here");
    });
  });
});
