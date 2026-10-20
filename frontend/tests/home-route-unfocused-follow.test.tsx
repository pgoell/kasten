import { EditorView } from "@codemirror/view";
import { cleanup, fireEvent } from "@testing-library/react";
import { useMemo } from "react";
import type { TodoHit } from "@/lib/api";
import { noteBase } from "@/lib/note-base";
import type { PdfRenderer } from "@/lib/pdf-view";
import type { TodoState } from "@/lib/todo";
import { hashed } from "./digests";
import { defineFoliateFake } from "./foliate-fake";
import { act, FakeEventSource, pageHooks, renderApp, settle } from "./home-route-fixture";

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

// #361: the box swallows the mousedown so the click leaves the cursor where it
// was, which also keeps the browser from moving the focus. Pane focus follows
// the focus, so without help the open lands off whichever pane had it before.
describe("following from a pane that is not focused", () => {
  const PLAN = "rehearse/my plan.pdf";
  const NOTES: Record<string, string> = {
    "index.md": "pane one\n",
    "embedded.md": "embedded body\n",
    "target.md": "target body\n\n# Head\n",
  };

  /** A three-page pdf drawing nothing, for the embed and for the pane it opens. */
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
    fetchFiles.mockResolvedValue(["index.md", "second.md", "embedded.md", "target.md"]);
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
    fetchImages.mockResolvedValue([]);
    fetchHtml.mockResolvedValue([]);
    fetchAssets.mockResolvedValue([PLAN]);
  });

  afterEach(async () => {
    cleanup();
    await hashed();
    localStorage.removeItem("kasten.vim");
    pdfPaneRenderer.current = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  const drawn = () =>
    [...document.querySelectorAll<HTMLElement>("[data-pane]")].filter(
      (pane) => !pane.classList.contains("hidden"),
    );

  /** What a pane's own editor shows, its embeds' text included. */
  const paneText = (index: number) => drawn()[index]?.querySelector(".cm-content")?.textContent;

  /**
   * `index.md` on the left, `second.md` holding `second` on the right, and the
   * focus back on the left: the pane the click is not in.
   */
  async function twoPanes(second: string, vim: boolean) {
    fetchNote.mockImplementation(async (path: string) =>
      path === "second.md" ? second : NOTES[path],
    );
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    app.leader("%");
    await settle();
    app.click("second.md");
    await settle();
    if (!vim) {
      localStorage.setItem("kasten.vim", "off");
      act(() => void window.dispatchEvent(new StorageEvent("storage", { key: "kasten.vim" })));
      await settle();
    }
    expect(document.querySelector(".cm-vimMode") !== null).toBe(vim);
    app.focusPane(0);
    await settle();
    expect(app.focusedPane()).toBe(0);
    expect(paneText(0)).toContain("pane one");
    expect(paneText(1)).toContain("second note");
    return app;
  }

  const combos = [
    ["ctrl", "on", { ctrlKey: true }, true],
    ["cmd", "on", { metaKey: true }, true],
    ["ctrl", "off", { ctrlKey: true }, false],
    ["cmd", "off", { metaKey: true }, false],
  ] as const;

  it.each(combos)(
    "A5 %s+click on a note embed in an unfocused pane opens it in that pane (I5: vim %s)",
    async (_key, _vim, held, vim) => {
      await twoPanes("second note\n![[embedded]]\n", vim);

      const box = drawn()[1]?.querySelector<HTMLElement>(".cm-embed") as HTMLElement;
      fireEvent.mouseDown(box, held);
      await settle();

      expect(drawn()).toHaveLength(2);
      expect(paneText(0)).toContain("pane one");
      expect(paneText(1)).toContain("embedded body");
      expect(paneText(1)).not.toContain("second note");
    },
  );

  it.each(combos)(
    "A6 %s+click on a pdf embed in an unfocused pane opens the pdf beside that pane (I5: vim %s)",
    async (_key, _vim, held, vim) => {
      await twoPanes("second note\n![[my plan.pdf#page=3]]\n", vim);

      const box = drawn()[1]?.querySelector<HTMLElement>(".cm-embed-pdf") as HTMLElement;
      fireEvent.mouseDown(box, held);
      await settle();

      // Split off the second pane, so it lands to the right of it and the
      // first pane is left as it was.
      expect(drawn()).toHaveLength(3);
      expect(drawn().findIndex((pane) => pane.querySelector("[data-pdf-pane]") !== null)).toBe(2);
      expect(paneText(0)).toContain("pane one");
      expect(paneText(1)).toContain("second note");
      const pdf = drawn()[2]?.querySelector("[data-pdf-pane]");
      expect(pdf?.getAttribute("data-pdf-pane")).toBe(PLAN);
      expect(pdf?.getAttribute("data-page")).toBe("3");
    },
  );

  it.each(combos)(
    "I4 %s+click on a [[wikilink]] in an unfocused pane opens it in that pane (I5: vim %s)",
    async (_key, _vim, held, vim) => {
      await twoPanes("second note\n[[target]]\n", vim);

      const link = drawn()[1]?.querySelector<HTMLElement>(".cm-wikilink") as HTMLElement;
      fireEvent.mouseDown(link, held);
      await settle();

      expect(drawn()).toHaveLength(2);
      expect(paneText(0)).toContain("pane one");
      expect(paneText(1)).toContain("target body");
    },
  );

  // The heading is read before the note opens, and the open is dropped when
  // the focus has gone to another note by then: the click's own move of the
  // focus must not count as that.
  it.each(combos)(
    "B %s+click on a [[link#heading]] in an unfocused pane opens it at the heading in that pane (vim %s)",
    async (_key, _vim, held, vim) => {
      await twoPanes("second note\n[[target#Head]]\n", vim);

      const link = drawn()[1]?.querySelector<HTMLElement>(".cm-wikilink") as HTMLElement;
      fireEvent.mouseDown(link, held);
      await settle();

      expect(drawn()).toHaveLength(2);
      expect(paneText(0)).toContain("pane one");
      expect(paneText(1)).toContain("target body");
      const editor = drawn()[1]?.querySelector(".cm-editor") as HTMLElement;
      const { state } = EditorView.findFromDOM(editor) as EditorView;
      expect(state.doc.lineAt(state.selection.main.head).number).toBe(3);
    },
  );

  it.each([
    ["note", "![[embedded]]", ".cm-embed"],
    ["pdf", "![[my plan.pdf#page=3]]", ".cm-embed-pdf"],
  ])(
    "I8 a plain click on a %s embed in an unfocused pane opens nothing",
    async (_, embed, kind) => {
      await twoPanes(`second note\n${embed}\n`, true);

      const box = drawn()[1]?.querySelector<HTMLElement>(kind) as HTMLElement;
      fireEvent.mouseDown(box);
      fireEvent.mouseUp(box);
      fireEvent.click(box);
      await settle();

      expect(drawn()).toHaveLength(2);
      expect(document.querySelector("[data-pdf-pane]")).toBeNull();
      expect(paneText(0)).toContain("pane one");
      expect(paneText(1)).toContain("second note");
    },
  );
});
