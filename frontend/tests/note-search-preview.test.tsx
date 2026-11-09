import { waitFor } from "@testing-library/react";
import { linked, renderPreview, searchHooks } from "./note-search-fixture";

const { searchNotes, fetchNote, fetchTodos, fetchMentions } = vi.hoisted(() => ({
  searchNotes: vi.fn(),
  fetchNote: vi.fn(),
  fetchTodos: vi.fn(),
  fetchMentions: vi.fn(),
}));
vi.mock("@/lib/core/api", () => ({ searchNotes, fetchNote, fetchTodos, fetchMentions }));

searchHooks();

describe("the preview pane", () => {
  // CodeMirror draws only the lines in view, so a journey cannot see the window's far edge.
  it("leaves out the parts of the note too far from the hit", async () => {
    searchNotes.mockResolvedValue([{ path: "a.md", line: 100, text: linked("line 100") }]);
    const search = renderPreview();

    search.type("line 100");

    await waitFor(() => expect(search.markedLine()).toContain("line 100"));
    expect(search.preview()).toContain("line 80");
    // A 200 line note costs the same as a 40 line one, which is what the
    // window is for.
    expect(search.preview()).not.toContain("line 5\n");
    expect(search.preview()).not.toContain("line 200");
  });
});
