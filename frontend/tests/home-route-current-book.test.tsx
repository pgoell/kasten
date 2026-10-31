import { EditorView } from "@codemirror/view";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { useMemo } from "react";
import { NoteMissing, type TodoHit } from "@/lib/api";
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

describe("reading the current book", () => {
  // Spelled out rather than imported, so the fake below keys on the default
  // layout's path whatever the route makes of it.
  const READING = "99 Misc/01 Config/reading-now.md";
  const BOOK = "04 Ressources/02 Literature/01 Books/The Expectant Father.md";
  const PAPER = "Papers/Paper.md";
  const BARE = "Notes/Bare.md";
  const PLACE = "epubcfi(/6/4!/4/4/1:0)";
  const NOTES: Record<string, string> = {
    ...VAULT,
    [BOOK]: ["---", "id: father", `reading: ${PLACE}`, "---", "# The Expectant Father"].join("\n"),
    [PAPER]: "# Paper",
    [BARE]: "# Bare",
  };
  /** What reading-now.md holds on disk, or null for a vault without it. */
  let reading: string | null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    reading = "[[The Expectant Father]]";
    // The config note is listed even where it is gone, so only its read can
    // say it is not there.
    fetchFiles.mockResolvedValue([...Object.keys(NOTES), READING]);
    fetchNote.mockImplementation(async (path: string) => {
      if (path !== READING) return NOTES[path];
      if (reading === null) throw new NoteMissing(path);
      return reading;
    });
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
    fetchBook.mockImplementation(async (note: string) => beside(note));
    fetchImages.mockResolvedValue([]);
    fetchHtml.mockResolvedValue([]);
    fetchAssets.mockResolvedValue([BOOK.replace(/\.md$/, ".epub"), PAPER.replace(/\.md$/, ".pdf")]);
    resetFoliateFake();
  });

  afterEach(async () => {
    cleanup();
    await hashed();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  /** Open the index note, which is what the focused pane holds before the press. */
  async function opened() {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    return app;
  }

  /** Space g c, and every answer it waits on. */
  async function press(app: Awaited<ReturnType<typeof renderApp>>) {
    app.leader("g", "c");
    await hashed();
    await settle();
  }

  /** Whether an editor anywhere on the page holds the book's note. */
  const bookNoteEdited = () =>
    [...document.querySelectorAll(".cm-content")].some((editor) =>
      editor.textContent?.includes("The Expectant Father"),
    );

  it("A1 opens the linked book in the focused pane on its own, with no split and no note", async () => {
    const app = await opened();

    await press(app);

    expect.soft(app.reader()).not.toBeNull();
    expect.soft(fetchBook).toHaveBeenCalledWith(BOOK);
    expect.soft(app.panes()).toBe(1);
    expect.soft(bookNoteEdited()).toBe(false);
    // Replaced, not split: the note the pane held is gone with its editor.
    expect.soft(document.querySelector(".cm-content")).toBeNull();
    expect.soft(app.notice()).toBeNull();
  });

  it("A2 hands the reader the book's note, so it opens at the note's reading: place", async () => {
    const app = await opened();

    await press(app);
    await settle();

    // The pane's book is the note's path, which is what the reader asks the
    // vault about and reads `reading:` out of.
    expect.soft(fetchBook).toHaveBeenCalledWith(BOOK);
    expect.soft(fetchNote).toHaveBeenCalledWith(BOOK);
    expect.soft(FakeView.made.at(-1)?.inits[0]).toEqual({ lastLocation: PLACE });
  });

  it("A3 says so when reading-now.md is not there", async () => {
    reading = null;
    const app = await opened();

    await press(app);

    expect.soft(app.notice()).toBe(`${READING} is not there`);
    expect.soft(app.reader()).toBeNull();
    expect.soft(app.text()).toBe("the index note");
  });

  it("A4 says so when reading-now.md holds no link", async () => {
    reading = "The Expectant Father, chapter three";
    const app = await opened();

    await press(app);

    expect.soft(app.notice()).toBe(`${READING} links no book note`);
    expect.soft(app.reader()).toBeNull();
  });

  it("A5 names the link when it names no note", async () => {
    reading = "[[Nowhere]]";
    const app = await opened();

    await press(app);

    expect.soft(app.notice()).toBe("[[Nowhere]] in reading-now.md names no note");
    expect.soft(app.reader()).toBeNull();
  });

  it("says what went wrong when reading-now.md cannot be read", async () => {
    fetchNote.mockImplementation(async (path: string) => {
      if (path === READING) throw new Error("the server answered 500");
      return NOTES[path];
    });
    const app = await opened();

    await press(app);

    expect.soft(app.notice()).toBe("the server answered 500");
    expect.soft(app.reader()).toBeNull();
  });

  it("says reading-now.md links no book note when its link names only a heading", async () => {
    reading = "[[#Chapter three]]";
    const app = await opened();

    await press(app);

    expect.soft(app.notice()).toBe(`${READING} links no book note`);
  });

  it("names the link when it names a file that is not a note", async () => {
    fetchFiles.mockResolvedValue([...Object.keys(NOTES), READING, "Plan.pdf"]);
    reading = "[[Plan.pdf]]";
    const app = await opened();

    await press(app);

    expect.soft(app.notice()).toBe("[[Plan.pdf]] in reading-now.md names no note");
  });

  it("A6 says nothing is beside the note before the pane is swapped", async () => {
    reading = "[[Bare]]";
    const app = await opened();

    await press(app);

    expect.soft(app.notice()).toBe(`Nothing to read beside ${BARE}`);
    // No reader drawing its own "nothing to read beside" panel either.
    expect.soft(app.readerPane()).toBeNull();
    expect.soft(fetchBook).not.toHaveBeenCalled();
    expect.soft(app.text()).toBe("the index note");
  });

  it("A6 waits for the listings before it refuses, on a press right after load", async () => {
    // Both held, so the press lands before the route knows a note or a book.
    let files: (paths: string[]) => void = () => {};
    let assets: (paths: string[]) => void = () => {};
    fetchFiles.mockReturnValue(
      new Promise<string[]>((resolve) => {
        files = resolve;
      }),
    );
    fetchAssets.mockReturnValue(
      new Promise<string[]>((resolve) => {
        assets = resolve;
      }),
    );
    const app = await renderApp();
    await settle();

    await press(app);
    act(() => {
      files([...Object.keys(NOTES), READING]);
      assets([BOOK.replace(/\.md$/, ".epub")]);
    });
    await hashed();
    await settle();

    expect.soft(app.notice()).toBeNull();
    expect.soft(app.reader()).not.toBeNull();
    expect.soft(fetchBook).toHaveBeenCalledWith(BOOK);
  });

  it("A9 opens from the palette's Read the current book row with vim off", async () => {
    localStorage.setItem("kasten.vim", "off");
    try {
      const app = await opened();
      app.press("P", { keyCode: 80, ctrlKey: true, shiftKey: true });
      await settle();
      const row = screen.queryByRole("option", { name: /^Read the current book/ });
      expect.soft(row).not.toBeNull();
      if (row) fireEvent.click(row);
      await hashed();
      await settle();

      expect.soft(app.reader()).not.toBeNull();
      expect.soft(fetchBook).toHaveBeenCalledWith(BOOK);
    } finally {
      localStorage.removeItem("kasten.vim");
    }
  });

  it("A11 a bare name finds the note in any folder, whatever its case", async () => {
    reading = "[[the expectant father]]";
    const app = await opened();

    await press(app);

    expect.soft(fetchBook).toHaveBeenCalledWith(BOOK);
    expect.soft(app.notice()).toBeNull();
  });

  it("A11 a path is taken as written, not looked up by its last name", async () => {
    reading = "[[Elsewhere/The Expectant Father]]";
    const app = await opened();

    await press(app);

    expect
      .soft(app.notice())
      .toBe("[[Elsewhere/The Expectant Father]] in reading-now.md names no note");
    expect.soft(fetchBook).not.toHaveBeenCalled();
  });

  it("A11 drops the alias and the heading", async () => {
    reading = "[[The Expectant Father#Part two|the book]]";
    const app = await opened();

    await press(app);

    expect.soft(fetchBook).toHaveBeenCalledWith(BOOK);
    expect.soft(app.notice()).toBeNull();
  });

  it("I1 opens with no note open", async () => {
    const app = await renderApp();
    await settle();

    await press(app);

    expect.soft(app.reader()).not.toBeNull();
    expect.soft(fetchBook).toHaveBeenCalledWith(BOOK);
  });

  it("I1 opens from the todo pane, which holds no note", async () => {
    const app = await opened();
    app.leader("g", "t");
    await settle();
    const pane = app.todoPane() as HTMLElement;
    expect.soft(pane).not.toBeNull();

    for (const key of [" ", "g", "c"]) fireEvent.keyDown(pane, { key });
    await hashed();
    await settle();

    expect.soft(app.reader()).not.toBeNull();
    expect.soft(fetchBook).toHaveBeenCalledWith(BOOK);
  });

  it("I2 the next press clears a refusal, and the book it opens leaves no notice", async () => {
    reading = null;
    const app = await opened();
    await press(app);
    expect.soft(app.notice()).toBe(`${READING} is not there`);

    reading = "[[The Expectant Father]]";
    await press(app);

    expect.soft(app.notice()).toBeNull();
    expect.soft(app.reader()).not.toBeNull();
  });

  it("I3 reads reading-now.md afresh on each press", async () => {
    reading = "[[Nowhere]]";
    const app = await opened();
    await press(app);
    expect.soft(app.notice()).toBe("[[Nowhere]] in reading-now.md names no note");

    reading = "[[Bare]]";
    await press(app);

    expect.soft(app.notice()).toBe(`Nothing to read beside ${BARE}`);
  });

  it("I3 saves an edit to reading-now.md open in the focused pane before it reads it", async () => {
    // What the vault holds is what was last saved, so the press reads the new
    // link only if the edit was written first.
    saveNote.mockImplementation(async (path: string, content: string) => {
      if (path === READING) reading = content;
      return { path, content };
    });
    fetchBook.mockImplementation(async (note: string) => beside(note, ".pdf"));
    const app = await renderApp();
    await settle();
    app.expand("99 Misc");
    await settle();
    app.expand("01 Config");
    await settle();
    app.click(READING);
    await settle();
    // The brackets drawn away by the live preview, so the name alone.
    expect(app.text()).toBe("The Expectant Father");

    // Written into the buffer the way a keystroke is, and pressed at once,
    // inside the autosave's quiet period.
    const view = EditorView.findFromDOM(document.querySelector(".cm-content") as HTMLElement);
    act(() =>
      view?.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "[[Paper]]" } }),
    );
    await press(app);

    expect.soft(fetchBook).toHaveBeenCalledWith(PAPER);
    expect.soft(fetchBook).not.toHaveBeenCalledWith(BOOK);
  });

  it("I4 writes the unsaved text of the focused note before the book replaces it", async () => {
    const app = await opened();
    app.press("x");
    expect(app.text()).toBe("he index note");

    await press(app);

    expect
      .soft(saveNote)
      .toHaveBeenCalledWith("index.md", "he index note", false, await baseOf("the index note"));
    expect.soft(app.reader()).not.toBeNull();
  });

  it("I4 keeps the note in place when the write before the book fails", async () => {
    const app = await opened();
    app.press("x");
    saveNote.mockRejectedValueOnce(new Error("PUT failed with 500"));

    await press(app);

    // Asked for, so a key that wrote nothing cannot pass for one that kept it.
    expect
      .soft(saveNote)
      .toHaveBeenCalledWith("index.md", "he index note", false, await baseOf("the index note"));
    expect.soft(app.reader()).toBeNull();
    expect.soft(document.querySelector(".cm-content")?.textContent).toBe("he index note");
  });

  it("I5 opens a pdf beside the note", async () => {
    reading = "[[Paper]]";
    fetchBook.mockImplementation(async (note: string) => beside(note, ".pdf"));
    const app = await opened();

    await press(app);

    expect.soft(fetchBook).toHaveBeenCalledWith(PAPER);
    expect.soft(app.notice()).toBeNull();
    expect.soft(document.querySelector(".cm-content")).toBeNull();
  });

  it("I6 takes the first of several links", async () => {
    reading = "Now [[The Expectant Father]], then [[Paper]]";
    const app = await opened();

    await press(app);

    expect.soft(fetchBook).toHaveBeenCalledWith(BOOK);
    expect.soft(fetchBook).not.toHaveBeenCalledWith(PAPER);
  });

  it("I8 changes nothing when the focused pane already reads that book", async () => {
    const app = await opened();
    await press(app);
    const built = FakeView.made.length;
    expect.soft(built).toBe(1);

    // From the reader, which has no leader, so through its palette chord.
    // Looked up, so a reader that never opened leaves the assertions below to
    // say so.
    const pane = app.readerPane();
    if (pane) fireEvent.keyDown(pane, { key: "P", ctrlKey: true, shiftKey: true });
    await settle();
    const row = screen.queryByRole("option", { name: /^Read the current book/ });
    if (row) fireEvent.click(row);
    await hashed();
    await settle();

    // The second press ran, or nothing changing would prove nothing.
    expect.soft(fetchNote.mock.calls.filter(([path]) => path === READING)).toHaveLength(2);
    expect.soft(app.panes()).toBe(1);
    expect.soft(document.querySelectorAll("foliate-view")).toHaveLength(1);
    expect.soft(FakeView.made).toHaveLength(built);
    expect.soft(app.notice()).toBeNull();
  });
});
