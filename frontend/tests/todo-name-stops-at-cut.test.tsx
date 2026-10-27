import { EditorView } from "@codemirror/view";
import { fireEvent, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { NoteMissing, type TodoHit } from "@/lib/api";
import { noteBase } from "@/lib/note-base";
import { cycleTodoAtCursor } from "@/lib/todo/todo-commands";
import { patchFields, readFields } from "@/lib/todo/todo-fields";
import { cycleLines } from "@/lib/todo/todo-write";
import { hashed } from "./digests";
import { defineFoliateFake } from "./foliate-fake";
import { pageHooks, renderApp, settle, theRoute, VAULT } from "./home-route-fixture";
import { open } from "./keybindings-fixture";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";
import { TODAY, UNKNOWN } from "./todo-write-fixture";

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
vi.mock("@/lib/outbox", () => ({
  keep: vi.fn(),
  flush: vi.fn(),
  start: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));

pageHooks();

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.removeItem("kasten.vim");
});

/** One press that names open over a note holding only this line. */
function setOpen(line: string) {
  return cycleLines({
    lines: [line],
    line: 1,
    today: TODAY,
    id: "kt-3f9a2c",
    closed: UNKNOWN,
    state: "open",
  });
}

describe("#1027 the name stops at a cut field in the editor", () => {
  it("#1027 A1a Space s o on a waiting line whose estimate sits after the name keeps the words after it", () => {
    const rest = "a 👤 2026-10-25 Ada ⏲ 2h more";
    const { editor, doc } = open(`- [w] ${rest}`);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "s" });
    fireEvent.keyDown(editor, { key: "o" });

    expect({ doc: doc(), waitingOn: readFields(rest).waitingOn }).toEqual({
      doc: "- [ ] a ⏲ 2h more",
      waitingOn: "Ada",
    });
  });

  it("#1027 A1b Space s o on a waiting line whose due date sits after the name keeps the words after it", () => {
    const rest = "a 👤 2026-10-25 Ada 📅 2026-10-20 more";
    const { editor, doc } = open(`- [w] ${rest}`);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "s" });
    fireEvent.keyDown(editor, { key: "o" });

    expect({ doc: doc(), waitingOn: readFields(rest).waitingOn }).toEqual({
      doc: "- [ ] a 📅 2026-10-20 more",
      waitingOn: "Ada",
    });
  });

  it("#1027 A1c Space s o on a waiting line whose blocker sits after the name keeps the words after it", () => {
    const rest = "a 👤 2026-10-25 Ada ⛔ kt-1 more";
    const { editor, doc } = open(`- [w] ${rest}`);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "s" });
    fireEvent.keyDown(editor, { key: "o" });

    expect({ doc: doc(), waitingOn: readFields(rest).waitingOn }).toEqual({
      doc: "- [ ] a ⛔ kt-1 more",
      waitingOn: "Ada",
    });
  });

  it("#1027 I2 Space s o with vim off on a waiting line whose estimate sits after the name keeps the words after it", () => {
    localStorage.setItem("kasten.vim", "off");
    const { editor, doc } = open("- [w] a 👤 2026-10-25 Ada ⏲ 2h more");
    const view = EditorView.findFromDOM(editor) as EditorView;

    cycleTodoAtCursor(view, "open");

    expect(doc()).toBe("- [ ] a ⏲ 2h more");
  });

  it("#1027 I4 Space s o on a waiting line whose estimate sits before a bare wait keeps the words after it", () => {
    const rest = "a 👤 2026-10-25 ⏲ 2h more";
    const { editor, doc } = open(`- [w] ${rest}`);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "s" });
    fireEvent.keyDown(editor, { key: "o" });

    expect({ doc: doc(), waitingOn: readFields(rest).waitingOn }).toEqual({
      doc: "- [ ] a ⏲ 2h more",
      waitingOn: undefined,
    });
  });

  it("#1027 I6 one undo after Space s o on a waiting line whose estimate sits after the name restores the line", () => {
    const { editor, doc } = open("- [w] a 👤 2026-10-25 Ada ⏲ 2h more");

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "s" });
    fireEvent.keyDown(editor, { key: "o" });
    const after = doc();
    fireEvent.keyDown(editor, { key: "u" });

    expect({ after, undone: doc() }).toEqual({
      after: "- [ ] a ⏲ 2h more",
      undone: "- [w] a 👤 2026-10-25 Ada ⏲ 2h more",
    });
  });
});

describe("#1027 the name stops at a cut field in the pane", () => {
  it("#1027 A2a cycle to open on a waiting line whose estimate sits after the name keeps the words after it", () => {
    expect(setOpen("- [w] a 👤 2026-10-25 Ada ⏲ 2h more").get(1)).toBe("- [ ] a ⏲ 2h more");
  });

  it("#1027 A2b cycle to open on a waiting line whose due date sits after the name keeps the words after it", () => {
    expect(setOpen("- [w] a 👤 2026-10-25 Ada 📅 2026-10-20 more").get(1)).toBe(
      "- [ ] a 📅 2026-10-20 more",
    );
  });

  it("#1027 A2c cycle to open on a waiting line whose blocker sits after the name keeps the words after it", () => {
    expect(setOpen("- [w] a 👤 2026-10-25 Ada ⛔ kt-1 more").get(1)).toBe("- [ ] a ⛔ kt-1 more");
  });
});

describe("#1027 the name stops at a cut field by touch", () => {
  theRoute();
  beforeEach(() => {
    vi.mocked(searchNotes).mockResolvedValue([]);
  });

  it("#1027 I3 by touch, open on a waiting row whose estimate sits after the name keeps the words after it", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const PATH = "inbox.md";
    const line = "- [w] a 👤 2026-10-25 Ada ⏲ 2h more";
    const text = `## TODOs\n${line}`;
    const written = () =>
      (saveNote.mock.calls.find(([path]) => path === PATH)?.[1] as string | undefined)?.split("\n");
    const rows: TodoHit[] = [{ path: PATH, line: 2, text: line, project: null, shared: false }];
    fetchFiles.mockImplementation(async () => [...Object.keys(VAULT), PATH]);
    // A note the vault lacks is NoteMissing, as the api answers it, not undefined.
    fetchNote.mockImplementation(async (path: string) => {
      if (path === PATH) return text;
      if (VAULT[path] === undefined) throw new NoteMissing(path);
      return VAULT[path];
    });
    fetchTodos.mockResolvedValue(rows);

    await renderApp();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Open the todo pane" }));
    await settle();
    fireEvent.click(screen.getByLabelText(/^more for /));
    fireEvent.click(screen.getByLabelText(/^open /));
    await hashed();
    await settle();

    expect(written()?.[1]).toBe("- [ ] a ⏲ 2h more");
  });
});

describe("#1027 reading the assignee past a cut field", () => {
  it("#1027 A3a readFields on an assignee with an estimate after it reads the name and keeps the words", () => {
    const { assignee, text } = readFields("a 👤 Bob ⏲ 2h more");

    expect({ assignee, text }).toEqual({ assignee: "Bob", text: "a more" });
  });

  it("#1027 A3b readFields on an assignee with a due date after it reads the name and keeps the words", () => {
    const { assignee, text } = readFields("a 👤 Bob 📅 2026-10-20 more");

    expect({ assignee, text }).toEqual({ assignee: "Bob", text: "a more" });
  });

  it("#1027 A3c readFields on an assignee with a blocker after it reads the name and keeps the words", () => {
    const { assignee, text } = readFields("a 👤 Bob ⛔ kt-1 more");

    expect({ assignee, text }).toEqual({ assignee: "Bob", text: "a more" });
  });

  it("#1027 A4a dropping the assignee with an estimate after it keeps the words after the estimate", () => {
    const rest = "a 👤 Bob ⏲ 2h more";

    expect(patchFields(rest, { ...readFields(rest), assignee: undefined })).toBe("a ⏲ 2h more");
  });

  it("#1027 A4b dropping the assignee with a due date after it keeps the words after the date", () => {
    const rest = "a 👤 Bob 📅 2026-10-20 more";

    expect(patchFields(rest, { ...readFields(rest), assignee: undefined })).toBe(
      "a 📅 2026-10-20 more",
    );
  });

  it("#1027 A4c dropping the assignee with a blocker after it keeps the words after the blocker", () => {
    const rest = "a 👤 Bob ⛔ kt-1 more";

    expect(patchFields(rest, { ...readFields(rest), assignee: undefined })).toBe("a ⛔ kt-1 more");
  });

  it("#1027 A5a changing the assignee with an estimate after it keeps the words after the estimate", () => {
    const rest = "a 👤 Bob ⏲ 2h more";

    expect(patchFields(rest, { ...readFields(rest), assignee: "Ada" })).toBe("a 👤 Ada ⏲ 2h more");
  });

  it("#1027 A5b changing the assignee with a due date after it keeps the words after the date", () => {
    const rest = "a 👤 Bob 📅 2026-10-20 more";

    expect(patchFields(rest, { ...readFields(rest), assignee: "Ada" })).toBe(
      "a 👤 Ada 📅 2026-10-20 more",
    );
  });

  it("#1027 A5c changing the assignee with a blocker after it keeps the words after the blocker", () => {
    const rest = "a 👤 Bob ⛔ kt-1 more";

    expect(patchFields(rest, { ...readFields(rest), assignee: "Ada" })).toBe(
      "a 👤 Ada ⛔ kt-1 more",
    );
  });
});
