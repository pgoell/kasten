import { EditorView } from "@codemirror/view";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { holdText } from "@/lib/held-text";
import { noteBase } from "@/lib/note-base";
import { periodicNote } from "@/lib/periodic";
import { hashed } from "./digests";
import { defineFoliateFake } from "./foliate-fake";
import { FakeEventSource, pageHooks, renderApp, settle, VAULT } from "./home-route-fixture";

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
  fetchTerminals,
  fetchTodos,
  fetchBook,
  uploadAsset,
  fetchImages,
  fetchHtml,
  fetchAssets,
  fetchVersion,
  fetchTags,
  renameNote,
  moveFolder,
  deleteNote,
  fetchTrash,
  restoreEntry,
  deleteImage,
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
    fetchTerminals: vi.fn().mockResolvedValue([]),
    fetchTodos: vi.fn().mockResolvedValue([]),
    fetchBook: vi.fn(async (note: string) => beside(note)),
    uploadAsset: vi.fn().mockResolvedValue(undefined),
    fetchImages: vi.fn().mockResolvedValue([]),
    fetchHtml: vi.fn().mockResolvedValue([]),
    fetchAssets: vi.fn().mockResolvedValue([]),
    fetchVersion: vi.fn().mockResolvedValue("0.8.0"),
    fetchTags: vi.fn().mockResolvedValue([]),
    renameNote: vi.fn(),
    moveFolder: vi.fn(),
    deleteNote: vi.fn(),
    fetchTrash: vi.fn(),
    restoreEntry: vi.fn(),
    deleteImage: vi.fn(),
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
vi.mock("@/lib/outbox", () => ({
  keep: vi.fn(),
  flush: vi.fn(),
  start: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));

pageHooks();

// Pinned to a day, since the drink lands in the note the clock names.
const TODAY = periodicNote("daily", new Date(2026, 9, 20, 9, 0)).path;
const TODAY_TEXT = "---\ntype: Periodic Note\n---\n\n# 2026-10-20 Tuesday\n\n## TODOs\n";

describe("the palette's drink rows, on the route", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 20, 9, 0));
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue([...Object.keys(VAULT), TODAY]);
    fetchNote.mockImplementation(async (path: string) =>
      path === TODAY ? TODAY_TEXT : VAULT[path],
    );
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
    fetchTags.mockResolvedValue([]);
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

  const option = (name: string | RegExp) => screen.queryByRole("option", { name });
  const editorText = () =>
    EditorView.findFromDOM(
      document.querySelector(".cm-editor") as HTMLElement,
    )?.state.doc.toString();

  it("the palette logs into today's focused pane when the focus is off its editor", async () => {
    const app = await renderApp(`/?note=${encodeURIComponent(TODAY)}`);
    await settle();
    // Focus on the body, as after a click on the tree: the palette finds no view.
    (document.activeElement as HTMLElement | null)?.blur();

    app.leader(":");
    await settle();
    const row = option(/^Log water/);
    expect.soft(row).not.toBeNull();
    if (row) fireEvent.click(row);
    await settle();

    expect(editorText()).toContain("## Log\n- 💧 250 ml");
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("the palette logs nothing while today's note holds text not yet saved", async () => {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    holdText(TODAY, { content: "typed", reason: "PUT failed with 500", conflicted: false });

    app.leader(":");
    await settle();
    const row = option(/^Log water/);
    expect.soft(row).not.toBeNull();
    if (row) fireEvent.click(row);
    await settle();

    expect(app.notice()).toBe(`Nothing logged: ${TODAY} holds text not yet saved`);
    expect(saveNote).not.toHaveBeenCalled();
  });
});
