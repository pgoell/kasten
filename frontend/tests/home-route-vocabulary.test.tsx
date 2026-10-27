import { CompletionContext } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { cleanup } from "@testing-library/react";
import { useMemo } from "react";
import type { TodoHit } from "@/lib/api";
import type { PdfRenderer } from "@/lib/book/pdf-view";
import { noteBase } from "@/lib/note-base";
import { ONTOLOGY_NOTE, relationCompletions } from "@/lib/ontology";
import type { TodoState } from "@/lib/todo/todo";
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

describe("the vault's own vocabulary", () => {
  const ONTOLOGY_TEXT = "# Ontology\n\n## Relations\n\n- invented-here: only this note says so\n";
  const EDITED = "# Ontology\n\n## Relations\n\n- rewritten-since: the note was edited\n";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue([...Object.keys(VAULT), ONTOLOGY_NOTE]);
    fetchNote.mockImplementation(async (path: string) =>
      path === ONTOLOGY_NOTE ? ONTOLOGY_TEXT : VAULT[path],
    );
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
    fetchBook.mockImplementation(async (note: string) => beside(note));
    fetchImages.mockResolvedValue([]);
    fetchHtml.mockResolvedValue([]);
    fetchAssets.mockResolvedValue([]);
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

  /**
   * What the mounted editor would offer after `dep` at the start of a line.
   *
   * Read off the live view's own state, so nothing but the route's fetch and the
   * prop behind it could have supplied a name. The state is derived rather than
   * typed into, which keeps the autosave out of a test about a completion.
   */
  function offered(): string[] | undefined {
    const view = EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement);
    if (!view) throw new Error("No editor is mounted");

    const typed = view.state.update({
      changes: { from: 0, to: view.state.doc.length, insert: "dep" },
    }).state;
    return relationCompletions(new CompletionContext(typed, 3, false))?.options.map(
      ({ label }) => label,
    );
  }

  it("offers a name that came from the note it fetched and from nowhere else", async () => {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();

    expect(fetchNote).toHaveBeenCalledWith(ONTOLOGY_NOTE);
    expect(offered()).toEqual(["invented-here"]);
  });

  it("follows an edit to that note without a remount", async () => {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    expect(offered()).toEqual(["invented-here"]);

    // What the vault says when the vocabulary is edited anywhere else: the
    // route invalidates that key and the query behind it reads the note again.
    fetchNote.mockImplementation(async (path: string) =>
      path === ONTOLOGY_NOTE ? EDITED : VAULT[path],
    );
    act(() => stream().send({ path: ONTOLOGY_NOTE, change: "written", digest: "b".repeat(64) }));
    await settle();

    expect(offered()).toEqual(["rewritten-since"]);
  });
});
