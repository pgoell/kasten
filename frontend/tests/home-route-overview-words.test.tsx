import { NoteMissing } from "@/lib/api";
import { applyLayout } from "@/lib/layout";
import { noteBase } from "@/lib/note-base";
import { hashed } from "./digests";
import { defineFoliateFake } from "./foliate-fake";
import { FakeEventSource, pageHooks, VAULT } from "./home-route-fixture";
import {
  captionOf,
  card,
  cardOf,
  DEFAULT_LAYOUT,
  day,
  figureOf,
  LOG_CONFIG,
  NOW,
  openOverview,
  TODAY,
  wordsOf,
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

/** The log config note's text, or null for a vault that has none (the defaults are drawn). */
let config: string | null = null;

/** The visible words under each ring of the Today card, in order. */
const ringWords = () =>
  [...cardOf("Today").querySelectorAll(".overview-ring-label")].map((label) => label.textContent);

/** The caption line under each card's chart, in the order the cards stand. */
const captions = () =>
  [...document.querySelectorAll(".overview-caption")].map((caption) => caption.textContent);

describe("the overview's words, on the route", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue([...Object.keys(VAULT), TODAY, YEAR]);
    fetchNote.mockImplementation(async (path: string) => {
      if (path === LOG_CONFIG) {
        if (config === null) throw new NoteMissing(path);
        return config;
      }
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
    config = null;
  });

  afterEach(async () => {
    await hashed();
    localStorage.removeItem("kasten.vim");
    applyLayout(DEFAULT_LAYOUT);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  it("#806 A1 each chart has a visible line saying what it shows, and each ring names its macro and grams", async () => {
    // The config names water too, since a note that names no kind drops the defaults.
    config = "- 🍽 food: kcal max 2200, protein min 120\n- 💧 water: 250 ml\n";
    const today = day("2026-10-20", 1240);
    today.totals.food.protein = 84;
    fetchLog.mockResolvedValue([today]);
    await openOverview();

    expect(ringWords()).toEqual(["Protein 84 of 120 g", "Carbs 0 g", "Fat 0 g"]);
    expect(captions()).toEqual([
      "kcal per day, 14 days",
      "macros against today's goal",
      "weight, 30 days, no weigh-ins yet",
      "water per day, 14 days",
      "cards rated per day, 14 days",
      "todos done per day, 14 days",
      "notes written per day, 14 days",
      "notes written per day this year",
    ]);
  });

  it("#806 I3 a water max passed is counted in words, not colour alone", async () => {
    config = "- 💧 water: 250 ml, max 2000\n";
    fetchLog.mockResolvedValue([
      day("2026-10-19", 0, 2500),
      day("2026-10-18", 0, 1000),
      day("2026-10-17", 0, 2100),
    ]);
    await openOverview();

    expect(cardOf("Water").querySelector("svg")?.getAttribute("aria-label")).toBe(
      "water per day over 14 days, goal at most 2,000 ml, 2 days over the goal",
    );
    expect(cardOf("Water").querySelectorAll(".log-chart-over")).toHaveLength(2);
    expect(captionOf("Water")).toBe("water per day, 14 days, 2 days over the goal");
  });

  it("#806 I8 a schedule in a note that is no deck does not count", async () => {
    // The 20th is rated in the deck note; the 19th only in a note with no deck marker.
    fetchCards.mockResolvedValue([
      card("#flashcards/aws", 1),
      card("Q :: A <!--SR:!2026-10-24,4,270-->", 2),
      { path: "00 Inbox/plain.md", line: 1, text: "Q :: A <!--SR:!2026-10-23,4,270-->" },
    ]);
    await openOverview();

    expect(figureOf("Flashcards")).toBe("1 day");
    expect(wordsOf("Flashcards")).toBe("in a row with a review, 1 today");
  });

  it("#806 I1 a bar card with no logged day says nothing logged in 14 days under its chart", async () => {
    // No log at all: the Food and Water charts have no bar to draw.
    await openOverview();

    expect(captionOf("Food")).toBe("nothing logged in 14 days");
    expect(captionOf("Water")).toBe("nothing logged in 14 days");
  });
});
