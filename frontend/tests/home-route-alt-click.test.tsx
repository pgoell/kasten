import { cleanup, fireEvent } from "@testing-library/react";
import { useMemo } from "react";
import type { TodoHit } from "@/lib/core/api";
import { noteBase } from "@/lib/notes/note-base";
import type { PdfRenderer } from "@/lib/panes/book/pdf-view";
import type { TodoState } from "@/lib/todo/todo";
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
vi.mock("@/lib/core/api", () => ({
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
vi.mock("@/lib/vault/move/move-api", () => ({ renameNote, moveFolder }));
vi.mock("@/lib/vault/move/trash-api", () => ({
  deleteNote,
  fetchTrash,
  restoreEntry,
  deleteImage,
}));
vi.mock("@/lib/history/history-api", () => ({ fetchHistory, fetchHistoryText }));
vi.mock("foliate-js/view.js", () => ({}));
const pdfPaneRenderer = vi.hoisted(() => ({ current: null as PdfRenderer | null }));
vi.mock("@/lib/panes/book/pdf-view", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/panes/book/pdf-view")>();
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
vi.mock("@/components/todo/todo-pane", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/todo/todo-pane")>();
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
vi.mock("@/lib/capture/outbox", () => outbox);
vi.mock("@/lib/search/fuzzy", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/search/fuzzy")>();
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

// Alt+click opens a link in a split beside the pane it is in, Alt+Shift+click in a new tab.
describe("alt+click on a link", () => {
  const PLAN = "rehearse/my plan.pdf";
  const NOTES: Record<string, string> = {
    "index.md": "pane one\n[[target]]\n[[my plan.pdf]]\n[[gone.pdf]]\n[[song.mp3]]\n",
    "target.md": "target body\n",
  };

  const renderer: PdfRenderer = {
    open: () => ({
      file: Promise.resolve({
        pages: 3,
        page: async () => ({ width: 600, height: 800, draw: async () => {} }),
      }),
      destroy: () => {},
    }),
  };

  class Unseen {
    observe() {}
    disconnect() {}
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    vi.stubGlobal("open", vi.fn());
    vi.stubGlobal("IntersectionObserver", Unseen);
    vi.stubGlobal("ResizeObserver", Unseen);
    pdfPaneRenderer.current = renderer;
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue(["index.md", "target.md"]);
    fetchNote.mockImplementation(async (path: string) => NOTES[path]);
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
    fetchImages.mockResolvedValue([]);
    fetchHtml.mockResolvedValue([]);
    fetchAssets.mockResolvedValue([PLAN, "song.mp3"]);
  });

  afterEach(async () => {
    cleanup();
    await hashed();
    pdfPaneRenderer.current = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  const drawn = () =>
    [...document.querySelectorAll<HTMLElement>("[data-pane]")].filter(
      (pane) => !pane.classList.contains("hidden"),
    );

  const paneText = (index: number) => drawn()[index]?.querySelector(".cm-content")?.textContent;

  async function opened() {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    finishParsing(drawn()[0] as HTMLElement);
    return app;
  }

  const links = () => [...(drawn()[0]?.querySelectorAll<HTMLElement>(".cm-wikilink") ?? [])];

  it("alt+click opens the note in a split beside, and moves there", async () => {
    const app = await opened();

    fireEvent.mouseDown(links()[0] as HTMLElement, { altKey: true });
    await settle();

    expect(app.tabs()).toBe(1);
    expect(drawn()).toHaveLength(2);
    expect(paneText(0)).toContain("pane one");
    expect(paneText(1)).toContain("target body");
    expect(app.focusedPane()).toBe(1);
  });

  it("alt+shift+click opens the note in a new tab, and goes to it", async () => {
    const app = await opened();

    fireEvent.mouseDown(links()[0] as HTMLElement, { altKey: true, shiftKey: true });
    await settle();

    expect(app.tabs()).toBe(2);
    expect(drawn()).toHaveLength(1);
    expect(paneText(0)).toContain("target body");
  });

  it("alt+click on a pdf link puts the pdf in the one split it makes", async () => {
    await opened();

    fireEvent.mouseDown(links()[1] as HTMLElement, { altKey: true });
    await settle();

    expect(drawn()).toHaveLength(2);
    expect(paneText(0)).toContain("pane one");
    expect(drawn()[1]?.querySelector("[data-pdf-pane]")?.getAttribute("data-pdf-pane")).toBe(PLAN);
  });

  // The pane is made only for a follow that fills it.
  it("alt+click on a link to a missing pdf makes no pane", async () => {
    const app = await opened();

    fireEvent.mouseDown(links()[2] as HTMLElement, { altKey: true });
    await settle();

    expect(app.tabs()).toBe(1);
    expect(drawn()).toHaveLength(1);
    expect(paneText(0)).toContain("pane one");
  });

  it("alt+shift+click on a file no pane shows opens it in the browser and makes no tab", async () => {
    const app = await opened();

    fireEvent.mouseDown(links()[3] as HTMLElement, { altKey: true, shiftKey: true });
    await settle();

    expect(app.tabs()).toBe(1);
    expect(drawn()).toHaveLength(1);
    expect(window.open).toHaveBeenCalledWith("/api/assets/song.mp3", "_blank");
  });

  it("a plain click opens nothing", async () => {
    const app = await opened();

    fireEvent.mouseDown(links()[0] as HTMLElement);
    await settle();

    expect(app.tabs()).toBe(1);
    expect(drawn()).toHaveLength(1);
    expect(paneText(0)).toContain("pane one");
  });
});
