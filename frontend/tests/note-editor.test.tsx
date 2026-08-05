import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { NoteEditor } from "@/components/note-editor";

// The api module builds its client at import time and captures `fetch` there,
// so stubbing the global afterwards would never be seen. Standing in for the
// module is also the right level: what this component owns is the query and
// the remount, not the HTTP.
const { fetchNote } = vi.hoisted(() => ({ fetchNote: vi.fn() }));
vi.mock("@/lib/api", () => ({ fetchNote }));

// Single-line notes on purpose: CodeMirror's text content runs the lines
// together, so anything longer makes the assertions unreadable.
const VAULT: Record<string, string> = {
  "index.md": "# the index note",
  "daily/2026-08-05.md": "# the daily note",
};

function serveVault() {
  fetchNote.mockImplementation(async (path: string) => {
    const content = VAULT[path];
    if (content === undefined) throw new Error(`GET /api/files/${path} failed with 404`);
    return content;
  });
}

function renderNote(path: string) {
  // One client across the rerenders, so the second visit to a note is a cache
  // hit. Retries would only drag out the deliberate 404.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (open: string) => (
    <QueryClientProvider client={queryClient}>
      <NoteEditor path={open} />
    </QueryClientProvider>
  );

  const { container, rerender } = render(tree(path));

  return {
    text: () => container.querySelector(".cm-content")?.textContent,
    body: () => container.textContent,
    open: (next: string) => rerender(tree(next)),
  };
}

describe("NoteEditor", () => {
  beforeEach(serveVault);
  afterEach(() => fetchNote.mockReset());

  it("opens the note's text in the editor", async () => {
    const note = renderNote("index.md");

    await waitFor(() => expect(note.text()).toBe("# the index note"));
  });

  it("replaces the document when another note is opened", async () => {
    const note = renderNote("index.md");
    await waitFor(() => expect(note.text()).toBe("# the index note"));

    note.open("daily/2026-08-05.md");

    await waitFor(() => expect(note.text()).toBe("# the daily note"));
  });

  it("replaces the document even when the note is already cached", async () => {
    // The editor reads its document once, on mount. Coming back to a note that
    // is already in the cache leaves no loading gap to remount across, so this
    // is where a stale document survives.
    const note = renderNote("index.md");
    await waitFor(() => expect(note.text()).toBe("# the index note"));

    note.open("daily/2026-08-05.md");
    await waitFor(() => expect(note.text()).toBe("# the daily note"));

    note.open("index.md");

    await waitFor(() => expect(note.text()).toBe("# the index note"));
  });

  it("says so when the note cannot be read", async () => {
    const note = renderNote("gone.md");

    // Not just the path: "Opening gone.md" holds that too, so matching on it
    // alone would pass while the query is still in flight.
    await waitFor(() => expect(note.body()).toContain("Could not open gone.md"));
    expect(note.text()).toBeUndefined();
  });
});
