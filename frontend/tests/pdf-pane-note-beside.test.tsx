import { cleanup, fireEvent, screen } from "@testing-library/react";
import { NoteExists } from "@/lib/api";
import type { PdfRenderer } from "@/lib/pdf-view";
import { hashed } from "./digests";
import { defineFoliateFake } from "./foliate-fake";
import { FakeEventSource, pageHooks, renderApp, settle, VAULT } from "./home-route-fixture";

defineFoliateFake();

// The doubles, the same in every home-route file: see home-route-fixture.tsx.
const {
  fetchFiles,
  fetchNote,
  saveNote,
  createNote,
  fetchTodos,
  fetchImages,
  fetchHtml,
  fetchAssets,
} = vi.hoisted(() => {
  const fetchNote = vi.fn();
  const saveNote = vi.fn();
  return {
    fetchFiles: vi.fn(),
    fetchNote,
    saveNote,
    createNote: vi.fn(),
    fetchTodos: vi.fn().mockResolvedValue([]),
    fetchImages: vi.fn().mockResolvedValue([]),
    fetchHtml: vi.fn().mockResolvedValue([]),
    fetchAssets: vi.fn().mockResolvedValue([]),
  };
});
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  fetchFiles,
  fetchNote,
  saveNote,
  createNote,
  fetchTodos,
  fetchImages,
  fetchHtml,
  fetchAssets,
  fetchTerminals: vi.fn().mockResolvedValue([]),
  fetchVersion: vi.fn().mockResolvedValue("0.8.0"),
  fetchTags: vi.fn().mockResolvedValue([]),
  fetchWeather: async () => [],
  UPLOAD_LIMIT_BYTES: 1024 * 1024 * 1024,
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
const outbox = vi.hoisted(() => ({
  keep: vi.fn(),
  flush: vi.fn(),
  start: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));
vi.mock("@/lib/outbox", () => outbox);

// A pdf of one page that draws nothing: the pane's look is no concern here.
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

pageHooks();

describe("the note of an open pdf, beside it", () => {
  const PLAN = "x/my plan.pdf";
  const NOTE = "x/my plan.md";

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
    fetchNote.mockImplementation(async (path: string) => ({ ...VAULT, [NOTE]: "the plan" })[path]);
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    createNote.mockImplementation(async (path: string, content = "") => ({ path, content }));
    fetchAssets.mockResolvedValue([PLAN]);
  });

  afterEach(async () => {
    cleanup();
    await hashed();
    pdfPaneRenderer.current = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  /** Open the pdf from its row in the tree, the way a reader does. */
  async function openPlan(files: string[]) {
    fetchFiles.mockResolvedValue(files);
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    app.expand("x");
    app.click(PLAN);
    await settle();
    return app;
  }

  it("Note beside opens the pdf's note in a pane beside the pdf", async () => {
    const app = await openPlan(["index.md", NOTE]);

    fireEvent.click(screen.getByRole("button", { name: "Note beside" }));
    await settle();

    expect(app.panes()).toBe(2);
    expect(createNote).not.toHaveBeenCalled();
    expect(app.text()).toBe("the plan");
  });

  it("Note beside makes the note first when the vault has none", async () => {
    const app = await openPlan(["index.md"]);

    fireEvent.click(screen.getByRole("button", { name: "Note beside" }));
    await settle();

    expect(createNote).toHaveBeenCalledWith(NOTE, "");
    expect(app.panes()).toBe(2);
    expect(app.cached(NOTE)).toBe("");
  });

  it("Note beside opens a note the file list lacks, with no refusal in the bar", async () => {
    createNote.mockRejectedValue(new NoteExists(NOTE));
    const app = await openPlan(["index.md"]);

    fireEvent.click(screen.getByRole("button", { name: "Note beside" }));
    await settle();

    expect(app.notice()).toBeNull();
    expect(app.panes()).toBe(2);
    expect(app.text()).toBe("the plan");
  });

  it("Note beside says so in the bar when the vault refuses the note's path", async () => {
    createNote.mockRejectedValue(new Error("refused"));
    const app = await openPlan(["index.md"]);

    fireEvent.click(screen.getByRole("button", { name: "Note beside" }));
    await settle();

    expect(app.notice()).toBe(`The vault refused ${NOTE}`);
    expect(app.panes()).toBe(1);
  });
});
