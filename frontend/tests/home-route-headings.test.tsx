import { EditorView } from "@codemirror/view";
import { cleanup } from "@testing-library/react";
import { useMemo } from "react";
import type { TodoHit } from "@/lib/api";
import { noteBase } from "@/lib/note-base";
import type { PdfRenderer } from "@/lib/pdf-view";
import type { TodoState } from "@/lib/todo";
import { hashed } from "./digests";
import { defineFoliateFake } from "./foliate-fake";
import { FakeEventSource, pageHooks, renderApp, settle } from "./home-route-fixture";
import { finishParsing } from "./parsing";

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

describe("following a link with an alias or a heading", () => {
  const NOTE = "index.md";
  const OTHER = "reading/borges.md";
  /** Frontmatter first, so the heading's line counts the block above the body. */
  /** Line 6 links back to its own heading by name, for following it twice. */
  const BORGES = "---\nid: 01\n---\n# Borges\n\n[[borges#Life]]\n\n## Life\n\nborn 1899\n";
  const LIFE = 8;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue([NOTE, OTHER]);
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    createNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
    fetchImages.mockResolvedValue([]);
    fetchHtml.mockResolvedValue([]);
    fetchAssets.mockResolvedValue([]);
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

  /** Open the note holding `link` on its first line, the cursor on it, and press `gf`. */
  async function follow(link: string, below = "") {
    fetchNote.mockImplementation(async (path: string) =>
      path === NOTE ? `[[${link}]]\n${below}` : BORGES,
    );
    const app = await renderApp();
    await settle();
    app.click(NOTE);
    await settle();
    finishParsing(document.body);
    app.press("g");
    app.press("f");
    await settle();
    return app;
  }

  /** The text in the editor and the line its cursor sits on. */
  function opened() {
    const view = EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement);
    if (!view) throw new Error("No editor is mounted");
    const { state } = view;
    return { text: state.doc.toString(), line: state.doc.lineAt(state.selection.main.head).number };
  }

  it("opens the note an alias is written on", async () => {
    await follow("borges|Jorge");

    expect(createNote).not.toHaveBeenCalled();
    expect(opened().text).toBe(BORGES);
  });

  it("opens the note at the heading", async () => {
    await follow("borges#Life");

    expect(createNote).not.toHaveBeenCalled();
    expect(opened()).toEqual({ text: BORGES, line: LIFE });
  });

  it("opens the note at the heading behind an alias", async () => {
    await follow("borges#life|his life");

    expect(opened()).toEqual({ text: BORGES, line: LIFE });
  });

  it("opens the note as a plain link does for a heading it does not hold", async () => {
    await follow("borges#Death");

    // Where the body starts, under the frontmatter, which is where any note opens.
    expect(createNote).not.toHaveBeenCalled();
    expect(opened()).toEqual({ text: BORGES, line: 4 });
  });

  it("jumps to a heading of the note it is written in, making no note", async () => {
    await follow("#Below", "\ntext\n\n## Below\n");

    expect(createNote).not.toHaveBeenCalled();
    expect(opened()).toEqual({ text: "[[#Below]]\n\ntext\n\n## Below\n", line: 5 });
  });

  it("jumps again on a second gf to the heading of the note already open", async () => {
    const app = await follow("borges#Life");
    expect(opened().line).toBe(LIFE);

    // Back to the link, and the same jump once more: the pane already holds
    // this note at this line, so only a fresh open says to move.
    app.press("6");
    app.press("G");
    expect(opened().line).toBe(6);
    app.press("g");
    app.press("f");
    await settle();

    expect(opened().line).toBe(LIFE);
  });

  it("jumps again on a second gf to a heading of its own note", async () => {
    const app = await follow("#Below", "\ntext\n\n## Below\n");
    expect(opened().line).toBe(5);

    app.press("g");
    app.press("g");
    app.press("g");
    app.press("f");
    await settle();

    expect(opened().line).toBe(5);
  });

  it("jumps to a heading of its own note by the text on screen, saved or not", async () => {
    fetchNote.mockResolvedValue("[[#Below]]\n\ntext\n\n## Below\n");
    const app = await renderApp();
    await settle();
    app.click(NOTE);
    await settle();

    // A copy of the link pasted under it, which no save has reached yet: the
    // heading is a line further down than the vault has it.
    for (const key of ["y", "y", "p"]) app.press(key);
    finishParsing(document.body);
    app.press("g");
    app.press("f");
    await settle();

    expect(opened().line).toBe(6);
  });

  it("drops the jump when another note was opened while the heading was read", async () => {
    let answer: (text: string) => void = () => {};
    fetchFiles.mockResolvedValue([NOTE, OTHER, "kafka.md"]);
    fetchNote.mockImplementation(async (path: string) => {
      if (path === NOTE) return "[[borges#Life]]\n";
      if (path === "kafka.md") return "the trial\n";
      return new Promise<string>((resolve) => {
        answer = resolve;
      });
    });
    const app = await renderApp();
    await settle();
    app.click(NOTE);
    await settle();
    finishParsing(document.body);
    app.press("g");
    app.press("f");
    await settle();

    app.click("kafka.md");
    await settle();
    answer(BORGES);
    await settle();

    expect(opened().text).toBe("the trial\n");
  });

  it("makes a missing note under its name, not its alias", async () => {
    await follow("cortazar|Julio");

    expect(createNote.mock.calls).toEqual([["00 Inbox/cortazar.md", ""]]);
  });

  it("makes a missing note under its name, not its heading", async () => {
    await follow("rayuela#One");

    expect(createNote.mock.calls).toEqual([["00 Inbox/rayuela.md", ""]]);
  });
});
