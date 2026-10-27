import { EditorView } from "@codemirror/view";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { useMemo } from "react";
import type { TodoHit } from "@/lib/api";
import type { PdfRenderer } from "@/lib/book/pdf-view";
import { lineCandidates } from "@/lib/fuzzy";
import { noteBase } from "@/lib/note-base";
import type { TodoState } from "@/lib/todo/todo";
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

describe("the palette keeps its rows", () => {
  const PAGE = "page.html";
  const OTHER_PAGE = "other.html";
  const ranked = vi.mocked(lineCandidates);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue(Object.keys(VAULT));
    fetchNote.mockImplementation(async (path: string) => VAULT[path]);
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
    fetchTags.mockResolvedValue([]);
    fetchImages.mockResolvedValue([]);
    fetchHtml.mockResolvedValue([PAGE, OTHER_PAGE]);
    fetchAssets.mockResolvedValue([]);
  });

  afterEach(async () => {
    cleanup();
    localStorage.removeItem("kasten.palette");
    delete document.documentElement.dataset.palette;
    await hashed();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  const option = (name: string | RegExp) => screen.queryByRole("option", { name });
  const editorText = () =>
    EditorView.findFromDOM(
      document.querySelector(".cm-editor") as HTMLElement,
    )?.state.doc.toString();

  /**
   * An outside write that brings a new tag. The tags are a query of `Home`'s
   * own, so the route renders again whatever the buffer holds, and with vim off
   * a pressed key dirties nothing for a declined write to stand on. No listing
   * and no command changes.
   */
  async function rerender() {
    fetchTags.mockResolvedValue(["fresh"]);
    act(() => stream().send({ path: "index.md", change: "written", digest: "a".repeat(64) }));
    await settle();
  }

  /** The index note open in the one pane. */
  async function noteOpen() {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    return app;
  }

  /**
   * A routed row and an insert on screen across a render, then no ranking over
   * it. The insert says the palette sits over the note's editor.
   */
  async function ranksOnce() {
    expect.soft(option("Toggle vim keys")).not.toBeNull();
    expect.soft(option("Heading 1")).not.toBeNull();
    ranked.mockClear();

    await rerender();

    expect.soft(option("Toggle vim keys")).not.toBeNull();
    expect.soft(option("Heading 1")).not.toBeNull();
    expect(ranked).toHaveBeenCalledTimes(0);
  }

  // First in the file, so it pays the cold mount, and with timers faked none of
  // it is waiting: all of it is work. 0.8 s idle, 2.0 s alone at load 47 on 16
  // cores, over 5 s inside the full suite at load 34 (#1206).
  it("#592 A1 A5 the palette opened over a note with vim on builds its candidates once while the route renders again", async () => {
    const app = await noteOpen();
    app.leader(":");
    await settle();

    await ranksOnce();
  }, 15_000);

  it("#592 A2 A5 the palette opened by its chord with vim off builds its candidates once while the route renders again", async () => {
    localStorage.setItem("kasten.vim", "off");
    try {
      const app = await noteOpen();
      app.press("P", { keyCode: 80, ctrlKey: true, shiftKey: true });
      await settle();

      await ranksOnce();
    } finally {
      localStorage.removeItem("kasten.vim");
    }
  });

  it("#592 A3 A5 the palette opened from the toolbar on a phone builds its candidates once while the route renders again", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    // From the URL, the tree being a drawer that is shut.
    await renderApp("/?note=index.md");
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Run a command by name" }));
    await settle();

    await ranksOnce();
  });

  it("#592 I1 a palette row taken after the route rendered again runs its command", async () => {
    const app = await noteOpen();
    app.leader(":");
    await settle();
    await rerender();

    // Named with its key after it.
    const row = option(/^Show the keys/);
    expect.soft(row).not.toBeNull();
    if (row) fireEvent.click(row);
    await settle();

    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).not.toBeNull();
  });

  it("#592 I3 an insert row taken after the route rendered again writes into the note it was opened over", async () => {
    const app = await noteOpen();
    app.leader(":");
    await settle();
    await rerender();

    const row = option("Wikilink");
    expect.soft(row).not.toBeNull();
    if (row) fireEvent.click(row);
    await settle();

    expect(editorText()).toContain("[[]]");
  });

  /** The page's frame, by the path it shows. */
  const frame = (path: string) =>
    document.querySelector(`[data-html-pane] iframe[title='${path}']`) as HTMLIFrameElement;

  /**
   * A click into `path`'s frame, as the window sees one: the frame the active
   * element when the window loses the focus. Faked rather than focused, so no
   * focus event reaches an ancestor that could move the pane on its own.
   */
  function clickInto(path: string) {
    const active = vi.spyOn(document, "activeElement", "get").mockReturnValue(frame(path));
    fireEvent.blur(window);
    active.mockRestore();
  }

  it("#592 A4 an open html pane adds its window blur listener once while the route renders again", async () => {
    const app = await renderApp();
    await settle();
    app.click(PAGE);
    await settle();
    expect.soft(frame(PAGE)).not.toBeNull();
    const added = vi.spyOn(window, "addEventListener");
    added.mockClear();

    await rerender();

    expect.soft(frame(PAGE)).not.toBeNull();
    expect(added.mock.calls.filter(([type]) => type === "blur")).toHaveLength(0);
  });

  it("#592 I2 a click into either of two html panes' frames after the route rendered again focuses that pane", async () => {
    // The index note splits, the new pane takes one page and the first pane
    // the other, leaving the focus on the first.
    const app = await noteOpen();
    app.leader("%");
    await settle();
    app.click(PAGE);
    await settle();
    app.focusPane(0);
    await settle();
    app.click(OTHER_PAGE);
    await settle();
    await rerender();
    expect.soft(frame(PAGE)).not.toBeNull();
    expect.soft(frame(OTHER_PAGE)).not.toBeNull();
    expect.soft(app.focusedPane()).toBe(0);

    clickInto(PAGE);
    await settle();
    expect.soft(app.focusedPane()).toBe(1);

    clickInto(OTHER_PAGE);
    await settle();
    expect(app.focusedPane()).toBe(0);
  });

  it("the accent rows are listed and run with vim on", async () => {
    const app = await noteOpen();
    app.leader(":");
    await settle();

    const row = option("Accent palette: Hay's russet");
    expect.soft(row).not.toBeNull();
    if (row) fireEvent.click(row);
    await settle();

    expect(document.documentElement.dataset.palette).toBe("russet");
  });

  it("the accent rows are listed and run with vim off", async () => {
    localStorage.setItem("kasten.vim", "off");
    try {
      const app = await noteOpen();
      app.press("P", { keyCode: 80, ctrlKey: true, shiftKey: true });
      await settle();

      const row = option("Accent palette: Hay's russet");
      expect.soft(row).not.toBeNull();
      if (row) fireEvent.click(row);
      await settle();

      expect(document.documentElement.dataset.palette).toBe("russet");
    } finally {
      localStorage.removeItem("kasten.vim");
    }
  });
});
