import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { useMemo } from "react";
import type { TodoHit } from "@/lib/api";
import { drawGraph } from "@/lib/graph-canvas";
import { noteBase } from "@/lib/note-base";
import type { PdfRenderer } from "@/lib/pdf-view";
import type { TodoState } from "@/lib/todo/todo";
import { hashed } from "./digests";
import { defineFoliateFake } from "./foliate-fake";
import { FakeEventSource, pageHooks, renderApp, settle } from "./home-route-fixture";

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
  fetchGraph,
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
    fetchGraph: vi.fn(),
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
vi.mock("@/lib/graph-api", () => ({ fetchGraph }));
// jsdom has no canvas, so the drawing is a double, and a test counts the drawings.
const canvas = vi.hoisted(() => ({
  update: vi.fn(),
  resize: vi.fn(),
  fit: vi.fn(),
  cluster: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock("@/lib/graph-canvas", () => ({ drawGraph: vi.fn() }));
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

const NOTE = "index.md";
const BORGES = "reading/borges.md";
const REF = "ref.md";
/** The line in Borges that links to `index`, which a backlink opens at. */
const BORGES_TEXT = "# Borges\n\nBorn 1899.\n\nSee [[index]].\n";
const BACKLINK_LINE = 5;

/** The graph the margin reads: `index` links out to `other`, and two notes link in. */
const GRAPH = {
  nodes: [
    { path: NOTE, name: "index", type: null, tags: [], missing: false },
    { path: "other.md", name: "Other note", type: null, tags: [], missing: false },
    { path: BORGES, name: "Borges", type: null, tags: [], missing: false },
    { path: REF, name: "Ref", type: null, tags: [], missing: false },
  ],
  edges: [
    { source: NOTE, target: "other.md", relation: null, line: 3 },
    { source: BORGES, target: NOTE, relation: null, line: BACKLINK_LINE },
    { source: REF, target: NOTE, relation: null, line: 2 },
    // A second link from Ref, which must not make a second row.
    { source: REF, target: NOTE, relation: null, line: 4 },
  ],
  columns: [],
  rows: [],
  truncated: false,
};

/** The text of the right margin, where the links and backlinks are drawn, or none. */
function marginText(): string {
  return document.querySelector("[data-margin='links']")?.textContent ?? "";
}

/** The margin's note rows, read again each time since a click can redraw them. The depth switch is not one. */
function marginRows() {
  return [...document.querySelectorAll<HTMLButtonElement>("[data-margin='links'] .k-margin-note")];
}

/**
 * A ResizeObserver that reports the reader as this wide, and nothing else. The
 * margin's graph is asked for only while the pane is wide, so a test that reads it
 * stubs the width first.
 */
function paneWidth(width: number) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private readonly report: ResizeObserverCallback;
      constructor(report: ResizeObserverCallback) {
        this.report = report;
      }
      observe(element: Element) {
        if (!element.hasAttribute("data-reader")) return;
        const entry = { target: element, contentRect: { width } };
        this.report([entry as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    },
  );
}

/** The line the editor's cursor is on, in the one pane open. */
function cursorLine(): number {
  const view = EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement);
  if (!view) throw new Error("No editor is mounted");
  return view.state.doc.lineAt(view.state.selection.main.head).number;
}

describe("the right margin of a note", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue([NOTE, "other.md", BORGES, REF]);
    fetchNote.mockImplementation(async (path: string) => {
      if (path === NOTE) return "# Title\n\nSee the other note.\n";
      if (path === BORGES) return BORGES_TEXT;
      return "other\n";
    });
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    createNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
    fetchImages.mockResolvedValue([]);
    fetchHtml.mockResolvedValue([]);
    fetchAssets.mockResolvedValue([]);
    fetchGraph.mockResolvedValue(GRAPH);
    fetchMentions.mockResolvedValue([]);
    vi.mocked(drawGraph).mockImplementation(() => canvas);
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

  /** Open the note in the one pane the route draws. */
  async function open() {
    const app = await renderApp();
    await settle();
    app.click(NOTE);
    await settle();
    return app;
  }

  it("the right margin lists links and backlinks from the local graph", async () => {
    // The margin draws only in a wide pane, so the graph it reads is asked for only then.
    paneWidth(1440);
    await open();

    expect(fetchGraph).toHaveBeenCalledWith({ query: "", around: NOTE, depth: 1, archive: false });
    // One row per note: Ref links twice and shows once, under Backlinks.
    expect(marginRows().map((row) => row.textContent)).toEqual(["Other note", "Borges", "Ref"]);
    expect(marginText()).toContain("Links");
    expect(marginText()).toContain("Backlinks");
  });

  it("a click on a backlink opens its note at the line that links here", async () => {
    // The margin draws only in a wide pane, so the graph it reads is asked for only then.
    paneWidth(1440);
    await open();
    expect(marginRows()[1]?.textContent).toBe("Borges");

    fireEvent.click(marginRows()[1] as HTMLElement);
    await settle();

    expect(fetchNote).toHaveBeenCalledWith(BORGES);
    expect(cursorLine()).toBe(BACKLINK_LINE);
  });

  it("a failed graph read leaves the plain lines", async () => {
    // The margin draws only in a wide pane, so the graph it reads is asked for only then.
    paneWidth(1440);
    fetchGraph.mockRejectedValue(new Error("The graph is down"));
    await open();

    expect(marginText()).toContain("No links.");
    expect(marginText()).toContain("No backlinks.");
    expect(marginRows()).toHaveLength(0);
  });

  it("A7 a wide pane draws the margin graph and its lists", async () => {
    paneWidth(1440);
    await open();

    const margin = document.querySelector("[data-margin='links']") as HTMLElement;
    expect(within(margin).getByTestId("local-graph-canvas")).toBeTruthy();
    expect(drawGraph).toHaveBeenCalledWith(expect.any(HTMLElement), expect.any(Object), {
      radial: true,
    });
    expect(canvas.update).toHaveBeenLastCalledWith(GRAPH.nodes, GRAPH.edges, NOTE);
    expect(marginRows().map((row) => row.textContent)).toEqual(["Other note", "Borges", "Ref"]);
  });

  it("A8 the Graph button opens the graph and lists in a side sheet over the note", async () => {
    paneWidth(900);
    await open();
    expect(
      document.querySelector("[data-margin='links'] [data-testid='local-graph-canvas']"),
    ).toBeNull();

    const graph = document.querySelector<HTMLElement>("[data-head='graph']");
    expect(graph).not.toBeNull();
    fireEvent.click(graph as HTMLElement);
    await settle();

    const sheet = screen.getByRole("dialog", { name: "Local graph" });
    expect(within(sheet).getByTestId("local-graph-canvas")).toBeTruthy();
    expect(within(sheet).getByText(/^Backlinks/).textContent).toBe("Backlinks 2");
    expect(within(sheet).getByRole("button", { name: "Borges" })).toBeTruthy();
  });

  it("I1 a click on a row in the side sheet opens that note and closes the sheet", async () => {
    paneWidth(900);
    await open();
    const graph = document.querySelector<HTMLElement>("[data-head='graph']");
    expect(graph).not.toBeNull();
    fireEvent.click(graph as HTMLElement);
    await settle();

    const sheet = screen.getByRole("dialog", { name: "Local graph" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Other note" }));
    // The sheet goes down on its own spring, so the clock runs until it is gone.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await settle();

    expect(fetchNote).toHaveBeenCalledWith("other.md");
    expect(screen.queryByRole("dialog", { name: "Local graph" })).toBeNull();
  });

  it("A11 while the pane is narrow and the sheet closed no graph is asked, no mentions read and no canvas made, even after a save", async () => {
    paneWidth(900);
    const app = await open();

    expect(fetchGraph).toHaveBeenCalledTimes(0);
    expect(fetchMentions).toHaveBeenCalledTimes(0);
    expect(drawGraph).toHaveBeenCalledTimes(0);

    // A save of the open note, the same typing the other tests use.
    app.press("x");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await settle();
    expect(saveNote).toHaveBeenCalled();

    expect(fetchGraph).toHaveBeenCalledTimes(0);
    expect(fetchMentions).toHaveBeenCalledTimes(0);
    expect(drawGraph).toHaveBeenCalledTimes(0);
  });
});
