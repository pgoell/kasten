import { EditorView } from "@codemirror/view";
import { fireEvent, screen } from "@testing-library/react";
import { useMemo } from "react";
import type { TodoHit } from "@/lib/api";
import { holdText } from "@/lib/held-text";
import { noteBase } from "@/lib/note-base";
import type { PdfRenderer } from "@/lib/pdf-view";
import type { TodoState } from "@/lib/todo";
import { hashed } from "./digests";
import { defineFoliateFake } from "./foliate-fake";
import {
  act,
  outside,
  pageHooks,
  renderApp,
  settle,
  stream,
  theRoute,
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

  describe("a note's history", () => {
    /** index.md as the one change in its history held it. */
    const BEFORE = "the index note, as it was";
    const COMMIT = "c".repeat(40);

    beforeEach(() => {
      fetchHistory.mockResolvedValue({
        versioned: true,
        changes: [
          {
            commit: COMMIT,
            change: "kxyzkxyz",
            time: "2026-10-16T09:30:00+02:00",
            description: "an older index",
            path: "index.md",
          },
        ],
      });
      fetchHistoryText.mockResolvedValue(BEFORE);
    });

    const historyPane = () => document.querySelector<HTMLElement>("[data-history-pane]");
    const said = () => historyPane()?.querySelector("output")?.textContent ?? "";

    /** index.md open, then its history beside it with `gh`, the diff drawn. */
    async function history(app: Awaited<ReturnType<typeof renderApp>>) {
      app.click("index.md");
      await settle();
      app.leader("g", "h");
      await settle();
      expect(historyPane()).not.toBeNull();
      expect(screen.getByTestId("history-diff")).toHaveTextContent(BEFORE);
    }

    /** Ctrl+Enter in the pane, and the write it starts settled. */
    async function restore() {
      fireEvent.keyDown(historyPane() as HTMLElement, { key: "Enter", ctrlKey: true });
      await hashed();
      await settle();
    }

    it("#425 A1 gh opens the note's history beside it, listing its changes", async () => {
      const app = await renderApp();
      await settle();

      await history(app);

      expect(app.panes()).toBe(2);
      expect(app.focusedPane()).toBe(1);
      expect(fetchHistory).toHaveBeenCalledWith("index.md");
      expect(screen.getByRole("option")).toHaveTextContent("an older index");
    });

    it("#425 A4 A5 I3 restores on ctrl enter with vim on, and a clean pane on the note reloads", async () => {
      const app = await renderApp();
      await settle();
      await history(app);
      fetchHistory.mockClear();

      await restore();

      expect(saveNote).toHaveBeenCalledTimes(1);
      expect(saveNote).toHaveBeenCalledWith(
        "index.md",
        BEFORE,
        false,
        noteBase("the index note"),
        "kxyzkxyz",
      );
      expect(app.cached("index.md")).toBe(BEFORE);
      // Asked again, so the change the restore made shows at the top.
      expect(fetchHistory).toHaveBeenCalledWith("index.md");
      expect(said()).toBe("This change is the note as it is now");
      const docs = [...document.querySelectorAll<HTMLElement>(".cm-content")].map((each) =>
        EditorView.findFromDOM(each)?.state.doc.toString(),
      );
      expect(docs).toContain(BEFORE);
    });

    it("#425 A1 A4 restores on a tap with vim off in a narrow window with one pane", async () => {
      localStorage.setItem("kasten.vim", "off");
      try {
        const media = stubMatchMedia();
        const app = await renderApp();
        await settle();
        app.click("index.md");
        await settle();
        media.set(NARROW, true);
        media.set(COARSE, true);

        fireEvent.click(screen.getByRole("button", { name: "Run a command by name" }));
        fireEvent.click(screen.getByRole("option", { name: /^Show this note's history/ }));
        await settle();
        // One pane drawn: the history, the note hidden behind it.
        const shown = [...document.querySelectorAll("[data-pane]")].filter(
          (each) => !each.classList.contains("hidden"),
        );
        expect(shown).toHaveLength(1);
        expect(shown[0]).toContainElement(historyPane());
        const button = screen.getByRole("button", { name: "Restore" });
        expect(button).toHaveClass("pointer-coarse:min-h-11");
        fireEvent.click(button);
        await hashed();
        await settle();
      } finally {
        localStorage.removeItem("kasten.vim");
      }

      expect(saveNote).toHaveBeenCalledWith(
        "index.md",
        BEFORE,
        false,
        noteBase("the index note"),
        "kxyzkxyz",
      );
    });

    it("#425 I2 writes nothing while the flush of text typed into the note is in the air", async () => {
      const app = await renderApp();
      await settle();
      app.click("index.md");
      await settle();
      // Typed, and `gh` at once: leaving the note flushes the typing, and that
      // write is still out when ctrl+enter comes.
      app.press("x");
      saveNote.mockImplementationOnce(() => new Promise(() => {}));
      app.leader("g", "h");
      await hashed();
      await settle();
      expect(saveNote).toHaveBeenCalledTimes(1);

      await restore();

      expect(saveNote).toHaveBeenCalledTimes(1);
      expect(said()).toBe("That note is still being saved");
    });

    it("#425 I2 writes nothing into a note holding text not yet saved", async () => {
      const app = await renderApp();
      await settle();
      await history(app);
      holdText("index.md", {
        content: "the index note, typed",
        reason: "PUT failed with 500",
        conflicted: false,
      });

      await restore();

      expect(saveNote).not.toHaveBeenCalled();
      expect(said()).toBe("That note holds text not yet saved");
    });

    it("#425 I2 writes nothing into the note while its pane has the focus", async () => {
      const app = await renderApp();
      await settle();
      await history(app);
      app.focusPane(0);
      await settle();
      expect(app.focusedPane()).toBe(0);

      fireEvent.click(screen.getByRole("button", { name: "Restore" }));
      await hashed();
      await settle();

      expect(saveNote).not.toHaveBeenCalled();
      expect(said()).toBe("That note is open to type in");
    });

    it("#425 A5 lands nothing over a write the diff did not see, and reads the note again", async () => {
      const app = await renderApp();
      await settle();
      await history(app);
      outside.set("index.md", "somebody else's index");
      fetchNote.mockImplementation(async (path: string) => outside.get(path) ?? VAULT[path]);

      await restore();

      expect(saveNote).toHaveBeenCalledTimes(1);
      expect(outside.get("index.md")).toBe("somebody else's index");
      expect(said()).toBe("The note changed since this diff was drawn");
      expect(screen.getByTestId("history-diff")).toHaveTextContent("somebody else's index");
    });

    it("#425 A4 restores on ctrl enter with vim off", async () => {
      localStorage.setItem("kasten.vim", "off");
      try {
        const app = await renderApp();
        await settle();
        app.click("index.md");
        await settle();
        // No leader with vim off: the palette, by its chord on a desktop.
        app.press("P", { keyCode: 80, ctrlKey: true, shiftKey: true });
        await settle();
        fireEvent.click(screen.getByRole("option", { name: /^Show this note's history/ }));
        await settle();
        expect(screen.getByTestId("history-diff")).toHaveTextContent(BEFORE);

        await restore();
      } finally {
        localStorage.removeItem("kasten.vim");
      }

      expect(saveNote).toHaveBeenCalledTimes(1);
      expect(saveNote).toHaveBeenCalledWith(
        "index.md",
        BEFORE,
        false,
        noteBase("the index note"),
        "kxyzkxyz",
      );
    });

    it("#425 A a restore names the change it restores from, so it lands as a change of its own", async () => {
      const app = await renderApp();
      await settle();
      await history(app);

      await restore();

      expect(saveNote).toHaveBeenCalledTimes(1);
      expect(saveNote.mock.calls[0]?.[4]).toBe("kxyzkxyz");
    });

    it("#425 closes the history pane when its note is deleted", async () => {
      deleteNote.mockResolvedValue({
        entry: "index.md@2026-10-17T10-00-00.000000",
        path: "index.md",
        deleted: "2026-10-17T10:00:00Z",
      });
      const app = await renderApp();
      await settle();
      await history(app);
      app.focusPane(0);
      await settle();

      app.leader("d", "f");
      await settle();

      expect(deleteNote).toHaveBeenCalledWith("index.md");
      expect(historyPane()).toBeNull();
    });

    it("#425 I6 reads the list again when the note is written elsewhere", async () => {
      const app = await renderApp();
      await settle();
      await history(app);
      fetchHistory.mockClear();

      act(() => stream().send({ path: "index.md", change: "written", digest: "a".repeat(64) }));
      await settle();

      expect(fetchHistory).toHaveBeenCalledWith("index.md");
    });
  });
});
