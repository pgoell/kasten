import { cleanup, fireEvent, screen } from "@testing-library/react";
import { NoteMissing } from "@/lib/api";
import { applyLayout } from "@/lib/layout";
import { noteBase } from "@/lib/note-base";
import { hashed } from "./digests";
import { defineFoliateFake } from "./foliate-fake";
import {
  act,
  FakeEventSource,
  pageHooks,
  renderApp,
  settle,
  stream,
  VAULT,
} from "./home-route-fixture";
import {
  DEFAULT_LAYOUT,
  LOG_CONFIG,
  NOW,
  openOverview,
  overview,
  TODAY,
  YEAR,
} from "./home-route-overview-fixture";

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
  fetchLog,
  fetchCards,
  fetchWritten,
  fetchReviewLimits,
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
    fetchLog: vi.fn(),
    fetchCards: vi.fn(),
    fetchWritten: vi.fn(),
    fetchReviewLimits: vi.fn(),
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
  fetchCards,
  fetchWritten,
  fetchReviewLimits,
  fetchWeather: async () => [],
  UPLOAD_LIMIT_BYTES: 1024 * 1024 * 1024,
  ChangedOnDisk: class ChangedOnDisk extends Error {},
  NoteExists: class NoteExists extends Error {},
  NoteMissing: class NoteMissing extends Error {},
}));
vi.mock("@/lib/food-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/food-api")>()),
  fetchLog,
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

describe("the overview keys, on the route", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue([...Object.keys(VAULT), TODAY, YEAR]);
    fetchNote.mockImplementation(async (path: string) => {
      // No log config note: the overview draws the defaults.
      if (path === LOG_CONFIG) throw new NoteMissing(path);
      if (path === YEAR) return "# 2026\n";
      if (path === TODAY) return "# 2026-10-20 Tuesday\n";
      return VAULT[path];
    });
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchLog.mockResolvedValue([]);
    fetchTodos.mockResolvedValue([]);
    fetchCards.mockResolvedValue([]);
    fetchWritten.mockResolvedValue([]);
    fetchReviewLimits.mockResolvedValue({});
    searchNotes.mockResolvedValue([]);
    fetchTags.mockResolvedValue([]);
    fetchImages.mockResolvedValue([]);
    fetchHtml.mockResolvedValue([]);
    fetchAssets.mockResolvedValue([]);
  });

  afterEach(async () => {
    cleanup();
    await hashed();
    localStorage.removeItem("kasten.vim");
    applyLayout(DEFAULT_LAYOUT);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  it("#806 A7 Space g a opens the overview, vim on", async () => {
    const app = await renderApp("/");
    await settle();

    app.leader("g", "a");
    await settle();

    expect(overview()).not.toBeNull();
  });

  it("#806 A7 Space g a opens the overview, vim off", async () => {
    localStorage.setItem("kasten.vim", "off");
    const app = await renderApp("/");
    await settle();
    // Vim off, the editor takes no leader, so the leader starts from the log pane the palette opened.
    app.press("P", { keyCode: 80, ctrlKey: true, shiftKey: true });
    await settle();
    fireEvent.click(screen.getByRole("option", { name: /^Open the log/ }));
    await settle();
    const pane = document.querySelector<HTMLElement>("[aria-label='Log']") as HTMLElement;

    fireEvent.keyDown(pane, { key: " " });
    fireEvent.keyUp(pane, { key: " " });
    fireEvent.keyDown(pane, { key: "g" });
    fireEvent.keyDown(pane, { key: "a" });
    await settle();

    expect(overview()).not.toBeNull();
  });

  it("#806 A7 the palette lists Open the overview and running it opens the overview", async () => {
    localStorage.setItem("kasten.vim", "off");
    const app = await renderApp("/");
    await settle();

    app.press("P", { keyCode: 80, ctrlKey: true, shiftKey: true });
    await settle();
    const row = screen.getByRole("option", { name: /^Open the overview/ });
    fireEvent.click(row);
    await settle();

    expect(overview()).not.toBeNull();
  });

  it("#806 A7 the home screen's Overview button opens the overview", async () => {
    await renderApp("/");
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    await settle();

    expect(overview()).not.toBeNull();
  });

  it("#806 I4 h j k l and the arrows move between the cards and Enter opens one", async () => {
    await openOverview();
    const food = screen.getByRole("button", { name: "Food, open the log" });
    food.focus();

    fireEvent.keyDown(food, { key: "l" });
    expect(document.activeElement?.textContent).toBe("Today");
    fireEvent.keyDown(document.activeElement as Element, { key: "j" });
    expect(document.activeElement?.textContent).toBe("Weight");
    fireEvent.keyDown(document.activeElement as Element, { key: "k" });
    expect(document.activeElement?.textContent).toBe("Today");
    fireEvent.keyDown(document.activeElement as Element, { key: "h" });
    expect(document.activeElement?.textContent).toBe("Food");
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowRight" });
    expect(document.activeElement?.textContent).toBe("Today");
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("Weight");
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowUp" });
    expect(document.activeElement?.textContent).toBe("Today");
    // Enter is the button's own press: the pane leaves it unprevented.
    expect(fireEvent.keyDown(document.activeElement as Element, { key: "Enter" })).toBe(true);
  });

  it("#806 I4 h j k l and the arrows move between the cards and Enter opens one, vim off", async () => {
    localStorage.setItem("kasten.vim", "off");
    const app = await renderApp("/");
    await settle();
    app.press("P", { keyCode: 80, ctrlKey: true, shiftKey: true });
    await settle();
    fireEvent.click(screen.getByRole("option", { name: /^Open the overview/ }));
    await settle();
    const food = screen.getByRole("button", { name: "Food, open the log" });
    food.focus();

    fireEvent.keyDown(food, { key: "ArrowRight" });
    expect(document.activeElement?.textContent).toBe("Today");
    fireEvent.keyDown(document.activeElement as Element, { key: "l" });
    expect(document.activeElement?.textContent).toBe("Weight");
    fireEvent.keyDown(document.activeElement as Element, { key: "h" });
    expect(document.activeElement?.textContent).toBe("Today");
    fireEvent.keyDown(document.activeElement as Element, { key: "j" });
    expect(document.activeElement?.textContent).toBe("Weight");
    fireEvent.keyDown(document.activeElement as Element, { key: "k" });
    expect(document.activeElement?.textContent).toBe("Today");
    expect(fireEvent.keyDown(document.activeElement as Element, { key: "Enter" })).toBe(true);
  });

  it("#806 I4 Space in the overview starts the leader and Space q closes it", async () => {
    await openOverview();

    fireEvent.keyDown(overview() as HTMLElement, { key: " " });
    fireEvent.keyUp(overview() as HTMLElement, { key: " " });
    fireEvent.keyDown(overview() as HTMLElement, { key: "q" });
    await settle();

    expect(overview()).toBeNull();
  });

  it("#806 I5 a vault event for a new note asks the written read again", async () => {
    await openOverview();
    const asked = fetchWritten.mock.calls.length;

    act(() =>
      stream().send({ path: "00 Inbox/new idea.md", change: "written", digest: "a".repeat(64) }),
    );
    await settle();

    expect(fetchWritten.mock.calls.length).toBeGreaterThan(asked);
  });

  it("#806 I5 an autosave of a note already listed does not ask the written read again", async () => {
    await openOverview();
    const asked = fetchWritten.mock.calls.length;

    // `index.md` is in the listing already, so this is an autosave of a known note.
    act(() => stream().send({ path: "index.md", change: "written", digest: "a".repeat(64) }));
    await settle();

    expect(fetchWritten.mock.calls.length).toBe(asked);
  });
});
