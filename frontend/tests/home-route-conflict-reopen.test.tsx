import { EditorView } from "@codemirror/view";
import { fireEvent, screen } from "@testing-library/react";
import { useMemo } from "react";
import type { TodoHit } from "@/lib/api";
import { heldText, holdText } from "@/lib/held-text";
import { noteBase } from "@/lib/note-base";
import type { PdfRenderer } from "@/lib/pdf-view";
import type { TodoState } from "@/lib/todo";
import { defineFoliateFake } from "./foliate-fake";
import {
  act,
  editing,
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

  it("carries a conflicted note's kept text through a move of the note", async () => {
    // Held text is keyed by path, so a move that left it under the old one
    // would list a note the vault no longer has and never offer the text again.
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    const view = EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement);
    act(() => view?.dispatch({ changes: { from: 0, to: 1 } }));
    somebodyElseWrote();
    await settle();
    await app.navigate("/capture");
    await settle();
    // A fresh start, so the note is held and on screen nowhere: restored, its
    // pane would stand conflicted and refuse the rename below.
    localStorage.removeItem("kasten.workspace.1");
    await app.navigate("/");
    await settle();
    expect(heldText("index.md")).toMatchObject({ content: "he index note", conflicted: true });

    renameNote.mockResolvedValue({ path: "moved.md", content: "somebody else's note" });
    fetchFiles.mockResolvedValue(["moved.md", "other.md"]);
    fetchNote.mockImplementation(async (path: string) =>
      path === "moved.md" ? "somebody else's note" : VAULT[path],
    );
    // The tree's cursor opens on its first row, which is index.md.
    app.leader("e");
    await settle();
    fireEvent.keyDown(app.tree(), { key: "r" });
    await settle();
    app.fill("moved.md");
    await settle();

    expect(heldText("index.md")).toBeUndefined();
    expect(app.heldConflict()).toBe("Changed on disk: moved");

    app.click("moved.md");
    await settle();
    expect(app.text()).toBe("he index note");
    expect(app.status()).toBe("Changed on disk");
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("keeps held text through a delete or an agent's move, and offers it when the path is written again", async () => {
    // An agent's move reaches the stream as a remove and a write, the same
    // remove a delete makes, and nothing on it says where the note went.
    holdText("index.md", {
      content: "he index note",
      reason: "PUT failed with 500",
      conflicted: false,
    });
    const app = await renderApp();
    await settle();

    fetchFiles.mockResolvedValue(["moved.md", "other.md"]);
    act(() => stream().send({ path: "index.md", change: "removed", digest: null }));
    act(() => stream().send({ path: "moved.md", change: "written", digest: "a".repeat(64) }));
    await settle();
    expect(app.held()?.label).toBe("Not saved: index");

    fetchFiles.mockResolvedValue(["index.md", "moved.md", "other.md"]);
    fetchNote.mockImplementation(async (path: string) =>
      path === "index.md" ? "a new index note" : VAULT[path],
    );
    act(() => stream().send({ path: "index.md", change: "written", digest: "b".repeat(64) }));
    await settle();
    app.click("index.md");
    await settle();

    expect(app.text()).toBe("he index note");
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("shows the other writer's text in the diff of a conflict raised while the note is open", async () => {
    const app = await editing();
    fetchNote.mockImplementation(async (path: string) =>
      path === "index.md" ? "somebody else's note" : VAULT[path],
    );
    somebodyElseWrote();
    await settle();

    expect(app.status()).toBe("Changed on disk");
    expect(app.text()).toBe("he index note");
    expect(app.diff()).toContain("- somebody else's note");
    expect(app.diff()).toContain("+ he index note");
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("shows the diff against the newest vault text when it changes again during a live conflict", async () => {
    const app = await editing();
    fetchNote.mockImplementation(async (path: string) =>
      path === "index.md" ? "somebody else's note" : VAULT[path],
    );
    somebodyElseWrote();
    await settle();
    expect(app.diff()).toContain("- somebody else's note");

    fetchNote.mockImplementation(async (path: string) =>
      path === "index.md" ? "a third writer's note" : VAULT[path],
    );
    act(() => stream().send({ path: "index.md", change: "written", digest: "b".repeat(64) }));
    await settle();

    expect(app.diff()).toContain("- a third writer's note");
    expect(app.text()).toBe("he index note");
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("clears a live conflict by itself once the vault comes to hold the buffer's text", async () => {
    const app = await editing();
    somebodyElseWrote();
    await settle();
    expect(app.status()).toBe("Changed on disk");

    fetchNote.mockImplementation(async (path: string) =>
      path === "index.md" ? "he index note" : VAULT[path],
    );
    act(() => stream().send({ path: "index.md", change: "written", digest: "b".repeat(64) }));
    await settle();

    expect(app.status()).toBe("Saved");
    expect(app.text()).toBe("he index note");
    expect(app.heldConflict()).toBeNull();
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("keeps mine with :w after reopening a conflicted note", async () => {
    const app = await reopenedConflicted();

    app.ex("w");
    await settle();

    expect(saveNote).toHaveBeenCalledTimes(1);
    expect(saveNote).toHaveBeenLastCalledWith("index.md", "he index note");
    expect(app.status()).toBe("Saved");
    expect(app.diff()).toBeNull();
    expect(app.heldConflict()).toBeNull();
    expect(heldText("index.md")).toBeUndefined();
  });

  it("takes the vault's with :e! after reopening a conflicted note", async () => {
    const app = await reopenedConflicted();

    app.ex("e!");
    await settle();

    expect(saveNote).not.toHaveBeenCalled();
    expect(app.text()).toBe("somebody else's note");
    expect(app.status()).toBe("Saved");
    expect(app.heldConflict()).toBeNull();
    expect(heldText("index.md")).toBeUndefined();
  });

  it("writes an edited merge with :w after reopening a conflicted note", async () => {
    const app = await reopenedConflicted();

    // A merge by hand: the buffer is the reader's, edited toward the vault's.
    app.press("x");
    expect(app.text()).toBe("e index note");
    // The diff follows the buffer, which is what the reader is merging with.
    expect(app.diff()).toContain("+ e index note");
    app.ex("w");
    await settle();

    expect(saveNote).toHaveBeenCalledTimes(1);
    expect(saveNote).toHaveBeenLastCalledWith("index.md", "e index note");
    expect(app.status()).toBe("Saved");
    expect(heldText("index.md")).toBeUndefined();
  });

  it("shows the conflict against the newest vault text when it changed again before the reopen", async () => {
    const app = await editing();
    somebodyElseWrote();
    await settle();
    await app.navigate("/capture");
    await settle();
    await app.navigate("/");
    await settle();

    // Written again, to a note no pane holds now: the stream marks it stale.
    fetchNote.mockImplementation(async (path: string) =>
      path === "index.md" ? "the newest note" : VAULT[path],
    );
    act(() => stream().send({ path: "index.md", change: "written", digest: "b".repeat(64) }));
    await settle();
    app.click("index.md");
    await settle();

    expect(app.text()).toBe("he index note");
    expect(app.status()).toBe("Changed on disk");
    expect(app.diff()).toContain("- the newest note");
    expect(app.diff()).toContain("+ he index note");
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("clears the conflict on reopen when the vault came to hold the kept text", async () => {
    const app = await reopenedConflicted("he index note");

    expect(app.text()).toBe("he index note");
    expect(app.status()).toBe("Saved");
    expect(app.diff()).toBeNull();
    expect(app.heldConflict()).toBeNull();
    expect(heldText("index.md")).toBeUndefined();
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("settles a reopened conflict with the bar's buttons, with vim off", async () => {
    // No ex prompt with vim off: the two buttons under the diff are the way out.
    localStorage.setItem("kasten.vim", "off");
    try {
      const app = await reopenedConflicted();
      expect(document.querySelector(".cm-vimMode")).toBeNull();
      expect(app.diff()).toContain("- somebody else's note");

      fireEvent.click(screen.getByRole("button", { name: "Write my text" }));
      await settle();

      expect(saveNote).toHaveBeenLastCalledWith("index.md", "he index note");
      expect(app.status()).toBe("Saved");
      expect(heldText("index.md")).toBeUndefined();
    } finally {
      localStorage.removeItem("kasten.vim");
    }
  });

  it("takes the vault's text for a reopened conflict with the bar's button, with vim off", async () => {
    localStorage.setItem("kasten.vim", "off");
    try {
      const app = await reopenedConflicted();

      fireEvent.click(screen.getByRole("button", { name: "Take the vault's" }));
      await settle();

      expect(app.text()).toBe("somebody else's note");
      expect(app.status()).toBe("Saved");
      expect(heldText("index.md")).toBeUndefined();
    } finally {
      localStorage.removeItem("kasten.vim");
    }
    expect(saveNote).not.toHaveBeenCalled();
  });
});
