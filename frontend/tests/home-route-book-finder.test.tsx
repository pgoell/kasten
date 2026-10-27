import { cleanup, fireEvent, screen } from "@testing-library/react";
import { useMemo } from "react";
import type { TodoHit } from "@/lib/api";
import type { PdfRenderer } from "@/lib/book/pdf-view";
import { noteBase } from "@/lib/note-base";
import type { TodoState } from "@/lib/todo/todo";
import { hashed } from "./digests";
import { defineFoliateFake, FakeView, resetFoliateFake } from "./foliate-fake";
import {
  act,
  baseOf,
  FakeEventSource,
  pageHooks,
  renderApp,
  settle,
  VAULT,
} from "./home-route-fixture";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";

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

describe("the book finder", () => {
  // Laid out as the dev vault lays its books out: a folder of them, each note
  // with its epub beside it, and one more filed away in the archive.
  const BOOK = "04 Ressources/02 Literature/01 Books/DDIA.md";
  const ARCHIVED = "98 Archive/Old Book.md";
  const PLACE = "epubcfi(/6/4!/4/4/1:0)";
  const NOTES: Record<string, string> = {
    ...VAULT,
    [BOOK]: ["---", "id: ddia", `reading: ${PLACE}`, "---", "# DDIA"].join("\n"),
    [ARCHIVED]: "# Old Book",
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue(Object.keys(NOTES));
    fetchNote.mockImplementation(async (path: string) => NOTES[path]);
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
    fetchBook.mockImplementation(async (note: string) => beside(note));
    fetchImages.mockResolvedValue([]);
    fetchHtml.mockResolvedValue([]);
    fetchAssets.mockResolvedValue([
      BOOK.replace(/\.md$/, ".epub"),
      ARCHIVED.replace(/\.md$/, ".epub"),
    ]);
    resetFoliateFake();
  });

  afterEach(async () => {
    cleanup();
    await hashed();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  /** The finder's own dialog, or null while it is shut. */
  const finder = () => screen.queryByRole("dialog", { name: "Find book" });

  /** Open the index note, which is what the focused pane holds before a book is picked. */
  async function opened() {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    return app;
  }

  /**
   * Enter in the finder's input. Looked up rather than got, so a finder that
   * never opened leaves the assertions after this to say so.
   */
  async function enter() {
    const input = screen.queryByRole("combobox");
    if (input) fireEvent.keyDown(input, { key: "Enter" });
    await hashed();
    await settle();
  }

  /** Whether an editor anywhere on the page holds the book's note. */
  const bookNoteEdited = () =>
    [...document.querySelectorAll(".cm-content")].some((editor) =>
      editor.textContent?.includes("DDIA"),
    );

  it("A1 opens on <leader>fb with vim on", async () => {
    const app = await opened();

    app.leader("f", "b");
    await settle();

    expect(finder()).not.toBeNull();
  });

  it("A2 opens from the palette's Find a book row with vim off", async () => {
    localStorage.setItem("kasten.vim", "off");
    try {
      const app = await opened();
      // No leader with vim off: the palette, by its chord on a desktop.
      app.press("P", { keyCode: 80, ctrlKey: true, shiftKey: true });
      await settle();
      const row = screen.queryByRole("option", { name: /^Find a book/ });
      expect.soft(row).not.toBeNull();
      if (row) fireEvent.click(row);
      await settle();

      expect(finder()).not.toBeNull();
    } finally {
      localStorage.removeItem("kasten.vim");
    }
  });

  it("A5 opens the highlighted book in the focused pane on its own, with no split and no note", async () => {
    const app = await opened();

    app.leader("f", "b");
    await settle();
    await enter();

    expect.soft(finder()).toBeNull();
    expect.soft(app.reader()).not.toBeNull();
    expect.soft(fetchBook).toHaveBeenCalledWith(BOOK);
    expect.soft(app.panes()).toBe(1);
    expect.soft(bookNoteEdited()).toBe(false);
    // Replaced, not split: the note the pane held is gone with its editor.
    expect.soft(document.querySelector(".cm-content")).toBeNull();
  });

  it("A6 opens the reader at the note's reading: place", async () => {
    const app = await opened();

    app.leader("f", "b");
    await settle();
    await enter();
    await settle();

    // Read off the list rather than through `lastView`, which throws when no
    // reader was built and would stop this before it says so.
    expect(FakeView.made.at(-1)?.inits[0]).toEqual({ lastLocation: PLACE });
  });

  it("A11 leaves an archived book out of the list", async () => {
    const app = await opened();

    app.leader("f", "b");
    await settle();

    expect.soft(screen.queryByRole("option", { name: /^DDIA/ })).not.toBeNull();
    expect.soft(screen.queryByRole("option", { name: /^Old Book/ })).toBeNull();
  });

  it("A11 lists an archived book with <leader>a on", async () => {
    const app = await opened();

    app.leader("a");
    await settle();
    app.leader("f", "b");
    await settle();

    expect(screen.queryByRole("option", { name: /^Old Book/ })).not.toBeNull();
  });

  it("I1 writes the unsaved text of the focused note before the book replaces it", async () => {
    const app = await opened();
    app.press("x");
    expect(app.text()).toBe("he index note");

    app.leader("f", "b");
    await settle();
    await enter();

    expect
      .soft(saveNote)
      .toHaveBeenCalledWith("index.md", "he index note", false, await baseOf("the index note"));
    expect.soft(app.reader()).not.toBeNull();
  });

  it("I1 keeps the note in place when the write before the book fails", async () => {
    const app = await opened();
    app.press("x");
    saveNote.mockRejectedValueOnce(new Error("PUT failed with 500"));

    app.leader("f", "b");
    await settle();
    expect.soft(finder()).not.toBeNull();
    await enter();

    expect.soft(app.reader()).toBeNull();
    expect.soft(document.querySelector(".cm-content")?.textContent).toBe("he index note");
  });

  it("I1 keeps the focus in the note when the write before the book fails", async () => {
    const app = await opened();
    app.press("x");
    saveNote.mockRejectedValueOnce(new Error("PUT failed with 500"));

    app.leader("f", "b");
    await settle();
    expect.soft(finder()).not.toBeNull();
    await enter();

    // The finder gives no focus back once a row is taken, so with no pane
    // change to take it either the keys would land on the body.
    expect(document.querySelector(".cm-content")?.contains(document.activeElement)).toBe(true);
  });

  it("A8 on a phone a tap through run, Find a book and a book row opens the book alone in the one pane", async () => {
    localStorage.setItem("kasten.vim", "off");
    try {
      stubMatchMedia({ [NARROW]: true, [COARSE]: true });
      const app = await renderApp();
      await settle();

      fireEvent.click(screen.getByRole("button", { name: "Run a command by name" }));
      const row = screen.queryByRole("option", { name: /^Find a book/ });
      expect.soft(row).not.toBeNull();
      if (row) fireEvent.click(row);
      await settle();
      const book = screen.queryByRole("option", { name: /^DDIA/ });
      expect.soft(book).not.toBeNull();
      if (book) fireEvent.click(book);
      await hashed();
      await settle();

      expect.soft(app.reader()).not.toBeNull();
      expect.soft(fetchBook).toHaveBeenCalledWith(BOOK);
      expect.soft(app.panes()).toBe(1);
      expect.soft(bookNoteEdited()).toBe(false);
    } finally {
      localStorage.removeItem("kasten.vim");
    }
  });

  it("I2 moves to a reader already open on the book rather than opening a second", async () => {
    const app = await renderApp();
    await settle();
    // The tree opens folded, so each folder is unfolded on the way down.
    app.expand("04 Ressources");
    await settle();
    app.expand("02 Literature");
    await settle();
    app.expand("01 Books");
    await settle();
    app.click(BOOK);
    await settle();
    app.leader("g", "r");
    await settle();
    // Back to the note, so the book is open in a pane other than the focused
    // one. A focus and not `<leader>h`: jsdom lays out no boxes to go left by.
    act(() => app.focusPane(0));
    await settle();
    expect(app.focusedPane()).toBe(0);

    app.leader("f", "b");
    await settle();
    await enter();

    expect.soft(app.panes()).toBe(2);
    expect.soft(document.querySelectorAll("foliate-view")).toHaveLength(1);
    expect.soft(app.focusedPane()).toBe(1);
  });
});
