import { EditorView } from "@codemirror/view";
import { fireEvent } from "@testing-library/react";
import { useMemo } from "react";
import type { TodoHit } from "@/lib/api";
import { heldText } from "@/lib/held-text";
import { noteBase } from "@/lib/note-base";
import type { PdfRenderer } from "@/lib/pdf-view";
import type { TodoState } from "@/lib/todo/todo";
import { hashed } from "./digests";
import { defineFoliateFake } from "./foliate-fake";
import {
  act,
  baseOf,
  editing,
  outside,
  pageHooks,
  renderApp,
  settle,
  somebodyElseWrote,
  stream,
  theRoute,
  VAULT,
} from "./home-route-fixture";

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

  it("leaves a conflicted note for a click into another pane, and writes nothing", async () => {
    // The one move `moveTo` cannot refuse: the layout hears about it after the
    // browser has moved the focus, so a refusal would be a fight with the
    // browser. Holding the text is what keeps both writers' words instead.
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();

    // Split while the buffer is still clean, there being no way to split once
    // it is not.
    app.leader("%");
    await settle();
    app.leader("o");
    await settle();

    app.press("x");
    expect(app.text()).toBe("he index note");
    somebodyElseWrote();
    await settle();
    expect(app.status()).toBe("Changed on disk");

    app.focusPane(1);
    await settle();

    // The focus moved and the vault keeps the other writer's text. The bar is
    // where the conflict left behind can still be read.
    expect(app.status()).toBeUndefined();
    expect(saveNote).not.toHaveBeenCalled();
    expect(app.heldConflict()).toBe("Changed on disk: index");
    expect(heldText("index.md")).toMatchObject({ content: "he index note", conflicted: true });
  });

  it("keeps the kept text on screen in the pane left behind through another outside write", async () => {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    app.leader("%");
    await settle();
    app.leader("o");
    await settle();
    app.press("x");
    somebodyElseWrote();
    await settle();
    app.focusPane(1);
    await settle();

    fetchNote.mockImplementation(async (path: string) =>
      path === "index.md" ? "a third writer's note" : VAULT[path],
    );
    act(() => stream().send({ path: "index.md", change: "written", digest: "b".repeat(64) }));
    await settle();
    app.focusPane(0);
    await settle();

    expect(app.text()).toBe("he index note");
    expect(app.status()).toBe("Changed on disk");
    expect(app.diff()).toContain("- a third writer's note");
    expect(app.diff()).toContain("+ he index note");
    expect(saveNote).not.toHaveBeenCalled();
  });

  /** Three panes: index.md in the first two, other.md in the third, focus on the first. */
  async function threePanes() {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    app.leader("%");
    await settle();
    app.click("index.md");
    await settle();
    app.leader("%");
    await settle();
    app.click("other.md");
    await settle();
    app.focusPane(0);
    await settle();
    return app;
  }

  /** The text of the editor in the pane at `index`, in the order they are drawn. */
  const paneText = (index: number) => document.querySelectorAll(".cm-content")[index]?.textContent;

  /**
   * The vault's copy of index.md becoming `text`, with the event that says so,
   * and the refusal of a quiet save from a dirty buffer on it (see
   * `somebodyElseWrote`).
   */
  function vaultNow(text: string, digest: string) {
    outside.set("index.md", text);
    fetchNote.mockImplementation(async (path: string) =>
      path === "index.md" ? text : VAULT[path],
    );
    act(() => {
      stream().send({ path: "index.md", change: "written", digest: digest.repeat(64) });
      vi.advanceTimersByTime(800);
    });
    saveNote.mockClear();
  }

  it("lets a pane that never showed the kept text take later outside writes", async () => {
    const app = await threePanes();
    app.press("x");
    vaultNow("version two", "a");
    await settle();
    // Not reloaded: the write is to the focused pane's note, which declines.
    expect(paneText(1)).toBe("the index note");
    app.focusPane(2);
    await settle();
    expect(app.heldConflict()).toBe("Changed on disk: index");

    vaultNow("version three", "b");
    await settle();

    // The first pane shows the kept text and refuses; the second never did.
    expect(paneText(0)).toBe("he index note");
    expect(paneText(1)).toBe("version three");
    app.focusPane(1);
    await settle();
    fireEvent.keyDown(document.querySelectorAll(".cm-content")[1] as HTMLElement, { key: "x" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    await hashed();
    await settle();
    expect(saveNote).toHaveBeenLastCalledWith(
      "index.md",
      "ersion three",
      false,
      await baseOf("version three"),
    );
  });

  it("puts the vault's text back in a pane left showing kept text once the conflict is settled elsewhere", async () => {
    const app = await threePanes();
    app.press("x");
    vaultNow("version two", "a");
    await settle();
    // Left for the third pane, then the note opened there over other.md.
    app.focusPane(2);
    await settle();
    expect(app.heldConflict()).toBe("Changed on disk: index");
    // Read while no pane holds the focus on it, so the cache takes it now and
    // the `:e!` below reads nothing new: no reload reaches the first pane then.
    vaultNow("version three", "b");
    await settle();
    expect(paneText(0)).toBe("he index note");
    app.click("index.md");
    await settle();
    expect(paneText(2)).toBe("he index note");
    expect(app.status()).toBe("Changed on disk");

    // `app.ex` types into the first editor, and this has to be the third.
    fireEvent.keyDown(document.querySelectorAll(".cm-content")[2] as HTMLElement, { key: ":" });
    const input = document.querySelector(".cm-vim-panel input") as HTMLInputElement;
    input.value = "e!";
    fireEvent.keyDown(input, { key: "Enter", keyCode: 13 });
    await settle();
    expect(heldText("index.md")).toBeUndefined();
    expect(paneText(2)).toBe("version three");

    app.focusPane(0);
    await settle();
    expect(paneText(0)).toBe("version three");
    app.press("x");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    await hashed();
    await settle();
    expect(saveNote).toHaveBeenLastCalledWith(
      "index.md",
      "ersion three",
      false,
      await baseOf("version three"),
    );
  });

  it("leaves a conflicted note for another note without writing, and lists it", async () => {
    // Into the other pane first: a click in the tree opens in the focused pane,
    // and over a conflicted note that is refused, as the test above pins.
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    app.leader("%");
    await settle();
    app.leader("o");
    await settle();
    app.press("x");
    somebodyElseWrote();
    await settle();

    app.focusPane(1);
    await settle();
    app.click("other.md");
    await settle();

    expect(app.status()).toBe("Saved");
    expect(saveNote).not.toHaveBeenCalled();
    expect(app.heldConflict()).toBe("Changed on disk: index");
    expect(app.held()).toBeNull();
  });

  /**
   * Leave index.md standing conflicted, the vault now holding `vault`, and come
   * back to it. Leaving the route is the way out with one pane: every key and
   * every click in the tree that would leave the note in place is refused.
   */
  async function reopenedConflicted(vault = "somebody else's note") {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    // Through the view and not `x`, which is no edit with vim off.
    const view = EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement);
    act(() => view?.dispatch({ changes: { from: 0, to: 1 } }));
    expect(app.text()).toBe("he index note");
    somebodyElseWrote();
    await settle();
    await app.navigate("/capture");
    await settle();
    // The vault answers with `vault` before the return, as the disk does: the
    // return reopens the note in its restored pane and reads it there, before
    // the click below, which then lands on the note already open.
    fetchNote.mockImplementation(async (path: string) =>
      path === "index.md" ? vault : VAULT[path],
    );
    await app.navigate("/");
    await settle();

    app.click("index.md");
    await settle();
    return app;
  }

  it("reopens a conflicted note left behind with the diff open and both texts", async () => {
    const app = await reopenedConflicted();

    expect(app.text()).toBe("he index note");
    expect(app.status()).toBe("Changed on disk");
    expect(app.diff()).toContain("- somebody else's note");
    expect(app.diff()).toContain("+ he index note");
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("writes what is waiting before it swaps two panes", async () => {
    // A swap between two splits builds the editor again from the vault's copy,
    // and nothing else flushes it: the autosave follows the focused pane's
    // note and this leaves that note exactly where it was. Without the write,
    // the character deleted a moment ago comes back on screen.
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();

    app.leader("%");
    await settle();
    // Back to the pane holding the note, which the split left behind. `o`
    // wraps and needs no boxes, unlike the four directions.
    app.leader("o");
    await settle();

    app.press("x");
    expect(app.text()).toBe("he index note");

    // jsdom measures nothing, so the boxes a direction is answered off have to
    // be stood in for: the two panes side by side, in the order they are drawn.
    const boxes = [...document.querySelectorAll("[data-pane]")];
    boxes.forEach((box, index) => {
      box.getBoundingClientRect = () =>
        ({ left: index * 100, top: 0, right: index * 100 + 99, bottom: 100 }) as DOMRect;
    });

    app.leader("L");
    await hashed();
    await settle();

    expect(saveNote).toHaveBeenCalledWith(
      "index.md",
      "he index note",
      false,
      await baseOf("the index note"),
    );
    // And the panes did trade places: the focus is where it was, on the note,
    // which is now the second pane on screen.
    expect(app.focusedPane()).toBe(1);
  });

  it("starts the tab once :w has settled the conflict", async () => {
    const app = await editing();
    somebodyElseWrote();
    await settle();

    app.ex("w");
    await settle();
    expect(saveNote).toHaveBeenCalledTimes(1);

    app.leader("c", "t");
    await settle();

    expect(app.tabs()).toBe(2);
  });
});
