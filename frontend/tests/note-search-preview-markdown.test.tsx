import { forceParsing } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { act, screen, waitFor } from "@testing-library/react";
import { renderSearch, searchHooks } from "./note-search-fixture";

const { searchNotes, fetchNote, fetchTodos, fetchMentions } = vi.hoisted(() => ({
  searchNotes: vi.fn(),
  fetchNote: vi.fn(),
  fetchTodos: vi.fn(),
  fetchMentions: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ searchNotes, fetchNote, fetchTodos, fetchMentions }));

searchHooks();

/**
 * Parses the preview's note to the end before a test reads the rendering.
 *
 * The preview's first draw comes from the 20ms of parse CodeMirror gives at
 * state creation, which a loaded machine can spend before the heading (#437,
 * as #365 was for the editor).
 */
function parsePreview(): void {
  const dom = screen.getByTestId("preview").querySelector(".cm-editor") as HTMLElement;
  const view = EditorView.findFromDOM(dom) as EditorView;
  act(() => {
    forceParsing(view, view.state.doc.length, 5000);
  });
}

it("renders the markdown in the preview rather than showing its syntax", async () => {
  fetchNote.mockResolvedValue("line 1\n## a heading\nwith **bold** in it\nline 4");
  searchNotes.mockResolvedValue([{ path: "a.md", line: 3, text: "with **bold** in it" }]);
  const search = renderSearch();
  // A clock that leaps a second each read spends the first parse's 20ms after
  // one step, the way a starved machine does.
  let now = 0;
  const clock = vi.spyOn(Date, "now").mockImplementation(() => (now += 1000));

  search.type("bold");

  await waitFor(() => expect(search.preview()).toContain("a heading"));
  clock.mockRestore();
  parsePreview();
  expect(search.preview()).not.toContain("##");
  expect(search.preview()).not.toContain("**");
  expect(document.querySelector(".cm-strong")?.textContent).toBe("bold");
});

it("still numbers the lines and marks the hit once the markdown is rendered", async () => {
  fetchNote.mockResolvedValue("line 1\n## a heading\nwith bold in it\nline 4");
  searchNotes.mockResolvedValue([{ path: "a.md", line: 3, text: "with bold in it" }]);
  const search = renderSearch();

  search.type("bold");

  await waitFor(() => expect(search.preview()).toContain("a heading"));
  parsePreview();
  // The numbers are the note's own, not the window's, so a hit deep in a note
  // still says where it is.
  expect(search.lineNumbers()).toContain("3");
  expect(search.markedLine()).toContain("with bold in it");
});
