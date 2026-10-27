import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { NoteMissing } from "@/lib/api";
import { ARCHIVE, applyLayout, IMAGE_FOLDER, INBOX, type Layout, PERIODIC } from "@/lib/layout";
import type { LogDay } from "@/lib/log/food-api";
import { noteBase } from "@/lib/note-base";
import { periodicNote } from "@/lib/periodic";
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

// Pinned to a day, since the pane reads the day the clock names.
const TODAY = periodicNote("daily", new Date(2026, 9, 20, 9, 0)).path;
const LOG_CONFIG = "99 Misc/01 Config/log.md";
const EMPTY_TEXT = "---\ntype: Periodic Note\n---\n\n# 2026-10-20 Tuesday\n\n## TODOs\n";
// The water line is line 8, which is the line the pane's entry names.
const LOGGED_TEXT =
  "---\ntype: Periodic Note\n---\n\n# 2026-10-20 Tuesday\n\n## Log\n- 💧 500 ml\n";

/** The day as `GET /api/log` answers it for `LOGGED_TEXT`. */
const DAY: LogDay = {
  date: "2026-10-20",
  path: TODAY,
  entries: [{ line: 8, text: "- 💧 500 ml", kind: "water", ml: 500 }],
  totals: {
    water: { ml: 500 },
    coffee: { count: 0 },
    alcohol: { count: 0, ml: 0, grams: 0 },
    food: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
    mine: [],
  },
};

/** The same day after one more 250 ml, as `GET /api/log` answers once the vault has it. */
const DAY_750: LogDay = {
  ...DAY,
  entries: [{ line: 8, text: "- 💧 750 ml", kind: "water", ml: 750 }],
  totals: { ...DAY.totals, water: { ml: 750 } },
};

/** The first day of the trend the pane asks for, thirty days back from today. */
const DATE = "2026-10-20";
const TREND_FROM = "2026-09-21";

/** The layout the defaults make, read before any test moves it. */
const DEFAULT_LAYOUT: Layout = {
  inbox: INBOX,
  periodic: PERIODIC,
  archive: ARCHIVE,
  images: IMAGE_FOLDER,
  config: "99 Misc/01 Config",
};

/** The text of today's note, which the fake vault reads back. */
let todayText = EMPTY_TEXT;

describe("the log pane, on the route", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 20, 9, 0));
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue([...Object.keys(VAULT), TODAY]);
    fetchNote.mockImplementation(async (path: string) => {
      // The log config note is missing here, as in a vault without it, so the pane draws its defaults.
      if (path === LOG_CONFIG) throw new NoteMissing(path);
      return path === TODAY ? todayText : VAULT[path];
    });
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchLog.mockResolvedValue([]);
    fetchTodos.mockResolvedValue([]);
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

  // A row names its keys after its label, so the match is on the label's start.
  const option = (name: RegExp) => screen.queryByRole("option", { name });
  const logPane = () => document.querySelector<HTMLElement>("[aria-label='Log']");
  /** The text the vault was asked to save into today's note, or undefined where none was. */
  const savedToday = () =>
    saveNote.mock.calls.find(([path]) => path === TODAY)?.[1] as string | undefined;

  it("#624 with vim on, <leader>gf opens the log pane and a water tap writes today's note through the vault", async () => {
    todayText = EMPTY_TEXT;
    const app = await renderApp(`/?note=${encodeURIComponent(TODAY)}`);
    await settle();

    app.leader("g", "f");
    await settle();
    expect(logPane()).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Log water" }));
    await hashed();
    await settle();

    expect(updateNote).toHaveBeenCalledWith(TODAY, expect.any(Function));
    expect(savedToday()).toContain("## Log\n- 💧 250 ml");
  });

  it("#624 with vim off, the palette's Open the log opens the pane and e then Save rewrites the entry's line", async () => {
    localStorage.setItem("kasten.vim", "off");
    todayText = LOGGED_TEXT;
    fetchLog.mockResolvedValue([DAY]);
    const app = await renderApp(`/?note=${encodeURIComponent(TODAY)}`);
    await settle();

    app.press("P", { keyCode: 80, ctrlKey: true, shiftKey: true });
    await settle();
    const row = option(/^Open the log/);
    expect(row).not.toBeNull();
    fireEvent.click(row as HTMLElement);
    await settle();
    const pane = logPane() as HTMLElement;
    expect(pane).not.toBeNull();

    pane.focus();
    fireEvent.keyDown(pane, { key: "e" });
    const amount = pane.querySelector<HTMLInputElement>(".log-pane-edit input");
    expect(amount?.value).toBe("500 ml");
    fireEvent.change(amount as HTMLInputElement, { target: { value: "750 ml" } });
    fireEvent.click(within(pane).getByRole("button", { name: "Save" }));
    await hashed();
    await settle();

    expect(savedToday()).toContain("## Log\n- 💧 750 ml");
    expect(savedToday()).not.toContain("- 💧 500 ml");
  });

  it("#624 the phone toolbar's log button opens the pane and a tap on an entry then Delete removes its line", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    todayText = LOGGED_TEXT;
    fetchLog.mockResolvedValue([DAY]);
    const app = await renderApp(`/?note=${encodeURIComponent(TODAY)}`);
    await settle();

    const toolbar = screen.queryByRole("button", { name: "Open the log" });
    expect(toolbar).not.toBeNull();
    fireEvent.click(toolbar as HTMLElement);
    await settle();
    const pane = logPane() as HTMLElement;
    expect(pane).not.toBeNull();

    fireEvent.click(within(pane).getByRole("button", { name: "💧 500 ml" }));
    await settle();
    fireEvent.click(within(pane).getByRole("button", { name: "Delete" }));
    await hashed();
    await settle();

    expect(savedToday()).toBeDefined();
    expect(savedToday()).not.toContain("- 💧 500 ml");
    expect(savedToday()).toContain("## Log");
    expect(app.notice()).toBeNull();
  });

  it("#774 a written event for today's daily note asks the log again for the day and the trend, and the pane redraws", async () => {
    todayText = LOGGED_TEXT;
    fetchLog.mockResolvedValue([DAY]);
    const app = await renderApp(`/?note=${encodeURIComponent(TODAY)}`);
    await settle();
    app.leader("g", "f");
    await settle();
    expect(
      within(logPane() as HTMLElement).getByRole("button", { name: "💧 500 ml" }),
    ).not.toBeNull();

    fetchLog.mockClear();
    fetchLog.mockResolvedValue([DAY_750]);
    act(() => stream().send({ path: TODAY, change: "written", digest: "a".repeat(64) }));
    await settle();

    expect(fetchLog).toHaveBeenCalledWith(DATE, DATE);
    expect(fetchLog).toHaveBeenCalledWith(TREND_FROM, DATE);
    expect(
      within(logPane() as HTMLElement).getByRole("button", { name: "💧 750 ml" }),
    ).not.toBeNull();
  });

  it("#774 a written event for a note that is not a daily note does not ask the log again", async () => {
    todayText = LOGGED_TEXT;
    fetchLog.mockResolvedValue([DAY]);
    const app = await renderApp(`/?note=${encodeURIComponent(TODAY)}`);
    await settle();
    app.leader("g", "f");
    await settle();
    const asked = fetchLog.mock.calls.length;

    // A weekly note sits in the same periodic folder, so this is the one a
    // match on the folder rather than on the day would wrongly ask about.
    act(() =>
      stream().send({
        path: "01 Periodic/01 Weekly/2026-W43.md",
        change: "written",
        digest: "a".repeat(64),
      }),
    );
    await settle();

    expect(fetchLog).toHaveBeenCalledTimes(asked);
  });

  it("#774 a written event for a dated note outside the daily folder does not ask the log again", async () => {
    todayText = LOGGED_TEXT;
    fetchLog.mockResolvedValue([DAY]);
    const app = await renderApp(`/?note=${encodeURIComponent(TODAY)}`);
    await settle();
    app.leader("g", "f");
    await settle();
    const asked = fetchLog.mock.calls.length;

    // A date for a file name, in a folder that is not the daily one: a pattern
    // on the name alone would ask the log about a note that holds no day.
    act(() =>
      stream().send({ path: "00 Inbox/2026-10-20.md", change: "written", digest: "a".repeat(64) }),
    );
    await settle();

    expect(fetchLog).toHaveBeenCalledTimes(asked);
  });

  it("#774 a removed event for today's daily note asks the log again and the pane drops the entry", async () => {
    todayText = LOGGED_TEXT;
    fetchLog.mockResolvedValue([DAY]);
    const app = await renderApp(`/?note=${encodeURIComponent(TODAY)}`);
    await settle();
    app.leader("g", "f");
    await settle();

    fetchLog.mockClear();
    fetchLog.mockResolvedValue([]);
    act(() => stream().send({ path: TODAY, change: "removed", digest: null }));
    await settle();

    expect(fetchLog).toHaveBeenCalledWith(DATE, DATE);
    expect(
      within(logPane() as HTMLElement).queryByRole("button", { name: "💧 500 ml" }),
    ).toBeNull();
  });

  it("#774 a daily note under a periodic folder other than the default asks the log again", async () => {
    applyLayout({ ...DEFAULT_LAYOUT, periodic: "Journal" });
    const note = periodicNote("daily", new Date(2026, 9, 20, 9, 0)).path;
    expect(note).toBe("Journal/00 Daily/2026-10-20.md");
    fetchLog.mockResolvedValue([DAY]);
    const app = await renderApp("/");
    await settle();
    app.leader("g", "f");
    await settle();

    fetchLog.mockClear();
    fetchLog.mockResolvedValue([DAY_750]);
    act(() => stream().send({ path: note, change: "written", digest: "a".repeat(64) }));
    await settle();

    expect(fetchLog).toHaveBeenCalledWith(DATE, DATE);
    expect(
      within(logPane() as HTMLElement).getByRole("button", { name: "💧 750 ml" }),
    ).not.toBeNull();
  });

  it("#796 a listing event after the daily folder moved asks the log again and the pane redraws", async () => {
    todayText = LOGGED_TEXT;
    fetchLog.mockResolvedValue([DAY]);
    const app = await renderApp(`/?note=${encodeURIComponent(TODAY)}`);
    await settle();
    app.leader("g", "f");
    await settle();
    expect(
      within(logPane() as HTMLElement).getByRole("button", { name: "💧 500 ml" }),
    ).not.toBeNull();

    // The daily folder moved out of the periodic folder. The listing names no
    // note, so the log can only tell from the daily notes the listing now holds.
    fetchFiles.mockResolvedValue([...Object.keys(VAULT), `${ARCHIVE}/00 Daily/2026-10-20.md`]);
    fetchLog.mockClear();
    fetchLog.mockResolvedValue([]);
    act(() => stream().send({ path: "", change: "listing", digest: null }));
    await settle();

    expect.soft(fetchLog).toHaveBeenCalledWith(DATE, DATE);
    expect
      .soft(within(logPane() as HTMLElement).queryByRole("button", { name: "💧 500 ml" }))
      .toBeNull();
  });

  it("#796 a listing event that leaves the daily notes as they were does not ask the log again", async () => {
    todayText = LOGGED_TEXT;
    fetchLog.mockResolvedValue([DAY]);
    const app = await renderApp(`/?note=${encodeURIComponent(TODAY)}`);
    await settle();
    app.leader("g", "f");
    await settle();
    const asked = fetchLog.mock.calls.length;

    // A new note outside the daily folder changes the listing, not the daily notes.
    fetchFiles.mockResolvedValue([...Object.keys(VAULT), TODAY, `${INBOX}/new idea.md`]);
    act(() => stream().send({ path: "", change: "listing", digest: null }));
    await settle();

    expect(fetchLog).toHaveBeenCalledTimes(asked);
  });

  it("#795 a written event for the log config note asks the log again for the day and the trend", async () => {
    todayText = LOGGED_TEXT;
    fetchLog.mockResolvedValue([DAY]);
    const app = await renderApp(`/?note=${encodeURIComponent(TODAY)}`);
    await settle();
    app.leader("g", "f");
    await settle();

    fetchLog.mockClear();
    fetchLog.mockResolvedValue([DAY_750]);
    act(() => stream().send({ path: LOG_CONFIG, change: "written", digest: "a".repeat(64) }));
    await settle();

    expect.soft(fetchLog).toHaveBeenCalledWith(DATE, DATE);
    expect.soft(fetchLog).toHaveBeenCalledWith(TREND_FROM, DATE);
    expect(
      within(logPane() as HTMLElement).getByRole("button", { name: "💧 750 ml" }),
    ).not.toBeNull();
  });

  it("#795 a removed event for the log config note asks the log again", async () => {
    todayText = LOGGED_TEXT;
    fetchNote.mockImplementation(async (path: string) => {
      if (path === LOG_CONFIG) return "- 🍵 tea: 1 cup\n";
      return path === TODAY ? todayText : VAULT[path];
    });
    fetchLog.mockResolvedValue([DAY]);
    const app = await renderApp(`/?note=${encodeURIComponent(TODAY)}`);
    await settle();
    app.leader("g", "f");
    await settle();
    expect(
      within(logPane() as HTMLElement).getByRole("button", { name: "Log tea" }),
    ).not.toBeNull();

    // The note is gone from the vault, so the pane goes back to the three default kinds.
    fetchNote.mockImplementation(async (path: string) => {
      if (path === LOG_CONFIG) throw new NoteMissing(path);
      return path === TODAY ? todayText : VAULT[path];
    });
    fetchLog.mockClear();
    fetchNote.mockClear();
    act(() => stream().send({ path: LOG_CONFIG, change: "removed", digest: null }));
    await settle();

    expect.soft(fetchLog).toHaveBeenCalledWith(DATE, DATE);
    expect.soft(fetchNote).toHaveBeenCalledWith(LOG_CONFIG);
    expect
      .soft(within(logPane() as HTMLElement).queryByRole("button", { name: "Log tea" }))
      .toBeNull();
    expect(
      within(logPane() as HTMLElement).getByRole("button", { name: "Log water" }),
    ).not.toBeNull();
  });

  it("#796 a listing before the file listing first answered asks no log and throws nothing", async () => {
    // The listing is held back, so the cache has no answer to compare with while
    // the pane is open and the listing event comes in.
    let answer: (paths: string[]) => void = () => {};
    fetchFiles.mockReturnValue(
      new Promise<string[]>((resolve) => {
        answer = resolve;
      }),
    );
    const app = await renderApp(`/?note=${encodeURIComponent(TODAY)}`);
    await settle();
    app.leader("g", "f");
    await settle();
    const asked = fetchLog.mock.calls.length;

    act(() => stream().send({ path: "", change: "listing", digest: null }));
    await settle();
    expect(fetchLog).toHaveBeenCalledTimes(asked);

    // The first answer is the first one there is, so it has nothing to differ from.
    answer([...Object.keys(VAULT), TODAY]);
    await settle();

    expect(fetchLog).toHaveBeenCalledTimes(asked);
  });

  it("#813 a stream that opens again asks the log again and the pane shows the totals written while it was down", async () => {
    todayText = LOGGED_TEXT;
    fetchLog.mockResolvedValue([DAY]);
    const app = await renderApp(`/?note=${encodeURIComponent(TODAY)}`);
    await settle();
    app.leader("g", "f");
    await settle();
    // The first open is the stream coming up, before anything was missed.
    act(() => stream().onopen?.());
    await settle();

    // The backend was down, and the vault took 250 ml while it was.
    fetchLog.mockClear();
    fetchLog.mockResolvedValue([DAY_750]);
    act(() => stream().onopen?.());
    await settle();

    expect
      .soft(fetchLog.mock.calls.filter(([from, to]) => from === DATE && to === DATE))
      .toHaveLength(1);
    expect(
      within(logPane() as HTMLElement).getByRole("button", { name: "💧 750 ml" }),
    ).not.toBeNull();
  });

  it("#813 the first open of the stream asks the log once, not twice", async () => {
    todayText = LOGGED_TEXT;
    // Held back, so the first open lands while the pane's own first fetch is still in the air.
    let release: () => void = () => {};
    const answer = new Promise<LogDay[]>((resolve) => {
      release = () => resolve([DAY]);
    });
    fetchLog.mockReturnValue(answer);
    const app = await renderApp(`/?note=${encodeURIComponent(TODAY)}`);
    await settle();
    app.leader("g", "f");
    await settle();
    act(() => stream().onopen?.());
    await settle();
    release();
    await settle();

    expect(fetchLog.mock.calls.filter(([from, to]) => from === DATE && to === DATE)).toHaveLength(
      1,
    );
    expect(
      within(logPane() as HTMLElement).getByRole("button", { name: "💧 500 ml" }),
    ).not.toBeNull();
  });
});
