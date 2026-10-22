import { cleanup, fireEvent, screen } from "@testing-library/react";
import { noteBase } from "@/lib/note-base";
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
const outbox = vi.hoisted(() => ({
  keep: vi.fn(),
  flush: vi.fn(),
  start: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));
vi.mock("@/lib/outbox", () => outbox);

pageHooks();

describe("the tab keys on the route", () => {
  const FINE = "kasten.workspace.1";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue(Object.keys(VAULT));
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

  /** What the device holds under its key: the tabs, the focus by position and the zoom. */
  function saved(): unknown {
    const raw = localStorage.getItem(FINE);
    if (raw === null) return null;
    type Node = { id: string; dir?: string; children?: Node[] };
    const leaves = (node: Node): Node[] => node.children?.flatMap(leaves) ?? [node];
    const strip = (node: Node): unknown =>
      node.children ? { dir: node.dir, children: node.children.map(strip) } : { id: 0 };
    const { layout } = JSON.parse(raw);
    return {
      tabs: layout.tabs.map((tab: { root: Node; focus: string; zoom?: boolean }) => ({
        zoom: tab.zoom,
        focus: leaves(tab.root).findIndex((leaf) => leaf.id === tab.focus),
        root: strip(tab.root),
      })),
    };
  }

  /** Open the palette with vim off, and run the row with this name. */
  async function runRow(
    app: { press: (key: string, init?: KeyboardEventInit) => void },
    name: RegExp,
  ) {
    app.press("P", { keyCode: 80, ctrlKey: true, shiftKey: true });
    await settle();
    const row = screen.queryByRole("option", { name });
    expect(row).not.toBeNull();
    if (row) fireEvent.click(row);
    await settle();
  }

  it('A11 Space " splits the pane top and bottom, and the new pane below is focused', async () => {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();

    app.leader('"');
    await settle();

    expect(app.panes()).toBe(2);
    expect(saved()).toMatchObject({ tabs: [{ root: { dir: "col" }, focus: 1 }] });
  });

  it("A11 Space z draws the pane alone, and a second press puts the tab back", async () => {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    app.leader("%");
    await settle();

    app.leader("z");
    await settle();
    expect(saved()).toMatchObject({ tabs: [{ zoom: true }] });

    app.leader("z");
    await settle();
    expect(saved()).toMatchObject({ tabs: [{ zoom: false }] });
    expect(app.panes()).toBe(2);
  });

  it("A11 Space q on a split closes the note, then the pane, and keeps the tab", async () => {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    app.leader("%");
    await settle();
    app.click("other.md");
    await settle();

    app.leader("q");
    await settle();
    expect(app.panes()).toBe(2);

    app.leader("q");
    await settle();
    expect(app.panes()).toBe(1);
    expect(saved()).toMatchObject({ tabs: [{ root: { id: 0 }, focus: 0 }] });
  });

  it("A12 Space 1 and Space 2 go to the first and second tab", async () => {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    app.leader("c", "t");
    await settle();
    const selected = () =>
      screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-selected"));
    expect(selected()).toEqual(["false", "true"]);

    app.leader("1");
    await settle();
    expect(selected()).toEqual(["true", "false"]);

    app.leader("2");
    await settle();
    expect(selected()).toEqual(["false", "true"]);
  });

  it("A20 vim off: the palette row Split the pane left and right splits the pane", async () => {
    localStorage.setItem("kasten.vim", "off");
    try {
      const app = await renderApp();
      await settle();
      app.click("index.md");
      await settle();

      await runRow(app, /Split the pane left and right/);

      expect(app.panes()).toBe(2);
      expect(saved()).toMatchObject({ tabs: [{ root: { dir: "row" }, focus: 1 }] });
    } finally {
      localStorage.removeItem("kasten.vim");
    }
  });

  it("A20 vim off: the palette row Go to tab 2 goes to the second tab", async () => {
    localStorage.setItem("kasten.vim", "off");
    try {
      const app = await renderApp();
      await settle();
      app.click("index.md");
      await settle();
      await runRow(app, /Create a tab/);
      const selected = () =>
        screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-selected"));
      expect(selected()).toEqual(["false", "true"]);

      await runRow(app, /Go to tab 1(?!\d)/);
      expect(selected()).toEqual(["true", "false"]);

      await runRow(app, /Go to tab 2(?!\d)/);
      expect(selected()).toEqual(["false", "true"]);
    } finally {
      localStorage.removeItem("kasten.vim");
    }
  });
});
