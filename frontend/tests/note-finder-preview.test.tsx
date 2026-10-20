import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import { NARROW, stubMatchMedia } from "./match-media";
import { PATHS, renderFinder } from "./note-finder-fixture";

// The api module builds its client at import time and captures `fetch` there,
// so stubbing the global afterwards would never be seen. Standing in for the
// module is also the right level: what this component owns is which note it
// asks for and how often, not the HTTP.
const { fetchNote } = vi.hoisted(() => ({ fetchNote: vi.fn() }));
vi.mock("@/lib/api", () => ({ fetchNote }));

describe("the note finder", () => {
  beforeEach(() => {
    fetchNote.mockResolvedValue("# a note");
  });

  afterEach(() => {
    fetchNote.mockReset();
  });

  it("reads and draws no preview in a narrow window", async () => {
    stubMatchMedia({ [NARROW]: true });
    const finder = renderFinder();
    expect(finder.highlighted()).toBe(PATHS[0]);

    // Past the delay the pane waits before it reads.
    await new Promise((done) => setTimeout(done, 300));

    expect(screen.queryByTestId("preview")).toBeNull();
    expect(fetchNote).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("the note finder's preview", () => {
  beforeEach(() => {
    fetchNote.mockResolvedValue("# a note");
  });

  afterEach(() => {
    fetchNote.mockReset();
  });

  it("shows the text of the note under the highlight", async () => {
    const finder = renderFinder();

    // Rendered, so the heading's `#` is hidden the way the editor hides it.
    await waitFor(() => expect(finder.preview()).toBe("a note"));
    expect(fetchNote).toHaveBeenCalledWith(PATHS[0]);
  });

  it("renders the markdown rather than showing its syntax", async () => {
    // The same rendering the editor does, so the pane shows the note the way
    // opening it will. Anything else makes the preview a different document
    // from the one behind it.
    fetchNote.mockResolvedValue("# a note\n\nwith **bold** in it");
    const finder = renderFinder();

    await waitFor(() => expect(finder.preview()).toContain("with bold in it"));
    expect(finder.preview()).not.toContain("#");
    expect(finder.preview()).not.toContain("**");
    expect(document.querySelector(".cm-strong")?.textContent).toBe("bold");
  });

  it("asks for one note when the highlight is walked and brought back", async () => {
    // Holding ctrl+n walks a row per repeat. Without the delay every row it
    // passed through would be a request, and the only answer that matters is
    // the one it stopped on.
    const finder = renderFinder();

    finder.press("ArrowDown");
    finder.press("ArrowDown");
    finder.press("ArrowUp");
    finder.press("ArrowUp");

    await waitFor(() => expect(finder.preview()).toBe("a note"));
    expect(fetchNote).toHaveBeenCalledTimes(1);
    expect(fetchNote).toHaveBeenCalledWith(PATHS[0]);
  });

  it("reads a note the cache already holds without asking for it", async () => {
    // The key is the one NoteEditor reads, so a note that is open is already
    // here, and the preview of it costs nothing.
    const queryClient = new QueryClient();
    queryClient.setQueryData(["note", PATHS[0]], "# already open");

    const finder = renderFinder(PATHS, queryClient);

    await waitFor(() => expect(finder.preview()).toBe("already open"));
    expect(fetchNote).not.toHaveBeenCalled();
  });

  it("says so when the note cannot be read, and still opens it on enter", async () => {
    fetchNote.mockRejectedValue(new Error("GET /api/files/x failed with 500"));
    const finder = renderFinder();

    await waitFor(() => expect(finder.preview()).toBe("could not read this note"));
    // The list is what the finder is for, and a preview that failed is no
    // reason to stop being able to open the row.
    expect(finder.rows()).toEqual(PATHS);

    finder.press("Enter");

    expect(finder.onOpen).toHaveBeenCalledWith(PATHS[0]);
  });

  it("shows an empty pane for an empty note rather than waiting forever", async () => {
    fetchNote.mockResolvedValue("");
    const finder = renderFinder();

    await waitFor(() => expect(fetchNote).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(finder.preview()).toBe(""));
  });

  it("shows no pane at all when nothing is highlighted", () => {
    const finder = renderFinder();

    finder.type("zzz");

    expect(screen.queryByTestId("preview")).toBeNull();
    expect(fetchNote).not.toHaveBeenCalled();
  });
});
