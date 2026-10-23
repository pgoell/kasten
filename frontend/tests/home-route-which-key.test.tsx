import { fireEvent, screen, within } from "@testing-library/react";
import { noteBase } from "@/lib/note-base";
import { defineFoliateFake } from "./foliate-fake";
import { editing, pageHooks, renderApp, settle, theRoute } from "./home-route-fixture";

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
