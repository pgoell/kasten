import { cleanup, fireEvent, screen } from "@testing-library/react";
import { noteBase } from "@/lib/note-base";
import { hashed } from "./digests";
import { defineFoliateFake } from "./foliate-fake";
import { FakeEventSource, pageHooks, renderApp, settle, VAULT } from "./home-route-fixture";
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
vi.mock("@/lib/outbox", () => ({
  keep: vi.fn(),
  flush: vi.fn(),
  start: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));

pageHooks();

describe("the html theme on the home route", () => {
  const PAGE = "page.html";
  const ROW = "Toggle light and dark mode";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue(Object.keys(VAULT));
    fetchNote.mockImplementation(async (path: string) => VAULT[path]);
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
    fetchTags.mockResolvedValue([]);
    fetchImages.mockResolvedValue([]);
    fetchHtml.mockResolvedValue([PAGE]);
    fetchAssets.mockResolvedValue([]);
  });

  afterEach(async () => {
    cleanup();
    localStorage.removeItem("kasten.theme");
    localStorage.removeItem("kasten.palette");
    localStorage.removeItem("kasten.vim");
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.palette;
    await hashed();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  /** The page's frame, which is the one open in the pane. */
  const frame = () => document.querySelector("[data-html-pane] iframe") as HTMLIFrameElement;

  /**
   * The index note in the left pane and the page in a split beside it, with the
   * focus on the note, so the palette opens over an editor while a page is open.
   */
  async function noteBesidePage(vim: boolean) {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    if (vim) {
      app.leader("%");
    } else {
      // With vim off there is no leader, so the split comes from the palette's row.
      app.press("P", { keyCode: 80, ctrlKey: true, shiftKey: true });
      await settle();
      fireEvent.click(screen.getByRole("option", { name: /^Split the pane left and right/ }));
    }
    await settle();
    app.click(PAGE);
    await settle();
    app.focusPane(0);
    await settle();
    return app;
  }

  /** The palette's light and dark row, run by a click the way a reader runs it. */
  function runRow() {
    const row = screen.queryByRole("option", { name: ROW });
    expect.soft(row).not.toBeNull();
    if (row) fireEvent.click(row);
  }

  it("with vim on, the palette's light and dark row turns an open page's frame to the other theme, and its address stays", async () => {
    stubMatchMedia({});
    localStorage.clear();
    const app = await noteBesidePage(true);
    const addressed = frame().getAttribute("src");
    const sent = vi
      .spyOn(frame().contentWindow as Window, "postMessage")
      .mockImplementation(() => {});

    app.leader(":");
    await settle();
    runRow();
    await settle();

    expect(sent.mock.calls).toContainEqual([{ kasten: "theme", theme: "dark" }, "*"]);
    expect(frame().getAttribute("src")).toBe(addressed);
    expect(addressed).toBe(`/api/html/${PAGE}?theme=light&palette=poel`);
  });

  it("with vim off, the same row, run from the chord, turns an open page's frame to the other theme, and its address stays", async () => {
    stubMatchMedia({});
    localStorage.clear();
    localStorage.setItem("kasten.vim", "off");
    const app = await noteBesidePage(false);
    const addressed = frame().getAttribute("src");
    const sent = vi
      .spyOn(frame().contentWindow as Window, "postMessage")
      .mockImplementation(() => {});

    app.press("P", { keyCode: 80, ctrlKey: true, shiftKey: true });
    await settle();
    runRow();
    await settle();

    expect(sent.mock.calls).toContainEqual([{ kasten: "theme", theme: "dark" }, "*"]);
    expect(frame().getAttribute("src")).toBe(addressed);
    expect(addressed).toBe(`/api/html/${PAGE}?theme=light&palette=poel`);
  });

  it("on a phone with touch, the toolbar's run button opens the palette and the same row turns an open page's frame to the other theme", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    localStorage.clear();
    const app = await renderApp("/?note=index.md");
    await settle();
    // The tree is a drawer that is shut, so the page is opened through its button.
    fireEvent.click(screen.getByRole("button", { name: "File tree" }));
    await settle();
    app.click(PAGE);
    await settle();
    const addressed = frame().getAttribute("src");
    const sent = vi
      .spyOn(frame().contentWindow as Window, "postMessage")
      .mockImplementation(() => {});

    fireEvent.click(screen.getByRole("button", { name: "Run a command by name" }));
    await settle();
    runRow();
    await settle();

    expect(sent.mock.calls).toContainEqual([{ kasten: "theme", theme: "dark" }, "*"]);
    expect(frame().getAttribute("src")).toBe(addressed);
    expect(addressed).toBe(`/api/html/${PAGE}?theme=light&palette=poel`);
  });
});
