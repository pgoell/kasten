import { fireEvent, screen } from "@testing-library/react";
import { useMemo } from "react";
import type { TodoHit } from "@/lib/api";
import type { PdfRenderer } from "@/lib/book/pdf-view";
import { noteBase } from "@/lib/note-base";
import type { TodoState } from "@/lib/todo/todo";
import { defineFoliateFake } from "./foliate-fake";
import { act, pageHooks, renderApp, settle, theRoute } from "./home-route-fixture";
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

describe("the route", () => {
  theRoute();

  describe("a split on a phone", () => {
    /** The panes the tab is drawing, as opposed to the ones it only holds. */
    const drawn = () =>
      [...document.querySelectorAll<HTMLElement>("[data-pane]")].filter(
        (pane) => !pane.classList.contains("hidden"),
      );

    /** Whether a pane's focus line is the accent one, which is the one that names the focus. */
    const focused = (pane: HTMLElement) =>
      pane.querySelector("[data-focus-line]")?.classList.contains("bg-k-accent") === true;

    it("#793 A5 in a narrow window a side-by-side split draws both panes, one above the other", async () => {
      stubMatchMedia({ [NARROW]: true });
      const app = await renderApp();
      await settle();

      app.leader("%");
      await settle();

      expect(app.panes()).toBe(2);
      const [upper, lower] = drawn();
      expect(drawn()).toHaveLength(2);
      // Both full width, the upper one ending where the lower one starts.
      expect(upper?.style.left).toBe("0px");
      expect(upper?.style.right).toBe("0px");
      expect(lower?.style.left).toBe("0px");
      expect(lower?.style.right).toBe("0px");
      expect(upper?.style.bottom).toBe("calc(50% + 1px)");
      expect(lower?.style.top).toBe("calc(50% + 1px)");
      // Each names itself in a header row, as a pane of a split does.
      expect(upper?.querySelector("[data-pane-header]")).not.toBeNull();
      expect(lower?.querySelector("[data-pane-header]")).not.toBeNull();
    });

    it("#793 I1 in a narrow window a tap on the lower pane focuses it", async () => {
      stubMatchMedia({ [NARROW]: true });
      const app = await renderApp();
      await settle();
      app.leader("%");
      await settle();
      expect(drawn()).toHaveLength(2);
      const [upper, lower] = drawn();
      if (!upper || !lower) throw new Error("two panes are drawn after the split");

      fireEvent.focusIn(upper);
      await settle();
      expect(focused(upper)).toBe(true);
      expect(focused(lower)).toBe(false);

      fireEvent.focusIn(lower);
      await settle();
      expect(focused(lower)).toBe(true);
      expect(focused(upper)).toBe(false);
    });

    it("#793 I1 the toolbar's pane button moves the focus between the stacked panes", async () => {
      // The split first, by a key, then a finger: the leader keys do not split on a touch screen here.
      const media = stubMatchMedia({ [NARROW]: true });
      const app = await renderApp();
      await settle();
      app.leader("%");
      await settle();
      media.set(COARSE, true);
      await settle();
      expect(app.panes()).toBe(2);
      expect(drawn()).toHaveLength(2);
      const [upper, lower] = drawn();
      if (!upper || !lower) throw new Error("two panes are drawn after the split");
      expect(focused(lower)).toBe(true);

      fireEvent.click(screen.getByRole("button", { name: "Move to the next pane" }));
      await settle();

      expect(focused(upper)).toBe(true);
      expect(focused(lower)).toBe(false);
    });

    it("#793 I1 closing one pane gives the other the whole height", async () => {
      stubMatchMedia({ [NARROW]: true });
      const app = await renderApp();
      await settle();
      app.leader("%");
      await settle();
      expect(drawn()).toHaveLength(2);

      // Both panes are empty, so `q` closes the focused one outright.
      app.leader("q");
      await settle();

      expect(app.panes()).toBe(1);
      expect(drawn()).toHaveLength(1);
      expect(drawn()[0]?.style.bottom).toBe("0px");
      expect(drawn()[0]?.querySelector("[data-pane-header]")).toBeNull();
    });

    it("#793 I1 with the keyboard up the focused pane takes the whole height", async () => {
      const listeners = new Map<string, () => void>();
      const viewport = {
        scale: 1,
        offsetTop: 0,
        height: 800,
        addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
        removeEventListener: (type: string) => listeners.delete(type),
      };
      vi.stubGlobal("visualViewport", viewport);
      const box = vi
        .spyOn(HTMLElement.prototype, "getBoundingClientRect")
        .mockReturnValue({ bottom: 800 } as DOMRect);
      const layout = vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(800);
      const media = stubMatchMedia({ [NARROW]: true });
      const app = await renderApp();
      await settle();
      app.leader("%");
      await settle();
      expect(drawn()).toHaveLength(2);
      const lower = drawn()[1];

      // The keyboard comes up on a touch screen, so the frame is asked for its inset then.
      viewport.height = 500;
      media.set(COARSE, true);
      await settle();

      expect(drawn()).toHaveLength(1);
      expect(drawn()[0]).toBe(lower);
      expect(drawn()[0]?.querySelector("[data-pane-header]")).toBeNull();

      viewport.height = 800;
      act(() => listeners.get("resize")?.());
      await settle();

      expect(drawn()).toHaveLength(2);
      vi.unstubAllGlobals();
      box.mockRestore();
      layout.mockRestore();
    });

    it("#793 I3 widening the window gives the side-by-side split back, and narrowing stacks it again", async () => {
      const media = stubMatchMedia({ [NARROW]: true });
      const app = await renderApp();
      await settle();
      app.leader("%");
      await settle();
      expect(drawn()[1]?.style.top).toBe("calc(50% + 1px)");

      media.set(NARROW, false);
      await settle();

      expect(drawn()).toHaveLength(2);
      expect(drawn()[0]?.style.right).toBe("calc(50% + 1px)");
      expect(drawn()[1]?.style.left).toBe("calc(50% + 1px)");
      expect(drawn()[1]?.style.top).toBe("0px");

      media.set(NARROW, true);
      await settle();

      expect(drawn()[1]?.style.top).toBe("calc(50% + 1px)");
      expect(drawn()[1]?.style.left).toBe("0px");
    });
  });
});
