import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useCallback, useMemo } from "react";
import { Editor } from "@/components/editor";
import { NoteEditor } from "@/components/note-editor";
import { StatusBar } from "@/components/status-bar";
import type { EditorCommands } from "@/lib/key-bindings";
import { useAutosave } from "@/lib/use-autosave";

// The api module builds its client at import time and captures `fetch` there,
// so stubbing the global afterwards would never be seen. Standing in for the
// module is also the right level: what this component owns is the query and
// the remount, not the HTTP.
const { fetchNote, saveNote } = vi.hoisted(() => ({ fetchNote: vi.fn(), saveNote: vi.fn() }));
vi.mock("@/lib/api", () => ({ fetchNote, saveNote }));

// Render counters for the two components below. `spy: true` keeps the real
// implementation and only records the calls, so counting costs the tree
// nothing: no extra element, no changed props identity, no memo defeated. A
// wrapper component would count its own renders instead, which is the wrong
// number the moment anything below it stops re-rendering.
vi.mock("@/components/editor", { spy: true });
vi.mock("@/components/status-bar", { spy: true });

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

// Out here for the reason `commands` below is held across renders: the route's
// own follow handler is a `useCallback`, and a fresh literal per render would
// hand the editor a new prop on every keystroke.
const follow = () => {};

/** What the route puts around an open note: autosave, the editor, the bar. */
function OpenNote({ path }: { path: string }) {
  const { status, change, save, reconcile } = useAutosave(path);
  // What the route wires, and the reason this harness exists: the editor asks
  // the autosave before it takes the vault's text, and the autosave is what
  // knows whether anything is waiting. No digest, the text having come back
  // through the query rather than off the stream.
  const allowReload = useCallback(() => reconcile(null), [reconcile]);
  // Held across renders because the route holds it across renders too. A fresh
  // literal here would hand the editor a new prop on every keystroke, and the
  // render-count test below would then be measuring this harness rather than
  // the components it names.
  const commands = useMemo<EditorCommands>(
    () => ({
      toggleTree: () => {},
      togglePreview: () => {},
      closeNote: () => {},
      showHelp: () => {},
      createNote: () => {},
      renameNote: () => {},
      findNote: vi.fn(),
      searchNotes: vi.fn(),
      showBacklinks: vi.fn(),
      showLinksOut: vi.fn(),
      focusTree: () => {},
      createTab: () => {},
      splitRight: () => {},
      splitDown: () => {},
      nextPane: () => {},
      paneLeft: () => {},
      paneDown: () => {},
      paneUp: () => {},
      paneRight: () => {},
      nextTab: () => {},
      prevTab: () => {},
      goToTab: () => {},
    }),
    [],
  );

  return (
    <>
      <NoteEditor
        path={path}
        commands={commands}
        preview
        onChange={change}
        onSave={save}
        onFollow={follow}
        allowReload={allowReload}
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
    // What an event from the vault does to an open note, and what the query
    // made of the read that followed. Both go through the client, because a
    // read that failed while the note stays on screen leaves nothing to wait on.
    reread: (target: string) => queryClient.invalidateQueries({ queryKey: ["note", target] }),
    readError: (target: string) => queryClient.getQueryState(["note", target])?.error,
  };
}

describe("an open note", () => {
  beforeEach(() => {
    serveVault();
    // A vault that stamps nothing, so what comes back is what was sent. The
    // test that turns on the difference writes its own.
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
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

  /**
   * The components that must not render again while a note is typed into.
   *
   * `Editor` owns the CodeMirror view, and the note at the top of that file
   * says it plainly: re-rendering the React tree around it on every keystroke
   * is where this pattern's performance goes. `NoteEditor` is the component
   * directly above it, and with the note open it renders `Editor` and nothing
   * else, with no memo of its own. So one counter answers for both: `Editor`
   * cannot render without `NoteEditor` having rendered first.
   *
   * `StatusBar` is deliberately not on that list. The bar reports whether the
   * vault holds what the screen holds, and the first keystroke of an edit
   * turns that from saved to unsaved, so a render there is the bar doing its
   * job. Its count is asserted to move instead, which is what proves the
   * keystrokes reached React state at all and that the zero above is a fact
   * rather than a harness that swallowed the input.
   */
  it("renders nothing around the editor again while the note is typed into", async () => {
    const note = renderNote("index.md");
    await waitFor(() => expect(note.text()).toBe("the index note"));

    // Both counters stand at 1 from the mount, so clearing them is what makes
    // the assertion below reachable at all.
    vi.mocked(Editor).mockClear();
    vi.mocked(StatusBar).mockClear();

    // `x` in vim normal mode deletes the character under the cursor, so five
    // presses are five document changes. Insert mode is not an option here:
    // typed text reaches CodeMirror through beforeinput on a contenteditable,
    // which jsdom does not produce from a synthetic keydown.
    for (let i = 0; i < 5; i += 1) note.press("x");

    // Five characters gone off the front, so all five presses landed.
    expect(note.text()).toBe("ndex note");
    expect(vi.mocked(StatusBar).mock.calls.length).toBeGreaterThan(0);
    expect(vi.mocked(Editor).mock.calls.length).toBe(0);
  });

  it("takes text written to the note while it is open", async () => {
    // The whole path in one test: something else writes the vault, the query
    // behind the open note reads it again, and the editor takes what comes
    // back. `editor.test.tsx` proves the effect; this proves it is reached.
    const note = renderNote("index.md");
    await waitFor(() => expect(note.text()).toBe("the index note"));

    fetchNote.mockResolvedValue("the index note, rewritten");
    await note.reread("index.md");

    await waitFor(() => expect(note.text()).toBe("the index note, rewritten"));
  });

  it("keeps unsaved text on screen when a write from the vault lands under it", async () => {
    // The three parts wired together, which is the only place this is true.
    // The buffer was clean when the vault reported the write, so the read went
    // out; the reader typed while it was in flight. Deciding when the event
    // arrives and dispatching when the answer lands are not the same moment,
    // and the editor asks again at the second one.
    const note = renderNote("index.md");
    await waitFor(() => expect(note.text()).toBe("the index note"));

    fetchNote.mockResolvedValue("the index note, rewritten elsewhere");
    // `x` deletes the character under the cursor, which opens at the top.
    note.press("x");
    await note.reread("index.md");
    await waitFor(() => expect(fetchNote).toHaveBeenCalledTimes(2));

    expect(note.text()).toBe("he index note");
    // The refusal reaches the bar a render later than it reaches the document.
    await waitFor(() => expect(note.status()).toBe("Changed on disk"));
  });

  it("takes a write from the vault when nothing is waiting, and says nothing about it", async () => {
    // The other side of the test above: a clean buffer is what the reload is
    // for, and refusing every reload would pass that one on its own.
    const note = renderNote("index.md");
    await waitFor(() => expect(note.text()).toBe("the index note"));

    fetchNote.mockResolvedValue("the index note, rewritten elsewhere");
    await note.reread("index.md");

    await waitFor(() => expect(note.text()).toBe("the index note, rewritten elsewhere"));
    expect(note.status()).toBe("Saved");
  });

  it("keeps a keystroke typed after a save, which the note's own event would revert", async () => {
    // The whole loss in one test. `PUT` stamps a fresh `modified`, so the vault
    // holds text the cache never saw; the write comes back as an event, the
    // query reads it, and the editor takes it. Anything typed in between is
    // wiped off the screen, and typing on from there wipes it from the vault.
    const note = renderNote("index.md");
    await waitFor(() => expect(note.text()).toBe("the index note"));

    saveNote.mockImplementation(async (path: string, content: string) => {
      const stamped = `${content} stamped`;
      fetchNote.mockResolvedValue(stamped);
      return { path, content: stamped };
    });

    // `x` deletes the character under the cursor, which opens at the top.
    note.press("x");
    note.press("s", { ctrlKey: true });
    await waitFor(() => expect(note.status()).toBe("Saved"));

    // Typed between the write landing and the vault reporting it.
    note.press("x");
    await note.reread("index.md");
    await waitFor(() => expect(fetchNote).toHaveBeenCalledTimes(2));

    expect(note.text()).toBe("e index note stamped");
  });

  it("keeps the note on screen when a later read of it fails", async () => {
    const note = renderNote("index.md");
    await waitFor(() => expect(note.text()).toBe("the index note"));

    fetchNote.mockRejectedValue(new Error("GET /api/files/index.md failed with 500"));
    await note.reread("index.md");

    await waitFor(() => expect(note.readError("index.md")).not.toBeNull());
    expect(note.text()).toBe("the index note");
    expect(note.body()).not.toContain("Could not open");
  });

  it("says so when the note cannot be read", async () => {
    const note = renderNote("gone.md");

    // Not just the path: "Opening gone.md" holds that too, so matching on it
    // alone would pass while the query is still in flight.
    await waitFor(() => expect(note.body()).toContain("Could not open gone.md"));
    expect(note.text()).toBeUndefined();
  });
});
