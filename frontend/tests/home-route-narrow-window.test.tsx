import { EditorView } from "@codemirror/view";
import { fireEvent, screen, within } from "@testing-library/react";
import { useMemo } from "react";
import type { TodoHit } from "@/lib/api";
import { noteBase } from "@/lib/note-base";
import type { PdfRenderer } from "@/lib/pdf-view";
import type { TodoState } from "@/lib/todo";
import { defineFoliateFake } from "./foliate-fake";
import {
  act,
  pageHooks,
  renderApp,
  settle,
  somebodyElseWrote,
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

  describe("in a narrow window", () => {
    /** The panes the tab is drawing, as opposed to the ones it only holds. */
    const drawn = () =>
      [...document.querySelectorAll<HTMLElement>("[data-pane]")].filter(
        (pane) => !pane.classList.contains("hidden"),
      );

    it("starts with the tree shut, and shuts it again on the note a tap opens", async () => {
      stubMatchMedia({ [NARROW]: true, [COARSE]: true });
      const app = await renderApp();
      await settle();

      expect(app.tree()).toBeNull();
      // No rail on a phone, the toolbar being the way to the drawer.
      expect(screen.queryByRole("button", { name: "Show file tree" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "File tree" }));
      app.click("index.md");
      await settle();

      expect(app.text()).toBe("the index note");
      expect(app.tree()).toBeNull();
    });

    it("shows the diff and the buttons on a phone", async () => {
      stubMatchMedia({ [NARROW]: true, [COARSE]: true });
      const app = await renderApp();
      await settle();
      fireEvent.click(screen.getByRole("button", { name: "File tree" }));
      app.click("index.md");
      await settle();
      const view = EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement);
      act(() => view?.dispatch({ changes: { from: 0, to: 1 } }));
      somebodyElseWrote();
      await settle();
      await app.navigate("/capture");
      await settle();
      // The vault answers with the other write before the return, as the disk
      // does: the return reopens the note in its restored pane and reads it
      // there, before any tap.
      fetchNote.mockImplementation(async (path: string) =>
        path === "index.md" ? "somebody else's note" : VAULT[path],
      );
      await app.navigate("/");
      await settle();

      fireEvent.click(screen.getByRole("button", { name: "File tree" }));
      app.click("index.md");
      await settle();

      expect(app.diff()).toContain("- somebody else's note");
      expect(app.diff()).toContain("+ he index note");
      // Under the part that scrolls, not in it: a long diff on a small screen
      // would otherwise carry the only way out off the top of the panel.
      const scroller = screen.getByTestId("conflict-diff").closest(".overflow-y-auto");
      expect(scroller).not.toBeNull();
      for (const name of ["Write my text", "Take the vault's"]) {
        expect(scroller?.contains(screen.getByRole("button", { name }))).toBe(false);
      }
      expect(saveNote).not.toHaveBeenCalled();
    });

    /** The column holding the panes, which an open drawer puts out of reach. */
    const page = () =>
      document.querySelector("[role='tablist'], [data-pane]")?.closest("[inert]") ?? null;
    // The toolbar's button on a phone, and the rail's where a mouse keeps one.
    const openDrawer = () => fireEvent.click(screen.getByRole("button", { name: /File tree$/i }));

    it("closes the drawer on Escape and puts the focus in the pane on screen", async () => {
      // Narrow and no more, the split below being asked for with a leader key.
      stubMatchMedia({ [NARROW]: true });
      const app = await renderApp();
      await settle();
      // Two panes with the second focused, so the first editor in the document
      // is one that is not drawn.
      app.leader("%");
      await settle();

      openDrawer();
      expect(page()).not.toBeNull();
      app.treeCursor()?.focus();
      fireEvent.keyDown(app.tree(), { key: "Escape" });
      await settle();

      expect(app.tree()).toBeNull();
      expect(page()).toBeNull();
      // Both panes are drawn now (#793 A5), so the one with the focus line is the one to check.
      const focusedPane = drawn().find(
        (pane) =>
          pane.querySelector("[data-focus-line]")?.classList.contains("bg-k-accent") === true,
      );
      expect(focusedPane?.contains(document.activeElement)).toBe(true);
    });

    it("closes the drawer on the note its New note button makes", async () => {
      stubMatchMedia({ [NARROW]: true, [COARSE]: true });
      createNote.mockResolvedValue({ path: "fresh.md", content: "" });
      const app = await renderApp();
      await settle();

      openDrawer();
      // The top bar has a New note button too, so the drawer's own is found inside its aside.
      fireEvent.click(
        within(document.querySelector("aside") as HTMLElement).getByRole("button", {
          name: "New note",
        }),
      );
      await settle();
      app.fill("fresh");
      await settle();

      expect(createNote).toHaveBeenCalled();
      expect(app.tree()).toBeNull();
    });

    it("closes the drawer on the note the finder opens from the tree", async () => {
      stubMatchMedia({ [NARROW]: true, [COARSE]: true });
      const app = await renderApp();
      await settle();

      openDrawer();
      fireEvent.keyDown(app.tree(), { key: "f" });
      await settle();
      // Still open under the finder, so Escape there lands back in the tree.
      expect(app.tree()).not.toBeNull();
      fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
      await settle();

      expect(screen.queryByRole("dialog", { name: "Find note" })).toBeNull();
      expect(app.tree()).toBeNull();
    });

    it("closes the tree when the window turns narrow under it", async () => {
      const media = stubMatchMedia();
      const app = await renderApp();
      await settle();
      expect(app.tree()).not.toBeNull();

      media.set(NARROW, true);

      expect(app.tree()).toBeNull();
      expect(screen.queryByRole("button", { name: "Close file tree" })).toBeNull();
    });

    it("stacks both panes of a split, and puts them side by side when the window widens", async () => {
      // Narrow and no more: the split is asked for with a leader key, which a
      // touch screen may not have, and one pane to a tab is about the width.
      // It drew the focused pane alone before #793 A5 stacked the split.
      const media = stubMatchMedia({ [NARROW]: true });
      const app = await renderApp();
      await settle();

      app.leader("%");
      await settle();

      expect(app.panes()).toBe(2);
      expect(drawn()).toHaveLength(2);
      expect(drawn()[1]?.style.top).toBe("calc(50% + 1px)");

      app.leader("o");
      await settle();

      expect(drawn()).toHaveLength(2);

      media.set(NARROW, false);

      expect(drawn()).toHaveLength(2);
      expect(drawn()[1]?.style.left).toBe("calc(50% + 1px)");
    });

    it("draws the toolbar on a phone and nowhere else", async () => {
      const toolbar = () => screen.queryByRole("toolbar", { name: "Commands" });
      const media = stubMatchMedia();
      await renderApp();
      await settle();
      expect(toolbar()).toBeNull();

      // A narrow window under a mouse keeps its keys, and its rail.
      media.set(NARROW, true);
      expect(toolbar()).toBeNull();
      expect(screen.getByRole("button", { name: "Show file tree" })).toBeInTheDocument();

      media.set(COARSE, true);
      expect(toolbar()).not.toBeNull();
      // One pane, so nowhere to move to.
      expect(screen.queryByRole("button", { name: "Move to the next pane" })).toBeNull();

      // A tablet: a finger, and room for the panel beside the note.
      media.set(NARROW, false);
      expect(toolbar()).toBeNull();
    });

    /** A press and release on the sheet around a panel, which is its way out. */
    const tapSheet = (sheet: HTMLElement) => {
      fireEvent.mouseDown(sheet);
      fireEvent.mouseUp(sheet);
      fireEvent.click(sheet);
    };

    it("opens the palette, the finder and the search from the toolbar", async () => {
      stubMatchMedia({ [NARROW]: true, [COARSE]: true });
      await renderApp();
      await settle();

      fireEvent.click(screen.getByRole("button", { name: "Run a command by name" }));
      const palette = screen.getByRole("dialog", { name: "Run a command" });
      // The way to vim's keys on a phone, which no key reaches with vim off.
      expect(screen.getByRole("option", { name: "Toggle vim keys" })).toBeInTheDocument();
      tapSheet(palette);
      expect(screen.queryByRole("dialog")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Find a note" }));
      tapSheet(screen.getByRole("dialog", { name: "Find note" }));
      expect(screen.queryByRole("dialog")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Search note content" }));
      tapSheet(screen.getByRole("dialog"));
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("on a touch phone the accent rows are listed and run", async () => {
      stubMatchMedia({ [NARROW]: true, [COARSE]: true });
      await renderApp();
      await settle();

      fireEvent.click(screen.getByRole("button", { name: "Run a command by name" }));
      const row = screen.queryByRole("option", { name: "Accent palette: Hay's russet" });
      expect.soft(row).not.toBeNull();
      if (row) fireEvent.click(row);

      const shown = document.documentElement.dataset.palette;
      localStorage.removeItem("kasten.palette");
      delete document.documentElement.dataset.palette;
      expect(shown).toBe("russet");
    });

    it("makes room in the frame for a keyboard that covers the page", async () => {
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
      stubMatchMedia({ [NARROW]: true, [COARSE]: true });
      await renderApp();
      await settle();
      const frame = screen.getByRole("main");

      viewport.height = 500;
      listeners.get("resize")?.();

      // The bar and the toolbar sit inside the frame, so both rise with it.
      expect(frame.style.paddingBottom).toBe("300px");
      expect(frame).toContainElement(screen.getByRole("contentinfo"));
      expect(frame).toContainElement(screen.getByRole("toolbar", { name: "Commands" }));
      box.mockRestore();
      layout.mockRestore();
    });

    it("counts the panes in the bar, which is the only sign of a split", async () => {
      // Narrow and no more: the split is asked for with a leader key, which a
      // touch screen may not have, and one pane to a tab is about the width.
      const media = stubMatchMedia({ [NARROW]: true });
      const app = await renderApp();
      await settle();
      expect(screen.queryByTestId("pane-shown")).toBeNull();

      app.leader("%");
      await settle();
      expect(screen.getByTestId("pane-shown")).toHaveTextContent("pane 2/2");

      app.leader("o");
      await settle();
      expect(screen.getByTestId("pane-shown")).toHaveTextContent("pane 1/2");

      // Both are on screen in a wide window, and count themselves.
      media.set(NARROW, false);
      expect(screen.queryByTestId("pane-shown")).toBeNull();
    });

    it("takes the status bar out of reach under the drawer", async () => {
      stubMatchMedia({ [NARROW]: true, [COARSE]: true });
      await renderApp();
      await settle();
      expect(screen.getByRole("contentinfo")).not.toHaveAttribute("inert");

      openDrawer();

      expect(screen.getByRole("contentinfo")).toHaveAttribute("inert");
    });
  });
});
