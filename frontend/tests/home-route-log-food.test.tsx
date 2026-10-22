import { EditorView } from "@codemirror/view";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { NoteMissing } from "@/lib/api";
import { noteBase } from "@/lib/note-base";
import { periodicNote } from "@/lib/periodic";
import { hashed } from "./digests";
import { defineFoliateFake } from "./foliate-fake";
import {
  editing,
  FakeEventSource,
  pageHooks,
  renderApp,
  settle,
  VAULT,
} from "./home-route-fixture";
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
  fetchTerminals,
  fetchTodos,
  fetchBook,
  uploadAsset,
  fetchImages,
  fetchHtml,
  fetchAssets,
  fetchVersion,
  fetchTags,
  renameNote,
  moveFolder,
  deleteNote,
  fetchTrash,
  restoreEntry,
  deleteImage,
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
    fetchTerminals: vi.fn().mockResolvedValue([]),
    fetchTodos: vi.fn().mockResolvedValue([]),
    fetchBook: vi.fn(async (note: string) => beside(note)),
    uploadAsset: vi.fn().mockResolvedValue(undefined),
    fetchImages: vi.fn().mockResolvedValue([]),
    fetchHtml: vi.fn().mockResolvedValue([]),
    fetchAssets: vi.fn().mockResolvedValue([]),
    fetchVersion: vi.fn().mockResolvedValue("0.8.0"),
    fetchTags: vi.fn().mockResolvedValue([]),
    renameNote: vi.fn(),
    moveFolder: vi.fn(),
    deleteNote: vi.fn(),
    fetchTrash: vi.fn(),
    restoreEntry: vi.fn(),
    deleteImage: vi.fn(),
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
vi.mock("@/lib/outbox", () => ({
  keep: vi.fn(),
  flush: vi.fn(),
  start: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));

pageHooks();

// Pinned to a day, since the food search lands on the note the clock names.
const TODAY = periodicNote("daily", new Date(2026, 9, 20, 9, 0)).path;
const TODAY_TEXT = "---\ntype: Periodic Note\n---\n\n# 2026-10-20 Tuesday\n\n## TODOs\n";
const PAST = periodicNote("daily", new Date(2026, 9, 19, 9, 0)).path;
const PAST_TEXT = "---\ntype: Periodic Note\n---\n\n# 2026-10-19 Monday\n\n## TODOs\n";
const LOG_CONFIG = "99 Misc/01 Config/log.md";

describe("the palette's Log food, on the route", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 20, 9, 0));
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue([...Object.keys(VAULT), TODAY, PAST]);
    fetchNote.mockImplementation(async (path: string) => {
      // The log config note is missing here, as in a vault without it, so the card draws its defaults.
      if (path === LOG_CONFIG) throw new NoteMissing(path);
      if (path === TODAY) return TODAY_TEXT;
      if (path === PAST) return PAST_TEXT;
      return VAULT[path];
    });
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
    fetchTags.mockResolvedValue([]);
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
    localStorage.removeItem("kasten.vim");
  });

  const option = (name: string | RegExp) => screen.queryByRole("option", { name });
  // Undefined with no editor on screen, so a check after a missed row fails rather than throws.
  const editorText = () => {
    const editor = document.querySelector<HTMLElement>(".cm-editor");
    return editor === null ? undefined : EditorView.findFromDOM(editor)?.state.doc.toString();
  };
  const foodQuery = () => document.querySelector(".cm-log-food-query");
  /** Taps the palette row called `name`. A missing row is a failed assertion, not a throw. */
  function tapRow(name: RegExp) {
    const row = option(name);
    expect.soft(row).not.toBeNull();
    if (row) fireEvent.click(row);
  }

  it("#762 B1 Log food is listed over a pane with no editor, and runs there", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    await renderApp("/");
    await settle();

    // The toolbar's button holds the focus, so the palette opens over a pane with no editor.
    fireEvent.click(screen.getByRole("button", { name: "Run a command by name" }));
    await settle();
    tapRow(/^Log food/);
    await settle();

    expect(editorText()).toContain("# 2026-10-20 Tuesday");
    expect(document.activeElement).toBe(foodQuery());
    expect(foodQuery()).not.toBeNull();
  });

  it("#762 B2 B4 B5 with vim on, Log food over index.md opens today's note in the focused pane with the food query focused", async () => {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();

    app.leader(":");
    await settle();
    tapRow(/^Log food/);
    await settle();

    expect(editorText()).toContain("# 2026-10-20 Tuesday");
    expect(foodQuery()).not.toBeNull();
    expect(document.activeElement).toBe(foodQuery());
  });

  it("#762 B2 B4 B6 with vim off, Log food over index.md opens today's note in the focused pane with the food query focused", async () => {
    localStorage.setItem("kasten.vim", "off");
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();

    app.press("P", { keyCode: 80, ctrlKey: true, shiftKey: true });
    await settle();
    tapRow(/^Log food/);
    await settle();

    expect(editorText()).toContain("# 2026-10-20 Tuesday");
    expect(foodQuery()).not.toBeNull();
    expect(document.activeElement).toBe(foodQuery());
  });

  it("#762 B7 on a phone, the toolbar's run button opens the palette over index.md and Log food opens today's note with the food query focused", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    await renderApp(`/?note=${encodeURIComponent("index.md")}`);
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Run a command by name" }));
    await settle();
    tapRow(/^Log food/);
    await settle();

    expect(editorText()).toContain("# 2026-10-20 Tuesday");
    expect(foodQuery()).not.toBeNull();
    expect(document.activeElement).toBe(foodQuery());
  });

  it("#762 B3 Log food over index.md makes today's note when the vault has none, and opens its food search", async () => {
    let made = false;
    fetchFiles.mockImplementation(async () =>
      made ? [...Object.keys(VAULT), TODAY] : Object.keys(VAULT),
    );
    fetchNote.mockImplementation(async (path: string) => {
      if (path === LOG_CONFIG || (path === TODAY && !made)) throw new NoteMissing(path);
      if (path === TODAY) return TODAY_TEXT;
      return VAULT[path];
    });
    createNote.mockImplementation(async (path: string, body: string) => {
      made = true;
      return { path, content: body };
    });
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();

    app.leader(":");
    await settle();
    tapRow(/^Log food/);
    await settle();

    expect(createNote).toHaveBeenCalledWith(TODAY, expect.stringContaining("# 2026-10-20 Tuesday"));
    expect(editorText()).toContain("# 2026-10-20 Tuesday");
    expect(foodQuery()).not.toBeNull();
    expect(document.activeElement).toBe(foodQuery());
  });

  it("#762 I4 Log food over a past daily note's card opens the search there, with no navigation and no write", async () => {
    const app = await renderApp(`/?note=${encodeURIComponent(PAST)}`);
    await settle();

    app.leader(":");
    await settle();
    tapRow(/^Log food/);
    await settle();

    expect(editorText()).toContain("# 2026-10-19 Monday");
    expect(foodQuery()).not.toBeNull();
    expect(document.activeElement).toBe(foodQuery());
    expect(saveNote).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
  });

  it("#762 I5 Log food, then another note opened before today's note shows, gives no food search there or when today is opened by hand", async () => {
    // Today's note reads only once the test says so, which is what leaves the window open.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchNote.mockImplementation(async (path: string) => {
      if (path === LOG_CONFIG) throw new NoteMissing(path);
      if (path === TODAY) {
        await gate;
        return TODAY_TEXT;
      }
      return VAULT[path];
    });
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();

    app.leader(":");
    await settle();
    tapRow(/^Log food/);
    await settle();
    app.click("other.md");
    await settle();
    release();
    await settle();

    expect(editorText()).toContain("the other note");
    expect(foodQuery()).toBeNull();

    app.leader("g", "d");
    await settle();

    expect(editorText()).toContain("# 2026-10-20 Tuesday");
    expect(foodQuery()).toBeNull();
  });

  it("#762 I5 a refused save of the focused note leaves no search waiting for today's note opened by hand", async () => {
    // index.md holds a typed edit, and the save Log food makes first is refused.
    const app = await editing();
    let refusing = true;
    saveNote.mockImplementation(async (path: string, content: string) => {
      if (refusing) throw new Error("PUT failed with 500");
      return { path, content };
    });

    app.leader(":");
    await settle();
    tapRow(/^Log food/);
    await settle();
    expect(app.text()).toBe("he index note");

    refusing = false;
    app.leader("g", "d");
    await settle();

    expect(editorText()).toContain("# 2026-10-20 Tuesday");
    expect(foodQuery()).toBeNull();
  });

  it("#762 I6 with the focus off today's editor, Log food opens its food search and writes nothing", async () => {
    const app = await renderApp(`/?note=${encodeURIComponent(TODAY)}`);
    await settle();
    // The focus on a row of the tree, outside every editor, so the palette finds no view.
    app.treeCursor()?.focus();
    expect(document.activeElement?.closest(".cm-editor")).toBeNull();

    app.leader(":");
    await settle();
    tapRow(/^Log food/);
    await settle();

    expect(foodQuery()).not.toBeNull();
    expect(document.activeElement).toBe(foodQuery());
    expect(saveNote).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
  });
});
