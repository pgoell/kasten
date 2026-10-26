import { NoteMissing } from "@/lib/api";
import { applyLayout } from "@/lib/layout";
import { hashed } from "./digests";
import { defineFoliateFake } from "./foliate-fake";
import { FakeEventSource, pageHooks, renderApp, settle, stream, VAULT } from "./home-route-fixture";
import { DEFAULT_LAYOUT } from "./home-route-overview-fixture";
import {
  CARDS,
  CONFIG,
  docText,
  LAST_YEAR_NOTE,
  LOG_CONFIG,
  labelIn,
  NEXT_YEAR_NOTE,
  NOW,
  reviewText,
  sectionText,
  statsOf,
  WEEK_DAILY,
  YEAR_GITHUB,
  YEAR_LOG,
  YEAR_MODEL_USE,
  YEAR_NOTE,
  YEAR_NOTES,
  YEAR_TEXT,
  YEAR_TODOS,
} from "./periodic-review-fixture";

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
vi.mock("@/lib/food-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/food-api")>()),
  fetchLog,
}));
vi.mock("@/lib/move-api", () => ({ renameNote, moveFolder }));
vi.mock("@/lib/trash-api", () => ({ deleteNote, fetchTrash, restoreEntry, deleteImage }));
vi.mock("@/lib/history-api", () => ({ fetchHistory, fetchHistoryText }));
vi.mock("@/lib/review-api", () => ({ fetchWrittenNotes, fetchGithub, fetchModelUse }));
vi.mock("foliate-js/view.js", () => ({}));
vi.mock("@/lib/outbox", () => ({
  keep: vi.fn(),
  flush: vi.fn(),
  start: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));

pageHooks();

/** The text of the log's config note, and the reads that answer with what is in the vault. */
let config: string | null = CONFIG;

/** The text each note the year tests open answers with. A path not here is a note that is not there. */
const TEXTS: Record<string, string> = {
  ...VAULT,
  ...WEEK_DAILY,
  [LOG_CONFIG]: CONFIG,
  [YEAR_NOTE]: YEAR_TEXT,
  [NEXT_YEAR_NOTE]: "# 2027\n\nmy own line\n",
  [LAST_YEAR_NOTE]: "# 2025\n\nmy own line\n",
};

/** Opens a note on the route the way a link does, and lets its reads arrive. */
async function openNote(path: string) {
  const app = await renderApp(`/?note=${encodeURIComponent(path)}`);
  await settle();
  await settle();
  return app;
}

/** The yearly note's children in the editor, in the order they are drawn. */
function children(): Element[] {
  return [...(document.querySelector(".cm-content")?.children ?? [])];
}

/** The index in the editor of the first child that `test` holds for, or -1. */
function at(test: (element: Element) => boolean): number {
  return children().findIndex(test);
}

/** The `.cm-line` whose words are `text`, as the title or a line of the note draws them. */
const isLine = (text: string) => (element: Element) =>
  element.classList.contains("cm-line") && element.textContent?.includes(text) === true;

/** The rows of the projects table, each as its cells' words. */
function projectRows(): string[][] {
  return [...document.querySelectorAll<HTMLElement>(".review-table tbody tr")].map((row) =>
    [...row.children].map((cell) => cell.textContent ?? ""),
  );
}

/** The model use section, or undefined while the review has not drawn it. */
function modelUseSection(): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>(".review-section")].find(
    (each) => each.querySelector(".review-heading")?.textContent === "Model use",
  );
}

/** The rows of the model use table, each as its cells' words. */
function modelUseRows(): string[][] {
  return [
    ...(modelUseSection()?.querySelectorAll<HTMLTableRowElement>(".review-table tbody tr") ?? []),
  ].map((row) => [...row.children].map((cell) => cell.textContent ?? ""));
}

/** The bar heights of each model use chart, tokens first, one number per month as drawn. */
function modelUseBars(): number[][] {
  return [...(modelUseSection()?.querySelectorAll("svg") ?? [])].map((svg) =>
    [...svg.querySelectorAll("rect")].map((rect) => Number(rect.getAttribute("height"))),
  );
}

describe("the year review on the yearly note", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue([
      ...Object.keys(VAULT),
      YEAR_NOTE,
      LAST_YEAR_NOTE,
      NEXT_YEAR_NOTE,
    ]);
    fetchNote.mockImplementation(async (path: string) => {
      const text = path === LOG_CONFIG && config === null ? undefined : TEXTS[path];
      if (text === undefined) throw new NoteMissing(path);
      return text;
    });
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchLog.mockResolvedValue(YEAR_LOG);
    fetchTodos.mockResolvedValue(YEAR_TODOS);
    fetchCards.mockResolvedValue(CARDS);
    fetchWritten.mockResolvedValue(YEAR_NOTES.map((note) => note.day));
    fetchWrittenNotes.mockResolvedValue(YEAR_NOTES);
    fetchGithub.mockResolvedValue(YEAR_GITHUB);
    fetchModelUse.mockResolvedValue([]);
    fetchReviewLimits.mockResolvedValue({});
    searchNotes.mockResolvedValue([]);
    fetchTags.mockResolvedValue([]);
    fetchImages.mockResolvedValue([]);
    fetchHtml.mockResolvedValue([]);
    fetchAssets.mockResolvedValue([]);
    config = CONFIG;
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

  it("#807 A1 the year review sits under the title and its link row, above the user's own line, in Read and in Edit", async () => {
    const app = await openNote(YEAR_NOTE);

    expect(reviewText()).toContain("Year in review");
    expect(at(isLine("2026"))).toBeGreaterThanOrEqual(0);
    expect(at((element) => element.classList.contains("cm-review"))).toBeGreaterThan(
      at(isLine("2027")),
    );
    expect(at((element) => element.classList.contains("cm-review"))).toBeLessThan(
      at(isLine("my own line")),
    );

    app.leader("p");
    await settle();

    expect(reviewText()).toContain("Year in review");
    expect(at((element) => element.classList.contains("cm-review"))).toBeGreaterThan(
      at(isLine("2026")),
    );
    expect(at((element) => element.classList.contains("cm-review"))).toBeLessThan(
      at(isLine("my own line")),
    );
  });

  it("#807 A1 opening, reading and leaving the yearly note writes nothing, and the editor holds the file's text", async () => {
    const app = await openNote(YEAR_NOTE);
    expect(reviewText()).toContain("Year in review");
    app.leader("p");
    await settle();
    expect(docText()).toBe(YEAR_TEXT);

    app.click("other.md");
    await settle();

    expect(saveNote).not.toHaveBeenCalled();
    expect(updateNote).not.toHaveBeenCalled();
  });

  it("#807 A2 the projects table gives a project's done todos, their time and its notes", async () => {
    await openNote(YEAR_NOTE);

    expect(projectRows()).toEqual([["FDE", "2", "2h 15m", "2"]]);
  });

  it("#807 A3 notes per month, the top tags with their counts, and the five numbers beside them", async () => {
    await openNote(YEAR_NOTE);

    expect(sectionText("Notes per month")).toContain("notes written per month, 6 in all");
    expect([...document.querySelectorAll(".review-tags li")].map((tag) => tag.textContent)).toEqual(
      ["#fde 2", "#reading 2", "#work 2"],
    );
    expect(statsOf()).toEqual([
      ["Todos done", "3"],
      ["Time logged", "2h 15m"],
      ["Notes made", "6"],
      ["Flashcards answered", "2"],
      ["Days logged", "3"],
    ]);
  });

  it("#807 A4 the weight line over the year is labelled with its weigh-ins", async () => {
    await openNote(YEAR_NOTE);

    expect(labelIn("Weight")).toBe("weight in kg over 2026, 3 weigh-ins, with the 7-day average");
  });

  it("#807 A7 the GitHub grid over the year is labelled with its contributions, and the count is in words", async () => {
    await openNote(YEAR_NOTE);

    expect(labelIn("GitHub")).toBe("GitHub contributions each day, 8 contributions in 2026");
    expect(sectionText("GitHub")).toContain("8 contributions in 2026");
  });

  it("#807 A7 with GitHub off the section says so in words and draws no grid", async () => {
    fetchGithub.mockResolvedValue({ on: false, days: {} });
    await openNote(YEAR_NOTE);

    expect(sectionText("GitHub")).toContain("GitHub is off: the backend has no token.");
    expect(labelIn("GitHub")).toBe("");
  });

  it("#807 I1 a year with nothing in it says so in each section, and shows no NaN or Infinity", async () => {
    config = null;
    fetchLog.mockResolvedValue([]);
    fetchTodos.mockResolvedValue([]);
    fetchCards.mockResolvedValue([]);
    fetchWritten.mockResolvedValue([]);
    fetchWrittenNotes.mockResolvedValue([]);
    fetchGithub.mockResolvedValue({ on: true, days: {} });
    await openNote(YEAR_NOTE);

    expect(sectionText("Projects")).toContain("No project had a done todo or a note in 2026.");
    expect(sectionText("Weight")).toContain("No weight kind in the log config.");
    expect(sectionText("Top tags")).toContain("No tags on the notes written in 2026.");
    expect(sectionText("Notes per month")).toContain("notes written per month, 0 in all");
    expect(statsOf()).toContainEqual(["Time logged", "0m"]);
    expect(reviewText()).not.toMatch(/NaN|Infinity/);
  });

  it("#807 I1 a section whose read is still out says Reading, not nothing", async () => {
    // The written-notes answer is held: the sections that read it must not claim there is nothing.
    fetchWrittenNotes.mockReturnValue(new Promise(() => {}));
    await openNote(YEAR_NOTE);

    expect(sectionText("Projects")).toContain("Reading…");
    expect(sectionText("Top tags")).toContain("Reading…");
    expect(sectionText("Projects")).not.toContain("No project had");
  });

  it("#807 I1 a past year with no tags says in that year, not this one", async () => {
    await openNote(LAST_YEAR_NOTE);

    expect(sectionText("Top tags")).toContain("No tags on the notes written in 2025.");
  });

  it("#807 A3 a note dated after today is left out of the month bars, as Notes made leaves it out", async () => {
    // Tomorrow's daily note is written ahead, and /api/written answers it for this range.
    fetchWritten.mockResolvedValue([...YEAR_NOTES.map((note) => note.day), "2026-10-26"]);
    await openNote(YEAR_NOTE);

    expect(sectionText("Notes per month")).toContain("notes written per month, 6 in all");
    expect(statsOf()).toContainEqual(["Notes made", "6"]);
  });

  it("#807 I2 a failed log config read says so in Weight, not as no weight kind", async () => {
    const answer = fetchNote.getMockImplementation();
    fetchNote.mockImplementation(async (path: string) => {
      if (path === LOG_CONFIG) throw new Error("GET /api/files/log.md failed with 500");
      return answer?.(path);
    });
    await openNote(YEAR_NOTE);

    expect(sectionText("Weight")).toContain("GET /api/files/log.md failed with 500");
    expect(sectionText("Weight")).not.toContain("No weight kind");
  });

  it("#807 I2 a failed todos read shows its message in Projects, and the GitHub section still draws", async () => {
    fetchTodos.mockRejectedValue(new Error("GET /api/todos failed with 500"));
    await openNote(YEAR_NOTE);

    expect(sectionText("Projects")).toContain("GET /api/todos failed with 500");
    expect(labelIn("GitHub")).toBe("GitHub contributions each day, 8 contributions in 2026");
  });

  it("#807 I2 a GitHub failure says GitHub could not be read, with the read's message and no token", async () => {
    fetchGithub.mockRejectedValue(new Error("GET /api/github failed with 502"));
    await openNote(YEAR_NOTE);

    expect(sectionText("GitHub")).toContain("GitHub could not be read.");
    expect(sectionText("GitHub")).toContain("GET /api/github failed with 502");
    expect(sectionText("GitHub")).not.toContain("token");
  });

  it("#807 I3 a year that has not started says so, and draws no numbers", async () => {
    await openNote(NEXT_YEAR_NOTE);

    expect(reviewText()).toContain("2027 has not started.");
    expect(document.querySelector(".review-aside")).toBeNull();
  });

  it("#808 A4 the model use section draws tokens and cost per month, and a row per project, most costly first", async () => {
    fetchModelUse.mockResolvedValue(YEAR_MODEL_USE);
    await openNote(YEAR_NOTE);

    expect(labelIn("Model use")).toBe("tokens per month in 2026, 1.6M in all");
    expect(sectionText("Model use")).toContain("tokens per month, 1.6M in all");
    expect(sectionText("Model use")).toContain("cost per month, $1,205.05 in all");
    // Twelve bars a chart. January has nothing in it, so it is the one-unit stub; October is the top.
    const [tokenBars = [], costBars = []] = modelUseBars();
    expect(tokenBars).toHaveLength(12);
    expect(costBars).toHaveLength(12);
    expect(tokenBars[0]).toBe(1);
    expect(tokenBars[1]).toBeGreaterThan(0);
    expect(tokenBars[9]).toBe(Math.max(...tokenBars));
    expect(costBars[9]).toBe(Math.max(...costBars));
    expect(modelUseRows()).toEqual([
      ["kasten", "1.2M", "$1,204.55"],
      ["blattwerk", "341k", "$0.50"],
      ["scratch", "100", "unknown"],
    ]);
  });

  it("#808 A4 with no model use in the year the section says so, and draws no number", async () => {
    await openNote(YEAR_NOTE);

    expect(sectionText("Model use")).toContain("No model use recorded in 2026.");
    expect(sectionText("Model use")).not.toContain("$");
    expect(labelIn("Model use")).toBe("");
    expect(reviewText()).not.toContain("tokens per month");
  });

  it("#808 I1 the unpriced tokens are said in words, and a line with no cost is never a cost of $0.00", async () => {
    fetchModelUse.mockResolvedValue(YEAR_MODEL_USE);
    await openNote(YEAR_NOTE);

    expect(sectionText("Model use")).toContain(
      "340k tokens had no price and are left out of the cost.",
    );
    expect(reviewText()).not.toContain("$0.00");
    expect(modelUseRows()).toContainEqual(["scratch", "100", "unknown"]);
  });

  it("#808 I1 a year with no priced line draws no cost of $0.00", async () => {
    fetchModelUse.mockResolvedValue(YEAR_MODEL_USE.map((line) => ({ ...line, cost: null })));
    await openNote(YEAR_NOTE);

    expect(sectionText("Model use")).toContain("cost unknown, no price for these models");
    expect(labelIn("Model use")).toBe("tokens per month in 2026, 1.6M in all");
    expect(reviewText()).not.toContain("$0.00");
    expect(modelUseRows()).toContainEqual(["kasten", "1.2M", "unknown"]);
  });

  it("#808 I6 a failed model use read shows its message in its section, and Projects still draws", async () => {
    fetchModelUse.mockRejectedValue(new Error("GET /api/model-use failed with 500"));
    await openNote(YEAR_NOTE);

    expect(sectionText("Model use")).toContain("GET /api/model-use failed with 500");
    expect(projectRows()).toEqual([["FDE", "2", "2h 15m", "2"]]);
  });

  it("#808 I6 a collector write to the model use folder asks the model use again", async () => {
    await openNote(YEAR_NOTE);
    const before = fetchModelUse.mock.calls.length;

    stream().send({
      path: "99 Misc/01 Config/Model use/2026-10.md",
      change: "written",
      digest: "ab12cd34",
    });
    await settle();

    expect(fetchModelUse.mock.calls.length).toBeGreaterThan(before);
  });
});
