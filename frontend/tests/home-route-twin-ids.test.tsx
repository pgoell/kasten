import { EditorView } from "@codemirror/view";
import { fireEvent, screen } from "@testing-library/react";
import { useMemo } from "react";
import { ChangedOnDisk, type TodoHit } from "@/lib/api";
import type { PdfRenderer } from "@/lib/book/pdf-view";
import { readClock } from "@/lib/clock";
import { noteBase } from "@/lib/note-base";
import { periodicNote } from "@/lib/periodic";
import type { TodoState } from "@/lib/todo/todo";
import { hashed } from "./digests";
import { defineFoliateFake } from "./foliate-fake";
import { act, outside, pageHooks, renderApp, settle, theRoute, VAULT } from "./home-route-fixture";
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

// The app stamps the day when a press runs, so a run crossing midnight would
// see the next day while a read taken at the top of a block saw this one (#1315).
const NOW = new Date(2026, 7, 10, 12);

beforeEach(() => {
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

/** `updateNote` with its three tries, read and change and save, a refusal past the third thrown. */
async function updateWithTries(path: string, change: (text: string) => string | null) {
  for (let tries = 1; ; tries++) {
    const text: string = await fetchNote(path);
    const next = change(text);
    if (next === null) return null;
    try {
      return await saveNote(path, next, false, noteBase(text));
    } catch (error) {
      if (!(error instanceof ChangedOnDisk) || tries === 3) throw error;
    }
  }
}

describe("the route", () => {
  theRoute();

  describe("a press on a todo whose 🆔 stands on another todo line", () => {
    const PATH = "inbox.md";
    const LINE = "- [/] a 🆔 kt-aaaaaa";
    /** The issue's copy-paste: one todo line twice, id and all. */
    const TWINS = [
      { path: PATH, line: 1, text: LINE, project: null, shared: false },
      { path: PATH, line: 2, text: LINE, project: null, shared: false },
    ];
    const DEPENDENT = {
      path: "deps.md",
      line: 1,
      text: "- [b] c ⛔ kt-aaaaaa",
      project: null,
      shared: false,
    };
    /** What a press on the second twin says. */
    const SECOND = "Nothing moved: 🆔 kt-aaaaaa is on another todo too: inbox.md line 1";

    /** The app over a vault holding the twins and a todo waiting on them. */
    async function vault() {
      const notes: Record<string, string> = {
        ...VAULT,
        [PATH]: `${LINE}\n${LINE}`,
        [DEPENDENT.path]: DEPENDENT.text,
      };
      fetchFiles.mockImplementation(async () => Object.keys(notes));
      fetchNote.mockImplementation(async (path: string) => notes[path]);
      fetchTodos.mockResolvedValue([...TWINS, DEPENDENT]);
      searchNotes.mockResolvedValue([...TWINS, DEPENDENT]);
      const app = await renderApp();
      await settle();
      return app;
    }

    /** The same, with the pane open. */
    async function listing(phone = false) {
      const app = await vault();
      if (phone) fireEvent.click(screen.getByRole("button", { name: "Open the todo pane" }));
      else app.leader("g", "t");
      await settle();
      return app;
    }

    /** Nothing in the vault moved: no line, no log, no dependent. */
    function wroteNothing() {
      expect(saveNote).not.toHaveBeenCalled();
      expect(createNote).not.toHaveBeenCalled();
    }

    /** The second row, pressed with `key` in the desktop pane. */
    async function pressSecond(app: Awaited<ReturnType<typeof renderApp>>, key: string) {
      const pane = app.todoPane() as HTMLElement;
      pane.focus();
      fireEvent.keyDown(pane, { key: "j" });
      fireEvent.keyDown(pane, { key });
      await hashed();
      await settle();
    }

    it("#534 A1 A6 the pane's t on a twin carrying the other's 🆔 writes nothing and names the other", async () => {
      const app = await listing();

      await pressSecond(app, "t");

      wroteNothing();
      expect(app.notice()).toBe(SECOND);
    });

    it("#534 A3 A6 the pane's X on a twin carrying the other's 🆔 writes nothing and names the other", async () => {
      const app = await listing();

      await pressSecond(app, "X");

      wroteNothing();
      expect(app.notice()).toBe(SECOND);
    });

    it("#534 A3 a card dropped on done carrying another todo's 🆔 writes nothing and names the other", async () => {
      const app = await listing();

      act(() => paneProps.current?.onCycle(TWINS[1] as TodoHit, "done", [1, 2]));
      await hashed();
      await settle();

      wroteNothing();
      expect(app.notice()).toBe(SECOND);
    });

    it("#534 A6 the phone strip's timer on a twin carrying the other's 🆔 writes nothing and names the other", async () => {
      stubMatchMedia({ [NARROW]: true, [COARSE]: true });
      const app = await listing(true);

      fireEvent.click(screen.getAllByLabelText("more for a")[1] as HTMLElement);
      fireEvent.click(screen.getByLabelText("timer a"));
      await hashed();
      await settle();

      wroteNothing();
      expect(app.notice()).toBe(SECOND);
    });

    it("#534 A6 the phone strip's done on a twin carrying the other's 🆔 writes nothing and names the other", async () => {
      stubMatchMedia({ [NARROW]: true, [COARSE]: true });
      const app = await listing(true);

      fireEvent.click(screen.getAllByLabelText("more for a")[1] as HTMLElement);
      fireEvent.click(screen.getByLabelText("done a"));
      await hashed();
      await settle();

      wroteNothing();
      expect(app.notice()).toBe(SECOND);
    });

    /**
     * The buffer takes the press and autosave writes its own note, so what is
     * refused is every other note: the log in today's, the dependent in its own.
     * The notes the press wrote besides this one, which must be none.
     */
    const asideWrites = () => [
      ...saveNote.mock.calls.map(([path]) => path).filter((path) => path !== PATH),
      ...createNote.mock.calls.map(([path]) => path),
    ];

    it("#534 A4 A6 <leader>x on a twin carrying the other's 🆔 logs nothing, unblocks nothing and names the other", async () => {
      const app = await vault();
      app.click(PATH);
      await settle();

      // The cursor opens on the first twin.
      app.leader("x");
      await hashed();
      await settle();

      expect(app.text()).toContain("✅");
      expect(asideWrites()).toEqual([]);
      expect(app.notice()).toBe(
        "Nothing moved: 🆔 kt-aaaaaa is on another todo too: inbox.md line 2",
      );
    });

    it("#534 A4 A6 the palette's cycle with vim off on a twin carrying the other's 🆔 logs nothing and names the other", async () => {
      localStorage.setItem("kasten.vim", "off");
      try {
        const app = await vault();
        app.click(PATH);
        await settle();

        // No leader with vim off: `<leader>x` is the palette's row of that label.
        app.press("P", { keyCode: 80, ctrlKey: true, shiftKey: true });
        await settle();
        fireEvent.click(screen.getByRole("option", { name: /^Cycle the todo on this line/ }));
        await hashed();
        await settle();

        expect(app.text()).toContain("✅");
        expect(asideWrites()).toEqual([]);
        expect(app.notice()).toBe(
          "Nothing moved: 🆔 kt-aaaaaa is on another todo too: inbox.md line 2",
        );
      } finally {
        localStorage.removeItem("kasten.vim");
      }
    });

    describe("#538 two quick presses into done in one note", () => {
      const TWO = "two.md";
      const daily = periodicNote("daily", NOW).path;
      const LOGGED = [
        expect.stringMatching(/^- ✅ \S+ a \[\[two\]\] kt-aaaaaa$/),
        expect.stringMatching(/^- ✅ \S+ b \[\[two\]\] kt-bbbbbb$/),
      ];

      /** Every log line today's note holds, in order. */
      const logLines = () =>
        (outside.get(daily) ?? "").split("\n").filter((line) => line.startsWith("- ✅"));

      /**
       * The app over a note holding two todos one press from done, and a
       * today's note whose writes are refused over a stale base. `updateNote`
       * runs its real three tries, the refusal and the read after it being
       * what is under test.
       */
      async function twoTodos(entry?: string) {
        outside.set(daily, "## Done\n");
        const notes: Record<string, string> = {
          ...VAULT,
          [TWO]: "- [/] a 🆔 kt-aaaaaa\n- [/] b 🆔 kt-bbbbbb",
        };
        fetchFiles.mockImplementation(async () => [...Object.keys(notes), daily]);
        fetchNote.mockImplementation(async (path: string) => outside.get(path) ?? notes[path]);
        searchNotes.mockResolvedValue([]);
        updateNote.mockImplementation(updateWithTries);
        const app = await renderApp(entry);
        await settle();
        return app;
      }

      it("#538 A3 two quick <leader>x into done with vim on both log", async () => {
        const app = await twoTodos();
        app.click(TWO);
        await settle();

        // Both presses inside one round trip: nothing settles between them.
        app.leader("x");
        app.press("j");
        app.leader("x");
        await hashed();
        await settle();

        expect(app.text()).toMatch(/a ✅ .*b ✅ /);
        expect(logLines()).toEqual(LOGGED);
        expect(app.notice()).toBeNull();
      });

      it("#538 A3 two quick palette cycles into done with vim off in a narrow window both log", async () => {
        stubMatchMedia({ [NARROW]: true });
        localStorage.setItem("kasten.vim", "off");
        try {
          const app = await twoTodos(`/?note=${TWO}`);

          const cycle = () => {
            app.press("P", { keyCode: 80, ctrlKey: true, shiftKey: true });
            fireEvent.click(screen.getByRole("option", { name: /^Cycle the todo on this line/ }));
          };
          cycle();
          app.press("ArrowDown");
          cycle();
          await hashed();
          await settle();

          expect(app.text()).toMatch(/a ✅ .*b ✅ /);
          expect(logLines()).toEqual(LOGGED);
          expect(app.notice()).toBeNull();
        } finally {
          localStorage.removeItem("kasten.vim");
        }
      });
    });

    it("#534 A4 B3 <leader>x in today's note on a todo whose 🆔 another note carries moves only its line", async () => {
      // Today's own note, where the log line and the dependent are buffer edits.
      const daily = periodicNote("daily", NOW).path;
      const text = "- [/] a 🆔 kt-aaaaaa\n- [b] c ⛔ kt-aaaaaa\n\n## Done\n";
      const notes: Record<string, string> = {
        ...VAULT,
        [daily]: text,
        "projects/x.md": "- [/] z 🆔 kt-aaaaaa",
      };
      fetchFiles.mockImplementation(async () => Object.keys(notes));
      fetchNote.mockImplementation(async (path: string) => notes[path]);
      fetchTodos.mockResolvedValue([
        { path: daily, line: 1, text: "- [/] a 🆔 kt-aaaaaa", project: null, shared: false },
        { path: daily, line: 2, text: "- [b] c ⛔ kt-aaaaaa", project: null, shared: false },
        {
          path: "projects/x.md",
          line: 1,
          text: "- [/] z 🆔 kt-aaaaaa",
          project: null,
          shared: false,
        },
      ]);
      const app = await renderApp(`/?note=${encodeURIComponent(daily)}`);
      await settle();
      // The listing is what the press asks, so the page holds one: the overlay
      // reads it and shuts, leaving the note where it was.
      app.leader("f", "t");
      await settle();
      fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
      await settle();

      app.leader("x");
      await hashed();
      await settle();

      const view = EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement);
      expect(view?.state.doc.toString()).toBe(
        `- [x] a ✅ ${readClock(NOW).date} 🆔 kt-aaaaaa\n- [b] c ⛔ kt-aaaaaa\n\n## Done\n`,
      );
      expect(app.notice()).toBe(
        "Nothing moved: 🆔 kt-aaaaaa is on another todo too: projects/x.md line 1",
      );
    });

    it("#534 I5 a timer press whose search fails says Nothing moved and why", async () => {
      const app = await listing();
      searchNotes.mockRejectedValue(new Error("GET /api/search failed with 500"));

      await pressSecond(app, "t");

      wroteNothing();
      expect(app.notice()).toBe("Nothing moved: GET /api/search failed with 500");
    });

    describe("#537 blocking on a todo whose 🆔 another todo carries", () => {
      const DOCS = "- [ ] write the docs";
      const SHIP = "- [ ] ship the release 🆔 kt-aaaaaa";
      /** The twin, done, in another note. */
      const COPY = "- [x] ship the release 🆔 kt-aaaaaa";
      const REFUSED = "Nothing moved: 🆔 kt-aaaaaa is on another todo too: other.md line 1";

      /** The pane over the dependent and the blocker in one note, the twin in another. */
      async function blocking(phone = false) {
        const notes: Record<string, string> = {
          ...VAULT,
          [PATH]: `${DOCS}\n${SHIP}`,
          "other.md": COPY,
        };
        fetchFiles.mockImplementation(async () => Object.keys(notes));
        fetchNote.mockImplementation(async (path: string) => notes[path]);
        fetchTodos.mockResolvedValue([
          { path: PATH, line: 1, text: DOCS, project: null, shared: false },
          { path: PATH, line: 2, text: SHIP, project: null, shared: false },
          { path: "other.md", line: 1, text: COPY, project: null, shared: false },
        ]);
        const app = await renderApp();
        await settle();
        if (phone) fireEvent.click(screen.getByRole("button", { name: "Open the todo pane" }));
        else app.leader("g", "t");
        await settle();
        return app;
      }

      it("#537 A6 the pane's b on a twinned blocker says Nothing moved", async () => {
        const app = await blocking();
        const pane = app.todoPane() as HTMLElement;
        pane.focus();

        fireEvent.keyDown(pane, { key: "b" });
        fireEvent.keyDown(pane, { key: "j" });
        fireEvent.keyDown(pane, { key: "Enter" });
        await hashed();
        await settle();

        wroteNothing();
        expect(app.notice()).toBe(REFUSED);
      });

      it("#537 A7 the phone menu's blocked by on a twinned blocker says Nothing moved", async () => {
        stubMatchMedia({ [NARROW]: true, [COARSE]: true });
        const app = await blocking(true);

        fireEvent.click(screen.getByLabelText("more for write the docs"));
        fireEvent.click(screen.getByLabelText("blocked by write the docs"));
        fireEvent.click(
          screen
            .getAllByRole("button")
            .find(
              (button) => button.title !== "" && button.textContent?.includes("ship the release"),
            ) as HTMLElement,
        );
        await hashed();
        await settle();

        wroteNothing();
        expect(app.notice()).toBe(REFUSED);
      });
    });
  });
});
