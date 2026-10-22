import { cleanup, fireEvent, screen } from "@testing-library/react";
import { useMemo } from "react";
import type { TodoHit } from "@/lib/api";
import { noteBase } from "@/lib/note-base";
import type { PdfRenderer } from "@/lib/pdf-view";
import type { TodoState } from "@/lib/todo";
import { hashed } from "./digests";
import { defineFoliateFake } from "./foliate-fake";
import { FakeEventSource, pageHooks, renderApp, settle, VAULT } from "./home-route-fixture";
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

describe("a pdf as a row of the tree", () => {
  const PLAN = "x/my plan.pdf";
  const FILED = "98 Archive/old.pdf";

  /** A pdf of one page that draws nothing, the pane's look being no concern here. */
  const renderer: PdfRenderer = {
    open: () => ({
      file: Promise.resolve({
        pages: 1,
        page: async () => ({ width: 600, height: 800, draw: async () => {} }),
      }),
      destroy: () => {},
    }),
  };

  class Quiet {
    observe() {}
    disconnect() {}
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    vi.stubGlobal("IntersectionObserver", Quiet);
    vi.stubGlobal("ResizeObserver", Quiet);
    pdfPaneRenderer.current = renderer;
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue(Object.keys(VAULT));
    fetchNote.mockImplementation(async (path: string) => VAULT[path]);
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
    fetchImages.mockResolvedValue([]);
    fetchHtml.mockResolvedValue([]);
    // A book beside them, which the vault lists here too and the tree must not.
    fetchAssets.mockResolvedValue([PLAN, FILED, "lit/DDIA.epub"]);
  });

  afterEach(async () => {
    cleanup();
    await hashed();
    pdfPaneRenderer.current = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  const pdfPane = () => document.querySelector<HTMLElement>("[data-pdf-pane]");
  const row = (path: string) => document.querySelector(`[aria-label='Vault'] [title='${path}']`);

  /** Open a note, then the pdf from its row, the way a reader does. */
  async function openPlan() {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    app.expand("x");
    app.click(PLAN);
    await settle();
    return app;
  }

  it("A3 marks the open pdf's row as the current one", async () => {
    await openPlan();

    expect(row(PLAN)).toHaveAttribute("aria-current", "page");
    expect(row("index.md")).not.toHaveAttribute("aria-current");
  });

  it("I1 a click on the row opens the pdf over the note, at page 1", async () => {
    const app = await openPlan();

    expect(pdfPane()?.getAttribute("data-pdf-pane")).toBe(PLAN);
    expect(pdfPane()?.hasAttribute("data-page")).toBe(false);
    expect(app.panes()).toBe(1);
    expect(document.querySelector(".cm-content")).toBeNull();
    // Only the pdfs of the listing are rows, a book being a reader's business.
    expect(row("lit/DDIA.epub")).toBeNull();
  });

  it("I2 keeps an archived pdf out of the tree until the archive is asked for", async () => {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();

    expect(app.tree().textContent).not.toContain("98 Archive");

    app.leader("a");
    await settle();
    app.expand("98 Archive");

    expect(row(FILED)).not.toBeNull();
  });

  it("I6 on a phone the drawer marks the open pdf, and its tab is named after it", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const app = await renderApp();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "File tree" }));
    app.click("index.md");
    await settle();
    // A second tab, so the strip shows and has the pdf's tab to name. Through
    // the palette, a phone keeping vim and so the leader off.
    fireEvent.click(screen.getByRole("button", { name: "Run a command by name" }));
    fireEvent.click(screen.getByRole("option", { name: /^Create a tab/ }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "File tree" }));
    app.expand("x");
    app.click(PLAN);
    await settle();

    expect(pdfPane()?.getAttribute("data-pdf-pane")).toBe(PLAN);
    expect(screen.getByRole("tab", { name: "my plan" })).toBeInTheDocument();

    // A tap on a row shuts the drawer; opened again it marks the pdf.
    fireEvent.click(screen.getByRole("button", { name: "File tree" }));
    expect(row(PLAN)).toHaveAttribute("aria-current", "page");
  });
});
