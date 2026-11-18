import { fireEvent, screen } from "@testing-library/react";
import { useMemo } from "react";
import type { TodoHit } from "@/lib/core/api";
import { noteBase } from "@/lib/notes/note-base";
import { periodicNote } from "@/lib/notes/text/periodic";
import type { PdfRenderer } from "@/lib/panes/book/pdf-view";
import type { TodoState } from "@/lib/todo/todo";
import { hashed } from "./digests";
import { defineFoliateFake } from "./foliate-fake";
import { outside, pageHooks, renderApp, settle, theRoute, VAULT } from "./home-route-fixture";
import { NARROW, stubMatchMedia } from "./match-media";

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

// The app stamps the day when a press runs, so a run crossing midnight would
// see the next day while a read taken at the top of a block saw this one (#1315).
const NOW = new Date(2026, 7, 10, 12);

beforeEach(() => {
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the route", () => {
  theRoute();

  describe("a press on a todo whose 🆔 stands on another todo line", () => {
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
       * today's note the fake save checks each base against. `updateNote`
       * tries once, so a second press that read before the first wrote fails
       * the test; the retry is `todo-api-done-log`'s to prove (#1427).
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
  });
});
