import { fireEvent } from "@testing-library/react";
import { useMemo } from "react";
import type { TodoHit } from "@/lib/api";
import { noteBase } from "@/lib/note-base";
import type { PdfRenderer } from "@/lib/pdf-view";
import type { TodoState } from "@/lib/todo";
import { defineFoliateFake, lastView } from "./foliate-fake";
import { act, clicked, pageHooks, renderApp, settle, theRoute } from "./home-route-fixture";

defineFoliateFake();

// The doubles, the same in every home-route file: see home-route-fixture.tsx.
const {
  beside,
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

  it("opens the note's book in a pane beside it", async () => {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();

    app.leader("g", "r");
    await settle();

    expect(app.panes()).toBe(2);
    expect(app.reader()).not.toBeNull();
    // The note is still on screen. A key called "read this book beside this
    // note" must not eat the note.
    expect(app.text()).toContain("the index note");
  });

  it("does nothing with no note in the focused pane", async () => {
    // Passes before the binding exists, an unbound key doing nothing, so this
    // is a guard against a later regression rather than a red step.
    const app = await renderApp();
    await settle();

    app.leader("g", "r");
    await settle();

    expect(app.panes()).toBe(1);
    expect(app.reader()).toBeNull();
  });

  it("hands the file in the focused pane to the browser under the name the vault gave it", async () => {
    // A pdf beside the note, so a swapped suffix and the vault's own answer
    // are two different strings. The pane holds the note's path and nothing
    // else, and the file's name is the answer's to give.
    fetchBook.mockImplementation(async (note: string) => beside(note, ".pdf"));
    const caught = clicked();
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    app.leader("g", "r");
    await settle();

    // The reader's own bare key, this pane having no leader. Dispatched on the
    // view so it bubbles to the wrapper's native listener.
    fireEvent.keyDown(app.reader() as Element, { key: "w" });
    await settle();

    expect(caught[0]?.download).toBe("index.pdf");
    // The address that already serves the file, and no blob: the bytes are on
    // disk, not in the page.
    expect(caught[0]?.getAttribute("href")).toBe("/api/assets/index.pdf");
  });

  it("hands nothing over where the reader has not been told what is beside the note", async () => {
    // The reader showing "nothing to read beside", which is the same case as a
    // fetch that has not landed: there is no file to name, and a guess would
    // hand the browser a 404 under a name nobody chose.
    const caught = clicked();
    fetchBook.mockRejectedValue(new Error("GET /api/books/index.md failed with 404"));
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    app.leader("g", "r");
    await settle();

    // On the wrapper rather than on the view, there being no view: the effect
    // opens nothing while the query has answered with an error.
    fireEvent.keyDown(app.readerPane(), { key: "w" });
    await settle();

    expect(caught).toEqual([]);
  });

  it("takes the reader out of its pane and leaves the note pane alone", async () => {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    app.leader("g", "r");
    await settle();
    // Emptying rather than removing, the way a terminal and the todo list are
    // taken out. Without `pane.book` on that branch the key removes the pane.
    app.leader("q");
    await settle();

    expect(app.reader()).toBeNull();
    expect(app.panes()).toBe(2);
    expect(app.text()).toContain("the index note");
  });

  it("closes the pane the focus is in rather than the reader it came from", async () => {
    // Closing acts on the pane the focus is in, not on the reader it came from.
    //
    // The plan filed this as the case pinning `pane.book` in the commands memo.
    // It is not: `movePane` carries `pane.id`, so the memo already recomputes on
    // every move of the focus, and the suite stays green with `pane.book` taken
    // out of the list. What keeps it there is biome's `useExhaustiveDependencies`,
    // which the memo body's read of `pane.book` makes an error to omit.
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    app.leader("g", "r");
    await settle();
    app.leader("%");
    await settle();
    expect(app.panes()).toBe(3);

    app.leader("q");
    await settle();

    expect(app.panes()).toBe(2);
    expect(app.reader()).not.toBeNull();
  });

  it("moves the focus to the reader when a click lands inside the book", async () => {
    // The pane emits the call and the frame test proves it does, but that test
    // mounts no route. Without this a route passing a no-op, or the wrong pane
    // id, keeps every other test green.
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    app.leader("g", "r");
    await settle();
    act(() => lastView().emitLoad());
    app.leader("o");
    await settle();
    expect(app.focusedPane()).toBe(0);

    await act(async () => {
      lastView().section.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });

    expect(app.focusedPane()).toBe(1);
  });
});
