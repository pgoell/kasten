import { cleanup, fireEvent, screen } from "@testing-library/react";
import { noteBase } from "@/lib/notes/note-base";
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
vi.mock("@/lib/core/api", () => ({
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
vi.mock("@/lib/vault/move/move-api", () => ({ renameNote, moveFolder }));
vi.mock("@/lib/vault/move/trash-api", () => ({
  deleteNote,
  fetchTrash,
  restoreEntry,
  deleteImage,
}));
vi.mock("@/lib/history/history-api", () => ({ fetchHistory, fetchHistoryText }));
vi.mock("foliate-js/view.js", () => ({}));
const outbox = vi.hoisted(() => ({
  keep: vi.fn(),
  flush: vi.fn(),
  start: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));
vi.mock("@/lib/capture/outbox", () => outbox);

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

  /** Two panes, index.md left and other.md right, with an x typed into the left one. */
  async function typedLeftOfTwo() {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    app.leader("%");
    await settle();
    app.click("other.md");
    await settle();
    app.leader("o");
    await settle();
    app.press("x");
    // jsdom measures nothing: the panes side by side, in the order they are drawn.
    document.querySelectorAll("[data-pane]").forEach((box, index) => {
      box.getBoundingClientRect = () =>
        ({ left: index * 100, top: 0, right: index * 100 + 99, bottom: 100 }) as DOMRect;
    });
    return app;
  }

  /** The next write of index.md waits until the test lets it answer. */
  function holdIndexSave(): () => void {
    let answer = () => {};
    saveNote.mockImplementationOnce(
      (path: string, content: string) =>
        new Promise((resolve) => {
          answer = () => resolve({ path, content });
        }),
    );
    return () => answer();
  }

  // A pane on its way out, as the last tab's are, drops `data-pane` and is no editor of the window.
  const editors = () => [...document.querySelectorAll<HTMLElement>("[data-pane] .cm-content")];
  const typeInto = (editor: HTMLElement, key: string) => fireEvent.keyDown(editor, { key });

  it("Space q closes the note it was pressed on when the focus moves right during the save (#1609)", async () => {
    const app = await typedLeftOfTwo();
    const answer = holdIndexSave();

    app.leader("q");
    await hashed();
    await settle();
    app.leader("l");
    await settle();
    typeInto(editors()[1] as HTMLElement, "x");
    answer();
    await settle();

    expect(saveNote).toHaveBeenCalledWith("index.md", "he index note", false, expect.any(String));
    expect(app.panes()).toBe(2);
    // The left pane is emptied in place, as q on a note does; the right keeps what was typed.
    expect(editors().map((editor) => editor.textContent)).toEqual(["", "he other note"]);
    expect(app.focusedPane()).toBe(1);
  });

  it("Space q closes the note it was pressed on when the focus goes to another tab during the save (#1609)", async () => {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    app.leader("c", "t");
    await settle();
    app.click("other.md");
    await settle();
    app.leader("t", "h");
    await settle();
    app.press("x");
    const answer = holdIndexSave();

    app.leader("q");
    await hashed();
    await settle();
    app.leader("t", "l");
    await settle();
    const other = editors().find((editor) => editor.textContent === "the other note");
    typeInto(other as HTMLElement, "x");
    answer();
    await settle();

    expect(saveNote).toHaveBeenCalledWith("index.md", "he index note", false, expect.any(String));
    expect(other?.textContent).toBe("he other note");
    const raw = JSON.parse(localStorage.getItem(FINE) ?? "null");
    expect(raw.layout.active).toBe(1);
    expect(raw.layout.tabs.map((tab: { root: { path?: string } }) => tab.root.path)).toEqual([
      undefined,
      "other.md",
    ]);
  });

  it("Space q writes what was typed into its note after the key and before the save answered (#1609)", async () => {
    const app = await typedLeftOfTwo();
    const answer = holdIndexSave();

    app.leader("q");
    await hashed();
    await settle();
    app.press("x");
    app.leader("l");
    await settle();
    answer();
    await settle();
    await hashed();
    await settle();

    expect(saveNote).toHaveBeenLastCalledWith(
      "index.md",
      "e index note",
      false,
      expect.any(String),
    );
    expect(editors().map((editor) => editor.textContent)).toEqual(["", "the other note"]);
  });
});
