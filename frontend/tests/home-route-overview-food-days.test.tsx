import { render } from "@testing-library/react";
import { LogTrends } from "@/components/log-trends";
import { shiftDay } from "@/lib/clock";
import { applyLayout } from "@/lib/layout";
import type { LogDay } from "@/lib/log/food-api";
import { parseConfig } from "@/lib/log/log-kinds";
import { noteBase } from "@/lib/note-base";
import { hashed } from "./digests";
import { defineFoliateFake } from "./foliate-fake";
import { FakeEventSource, pageHooks, VAULT } from "./home-route-fixture";
import {
  captionOf,
  cardOf,
  DEFAULT_LAYOUT,
  day,
  LOG_CONFIG,
  NOW,
  openOverview,
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
vi.mock("@/lib/log/food-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log/food-api")>()),
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

const DAY = "2026-10-20";
/** A food goal, and a water kind so the Water card has its drinks to draw. */
const CONFIG = "- 🍽 food: kcal max 2200\n- 💧 water: 250 ml\n";
/** The slot a bar stands in, its x over the width of one of the fourteen: a bar starts 15% into its slot. */
const SLOT = 300 / 14;

/** The slots of the bars a chart draws with this selector, in the order drawn. */
const slotsOf = (chart: ParentNode, selector = "rect") =>
  [...chart.querySelectorAll(selector)].map((bar) =>
    Math.floor(Number(bar.getAttribute("x")) / SLOT),
  );

/** A day of drinks only: a water line and no food line. */
const drinks = (date: string): LogDay => ({
  ...day(date, 0, 500),
  entries: [{ line: 1, text: "- 💧 500 ml", kind: "water", ml: 500 }],
});

/** A day with a food line of 0 kcal: a food day, so a stub is drawn for it. */
const zeroKcal = (date: string): LogDay => ({
  ...day(date, 0),
  entries: [{ line: 1, text: "- 🍽 0 kcal", kind: "food", kcal: 0 }],
});

/** A day with only a line of your own, the weight. */
const weighed = (date: string): LogDay => ({
  ...day(date, 0),
  entries: [{ line: 1, text: "- ⚖ 70 kg", kind: "mine" }],
});

describe("the overview's Food card, on the route", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue([...Object.keys(VAULT), TODAY, YEAR]);
    fetchNote.mockImplementation(async (path: string) => {
      if (path === LOG_CONFIG) return CONFIG;
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
    await hashed();
    localStorage.removeItem("kasten.vim");
    applyLayout(DEFAULT_LAYOUT);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  it("#1122 A1 the overview's Food card draws no bar for a day of drinks only, and the other days' bars keep their slots", async () => {
    // Food on the 20th, 18th (0 kcal) and 16th; drinks on the 19th; weight on the 17th.
    fetchLog.mockResolvedValue([
      day(DAY, 1240),
      drinks("2026-10-19"),
      zeroKcal("2026-10-18"),
      weighed("2026-10-17"),
      day("2026-10-16", 1800),
    ]);
    await openOverview();

    expect(slotsOf(cardOf("Food"))).toEqual([9, 11, 13]);
  });

  it("#1122 A2 the overview's Food card and the log pane's kcal chart draw the same days over the same 14 days", async () => {
    const days = [
      day(DAY, 1240),
      drinks("2026-10-19"),
      zeroKcal("2026-10-18"),
      weighed("2026-10-17"),
      day("2026-10-16", 1800),
    ];
    fetchLog.mockResolvedValue(days);
    await openOverview();

    const { container } = render(
      <LogTrends
        days={days}
        config={parseConfig(CONFIG)}
        from={shiftDay(DAY, -13)}
        range={14}
        today={DAY}
      />,
    );
    const kcal = [...container.querySelectorAll<HTMLElement>(".log-chart")].find(
      (chart) => chart.querySelector(".log-chart-title")?.textContent === "Kcal",
    );
    if (kcal === undefined) throw new Error("no kcal chart");

    expect({ overview: slotsOf(cardOf("Food")), trends: slotsOf(kcal) }).toEqual({
      overview: [9, 11, 13],
      trends: [9, 11, 13],
    });
  });

  it("#1122 I1 a food line of 0 kcal still draws a stub on the Food card, beside a day of drinks only that draws none", async () => {
    fetchLog.mockResolvedValue([day(DAY, 1240), zeroKcal("2026-10-18"), drinks("2026-10-19")]);
    await openOverview();

    expect(slotsOf(cardOf("Food"), ".log-chart-zero")).toContain(11);
    expect(slotsOf(cardOf("Food"))).toEqual([11, 13]);
  });

  it("#1122 I2 a day with only a line of your own, such as weight, draws no Food card bar", async () => {
    fetchLog.mockResolvedValue([day(DAY, 1240), weighed("2026-10-19")]);
    await openOverview();

    expect(slotsOf(cardOf("Food"))).toEqual([13]);
  });

  it("#1122 I3 a fortnight with logged days but no food line leaves the Food card empty and says no food logged in 14 days, while the Water card still draws the drinks", async () => {
    fetchLog.mockResolvedValue([drinks("2026-10-19"), weighed("2026-10-18")]);
    await openOverview();

    expect(slotsOf(cardOf("Water"))).toContain(12);
    expect({ slots: slotsOf(cardOf("Food")), caption: captionOf("Food") }).toEqual({
      slots: [],
      caption: "no food logged in 14 days",
    });
  });
});
