import { fireEvent } from "@testing-library/react";
import { useMemo } from "react";
import type { TodoHit, TodoRow } from "@/lib/core/api";
import { noteBase } from "@/lib/notes/note-base";
import type { PdfRenderer } from "@/lib/panes/book/pdf-view";
import type { TodoState } from "@/lib/todo/todo";
import { defineFoliateFake } from "./foliate-fake";
import { act, pageHooks, renderApp, settle, theRoute, VAULT } from "./home-route-fixture";

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
  patchTodo,
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
    patchTodo: vi.fn(),
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
  patchTodo,
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

  describe("refiling a todo into its project's note", () => {
    const DAILY = "daily.md";
    const PROJECT = "02 Projects/FDE";
    const TARGET = "02 Projects/FDE/index.md";
    const STORED = { id: "kt-aaaaaa", version: 3, parent_id: null } as TodoRow;
    const ROW: TodoHit = {
      path: DAILY,
      line: 1,
      text: "- [ ] send the deck 🆔 kt-aaaaaa",
      project: PROJECT,
      shared: false,
      todo: STORED,
    };

    beforeEach(() => {
      fetchFiles.mockImplementation(async () => Object.keys(VAULT));
      fetchTodos.mockResolvedValue([ROW]);
      patchTodo.mockReset();
      patchTodo.mockResolvedValue([]);
    });

    /** `<leader>gt`, then `m` on the first row, and the write it starts settled. */
    async function refile(app: Awaited<ReturnType<typeof renderApp>>) {
      app.leader("g", "t");
      await settle();
      const pane = app.todoPane() as HTMLElement;
      pane.focus();
      fireEvent.keyDown(pane, { key: "m" });
      await settle();
    }

    it("#2191 m moves the todo into its project's note in the store, at the version listed", async () => {
      const app = await renderApp();
      await settle();

      await refile(app);

      expect(patchTodo).toHaveBeenCalledExactlyOnceWith("kt-aaaaaa", {
        version: 3,
        project: PROJECT,
        note: TARGET,
      });
      expect(saveNote).not.toHaveBeenCalled();
      expect(app.notice()).toBe(`Moved into ${TARGET}`);
    });

    it("#2191 a part leaves its parent as it moves", async () => {
      fetchTodos.mockResolvedValue([{ ...ROW, todo: { ...STORED, parent_id: "kt-bbbbbb" } }]);
      const app = await renderApp();
      await settle();

      await refile(app);

      expect(patchTodo).toHaveBeenCalledExactlyOnceWith("kt-aaaaaa", {
        version: 3,
        project: PROJECT,
        note: TARGET,
        parent_id: null,
      });
    });

    it("#2191 a move the store refuses says why", async () => {
      patchTodo.mockRejectedValue(new Error("kt-aaaaaa changed since it was read: read it again."));
      const app = await renderApp();
      await settle();

      await refile(app);

      expect(app.notice()).toBe(
        "Nothing moved: kt-aaaaaa changed since it was read: read it again.",
      );
    });

    it("#396 I5 a todo with no project moves nothing, and names p and a #p/x tag", async () => {
      fetchTodos.mockResolvedValue([{ ...ROW, project: null }]);
      const app = await renderApp();
      await settle();

      await refile(app);

      expect(patchTodo).not.toHaveBeenCalled();
      expect(app.notice()).toBe("That todo has no project: give it one with p or a #p/x tag");
    });

    it("#396 I7 a todo already in its project's note stays", async () => {
      fetchTodos.mockResolvedValue([{ ...ROW, path: TARGET }]);
      const app = await renderApp();
      await settle();

      await refile(app);

      expect(patchTodo).not.toHaveBeenCalled();
      expect(app.notice()).toBe("That todo is in its project's note already");
    });

    it("#397 A2 a card dropped on another project lane moves into that project's note", async () => {
      const app = await renderApp();
      await settle();
      app.leader("g", "t");
      await settle();

      act(() => paneProps.current?.onRefile({ ...ROW, project: null }, "02 Projects/Other"));
      await settle();

      expect(patchTodo).toHaveBeenCalledExactlyOnceWith("kt-aaaaaa", {
        version: 3,
        project: "02 Projects/Other",
        note: "02 Projects/Other/index.md",
      });
    });
  });
});
