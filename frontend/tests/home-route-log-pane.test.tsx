import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { NoteMissing } from "@/lib/api";
import type { LogDay } from "@/lib/food-api";
import { noteBase } from "@/lib/note-base";
import { periodicNote } from "@/lib/periodic";
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
});
