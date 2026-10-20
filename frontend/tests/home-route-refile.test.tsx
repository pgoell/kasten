import { EditorView } from "@codemirror/view";
import { fireEvent } from "@testing-library/react";
import { useMemo } from "react";
import type { TodoHit } from "@/lib/api";
import { holdText } from "@/lib/held-text";
import { noteBase } from "@/lib/note-base";
import type { PdfRenderer } from "@/lib/pdf-view";
import type { TodoState } from "@/lib/todo";
import { hashed } from "./digests";
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

  describe("refiling a todo into its project's note", () => {
    const DAILY = "daily.md";
    const PROJECT = "02 Projects/FDE";
    const TARGET = "02 Projects/FDE/index.md";
    /** A todo with a part, and one after it that stays. */
    const SOURCE = ["## TODOs", "- [ ] send the deck", "  - [ ] draw the chart", "- [ ] buy milk"];
    const PROJECT_NOTE = "# FDE\n\n## TODOs\n- [ ] old";
    const ROW = { path: DAILY, line: 2, text: "- [ ] send the deck", project: PROJECT };
    const MOVED =
      "Moved into 02 Projects/FDE/index.md. The history pane's restore on both notes takes it back";

    /** What the vault holds, which a test changes to move a note under the press. */
    let notes: Record<string, string>;

    beforeEach(() => {
      notes = { ...VAULT, [DAILY]: SOURCE.join("\n"), [TARGET]: PROJECT_NOTE };
      fetchFiles.mockImplementation(async () => Object.keys(notes));
      fetchNote.mockImplementation(async (path: string) => notes[path]);
      fetchTodos.mockResolvedValue([ROW]);
    });

    /** The paths saved, in the order they went out. */
    const saved = () => saveNote.mock.calls.map(([path]) => path);

    /** `<leader>gt`, then `m` on the first row, and the writes it starts settled. */
    async function refile(app: Awaited<ReturnType<typeof renderApp>>) {
      app.leader("g", "t");
      await settle();
      const pane = app.todoPane() as HTMLElement;
      pane.focus();
      fireEvent.keyDown(pane, { key: "m" });
      await hashed();
      await settle();
    }

    it("#396 A1 I1 I2 I8 writes the project's note first, then the daily note, once each", async () => {
      const app = await renderApp();
      await settle();

      await refile(app);

      expect(saved()).toEqual([TARGET, DAILY]);
      expect(saveNote).toHaveBeenCalledWith(
        TARGET,
        `${PROJECT_NOTE}\n- [ ] send the deck\n  - [ ] draw the chart`,
        false,
        noteBase(PROJECT_NOTE),
      );
      expect(saveNote).toHaveBeenCalledWith(
        DAILY,
        ["## TODOs", "- send the deck [[02 Projects/FDE/index|FDE]]", "- [ ] buy milk"].join("\n"),
        false,
        noteBase(SOURCE.join("\n")),
      );
      expect(app.cached(TARGET)).toBe(
        `${PROJECT_NOTE}\n- [ ] send the deck\n  - [ ] draw the chart`,
      );
      expect(app.notice()).toBe(MOVED);
    });

    it("#396 I1 a project's note that is not written moves nothing, and says so", async () => {
      saveNote.mockRejectedValueOnce(new Error("PUT failed with 500"));
      const app = await renderApp();
      await settle();

      await refile(app);

      expect(saved()).toEqual([TARGET]);
      expect(app.notice()).toBe("Nothing moved: 02 Projects/FDE/index.md was not written");
    });

    it("#396 I1 a daily note whose write fails keeps the todo in both, and says so", async () => {
      saveNote.mockImplementation(async (path: string, content: string) => {
        if (path === DAILY) throw new Error("PUT failed with 500");
        return { path, content };
      });
      const app = await renderApp();
      await settle();

      await refile(app);

      expect(saved()).toEqual([TARGET, DAILY]);
      expect(app.notice()).toBe(
        "Copied into 02 Projects/FDE/index.md; daily.md was not written, so check daily.md before pressing again",
      );
    });

    it("#396 I3 a part changed under the move keeps the todo in both, and says so", async () => {
      const app = await renderApp();
      await settle();
      // Changed after the press read it and before its second write did.
      saveNote.mockImplementationOnce(async (path: string, content: string) => {
        notes[DAILY] = SOURCE.join("\n").replace("draw the chart", "draw the chart, bigger");
        return { path, content };
      });

      await refile(app);

      expect(saved()).toEqual([TARGET]);
      expect(app.notice()).toBe(
        "Copied into 02 Projects/FDE/index.md; daily.md changed, so check daily.md before pressing again",
      );
    });

    it("#396 I3 a second m after a half move takes the todo out without a second copy", async () => {
      const head = "- [ ] send the deck 🆔 kt-000001";
      notes[DAILY] = SOURCE.join("\n").replace("- [ ] send the deck", head);
      notes[TARGET] = `${PROJECT_NOTE}\n${head}\n  - [ ] draw the chart`;
      fetchTodos.mockResolvedValue([{ ...ROW, text: head }]);
      const app = await renderApp();
      await settle();

      await refile(app);

      expect(saved()).toEqual([DAILY]);
      expect(app.notice()).toBe(MOVED);
    });

    it("#396 B1 another todo of the same words in the project's note does not stand for this one", async () => {
      // A recurring todo's earlier copy: no id, so the press cannot tell, and
      // a second copy is the cost where the other way loses the part.
      notes[TARGET] = `${PROJECT_NOTE}\n- [ ] send the deck`;
      const app = await renderApp();
      await settle();

      await refile(app);

      expect(saved()).toEqual([TARGET, DAILY]);
      expect(saveNote).toHaveBeenCalledWith(
        TARGET,
        `${PROJECT_NOTE}\n- [ ] send the deck\n- [ ] send the deck\n  - [ ] draw the chart`,
        false,
        noteBase(notes[TARGET] as string),
      );
    });

    it("#396 B3 two presses back to back on todos of one note move both", async () => {
      // The vault keeps what is written, so the second press reads the first's.
      saveNote.mockImplementation(async (path: string, content: string) => {
        notes[path] = content;
        return { path, content };
      });
      fetchTodos.mockResolvedValue([
        ROW,
        { path: DAILY, line: 4, text: "- [ ] buy milk", project: PROJECT },
      ]);
      const app = await renderApp();
      await settle();
      app.leader("g", "t");
      await settle();
      const pane = app.todoPane() as HTMLElement;
      pane.focus();

      fireEvent.keyDown(pane, { key: "m" });
      fireEvent.keyDown(pane, { key: "j" });
      fireEvent.keyDown(pane, { key: "m" });
      await hashed();
      await settle();

      expect(notes[DAILY]).toBe(
        [
          "## TODOs",
          "- send the deck [[02 Projects/FDE/index|FDE]]",
          "- buy milk [[02 Projects/FDE/index|FDE]]",
        ].join("\n"),
      );
      expect(notes[TARGET]).toBe(
        `${PROJECT_NOTE}\n- [ ] send the deck\n  - [ ] draw the chart\n- [ ] buy milk`,
      );
      expect(app.notice()).toBe(MOVED);
    });

    it("#396 B4 two presses back to back on a project with no index.md make it once", async () => {
      notes = Object.fromEntries(Object.entries(notes).filter(([path]) => path !== TARGET));
      saveNote.mockImplementation(async (path: string, content: string) => {
        notes[path] = content;
        return { path, content };
      });
      createNote.mockImplementation(async (path: string, content: string) => {
        if (notes[path] !== undefined) throw new Error(`POST /api/files/${path} failed with 409`);
        notes[path] = content;
        return { path, content };
      });
      fetchTodos.mockResolvedValue([
        ROW,
        { path: DAILY, line: 4, text: "- [ ] buy milk", project: PROJECT },
      ]);
      const app = await renderApp();
      await settle();
      app.leader("g", "t");
      await settle();
      const pane = app.todoPane() as HTMLElement;
      pane.focus();

      fireEvent.keyDown(pane, { key: "m" });
      fireEvent.keyDown(pane, { key: "j" });
      fireEvent.keyDown(pane, { key: "m" });
      await hashed();
      await settle();

      expect(createNote).toHaveBeenCalledTimes(1);
      expect(notes[TARGET]).toBe(
        "## TODOs\n- [ ] send the deck\n  - [ ] draw the chart\n- [ ] buy milk\n",
      );
      expect(app.notice()).toBe(MOVED);
    });

    it("#396 I4 writes nothing while the project's note holds text not yet saved", async () => {
      holdText(TARGET, { content: "typed", reason: "PUT failed with 500", conflicted: false });
      const app = await renderApp();
      await settle();

      await refile(app);

      expect(saveNote).not.toHaveBeenCalled();
      expect(app.notice()).toBe("Nothing moved: 02 Projects/FDE/index.md holds text not yet saved");
    });

    it("#396 I4 writes nothing while the daily note holds text not yet saved", async () => {
      holdText(DAILY, { content: "typed", reason: "PUT failed with 500", conflicted: false });
      const app = await renderApp();
      await settle();

      await refile(app);

      expect(saveNote).not.toHaveBeenCalled();
      expect(app.notice()).toBe("Nothing moved: daily.md holds text not yet saved");
    });

    it("#396 I4 writes nothing while a write of the daily note is still out", async () => {
      // daily.md typed into in one pane, its quiet write hanging, and the todo
      // pane opened in the other, as `#424` sets up the same tail.
      const app = await renderApp();
      await settle();
      app.click(DAILY);
      await settle();
      app.leader("%");
      await settle();
      app.click("index.md");
      await settle();
      const panes = () => [...document.querySelectorAll<HTMLElement>(".cm-content")];
      const holding = (text: string) =>
        panes().find((each) => EditorView.findFromDOM(each)?.state.doc.toString() === text);
      const daily = holding(SOURCE.join("\n")) as HTMLElement;
      const index = holding("the index note") as HTMLElement;
      daily.focus();
      await settle();
      fireEvent.keyDown(daily, { key: "x" });
      saveNote.mockImplementationOnce(() => new Promise(() => {}));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      await hashed();
      await settle();
      expect(saved()).toEqual([DAILY]);
      index.focus();
      await settle();
      for (const key of [" ", "g", "t"]) fireEvent.keyDown(index, { key });
      await settle();
      const pane = app.todoPane() as HTMLElement;
      pane.focus();
      fireEvent.keyDown(pane, { key: "m" });
      await hashed();
      await settle();

      expect(saved()).toEqual([DAILY]);
      expect(app.notice()).toBe("Nothing moved: daily.md is still being saved");
    });

    it("#396 I5 a todo with no project moves nothing, and names p and a #p/x tag", async () => {
      fetchTodos.mockResolvedValue([{ ...ROW, project: null }]);
      const app = await renderApp();
      await settle();

      await refile(app);

      expect(fetchNote).not.toHaveBeenCalledWith(DAILY);
      expect(saveNote).not.toHaveBeenCalled();
      expect(app.notice()).toBe("That todo has no project: give it one with p or a #p/x tag");
    });

    it("#396 I6 a project folder with no index.md gets one holding the todo", async () => {
      notes = Object.fromEntries(Object.entries(notes).filter(([path]) => path !== TARGET));
      createNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
      const app = await renderApp();
      await settle();

      await refile(app);

      expect(createNote).toHaveBeenCalledExactlyOnceWith(
        TARGET,
        "## TODOs\n- [ ] send the deck\n  - [ ] draw the chart\n",
      );
      expect(saved()).toEqual([DAILY]);
      expect(app.notice()).toBe(MOVED);
    });

    it("#396 I7 a todo already in its project's note stays", async () => {
      fetchTodos.mockResolvedValue([{ ...ROW, path: TARGET }]);
      const app = await renderApp();
      await settle();

      await refile(app);

      expect(saveNote).not.toHaveBeenCalled();
      expect(app.notice()).toBe("That todo is in its project's note already");
    });

    describe("by a card dropped on a lane", () => {
      const OTHER = "02 Projects/Other";
      const OTHER_NOTE = "02 Projects/Other/index.md";
      const OTHER_TEXT = "# Other\n\n## TODOs\n- [ ] older";

      beforeEach(() => {
        notes[OTHER_NOTE] = OTHER_TEXT;
      });

      /** The board open, then the drop as it reaches the route: the row and the lane's project. */
      async function drop(row: TodoHit, project: string) {
        app.leader("g", "t");
        await settle();
        act(() => paneProps.current?.onRefile(row, project));
        await hashed();
        await settle();
      }

      let app: Awaited<ReturnType<typeof renderApp>>;

      it("#397 A2 a card dropped on another project lane moves into that project's note, project's note first", async () => {
        app = await renderApp();
        await settle();

        await drop(ROW, OTHER);

        expect(saved()).toEqual([OTHER_NOTE, DAILY]);
        expect(saveNote).toHaveBeenCalledWith(
          DAILY,
          ["## TODOs", "- send the deck [[02 Projects/Other/index|Other]]", "- [ ] buy milk"].join(
            "\n",
          ),
          false,
          noteBase(SOURCE.join("\n")),
        );
        expect(app.notice()).toBe(
          "Moved into 02 Projects/Other/index.md. The history pane's restore on both notes takes it back",
        );
      });

      it("#397 A2 a card with no project dropped on a project lane moves into that project's note", async () => {
        const row = { ...ROW, project: null };
        fetchTodos.mockResolvedValue([row]);
        app = await renderApp();
        await settle();

        await drop(row, OTHER);

        expect(saved()).toEqual([OTHER_NOTE, DAILY]);
        expect(app.notice()).toBe(
          "Moved into 02 Projects/Other/index.md. The history pane's restore on both notes takes it back",
        );
      });

      it("#397 I4 a dropped card's parts move with it", async () => {
        app = await renderApp();
        await settle();

        await drop(ROW, OTHER);

        expect(saveNote).toHaveBeenCalledWith(
          OTHER_NOTE,
          `${OTHER_TEXT}\n- [ ] send the deck\n  - [ ] draw the chart`,
          false,
          noteBase(OTHER_TEXT),
        );
        expect(saveNote).toHaveBeenCalledWith(
          DAILY,
          ["## TODOs", "- send the deck [[02 Projects/Other/index|Other]]", "- [ ] buy milk"].join(
            "\n",
          ),
          false,
          noteBase(SOURCE.join("\n")),
        );
      });
    });
  });
});
