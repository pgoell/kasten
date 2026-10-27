import { cleanup, fireEvent } from "@testing-library/react";
import { useMemo } from "react";
import type { TodoHit } from "@/lib/api";
import type { PdfRenderer } from "@/lib/book/pdf-view";
import { noteBase } from "@/lib/note-base";
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

describe("following a link to a page of HTML", () => {
  const NOTE = "index.md";
  const PAGE = "01 Periodic/05 Newspaper/2026-10-07.html";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue([NOTE]);
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
    fetchImages.mockResolvedValue([]);
    fetchHtml.mockResolvedValue([PAGE]);
    fetchAssets.mockResolvedValue([]);
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

  /** Open the note holding `link`, the cursor on it, and press `gf`. */
  async function follow(link: string) {
    fetchNote.mockResolvedValue(`[[${link}]]\n`);
    const app = await renderApp();
    await settle();
    app.click(NOTE);
    await settle();
    finishParsing(document.body);
    app.press("g");
    app.press("f");
    await settle();
    return app;
  }

  it("opens the page by its bare file name in the HTML pane", async () => {
    await follow("2026-10-07.html");

    expect(document.querySelector("[data-html-pane] iframe")?.getAttribute("title")).toBe(PAGE);
  });

  it("makes no note for a page nobody wrote", async () => {
    await follow("missing.html");

    expect(createNote).not.toHaveBeenCalled();
    expect(document.querySelector("[data-html-pane]")).toBeNull();
  });

  it("opens the page behind an alias", async () => {
    await follow("2026-10-07.html|the paper");

    expect(document.querySelector("[data-html-pane] iframe")?.getAttribute("title")).toBe(PAGE);
  });

  it("opens the page at the heading the link names", async () => {
    await follow("2026-10-07.html#the paper");

    // The frame's address also carries the look (#786), so the fragment is checked alone.
    expect(
      document.querySelector("[data-html-pane] iframe")?.getAttribute("src")?.split("#")[1],
    ).toBe("the%20paper");
  });

  it("opens a page named in capitals", async () => {
    await follow("2026-10-07.HTML");

    expect(document.querySelector("[data-html-pane] iframe")?.getAttribute("title")).toBe(PAGE);
  });

  it("opens a page a markdown link names at its anchor, a ] in its name and all (A3)", async () => {
    // The take writes this shape for a path a wikilink cannot hold.
    // The note sits in a folder, so the address is read from there.
    fetchHtml.mockResolvedValue(["x/a]]b.html"]);
    fetchFiles.mockResolvedValue(["00 Daily/d.md"]);
    fetchNote.mockResolvedValue("[Heading](../x/a%5D%5Db.html#s1)\n");
    const app = await renderApp();
    await settle();
    app.expand("00 Daily");
    app.click("00 Daily/d.md");
    await settle();
    finishParsing(document.body);
    app.press("g");
    app.press("f");
    await settle();

    const iframe = document.querySelector("[data-html-pane] iframe");
    expect(iframe?.getAttribute("title")).toBe("x/a]]b.html");
    expect(iframe?.getAttribute("src")?.split("#")[1]).toBe("s1");
  });

  it("loads a page whose name holds # from the tree", async () => {
    // From the tree and not a link, `[[plan #2.html]]` naming the heading `2.html`.
    const odd = "plan #2.html";
    fetchHtml.mockResolvedValue([odd]);
    fetchNote.mockResolvedValue("");
    const app = await renderApp();
    await settle();
    app.click(odd);
    await settle();

    // The frame's address also carries the look (#786), so the path is checked alone.
    expect(
      document.querySelector("[data-html-pane] iframe")?.getAttribute("src")?.split("?")[0],
    ).toBe("/api/html/plan%20%232.html");
  });
});

describe("following a link to an asset", () => {
  const NOTE = "index.md";
  const PLAN = "rehearse/my plan.pdf";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    vi.stubGlobal("open", vi.fn());
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
    // A flush naming a base goes out once its hash lands, which must be
    // inside this test and not the next one.
    await hashed();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  /** Open the note holding `link`, the cursor on it, and press `gf`. */
  async function follow(link: string) {
    fetchNote.mockResolvedValue(`[[${link}]]\n`);
    const app = await renderApp();
    await settle();
    app.click(NOTE);
    await settle();
    finishParsing(document.body);
    app.press("g");
    app.press("f");
    await settle();
    return app;
  }

  it("draws a link to an asset the vault holds as live", async () => {
    await follow("my plan.pdf");

    expect(document.querySelector(".cm-wikilink")).not.toBeNull();
    expect(document.querySelector(".cm-wikilink-dead")).toBeNull();
  });

  // A pdf opens in kasten's own view, which `a pdf in kasten's own view` below
  // covers; every other asset still goes to the browser.
  it("opens an asset the vault holds in a new tab, in any case", async () => {
    fetchAssets.mockResolvedValue(["rehearse/my talk.mp3"]);
    await follow("My Talk.MP3|the talk");

    expect(window.open).toHaveBeenCalledWith("/api/assets/rehearse/my%20talk.mp3", "_blank");
    expect(createNote).not.toHaveBeenCalled();
  });

  it("opens an asset whose name holds ? with gf", async () => {
    fetchAssets.mockResolvedValue(["plan?.mp3"]);
    await follow("plan?.mp3");

    expect(document.querySelector(".cm-vimMode")).not.toBeNull();
    expect(window.open).toHaveBeenCalledWith("/api/assets/plan%3F.mp3", "_blank");
  });

  it("opens an asset whose name holds ? on ctrl+click with vim off", async () => {
    fetchAssets.mockResolvedValue(["plan?.mp3"]);
    localStorage.setItem("kasten.vim", "off");
    try {
      fetchNote.mockResolvedValue("[[plan?.mp3]]\n");
      const app = await renderApp();
      await settle();
      app.click(NOTE);
      await settle();
      expect(document.querySelector(".cm-vimMode")).toBeNull();
      finishParsing(document.body);
      const link = document.querySelector(".cm-wikilink") as HTMLElement;
      fireEvent.mouseDown(link, { ctrlKey: true });
      await settle();
    } finally {
      localStorage.removeItem("kasten.vim");
    }

    expect(window.open).toHaveBeenCalledWith("/api/assets/plan%3F.mp3", "_blank");
  });

  it("draws and opens an asset whose suffix is in capitals", async () => {
    fetchAssets.mockResolvedValue(["docs/Talk.MP3"]);
    await follow("Talk.MP3");

    expect(document.querySelector(".cm-wikilink")?.textContent).toBe("Talk.MP3");
    expect(document.querySelector(".cm-wikilink-dead")).toBeNull();
    expect(window.open).toHaveBeenCalledWith("/api/assets/docs/Talk.MP3", "_blank");
    expect(createNote).not.toHaveBeenCalled();
  });

  it("makes no note and opens nothing for an asset the vault lacks", async () => {
    await follow("missing.pdf");

    expect(window.open).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
    expect(document.querySelector(".cm-wikilink-dead")).not.toBeNull();
  });
});
