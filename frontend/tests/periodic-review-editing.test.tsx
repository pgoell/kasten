import { EditorView } from "@codemirror/view";
import { cleanup } from "@testing-library/react";
import { NoteMissing } from "@/lib/api";
import { applyLayout } from "@/lib/layout";
import { hashed } from "./digests";
import { defineFoliateFake } from "./foliate-fake";
import { FakeEventSource, pageHooks, renderApp, settle, stream, VAULT } from "./home-route-fixture";
import { DEFAULT_LAYOUT } from "./home-route-overview-fixture";
import {
  CONFIG,
  docText,
  LOG_CONFIG,
  NOW,
  reviewText,
  TODAY,
  WEEK_CARDS,
  WEEK_DAILY,
  WEEK_GITHUB,
  WEEK_LOG,
  WEEK_NOTE,
  WEEK_TEXT,
  WEEK_TODOS,
  YEAR_NOTE,
  YEAR_TEXT,
} from "./periodic-review-fixture";

defineFoliateFake();

/** Notes the review is not for: the weekly folder's index, a daily note and a project note. */
const WEEKLY_INDEX = "01 Periodic/01 Weekly/index.md";
const PROJECT_NOTE = "02 Projects/x.md";

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

/** Opens a note on the route the way a link does, and lets its reads arrive. */
async function openNote(path: string) {
  const app = await renderApp(`/?note=${encodeURIComponent(path)}`);
  await settle();
  await settle();
  return app;
}

/** The text each note the editing tests open answers with. A path not here is a note that is not there. */
const TEXTS: Record<string, string> = {
  ...VAULT,
  ...WEEK_DAILY,
  [LOG_CONFIG]: CONFIG,
  [WEEK_NOTE]: WEEK_TEXT,
  [YEAR_NOTE]: YEAR_TEXT,
  [WEEKLY_INDEX]: "# Weekly\n\nmy own line\n",
  [PROJECT_NOTE]: "# x\n\nmy own line\n",
  [TODAY]: "# 2026-10-25 Sunday\n\nmy own line\n",
};

/** The editor view of the note open in the one pane. */
function view(): EditorView {
  const found = EditorView.findFromDOM(
    document.querySelector<HTMLElement>(".cm-content") as HTMLElement,
  );
  if (found === null) throw new Error("no editor is open");
  return found;
}

/** The number of the line the cursor sits on. */
function cursorLine(): number {
  const { state } = view();
  return state.doc.lineAt(state.selection.main.head).number;
}

/** How many times each read has been asked, which the typing below must not change. */
function readCounts(): number[] {
  return [fetchLog, fetchTodos, fetchCards, fetchWritten, fetchWrittenNotes, fetchGithub].map(
    (read) => read.mock.calls.length,
  );
}

describe("the periodic reviews in the note, read and edit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue([
      ...Object.keys(VAULT),
      WEEK_NOTE,
      YEAR_NOTE,
      WEEKLY_INDEX,
      TODAY,
      PROJECT_NOTE,
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

  it("#807 A1 the week review sits in Read and in Edit, and opening, reading and leaving the weekly note writes nothing", async () => {
    const app = await openNote(WEEK_NOTE);
    expect(reviewText()).toContain("Week in review");
    expect(docText()).toBe(WEEK_TEXT);

    app.leader("p");
    await settle();
    expect(reviewText()).toContain("Week in review");
    expect(docText()).toBe(WEEK_TEXT);

    app.click("other.md");
    await settle();
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("#807 I3 the weekly note draws a review, and the weekly folder's index, a daily note and a project note draw none", async () => {
    await openNote(WEEK_NOTE);
    expect(reviewText()).toContain("Week in review");

    // Each note in a page of its own, since a note left on the page keeps its block until it is gone.
    for (const path of [WEEKLY_INDEX, TODAY, PROJECT_NOTE]) {
      cleanup();
      await openNote(path);
      expect(docText(), path).toContain("my own line");
      expect(reviewText(), path).toBe("");
    }
  });

  it("#807 I5 typing in the note below the review asks no read again", async () => {
    await openNote(WEEK_NOTE);
    const before = readCounts();

    view().dispatch({ changes: { from: view().state.doc.length, insert: "one more line\n" } });
    await settle();

    expect(readCounts()).toEqual(before);
    expect(docText()).toBe(`${WEEK_TEXT}one more line\n`);
    expect(reviewText()).toContain("Week in review");
  });

  it("#807 I5 an autosave of another note in the other pane asks the written notes again", async () => {
    // The yearly note is the one on screen; the other pane's autosave of note A arrives as a write
    // with its digest, as the backend sends it.
    await openNote(YEAR_NOTE);
    const before = fetchWrittenNotes.mock.calls.length;

    stream().send({ path: "00 Inbox/a.md", change: "written", digest: "ab12cd34" });
    await settle();

    expect(fetchWrittenNotes.mock.calls.length).toBeGreaterThan(before);
  });

  // gg and G count lines, which jsdom can do. j and k move by screen rows, which jsdom lays
  // out as zero, so they are left to a browser run.
  it("#807 I6 with vim on, gg and G move the cursor from the title to the last line, and the block takes no line", async () => {
    localStorage.setItem("kasten.vim", "on");
    const app = await openNote(WEEK_NOTE);
    expect(reviewText()).toContain("Week in review");

    app.press("G");
    expect(cursorLine()).toBe(4);
    app.press("g");
    app.press("g");
    expect(cursorLine()).toBe(1);
    expect(docText()).not.toContain("Week in review");
  });

  it("#807 I6 selecting all of the text below the review and deleting it never writes the block into the note", async () => {
    await openNote(WEEK_NOTE);
    expect(reviewText()).toContain("Week in review");

    view().dispatch({ changes: { from: 0, to: view().state.doc.length } });
    await settle();

    expect(docText()).toBe("");
    expect(docText()).not.toContain("Week in review");
  });

  it("#807 I6 with vim off, typing below the review edits the note in Read and in Edit", async () => {
    await typedBelowTheReview("off");
  });

  it("#807 I6 with vim on, typing below the review edits the note in Read and in Edit", async () => {
    await typedBelowTheReview("on");
  });
});

/** Types a line under the year's text in Read, then in Edit, and checks the note holds both lines. */
async function typedBelowTheReview(vim: "on" | "off") {
  localStorage.setItem("kasten.vim", vim);
  const app = await openNote(YEAR_NOTE);
  expect(reviewText()).toContain("Year in review");

  view().dispatch({ changes: { from: view().state.doc.length, insert: `read ${vim}\n` } });
  await settle();
  app.leader("p");
  await settle();
  view().dispatch({ changes: { from: view().state.doc.length, insert: `edit ${vim}\n` } });
  await settle();

  expect(docText()).toBe(`${YEAR_TEXT}read ${vim}\nedit ${vim}\n`);
  expect(docText()).not.toContain("Year in review");
}
