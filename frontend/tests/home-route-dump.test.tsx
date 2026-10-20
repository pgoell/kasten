import { cleanup, fireEvent, screen } from "@testing-library/react";
import { useMemo } from "react";
import type { TodoHit } from "@/lib/api";
import { readClock } from "@/lib/clock";
import { noteBase } from "@/lib/note-base";
import type { PdfRenderer } from "@/lib/pdf-view";
import type { TodoState } from "@/lib/todo";
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

describe("capturing into today's dump", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue(Object.keys(VAULT));
    fetchNote.mockImplementation(async (path: string) => VAULT[path]);
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
    outbox.keep.mockImplementation(async (text: string, date: string) => ({
      id: "kept",
      text,
      date,
      typedAt: 1,
    }));
    outbox.flush.mockResolvedValue({ waiting: [], failure: null });
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

  /** The prompt's own input, which is not the only one the route mounts. */
  const field = () => screen.getByLabelText("dump");

  it("sends the thought for today on Enter, and says it landed", async () => {
    const app = await renderApp();
    await settle();

    app.leader("c", "d");
    fireEvent.change(field(), { target: { value: "ask Jonas about the flat" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    await settle();

    expect(outbox.keep).toHaveBeenCalledWith(
      "ask Jonas about the flat",
      readClock(new Date()).date,
    );
    expect(outbox.flush).toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Capture a thought" })).toBeNull();
    expect(app.notice()).toBe("Captured into today's dump");
  });

  it("says the thought waits, and how many do, when it cannot be sent", async () => {
    const earlier = { id: "earlier", text: "an older one", date: "2026-10-15", typedAt: 0 };
    outbox.flush.mockImplementation(async () => ({
      waiting: [earlier, { id: "kept", text: "a thought", date: "2026-10-16", typedAt: 1 }],
      failure: { kind: "offline" },
    }));
    const app = await renderApp();
    await settle();

    app.leader("c", "d");
    fireEvent.change(field(), { target: { value: "a thought" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    await settle();

    expect(app.notice()).toBe("Captured, waiting to send (2 waiting)");
  });

  it.each([
    [
      "the vault's refusal when it refused the thought",
      {
        waiting: [{ id: "kept", text: "t", date: "d", typedAt: 1, refused: "Nothing to capture" }],
        failure: null,
      },
      "Nothing to capture",
    ],
    [
      "to sign in again when the proxy turned it away",
      { waiting: [{ id: "kept", text: "t", date: "d", typedAt: 1 }], failure: { kind: "sign-in" } },
      "Captured, waiting to send: sign in again",
    ],
  ])("says %s", async (_name, state, notice) => {
    outbox.flush.mockResolvedValue(state);
    const app = await renderApp();
    await settle();

    app.leader("c", "d");
    fireEvent.change(field(), { target: { value: "a thought" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    await settle();

    expect(app.notice()).toBe(notice);
  });

  it("puts the reason where the confirmation would have been when the thought cannot be kept", async () => {
    outbox.keep.mockRejectedValue(new Error("The quota has been exceeded"));
    const app = await renderApp();
    await settle();

    app.leader("c", "d");
    fireEvent.change(field(), { target: { value: "a thought" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    await settle();

    expect(app.notice()).toBe("The quota has been exceeded");
    expect(outbox.flush).not.toHaveBeenCalled();
  });

  it("writes nothing when Escape closes it", async () => {
    const app = await renderApp();
    await settle();

    app.leader("c", "d");
    fireEvent.change(field(), { target: { value: "half a thought" } });
    fireEvent.keyDown(field(), { key: "Escape" });
    await settle();

    expect(outbox.keep).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Capture a thought" })).toBeNull();
  });
});
