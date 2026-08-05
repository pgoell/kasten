import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { NoteEditor } from "@/components/note-editor";
import { StatusBar } from "@/components/status-bar";
import { useAutosave } from "@/lib/use-autosave";

// The api module builds its client at import time and captures `fetch` there,
// so stubbing the global afterwards would never be seen. Standing in for the
// module is also the right level: what this component owns is the query and
// the remount, not the HTTP.
const { fetchNote, saveNote } = vi.hoisted(() => ({ fetchNote: vi.fn(), saveNote: vi.fn() }));
vi.mock("@/lib/api", () => ({ fetchNote, saveNote }));

// Single-line notes on purpose: CodeMirror's text content runs the lines
// together, so anything longer makes the assertions unreadable. No markdown
// syntax either, because live preview hides the marks and these tests are about
// which note is open, not about how one is rendered.
const VAULT: Record<string, string> = {
  "index.md": "the index note",
  "daily/2026-08-05.md": "the daily note",
};

function serveVault() {
  fetchNote.mockImplementation(async (path: string) => {
    const content = VAULT[path];
    if (content === undefined) throw new Error(`GET /api/files/${path} failed with 404`);
    return content;
  });
}

/** What the route puts around an open note: autosave, the editor, the bar. */
function OpenNote({ path }: { path: string }) {
  const { status, change, save } = useAutosave(path);

  return (
    <>
      <NoteEditor
        path={path}
        commands={{
          toggleTree: () => {},
          togglePreview: () => {},
          closeNote: () => {},
          showHelp: () => {},
          focusTree: () => {},
        }}
        preview
        onChange={change}
        onSave={save}
      />
      <StatusBar status={status} />
    </>
  );
}

function renderNote(path: string) {
  // One client across the rerenders, so the second visit to a note is a cache
  // hit. Retries would only drag out the deliberate 404.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (open: string) => (
    <QueryClientProvider client={queryClient}>
      <OpenNote path={open} />
    </QueryClientProvider>
  );

  const { container, rerender } = render(tree(path));

  return {
    text: () => container.querySelector(".cm-content")?.textContent,
    body: () => container.textContent,
    open: (next: string) => rerender(tree(next)),
    status: () =>
      container.querySelector("[data-testid='save-status']")?.getAttribute("aria-label"),
    spinner: () => container.querySelector("[data-testid='save-spinner']"),
    errorIcon: () => container.querySelector("[data-testid='save-error']"),
    press: (key: string, init?: KeyboardEventInit) =>
      fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key, ...init }),
  };
}

describe("an open note", () => {
  beforeEach(() => {
    serveVault();
    saveNote.mockResolvedValue(undefined);
  });

  afterEach(() => {
    // By hand and first: closing an edited note writes it, so the automatic
    // cleanup would otherwise reach a mock that has already been reset.
    cleanup();
    fetchNote.mockReset();
    saveNote.mockReset();
  });

  it("opens the note's text in the editor", async () => {
    const note = renderNote("index.md");

    await waitFor(() => expect(note.text()).toBe("the index note"));
  });

  it("replaces the document when another note is opened", async () => {
    const note = renderNote("index.md");
    await waitFor(() => expect(note.text()).toBe("the index note"));

    note.open("daily/2026-08-05.md");

    await waitFor(() => expect(note.text()).toBe("the daily note"));
  });

  it("replaces the document even when the note is already cached", async () => {
    // The editor reads its document once, on mount. Coming back to a note that
    // is already in the cache leaves no loading gap to remount across, so this
    // is where a stale document survives.
    const note = renderNote("index.md");
    await waitFor(() => expect(note.text()).toBe("the index note"));

    note.open("daily/2026-08-05.md");
    await waitFor(() => expect(note.text()).toBe("the daily note"));

    note.open("index.md");

    await waitFor(() => expect(note.text()).toBe("the index note"));
  });

  it("rests the spinner when the note has only just been opened", async () => {
    const note = renderNote("index.md");

    await waitFor(() => expect(note.text()).toBe("the index note"));

    expect(note.status()).toBe("Saved");
    expect(note.spinner()?.classList).not.toContain("animate-spin");
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("spins the spinner while an edit is waiting to go out", async () => {
    const note = renderNote("index.md");
    await waitFor(() => expect(note.text()).toBe("the index note"));

    // `dd` in vim normal mode deletes the line, which is a document change.
    note.press("d");
    note.press("d");

    expect(note.status()).toBe("Unsaved changes");
    expect(note.spinner()?.classList).toContain("animate-spin");
  });

  it("writes the note on ctrl+s and rests the spinner again", async () => {
    const note = renderNote("index.md");
    await waitFor(() => expect(note.text()).toBe("the index note"));

    note.press("d");
    note.press("d");
    note.press("s", { ctrlKey: true });

    await waitFor(() => expect(saveNote).toHaveBeenCalledWith("index.md", ""));
    await waitFor(() => expect(note.status()).toBe("Saved"));
    expect(note.spinner()?.classList).not.toContain("animate-spin");
  });

  it("shows the warning sign when the note cannot be written", async () => {
    saveNote.mockRejectedValue(new Error("PUT /api/files/index.md failed with 500"));
    const note = renderNote("index.md");
    await waitFor(() => expect(note.text()).toBe("the index note"));

    note.press("d");
    note.press("d");
    note.press("s", { ctrlKey: true });

    await waitFor(() => expect(note.status()).toBe("Could not save"));
    expect(note.errorIcon()).not.toBeNull();
    expect(note.spinner()).toBeNull();
  });

  it("says so when the note cannot be read", async () => {
    const note = renderNote("gone.md");

    // Not just the path: "Opening gone.md" holds that too, so matching on it
    // alone would pass while the query is still in flight.
    await waitFor(() => expect(note.body()).toContain("Could not open gone.md"));
    expect(note.text()).toBeUndefined();
  });
});
