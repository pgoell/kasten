import { EditorView } from "@codemirror/view";
import { cleanup, screen } from "@testing-library/react";
import { useMemo } from "react";
import type { TodoHit } from "@/lib/api";
import type { PdfRenderer } from "@/lib/book/pdf-view";
import { noteBase } from "@/lib/note-base";
import type { TodoState } from "@/lib/todo/todo";
import { hashed } from "./digests";
import { defineFoliateFake } from "./foliate-fake";
import { FakeEventSource, pageHooks, renderApp, settle, VAULT } from "./home-route-fixture";

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

describe("the workspace across a reload", () => {
  const FINE = "kasten.workspace.1";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue(Object.keys(VAULT));
    // A note the vault does not hold is refused, the way the backend's 404 is.
    fetchNote.mockImplementation(async (path: string) => {
      const text = VAULT[path];
      if (text === undefined) throw new Error(`GET /api/files/${path} failed with 404`);
      return text;
    });
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
    fetchImages.mockResolvedValue([]);
    fetchHtml.mockResolvedValue([]);
    fetchAssets.mockResolvedValue([]);
  });

  afterEach(async () => {
    cleanup();
    await hashed();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  /** A reload: the page goes, storage stays, and the URL is the one given. */
  async function reload(entry = "/") {
    cleanup();
    const app = await renderApp(entry);
    await settle();
    return app;
  }

  /** What one device holds under its key, ids taken out and the focus by position. */
  function saved(key = FINE): unknown {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    type Node = { id: string; dir?: string; children?: Node[] };
    const leaves = (node: Node): Node[] => node.children?.flatMap(leaves) ?? [node];
    const strip = (node: Node): unknown =>
      node.children ? { dir: node.dir, children: node.children.map(strip) } : { ...node, id: 0 };
    const { layout, treeOpen } = JSON.parse(raw);
    return {
      treeOpen,
      active: layout.active,
      tabs: layout.tabs.map((tab: { root: Node; focus: string; zoom?: boolean }) => ({
        zoom: tab.zoom,
        focus: leaves(tab.root).findIndex((leaf) => leaf.id === tab.focus),
        root: strip(tab.root),
      })),
    };
  }

  /** Put a layout under the fine pointer's key, as a page before this one did. */
  function seed(tabs: unknown[], active = 0) {
    localStorage.setItem(FINE, JSON.stringify({ layout: { tabs, active }, treeOpen: true }));
  }

  const selectedTab = () => screen.getByRole("tab", { selected: true }).textContent;

  it("workspace: I3 a URL naming a note another tab holds goes to that tab", async () => {
    seed([
      { id: "t1", root: { id: "a", path: "index.md" }, focus: "a" },
      { id: "t2", root: { id: "b", path: "other.md" }, focus: "b" },
    ]);

    const app = await reload("/?note=other.md");

    expect(app.tabs()).toBe(2);
    expect(selectedTab()).toContain("other");
    expect(app.text()).toBe("the other note");
  });

  it("workspace: I3 a URL naming a note no pane holds opens it in the focused pane", async () => {
    seed([
      {
        id: "t",
        root: {
          id: "s",
          dir: "row",
          children: [
            { id: "a", path: "index.md" },
            { id: "b", todos: true },
          ],
        },
        focus: "b",
      },
    ]);

    const app = await reload("/?note=other.md");

    expect(app.panes()).toBe(2);
    expect(app.todoPane()).toBeNull();
    expect(app.focusedPane()).toBe(1);
  });

  it("workspace: I3 a plain reload, its URL naming the focused note, changes nothing", async () => {
    seed(
      [
        { id: "t1", root: { id: "a", path: "index.md" }, focus: "a" },
        {
          id: "t2",
          root: { id: "s", dir: "col", children: [{ id: "b", path: "other.md" }, { id: "c" }] },
          focus: "b",
        },
      ],
      1,
    );
    const before = saved();

    await reload("/?note=other.md");

    expect(saved()).toEqual(before);
    expect(selectedTab()).toContain("other");
  });

  it("workspace: I3 a URL with a line on the focused note jumps to that line", async () => {
    fetchNote.mockImplementation(async (path: string) =>
      path === "index.md" ? "one\ntwo\nthree\nfour\n" : VAULT[path],
    );
    seed([{ id: "t", root: { id: "a", path: "index.md" }, focus: "a" }]);
    // Left on line 2, which a URL naming a line must not lose to.
    localStorage.setItem(
      "kasten.positions.1",
      JSON.stringify([["index.md", { anchor: 4, head: 4, top: 0 }]]),
    );

    await reload("/?note=index.md&line=4");

    const view = EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement);
    const head = view?.state.selection.main.head ?? -1;
    expect(view?.state.doc.lineAt(head).number).toBe(4);
  });
});
