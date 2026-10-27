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

describe("importing markdown and taking it out again", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue(Object.keys(VAULT));
    fetchNote.mockImplementation(async (path: string) => VAULT[path]);
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
    createNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    // jsdom implements neither, an object URL having no meaning without a
    // network stack behind it, so the download names them itself.
    URL.createObjectURL = vi.fn(() => BLOB_URL);
    URL.revokeObjectURL = vi.fn();
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

  const BLOB_URL = "blob:the-note";

  it("blanks the markdown picker and then opens it", async () => {
    const app = await renderApp();
    await settle();
    // The same order the book's picker is opened in, and for the same reason:
    // an input keeps the last file chosen, and picking it again may fire no
    // `change` at all, which is a second attempt doing nothing.
    const order: string[] = [];
    Object.defineProperty(app.notePicker(), "value", { set: () => order.push("blank") });
    vi.spyOn(app.notePicker(), "click").mockImplementation(() => {
      order.push("click");
    });

    app.leader("c", "m");

    expect(order).toEqual(["blank", "click"]);
  });

  it("opens the markdown picker once the key that asked for it is up", async () => {
    const app = await renderApp();
    await settle();
    const click = vi.spyOn(app.notePicker(), "click").mockImplementation(() => {});

    app.leader("c");
    app.press("m");

    expect(click).not.toHaveBeenCalled();
    fireEvent.keyUp(document.querySelector(".cm-content") as HTMLElement, { key: "m" });
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("keeps each file's own name and puts them all in the inbox", async () => {
    const app = await renderApp();
    await settle();

    app.chooseNotes([
      new File(["what Borges said"], "Borges.md"),
      new File(["and what he wrote"], "Ficciones.md"),
    ]);
    await settle();

    expect(createNote).toHaveBeenCalledWith("00 Inbox/Borges.md", "what Borges said");
    expect(createNote).toHaveBeenCalledWith("00 Inbox/Ficciones.md", "and what he wrote");
  });

  it("opens the first of them, which is the only sign the import worked", async () => {
    const app = await renderApp();
    await settle();

    app.chooseNotes([new File(["what Borges said"], "Borges.md")]);
    await settle();

    expect(app.text()).toContain("what Borges said");
  });

  it("carries on past a file the vault refused, and says one went", async () => {
    // The case the whole loop exists for. A batch that stopped on the first
    // collision would leave the reader picking the rest of the folder by hand.
    createNote.mockImplementation(async (path: string, content: string) => {
      if (path === "00 Inbox/Borges.md") throw new Error("A note is already there");
      return { path, content };
    });
    const app = await renderApp();
    await settle();

    app.chooseNotes([
      new File(["what Borges said"], "Borges.md"),
      new File(["and what he wrote"], "Ficciones.md"),
    ]);
    await settle();

    expect(createNote).toHaveBeenCalledWith("00 Inbox/Ficciones.md", "and what he wrote");
    expect(app.notice()).toBe("A note is already there");
    // The one that landed, not the one that was picked first.
    expect(app.text()).toContain("and what he wrote");
  });

  it("hands the open note to the browser as a file under its own name", async () => {
    const caught = clicked();
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();

    app.leader("w");
    await settle();

    expect(caught[0]?.download).toBe("index.md");
    expect(caught[0]?.href).toBe(BLOB_URL);
  });

  it("downloads the text as the buffer holds it, not as the vault last read it", async () => {
    // The save the key runs first. Without it the file carries the note from
    // before the last keystroke, which is the one thing a download must not do.
    clicked();
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    // `x` deletes the character under the cursor, which opens at the top.
    app.press("x");
    await settle();

    app.leader("w");
    await hashed();
    await settle();

    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0] as Blob;
    expect(await blob.text()).toBe("he index note");
  });

  it("gives the object URL back rather than holding the note until the tab closes", async () => {
    clicked();
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();

    app.leader("w");
    await settle();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(BLOB_URL);
  });

  it("does nothing at all with no note in the focused pane", async () => {
    const caught = clicked();
    const app = await renderApp();
    await settle();

    app.leader("w");
    await settle();

    expect(caught).toEqual([]);
  });
});
