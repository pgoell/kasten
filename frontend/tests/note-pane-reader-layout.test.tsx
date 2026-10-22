/// <reference types="node" />

import { readFileSync } from "node:fs";
import { EditorView } from "@codemirror/view";
import { cleanup, fireEvent } from "@testing-library/react";
import { useMemo } from "react";
import type { TodoHit } from "@/lib/api";
import { noteBase } from "@/lib/note-base";
import type { PdfRenderer } from "@/lib/pdf-view";
import type { TodoState } from "@/lib/todo";
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
/** Three headings, one level apart, so the outline indents the last two. */
const TEXT = "# Title\n\nIntro line.\n\n## First\n\nText.\n\n### Deep\n\nMore.\n";

/** The outline's rows, read again each time, since a click can redraw them. */
function outlineRows() {
  return [...document.querySelectorAll<HTMLButtonElement>("[aria-label='Outline'] button")];
}

/** The line the editor's cursor is on, in the one pane open. */
function cursorLine(): number {
  const view = EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement);
  if (!view) throw new Error("No editor is mounted");
  return view.state.doc.lineAt(view.state.selection.main.head).number;
}

/** The reader's rules, read as text from reader.css, comments cut. */
const css = readFileSync("src/styles/reader.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("the reader layout of a note", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue([NOTE, "other.md"]);
    fetchNote.mockImplementation(async (path: string) => (path === NOTE ? TEXT : "other\n"));
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    createNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
    fetchImages.mockResolvedValue([]);
    fetchHtml.mockResolvedValue([]);
    fetchAssets.mockResolvedValue([]);
    fetchGraph.mockResolvedValue({ nodes: [], edges: [], columns: [], rows: [], truncated: false });
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

  it("the note pane draws the outline margin and the links margin around the editor", async () => {
    await open();

    expect(document.querySelector("[data-reader]")).not.toBeNull();
    const reader = document.querySelector("[data-reader]") as HTMLElement;
    expect(reader.querySelector(".cm-editor")).not.toBeNull();
    expect(reader.querySelector("[data-margin='outline']")).not.toBeNull();
    expect(reader.querySelector("[data-margin='links']")).not.toBeNull();
  });

  it("the outline lists the note's headings and marks the current one", async () => {
    await open();

    expect(outlineRows().map((row) => row.textContent)).toEqual(["Title", "First", "Deep"]);

    fireEvent.click(outlineRows()[1] as HTMLElement);
    await settle();

    expect(outlineRows().map((row) => row.getAttribute("aria-current"))).toEqual([
      null,
      "location",
      null,
    ]);
  });

  it("a click on an outline row puts the cursor on that heading", async () => {
    await open();
    expect(outlineRows()).toHaveLength(3);

    fireEvent.click(outlineRows()[2] as HTMLElement);
    await settle();

    // `### Deep` is on line 9 of the note.
    expect(cursorLine()).toBe(9);
  });

  it("the outline of the last note goes when the next note fails to open", async () => {
    const GONE = "gone.md";
    fetchFiles.mockResolvedValue([NOTE, "other.md", GONE]);
    fetchNote.mockImplementation(async (path: string) => {
      if (path === GONE) throw new Error("No such note");
      return path === NOTE ? TEXT : "other\n";
    });
    const app = await open();
    expect(outlineRows()).toHaveLength(3);

    app.click(GONE);
    await settle();

    expect(document.body.textContent).toContain("Could not open gone.md");
    expect(outlineRows()).toHaveLength(0);
  });

  it("an empty pane shows Today above an editor that still takes keys", async () => {
    const app = await renderApp("/");
    await settle();

    expect(document.querySelector("[data-today]")).not.toBeNull();

    const click = vi.spyOn(app.picker(), "click").mockImplementation(() => {});
    app.leader("c", "b");

    expect(click).toHaveBeenCalledTimes(1);
  });

  it("reader.css drops the right margin below 1320 px of pane width with a container query", () => {
    const start = css.indexOf("@container k-reader (width < 1320px) {");
    expect(start).toBeGreaterThanOrEqual(0);

    const block = css.slice(start, css.indexOf("\n}", start));
    expect(block).toMatch(/\[data-margin="links"\]\s*{\s*display:\s*none;/);

    // No window-width media query may hide it: the pane is what is measured.
    const media = css.split("@media").slice(1);
    const byWidth = media.filter(
      (each) =>
        each.slice(0, each.indexOf("{")).includes("width") && each.includes('data-margin="links"'),
    );
    expect(byWidth).toEqual([]);
  });

  it("A7 reader.css hides the Graph button from 1320 px of pane width, the number use-pane-wide reads", () => {
    const start = css.indexOf("@container k-reader (width >= 1320px) {");
    expect(start).toBeGreaterThanOrEqual(0);

    const block = css.slice(start, css.indexOf("\n}", start));
    expect(block).toMatch(/\.k-reader \.cm-note-graph\s*{\s*display:\s*none;/);

    // The same number on both sides: the margin and the button change at one width.
    const hook = readFileSync("src/lib/use-pane-wide.ts", "utf8");
    expect(hook).toContain("RIGHT_MARGIN_FROM = 1320;");
  });

  it("L5 under a finger the depth buttons, the rows and the Graph button are 44 px targets", () => {
    // The depth buttons and the rows carry `pointer-coarse:min-h-11` in their classes
    // (checked in local-graph.test.tsx); the Graph button is a rule of its own here.
    const start = css.indexOf("@media (pointer: coarse) {");
    expect(start).toBeGreaterThanOrEqual(0);

    // The button keeps its size, so the row does not grow; its hit area is an ::after.
    const block = css.slice(start, css.indexOf("\n}", start));
    expect(block).toMatch(/\.k-reader \.cm-note-graph\s*{\s*position:\s*relative;/);
    expect(block).toMatch(
      /\.k-reader \.cm-note-graph::after\s*{\s*content:\s*"";\s*position:\s*absolute;\s*inset:\s*-13px -8px;/,
    );
    expect(block).not.toContain("min-height");
  });

  it("every hover rule of the reader sits inside @media (hover: hover)", () => {
    expect(css).toContain(".k-margin-row:hover");

    const hovers = [...css.matchAll(/:hover/g)].map((match) => match.index ?? 0);
    for (const at of hovers) {
      const media = css.lastIndexOf("@media", at);
      expect(media).toBeGreaterThanOrEqual(0);
      expect(css.slice(media, css.indexOf("{", media))).toContain("(hover: hover)");
      expect(at).toBeLessThan(css.indexOf("\n}", media));
    }
  });
});
