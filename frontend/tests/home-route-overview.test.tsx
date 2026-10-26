import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { LogTrends } from "@/components/log-trends";
import { NoteMissing } from "@/lib/api";
import type { LogDay } from "@/lib/food-api";
import { applyLayout } from "@/lib/layout";
import { parseConfig } from "@/lib/log-kinds";
import { noteBase } from "@/lib/note-base";
import { hashed } from "./digests";
import { defineFoliateFake } from "./foliate-fake";
import { FakeEventSource, pageHooks, settle, VAULT } from "./home-route-fixture";
import {
  captionOf,
  card,
  cardOf,
  DEFAULT_LAYOUT,
  day,
  encodedPath,
  FROM,
  figureOf,
  GOALS,
  LOG_CONFIG,
  NAMES,
  NOW,
  openOverview,
  overview,
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

describe("the overview, on the route", () => {
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
    cleanup();
    await hashed();
    localStorage.removeItem("kasten.vim");
    applyLayout(DEFAULT_LAYOUT);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  it("#806 A3 the overview shows the eight cards in order, each with a heading, a big number, a line of words and a chart labelled for a screen reader", async () => {
    await openOverview();

    const articles = within(overview() as HTMLElement).getAllByRole("article");
    expect(articles.map((article) => article.querySelector("h2")?.textContent)).toEqual(NAMES);
    for (const article of articles) {
      expect(article.querySelector(".overview-figure")?.textContent).not.toBe("");
      expect(article.querySelector(".overview-words")?.textContent).not.toBe("");
      expect(article.querySelector("[role='img']")?.getAttribute("aria-label")).toBeTruthy();
    }
  });

  /** Clicks a card's button, and checks the pane it names is up and the overview is gone. */
  async function opensPane(button: string, selector: string) {
    await openOverview();

    fireEvent.click(screen.getByRole("button", { name: button }));
    await settle();

    expect(document.querySelector(selector)).not.toBeNull();
    expect(overview()).toBeNull();
  }

  // One test per card, not an `it.each`: a `-t` filter reads the title before its rows are filled in.
  it("#806 A4 each card opens its pane: Food opens the log", () =>
    opensPane("Food, open the log", "[aria-label='Log']"));
  it("#806 A4 each card opens its pane: Today opens the log", () =>
    opensPane("Today, open the log", "[aria-label='Log']"));
  it("#806 A4 each card opens its pane: Weight opens the log", () =>
    opensPane("Weight, open the log", "[aria-label='Log']"));
  it("#806 A4 each card opens its pane: Water opens the log", () =>
    opensPane("Water, open the log", "[aria-label='Log']"));
  it("#806 A4 each card opens its pane: Flashcards opens the review pane", () =>
    opensPane("Flashcards, open the review pane", "[aria-label='review']"));
  it("#806 A4 each card opens its pane: Todos opens the todo pane", () =>
    opensPane("Todos, open the todo pane", "[aria-label='Todos']"));

  it("#806 A4 each card opens its note: Writing opens today's note, This year opens this year's", async () => {
    const app = await openOverview();

    fireEvent.click(screen.getByRole("button", { name: "Writing, open today's note" }));
    await settle();
    expect(app.href()).toContain(encodedPath(TODAY));

    // Opening today's note took the overview's pane, so the overview comes back for the next card.
    app.leader("g", "a");
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "This year, open this year's note" }));
    await settle();
    expect(app.href()).toContain(encodedPath(YEAR));
  });

  it("#806 A5 the overview reads log, todos, cards and written once each and writes nothing", async () => {
    await openOverview();

    expect(fetchLog).toHaveBeenCalledTimes(1);
    expect(fetchLog).toHaveBeenCalledWith(FROM, "2026-10-20");
    expect(fetchTodos).toHaveBeenCalledTimes(1);
    expect(fetchCards).toHaveBeenCalledTimes(1);
    expect(fetchWritten).toHaveBeenCalledTimes(1);
    expect(saveNote).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
    expect(updateNote).not.toHaveBeenCalled();
  });

  it("#806 A6 the food streak counts days within the kcal goal and a day with no log ends it", async () => {
    config = GOALS;
    // Three days within the goal, a gap on the 16th, then more days. Today has no log yet.
    fetchLog.mockResolvedValue([
      day("2026-10-19", 1500),
      day("2026-10-18", 2000),
      day("2026-10-17", 2100),
      day("2026-10-15", 1000),
      day("2026-10-14", 1100),
    ]);
    await openOverview();

    expect(figureOf("Food")).toBe("3 days");
    expect(wordsOf("Food")).toBe("in a row within at most 2,200 kcal");
  });

  it("#1012 A3 the log pane Trends and the overview Food card read the same streak on drinks-only days", async () => {
    config = GOALS;
    const drinks = (date: string): LogDay => ({
      ...day(date, 0, 250),
      entries: [{ line: 1, text: "- 💧 250 ml", kind: "water", ml: 250 }],
    });
    // Today and the 18th have drinks only. The 19th and 17th have food within the goal.
    const days = [
      drinks("2026-10-20"),
      day("2026-10-19", 1500),
      drinks("2026-10-18"),
      day("2026-10-17", 1500),
    ];
    fetchLog.mockResolvedValue(days);
    await openOverview();

    const { container } = render(
      <LogTrends
        days={days}
        config={parseConfig(GOALS)}
        from={FROM}
        range={90}
        today="2026-10-20"
      />,
    );
    const trends = within(container).getByText("Streak").closest(".log-summary-tile");

    expect({
      overview: figureOf("Food"),
      trends: trends?.querySelector(".log-summary-figure")?.textContent,
    }).toEqual({ overview: "1 day", trends: "1 day" });
  });

  it("#806 A6 the flashcard streak counts days in a row with a review, read off due less interval, every cloze schedule counting", async () => {
    // A review on each of the 20th, 19th, 18th and 17th, none on the 16th, one on the 15th.
    fetchCards.mockResolvedValue([
      // The deck marker: a schedule counts only in a note the review pane counts as a deck.
      card("#flashcards/aws", 0),
      card("Q :: A <!--SR:!2026-10-24,4,270-->", 1),
      card("Q2 :: A <!--SR:!2026-10-23,4,270-->", 2),
      card("Q3 :: A <!--SR:!2026-10-22,4,270-->", 3),
      // The 17th comes from the second cloze schedule alone: its first is rated today.
      card(
        "{{c1::p}} and {{c2::q}} <!--SR:c1!2026-10-25,5,250--> <!--SR:c2!2026-10-21,4,250-->",
        4,
      ),
      card("Q5 :: A <!--SR:!2026-10-20,5,270-->", 5),
    ]);
    await openOverview();

    expect(figureOf("Flashcards")).toBe("4 days");
    expect(wordsOf("Flashcards")).toBe("in a row with a review, 2 today");
  });

  it("#806 I1 with nothing logged, no goals, no weight kind, no cards, no todos and no notes, every card says so and no NaN or Infinity shows", async () => {
    await openOverview();

    expect(wordsOf("Food")).toBe("nothing logged");
    expect(wordsOf("Today")).toBe("no kcal goal");
    expect(wordsOf("Weight")).toBe("no weigh-ins yet");
    expect(wordsOf("Water")).toBe("no water goal");
    expect(wordsOf("Flashcards")).toBe("no cards rated");
    expect(wordsOf("Todos")).toBe("done today, 0 open, 0 overdue");
    expect(wordsOf("Writing")).toBe("notes in 7 days, 0 today");
    expect(wordsOf("This year")).toBe("no notes this year");
    expect(captionOf("Weight")).toBe("weight, 30 days, no weigh-ins yet");
    expect(captionOf("Today")).toBe("macros today, no goals");
    expect(overview()?.textContent).not.toMatch(/NaN|Infinity/);
  });

  it("#806 I2 a failed log read shows its message on the log cards and the other cards still draw", async () => {
    fetchLog.mockRejectedValue(new Error("the log is down"));
    await openOverview();

    const alerts = within(overview() as HTMLElement).getAllByRole("alert");
    expect(alerts.map((alert) => alert.textContent)).toEqual([
      "the log is down",
      "the log is down",
      "the log is down",
      "the log is down",
    ]);
    expect(wordsOf("Todos")).toBe("done today, 0 open, 0 overdue");
    expect(wordsOf("This year")).toBe("no notes this year");
  });

  it("#806 I3 days over a max goal are drawn in the warning colour and counted in the chart's words; a floor never warns", async () => {
    config = GOALS;
    fetchLog.mockResolvedValue([
      day("2026-10-19", 2500),
      day("2026-10-18", 2300),
      day("2026-10-17", 2000),
    ]);
    await openOverview();

    expect(cardOf("Food").querySelector("svg")?.getAttribute("aria-label")).toBe(
      "kcal per day over 14 days, goal at most 2,200 kcal, 2 days over the goal",
    );
    expect(cardOf("Food").querySelectorAll(".log-chart-over")).toHaveLength(2);
    expect(captionOf("Food")).toBe("kcal per day, 14 days, 2 days over the goal");
  });

  it("#806 I3 a floor goal never warns", async () => {
    config = "- 🍽 food: kcal min 1800\n";
    fetchLog.mockResolvedValue([day("2026-10-19", 1000), day("2026-10-18", 900)]);
    await openOverview();

    expect(cardOf("Food").querySelectorAll(".log-chart-over")).toHaveLength(0);
    expect(cardOf("Food").querySelector("svg")?.getAttribute("aria-label")).toBe(
      "kcal per day over 14 days, goal at least 1,800 kcal",
    );
  });

  it("#806 I6 a created instant counts on the reader's local day", async () => {
    // Half past midnight on the 20th in the reader's own zone, whatever zone the test runs in.
    fetchWritten.mockResolvedValue([new Date(2026, 9, 20, 0, 30).toISOString()]);
    await openOverview();

    expect(wordsOf("Writing")).toBe("notes in 7 days, 1 today");
    expect(wordsOf("This year")).toBe("notes on 1 of 293 days");
  });

  it("#806 I8 a line with two cloze schedules counts on both days", async () => {
    // The 20th from one cloze schedule and the 17th from its other, with a review on each of the 19th and 18th.
    fetchCards.mockResolvedValue([
      card("#flashcards/aws", 0),
      card(
        "{{c1::p}} and {{c2::q}} <!--SR:c1!2026-10-22,2,250--> <!--SR:c2!2026-10-19,2,250-->",
        1,
      ),
      card("Q2 :: A <!--SR:!2026-10-23,4,270-->", 2),
      card("Q3 :: A <!--SR:!2026-10-22,4,270-->", 3),
    ]);
    await openOverview();

    expect(figureOf("Flashcards")).toBe("4 days");
    expect(wordsOf("Flashcards")).toBe("in a row with a review, 1 today");
  });

  it("#806 A6 Writing counts notes in 7 days and today, This year counts notes on days this year", async () => {
    fetchWritten.mockResolvedValue([
      "2026-10-20",
      "2026-10-20",
      "2026-10-14",
      "2026-03-02",
      "2025-12-30",
    ]);
    await openOverview();

    expect(figureOf("Writing")).toBe("3");
    expect(wordsOf("Writing")).toBe("notes in 7 days, 2 today");
    expect(figureOf("This year")).toBe("4");
    expect(wordsOf("This year")).toBe("notes on 3 of 293 days");
  });
});
