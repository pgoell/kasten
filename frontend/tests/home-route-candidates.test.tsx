import { cleanup, screen } from "@testing-library/react";
import { useMemo } from "react";
import { buildTree } from "@/components/file-explorer";
import type { TodoHit } from "@/lib/api";
import { folderCandidates, noteCandidates } from "@/lib/fuzzy";
import { noteBase } from "@/lib/note-base";
import type { PdfRenderer } from "@/lib/pdf-view";
import type { TodoState } from "@/lib/todo";
import { hashed } from "./digests";
import { defineFoliateFake, resetFoliateFake } from "./foliate-fake";
import {
  act,
  FakeEventSource,
  pageHooks,
  renderApp,
  settle,
  stream,
  VAULT,
} from "./home-route-fixture";

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

describe("the finders keep their candidates", () => {
  // A book beside its note, one more filed away in the archive, and a note that
  // arrives later, read before it is listed so a highlight on it reads text.
  const BOOK = "Books/DDIA.md";
  const ARCHIVED = "98 Archive/Old Book.md";
  const ARRIVED = "arrived.md";
  const NOTES: Record<string, string> = {
    ...VAULT,
    [BOOK]: "# DDIA",
    [ARCHIVED]: "# Old Book",
    [ARRIVED]: "# Arrived",
  };
  const built = vi.mocked(noteCandidates);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue([...Object.keys(VAULT), BOOK, ARCHIVED]);
    fetchNote.mockImplementation(async (path: string) => NOTES[path]);
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
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

  /**
   * The index note open with a key pressed in it, so its buffer holds text the
   * vault does not, then `keys` after the leader with the archive on or off.
   */
  async function finderOpen(keys: string[], archive: boolean) {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    app.press("x");
    if (archive) {
      app.leader("a");
      await settle();
    }
    app.leader(...keys);
    await settle();
    return app;
  }

  /**
   * An outside write to the focused note. Its buffer is dirty, so the route
   * declines the reload and counts it in state of its own: `Home` renders
   * again, and the listing, which already names the note, keeps its identity.
   */
  async function declinedWrite() {
    act(() => stream().send({ path: "index.md", change: "written", digest: "a".repeat(64) }));
    await settle();
  }

  it("A1 the note finder builds its candidates once while the route renders again, archive off", async () => {
    await finderOpen(["f", "f"], false);
    // The note finder's rows are whole paths, and the book finder's names.
    expect.soft(screen.queryByRole("option", { name: "other.md" })).not.toBeNull();
    expect.soft(screen.queryByRole("option", { name: ARCHIVED })).toBeNull();
    built.mockClear();

    await declinedWrite();

    expect(built).toHaveBeenCalledTimes(0);
  });

  it("A2 the note finder builds its candidates once while the route renders again, archive on", async () => {
    await finderOpen(["f", "f"], true);
    expect.soft(screen.queryByRole("option", { name: ARCHIVED })).not.toBeNull();
    built.mockClear();

    await declinedWrite();

    expect(built).toHaveBeenCalledTimes(0);
  });

  it("A3 the book finder builds its candidates once while the route renders again, archive off", async () => {
    await finderOpen(["f", "b"], false);
    expect.soft(screen.queryByRole("option", { name: /^DDIA/ })).not.toBeNull();
    expect.soft(screen.queryByRole("option", { name: /^Old Book/ })).toBeNull();
    built.mockClear();

    await declinedWrite();

    expect(built).toHaveBeenCalledTimes(0);
  });

  it("A4 the book finder builds its candidates once while the route renders again, archive on", async () => {
    await finderOpen(["f", "b"], true);
    expect.soft(screen.queryByRole("option", { name: /^Old Book/ })).not.toBeNull();
    built.mockClear();

    await declinedWrite();

    expect(built).toHaveBeenCalledTimes(0);
  });

  it("I1 a note that arrives while the note finder is open shows as a row", async () => {
    await finderOpen(["f", "f"], false);
    expect.soft(screen.queryByRole("option", { name: "other.md" })).not.toBeNull();
    expect.soft(screen.queryByRole("option", { name: ARRIVED })).toBeNull();

    fetchFiles.mockResolvedValue([...Object.keys(VAULT), BOOK, ARCHIVED, ARRIVED]);
    act(() => stream().send({ path: ARRIVED, change: "written", digest: "b".repeat(64) }));
    await settle();

    expect(screen.queryByRole("option", { name: ARRIVED })).not.toBeNull();
  });
});

describe("the tree keeps its rows", () => {
  // One of each kind of row at the top, where the tree draws it unfolded, and
  // one of each filed away in the archive.
  const IMAGE = "shot.png";
  const PAGE = "page.html";
  const PDF = "plan.pdf";
  const FILED_PDF = "98 Archive/old.pdf";
  const FILED = ["98 Archive/old.png", "98 Archive/old.html", FILED_PDF];
  const built = vi.mocked(buildTree);
  const candidates = vi.mocked(noteCandidates);
  const folders = vi.mocked(folderCandidates);
  /** What a query that has not answered yet gets back, and keeps. */
  const pending = () => new Promise<never>(() => {});

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
    fetchImages.mockResolvedValue([IMAGE, FILED[0]]);
    fetchHtml.mockResolvedValue([PAGE, FILED[1]]);
    fetchAssets.mockResolvedValue([PDF, FILED_PDF]);
  });

  afterEach(async () => {
    cleanup();
    await hashed();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  const row = (path: string) => document.querySelector(`[aria-label='Vault'] [title='${path}']`);

  /** The index note open with a key pressed in it, so its buffer is dirty. */
  async function dirtyNote(archive: boolean) {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    app.press("x");
    if (archive) {
      app.leader("a");
      await settle();
      app.expand("98 Archive");
    }
    return app;
  }

  /**
   * An outside write to the focused note, which the route declines over the
   * dirty buffer: `Home` renders again with every listing as it was.
   */
  async function declinedWrite() {
    act(() => stream().send({ path: "index.md", change: "written", digest: "a".repeat(64) }));
    await settle();
  }

  /** The archived rows show with the archive on and stay out with it off. */
  function archived(archive: boolean, paths: string[]) {
    for (const path of paths) {
      if (archive) expect.soft(row(path)).not.toBeNull();
      else expect.soft(row(path)).toBeNull();
    }
  }

  /** Every row on screen, then no build over a render that changed no listing. */
  async function buildsOnce(archive: boolean) {
    await dirtyNote(archive);
    expect.soft(row(IMAGE)).not.toBeNull();
    expect.soft(row(PAGE)).not.toBeNull();
    expect.soft(row(PDF)).not.toBeNull();
    archived(archive, FILED);
    built.mockClear();

    await declinedWrite();

    expect(built).toHaveBeenCalledTimes(0);
  }

  /** The same while the images and pages have no answer yet. */
  async function buildsOnceLoading(archive: boolean) {
    fetchImages.mockReturnValue(pending());
    fetchHtml.mockReturnValue(pending());
    await dirtyNote(archive);
    // No image or page row yet, there being no answer to draw them from.
    expect.soft(row(IMAGE)).toBeNull();
    expect.soft(row(PAGE)).toBeNull();
    expect.soft(row(PDF)).not.toBeNull();
    archived(archive, [FILED_PDF]);
    built.mockClear();

    await declinedWrite();

    expect(built).toHaveBeenCalledTimes(0);
  }

  it("A1 the tree builds once while the route renders again, archive off", () => buildsOnce(false));

  it("A2 the tree builds once while the route renders again, archive on", () => buildsOnce(true));

  it("A3 the tree builds once while the images and pages load, archive off", () =>
    buildsOnceLoading(false));

  it("A3 the tree builds once while the images and pages load, archive on", () =>
    buildsOnceLoading(true));

  it("I1 an image that arrives while the tree shows is a row", async () => {
    await dirtyNote(false);
    expect.soft(row("new.png")).toBeNull();

    fetchImages.mockResolvedValue([IMAGE, FILED[0], "new.png"]);
    act(() => stream().send({ path: "", change: "listing", digest: null }));
    await settle();

    expect(row("new.png")).not.toBeNull();
  });

  it("I2 the terminal prompt builds its candidates once while the sessions load", async () => {
    fetchTerminals.mockReturnValue(pending());
    const app = await dirtyNote(false);
    app.leader("c", "s");
    await settle();
    expect.soft(screen.queryByRole("dialog", { name: "Open terminal" })).not.toBeNull();
    candidates.mockClear();

    await declinedWrite();

    expect(candidates).toHaveBeenCalledTimes(0);
  });

  it("I2 the note prompt builds its folders once while the listing loads", async () => {
    // Opened from the note in the URL, the tree having no row to click while
    // the listing loads. The prompt saves the note before it opens, so the
    // buffer is clean and a write to it would be taken, not declined: a new
    // tag vocabulary renders `Home` instead, every listing left as it was.
    fetchFiles.mockReturnValue(pending());
    const app = await renderApp("/?note=index.md");
    await settle();
    app.leader("c", "f");
    await settle();
    expect.soft(screen.queryByRole("dialog", { name: "New note" })).not.toBeNull();
    folders.mockClear();

    fetchTags.mockResolvedValue(["fresh"]);
    act(() => stream().send({ path: "index.md", change: "written", digest: "a".repeat(64) }));
    await settle();

    expect(folders).toHaveBeenCalledTimes(0);
  });
});
