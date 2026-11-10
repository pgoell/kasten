import { cleanup } from "@testing-library/react";
import { noteBase } from "@/lib/notes/note-base";
import { heldText, holdText } from "@/lib/saving/held-text";
import { hashed } from "./digests";
import { defineFoliateFake } from "./foliate-fake";
import { FakeEventSource, pageHooks, renderApp, settle, VAULT } from "./home-route-fixture";
import { COARSE, stubMatchMedia } from "./match-media";

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
vi.mock("@/lib/core/api", () => ({
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
vi.mock("@/lib/vault/move/move-api", () => ({ renameNote, moveFolder }));
vi.mock("@/lib/vault/move/trash-api", () => ({
  deleteNote,
  fetchTrash,
  restoreEntry,
  deleteImage,
}));
vi.mock("@/lib/history/history-api", () => ({ fetchHistory, fetchHistoryText }));
vi.mock("foliate-js/view.js", () => ({}));
const outbox = vi.hoisted(() => ({
  keep: vi.fn(),
  flush: vi.fn(),
  start: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));
vi.mock("@/lib/capture/outbox", () => outbox);

pageHooks();

describe("the workspace across a reload", () => {
  const FINE = "kasten.workspace.1";
  const COARSE_KEY = "kasten.workspace.coarse.1";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue(Object.keys(VAULT));
    // A note the vault does not hold is refused, the way the backend's 404 is.
    fetchNote.mockImplementation(async (path: string) => {
      const text = VAULT[path];
      if (text === undefined) throw new Error(`GET /api/files/${path} failed with 404`);
      return text;
    });
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
    fetchImages.mockResolvedValue([]);
    fetchHtml.mockResolvedValue([]);
    fetchAssets.mockResolvedValue([]);
  });

  afterEach(async () => {
    cleanup();
    await hashed();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  // Kept: Chromium flips no live `(pointer: coarse)`, so no journey reaches the change mid-session.
  it("workspace: I4 a pointer that changes mid-session saves under the key the layout came from", async () => {
    const media = stubMatchMedia();
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();

    await media.set(COARSE, true);
    app.click("other.md");
    await settle();

    expect(localStorage.getItem(COARSE_KEY)).toBeNull();
    expect(localStorage.getItem(FINE)).toContain("other.md");
  });

  // Kept: the stale cache is the case, and only an in-app route change keeps it; a reload empties it.
  it("workspace: I2 a return naming a conflicted note no saved pane holds reads the vault afresh", async () => {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    await app.navigate("/capture");
    await settle();
    // Left conflicted, and the vault came to hold the kept text since. The
    // cache still holds the text from before, which a reopen must not take
    // for the vault's.
    holdText("index.md", {
      content: "the kept text",
      reason: "Changed on disk before the note was left",
      conflicted: true,
    });
    fetchNote.mockImplementation(async (path: string) =>
      path === "index.md" ? "the kept text" : VAULT[path],
    );
    // Nothing saved, so the layout is the URL's note alone.
    localStorage.removeItem(FINE);

    await app.navigate("/", "index.md");
    await settle();

    expect(app.text()).toBe("the kept text");
    expect(app.status()).toBe("Saved");
    expect(heldText("index.md")).toBeUndefined();
  });
});
