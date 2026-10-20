import { cleanup, fireEvent, screen } from "@testing-library/react";
import { useMemo } from "react";
import type { TodoHit } from "@/lib/api";
import { heldText, holdText } from "@/lib/held-text";
import { noteBase } from "@/lib/note-base";
import type { PdfRenderer } from "@/lib/pdf-view";
import type { TodoState } from "@/lib/todo";
import { hashed } from "./digests";
import { defineFoliateFake } from "./foliate-fake";
import { act, FakeEventSource, pageHooks, renderApp, settle, VAULT } from "./home-route-fixture";
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

describe("the workspace across a reload", () => {
  const FINE = "kasten.workspace.1";
  const COARSE_KEY = "kasten.workspace.coarse.1";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue(Object.keys(VAULT));
    // A note the vault does not hold is refused, the way the backend's 404 is.
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

  /** A reload: the page goes, storage stays, and the URL is the one given. */
  async function reload(entry = "/") {
    cleanup();
    const app = await renderApp(entry);
    await settle();
    return app;
  }

  /** What one device holds under its key, ids taken out and the focus by position. */
  function saved(key = FINE): unknown {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    type Node = { id: string; dir?: string; children?: Node[] };
    const leaves = (node: Node): Node[] => node.children?.flatMap(leaves) ?? [node];
    const strip = (node: Node): unknown =>
      node.children ? { dir: node.dir, children: node.children.map(strip) } : { ...node, id: 0 };
    const { layout, treeOpen } = JSON.parse(raw);
    return {
      treeOpen,
      active: layout.active,
      tabs: layout.tabs.map((tab: { root: Node; focus: string; zoom?: boolean }) => ({
        zoom: tab.zoom,
        focus: leaves(tab.root).findIndex((leaf) => leaf.id === tab.focus),
        root: strip(tab.root),
      })),
    };
  }

  /** Put a layout under the fine pointer's key, as a page before this one did. */
  function seed(tabs: unknown[], active = 0) {
    localStorage.setItem(FINE, JSON.stringify({ layout: { tabs, active }, treeOpen: true }));
  }

  const selectedTab = () => screen.getByRole("tab", { selected: true }).textContent;

  it("workspace: A1 A2 A4 A7 the splits, tabs, focus and zoom made by keys come back", async () => {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    app.leader("%");
    await settle();
    app.click("other.md");
    await settle();
    app.leader("z");
    await settle();
    app.leader("c", "t");
    await settle();
    app.click("index.md");
    await settle();
    const before = saved();
    expect(before).toMatchObject({
      active: 1,
      tabs: [{ zoom: true, focus: 1, root: { dir: "row" } }, { focus: 0 }],
    });

    const again = await reload();

    expect(again.tabs()).toBe(2);
    expect(selectedTab()).toContain("index");
    expect(again.text()).toBe("the index note");
    // The restored layout, written back by the page that restored it.
    expect(saved()).toEqual(before);
    again.leader("1");
    await settle();
    expect(again.panes()).toBe(2);
    expect(again.focusedPane()).toBe(1);
  });

  it("workspace: A7 I4 a phone's note opened by a tap comes back, under its own key", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const app = await renderApp();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "File tree" }));
    app.click("index.md");
    await settle();

    const again = await reload();

    expect(again.text()).toBe("the index note");
    expect(localStorage.getItem(COARSE_KEY)).not.toBeNull();
    expect(localStorage.getItem(FINE)).toBeNull();
    // Shut, the way a phone always starts.
    expect(again.tree()).toBeNull();
  });

  it("workspace: A3 a todo pane beside a note comes back holding the todos", async () => {
    seed([
      {
        id: "t",
        root: {
          id: "s",
          dir: "row",
          children: [
            { id: "a", path: "index.md" },
            { id: "b", todos: true },
          ],
        },
        focus: "a",
      },
    ]);

    const app = await reload();

    expect(app.panes()).toBe(2);
    expect(app.text()).toBe("the index note");
    expect(app.todoPane()).not.toBeNull();
  });

  it("workspace: A5 the tree shut on a desktop stays shut, and a narrow window starts it shut", async () => {
    const app = await renderApp();
    await settle();
    expect(app.tree()).not.toBeNull();
    app.click("index.md");
    await settle();
    app.leader("b");
    await settle();
    expect(app.tree()).toBeNull();

    const again = await reload();
    expect(again.tree()).toBeNull();
    again.leader("b");
    await settle();
    expect(again.tree()).not.toBeNull();
    expect(saved()).toMatchObject({ treeOpen: true });

    stubMatchMedia({ [NARROW]: true });
    const narrow = await reload();
    expect(narrow.tree()).toBeNull();
  });

  it("workspace: A5 a narrow window in between leaves the desktop's open tree open", async () => {
    const app = await renderApp();
    await settle();
    expect(app.tree()).not.toBeNull();

    stubMatchMedia({ [NARROW]: true });
    const narrow = await reload();
    expect(narrow.tree()).toBeNull();
    expect(saved()).toMatchObject({ treeOpen: true });

    stubMatchMedia();
    const wide = await reload();
    expect(wide.tree()).not.toBeNull();
  });

  it("workspace: I1 a broken saved workspace starts clean and is removed", async () => {
    localStorage.setItem(FINE, "{not json");

    const app = await reload();

    expect(app.tree()).not.toBeNull();
    expect(app.panes()).toBe(1);
    expect(localStorage.getItem(FINE)).not.toBe("{not json");
    expect(saved()).toMatchObject({ tabs: [{ root: { id: 0 } }] });
  });

  it("workspace: I2 a pane naming a note gone since blocks nothing and is never written", async () => {
    seed([
      {
        id: "t",
        root: {
          id: "s",
          dir: "row",
          children: [
            { id: "a", path: "index.md" },
            { id: "b", path: "gone.md" },
          ],
        },
        focus: "a",
      },
    ]);

    const app = await reload();
    expect(screen.getByText("Could not open gone.md")).toBeInTheDocument();
    expect(app.text()).toBe("the index note");
    app.press("x");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(saveNote.mock.calls.map(([path]) => path)).toContain("index.md");
    expect(saveNote.mock.calls.filter(([path]) => path === "gone.md")).toEqual([]);
  });

  it("workspace: I2 a focused pane naming a note gone since writes nothing, staying or leaving", async () => {
    seed([{ id: "t", root: { id: "a", path: "gone.md" }, focus: "a" }]);

    await reload();
    expect(screen.getByText("Could not open gone.md")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pagehide"));
    });
    cleanup();
    await hashed();

    expect(saveNote).not.toHaveBeenCalled();
    expect(fetchFiles).toHaveBeenCalled();
  });

  it("workspace: I5 a restore leaves the held text of a pane out of focus where it was", async () => {
    holdText("other.md", {
      content: "typed and never saved",
      reason: "PUT failed with 500",
      conflicted: false,
    });
    const held = localStorage.getItem("kasten.held.2");
    seed([
      {
        id: "t",
        root: {
          id: "s",
          dir: "row",
          children: [
            { id: "a", path: "index.md" },
            { id: "b", path: "other.md" },
          ],
        },
        focus: "a",
      },
    ]);

    const app = await reload();

    expect(app.panes()).toBe(2);
    expect(app.held()?.title).toContain("other.md");
    expect(localStorage.getItem("kasten.held.2")).toBe(held);
    expect(localStorage.getItem(FINE)).not.toContain("typed and never saved");
  });

  it("workspace: I4 a pointer that changes mid-session saves under the key the layout came from", async () => {
    const media = stubMatchMedia();
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();

    await media.set(COARSE, true);
    app.click("other.md");
    await settle();

    expect(localStorage.getItem(COARSE_KEY)).toBeNull();
    expect(localStorage.getItem(FINE)).toContain("other.md");
  });

  it("workspace: I2 a return naming a conflicted note no saved pane holds reads the vault afresh", async () => {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    await app.navigate("/capture");
    await settle();
    // Left conflicted, and the vault came to hold the kept text since. The
    // cache still holds the text from before, which a reopen must not take
    // for the vault's.
    holdText("index.md", {
      content: "the kept text",
      reason: "Changed on disk before the note was left",
      conflicted: true,
    });
    fetchNote.mockImplementation(async (path: string) =>
      path === "index.md" ? "the kept text" : VAULT[path],
    );
    // Nothing saved, so the layout is the URL's note alone.
    localStorage.removeItem(FINE);

    await app.navigate("/", "index.md");
    await settle();

    expect(app.text()).toBe("the kept text");
    expect(app.status()).toBe("Saved");
    expect(heldText("index.md")).toBeUndefined();
  });

  it("workspace: I5 text thrown away in one pane does not come back from a second pane on the same note", async () => {
    holdText("index.md", {
      content: "typed and never saved",
      reason: "Not yet written when the page was hidden",
      conflicted: false,
    });
    seed([
      {
        id: "t",
        root: {
          id: "s",
          dir: "row",
          children: [
            { id: "a", path: "index.md" },
            { id: "b", path: "index.md" },
          ],
        },
        focus: "a",
      },
    ]);
    const app = await reload();
    expect(document.querySelectorAll(".cm-content")[1]?.textContent).toBe("typed and never saved");

    app.ex("e!");
    await settle();

    expect(document.querySelectorAll(".cm-content")[1]?.textContent).toBe("the index note");
    act(() => app.focusPane(1));
    await settle();
    app.press("x");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(saveNote.mock.calls.map(([, content]) => content)).not.toContain("yped and never saved");
  });

  /** index.md focused beside other.md, which holds text a failed write left. */
  async function heldBeside() {
    holdText("other.md", {
      content: "typed and never saved",
      reason: "PUT failed with 500",
      conflicted: false,
    });
    seed([
      {
        id: "t",
        root: {
          id: "s",
          dir: "row",
          children: [
            { id: "a", path: "index.md" },
            { id: "b", path: "other.md" },
          ],
        },
        focus: "a",
      },
    ]);
    return reload();
  }

  /** The text of the editor in one pane, by position. */
  const paneText = (index: number) =>
    document.querySelectorAll(".cm-content")[index]?.textContent ?? null;

  it("workspace: I5 held text of a restored pane out of focus comes back when the pane gets the focus by key", async () => {
    const app = await heldBeside();

    app.leader("o");
    await settle();

    expect(app.focusedPane()).toBe(1);
    expect(paneText(1)).toBe("typed and never saved");
    expect(app.status()).toBe("Could not save");
  });

  it("workspace: I5 held text of a restored pane out of focus comes back when the pane gets the focus by tap", async () => {
    const app = await heldBeside();

    act(() => app.focusPane(1));
    await settle();

    expect(app.focusedPane()).toBe(1);
    expect(paneText(1)).toBe("typed and never saved");
    expect(app.status()).toBe("Could not save");
  });

  it("workspace: I7 storage refusing every touch still starts the app, nothing saved", async () => {
    const refused = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    const tried: string[] = [];
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key) {
      if (key.startsWith("kasten.workspace")) refused();
      return get.call(this, key);
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key.startsWith("kasten.workspace")) {
        tried.push(key);
        refused();
      }
      set.call(this, key, value);
    });

    const app = await reload();
    app.click("index.md");
    await settle();

    expect(app.text()).toBe("the index note");
    expect(tried).toContain(FINE);
  });
});
