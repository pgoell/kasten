import { EditorView } from "@codemirror/view";
import { fireEvent, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { NoteMissing, type TodoHit } from "@/lib/api";
import { noteBase } from "@/lib/note-base";
import { formatTodo, parseTodo, patchLine, type Todo } from "@/lib/todo";
import { cycleTodoAtCursor } from "@/lib/todo-commands";
import { readFields } from "@/lib/todo-fields";
import { cycleLines } from "@/lib/todo-write";
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

/** The line with one field of its todo changed, every other byte kept. */
function edited(line: string, change: Partial<Todo>): string {
  const todo = parseTodo(line);
  if (todo === null) throw new Error(`not a todo: ${line}`);
  return patchLine(line, { ...todo, ...change });
}

describe("#1046 a bare one-word marker before another field keeps its words", () => {
  it("#1046 A1 readFields on a bare estimate before an id reads the id and keeps the marker", () => {
    const { estimate, id, text } = readFields("a ⏲ 🆔 kt-1 more");

    expect({ estimate, id, text }).toEqual({
      estimate: undefined,
      id: "kt-1",
      text: "a ⏲ more",
    });
  });

  it("#1046 A2 readFields on a bare worked before a blocker reads the blocker and keeps the marker", () => {
    const { worked, blockedBy, text } = readFields("a ⏱ ⛔ kt-1 more");

    expect({ worked, blockedBy, text }).toEqual({
      worked: undefined,
      blockedBy: ["kt-1"],
      text: "a ⏱ more",
    });
  });

  it("#1046 A3 readFields on a bare estimate before a blocker reads the blocker and keeps the marker", () => {
    const { estimate, blockedBy, text } = readFields("a ⏲ ⛔ kt-1 more");

    expect({ estimate, blockedBy, text }).toEqual({
      estimate: undefined,
      blockedBy: ["kt-1"],
      text: "a ⏲ more",
    });
  });
});

describe("#1046 a bare one-word marker before an id keeps its words in the editor", () => {
  it("#1046 A5 Space s x on a doing line with a bare estimate before its id writes one id", () => {
    const { editor, doc } = open("- [/] a ⏲ 🆔 kt-1 more");

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "s" });
    fireEvent.keyDown(editor, { key: "x" });

    expect(doc()).toEqual(expect.stringMatching(/^- \[x\] a ⏲ ✅ \d{4}-\d{2}-\d{2} 🆔 kt-1 more$/));
  });

  it("#1046 A6 done with vim off on a doing line with a bare estimate before its id writes one id", () => {
    localStorage.setItem("kasten.vim", "off");
    const { editor, doc } = open("- [/] a ⏲ 🆔 kt-1 more");
    const view = EditorView.findFromDOM(editor) as EditorView;

    cycleTodoAtCursor(view, "done");

    expect(doc()).toEqual(expect.stringMatching(/^- \[x\] a ⏲ ✅ \d{4}-\d{2}-\d{2} 🆔 kt-1 more$/));
  });

  it("#1046 I5 one undo after Space s x on a doing line with a bare estimate before its id restores the line", () => {
    const { editor, doc } = open("- [/] a ⏲ 🆔 kt-1 more");

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "s" });
    fireEvent.keyDown(editor, { key: "x" });
    fireEvent.keyDown(editor, { key: "u" });

    expect(doc()).toBe("- [/] a ⏲ 🆔 kt-1 more");
  });
});

describe("#1046 a bare one-word marker before an id keeps its words in the pane", () => {
  it("#1046 A7 cycle to done in the pane on a doing line with a bare estimate before its id writes one id", () => {
    const line = "- [/] a ⏲ 🆔 kt-1 more";

    expect(
      cycleLines({
        lines: [line],
        line: 1,
        today: TODAY,
        id: "kt-3f9a2c",
        closed: UNKNOWN,
        state: "done",
      }).get(1),
    ).toBe(`- [x] a ⏲ ✅ ${TODAY} 🆔 kt-1 more`);
  });
});

describe("#1046 a bare one-word marker before an id keeps its words by touch", () => {
  theRoute();
  beforeEach(() => {
    vi.mocked(searchNotes).mockResolvedValue([]);
  });

  it("#1046 A8 by touch, done on a doing row with a bare estimate before its id writes one id", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const PATH = "inbox.md";
    const line = "- [/] a ⏲ 🆔 kt-1 more";
    const text = `## TODOs\n${line}`;
    const written = () =>
      (saveNote.mock.calls.find(([path]) => path === PATH)?.[1] as string | undefined)?.split("\n");
    const rows: TodoHit[] = [{ path: PATH, line: 2, text: line, project: null }];
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
    fireEvent.click(screen.getByLabelText(/^done /));
    await hashed();
    await settle();

    expect(written()?.slice(1)).toEqual([
      expect.stringMatching(/^- \[x\] a ⏲ ✅ \d{4}-\d{2}-\d{2} 🆔 kt-1 more$/),
    ]);
  });
});

describe("#1046 a bare one-word marker before an id keeps its words in readFields", () => {
  it("#1046 I1 readFields on a bare worked before an id reads the id and keeps the marker", () => {
    const { worked, id, text } = readFields("a ⏱ 🆔 kt-1 more");

    expect({ worked, id, text }).toEqual({
      worked: undefined,
      id: "kt-1",
      text: "a ⏱ more",
    });
  });

  it("#1046 I2 readFields on a bare id before a blocker reads the blocker and keeps the marker", () => {
    const { id, blockedBy, text } = readFields("a 🆔 ⛔ kt-1 more");

    expect({ id, blockedBy, text }).toEqual({
      id: undefined,
      blockedBy: ["kt-1"],
      text: "a 🆔 more",
    });
  });

  it("#1046 I3 readFields on a bare blocker before a blocker reads one blocker and keeps the marker", () => {
    const { blockedBy, text } = readFields("a ⛔ ⛔ kt-1 more");

    expect({ blockedBy, text }).toEqual({ blockedBy: ["kt-1"], text: "a ⛔ more" });
  });

  it("#1046 I4 readFields on a bare estimate before an id typed with the variation selector reads the id", () => {
    const { estimate, id, text } = readFields("a ⏲️ 🆔️ kt-1 more");

    expect({ estimate, id, text }).toEqual({
      estimate: undefined,
      id: "kt-1",
      text: "a ⏲️ more",
    });
  });

  it("#1046 I8 readFields on a bare estimate before a worked reads the worked and keeps the marker", () => {
    const { estimate, worked, text } = readFields("a ⏲ ⏱ 1h more");

    expect({ estimate, worked, text }).toEqual({
      estimate: undefined,
      worked: "1h",
      text: "a ⏲ more",
    });
  });
});

describe("#1046 a stamp keeps the words after a bare estimate before an id", () => {
  it("#1046 I6 setting an estimate on a line with a bare estimate before its id keeps the id and the words", () => {
    const out = edited("- [ ] a ⏲ 🆔 kt-1 more", { estimate: "2h" });

    expect({ out, todo: parseTodo(out) }).toEqual({
      out: "- [ ] a ⏲ ⏲ 2h more 🆔 kt-1",
      todo: expect.objectContaining({ estimate: "2h", id: "kt-1", text: "a ⏲ more" }),
    });
  });
});

describe("#1046 guards that pass on main too", () => {
  // These pass on main too: each one-word field reads its own value on a plain
  // line. They pin that the fix does not trade that reading away.
  it("#1046 I7 readFields on a plain line with every one-word field reads each one", () => {
    const { estimate, worked, id, blockedBy, text } = readFields(
      "a ⏲ 2h ⏱ 1h 🆔 kt-1 ⛔ kt-2 more",
    );

    expect({ estimate, worked, id, blockedBy, text }).toEqual({
      estimate: "2h",
      worked: "1h",
      id: "kt-1",
      blockedBy: ["kt-2"],
      text: "a more",
    });
  });
});

describe("#1046 a rebuild moves no field on a line without the bug", () => {
  it("#1046 B1 setting an estimate on a line with a bare blocker before a due date and a bare on-completion keeps the on-completion words", () => {
    expect(edited("- [ ] a ⛔ 📅 2026-10-20 b 🏁 x ⏲ 1h", { estimate: "2h" })).toBe(
      "- [ ] a ⛔ 📅 2026-10-20 b 🏁 x ⏲ 2h",
    );
  });

  it("#1046 B2 rebuilding a line with a bare blocker before a due date and a bare on-completion keeps the id at the end", () => {
    const todo = parseTodo("- [ ] a ⛔ 📅 2026-10-20 b 🏁 x 🆔 kt-1");

    expect(todo === null ? "" : formatTodo(todo)).toBe("- [ ] a ⛔ 📅 2026-10-20 b 🏁 x 🆔 kt-1");
  });
});
