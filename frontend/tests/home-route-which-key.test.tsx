import { EditorView } from "@codemirror/view";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { noteBase } from "@/lib/note-base";
import { defineFoliateFake } from "./foliate-fake";
import {
  baseOf,
  editing,
  pageHooks,
  renderApp,
  settle,
  somebodyElseWrote,
  theRoute,
} from "./home-route-fixture";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";

defineFoliateFake();

// The doubles, the same in every home-route file: see home-route-fixture.tsx.
const {
  fetchFiles,
  fetchNote,
  saveNote,
  updateNote,
  searchNotes,
  fetchMentions,
  createNote,
  renameNote,
  moveFolder,
  deleteNote,
  fetchTrash,
  restoreEntry,
  fetchTerminals,
  fetchTodos,
  fetchBook,
  uploadAsset,
  fetchImages,
  fetchHtml,
  fetchAssets,
  deleteImage,
  fetchVersion,
  fetchTags,
  fetchHistory,
  fetchHistoryText,
} = vi.hoisted(() => {
  const beside = (note: string, suffix = ".epub") => ({
    path: note.replace(/\.md$/, suffix),
    blob: new Blob(["a book"]),
  });

  const fetchNote = vi.fn();
  const saveNote = vi.fn();

  return {
    beside,
    fetchFiles: vi.fn(),
    fetchNote,
    saveNote,
    updateNote: vi.fn(async (path: string, change: (text: string) => string | null) => {
      const text: string = await fetchNote(path);
      const next = change(text);
      return next === null ? null : saveNote(path, next, false, noteBase(text));
    }),
    searchNotes: vi.fn(),
    fetchMentions: vi.fn(),
    createNote: vi.fn(),
    renameNote: vi.fn(),
    moveFolder: vi.fn(),
    deleteNote: vi.fn(),
    fetchTrash: vi.fn(),
    restoreEntry: vi.fn(),
    fetchTerminals: vi.fn().mockResolvedValue([]),
    fetchTodos: vi.fn().mockResolvedValue([]),
    fetchBook: vi.fn(async (note: string) => beside(note)),
    uploadAsset: vi.fn().mockResolvedValue(undefined),
    fetchImages: vi.fn().mockResolvedValue([]),
    fetchHtml: vi.fn().mockResolvedValue([]),
    fetchAssets: vi.fn().mockResolvedValue([]),
    fetchTags: vi.fn().mockResolvedValue([]),
    deleteImage: vi.fn(),
    fetchVersion: vi.fn().mockResolvedValue("0.8.0"),
    fetchHistory: vi.fn(),
    fetchHistoryText: vi.fn(),
  };
});
vi.mock("@/lib/api", () => ({
  fetchFiles,
  fetchNote,
  saveNote,
  updateNote,
  searchNotes,
  fetchMentions,
  createNote,
  fetchTerminals,
  fetchTodos,
  fetchBook,
  uploadAsset,
  fetchImages,
  fetchHtml,
  fetchAssets,
  fetchVersion,
  fetchTags,
  fetchWeather: async () => [],
  UPLOAD_LIMIT_BYTES: 1024 * 1024 * 1024,
  ChangedOnDisk: class ChangedOnDisk extends Error {},
  NoteExists: class NoteExists extends Error {},
  NoteMissing: class NoteMissing extends Error {},
}));
vi.mock("@/lib/move-api", () => ({ renameNote, moveFolder }));
vi.mock("@/lib/trash-api", () => ({ deleteNote, fetchTrash, restoreEntry, deleteImage }));
vi.mock("@/lib/history-api", () => ({ fetchHistory, fetchHistoryText }));
vi.mock("foliate-js/view.js", () => ({}));
const outbox = vi.hoisted(() => ({
  keep: vi.fn(),
  flush: vi.fn(),
  start: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));
vi.mock("@/lib/outbox", () => outbox);
// xterm needs a canvas jsdom lacks; which session the pane holds is all these tests read.
vi.mock("@/components/terminal-pane", () => ({
  TerminalPane: ({ session }: { session: string }) => <div data-terminal={session} />,
}));

pageHooks();

describe("the which-key panel on the route", () => {
  theRoute();

  it("Space in a note shows the which-key panel at once", async () => {
    const app = await editing();

    app.leader();

    const panel = screen.getByRole("dialog", { name: "Leader keys" });
    expect(within(panel).getByRole("heading", { name: "Find" })).toBeInTheDocument();
  });

  it("Space f f from a note opens the note finder", async () => {
    const app = await editing();

    app.leader("f", "f");
    await settle();

    expect(screen.getByRole("option", { name: "other.md" })).toBeInTheDocument();
  });

  it("? on the file tree opens key help with the filter focused", async () => {
    const app = await renderApp();
    await settle();

    fireEvent.keyDown(app.tree(), { key: "?" });

    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: /Filter/ })).toHaveFocus();
  });

  it("Space ? still opens key help", async () => {
    const app = await editing();

    app.leader("?");
    await settle();

    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
  });

  it("? in a note in normal mode and in insert mode stays a ?", async () => {
    const app = await editing();

    // Normal mode: vim's own `?`, a backward search, which opens no key help.
    app.press("?");
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull();

    // Insert mode: the key is not taken, so the browser types it.
    app.press("i");
    expect(app.press("?")).toBe(true);
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull();
  });

  it("with vim off Space in a note types a space and opens no panel", async () => {
    localStorage.setItem("kasten.vim", "off");
    try {
      const app = await renderApp();
      await settle();
      app.click("index.md");
      await settle();

      // Not taken by the page: the browser types the space.
      expect(app.press(" ")).toBe(true);
      expect(screen.queryByRole("dialog", { name: "Leader keys" })).toBeNull();
    } finally {
      localStorage.removeItem("kasten.vim");
    }
  });
});

describe("#1403 the terminal prompt saves the note before it replaces the pane", () => {
  theRoute();

  const terminal = () => document.querySelector("[data-terminal]")?.getAttribute("data-terminal");
  const note = () => document.querySelector(".cm-content")?.textContent;

  /** A note with a typed edit, the way each kind of reader makes one. */
  async function dirty(vim: boolean) {
    if (vim) return editing();
    localStorage.setItem("kasten.vim", "off");
    // By the URL: a phone starts with the tree shut.
    const app = await renderApp("/?note=index.md");
    await settle();
    const view = EditorView.findFromDOM(document.querySelector(".cm-content") as HTMLElement);
    act(() => view?.dispatch({ changes: { from: 0, to: 1 } }));
    expect(app.text()).toBe("he index note");
    return app;
  }

  /** Open the prompt as the reader can, and pick the `work` session by its row. */
  async function pick(app: Awaited<ReturnType<typeof renderApp>>, vim: boolean) {
    fetchTerminals.mockResolvedValue(["work"]);
    if (vim) app.leader("c", "s");
    else {
      // No leader with vim off: the palette, by its chord on a desktop.
      app.press("P", { keyCode: 80, ctrlKey: true, shiftKey: true });
      await settle();
      fireEvent.click(screen.getByRole("option", { name: /^Open a terminal/ }));
    }
    await settle();
    fireEvent.click(screen.getByRole("option", { name: "work" }));
    await settle();
  }

  afterEach(() => localStorage.removeItem("kasten.vim"));

  describe.each([true, false])("with vim %s", (vim) => {
    it("A1 a refused save keeps the note, its text and the focus, and the bar says so", async () => {
      const app = await dirty(vim);
      saveNote.mockRejectedValueOnce(new Error("PUT failed with 500"));

      await pick(app, vim);

      expect.soft(terminal()).toBeUndefined();
      expect.soft(note()).toBe("he index note");
      expect.soft(app.status()).toBe("Could not save");
      expect(document.querySelector(".cm-content")?.contains(document.activeElement)).toBe(true);
    });

    it("A2 a save that lands writes the note, then the pane becomes the terminal", async () => {
      const app = await dirty(vim);

      await pick(app, vim);

      expect
        .soft(saveNote)
        .toHaveBeenCalledWith("index.md", "he index note", false, await baseOf("the index note"));
      expect(terminal()).toBe("work");
    });
  });

  it("A1 I2 on a phone a refused save keeps the note when a session row is tapped", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const app = await dirty(false);
    saveNote.mockRejectedValueOnce(new Error("PUT failed with 500"));

    fetchTerminals.mockResolvedValue(["work"]);
    fireEvent.click(screen.getByRole("button", { name: "Run a command by name" }));
    fireEvent.click(screen.getByRole("option", { name: /^Open a terminal/ }));
    await settle();
    fireEvent.click(screen.getByRole("option", { name: "work" }));
    await settle();

    expect.soft(terminal()).toBeUndefined();
    expect.soft(note()).toBe("he index note");
    expect(app.status()).toBe("Could not save");
  });

  it("A2 I2 on a phone a tapped session row opens the terminal in the one pane", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const app = await dirty(false);

    fetchTerminals.mockResolvedValue(["work"]);
    fireEvent.click(screen.getByRole("button", { name: "Run a command by name" }));
    fireEvent.click(screen.getByRole("option", { name: /^Open a terminal/ }));
    await settle();
    fireEvent.click(screen.getByRole("option", { name: "work" }));
    await settle();

    expect.soft(terminal()).toBe("work");
    expect(app.panes()).toBe(1);
  });

  it("I3 on a conflicted note picking a session writes nothing and keeps the note", async () => {
    const app = await editing();
    somebodyElseWrote();

    await pick(app, true);

    expect.soft(saveNote).not.toHaveBeenCalled();
    expect.soft(terminal()).toBeUndefined();
    expect(note()).toBe("he index note");
  });

  it("I5 a pane holding no note opens the terminal", async () => {
    const app = await renderApp();
    await settle();

    fetchTerminals.mockResolvedValue(["work"]);
    // The pane opens on Today, so the prompt is reached from the tree.
    for (const key of [" ", "c", "s"]) fireEvent.keyDown(app.tree(), { key });
    await settle();
    fireEvent.click(screen.getByRole("option", { name: "work" }));
    await settle();

    expect(terminal()).toBe("work");
  });
});
