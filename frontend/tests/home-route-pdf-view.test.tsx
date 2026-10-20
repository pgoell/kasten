import { cleanup, fireEvent, screen } from "@testing-library/react";
import { useMemo } from "react";
import type { TodoHit } from "@/lib/api";
import { noteBase } from "@/lib/note-base";
import type { PdfRenderer } from "@/lib/pdf-view";
import type { TodoState } from "@/lib/todo";
import { hashed } from "./digests";
import { defineFoliateFake } from "./foliate-fake";
import { FakeEventSource, pageHooks, renderApp, settle } from "./home-route-fixture";
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

// #353: a phone's own pdf viewer ignores `#page`, so a pdf opens in a pane of
// kasten's that draws it with `showPdf`, at the page the link names. The pane's
// renderer is a fake three-page pdf, put in through `pdfPaneRenderer` above.
describe("a pdf in kasten's own view", () => {
  const NOTE = "index.md";
  const PLAN = "rehearse/my plan.pdf";
  const URL = "/api/assets/rehearse/my%20plan.pdf";
  /** How tall a page slot is laid out, so slot N sits at (N - 1) * PAGE. */
  const PAGE = 800;

  /** Every URL the pane opened, every page it asked for, and how many it freed. */
  let opened: string[];
  let asked: number[];
  let destroyed: number;
  /** What each box's scroll was last set to, which jsdom keeps at 0. */
  let scrolled: WeakMap<Element, number>;

  const renderer: PdfRenderer = {
    open(url) {
      opened.push(url);
      return {
        file: Promise.resolve({
          pages: 3,
          page: async (number: number) => {
            asked.push(number);
            return { width: 600, height: 800, draw: async () => {} };
          },
        }),
        destroy: () => {
          destroyed += 1;
        },
      };
    },
  };

  /** Sees nothing until a test says a slot came into view. */
  class FakeObserver {
    static all: FakeObserver[] = [];
    readonly observed = new Set<Element>();
    private readonly callback: IntersectionObserverCallback;
    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback;
      FakeObserver.all.push(this);
    }
    observe(target: Element) {
      this.observed.add(target);
    }
    disconnect() {
      this.observed.clear();
    }
    static reveal(target: Element) {
      for (const observer of FakeObserver.all) {
        if (!observer.observed.has(target)) continue;
        const entry = { isIntersecting: true, target } as IntersectionObserverEntry;
        observer.callback([entry], observer as unknown as IntersectionObserver);
      }
    }
  }

  class QuietResizer {
    observe() {}
    disconnect() {}
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    vi.stubGlobal("open", vi.fn());
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    vi.stubGlobal("ResizeObserver", QuietResizer);
    opened = [];
    asked = [];
    destroyed = 0;
    scrolled = new WeakMap();
    FakeObserver.all = [];
    pdfPaneRenderer.current = renderer;
    // jsdom lays nothing out: a page slot sits at its place in the box times
    // a page's height, and a box keeps the scroll it was given.
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (!this.classList.contains("cm-pdf-page")) return 0;
      return [...(this.parentElement?.children ?? [])].indexOf(this) * PAGE;
    });
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(PAGE);
    vi.spyOn(Element.prototype, "scrollTop", "get").mockImplementation(function (this: Element) {
      return scrolled.get(this) ?? 0;
    });
    vi.spyOn(Element.prototype, "scrollTop", "set").mockImplementation(function (
      this: Element,
      value: number,
    ) {
      scrolled.set(this, value);
    });
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue([NOTE]);
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
    fetchImages.mockResolvedValue([]);
    fetchHtml.mockResolvedValue([]);
    fetchAssets.mockResolvedValue([PLAN]);
  });

  afterEach(async () => {
    cleanup();
    await hashed();
    pdfPaneRenderer.current = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  /** Open the note, its first line plain so the line under it draws as a widget. */
  async function openNote(text: string) {
    fetchNote.mockResolvedValue(text);
    const app = await renderApp();
    await settle();
    // A phone starts with the tree shut, the toolbar being the way to it.
    if (app.tree() === null) fireEvent.click(screen.getByRole("button", { name: "File tree" }));
    app.click(NOTE);
    await settle();
    return app;
  }

  /** The pdf pane, while a pane holds one. */
  const pdfPane = () => document.querySelector<HTMLElement>("[data-pdf-pane]");

  /** The pane's own page slots, not the embed's in the note beside it. */
  const paneSlots = () => [
    ...(pdfPane()?.querySelectorAll<HTMLElement>("[data-pdf-box] .cm-pdf-page") ?? []),
  ];

  /** The note's pdf box, drawn on a line the cursor is not on. */
  const embedBox = () =>
    document.querySelector<HTMLElement>("[data-pane] .cm-content .cm-embed-pdf") as HTMLElement;

  /**
   * That the pane holds this pdf at this page, with that page at the top of
   * its box and drawn once it is in view: what the reader sees, not a URL.
   */
  async function showsPage(page: number, pages = 3) {
    const pane = pdfPane();
    expect(pane?.getAttribute("data-pdf-pane")).toBe(PLAN);
    expect(paneSlots()).toHaveLength(pages);
    const box = pane?.querySelector("[data-pdf-box]") as HTMLElement;
    expect(box.scrollTop).toBe((page - 1) * PAGE);
    expect(box.textContent).not.toContain("Could not read");
    asked.length = 0;
    FakeObserver.reveal(paneSlots()[page - 1] as HTMLElement);
    await settle();
    expect(asked).toEqual([page]);
    expect(paneSlots()[page - 1]?.querySelector("canvas")).not.toBeNull();
    expect(opened.at(-1)).toBe(URL);
    expect(window.open).not.toHaveBeenCalled();
  }

  /** The panes the tab draws, as opposed to the ones it only holds. */
  const drawn = () =>
    [...document.querySelectorAll("[data-pane]")].filter(
      (pane) => !pane.classList.contains("hidden"),
    );

  it("A1 a tap on the embed on a phone opens kasten's view at page 3, alone on screen", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    await openNote("above\n![[my plan.pdf#page=3]]\n");

    const box = embedBox();
    fireEvent.pointerDown(box, { pointerType: "touch" });
    fireEvent.click(box);
    await settle();

    expect(pdfPane()?.getAttribute("data-page")).toBe("3");
    expect(drawn()).toHaveLength(1);
    expect(drawn()[0]?.querySelector("[data-pdf-pane]")).not.toBeNull();
    await showsPage(3);
  });

  it.each([
    ["ctrl", { ctrlKey: true }],
    ["cmd", { metaKey: true }],
  ])("A2 %s and a click on the box opens the same view at page 3", async (_, held) => {
    await openNote("above\n![[my plan.pdf#page=3]]\n");

    fireEvent.mouseDown(embedBox(), held);
    await settle();

    await showsPage(3);
  });

  // The cursor's line draws as source, and `l` puts the cursor past the `!`.
  it("A3 gf on the embed's line, vim on, opens the same view at page 3", async () => {
    const app = await openNote("![[my plan.pdf#page=3]]\n");

    app.press("l");
    app.press("g");
    app.press("f");
    await settle();

    await showsPage(3);
  });

  // Enter follows only with vim on, vim being what binds it (editor keys).
  it("A4 Enter on the embed's line opens the same view at page 3", async () => {
    const app = await openNote("![[my plan.pdf#page=3]]\n");

    app.press("l");
    app.press("Enter", { keyCode: 13 });
    await settle();

    await showsPage(3);
  });

  it("A5 on the desktop the same view opens beside the note at page 3", async () => {
    await openNote("above\n![[my plan.pdf#page=3]]\n");

    fireEvent.mouseDown(embedBox(), { ctrlKey: true });
    await settle();

    expect(drawn()).toHaveLength(2);
    expect(drawn()[0]?.querySelector(".cm-content")?.textContent).toContain("above");
    await showsPage(3);
  });

  it("I1 an embed with no #page opens the view at page 1", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    await openNote("above\n![[my plan.pdf]]\n");

    const box = embedBox();
    fireEvent.pointerDown(box, { pointerType: "touch" });
    fireEvent.click(box);
    await settle();

    expect(pdfPane()?.hasAttribute("data-page")).toBe(false);
    await showsPage(1);
  });

  it("I2 a second open at another page turns the open pane, no second pane", async () => {
    await openNote("above\n![[my plan.pdf#page=3]]\n![[my plan.pdf#page=2]]\n");
    const [three, two] = [
      ...document.querySelectorAll<HTMLElement>("[data-pane] .cm-content .cm-embed-pdf"),
    ];

    fireEvent.mouseDown(three as HTMLElement, { ctrlKey: true });
    await settle();
    await showsPage(3);
    const panes = document.querySelectorAll("[data-pane]").length;

    fireEvent.mouseDown(two as HTMLElement, { ctrlKey: true });
    await settle();

    expect(document.querySelectorAll("[data-pane]")).toHaveLength(panes);
    expect(document.querySelectorAll("[data-pdf-pane]")).toHaveLength(1);
    expect(pdfPane()?.getAttribute("data-page")).toBe("2");
    await showsPage(2);
  });

  it("B a second open at the same page goes back to it after a scroll away", async () => {
    await openNote("above\n![[my plan.pdf#page=3]]\n");
    fireEvent.mouseDown(embedBox(), { ctrlKey: true });
    await settle();
    await showsPage(3);

    // Scrolled by hand back to the first page.
    const away = pdfPane()?.querySelector("[data-pdf-box]") as HTMLElement;
    away.scrollTop = 0;
    fireEvent.scroll(away);

    fireEvent.mouseDown(embedBox(), { ctrlKey: true });
    await settle();

    expect(document.querySelectorAll("[data-pdf-pane]")).toHaveLength(1);
    const box = pdfPane()?.querySelector("[data-pdf-box]") as HTMLElement;
    expect(box.scrollTop).toBe(2 * PAGE);
  });

  it("I3 closing the pdf pane frees its pdf", async () => {
    await openNote("above\n![[my plan.pdf#page=3]]\n");
    fireEvent.mouseDown(embedBox(), { ctrlKey: true });
    await settle();
    await showsPage(3);
    const before = destroyed;

    const pane = pdfPane() as HTMLElement;
    fireEvent.keyDown(pane, { key: " " });
    fireEvent.keyDown(pane, { key: "q" });
    await settle();

    expect(pdfPane()).toBeNull();
    expect(destroyed).toBe(before + 1);
  });

  it("I4 a page past the end opens the pdf at its first page, without an error", async () => {
    const app = await openNote("[[my plan.pdf#page=9]]\n");

    app.press("g");
    app.press("f");
    await settle();

    expect(pdfPane()?.getAttribute("data-page")).toBe("9");
    await showsPage(1);
  });

  it("I5 a plain [[x.pdf#page=3]] link, followed, opens the same view at page 3", async () => {
    const app = await openNote("[[my plan.pdf#page=3]]\n");

    app.press("g");
    app.press("f");
    await settle();

    await showsPage(3);
  });
});
