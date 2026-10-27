import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { SearchHit } from "@/lib/api";
import type { PdfRenderer } from "@/lib/pdf-view";
import { hashed } from "./digests";
import {
  defineFoliateFake,
  FakeView,
  lastView,
  resetFoliateFake,
  sectionsOf,
} from "./foliate-fake";
import { act, FakeEventSource, pageHooks, renderApp, settle } from "./home-route-fixture";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";

defineFoliateFake();

const {
  fetchFiles,
  fetchNote,
  saveNote,
  searchNotes,
  fetchMentions,
  fetchBook,
  fetchImages,
  fetchHtml,
  fetchAssets,
  fetchTodos,
  fetchTerminals,
  fetchTags,
  fetchVersion,
} = vi.hoisted(() => ({
  fetchFiles: vi.fn(),
  fetchNote: vi.fn(),
  saveNote: vi.fn(),
  searchNotes: vi.fn(),
  fetchMentions: vi.fn(),
  fetchBook: vi.fn(async (note: string) => ({
    path: note.replace(/\.md$/, ".epub"),
    blob: new Blob(["a book"]),
  })),
  fetchImages: vi.fn(),
  fetchHtml: vi.fn(),
  fetchAssets: vi.fn(),
  fetchTodos: vi.fn(),
  fetchTerminals: vi.fn(),
  fetchTags: vi.fn(),
  fetchVersion: vi.fn(),
}));
vi.mock("@/lib/api", () => ({
  fetchFiles,
  fetchNote,
  saveNote,
  updateNote: vi.fn(),
  searchNotes,
  fetchMentions,
  createNote: vi.fn(),
  fetchTerminals,
  fetchTodos,
  fetchBook,
  uploadAsset: vi.fn(),
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
vi.mock("@/lib/move-api", () => ({ renameNote: vi.fn(), moveFolder: vi.fn() }));
vi.mock("@/lib/trash-api", () => ({
  deleteNote: vi.fn(),
  fetchTrash: vi.fn(),
  restoreEntry: vi.fn(),
  deleteImage: vi.fn(),
}));
vi.mock("@/lib/history-api", () => ({ fetchHistory: vi.fn(), fetchHistoryText: vi.fn() }));
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
const outbox = vi.hoisted(() => ({
  keep: vi.fn(),
  flush: vi.fn(),
  start: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));
vi.mock("@/lib/outbox", () => outbox);

pageHooks();

const NOTES: Record<string, string> = {
  "index.md": "# index",
  "x/plan.md": "# plan",
  "lit/DDIA.md": "# DDIA",
  "notes/intro.md": "# intro",
};
const PDF = "x/plan.pdf";
const EPUB = "lit/DDIA.epub";
const SOLO = "lit/Solo.epub";
const HTML = "notes/page.html";
const ARCHIVED = "98 Archive/old.pdf";
const PASSAGE = "the quoted passage";

const PDF_HIT: SearchHit = {
  path: PDF,
  line: 4,
  text: "the budget table",
  date: "2026-10-01",
  tags: [],
  place: { kind: "pdf", label: "page 3", page: 3, anchor: null },
};
const HTML_HIT: SearchHit = {
  path: HTML,
  line: 2,
  text: "the intro line",
  date: "2026-10-01",
  tags: [],
  place: { kind: "html", label: "Intro", anchor: "intro" },
};
const EPUB_HIT: SearchHit = {
  path: EPUB,
  line: 9,
  text: PASSAGE,
  date: "2026-10-01",
  tags: [],
  place: { kind: "epub", label: "Chapter 2, 41%" },
};

const renderer: PdfRenderer = {
  open: () => ({
    file: Promise.resolve({
      pages: 4,
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
  resetFoliateFake();
  fetchFiles.mockResolvedValue(Object.keys(NOTES));
  fetchNote.mockImplementation(async (path: string) => NOTES[path]);
  saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
  fetchMentions.mockResolvedValue([]);
  fetchTodos.mockResolvedValue([]);
  fetchTerminals.mockResolvedValue([]);
  fetchImages.mockResolvedValue([]);
  fetchHtml.mockResolvedValue([HTML]);
  fetchAssets.mockResolvedValue([EPUB, SOLO, PDF, ARCHIVED]);
  fetchTags.mockResolvedValue([]);
  fetchVersion.mockResolvedValue("0.8.0");
  searchNotes.mockResolvedValue([]);
});

afterEach(async () => {
  cleanup();
  await hashed();
  pdfPaneRenderer.current = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.removeItem("kasten.vim");
  vi.resetAllMocks();
});

const finder = () => screen.queryByRole("dialog", { name: "Find note" });
const option = (path: string) =>
  screen.queryAllByRole("option").find((row) => row.textContent?.startsWith(path));
const pdfPane = () => document.querySelector<HTMLElement>("[data-pdf-pane]");
const htmlFrame = () => document.querySelector<HTMLIFrameElement>("[data-html-pane] iframe");

/** Open the index note, the pane a finder pick replaces or splits from. */
async function opened() {
  const app = await renderApp();
  await settle();
  app.click("index.md");
  await settle();
  return app;
}

/** Enter in the finder's input, the way a reader presses it. */
async function enter() {
  const input = screen.getByRole("combobox");
  fireEvent.keyDown(input, { key: "Enter" });
  await hashed();
  await settle();
}

describe("opening a file from the finder", () => {
  it("A2 Enter on a pdf row opens the pdf pane at page 1", async () => {
    const app = await opened();
    app.leader("f", "f");
    await settle();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "plan.pdf" } });
    await settle();

    await enter();

    expect(finder()).toBeNull();
    expect(pdfPane()?.getAttribute("data-pdf-pane")).toBe(PDF);
    expect(pdfPane()?.hasAttribute("data-page")).toBe(false);
    expect(document.querySelector(".cm-content")).toBeNull();
  });

  it("A2 a tap on an html row opens the html pane", async () => {
    const app = await opened();
    app.leader("f", "f");
    await settle();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "page.html" } });
    await settle();

    fireEvent.click(option(HTML) as HTMLElement);
    await settle();

    expect(document.querySelector("[data-html-pane]")).not.toBeNull();
  });

  it("A2 Enter on an epub with a note opens the book pane over the focused pane", async () => {
    const app = await opened();
    app.leader("f", "f");
    await settle();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "ddia" } });
    await settle();

    await enter();

    expect(app.reader()).not.toBeNull();
    expect(app.panes()).toBe(1);
    expect(fetchBook).toHaveBeenCalledWith("lit/DDIA.md");
  });

  it("A2 Enter on an epub with no note opens it in a new tab", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const app = await opened();
    app.leader("f", "f");
    await settle();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "solo" } });
    await settle();

    await enter();

    expect(open).toHaveBeenCalledWith("/api/assets/lit/Solo.epub", "_blank");
    expect(app.reader()).toBeNull();
  });

  it("I7 lists an upper-case PDF suffix and opens it", async () => {
    fetchAssets.mockResolvedValue([EPUB, "x/Plan.PDF"]);
    const app = await opened();
    app.leader("f", "f");
    await settle();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "plan.pdf" } });
    await settle();

    expect(option("x/Plan.PDF")).toHaveTextContent("PDF");
    await enter();
    expect(pdfPane()?.getAttribute("data-pdf-pane")).toBe("x/Plan.PDF");
  });

  it("I2 leaves an archived pdf out of the finder until the archive is on", async () => {
    const app = await opened();
    app.leader("f", "f");
    await settle();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "old" } });
    await settle();
    expect(option(ARCHIVED)).toBeUndefined();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    await settle();

    app.leader("a");
    await settle();
    app.leader("f", "f");
    await settle();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "old" } });
    await settle();

    expect(option(ARCHIVED)).not.toBeUndefined();
  });

  it("A12 with vim off, Enter on a pdf row opens it from the palette", async () => {
    localStorage.setItem("kasten.vim", "off");
    const app = await opened();
    app.press("P", { keyCode: 80, ctrlKey: true, shiftKey: true });
    await settle();
    fireEvent.click(screen.getByRole("option", { name: /^Find a note/ }));
    await settle();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "plan.pdf" } });
    await settle();

    await enter();

    expect(pdfPane()?.getAttribute("data-pdf-pane")).toBe(PDF);
  });

  it("A12 at 414 px a tap on a pdf row opens it", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    await renderApp();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Run a command by name" }));
    fireEvent.click(screen.getByRole("option", { name: /^Find a note/ }));
    await settle();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "plan.pdf" } });
    await settle();

    fireEvent.click(option(PDF) as HTMLElement);
    await settle();

    expect(pdfPane()?.getAttribute("data-pdf-pane")).toBe(PDF);
  });
});

describe("opening a file from a search hit", () => {
  /** Type a query into the search page and let its scan land. */
  async function searched(value: string) {
    const app = await opened();
    app.leader("f", "g");
    await settle();
    fireEvent.change(screen.getByLabelText("search notes"), { target: { value } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await settle();
    return app;
  }

  it("A6 Enter on a pdf hit opens the pdf at the hit's page", async () => {
    searchNotes.mockResolvedValue([PDF_HIT]);
    await searched("budget");

    fireEvent.keyDown(screen.getByLabelText("search notes"), { key: "Enter" });
    await settle();

    expect(pdfPane()?.getAttribute("data-page")).toBe("3");
  });

  it("A6 Enter on an html hit opens the page at the hit's heading", async () => {
    searchNotes.mockResolvedValue([HTML_HIT]);
    await searched("intro");

    fireEvent.keyDown(screen.getByLabelText("search notes"), { key: "Enter" });
    await settle();

    expect(htmlFrame()?.getAttribute("src")).toContain("#intro");
  });

  it("A6 Enter on an epub hit opens the book through its note with the passage armed", async () => {
    FakeView.sections = sectionsOf([PASSAGE]);
    searchNotes.mockResolvedValue([EPUB_HIT]);
    const app = await searched("passage");

    fireEvent.keyDown(screen.getByLabelText("search notes"), { key: "Enter" });
    await settle();

    expect(app.reader()).not.toBeNull();
    expect(lastView().gone).toHaveLength(1);
  });
});
