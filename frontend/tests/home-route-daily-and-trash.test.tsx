import { useMemo } from "react";
import type { TodoHit } from "@/lib/api";
import type { PdfRenderer } from "@/lib/book/pdf-view";
import { noteBase } from "@/lib/note-base";
import type { TodoState } from "@/lib/todo/todo";
import { hashed } from "./digests";
import { defineFoliateFake } from "./foliate-fake";
import {
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

  it("puts the cursor in the editor when a note is opened from the file tree", async () => {
    // The tree holds the focus while its own keys are being pressed, and the
    // editor takes the focus on mount only when nothing else holds it. Without
    // the focus being raised with the note, the note arrives on screen and
    // every key after it goes on reaching the tree.
    const app = await renderApp();
    await settle();

    const row = document.querySelector("[title='other.md']") as HTMLElement;
    row.focus();
    expect(document.activeElement).toBe(row);

    app.click("other.md");
    await settle();

    expect(document.activeElement?.className).toContain("cm-content");
    expect(app.text()).toBe("the other note");
  });

  it("makes today's daily note with its links and opens it", async () => {
    // The body goes into the `POST` that makes the note, so a periodic note
    // costs one write. `periodic.test.ts` pins what that body says for every
    // other grain.
    vi.setSystemTime(new Date(2026, 7, 6, 9, 30));
    const path = "01 Periodic/00 Daily/2026-08-06.md";
    const body =
      "---\ntype: Periodic Note\n---\n\n# 2026-08-06 Thursday\n\n" +
      "[[01 Periodic/00 Daily/2026-08-05]] | [[01 Periodic/01 Weekly/2026-W32]] |" +
      " [[01 Periodic/00 Daily/2026-08-07]]\n" +
      // The one section a fresh note is made with. The add prompt writes here,
      // and `## Done` and `## Time` appear when there is something to put in them.
      "\n## TODOs\n";
    createNote.mockResolvedValue({ path, content: `---\nid: one\n---\n${body}` });

    const app = await renderApp();
    await settle();

    app.leader("g", "d");
    await settle();

    expect(createNote).toHaveBeenCalledWith(path, body);
    // The second write is what the reader's own editor used to read as another
    // writer: it lands on `/api/events` a moment after the note is opened, and
    // anything typed by then is unsaved text over a note that changed on disk.
    expect(saveNote).not.toHaveBeenCalled();
    expect(app.text()).toContain("2026-08-06 Thursday");
  });

  // Through the key rather than over `periodicNote`, because the fence has to
  // be the file's first line: the backend reads a block only where the fence
  // opens the text, so a caller prepending a newline would leave `type` sitting
  // in the body as prose with the template's own test still green.
  it.each([
    ["daily", ["g", "d"], "01 Periodic/00 Daily/2026-08-06.md"],
    ["weekly", ["g", "w"], "01 Periodic/01 Weekly/2026-W32.md"],
    ["monthly", ["g", "m"], "01 Periodic/02 Monthly/2026-08.md"],
    ["quarterly", ["g", "q"], "01 Periodic/03 Quarterly/2026-Q3.md"],
    ["yearly", ["g", "y"], "01 Periodic/04 Yearly/2026.md"],
  ] as [string, string[], string][])(
    "opens the %s note with a block saying it is periodic",
    async (_period, keys, path) => {
      vi.setSystemTime(new Date(2026, 7, 6, 9, 30));
      createNote.mockResolvedValue({ path, content: "" });

      const app = await renderApp();
      await settle();

      app.leader(...keys);
      await settle();

      const [written, body] = createNote.mock.calls[0] as [string, string];
      expect(written).toBe(path);
      expect(body.split("\n").slice(0, 3)).toEqual(["---", "type: Periodic Note", "---"]);
    },
  );

  it("moves the open note into the trash and empties the pane", async () => {
    deleteNote.mockResolvedValue({
      entry: "index.md@2026-08-11T14-03-02.481337",
      path: "index.md",
      deleted: "2026-08-11T14:03:02Z",
    });
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();

    app.leader("d", "f");
    await settle();

    expect(deleteNote).toHaveBeenCalledWith("index.md");
    // The pane is empty, so nothing on screen is holding a note that is gone,
    // and the listing is asked for again.
    expect(app.text()).toBe("");
    expect(fetchFiles.mock.calls.length).toBeGreaterThan(1);
  });

  it("writes what is waiting before it deletes the note", async () => {
    // The trash holds what was on disk, so the text typed a moment ago has to
    // be on disk before the note moves into it.
    deleteNote.mockResolvedValue({
      entry: "index.md@2026-08-11T14-03-02.481337",
      path: "index.md",
      deleted: "2026-08-11T14:03:02Z",
    });
    const app = await editing();

    app.leader("d", "f");
    await hashed();
    await settle();

    expect(saveNote).toHaveBeenCalledWith(
      "index.md",
      "he index note",
      false,
      await baseOf("the index note"),
    );
    // A call that never happened has no order, and `0` is below every real one,
    // so a delete that skipped the save fails here rather than passing empty.
    expect(saveNote.mock.invocationCallOrder[0]).toBeLessThan(
      deleteNote.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("refuses to delete a note that changed on disk", async () => {
    const app = await editing();
    somebodyElseWrote();
    await settle();

    app.leader("d", "f");
    await settle();

    expect(deleteNote).not.toHaveBeenCalled();
    expect(app.status()).toBe("Changed on disk");
  });

  it("puts the last deleted note back and opens it", async () => {
    fetchTrash.mockResolvedValue([
      {
        entry: "other.md@2026-08-11T14-03-02.481337",
        path: "other.md",
        deleted: "2026-08-11T14:03:02Z",
      },
    ]);
    restoreEntry.mockResolvedValue("other.md");
    const app = await renderApp();
    await settle();

    app.leader("d", "u");
    await settle();

    expect(restoreEntry).toHaveBeenCalledWith("other.md@2026-08-11T14-03-02.481337");
    expect(app.text()).toBe("the other note");
  });

  it("flashes the bar when the trash has nothing to put back", async () => {
    fetchTrash.mockResolvedValue([]);
    const app = await renderApp();
    await settle();
    // With a note open, because the bar is what a refusal is seen in and an
    // empty pane draws no reading at all.
    app.click("index.md");
    await settle();

    app.leader("d", "u");
    await settle();

    expect(restoreEntry).not.toHaveBeenCalled();
    expect(app.flashing()).toBe(true);
  });

  it("opens the daily note the vault already holds without writing to it", async () => {
    vi.setSystemTime(new Date(2026, 7, 6, 9, 30));
    const path = "01 Periodic/00 Daily/2026-08-06.md";
    fetchFiles.mockResolvedValue([...Object.keys(VAULT), path]);
    fetchNote.mockImplementation(async () => "# 2026-08-06 Thursday");

    const app = await renderApp();
    await settle();

    app.leader("g", "d");
    await settle();

    expect(createNote).not.toHaveBeenCalled();
    expect(saveNote).not.toHaveBeenCalled();
    expect(app.text()).toContain("2026-08-06 Thursday");
  });
});
