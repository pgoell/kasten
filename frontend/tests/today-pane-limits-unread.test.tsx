import { act } from "@testing-library/react";
import { pageHooks, renderApp, theRoute } from "./home-route-fixture";

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
  fetchCards,
  fetchReviewLimits,
  deleteImage,
  fetchTrash,
  restoreEntry,
  deleteNote,
  renameNote,
  moveFolder,
  fetchHistory,
  fetchHistoryText,
} = vi.hoisted(() => ({
  fetchFiles: vi.fn(),
  fetchNote: vi.fn(),
  saveNote: vi.fn(),
  updateNote: vi.fn(),
  searchNotes: vi.fn(),
  fetchMentions: vi.fn(),
  createNote: vi.fn(),
  fetchTerminals: vi.fn().mockResolvedValue([]),
  fetchTodos: vi.fn().mockResolvedValue([]),
  fetchBook: vi.fn(),
  uploadAsset: vi.fn().mockResolvedValue(undefined),
  fetchImages: vi.fn().mockResolvedValue([]),
  fetchHtml: vi.fn().mockResolvedValue([]),
  fetchAssets: vi.fn().mockResolvedValue([]),
  fetchVersion: vi.fn().mockResolvedValue("0.8.0"),
  fetchTags: vi.fn().mockResolvedValue([]),
  fetchCards: vi.fn(),
  fetchReviewLimits: vi.fn(),
  deleteImage: vi.fn(),
  fetchTrash: vi.fn(),
  restoreEntry: vi.fn(),
  deleteNote: vi.fn(),
  renameNote: vi.fn(),
  moveFolder: vi.fn(),
  fetchHistory: vi.fn(),
  fetchHistoryText: vi.fn(),
}));

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
  fetchReviewLimits,
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

/** Today is the 22nd of October 2026, a Thursday. */
const TODAY = new Date(2026, 9, 22, 9, 0);

/** The three columns of the home screen, in the order they are drawn: Today, Recent, Due. */
function columns(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-today-column]")];
}

describe("the today pane when the daily limits cannot be read", () => {
  theRoute();

  beforeEach(() => {
    vi.mocked(fetchCards).mockResolvedValue([]);
    vi.mocked(searchNotes).mockResolvedValue([]);
    vi.mocked(fetchReviewLimits).mockRejectedValue(
      new Error("GET /api/review/limits failed with 502", { cause: 502 }),
    );
  });

  it("#1149 B1 the today pane says the cards could not be counted when the limits read fails at last, not Nothing due", async () => {
    vi.setSystemTime(TODAY);
    await renderApp();
    // The read is tried eight times over about a minute before it fails at last.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });

    const [, , due] = columns();
    expect(due?.textContent).toContain(
      "Cards could not be counted: the daily limits could not be read",
    );
    expect(due?.textContent).not.toContain("Nothing due.");
  });
});
