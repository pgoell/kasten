import { cleanup } from "@testing-library/react";
import { useMemo } from "react";
import { ChangedOnDisk, type TodoHit } from "@/lib/api";
import type { PdfRenderer } from "@/lib/book/pdf-view";
import { noteBase } from "@/lib/note-base";
import type { TodoState } from "@/lib/todo/todo";
import { hashed } from "./digests";
import { defineFoliateFake, FakeView, lastView, resetFoliateFake, selectIn } from "./foliate-fake";
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
vi.mock("@/lib/book/pdf-view", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/book/pdf-view")>();
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

describe("a reader when the vault moves under it", () => {
  const LIT = "20 Literature/DDIA.md";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue([LIT, "index.md"]);
    fetchNote.mockResolvedValue("# DDIA");
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
    fetchBook.mockImplementation(async (note: string) => beside(note));
    resetFoliateFake();
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

  /** Open the literature note and its book beside it. */
  async function reading() {
    const app = await renderApp();
    await settle();
    // The tree opens folded, so the note's row is not drawn until its folder is.
    app.expand("20 Literature");
    await settle();
    app.click(LIT);
    await settle();
    app.leader("g", "r");
    await settle();
    expect(app.reader()).not.toBeNull();
    return app;
  }

  /** What the pane reports, and what the note ends up carrying. */
  const PLACE = "epubcfi(/6/4!/4/4/1:0)";

  /** How long the bookmark waits for quiet. */
  const WAIT = 60_000;

  /**
   * A page turn, as the renderer reports one.
   *
   * Two are needed before anything is reported, the first being the
   * navigation `init` performs, and the two must carry two positions or the
   * pane's own dedupe swallows the second.
   */
  function turn() {
    act(() => lastView().emitRelocate({ reason: "page" }));
  }

  /** Turn the page twice, which is one reported move. */
  function turnedTo(cfi: string) {
    FakeView.cfis = ["the page it opened on", cfi];
    turn();
    turn();
  }

  /** Let the whole bookmark wait pass, and whatever it started settle. */
  async function waited() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WAIT);
    });
    await settle();
  }

  describe("taking a passage into the note", () => {
    /** What the reader selected, which the note ends up quoting. */
    const PASSAGE = "Systems that tolerate faults are called fault-tolerant.";

    // The reader's teardown flushes, the way the bookmark's own block does it.
    afterEach(async () => {
      cleanup();
      await hashed();
      await settle();
    });

    /** Select a passage in the book and press `y`, the way a reader does. */
    async function takes(text = PASSAGE) {
      // The seam every key and selection reaches the pane through: an event
      // does not cross a document boundary.
      act(() => lastView().emitLoad());
      act(() => selectIn(lastView().section, text));
      act(() =>
        lastView().section.dispatchEvent(new KeyboardEvent("keydown", { key: "y", bubbles: true })),
      );
      await settle();
    }

    it("writes the passage into the note beside the book", async () => {
      const app = await reading();
      fetchNote.mockClear();

      await takes();

      expect(saveNote).toHaveBeenCalledWith(
        LIT,
        expect.stringContaining(`> ${PASSAGE}`),
        false,
        expect.any(String),
      );
      expect(saveNote).toHaveBeenCalledWith(
        LIT,
        expect.stringContaining("## Highlights"),
        false,
        expect.any(String),
      );
      expect(saveNote).toHaveBeenCalledWith(
        LIT,
        expect.stringMatching(/Section 1 \^hl-[0-9a-f]{6}/),
        false,
        expect.any(String),
      );
      // The invalidation, read as the reload it causes: what comes back is
      // read again, so a clean editor picks the highlight up and a dirty one
      // raises the conflict it should.
      expect(fetchNote).toHaveBeenCalledWith(LIT);
      expect(app.notice()).toBeNull();
    });

    it("writes it while the note is the focused pane's and dirty", async () => {
      // The case that fails if somebody copies the bookmark's focus guard onto
      // this write. A highlight is a press: you asked for it, so the conflict
      // it may cause is information rather than rudeness.
      const app = await reading();
      app.leader("o");
      await settle();
      app.press("x");
      await settle();
      expect(app.status()).toBe("Unsaved changes");

      await takes();

      expect(saveNote).toHaveBeenCalledWith(
        LIT,
        expect.stringContaining(`> ${PASSAGE}`),
        false,
        expect.any(String),
      );
    });

    it("writes nothing into a note that has left the listing", async () => {
      const app = await reading();
      fetchFiles.mockResolvedValue(["index.md"]);
      act(() => stream().send({ path: LIT, change: "removed", digest: null }));
      await settle();
      fetchNote.mockClear();

      await takes();

      expect(fetchNote).not.toHaveBeenCalled();
      expect(saveNote).not.toHaveBeenCalled();
      expect(app.notice()).toBe("That note has left the vault");
    });

    it("names the note it read as the highlight write's base", async () => {
      await reading();

      await takes();

      expect(saveNote).toHaveBeenCalledWith(
        LIT,
        expect.stringContaining(`> ${PASSAGE}`),
        false,
        noteBase("# DDIA"),
      );
    });

    it("says the highlight was not written when the note changed on disk every time", async () => {
      const app = await reading();
      // What `updateNote` throws once its tries are spent.
      saveNote.mockRejectedValueOnce(new ChangedOnDisk());

      await takes();

      expect(app.notice()).toBe("The highlight was not written");
    });

    it("says so in the bar when the vault refuses the write", async () => {
      const app = await reading();
      saveNote.mockRejectedValueOnce(new Error("PUT failed with 500"));

      await takes();

      expect(app.notice()).toBe("The highlight was not written");
    });

    it("keeps a bookmark write from overtaking a highlight write", async () => {
      // Both writers read the whole note and write the whole of it back, so
      // interleaved they lose one of the two. Nothing on screen says the gate
      // worked, which is why this case is the only thing that can fail.
      const app = await reading();
      turnedTo(PLACE);
      await settle();

      let answer: (() => void) | undefined;
      fetchNote.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = () => resolve("# DDIA");
          }),
      );
      await takes();
      expect(fetchNote).toHaveBeenCalledWith(LIT);
      fetchNote.mockClear();

      await waited();

      expect(fetchNote).not.toHaveBeenCalled();
      answer?.();
      await settle();
      expect(app.notice()).toBeNull();
    });
  });
});
