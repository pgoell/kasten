import { fireEvent, screen } from "@testing-library/react";
import { useMemo } from "react";
import type { TodoHit } from "@/lib/core/api";
import { noteBase } from "@/lib/notes/note-base";
import type { PdfRenderer } from "@/lib/panes/book/pdf-view";
import type { TodoState } from "@/lib/todo/todo";
import { hashed } from "./digests";
import { defineFoliateFake } from "./foliate-fake";
import { pageHooks, renderApp, settle, theRoute, VAULT } from "./home-route-fixture";

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
const pdfPaneRenderer = vi.hoisted(() => ({ current: null as PdfRenderer | null }));
vi.mock("@/lib/panes/book/pdf-view", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/panes/book/pdf-view")>();
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
vi.mock("@/components/todo/todo-pane", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/todo/todo-pane")>();
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
vi.mock("@/lib/capture/outbox", () => outbox);
vi.mock("@/lib/search/fuzzy", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/search/fuzzy")>();
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

  describe("linking an unlinked mention", () => {
    /** What other.md says in these tests: it names index in plain words. */
    const NAMES = "see the index here";
    const MENTION = {
      path: "other.md",
      line: 1,
      text: NAMES,
      start: 8,
      end: 13,
      name: "index",
    };

    beforeEach(() => {
      fetchNote.mockImplementation(async (path: string) =>
        path === "other.md" ? NAMES : VAULT[path],
      );
      searchNotes.mockResolvedValue([]);
      fetchMentions.mockResolvedValue([MENTION]);
    });

    /** Open index.md and its backlinks, the way a reader does with vim on. */
    async function backlinks(app: Awaited<ReturnType<typeof renderApp>>) {
      app.click("index.md");
      await settle();
      app.leader("g", "b");
      await settle();
      expect(screen.getByRole("group", { name: "unlinked mentions" })).toBeInTheDocument();
    }

    /** Ctrl+Enter in the panel's input, and the write it starts settled. */
    async function link() {
      fireEvent.keyDown(screen.getByLabelText("backlinks"), { key: "Enter", ctrlKey: true });
      await hashed();
      await settle();
    }

    /** What the panel's line under the list says. */
    const said = () =>
      screen.getByRole("dialog", { name: "Backlinks" }).querySelector("output")?.textContent;

    it("#424 writes nothing into the focused note and says why", async () => {
      // The backend leaves the note itself out, so this is the guard alone.
      fetchMentions.mockResolvedValue([
        { path: "index.md", line: 1, text: "the index note", start: 4, end: 9, name: "index" },
      ]);
      const app = await renderApp();
      await settle();
      await backlinks(app);
      fetchNote.mockClear();

      await link();

      expect(fetchNote).not.toHaveBeenCalled();
      expect(saveNote).not.toHaveBeenCalled();
      expect(said()).toBe("That note is open to type in");
    });
  });
});
