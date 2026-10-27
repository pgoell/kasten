import { cleanup, fireEvent } from "@testing-library/react";
import { useMemo } from "react";
import type { TodoHit } from "@/lib/api";
import type { PdfRenderer } from "@/lib/book/pdf-view";
import { noteBase } from "@/lib/note-base";
import type { TodoState } from "@/lib/todo/todo";
import { hashed } from "./digests";
import { defineFoliateFake, resetFoliateFake } from "./foliate-fake";
import { act, FakeEventSource, pageHooks, renderApp, settle } from "./home-route-fixture";

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

  /** Rename the folder the tree's cursor starts on, which is the literature one. */
  async function renameFolder(app: Awaited<ReturnType<typeof reading>>, to: string) {
    app.leader("e");
    await settle();
    fireEvent.keyDown(app.tree(), { key: "r" });
    await settle();
    app.fill(to);
    await settle();
  }

  it("reveals the note the reader is reading", async () => {
    // `openPath` is what the tree is told the focused pane holds, and a reader
    // holds `pane.book` rather than `pane.path`. Without that arm `<leader>E`
    // does nothing in the one pane where you least know where you are.
    const app = await reading();
    // Clicking a row does not move the tree cursor, so it is still on the
    // folder the tree opened on.
    expect(app.treeCursor()?.textContent).toBe("20 Literature");

    app.leader("E");
    await settle();

    expect(app.treeCursor()).toHaveAttribute("title", LIT);
  });

  it("follows the note when its folder moves", async () => {
    const app = await reading();
    expect(fetchBook).toHaveBeenCalledWith("20 Literature/DDIA.md");
    moveFolder.mockResolvedValue({ path: "Literature" });
    fetchFiles.mockResolvedValue(["Literature/DDIA.md", "index.md"]);

    await renameFolder(app, "Literature");

    expect(fetchBook).toHaveBeenCalledWith("Literature/DDIA.md");
    // The moved note and its book are both fresh queries, and the clock has to
    // run for their answers rather than only the microtasks `settle` flushes.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(app.reader()).not.toBeNull();
    expect(app.alert()).toBeNull();
  });

  it("leaves every other reader where it was", async () => {
    // `noteAfterPrompt` answers undefined for a pane the move did not touch, so
    // assigning its result straight to `book` would empty every reader in the
    // window whenever any folder moved.
    fetchFiles.mockResolvedValue([LIT, "elsewhere/note.md", "index.md"]);
    const app = await reading();
    // Folded again, so the row under the cursor's first step is the other
    // folder rather than the note inside this one.
    app.expand("20 Literature");
    await settle();
    moveFolder.mockResolvedValue({ path: "somewhere" });

    app.leader("e");
    await settle();
    fireEvent.keyDown(app.tree(), { key: "j" });
    fireEvent.keyDown(app.tree(), { key: "r" });
    await settle();
    app.fill("somewhere");
    await settle();

    expect(app.reader()).not.toBeNull();
    expect(fetchBook).toHaveBeenCalledTimes(1);
  });

  it("follows the note when the note alone is renamed", async () => {
    // The book travels with its note now, the vault carrying the sidecar with
    // the `.md`, so a reader that stayed on the old path would be reading a
    // file that is no longer there.
    const app = await reading();
    expect(fetchBook).toHaveBeenCalledWith("20 Literature/DDIA.md");
    // Back to the note's own pane: a rename acts on the focused pane's note.
    app.leader("o");
    await settle();
    renameNote.mockResolvedValue({ path: "20 Literature/Designing.md", content: "# DDIA" });
    fetchFiles.mockResolvedValue(["20 Literature/Designing.md", "index.md"]);

    app.leader("r", "f");
    await settle();
    app.fill("20 Literature/Designing.md");
    await settle();

    expect(fetchBook).toHaveBeenCalledWith("20 Literature/Designing.md");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(app.reader()).not.toBeNull();
    expect(app.alert()).toBeNull();
  });

  it("leaves a reader on another note alone when a note is renamed", async () => {
    // The pairing is by path, so only the reader holding the renamed note's
    // own book follows. Without the check every reader in the window would.
    fetchFiles.mockResolvedValue([LIT, "elsewhere/note.md", "index.md"]);
    const app = await reading();
    app.leader("o");
    await settle();
    renameNote.mockResolvedValue({ path: "20 Literature/Designing.md", content: "# DDIA" });

    app.leader("r", "f");
    await settle();
    app.fill("20 Literature/Designing.md");
    await settle();

    expect(fetchBook).not.toHaveBeenCalledWith("elsewhere/note.md");
  });

  describe("the archive", () => {
    /** A vault holding one live note and one filed away. */
    const FILED = ["index.md", "98 Archive/old cert.md"];

    it("keeps the archive out of the tree until the key asks for it", async () => {
      fetchFiles.mockResolvedValue(FILED);
      const app = await renderApp();
      await settle();

      // The folder, not the note in it: the tree draws a folder folded, so its
      // name appearing is the whole of what the toggle changes up here.
      expect(app.tree().textContent).not.toContain("98 Archive");

      app.leader("a");
      await settle();

      expect(app.tree().textContent).toContain("98 Archive");
    });

    it("asks the vault for the archive once the key is on, and not before", async () => {
      // Through the todo overlay, which is the one lookup that asks the vault
      // the moment it opens. What is pinned is that the flag reaches the
      // request at all: without it the backend goes on skipping the archive
      // whatever the key says, and the toggle would half work.
      fetchFiles.mockResolvedValue(FILED);
      const app = await renderApp();
      await settle();

      app.leader("f", "t");
      await settle();
      expect(fetchTodos).toHaveBeenCalledWith(false);

      fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
      await settle();
      app.leader("a");
      await settle();
      app.leader("f", "t");
      await settle();

      expect(fetchTodos).toHaveBeenCalledWith(true);
    });

    it("says on the status bar when the archive is showing", async () => {
      fetchFiles.mockResolvedValue(FILED);
      const app = await renderApp();
      await settle();

      expect(document.querySelector("[data-testid='archive-shown']")).toBeNull();

      app.leader("a");
      await settle();

      expect(document.querySelector("[data-testid='archive-shown']")).not.toBeNull();
    });
  });
});
