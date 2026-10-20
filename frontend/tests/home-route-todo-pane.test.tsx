import { fireEvent, screen } from "@testing-library/react";
import { useMemo } from "react";
import type { TodoHit } from "@/lib/api";
import { noteBase } from "@/lib/note-base";
import type { PdfRenderer } from "@/lib/pdf-view";
import type { TodoState } from "@/lib/todo";
import { hashed } from "./digests";
import { defineFoliateFake } from "./foliate-fake";
import { act, pageHooks, renderApp, settle, stream, theRoute, VAULT } from "./home-route-fixture";
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

  it("puts the todo list in the focused pane and takes it back out", async () => {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();

    app.leader("g", "t");
    await settle();
    expect(app.todoPane()).not.toBeNull();

    // Emptying rather than removing: the pane stays on screen, so a window
    // holding only the list still has a way back to an editor.
    fireEvent.keyDown(app.todoPane() as HTMLElement, { key: " " });
    fireEvent.keyDown(app.todoPane() as HTMLElement, { key: "q" });
    await settle();

    expect(app.todoPane()).toBeNull();
    expect(app.panes()).toBe(1);
  });

  it("edits a todo from the pane, and leaves the keys where the cursor is", async () => {
    const note = ["# Kasten", "", "- [ ] call the dentist 🆔 kt-3f9a2c"].join("\n");
    fetchFiles.mockResolvedValue([...Object.keys(VAULT), "projects/kasten.md"]);
    fetchNote.mockImplementation(async (path: string) => VAULT[path] ?? note);
    const row = {
      path: "projects/kasten.md",
      line: 3,
      text: "- [ ] call the dentist 🆔 kt-3f9a2c",
    };
    const edited = "- [ ] call the dentist ⏳ 2026-08-11 🆔 kt-3f9a2c";
    // What the vault answers once the write has landed, which is what moves the
    // row out of No date and into This week, and so out of the DOM node the
    // prompt took the focus from.
    fetchTodos.mockImplementation(async () =>
      saveNote.mock.calls.length > 0 ? [{ ...row, text: edited }] : [row],
    );

    const app = await renderApp();
    await settle();
    app.leader("g", "t");
    await settle();

    // Focused first, the way a pane you are pressing keys into is: the pane
    // hands the keys back only where they were already its.
    (app.todoPane() as HTMLElement).focus();
    fireEvent.keyDown(app.todoPane() as HTMLElement, { key: "i" });
    const field = app.editedLine() as HTMLInputElement;
    // The line as the vault holds it, which is what makes `⏳` reachable: no
    // shorthand spells a scheduled date.
    expect(field.value).toBe("- [ ] call the dentist 🆔 kt-3f9a2c");

    fireEvent.change(field, { target: { value: edited } });
    fireEvent.keyDown(field, { key: "Enter" });
    await settle();

    expect(saveNote).toHaveBeenCalledWith(
      "projects/kasten.md",
      ["# Kasten", "", edited].join("\n"),
      false,
      expect.any(String),
    );
    // The row the input replaced is gone, redrawn under another heading by the
    // write, so the focus handed back to it landed on the body and the pane was
    // deaf to every key after it.
    expect(app.todoPane()?.contains(document.activeElement)).toBe(true);
  });

  it("B3 a folder moved or a note deleted asks the todos again, so the board's lanes follow", async () => {
    const daily = "01 Periodic/00 Daily/2026-08-10.md";
    const row = { path: daily, line: 1, text: "- [ ] send deck [[Kickoff]]" };
    // The vault as each event leaves it: the folder renamed, then the note gone.
    let kickoff: string | null = "02 Projects/FDE/Kickoff.md";
    const project = () => (kickoff === null ? null : kickoff.slice(0, kickoff.lastIndexOf("/")));
    fetchFiles.mockImplementation(async () => [
      ...Object.keys(VAULT),
      daily,
      ...(kickoff === null ? [] : [kickoff]),
    ]);
    fetchTodos.mockImplementation(async () => [{ ...row, project: project() }]);

    const app = await renderApp();
    await settle();
    app.leader("g", "t");
    await settle();
    const pane = app.todoPane() as HTMLElement;
    pane.focus();
    fireEvent.keyDown(pane, { key: "c" });
    fireEvent.keyDown(pane, { key: "g" });
    await settle();
    const lanes = () => [...pane.querySelectorAll("h3")].map((one) => one.textContent);
    expect(lanes()).toEqual(["FDE"]);
    const asked = fetchTodos.mock.calls.length;

    kickoff = "02 Projects/FDE Client/Kickoff.md";
    act(() => stream().send({ path: "", change: "listing", digest: null }));
    await settle();
    expect(fetchTodos).toHaveBeenCalledTimes(asked + 1);
    expect(lanes()).toEqual(["FDE Client"]);

    kickoff = null;
    act(() =>
      stream().send({ path: "02 Projects/FDE Client/Kickoff.md", change: "removed", digest: null }),
    );
    await settle();
    expect(fetchTodos).toHaveBeenCalledTimes(asked + 2);
    expect(lanes()).toEqual(["No project"]);
  });

  describe("a state the vault refuses", () => {
    it("#397 I3 a state write the vault refuses leaves the card and says so", async () => {
      const row = { path: "daily.md", line: 2, text: "- [ ] send the deck", project: null };
      const text = "## TODOs\n- [ ] send the deck";
      fetchFiles.mockImplementation(async () => [...Object.keys(VAULT), row.path]);
      fetchNote.mockImplementation(async (path: string) =>
        path === row.path ? text : VAULT[path],
      );
      fetchTodos.mockResolvedValue([row]);
      saveNote.mockRejectedValue(new Error("PUT failed with 500"));
      const app = await renderApp();
      await settle();
      app.leader("g", "t");
      await settle();
      const pane = app.todoPane() as HTMLElement;
      pane.focus();

      fireEvent.keyDown(pane, { key: "x" });
      await hashed();
      await settle();

      expect(saveNote).toHaveBeenCalled();
      expect(pane.textContent).toContain("send the deck");
      expect(app.notice()).toBe("Nothing moved: PUT failed with 500");
    });
  });

  describe("a press on a row whose line moved under it", () => {
    const PATH = "inbox.md";

    /**
     * The pane listing `rows`, over a note the vault serves as `text` at the
     * write. Opened by the toolbar's button on a phone, which has no leader.
     */
    async function listing(rows: TodoHit[], text: string, phone = false) {
      fetchFiles.mockImplementation(async () => [...Object.keys(VAULT), PATH]);
      fetchNote.mockImplementation(async (path: string) => (path === PATH ? text : VAULT[path]));
      fetchTodos.mockResolvedValue(rows);
      const app = await renderApp();
      await settle();
      if (phone) fireEvent.click(screen.getByRole("button", { name: "Open the todo pane" }));
      else app.leader("g", "t");
      await settle();
      return app;
    }

    /** The lines of what the press wrote to the note, or undefined where it wrote none. */
    const written = () =>
      (saveNote.mock.calls.find(([path]) => path === PATH)?.[1] as string | undefined)?.split("\n");

    const TWINS = [
      { path: PATH, line: 1, text: "- [ ] a", project: null },
      { path: PATH, line: 2, text: "- [ ] a", project: null },
    ];
    /** A line written above both twins since the listing. */
    const SHIFTED = "## TODOs\n- [ ] a\n- [ ] a";

    it("#529 A2 a timer press that cannot find its todo says Nothing moved", async () => {
      const app = await listing(
        [{ path: PATH, line: 2, text: "- [ ] send the deck", project: null }],
        "## TODOs\n- [ ] buy milk",
      );
      const pane = app.todoPane() as HTMLElement;
      pane.focus();

      fireEvent.keyDown(pane, { key: "t" });
      await hashed();
      await settle();

      expect(saveNote).not.toHaveBeenCalled();
      expect(app.notice()).toBe("Nothing moved: that line has changed since it was listed");
    });

    it("#530 A5 the pane's X on a twin sets that twin after a shift", async () => {
      const app = await listing(TWINS, SHIFTED);
      const pane = app.todoPane() as HTMLElement;
      pane.focus();

      fireEvent.keyDown(pane, { key: "j" });
      fireEvent.keyDown(pane, { key: "X" });
      await hashed();
      await settle();

      expect(written()?.[1]).toBe("- [ ] a");
      expect(written()?.[2]).toMatch(/^- \[x\] a/);
    });

    it("#530 A5 the phone strip's done on a twin sets that twin after a shift", async () => {
      stubMatchMedia({ [NARROW]: true, [COARSE]: true });
      await listing(TWINS, SHIFTED, true);

      fireEvent.click(screen.getAllByLabelText("more for a")[1] as HTMLElement);
      fireEvent.click(screen.getByLabelText("done a"));
      await hashed();
      await settle();

      expect(written()?.[1]).toBe("- [ ] a");
      expect(written()?.[2]).toMatch(/^- \[x\] a/);
    });
  });
});
