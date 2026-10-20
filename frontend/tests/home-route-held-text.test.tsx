import { fireEvent, screen } from "@testing-library/react";
import { useMemo } from "react";
import type { TodoHit } from "@/lib/api";
import { heldText, holdText, resetHeld } from "@/lib/held-text";
import { noteBase } from "@/lib/note-base";
import type { PdfRenderer } from "@/lib/pdf-view";
import type { TodoState } from "@/lib/todo";
import { hashed } from "./digests";
import { defineFoliateFake } from "./foliate-fake";
import {
  act,
  baseOf,
  editing,
  pageHooks,
  renderApp,
  settle,
  somebodyElseWrote,
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

  it("puts the held text back in the buffer when its note is reopened", async () => {
    // A new tab and back: a click in the tree saves first and stays put when
    // that fails, so moving the focus is the way a note is left mid-failure.
    const app = await editing();
    saveNote.mockRejectedValueOnce(new Error("PUT failed with 500"));

    app.leader("c", "t");
    await hashed();
    await settle();
    expect(app.held()?.label).toBe("Not saved: index");
    app.leader("t", "h");
    await settle();

    expect(app.text()).toBe("he index note");
    expect(app.status()).toBe("Could not save");
    // Its own reading speaks for it now, so the list leaves it out.
    expect(app.held()).toBeNull();
    // Opening it wrote nothing: the one call is the failed flush.
    expect(saveNote).toHaveBeenCalledTimes(1);

    app.ex("w");
    await hashed();
    await settle();
    expect(saveNote).toHaveBeenLastCalledWith(
      "index.md",
      "he index note",
      false,
      await baseOf("the index note"),
    );
    expect(app.status()).toBe("Saved");
  });

  it("keeps the held note listed through a save in the other note", async () => {
    const app = await editing();
    saveNote.mockRejectedValueOnce(new Error("PUT failed with 500"));

    app.leader("c", "t");
    await hashed();
    await settle();
    app.click("other.md");
    await settle();
    app.press("x");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    await hashed();
    await settle();

    expect(saveNote).toHaveBeenLastCalledWith(
      "other.md",
      "he other note",
      false,
      await baseOf("the other note"),
    );
    expect(app.status()).toBe("Saved");
    expect(app.held()?.label).toBe("Not saved: index");
  });

  it("keeps the text when leaving the editor route fails to save it, and says so on return", async () => {
    const app = await editing();
    saveNote.mockRejectedValueOnce(new Error("PUT failed with 502"));

    await app.navigate("/capture");
    await hashed();
    await settle();
    expect(saveNote).toHaveBeenCalledWith(
      "index.md",
      "he index note",
      false,
      await baseOf("the index note"),
    );
    await app.navigate("/");
    await settle();

    // The return restores the pane the note was left in, which opens on the
    // held text: the buffer holds it, so the bar reads the note rather than
    // listing it among the others.
    expect(app.text()).toBe("he index note");
    expect(heldText("index.md")?.content).toBe("he index note");
    expect(app.status()).toBe("Could not save");
    expect(app.held()).toBeNull();
  });

  it("writes nothing when the editor route is left while the note stands conflicted", async () => {
    const app = await editing();
    somebodyElseWrote();
    await settle();

    await app.navigate("/capture");
    await settle();
    expect(saveNote).not.toHaveBeenCalled();
    await app.navigate("/");
    await settle();

    // The return restores the pane the note was left in, which opens on the
    // kept text and stands conflicted again, writing nothing until asked.
    expect(app.text()).toBe("he index note");
    expect(app.status()).toBe("Changed on disk");
    expect(heldText("index.md")).toMatchObject({ content: "he index note", conflicted: true });
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("keeps a flush that fails after the note was reopened on screen, and saves it from there", async () => {
    // Back on the route and in the note before the flush answers: the buffer
    // opens on the flush's text (#303), and takes the entry its failure holds,
    // so the screen keeps the text and never flips back (#387).
    const app = await editing();
    let fail: (() => void) | undefined;
    saveNote.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          fail = () => reject(new Error("PUT failed with 502"));
        }),
    );

    await app.navigate("/capture");
    await hashed();
    await settle();
    await app.navigate("/");
    await settle();
    app.click("index.md");
    await settle();
    expect(app.text()).toBe("he index note");
    await act(async () => fail?.());
    await settle();

    expect(app.text()).toBe("he index note");
    expect(app.status()).toBe("Could not save");
    expect(app.held()).toBeNull();
    app.press("x");
    app.press("x");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    await hashed();
    await settle();

    expect(saveNote).toHaveBeenLastCalledWith(
      "index.md",
      " index note",
      false,
      await baseOf("the index note"),
    );
    expect(app.held()).toBeNull();
    expect(heldText("index.md")).toBeUndefined();
  });

  it("writes the waiting text with keepalive when the page goes away", async () => {
    await editing();

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await settle();

    // Naming its base, so a page going away cannot write over somebody else.
    expect(saveNote).toHaveBeenCalledWith(
      "index.md",
      "he index note",
      true,
      noteBase("the index note"),
    );
  });

  /** Text a page before this one held for index.md, as a reload finds it. */
  function heldBeforeReload() {
    holdText("index.md", {
      content: "he index note",
      reason: "Not yet written when the page was hidden",
      conflicted: false,
    });
    resetHeld();
  }

  it("offers text held before a reload in the buffer, with vim off, and the bar's button writes it", async () => {
    localStorage.setItem("kasten.vim", "off");
    try {
      heldBeforeReload();
      const app = await renderApp();
      await settle();
      expect(app.held()?.label).toBe("Not saved: index");
      app.click("index.md");
      await settle();

      expect(document.querySelector(".cm-vimMode")).toBeNull();
      expect(app.text()).toBe("he index note");
      expect(app.status()).toBe("Could not save");
      expect(saveNote).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId("save-status"));
      fireEvent.click(screen.getByRole("button", { name: "Write my text" }));
      await hashed();
      await settle();
    } finally {
      localStorage.removeItem("kasten.vim");
    }

    expect(saveNote).toHaveBeenLastCalledWith(
      "index.md",
      "he index note",
      false,
      await baseOf("the index note"),
    );
    expect(heldText("index.md")).toBeUndefined();
  });

  it("drops text held before a reload with the bar's button, with vim off", async () => {
    localStorage.setItem("kasten.vim", "off");
    try {
      heldBeforeReload();
      const app = await renderApp();
      await settle();
      app.click("index.md");
      await settle();
      expect(app.text()).toBe("he index note");

      fireEvent.click(screen.getByTestId("save-status"));
      fireEvent.click(screen.getByRole("button", { name: "Drop my text" }));
      await settle();

      expect(app.text()).toBe("the index note");
      expect(app.status()).toBe("Saved");
    } finally {
      localStorage.removeItem("kasten.vim");
    }

    expect(saveNote).not.toHaveBeenCalled();
    expect(heldText("index.md")).toBeUndefined();
  });

  it("lists a second held text of the open note, and leaves out only the one in the buffer", async () => {
    heldBeforeReload();
    holdText("index.md", {
      content: "the index note!",
      reason: "PUT failed with 502",
      conflicted: false,
    });
    resetHeld();
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();

    expect(app.text()).toBe("he index note");
    expect(app.status()).toBe("Could not save");
    expect(app.held()?.label).toBe("Not saved: index");
    expect(app.held()?.title).toContain("index.md: PUT failed with 502");
    expect(app.held()?.title).not.toContain("hidden");
  });

  it("drops held text the vault already holds when the note is opened", async () => {
    // A keepalive write that landed after the page was gone: the vault's copy
    // differs from what was sent by the stamp alone.
    fetchNote.mockImplementation(async (path: string) =>
      path === "index.md"
        ? "---\nmodified: 2026-10-14T10:00:03+00:00\n---\nhe index note"
        : VAULT[path],
    );
    holdText("index.md", {
      content: "---\nmodified: 2026-10-14T10:00:00+00:00\n---\nhe index note",
      reason: "Not yet written when the page was hidden",
      conflicted: false,
    });
    resetHeld();
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();

    expect(app.status()).toBe("Saved");
    expect(app.held()).toBeNull();
    expect(heldText("index.md")).toBeUndefined();
    expect(saveNote).not.toHaveBeenCalled();
  });
});
