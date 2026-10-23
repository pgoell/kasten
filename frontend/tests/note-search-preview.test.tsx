import { screen, waitFor } from "@testing-library/react";
import { NARROW, stubMatchMedia } from "./match-media";
import { linked, renderPreview, searchHooks } from "./note-search-fixture";

const { searchNotes, fetchNote, fetchTodos, fetchMentions } = vi.hoisted(() => ({
  searchNotes: vi.fn(),
  fetchNote: vi.fn(),
  fetchTodos: vi.fn(),
  fetchMentions: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ searchNotes, fetchNote, fetchTodos, fetchMentions }));

searchHooks();

it("reads and draws no preview in a narrow window", async () => {
  stubMatchMedia({ [NARROW]: true });
  searchNotes.mockResolvedValue([
    { path: "a.md", line: 3, text: linked("postgres") },
    { path: "b.md", line: 4, text: linked("postgres again") },
  ]);
  const search = renderPreview();

  search.type("postgres");
  await waitFor(() => expect(search.rows()).toHaveLength(2));
  // Past the delay the pane waits before it reads.
  await new Promise((done) => setTimeout(done, 300));

  expect(screen.queryByTestId("preview")).toBeNull();
  expect(fetchNote).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("the preview pane", () => {
  it("shows the note around the highlighted hit, with the matching line marked", async () => {
    fetchNote.mockResolvedValue("one\ntwo\nthree\nfour\nfive");
    searchNotes.mockResolvedValue([{ path: "a.md", line: 3, text: linked("three") }]);
    const search = renderPreview();

    search.type("three");

    await waitFor(() => expect(search.markedLine()).toContain("three"));
    // The lines either side are the point of the pane: the row above already
    // showed the matching line on its own.
    expect(search.preview()).toContain("two");
    expect(search.preview()).toContain("four");
  });

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

  it("holds at the start of the note when the hit is near the top", async () => {
    searchNotes.mockResolvedValue([{ path: "a.md", line: 2, text: linked("line 2") }]);
    const search = renderPreview();

    search.type("line 2");

    await waitFor(() => expect(search.markedLine()).toContain("line 2"));
    expect(search.preview()).toContain("line 1");
  });

  it("reads the note only once for two hits that are in it", async () => {
    // Walking between two hits of one note re-centres the pane on the second
    // without asking the vault for the note again.
    searchNotes.mockResolvedValue([
      { path: "a.md", line: 10, text: linked("line 10") },
      { path: "a.md", line: 90, text: linked("line 90") },
    ]);
    const search = renderPreview();

    search.type("line");
    await waitFor(() => expect(search.markedLine()).toContain("line 10"));

    search.press("ArrowDown");

    await waitFor(() => expect(search.markedLine()).toContain("line 90"));
    expect(fetchNote).toHaveBeenCalledTimes(1);
  });

  it("says so when the note behind a hit cannot be read", async () => {
    fetchNote.mockRejectedValue(new Error("gone"));
    searchNotes.mockResolvedValue([{ path: "a.md", line: 3, text: linked("postgres") }]);
    const search = renderPreview();

    search.type("postgres");

    await waitFor(() => expect(search.preview()).toContain("could not read this note"));
  });
});
