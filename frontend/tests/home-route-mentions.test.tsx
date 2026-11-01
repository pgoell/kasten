import { EditorView } from "@codemirror/view";
import { fireEvent, screen } from "@testing-library/react";
import { useMemo } from "react";
import type { TodoHit } from "@/lib/api";
import type { PdfRenderer } from "@/lib/book/pdf-view";
import { holdText } from "@/lib/held-text";
import { noteBase } from "@/lib/note-base";
import type { TodoState } from "@/lib/todo/todo";
import { hashed } from "./digests";
import { defineFoliateFake } from "./foliate-fake";
import { act, outside, pageHooks, renderApp, settle, theRoute, VAULT } from "./home-route-fixture";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";
import { updateWithTries } from "./update-note/stand-in";

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

    it("#424 links the mention on ctrl enter with vim on, and a clean pane on the note reloads", async () => {
      const app = await renderApp();
      await settle();
      // other.md open and clean in a pane of its own, beside the one that asks.
      app.click("other.md");
      await settle();
      app.leader("%");
      await settle();
      await backlinks(app);
      fetchMentions.mockClear();

      await link();

      expect(saveNote).toHaveBeenCalledWith(
        "other.md",
        "see the [[index]] here",
        false,
        noteBase(NAMES),
      );
      expect(app.cached("other.md")).toBe("see the [[index]] here");
      // Asked again, so the row leaves the unlinked group.
      expect(fetchMentions).toHaveBeenCalledWith("index.md", false);
      expect(said()).toBe("nothing links here");
      // Off the editor's text and not the screen, where live preview hides the
      // brackets and the line before and after reads the same.
      const docs = [...document.querySelectorAll<HTMLElement>(".cm-content")].map((each) =>
        EditorView.findFromDOM(each)?.state.doc.toString(),
      );
      expect(docs).toContain("see the [[index]] here");
    });

    it("#424 links on a tap of the link button with vim off in a narrow window", async () => {
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
        fireEvent.click(screen.getByRole("option", { name: /^Show what links here/ }));
        await settle();
        const button = screen.getByRole("button", { name: "link" });
        expect(button).toHaveClass("pointer-coarse:min-h-11");
        fireEvent.mouseDown(button);
        fireEvent.click(button);
        await hashed();
        await settle();
      } finally {
        localStorage.removeItem("kasten.vim");
      }

      expect(saveNote).toHaveBeenCalledWith(
        "other.md",
        "see the [[index]] here",
        false,
        noteBase(NAMES),
      );
    });

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

    it("#424 writes nothing while a write of the note's own text is still out, and says why", async () => {
      // other.md typed into in one pane, its quiet write hanging, and the focus
      // gone to index.md in the other: the tail the focus guard cannot see.
      const app = await renderApp();
      await settle();
      app.click("other.md");
      await settle();
      app.leader("%");
      await settle();
      app.click("index.md");
      await settle();
      const panes = () => [...document.querySelectorAll<HTMLElement>(".cm-content")];
      const holding = (text: string) =>
        panes().find((each) => EditorView.findFromDOM(each)?.state.doc.toString() === text);
      const other = holding(NAMES) as HTMLElement;
      const index = holding("the index note") as HTMLElement;
      other.focus();
      await settle();
      fireEvent.keyDown(other, { key: "x" });
      saveNote.mockImplementationOnce(() => new Promise(() => {}));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      await hashed();
      await settle();
      expect(saveNote).toHaveBeenCalledTimes(1);
      index.focus();
      await settle();
      for (const key of [" ", "g", "b"]) fireEvent.keyDown(index, { key });
      await settle();
      fetchNote.mockClear();

      await link();

      expect(fetchNote).not.toHaveBeenCalled();
      expect(saveNote).toHaveBeenCalledTimes(1);
      expect(said()).toBe("That note is still being saved");
    });

    it("#424 writes nothing into a note holding text not yet saved, and says why", async () => {
      holdText("other.md", {
        content: "see the index here, typed",
        reason: "PUT failed with 500",
        conflicted: false,
      });
      const app = await renderApp();
      await settle();
      await backlinks(app);

      await link();

      expect(saveNote).not.toHaveBeenCalled();
      expect(said()).toBe("That note holds text not yet saved");
      expect(screen.getByRole("button", { name: "link" })).toBeInTheDocument();
    });

    it("#424 writes nothing when the line changed since the list was read, and says why", async () => {
      const app = await renderApp();
      await settle();
      await backlinks(app);
      fetchNote.mockImplementation(async (path: string) =>
        path === "other.md" ? "see the index here, and more" : VAULT[path],
      );

      await link();

      expect(saveNote).not.toHaveBeenCalled();
      expect(said()).toBe("That line has changed since it was listed");
    });

    it("#424 lands nothing over a write that came between its read and its write", async () => {
      const app = await renderApp();
      await settle();
      await backlinks(app);
      // On disk, unseen by the read: the base the link names is refused.
      outside.set("other.md", "somebody else's other note");

      await link();

      expect(outside.get("other.md")).toBe("somebody else's other note");
      expect(said()).toBe("The link was not written");
      expect(screen.getByRole("button", { name: "link" })).toBeInTheDocument();
    });

    /**
     * A write lands on other.md between the link's first read and its write:
     * the first read answers the text from before, every later one the disk.
     * `updateNote` runs its real three tries here, since the refusal and the
     * read after it are the ordering under test.
     */
    function writtenBetween(disk: string) {
      outside.set("other.md", disk);
      fetchNote.mockImplementationOnce(async () => NAMES);
      fetchNote.mockImplementation(async (path: string) =>
        path === "other.md" ? outside.get(path) : VAULT[path],
      );
      updateNote.mockImplementation(updateWithTries(fetchNote, saveNote));
    }

    it("#424 links on the read after a refusal when the line still says the same", async () => {
      const app = await renderApp();
      await settle();
      await backlinks(app);
      writtenBetween(`${NAMES}\nadded by somebody else`);

      await link();

      expect(saveNote).toHaveBeenLastCalledWith(
        "other.md",
        "see the [[index]] here\nadded by somebody else",
        false,
        noteBase(`${NAMES}\nadded by somebody else`),
      );
      expect(outside.get("other.md")).toBe("see the [[index]] here\nadded by somebody else");
      expect(said()).not.toBe("The link was not written");
    });

    it("#424 writes nothing on the read after a refusal when the line changed", async () => {
      const app = await renderApp();
      await settle();
      await backlinks(app);
      writtenBetween("see the index there");

      await link();

      expect(outside.get("other.md")).toBe("see the index there");
      expect(saveNote).toHaveBeenCalledTimes(1);
      expect(said()).toBe("That line has changed since it was listed");
    });
  });
});
