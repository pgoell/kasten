import { EditorView } from "@codemirror/view";
import { NoteMissing } from "@/lib/api";
import { applyLayout } from "@/lib/layout";
import { hashed } from "./digests";
import { defineFoliateFake } from "./foliate-fake";
import { FakeEventSource, pageHooks, renderApp, settle, VAULT } from "./home-route-fixture";
import { DEFAULT_LAYOUT } from "./home-route-overview-fixture";
import {
  CONFIG,
  LOG_CONFIG,
  labelIn,
  NEXT_WEEK_NOTE,
  NOW,
  reviewText,
  sectionText,
  WEEK_CARDS,
  WEEK_DAILY,
  WEEK_GITHUB,
  WEEK_LOG,
  WEEK_NOTE,
  WEEK_TEXT,
  WEEK_TODOS,
} from "./periodic-review-fixture";

defineFoliateFake();

/** The file a done row opens: its third line is the todo the row names. */
const TASKS = "02 Projects/FDE/tasks.md";
const TASKS_TEXT = "# tasks\n\n- [x] ship the export ✅ 2026-10-20\n- [ ] next thing\n";
/** The week before the current one, which ends before the open todo's due date. */
const PAST_WEEK_NOTE = "01 Periodic/01 Weekly/2026-W42.md";

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
  fetchWrittenNotes,
  fetchGithub,
  fetchModelUse,
  fetchReviewLimits,
} = vi.hoisted(() => {
  const beside = (note: string, suffix = ".epub") => ({
    path: note.replace(/\.md$/, suffix),
    blob: new Blob(["a book"]),
  });

  const fetchNote = vi.fn();
  // With its answer in the definition, so a reset between tests keeps it: the editor's unmount
  // flushes a dirty buffer after the test's own afterEach has run.
  const saveNote = vi.fn(
    async (path: string, content: string, _keepalive?: boolean, _base?: string) => ({
      path,
      content,
    }),
  );

  return {
    fetchFiles: vi.fn(),
    fetchNote,
    saveNote,
    updateNote: vi.fn(async (path: string, change: (text: string) => string | null) => {
      const text: string = await fetchNote(path);
      const next = change(text);
      return next === null ? null : saveNote(path, next, false);
    }),
    searchNotes: vi.fn(),
    fetchMentions: vi.fn(),
    createNote: vi.fn(),
    fetchTerminals: vi.fn().mockResolvedValue([]),
    fetchTodos: vi.fn(),
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
    fetchWrittenNotes: vi.fn(),
    fetchGithub: vi.fn(),
    fetchModelUse: vi.fn(),
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
vi.mock("@/lib/log/food-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log/food-api")>()),
  fetchLog,
}));
vi.mock("@/lib/move-api", () => ({ renameNote, moveFolder }));
vi.mock("@/lib/trash-api", () => ({ deleteNote, fetchTrash, restoreEntry, deleteImage }));
vi.mock("@/lib/history-api", () => ({ fetchHistory, fetchHistoryText }));
vi.mock("@/lib/review/review-api", () => ({ fetchWrittenNotes, fetchGithub, fetchModelUse }));
vi.mock("foliate-js/view.js", () => ({}));
vi.mock("@/lib/outbox", () => ({
  keep: vi.fn(),
  flush: vi.fn(),
  start: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));

pageHooks();

/** The text each note the week tests open answers with. A path not here is a note that is not there. */
const TEXTS: Record<string, string> = {
  ...VAULT,
  ...WEEK_DAILY,
  [LOG_CONFIG]: CONFIG,
  [WEEK_NOTE]: WEEK_TEXT,
  [NEXT_WEEK_NOTE]: "# 2026-W44\n\nmy own line\n",
  [TASKS]: TASKS_TEXT,
  [PAST_WEEK_NOTE]: "# 2026-W42\n\nmy own line\n",
};

/** Opens a note on the route the way a link does, and lets its reads arrive. */
async function openNote(path: string) {
  const app = await renderApp(`/?note=${encodeURIComponent(path)}`);
  await settle();
  await settle();
  return app;
}

/** The week's four tiles, each as its label, figure and words. */
function tiles(): string[][] {
  return [...document.querySelectorAll<HTMLElement>(".review-tiles .review-tile")].map((tile) => [
    tile.querySelector(".review-tile-label")?.textContent ?? "",
    tile.querySelector(".review-figure")?.textContent ?? "",
    tile.querySelector(".review-words")?.textContent ?? "",
  ]);
}

/** The words of each row in a list section, in the order they are drawn. */
function rowsIn(heading: string): string[] {
  const section = [...document.querySelectorAll<HTMLElement>(".review-section")].find(
    (each) => each.querySelector(".review-heading")?.textContent === heading,
  );
  return [...(section?.querySelectorAll<HTMLElement>(".review-row") ?? [])].map(
    (row) => row.textContent ?? "",
  );
}

describe("the week review on the weekly note", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue([
      ...Object.keys(VAULT),
      WEEK_NOTE,
      NEXT_WEEK_NOTE,
      PAST_WEEK_NOTE,
      TASKS,
    ]);
    fetchNote.mockImplementation(async (path: string) => {
      const text = TEXTS[path];
      if (text === undefined) throw new NoteMissing(path);
      return text;
    });
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchLog.mockResolvedValue(WEEK_LOG);
    fetchTodos.mockResolvedValue(WEEK_TODOS);
    fetchCards.mockResolvedValue(WEEK_CARDS);
    fetchWritten.mockResolvedValue([]);
    fetchWrittenNotes.mockResolvedValue([]);
    fetchGithub.mockResolvedValue(WEEK_GITHUB);
    fetchModelUse.mockResolvedValue([]);
    fetchReviewLimits.mockResolvedValue({});
    searchNotes.mockResolvedValue([]);
    fetchTags.mockResolvedValue([]);
    fetchImages.mockResolvedValue([]);
    fetchHtml.mockResolvedValue([]);
    fetchAssets.mockResolvedValue([]);
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

  it("#807 A5 the week's four tiles say the todos done, the time, the days within kcal and the weight change", async () => {
    await openNote(WEEK_NOTE);

    expect(reviewText()).toContain("Week in review");
    expect(tiles()).toEqual([
      ["Todos done", "2", "ticked done this week"],
      ["Time logged", "1h 30m", "in the day notes' sessions"],
      ["Days within kcal", "4 of 7", "days within the goal"],
      ["Weight change", "-0.6 kg", "over the week"],
    ]);
  });

  it("#807 A5 the kcal and todos charts are labelled, and the kcal chart names its goal", async () => {
    await openNote(WEEK_NOTE);

    expect(labelIn("kcal per day")).toBe("kcal per day this week, goal at most 2,200 kcal");
    expect(sectionText("kcal per day")).toContain("kcal per day, the dashed line the goal");
    expect(labelIn("Todos per day")).toBe("todos done per day this week, 2 in all");
  });

  it("#807 A5 the done and carried over lists name each todo by its words", async () => {
    await openNote(WEEK_NOTE);

    expect(rowsIn("Done")).toEqual(["ship the export", "reply to Anna"]);
    expect(rowsIn("Carried over")).toEqual(["send the deck"]);
  });

  it("#807 A5 the flashcards chart says how many cards were rated, last rating only", async () => {
    await openNote(WEEK_NOTE);

    expect(sectionText("Flashcards")).toContain("1 card rated this week, last rating only");
  });

  it("#807 A7 the week's GitHub count is in words", async () => {
    await openNote(WEEK_NOTE);

    expect(reviewText()).toContain("GitHub: 23 contributions this week");
  });

  it("#807 A7 with GitHub off the week says so in words", async () => {
    fetchGithub.mockResolvedValue({ on: false, days: {} });
    await openNote(WEEK_NOTE);

    expect(reviewText()).toContain("GitHub is off: the backend has no token.");
  });

  it("#807 I1 a week with nothing in it says so in words, with no NaN or Infinity", async () => {
    fetchLog.mockResolvedValue([]);
    fetchTodos.mockResolvedValue([]);
    fetchCards.mockResolvedValue([]);
    fetchGithub.mockResolvedValue({ on: true, days: {} });
    await openNote(WEEK_NOTE);

    expect(rowsIn("Done")).toEqual([]);
    expect(reviewText()).toContain("No todo ticked done this week.");
    expect(reviewText()).toContain("Nothing carried over into today.");
    expect(tiles()[2]).toEqual(["Days within kcal", "0 of 7", "days within the goal"]);
    expect(reviewText()).not.toMatch(/NaN|Infinity/);
  });

  it("#807 I2 a failed todos read shows its message where the lists are, and the kcal chart still draws", async () => {
    fetchTodos.mockRejectedValue(new Error("GET /api/todos failed with 500"));
    await openNote(WEEK_NOTE);

    expect(sectionText("Done")).toContain("GET /api/todos failed with 500");
    expect(labelIn("kcal per day")).toBe("kcal per day this week, goal at most 2,200 kcal");
  });

  it("#807 I1 a past week with nothing carried over says so without speaking of today", async () => {
    await openNote(PAST_WEEK_NOTE);

    expect(sectionText("Carried over")).toContain("Nothing carried over from this week.");
    expect(sectionText("Carried over")).not.toContain("today");
  });

  it("#807 I2 a failed log config read shows its message in the tiles, not as no kcal goal", async () => {
    const answer = fetchNote.getMockImplementation();
    fetchNote.mockImplementation(async (path: string) => {
      if (path === LOG_CONFIG) throw new Error("GET /api/files/log.md failed with 500");
      return answer?.(path);
    });
    await openNote(WEEK_NOTE);

    expect(tiles()[2]?.[2]).toBe("GET /api/files/log.md failed with 500");
    expect(reviewText()).not.toContain("no kcal goal");
  });

  it("#807 I3 a week that has not started says so, and draws nothing else", async () => {
    await openNote(NEXT_WEEK_NOTE);

    expect(reviewText()).toContain("This week has not started.");
    expect(document.querySelector(".review-tiles")).toBeNull();
  });

  it("#807 I7 a tap on a Done row opens its note at the todo's line", async () => {
    await openNote(WEEK_NOTE);
    const row = [...document.querySelectorAll<HTMLElement>(".review-row")].find(
      (each) => each.textContent === "ship the export",
    );
    row?.click();
    await settle();

    const view = EditorView.findFromDOM(
      document.querySelector<HTMLElement>(".cm-content") as HTMLElement,
    );
    expect(view?.state.doc.lineAt(view.state.selection.main.head).number).toBe(3);
  });
});
