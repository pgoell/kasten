import { cleanup } from "@testing-library/react";
import { useMemo } from "react";
import type { TodoHit } from "@/lib/api";
import type { PdfRenderer } from "@/lib/book/pdf-view";
import { noteBase } from "@/lib/note-base";
import type { TodoState } from "@/lib/todo/todo";
import { digestOf } from "@/lib/vault-events";
import { hashed } from "./digests";
import { defineFoliateFake, FakeView, lastView, resetFoliateFake } from "./foliate-fake";
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

  /** A second place, for the cases needing two accepted moves in one reading. */
  const ELSEWHERE = "epubcfi(/6/8!/4/2/1:0)";

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

  describe("keeping your place", () => {
    // Unmounted here rather than by the hook outside, so the flush the reader's
    // own teardown runs is finished with before the mocks are reset. A write
    // left in the air lands inside the next test carrying this one's position.
    afterEach(async () => {
      cleanup();
      await hashed();
      await settle();
    });

    it("writes where the reader got to once the reading stops", async () => {
      await reading();

      turnedTo(PLACE);
      await settle();
      expect(saveNote).not.toHaveBeenCalled();

      await waited();

      expect(saveNote).toHaveBeenCalledWith(
        LIT,
        expect.stringContaining(`reading: ${PLACE}`),
        false,
        expect.any(String),
      );
    });

    it("names the note it read as the bookmark write's base", async () => {
      await reading();

      turnedTo(PLACE);
      await waited();

      expect(saveNote).toHaveBeenCalledWith(
        LIT,
        expect.stringContaining(`reading: ${PLACE}`),
        false,
        noteBase("# DDIA"),
      );
    });

    it("puts the note the vault answered with in the cache", async () => {
      // What the editor reloads off, so a clean buffer holds the bookmark
      // within a render and its next save carries it.
      const app = await reading();

      turnedTo(PLACE);
      await waited();

      expect(app.cached(LIT)).toBe(saveNote.mock.calls[0]?.[1]);
    });

    it("reads nothing at all while the note is in the focused pane", async () => {
      // The read and not the write, because asserting only that `saveNote` was
      // not called stays green with this guard removed and the second reading
      // of it left in.
      const app = await reading();
      // The baseline is the point: the editor read the note when it opened and
      // the pane read it again to restore, so a bare "never called" cannot pass.
      fetchNote.mockClear();

      app.leader("o");
      await settle();
      turnedTo(PLACE);
      await waited();

      expect(fetchNote).not.toHaveBeenCalled();
    });

    it("reads nothing while a write of the note's own text is still out", async () => {
      // The tail the focused-pane guard cannot see: moving to the reader
      // flushes the note being left, and that write is still in the air with
      // the focus already gone. Without this case the route can drop its
      // `isWriting` call and every other test stays green.
      const app = await reading();
      app.leader("o");
      await settle();
      app.press("x");
      await settle();

      let written: (() => void) | undefined;
      saveNote.mockImplementationOnce(
        (path: string, content: string) =>
          new Promise((resolve) => {
            written = () => resolve({ path, content });
          }),
      );
      app.leader("o");
      await settle();
      expect(saveNote).toHaveBeenCalledTimes(1);
      fetchNote.mockClear();

      turnedTo(PLACE);
      await waited();

      expect(fetchNote).not.toHaveBeenCalled();
      written?.();
    });

    it("writes nothing into a note that has left the listing", async () => {
      // With the read answering normally, so this fails for the right reason.
      // Letting it fail instead would pass with the guard removed, the write
      // stopping at the read either way.
      await reading();
      turnedTo(PLACE);
      await settle();

      fetchFiles.mockResolvedValue(["index.md"]);
      act(() => stream().send({ path: LIT, change: "removed", digest: null }));
      await settle();
      fetchNote.mockClear();

      await waited();

      expect(fetchNote).not.toHaveBeenCalled();
      expect(saveNote).not.toHaveBeenCalled();
    });

    it("writes nothing when the note takes the focus during the read", async () => {
      // The save that starts in the same tick as the write. The read took a
      // round trip, and the note can take the focus inside it.
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
      await waited();
      expect(fetchNote).toHaveBeenCalledWith(LIT);

      app.leader("o");
      await settle();
      answer?.();
      await settle();

      expect(saveNote).not.toHaveBeenCalled();
    });

    it("drops the wait when the note takes the focus", async () => {
      // The focus moving away again before the timer would have fired is what
      // keeps this honest: the guard alone would otherwise pass it.
      const app = await reading();
      turnedTo(PLACE);
      await settle();

      app.leader("o");
      await settle();
      app.leader("o");
      await settle();
      await waited();

      expect(saveNote).not.toHaveBeenCalled();
    });

    it("never lets its own write reach the editor as somebody else's", async () => {
      // The one case here that drives a real CodeMirror mid-write, because
      // nothing else can pin that the route calls `adopt` at all. The order is
      // exact: the write has to start with the reader focused and land with the
      // note focused, or `adopt` refuses a note the hook is not following.
      const app = await reading();
      turnedTo(PLACE);
      await settle();

      let sent = "";
      let land: (() => void) | undefined;
      saveNote.mockImplementationOnce(
        (path: string, content: string) =>
          new Promise((resolve) => {
            sent = content;
            land = () => resolve({ path, content });
          }),
      );
      await waited();
      expect(saveNote).toHaveBeenCalledOnce();

      app.leader("o");
      await settle();
      app.press("x");
      await settle();
      const typed = app.text();

      land?.();
      await hashed();
      // The cache reaching the editor, which is the half the event never
      // exercises: `setQueryData` notifies on a zero-delay timer, the reload
      // effect asks `allowReload`, and the adopted text is what makes it refuse
      // without a word.
      await settle();

      // And then the same write off the stream, which is what `reconcile`
      // answers. In this order because a matched digest takes the entry out of
      // the map and `allowReload` does not, which is the app's own order too: a
      // zero-delay timer beats a `PUT` plus a watcher debounce every time.
      const digest = await digestOf(sent);
      act(() => stream().send({ path: LIT, change: "written", digest }));
      await settle();

      expect(app.status()).not.toBe("Changed on disk");
      expect(app.text()).toBe(typed);
    });

    it("writes at once when the reader is closed", async () => {
      const app = await reading();

      turnedTo(PLACE);
      await settle();

      app.leader("q");
      await settle();

      expect(saveNote).toHaveBeenCalledWith(
        LIT,
        expect.stringContaining(`reading: ${PLACE}`),
        false,
        expect.any(String),
      );
    });

    /** The note as the vault holds it, with the block the case is about. */
    function held(...block: string[]): string {
      return [...(block.length === 0 ? [] : ["---", ...block, "---"]), "# DDIA"].join("\n");
    }

    /** The text of the first write, or nothing where nothing was written. */
    function written(): string {
      return (saveNote.mock.calls[0]?.[1] as string | undefined) ?? "";
    }

    /** Every `type` line the write carried, which is how a second one is caught. */
    function types(): string[] {
      return written()
        .split("\n")
        .filter((line) => line.startsWith("type:"));
    }

    it("types a note Book on the first page you turn to", async () => {
      fetchNote.mockResolvedValue(held("id: one", "type: Note"));
      await reading();

      turnedTo(PLACE);
      await waited();

      expect(types()).toEqual(["type: Book"]);
      expect(written()).toContain(`reading: ${PLACE}`);
    });

    it("types a note Source where what is beside it is a pdf", async () => {
      // Which type it is comes off the file rather than off the note: a pdf is
      // as often a paper, a report or a deck as it is a book, and `Source` is
      // the ontology's own name for something written elsewhere. Read out of
      // the same cache the reader filled, so nothing asks the vault twice.
      fetchBook.mockImplementation(async (note: string) => beside(note, ".pdf"));
      fetchNote.mockResolvedValue(held("id: one", "type: Note"));
      await reading();

      turnedTo(PLACE);
      await waited();

      expect(types()).toEqual(["type: Source"]);
      expect(written()).toContain(`reading: ${PLACE}`);
    });

    it("types a note that carries no block at all", async () => {
      // The block is minted by the write, the way `reading:` is minted into
      // one: a book dropped in from the shell pane has a note like this.
      fetchNote.mockResolvedValue("# DDIA");
      await reading();

      turnedTo(PLACE);
      await waited();

      expect(types()).toEqual(["type: Book"]);
    });

    it("writes nothing at all where the only move was the restore", async () => {
      // The type rides an accepted position write, and the move that opens the
      // book is not one. A book opened and never paged through is not typed.
      await reading();

      FakeView.cfis = ["the page it opened on"];
      turn();
      await waited();

      expect(saveNote).not.toHaveBeenCalled();
    });

    it("leaves a note already saying Book with the one line it had", async () => {
      fetchNote.mockResolvedValue(held("id: one", "type: Book"));
      await reading();

      turnedTo(PLACE);
      await waited();

      expect(types()).toEqual(["type: Book"]);
    });

    it("keeps a type the reader typed, and bookmarks the page all the same", async () => {
      // `Book` goes over `Note` or over nothing and over nothing else. A note
      // typed by hand keeps what was typed, and reading it does not argue.
      fetchNote.mockResolvedValue(held("id: one", "type: Source"));
      await reading();

      turnedTo(PLACE);
      await waited();

      expect(types()).toEqual(["type: Source"]);
      expect(written()).toContain(`reading: ${PLACE}`);
    });

    it("types the note on the write after the focus has left it", async () => {
      // The whole reason the type rides the position write and not the upload:
      // a refused write comes round again, and a one-shot write at upload would
      // be dropped for good.
      const app = await reading();
      app.leader("o");
      await settle();

      FakeView.cfis = ["the page it opened on", PLACE, ELSEWHERE];
      turn();
      turn();
      await waited();
      expect(saveNote).not.toHaveBeenCalled();

      app.leader("o");
      await settle();
      turn();
      await waited();

      expect(types()).toEqual(["type: Book"]);
      expect(written()).toContain(`reading: ${ELSEWHERE}`);
    });
  });
});
