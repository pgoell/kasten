import { useMemo } from "react";
import { ChangedOnDisk, type TodoHit } from "@/lib/api";
import { heldText } from "@/lib/held-text";
import { noteBase } from "@/lib/note-base";
import type { PdfRenderer } from "@/lib/pdf-view";
import type { TodoState } from "@/lib/todo";
import { hashed } from "./digests";
import { defineFoliateFake } from "./foliate-fake";
import {
  act,
  baseOf,
  editing,
  pageHooks,
  renderApp,
  settle,
  somebodyElseWrote,
  stream,
  theRoute,
} from "./home-route-fixture";

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

describe("the route", () => {
  theRoute();

  it("opens the note the tree was clicked on", async () => {
    // The harness's own sanity check. Everything below reads as a mystery if
    // this one is broken, so it is here to fail first and say so.
    const app = await renderApp();
    await settle();

    app.click("index.md");
    await settle();

    expect(app.text()).toBe("the index note");
  });

  it("does not read the note again when the vault writes under text nobody saved", async () => {
    const app = await editing();

    somebodyElseWrote();
    await settle();

    // The note's query is not read again: that is what puts the vault's text in
    // front of the editor, and the buffer is holding words that are nowhere
    // else. The one read since is the bar's, for the diff, outside the cache.
    // Counted for index.md alone: the route's log.md query reads its own note too.
    expect(fetchNote.mock.calls.filter(([path]) => path === "index.md")).toHaveLength(2);
    expect(app.cached("index.md")).toBe("the index note");
    expect(app.text()).toBe("he index note");
    expect(app.status()).toBe("Changed on disk");
  });

  it("marks nothing on an outside write's event, and says changed on disk once the save is refused", async () => {
    const app = await editing();

    act(() => stream().send({ path: "index.md", change: "written", digest: "a".repeat(64) }));
    await settle();
    expect(app.status()).toBe("Unsaved changes");

    saveNote.mockRejectedValueOnce(new ChangedOnDisk());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    await settle();

    expect(saveNote).toHaveBeenCalledWith(
      "index.md",
      "he index note",
      false,
      noteBase("the index note"),
    );
    expect(app.status()).toBe("Changed on disk");
    expect(app.text()).toBe("he index note");
  });

  it("refuses to close a note that changed on disk", async () => {
    const app = await editing();
    somebodyElseWrote();
    await settle();

    app.leader("q");
    await settle();

    expect(saveNote).not.toHaveBeenCalled();
    expect(app.text()).toBe("he index note");
    expect(app.status()).toBe("Changed on disk");
  });

  it("refuses to close a conflicted note's pane and writes nothing", async () => {
    // Two panes, so the key would close a pane and not empty the only one.
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    app.leader("%");
    await settle();
    app.leader("o");
    await settle();
    app.press("x");
    somebodyElseWrote();
    await settle();

    app.leader("q");
    await settle();

    expect(app.panes()).toBe(2);
    expect(saveNote).not.toHaveBeenCalled();
    expect(app.status()).toBe("Changed on disk");
    expect(app.heldConflict()).toBeNull();
  });

  it("refuses to open another note over one that changed on disk", async () => {
    const app = await editing();
    somebodyElseWrote();
    await settle();

    app.click("other.md");
    await settle();

    expect(saveNote).not.toHaveBeenCalled();
    expect(app.text()).toBe("he index note");
  });

  it("refuses to start a tab while the note stands conflicted", async () => {
    const app = await editing();
    somebodyElseWrote();
    await settle();

    app.leader("c", "t");
    await settle();

    // A new tab moves the focus to the empty pane in it, which moves the note
    // the autosave follows, and the flush that follows would write the buffer
    // over the vault with nobody asked. Every key that moves the focus is the
    // same key from here.
    expect(app.tabs()).toBe(0);
    expect(saveNote).not.toHaveBeenCalled();
    expect(app.status()).toBe("Changed on disk");
    // With a dozen keys declining, a key that does nothing and says nothing
    // reads as a key that is broken.
    expect(app.flashing()).toBe(true);
  });

  it("flashes nothing when nothing was refused", async () => {
    const app = await editing();
    somebodyElseWrote();
    await settle();

    app.leader("c", "t");
    await settle();
    expect(app.flashing()).toBe(true);

    // Once the flash has played it is over, and the class goes with it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(app.flashing()).toBe(false);

    app.ex("w");
    await settle();

    // A tab and back, which takes the reading off the screen and puts it back:
    // the empty pane in a new tab has no note to say anything about. Nothing
    // was refused on the way, so nothing should flash on the way back.
    app.leader("c", "t");
    await settle();
    expect(app.status()).toBeUndefined();
    app.leader("t", "h");
    await settle();

    expect(app.status()).toBe("Saved");
    expect(app.flashing()).toBe(false);
  });

  it("says the note left for an empty pane was not saved", async () => {
    // The flush on the way out is the only write the note gets, and with no
    // note open the bar's held list is the one place its failure can be read.
    const app = await editing();
    saveNote.mockRejectedValueOnce(new Error("PUT failed with 500"));

    app.leader("c", "t");
    await hashed();
    await settle();

    expect(saveNote).toHaveBeenCalledWith(
      "index.md",
      "he index note",
      false,
      await baseOf("the index note"),
    );
    expect(app.status()).toBeUndefined();
    expect(app.held()?.label).toBe("Not saved: index");
    expect(app.held()?.title).toContain("index.md: PUT failed with 500");
  });

  it("reads a save the vault refused over its base as changed on disk, keeping the text", async () => {
    const app = await editing();
    saveNote.mockRejectedValueOnce(new ChangedOnDisk());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    await hashed();
    await settle();

    expect(app.status()).toBe("Changed on disk");
    expect(app.text()).toBe("he index note");
    expect(app.cached("index.md")).toBe("the index note");
    expect(heldText("index.md")).toMatchObject({ content: "he index note", conflicted: true });
  });
});
