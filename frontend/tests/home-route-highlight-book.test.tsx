import { cleanup } from "@testing-library/react";
import { useMemo } from "react";
import { ChangedOnDisk, type TodoHit } from "@/lib/api";
import { noteBase } from "@/lib/note-base";
import type { PdfRenderer } from "@/lib/pdf-view";
import type { TodoState } from "@/lib/todo";
import { hashed } from "./digests";
import {
  defineFoliateFake,
  FakeView,
  lastView,
  resetFoliateFake,
  sectionsOf,
} from "./foliate-fake";
import { act, FakeEventSource, pageHooks, renderApp, settle, stream } from "./home-route-fixture";

defineFoliateFake();

// The doubles, the same in every home-route file: see home-route-fixture.tsx.
const {
  beside,
  fetchFiles,
  fetchNote,
  saveNote,
  updateNote,
  searchNotes,
  fetchMentions,
  createNote,
  renameNote,
  moveFolder,
  deleteNote,
  fetchTrash,
  restoreEntry,
  fetchTerminals,
  fetchTodos,
  fetchBook,
  uploadAsset,
  fetchImages,
  fetchHtml,
  fetchAssets,
  deleteImage,
  fetchVersion,
  fetchTags,
  fetchHistory,
  fetchHistoryText,
} = vi.hoisted(() => {
  const beside = (note: string, suffix = ".epub") => ({
    path: note.replace(/\.md$/, suffix),
    blob: new Blob(["a book"]),
  });

  const fetchNote = vi.fn();
  const saveNote = vi.fn();

  return {
    beside,
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
    renameNote: vi.fn(),
    moveFolder: vi.fn(),
    deleteNote: vi.fn(),
    fetchTrash: vi.fn(),
    restoreEntry: vi.fn(),
    fetchTerminals: vi.fn().mockResolvedValue([]),
    fetchTodos: vi.fn().mockResolvedValue([]),
    fetchBook: vi.fn(async (note: string) => beside(note)),
    uploadAsset: vi.fn().mockResolvedValue(undefined),
    fetchImages: vi.fn().mockResolvedValue([]),
    fetchHtml: vi.fn().mockResolvedValue([]),
    fetchAssets: vi.fn().mockResolvedValue([]),
    fetchTags: vi.fn().mockResolvedValue([]),
    deleteImage: vi.fn(),
    fetchVersion: vi.fn().mockResolvedValue("0.8.0"),
    fetchHistory: vi.fn(),
    fetchHistoryText: vi.fn(),
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
vi.mock("@/lib/move-api", () => ({ renameNote, moveFolder }));
vi.mock("@/lib/trash-api", () => ({ deleteNote, fetchTrash, restoreEntry, deleteImage }));
vi.mock("@/lib/history-api", () => ({ fetchHistory, fetchHistoryText }));
vi.mock("foliate-js/view.js", () => ({}));
const pdfPaneRenderer = vi.hoisted(() => ({ current: null as PdfRenderer | null }));
vi.mock("@/lib/pdf-view", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/pdf-view")>();
  return {
    ...real,
    pdfjsRenderer: {
      open: (url: string) => (pdfPaneRenderer.current ?? real.pdfjsRenderer).open(url),
    },
  };
});
const paneProps = vi.hoisted(() => ({
  current: null as {
    onRefile: (hit: TodoHit, project?: string) => void;
    onCycle: (hit: TodoHit, state?: TodoState, twins?: number[]) => void;
  } | null,
}));
vi.mock("@/components/todo-pane", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/todo-pane")>();
  function TodoPane(props: Parameters<typeof real.TodoPane>[0]) {
    paneProps.current = props;
    return <real.TodoPane {...props} />;
  }
  return { ...real, TodoPane };
});
const outbox = vi.hoisted(() => ({
  keep: vi.fn(),
  flush: vi.fn(),
  start: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));
vi.mock("@/lib/outbox", () => outbox);
vi.mock("@/lib/fuzzy", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/fuzzy")>();
  return {
    ...real,
    noteCandidates: vi.fn(real.noteCandidates),
    folderCandidates: vi.fn(real.folderCandidates),
    lineCandidates: vi.fn(real.lineCandidates),
  };
});
vi.mock("@/components/file-explorer", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/file-explorer")>();
  const buildTree = vi.fn(real.buildTree);
  function FileExplorer(props: Parameters<typeof real.FileExplorer>[0]) {
    useMemo(
      () => buildTree(props.paths, props.images, props.html, props.pdfs),
      [props.paths, props.images, props.html, props.pdfs],
    );
    return <real.FileExplorer {...props} />;
  }
  return { ...real, buildTree, FileExplorer };
});

pageHooks();

describe("opening a highlight's book with gf", () => {
  const LIT = "20 Literature/DDIA.md";
  const PASSAGE = "Systems that tolerate faults are called fault-tolerant.";
  /** A note beginning with a highlight block, so the cursor opens on the quote line. */
  const HELD = `> ${PASSAGE}\n\nSection 1 ^hl-a3f9c1\n`;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue([LIT, "index.md"]);
    fetchNote.mockResolvedValue(HELD);
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
    fetchImages.mockResolvedValue([]);
    fetchHtml.mockResolvedValue([]);
    fetchAssets.mockResolvedValue([]);
    fetchBook.mockImplementation(async (note: string) => beside(note));
    resetFoliateFake();
    // Without a section holding the words the walk finds nothing and calls
    // `onNotice` instead of navigating, which every case below would pass over.
    FakeView.sections = sectionsOf([PASSAGE]);
  });

  afterEach(async () => {
    cleanup();
    // A flush naming a base goes out once its hash lands, which must be
    // inside this test and not the next one.
    await hashed();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  /** Open the literature note, with the cursor on its first line. */
  async function opened() {
    const app = await renderApp();
    await settle();
    // The tree opens folded, so the note's row is not drawn until its folder is.
    app.expand("20 Literature");
    await settle();
    app.click(LIT);
    await settle();
    return app;
  }

  /**
   * Press `gf` where the cursor opens, which is the block's quote line.
   *
   * No motion first. That the other three places in a block answer the same is
   * pinned in `editor-follow-links.test.tsx`, where the same editor runs on a real clock:
   * `j` under this file's fake timers leaves the view taking no further keys.
   */
  async function follows(app: Awaited<ReturnType<typeof opened>>) {
    app.press("g");
    app.press("f");
    await settle();
  }

  /**
   * The vault reports a write nobody in this tab made, and refuses the quiet
   * save after it over its base, which is the conflict.
   */
  function somebodyElseWrote() {
    saveNote.mockRejectedValueOnce(new ChangedOnDisk());
    act(() => {
      stream().send({ path: LIT, change: "written", digest: "a".repeat(64) });
      vi.advanceTimersByTime(800);
    });
  }

  it("splits a reader beside the note and takes it to the passage", async () => {
    const app = await opened();

    await follows(app);
    expect(app.panes()).toBe(2);
    expect(app.reader()).not.toBeNull();
    expect(lastView().gone).toHaveLength(1);
  });

  it("writes no seek while the note stands conflicted", async () => {
    // `moveTo` refuses the key, and a seek set anyway would arm a jump in the
    // reader that is already open for a press that was refused.
    const app = await opened();
    app.leader("g", "r");
    await settle();
    app.leader("o");
    await settle();
    // Typed and undone, so the buffer is one the autosave is holding text for
    // while the block is exactly as the writer left it. That waiting text is
    // what makes the vault's write a conflict.
    app.press("x");
    app.press("u");
    somebodyElseWrote();
    await settle();

    await follows(app);

    expect(lastView().gone).toEqual([]);
  });

  it("hands the passage over once, and arms nothing for the next reader", async () => {
    // Without the clearing, a reader opened an hour later mounts holding a seek
    // nobody pressed a key for, over the bookmark PR 2 exists to keep.
    const app = await opened();
    await follows(app);
    expect(lastView().gone).toHaveLength(1);

    // Close the reader and open the book again the way `<leader>gr` does. The
    // focus is left on the emptied pane, which holds no note, so it goes back
    // to the note's pane first.
    app.leader("q");
    await settle();
    app.leader("o");
    await settle();
    app.leader("g", "r");
    await settle();
    expect(FakeView.made).toHaveLength(2);
    expect(lastView().gone).toEqual([]);
  });

  it("moves to the reader already open rather than making a second", async () => {
    // pin: `openBookBeside` focuses the pane already reading that note.
    const app = await opened();
    app.leader("g", "r");
    await settle();
    app.leader("o");
    await settle();

    await follows(app);

    expect(app.panes()).toBe(2);
    expect(FakeView.made).toHaveLength(1);
  });

  it("clears the notice the way every other key does", async () => {
    // pin: the press clears it, which is the rule PR 4 settled.
    const app = await opened();
    uploadAsset.mockRejectedValue(new Error("A book is already there"));
    app.leader("c", "b");
    app.choose(new File(["a book"], "Talk Like TED.epub"));
    await settle();
    expect(app.notice()).toBe("A book is already there");

    await follows(app);

    expect(app.notice()).toBeNull();
  });
});
