import { EditorView } from "@codemirror/view";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { SearchHit } from "@/lib/api";
import { noteBase } from "@/lib/note-base";
import { hashed } from "./digests";
import { act, FakeEventSource, pageHooks, renderApp, settle, VAULT } from "./home-route-fixture";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";

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

describe("the search page in the URL and on the keys", () => {
  const PROJECT = "projects/kasten.md";
  const NOTES: Record<string, string> = {
    ...VAULT,
    [PROJECT]: ["# kasten", "", "first line", "Postgres holds a derived index.", "last"].join("\n"),
  };
  /** One line, in week 43, which Enter opens on line 4. */
  const HITS: SearchHit[] = [
    {
      path: PROJECT,
      line: 4,
      text: "Postgres holds a derived index.",
      date: "2026-10-20",
      tags: [],
    },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    // The bars run from the week of today, so the clock is pinned to week 43.
    vi.setSystemTime(new Date(2026, 9, 23));
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue(Object.keys(NOTES));
    fetchNote.mockImplementation(async (path: string) => NOTES[path]);
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    searchNotes.mockResolvedValue(HITS);
    fetchMentions.mockResolvedValue([]);
    fetchTodos.mockResolvedValue([]);
    fetchTerminals.mockResolvedValue([]);
    fetchImages.mockResolvedValue([]);
    fetchHtml.mockResolvedValue([]);
    fetchAssets.mockResolvedValue([]);
    fetchTags.mockResolvedValue([]);
    fetchVersion.mockResolvedValue("0.8.0");
  });

  afterEach(async () => {
    cleanup();
    await hashed();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.removeItem("kasten.vim");
    vi.resetAllMocks();
  });

  /** The search page's dialog, or null while it is shut. */
  const search = () => screen.queryByRole("dialog", { name: "Search notes" });

  /** A bar of the histogram, by its week. */
  const bar = (week: number) => screen.getByRole("button", { name: new RegExp(`^Week ${week},`) });

  /** Type the query and let the settled scan land, with the clock moved past its delay. */
  async function typed(value: string) {
    fireEvent.change(screen.getByLabelText("search notes"), { target: { value } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await settle();
  }

  /** The cursor's line in the editor of the pane drawn first. */
  function cursorLine(): number {
    const editor = document.querySelector(".cm-editor") as HTMLElement;
    const { state } = EditorView.findFromDOM(editor) as EditorView;
    return state.doc.lineAt(state.selection.main.head).number;
  }

  it("A6 writes the week a bar is clicked on into the URL", async () => {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();

    app.leader("f", "g");
    await settle();
    fireEvent.click(bar(38));

    expect(app.href()).toContain("week=2026-W38");
  });

  it("A6 clears the week from the URL when the search closes", async () => {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    app.leader("f", "g");
    await settle();
    fireEvent.click(bar(38));

    fireEvent.keyDown(screen.getByLabelText("search notes"), { key: "Escape" });
    await settle();

    expect(search()).toBeNull();
    expect(app.href()).not.toContain("week=");
  });

  it("A6 opens the search page on the week a cold load names", async () => {
    await renderApp("/?week=2026-W38");
    await settle();

    expect(search()).not.toBeNull();
    expect(bar(38).getAttribute("aria-pressed")).toBe("true");
  });

  it("A6 opens nothing for a week that is not one", async () => {
    await renderApp("/?week=2026-W99");
    await settle();

    expect(search()).toBeNull();
  });

  it("A14 opens the search page on Space f g with vim on, and a picked line lands the cursor on it", async () => {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();

    app.leader("f", "g");
    await settle();
    expect(screen.getByRole("group", { name: "Lines per week" })).toBeTruthy();
    await typed("postgres");
    fireEvent.keyDown(screen.getByLabelText("search notes"), { key: "Enter" });
    await settle();

    expect(app.href()).toContain("projects%2Fkasten.md");
    expect(cursorLine()).toBe(4);
  });

  it("A14 opens the search page from the palette with vim off", async () => {
    localStorage.setItem("kasten.vim", "off");
    const app = await renderApp();
    await settle();

    // No leader with vim off: the palette, by its chord on a desktop.
    app.press("P", { keyCode: 80, ctrlKey: true, shiftKey: true });
    await settle();
    fireEvent.click(screen.getByRole("option", { name: /^Search note content/ }));
    await settle();

    expect(screen.getByRole("group", { name: "Lines per week" })).toBeTruthy();
    expect(search()).not.toBeNull();
  });

  it("A14 opens a line in the focused pane and leaves the other pane's note", async () => {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    app.leader("%");
    await settle();

    app.leader("f", "g");
    await settle();
    expect(screen.getByRole("group", { name: "Lines per week" })).toBeTruthy();
    await typed("postgres");
    fireEvent.keyDown(screen.getByLabelText("search notes"), { key: "Enter" });
    await settle();

    expect(app.text()).toBe("the index note");
    const panes = document.querySelectorAll<HTMLElement>(".cm-content");
    expect(panes[1]?.textContent).toContain("Postgres holds a derived index.");
  });

  it("A14 on a phone with a coarse pointer, the Filters button shows the filter groups", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    // A phone has the tree folded away, so the page opens on a cold load of its
    // week rather than from a leader key over a note.
    await renderApp("/?week=2026-W38");
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Filters" }));

    expect(screen.getByRole("group", { name: "Folders" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Tags" })).toBeTruthy();
  });
});
