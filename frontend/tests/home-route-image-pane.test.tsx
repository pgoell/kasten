import { cleanup, fireEvent } from "@testing-library/react";
import { useMemo } from "react";
import type { TodoHit } from "@/lib/api";
import type { PdfRenderer } from "@/lib/book/pdf-view";
import { noteBase } from "@/lib/note-base";
import type { TodoState } from "@/lib/todo/todo";
import { hashed } from "./digests";
import { defineFoliateFake } from "./foliate-fake";
import {
  clicked,
  FakeEventSource,
  pageHooks,
  renderApp,
  settle,
  stream,
  VAULT,
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

describe("looking at an image", () => {
  const SHOT = "99 Misc/shot.png";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue(Object.keys(VAULT));
    fetchNote.mockImplementation(async (path: string) => VAULT[path]);
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
    fetchImages.mockResolvedValue([SHOT]);
    deleteImage.mockResolvedValue({ entry: `${SHOT}@20260812T180000Z`, path: SHOT, deleted: "" });
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

  it("shows the image in the pane the note was in", async () => {
    const app = await renderApp();
    // Settled first: the listing arrives after the first render, and the row is
    // not in the tree until it does. The folder is drawn from the image's own
    // path, no note living in `99 Misc`.
    await settle();
    app.expand("99 Misc");

    app.click(SHOT);
    await settle();

    expect(app.imagePane()).not.toBeNull();
    expect(app.imagePane()?.querySelector("img")?.getAttribute("src")).toBe(
      `/api/assets/${encodeURI(SHOT)}`,
    );
  });

  it("hands the picture to the browser under its own name", async () => {
    const caught = clicked();
    const app = await renderApp();
    await settle();
    app.expand("99 Misc");
    app.click(SHOT);
    await settle();

    // Into the pane itself, an image pane holding no editor to press into.
    const pane = app.imagePane() as HTMLElement;
    fireEvent.keyDown(pane, { key: " " });
    fireEvent.keyDown(pane, { key: "w" });
    await settle();

    expect(caught[0]?.download).toBe("shot.png");
    expect(caught[0]?.getAttribute("href")).toBe(`/api/assets/${encodeURI(SHOT)}`);
  });

  it("shows and hands over a picture whose name holds # or ?", async () => {
    // Raw, either would end the path: `#` starts a fragment and `?` a query.
    const odd = "99 Misc/plan #2?.png";
    fetchImages.mockResolvedValue([odd]);
    const caught = clicked();
    const app = await renderApp();
    await settle();
    app.expand("99 Misc");
    app.click(odd);
    await settle();

    const encoded = "/api/assets/99%20Misc/plan%20%232%3F.png";
    expect(app.imagePane()?.querySelector("img")?.getAttribute("src")).toBe(encoded);
    const pane = app.imagePane() as HTMLElement;
    fireEvent.keyDown(pane, { key: " " });
    fireEvent.keyDown(pane, { key: "w" });
    await settle();
    expect(caught[0]?.getAttribute("href")).toBe(encoded);
  });

  it("hands the pane back to an editor on the leader then q", async () => {
    const app = await renderApp();
    await settle();
    app.expand("99 Misc");
    app.click(SHOT);
    await settle();

    // Pressed into the pane itself, the image pane holding the focus and there
    // being no `.cm-content` on screen to press into.
    const pane = app.imagePane() as HTMLElement;
    fireEvent.keyDown(pane, { key: " " });
    fireEvent.keyDown(pane, { key: "q" });
    await settle();

    expect(app.imagePane()).toBeNull();
    // Emptied rather than removed: the pane is still there, holding an editor.
    expect(app.text()).toBe("");
  });

  it("takes the image out of the vault on d in the tree, and off the screen", async () => {
    const app = await renderApp();
    await settle();
    app.expand("99 Misc");
    // Walked to with the keys rather than clicked: a click opens a row without
    // moving the tree's own cursor, and `d` acts on the cursor.
    fireEvent.keyDown(app.tree(), { key: "j" });
    fireEvent.keyDown(app.tree(), { key: "Enter" });
    await settle();

    fireEvent.keyDown(app.tree(), { key: "d" });
    fetchImages.mockResolvedValue([]);
    fetchHtml.mockResolvedValue([]);
    fetchAssets.mockResolvedValue([]);
    await settle();

    expect(deleteImage).toHaveBeenCalledWith(SHOT);
    // Emptied rather than left showing a picture the vault no longer has.
    expect(app.imagePane()).toBeNull();
    expect(app.tree().textContent).not.toContain("shot.png");
  });

  it("refetches the listing when the vault says a file that is not a note changed", async () => {
    const app = await renderApp();
    await settle();
    fetchImages.mockResolvedValue([SHOT, "99 Misc/another.png"]);

    // What an image pasted anywhere, or dropped in over a terminal, arrives as.
    stream().send({ path: "", change: "listing", digest: null });
    await settle();

    app.expand("99 Misc");
    expect(app.tree().textContent).toContain("another.png");
  });
});
