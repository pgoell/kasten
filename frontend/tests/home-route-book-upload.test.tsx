import { cleanup, fireEvent } from "@testing-library/react";
import { useMemo } from "react";
import { type TodoHit, UPLOAD_LIMIT_BYTES } from "@/lib/api";
import { noteBase } from "@/lib/note-base";
import type { PdfRenderer } from "@/lib/pdf-view";
import type { TodoState } from "@/lib/todo/todo";
import { hashed } from "./digests";
import { defineFoliateFake, resetFoliateFake } from "./foliate-fake";
import { FakeEventSource, pageHooks, renderApp, settle, VAULT } from "./home-route-fixture";

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

describe("putting a book in the vault", () => {
  const BOOK = "00 Inbox/02 Books/Talk Like TED.epub";
  const NOTE = "00 Inbox/02 Books/Talk Like TED.md";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue(Object.keys(VAULT));
    fetchNote.mockImplementation(async (path: string) => VAULT[path]);
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
    fetchBook.mockImplementation(async (note: string) => beside(note));
    fetchImages.mockResolvedValue([]);
    fetchHtml.mockResolvedValue([]);
    fetchAssets.mockResolvedValue([]);
    // Re-armed with the rest: `resetAllMocks` takes the answer off them, and a
    // call that hands back undefined instead of a promise throws on `await`.
    uploadAsset.mockResolvedValue(undefined);
    createNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    resetFoliateFake();
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

  /** The picker, with a file chosen in it. */
  function pick(app: Awaited<ReturnType<typeof renderApp>>, name: string, size?: number) {
    const file = new File(["a book"], name);
    if (size !== undefined) Object.defineProperty(file, "size", { value: size });
    app.leader("c", "b");
    app.choose(file);
    return file;
  }

  it("blanks the picker and then opens it", async () => {
    const app = await renderApp();
    await settle();
    const picker = app.picker();
    // The order, recorded through a setter spy. Asserting the value is empty
    // afterwards would pass with the blanking deleted, a file input starting
    // empty, and seeding a non-empty one is refused by the DOM. Blanking
    // matters because an input keeps the last file chosen and picking the same
    // one again may fire no `change` at all, which is a retry doing nothing.
    const order: string[] = [];
    Object.defineProperty(picker, "value", { set: () => order.push("blank") });
    vi.spyOn(picker, "click").mockImplementation(() => {
      order.push("click");
    });

    app.leader("c", "b");

    expect(order).toEqual(["blank", "click"]);
  });

  it("opens the picker with no note in the focused pane", async () => {
    // The book brings its own note, so there is nothing here to be beside.
    // This is the case the first cut of the key refused outright.
    const app = await renderApp();
    await settle();
    const click = vi.spyOn(app.picker(), "click");

    app.leader("c", "b");

    expect(click).toHaveBeenCalledTimes(1);
  });

  it("opens the book picker once the key that asked for it is up", async () => {
    const app = await renderApp();
    await settle();
    const click = vi.spyOn(app.picker(), "click").mockImplementation(() => {});

    app.leader("c");
    app.press("b");

    // Still down: a picker opened now starts while the pointer is hidden.
    expect(click).not.toHaveBeenCalled();
    fireEvent.keyUp(document.querySelector(".cm-content") as HTMLElement, { key: "b" });
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("waits for every held key before it opens the book picker", async () => {
    const app = await renderApp();
    await settle();
    const click = vi.spyOn(app.picker(), "click").mockImplementation(() => {});
    const editorEl = document.querySelector(".cm-content") as HTMLElement;

    app.leader();
    app.press("c");
    app.press("b");
    // `b` is still down when `c` comes up, so the picker must wait for it too.
    fireEvent.keyUp(editorEl, { key: "c" });
    expect(click).not.toHaveBeenCalled();

    fireEvent.keyUp(editorEl, { key: "b" });
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("opens the book picker after a Cmd chord whose key sent no keyup", async () => {
    const app = await renderApp();
    await settle();
    const click = vi.spyOn(app.picker(), "click").mockImplementation(() => {});
    const editorEl = document.querySelector(".cm-content") as HTMLElement;

    // macOS sends no keyup for `s` while Cmd is down, only for Cmd itself.
    fireEvent.keyDown(editorEl, { key: "Meta", code: "MetaLeft", metaKey: true });
    fireEvent.keyDown(editorEl, { key: "s", code: "KeyS", metaKey: true });
    fireEvent.keyUp(editorEl, { key: "Meta", code: "MetaLeft" });
    app.leader("c");
    app.press("b", { code: "KeyB" });

    expect(click).not.toHaveBeenCalled();
    fireEvent.keyUp(editorEl, { key: "b", code: "KeyB" });
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("with vim off, opens the book picker from the tree once the key is up", async () => {
    localStorage.setItem("kasten.vim", "off");
    try {
      const app = await renderApp();
      await settle();
      const click = vi.spyOn(app.picker(), "click").mockImplementation(() => {});
      const tree = app.tree();

      fireEvent.keyDown(tree, { key: " " });
      fireEvent.keyUp(tree, { key: " " });
      fireEvent.keyDown(tree, { key: "c" });
      fireEvent.keyUp(tree, { key: "c" });
      fireEvent.keyDown(tree, { key: "b" });

      expect(click).not.toHaveBeenCalled();
      fireEvent.keyUp(tree, { key: "b" });
      expect(click).toHaveBeenCalledTimes(1);
    } finally {
      localStorage.removeItem("kasten.vim");
    }
  });

  it("keeps the file's own name and puts the pair in the inbox", async () => {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();

    const file = pick(app, "Talk Like TED.epub");
    await settle();

    // Not `index.epub`. The book is not named after whatever note was open.
    expect(uploadAsset).toHaveBeenCalledWith(BOOK, file);
    expect(createNote).toHaveBeenCalledWith(NOTE, "# Talk Like TED\n");
  });

  it("files a pdf apart from the books, under its own suffix", async () => {
    const app = await renderApp();
    await settle();

    const file = pick(app, "Attention Is All You Need.pdf");
    await settle();

    // `02 Documents` and not `02 Books`, the folder being a claim about what
    // the file is. The note goes in beside it, the pair travelling together.
    expect(uploadAsset).toHaveBeenCalledWith(
      "00 Inbox/02 Documents/Attention Is All You Need.pdf",
      file,
    );
    expect(createNote).toHaveBeenCalledWith(
      "00 Inbox/02 Documents/Attention Is All You Need.md",
      "# Attention Is All You Need\n",
    );
  });

  it("refuses a file of a kind the reader cannot open", async () => {
    // The picker's `accept` filters its default view and stops nothing, the
    // reader being free to switch it to all files. An older cut put `.epub` on
    // the name whatever arrived, so this went up as `Ulysses.mobi.epub` and
    // the vault refused it for bytes that did not match a name nobody chose.
    const app = await renderApp();
    await settle();

    pick(app, "Ulysses.mobi");
    await settle();

    expect(uploadAsset).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
    expect(app.notice()).toBe("The vault will not take that name");
  });

  it("opens the note it made, which is the only sign the upload worked", async () => {
    const app = await renderApp();
    await settle();

    pick(app, "Talk Like TED.epub");
    await settle();

    // The heading as the editor draws it: live preview renders the markdown.
    expect(app.text()).toContain("Talk Like TED");
  });

  it("leaves a note that is already there alone", async () => {
    fetchFiles.mockResolvedValue([...Object.keys(VAULT), NOTE]);
    VAULT[NOTE] = "notes I already took";
    const app = await renderApp();
    await settle();

    pick(app, "Talk Like TED.epub");
    await settle();

    expect(createNote).not.toHaveBeenCalled();
    expect(app.text()).toContain("notes I already took");
    delete VAULT[NOTE];
  });

  it("makes no note when the upload was refused", async () => {
    // The book goes up first, so a refusal leaves no orphan note behind.
    const app = await renderApp();
    await settle();
    uploadAsset.mockRejectedValue(new Error("A book is already there"));

    pick(app, "Talk Like TED.epub");
    await settle();

    expect(createNote).not.toHaveBeenCalled();
    expect(app.notice()).toBe("A book is already there");
  });

  it("says something when the failure carries no sentence at all", async () => {
    // A `fetch` rejects on a dropped connection or a suspended tab, and there
    // is no status to name.
    const app = await renderApp();
    await settle();
    uploadAsset.mockRejectedValue("no response");

    pick(app, "Talk Like TED.epub");
    await settle();

    expect(app.notice()).toBe("The upload failed");
  });

  it("refuses a file whose name leaves nothing the vault would take", async () => {
    const app = await renderApp();
    await settle();

    pick(app, "///.epub");
    await settle();

    expect(uploadAsset).not.toHaveBeenCalled();
    expect(app.notice()).toBe("The vault will not take that name");
  });

  it("#521 A5 refuses a book over the cap without sending a byte, naming the limit", async () => {
    const app = await renderApp();
    await settle();

    pick(app, "Talk Like TED.epub", UPLOAD_LIMIT_BYTES + 1);
    await settle();

    expect(app.notice()).toBe("That file is over the 1 GiB upload limit");
    expect(uploadAsset).not.toHaveBeenCalled();
  });

  it("sends a book exactly at the cap", async () => {
    // A guard, not a red step: the check is strictly greater, so the boundary
    // passes either way. It pins the client's own boundary.
    const app = await renderApp();
    await settle();

    const file = pick(app, "Talk Like TED.epub", UPLOAD_LIMIT_BYTES);
    await settle();

    expect(uploadAsset).toHaveBeenCalledWith(BOOK, file);
  });

  it("tells a reader already open on that path about the book that arrived", async () => {
    const app = await renderApp();
    await settle();
    pick(app, "Talk Like TED.epub");
    await settle();
    app.leader("g", "r");
    await settle();
    // The reader opens beside the note and takes the focus with it, so the
    // focus goes back to the note before the key that needs one is pressed.
    app.focusPane(0);
    await settle();
    expect(fetchBook).toHaveBeenCalledTimes(1);

    pick(app, "Talk Like TED.epub");
    await settle();

    // The `listing` event the write fires invalidates `["files"]` alone, so
    // without the invalidation a reader sitting on "no sidecar" would never
    // notice the book that just arrived.
    expect(fetchBook).toHaveBeenCalledTimes(2);
  });

  it("clears the bar on the next press, picker cancelled or not", async () => {
    // A guard: the command already clears it. It earns its place anyway,
    // without it `setNotice(undefined)` can be deleted with every other test
    // still green. Pressing the key and then cancelling the picker wipes the
    // old sentence, because you asked for a fresh go at it.
    const app = await renderApp();
    await settle();
    uploadAsset.mockRejectedValue(new Error("A book is already there"));
    pick(app, "Talk Like TED.epub");
    await settle();
    expect(app.notice()).toBe("A book is already there");

    app.leader("c", "b");
    await settle();

    expect(app.notice()).toBeNull();
  });
});
