// @vitest-environment node
import { NoteMissing } from "@/lib/core/api";
import { noteBase } from "@/lib/notes/note-base";
import { dailyDate, periodicNote } from "@/lib/notes/text/periodic";
import { toggleTimerInVault } from "@/lib/todo/todo-api";
import { todoApiHooks } from "./todo-api-fixture";

// Standing in for the module rather than for `fetch`, the way the pane's tests
// do: what this half owns is which notes it reads and what it sends back.
const { createNote, fetchNote, fetchTodos, saveNote, searchNotes, updateNote } = vi.hoisted(() => ({
  createNote: vi.fn(),
  fetchNote: vi.fn(),
  fetchTodos: vi.fn(),
  saveNote: vi.fn(),
  searchNotes: vi.fn(),
  updateNote: vi.fn(),
}));
vi.mock("@/lib/core/api", async (importOriginal) => {
  // The refusals the writes tell apart by class, which a factory leaving them
  // out would hand over as undefined.
  const real = await importOriginal<typeof import("@/lib/core/api")>();
  return {
    ChangedOnDisk: real.ChangedOnDisk,
    NoteExists: real.NoteExists,
    NoteMissing: real.NoteMissing,
    createNote,
    fetchNote,
    fetchTodos,
    saveNote,
    searchNotes,
    updateNote,
  };
});

todoApiHooks();

// The code stamps today's date at the write, after the test has read it. A run
// that crosses local midnight would see another day and the two would disagree
// (#1315), so the clock is pinned for every test and restored after it.
const NOW = new Date(2026, 7, 10, 12);

beforeEach(() => {
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("toggleTimerInVault", () => {
  const daily = periodicNote("daily", NOW).path;
  const clock = { date: dailyDate(daily) ?? "", time: "14:03" };

  it("#529 A1 a timer press finds its todo by its words where a line above shifted it", async () => {
    const notes: Record<string, string> = {
      "projects/kasten.md": "- [ ] written since\n- [ ] a 🆔 kt-aaaaaa\n",
      [daily]: "## Time\n",
    };
    fetchNote.mockImplementation(async (path: string) => notes[path]);

    await toggleTimerInVault(
      { path: "projects/kasten.md", line: 1, text: "- [ ] a 🆔 kt-aaaaaa" },
      clock,
    );

    expect(saveNote).toHaveBeenCalledExactlyOnceWith(
      daily,
      "## Time\n- 14:03-      a [[projects/kasten]] kt-aaaaaa\n",
      false,
      noteBase("## Time\n"),
    );
  });

  it("#529 A2 a timer press whose line now holds another todo writes nothing", async () => {
    const notes: Record<string, string> = {
      "projects/kasten.md": "- [ ] another\n",
      [daily]: "## Time\n",
    };
    fetchNote.mockImplementation(async (path: string) => notes[path]);

    await expect(
      toggleTimerInVault({ path: "projects/kasten.md", line: 1, text: "- [ ] a" }, clock),
    ).rejects.toThrow("that line has changed since it was listed");

    expect(saveNote).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
  });

  it("#529 I1 a second timer press before the redraw stops the session it started", async () => {
    // The first press stamped the id and opened a session; the row still says
    // what the list read before it.
    const open = "- 09:12-      a [[projects/kasten]] kt-aaaaaa";
    const notes: Record<string, string> = {
      "projects/kasten.md": "- [ ] a 🆔 kt-aaaaaa\n",
      [daily]: `## Time\n${open}\n`,
    };
    fetchNote.mockImplementation(async (path: string) => notes[path]);
    searchNotes.mockResolvedValue([
      { path: "projects/kasten.md", line: 1, text: "- [ ] a 🆔 kt-aaaaaa" },
      { path: daily, line: 2, text: open },
    ]);

    await toggleTimerInVault({ path: "projects/kasten.md", line: 1, text: "- [ ] a" }, clock);

    expect(saveNote).toHaveBeenCalledWith(
      daily,
      "## Time\n- 09:12-14:03 a [[projects/kasten]] kt-aaaaaa\n",
      false,
      noteBase(`## Time\n${open}\n`),
    );
  });

  it("#529 I4 a timer press on the second of two twins starts the second after a shift", async () => {
    // Listed at lines 1 and 2, and a line written above both since.
    const notes: Record<string, string> = {
      "projects/kasten.md": "- [ ] written since\n- [ ] a\n- [ ] a\n",
      [daily]: "## Time\n",
    };
    fetchNote.mockImplementation(async (path: string) => notes[path]);

    await toggleTimerInVault(
      { path: "projects/kasten.md", line: 2, text: "- [ ] a" },
      clock,
      [1, 2],
    );

    expect(saveNote).toHaveBeenCalledWith(
      "projects/kasten.md",
      expect.stringMatching(/^- \[ \] written since\n- \[ \] a\n- \[ \] a 🆔 kt-\w+\n$/),
      false,
      noteBase("- [ ] written since\n- [ ] a\n- [ ] a\n"),
    );
  });

  it("#534 A1 A5 a timer press on either of two twins carrying one 🆔 writes nothing and names the other", async () => {
    // The issue's copy-paste: a session started on one twin would be closed by
    // a press on the other, and its minutes written onto the wrong line.
    const line = "- [ ] a 🆔 kt-aaaaaa";
    const notes: Record<string, string> = {
      "projects/kasten.md": `${line}\n${line}\n`,
      [daily]: "## Time\n",
    };
    fetchNote.mockImplementation(async (path: string) => notes[path]);
    searchNotes.mockResolvedValue([
      { path: "projects/kasten.md", line: 1, text: line },
      { path: "projects/kasten.md", line: 2, text: line },
    ]);
    await expect(
      toggleTimerInVault({ path: "projects/kasten.md", line: 2, text: line }, clock, [1, 2]),
    ).rejects.toThrow("🆔 kt-aaaaaa is on another todo too: projects/kasten.md line 1");
    await expect(
      toggleTimerInVault({ path: "projects/kasten.md", line: 1, text: line }, clock, [1, 2]),
    ).rejects.toThrow("🆔 kt-aaaaaa is on another todo too: projects/kasten.md line 2");

    expect(saveNote).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
  });

  it("#534 A2 A5 a timer press whose 🆔 stands on a todo in another note writes nothing and names it", async () => {
    const line = "- [ ] a 🆔 kt-aaaaaa";
    const open = "- 09:12-      a [[projects/other]] kt-aaaaaa";
    const notes: Record<string, string> = {
      "projects/kasten.md": `${line}\n`,
      [daily]: `## Time\n${open}\n`,
    };
    fetchNote.mockImplementation(async (path: string) => notes[path]);
    searchNotes.mockResolvedValue([
      { path: "projects/kasten.md", line: 1, text: line },
      { path: "projects/other.md", line: 7, text: "- [/] a 🆔 kt-aaaaaa" },
      { path: daily, line: 2, text: open },
    ]);

    await expect(
      toggleTimerInVault({ path: "projects/kasten.md", line: 1, text: line }, clock),
    ).rejects.toThrow("🆔 kt-aaaaaa is on another todo too: projects/other.md line 7");

    expect(saveNote).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
  });

  it("#534 I1 a timer press whose 🆔 only a log, a session and a dependent name starts a session", async () => {
    const line = "- [ ] a 🆔 kt-aaaaaa";
    const logLine = "- ✅ 2026-10-17 a [[projects/kasten]] kt-aaaaaa";
    const closed = "- 09:00-10:00 a [[projects/kasten]] kt-aaaaaa";
    const text = `## Done\n${logLine}\n## Time\n${closed}\n`;
    const notes: Record<string, string> = { "projects/kasten.md": `${line}\n`, [daily]: text };
    fetchNote.mockImplementation(async (path: string) => notes[path]);
    searchNotes.mockResolvedValue([
      { path: "projects/kasten.md", line: 1, text: line },
      { path: daily, line: 2, text: logLine },
      { path: daily, line: 4, text: closed },
      { path: "deps.md", line: 1, text: "- [b] c ⛔ kt-aaaaaa" },
    ]);

    await toggleTimerInVault({ path: "projects/kasten.md", line: 1, text: line }, clock);

    expect(saveNote).toHaveBeenCalledExactlyOnceWith(
      daily,
      `${text}- 14:03-      a [[projects/kasten]] kt-aaaaaa\n`,
      false,
      noteBase(text),
    );
  });

  it("#534 I2 a timer press on a todo with no id searches nothing and starts a session", async () => {
    const notes: Record<string, string> = {
      "projects/kasten.md": "- [ ] a\n",
      [daily]: "## Time\n",
    };
    fetchNote.mockImplementation(async (path: string) => notes[path]);

    await toggleTimerInVault({ path: "projects/kasten.md", line: 1, text: "- [ ] a" }, clock);

    expect(searchNotes).not.toHaveBeenCalled();
    expect(saveNote).toHaveBeenCalledWith(
      daily,
      expect.stringMatching(/^## Time\n- 14:03- {6}a \[\[projects\/kasten\]\] kt-\w+\n$/),
      false,
      noteBase("## Time\n"),
    );
  });

  it("#534 I5 a timer press whose search fails writes nothing and says why", async () => {
    const line = "- [ ] a 🆔 kt-aaaaaa";
    const notes: Record<string, string> = {
      "projects/kasten.md": `${line}\n`,
      [daily]: "## Time\n",
    };
    fetchNote.mockImplementation(async (path: string) => notes[path]);
    searchNotes.mockRejectedValue(new Error("GET /api/search failed with 500"));

    await expect(
      toggleTimerInVault({ path: "projects/kasten.md", line: 1, text: line }, clock),
    ).rejects.toThrow("GET /api/search failed with 500");

    expect(saveNote).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
  });
});

describe("#2061 a timer press sent before the file listing answers", () => {
  const daily = periodicNote("daily", NOW).path;
  const clock = { date: dailyDate(daily) ?? "", time: "14:03" };
  const hit = { path: "projects/kasten.md", line: 1, text: "- [ ] a" };

  function vault(notes: Record<string, string>) {
    fetchNote.mockImplementation(async (path: string) => {
      if (notes[path] === undefined) throw new NoteMissing(path);
      return notes[path];
    });
  }

  it("makes today's note and saves the todo's own, never creating that", async () => {
    vault({ "projects/kasten.md": "- [ ] a\n" });

    await toggleTimerInVault(hit, clock);

    expect(createNote).toHaveBeenCalledExactlyOnceWith(
      daily,
      expect.stringMatching(/^- 14:03- {6}a \[\[projects\/kasten\]\] kt-/m),
    );
    expect(saveNote).toHaveBeenCalledExactlyOnceWith(
      "projects/kasten.md",
      expect.stringMatching(/^- \[ \] a 🆔 kt-/),
      false,
      noteBase("- [ ] a\n"),
    );
  });

  it("writes into today's note on disk by its read, and creates nothing", async () => {
    vault({ "projects/kasten.md": "- [ ] a\n", [daily]: "## Time\n" });

    await toggleTimerInVault(hit, clock);

    expect(createNote).not.toHaveBeenCalled();
    expect(saveNote).toHaveBeenCalledWith(
      daily,
      expect.stringContaining("a [[projects/kasten]]"),
      false,
      noteBase("## Time\n"),
    );
    expect(saveNote).toHaveBeenCalledTimes(2);
  });

  it("saves a todo that sits in today's note itself, and creates nothing", async () => {
    vault({ [daily]: "## TODOs\n- [ ] a\n" });

    await toggleTimerInVault({ ...hit, path: daily, line: 2 }, clock);

    expect(createNote).not.toHaveBeenCalled();
    expect(saveNote).toHaveBeenCalledExactlyOnceWith(
      daily,
      expect.stringContaining("## Time"),
      false,
      noteBase("## TODOs\n- [ ] a\n"),
    );
  });
});
