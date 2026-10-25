import { EditorView } from "@codemirror/view";
import { fireEvent, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { NoteMissing, type TodoHit } from "@/lib/api";
import { noteBase } from "@/lib/note-base";
import { parseTodo, patchLine, type Todo } from "@/lib/todo";
import { blockLine } from "@/lib/todo-blocked";
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

/** The done line the editor writes: the editor stamps a fresh `🆔`, so its hex is not fixed. */
const DONE_LINE = /^- \[x\] a 🔁 every week 📅 2026-10-20 ✅ 2026-10-25 🆔 kt-[0-9a-f]+ more$/;

/** The line with one field of its todo changed, every other byte kept. */
function edited(line: string, change: Partial<Todo>): string {
  const todo = parseTodo(line);
  if (todo === null) throw new Error(`not a todo: ${line}`);
  return patchLine(line, { ...todo, ...change });
}

describe("#1030 a recurrence stops at a cut field", () => {
  it("#1030 A1a readFields on a recurrence with a due date after it reads the rule and keeps the words", () => {
    const { recurrence, text } = readFields("a 🔁 every week 📅 2026-10-20 more");

    expect({ recurrence, text }).toEqual({ recurrence: "every week", text: "a more" });
  });

  it("#1030 A1b readFields on a recurrence with a priority after it reads the rule and keeps the words", () => {
    const { recurrence, text } = readFields("a 🔁 every day ⏫ more");

    expect({ recurrence, text }).toEqual({ recurrence: "every day", text: "a more" });
  });
});

describe("#1030 a bare field before a cut field keeps its words", () => {
  it("#1030 A2 readFields on a bare blocker before a due date reads no blocker and keeps the marker", () => {
    const { blockedBy, text } = readFields("a ⛔ 📅 2026-10-20 more");

    expect({ blockedBy, text }).toEqual({ blockedBy: [], text: "a ⛔ more" });
  });

  it("#1030 A3a readFields on a bare estimate before a due date reads no estimate and keeps the marker", () => {
    const { estimate, text } = readFields("a ⏲ 📅 2026-10-20 more");

    expect({ estimate, text }).toEqual({ estimate: undefined, text: "a ⏲ more" });
  });

  it("#1030 A3b readFields on a bare worked before a due date reads no worked and keeps the marker", () => {
    const { worked, text } = readFields("a ⏱ 📅 2026-10-20 more");

    expect({ worked, text }).toEqual({ worked: undefined, text: "a ⏱ more" });
  });

  it("#1030 A3c readFields on a bare id before a due date reads no id and keeps the marker", () => {
    const { id, text } = readFields("a 🆔 📅 2026-10-20 more");

    expect({ id, text }).toEqual({ id: undefined, text: "a 🆔 more" });
  });
});

describe("#1030 the value stops at a cut field in the editor", () => {
  it("#1030 I1a Space s x on a recurring line with a due date after the rule writes the next copy above the done line", () => {
    const { editor, doc } = open("- [ ] a 🔁 every week 📅 2026-10-20 more");

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "s" });
    fireEvent.keyDown(editor, { key: "x" });

    expect(doc().split("\n")).toEqual([
      "- [ ] a more 📅 2026-10-27 🔁 every week",
      expect.stringMatching(DONE_LINE),
    ]);
  });

  it("#1030 I1b one undo after Space s x on a recurring line restores the line", () => {
    const { editor, doc } = open("- [ ] a 🔁 every week 📅 2026-10-20 more");

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "s" });
    fireEvent.keyDown(editor, { key: "x" });
    fireEvent.keyDown(editor, { key: "u" });

    expect(doc()).toBe("- [ ] a 🔁 every week 📅 2026-10-20 more");
  });

  it("#1030 I2 done with vim off on a recurring line with a due date after the rule writes the next copy above the done line", () => {
    localStorage.setItem("kasten.vim", "off");
    const { editor, doc } = open("- [ ] a 🔁 every week 📅 2026-10-20 more");
    const view = EditorView.findFromDOM(editor) as EditorView;

    cycleTodoAtCursor(view, "done");

    expect(doc().split("\n")).toEqual([
      "- [ ] a more 📅 2026-10-27 🔁 every week",
      expect.stringMatching(DONE_LINE),
    ]);
  });
});

describe("#1030 the value stops at a cut field in the pane", () => {
  it("#1030 I3 cycle to done on a recurring line with a due date after the rule writes the next copy above the done line", () => {
    const line = "- [ ] a 🔁 every week 📅 2026-10-20 more";

    expect(
      cycleLines({
        lines: [line],
        line: 1,
        today: TODAY,
        id: "kt-3f9a2c",
        closed: UNKNOWN,
        state: "done",
      }).get(1),
    ).toBe(
      "- [ ] a more 📅 2026-10-27 🔁 every week\n- [x] a 🔁 every week 📅 2026-10-20 ✅ 2026-08-10 🆔 kt-3f9a2c more",
    );
  });
});

describe("#1030 the value stops at a cut field by touch", () => {
  theRoute();
  beforeEach(() => {
    vi.mocked(searchNotes).mockResolvedValue([]);
  });

  it("#1030 I4 by touch, done on a recurring row with a due date after the rule keeps the words in the note", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const PATH = "inbox.md";
    const line = "- [ ] a 🔁 every week 📅 2026-10-20 more";
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
      "- [ ] a more 📅 2026-10-27 🔁 every week",
      expect.stringMatching(DONE_LINE),
    ]);
  });
});

describe("#1030 a stamp keeps the words after a bare field", () => {
  it("#1030 I5a worked set on a line with a bare worked before a due date keeps the date and the words", () => {
    const out = edited("- [ ] a ⏱ 📅 2026-10-20 more", { worked: "1h" });

    expect({ out, worked: parseTodo(out)?.worked }).toEqual({
      out: "- [ ] a ⏱ 📅 2026-10-20 ⏱ 1h more",
      worked: "1h",
    });
  });

  it("#1030 I5b id set on a line with a bare id before a due date keeps the date and the words", () => {
    const out = edited("- [ ] a 🆔 📅 2026-10-20 more", { id: "kt-3f9a2c" });

    expect({ out, id: parseTodo(out)?.id }).toEqual({
      out: "- [ ] a 🆔 📅 2026-10-20 🆔 kt-3f9a2c more",
      id: "kt-3f9a2c",
    });
  });
});

describe("#1030 guards that already hold on main", () => {
  // These pass on main too: the blocker, on-completion and recurrence values
  // stop where they always did. They pin the stops the fix adds so a later
  // change cannot trade them away.
  it("#1030 I6a a blocker hard against a due date reads its id and keeps the words", () => {
    const { blockedBy, text } = readFields("a ⛔ kt-1📅 2026-10-20 more");

    expect({ blockedBy, text }).toEqual({ blockedBy: ["kt-1"], text: "a more" });
  });

  it("#1030 I6b an on-completion hard against a priority reads its value", () => {
    expect(readFields("a 🏁 keep⏫ more").onCompletion).toBe("keep");
  });

  it("#1030 I6c a recurrence before a block id and a priority reads its rule", () => {
    expect(readFields("a 🔁 every week ^x ⏫").recurrence).toBe("every week");
  });
});

describe("#1030 blocking a line with a bare blocker before a due date", () => {
  it("#1030 I8 blocking a line with a bare blocker before a due date keeps the date and the words", () => {
    const out = blockLine("- [ ] a ⛔ 📅 2026-10-20 more", "kt-9", UNKNOWN);

    expect({ out, blockedBy: parseTodo(out ?? "")?.blockedBy }).toEqual({
      out: "- [b] a ⛔ 📅 2026-10-20 ⛔ kt-9 more",
      blockedBy: ["kt-9"],
    });
  });
});
