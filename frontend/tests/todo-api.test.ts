import { ChangedOnDisk, NoteExists, NoteMissing } from "@/lib/api";
import { noteBase } from "@/lib/note-base";
import { dailyDate, periodicNote } from "@/lib/periodic";
import {
  addTodoInVault,
  cycleTodoAside,
  cycleTodoInVault,
  toggleTimerInVault,
} from "@/lib/todo-api";
import { addSubtaskInVault, blockTodoInVault, editTodoInVault } from "@/lib/todo-line-edits";

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
vi.mock("@/lib/api", async (importOriginal) => {
  // The refusals the writes tell apart by class, which a factory leaving them
  // out would hand over as undefined.
  const real = await importOriginal<typeof import("@/lib/api")>();
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

beforeEach(() => {
  // One try over the fakes above. The retries on a 409 are `update-note.test.ts`'s.
  updateNote.mockImplementation(async (path: string, change: (text: string) => string | null) => {
    const text = await fetchNote(path);
    const next = change(text);
    return next === null ? null : saveNote(path, next, false, noteBase(text));
  });
  createNote.mockReset();
  createNote.mockResolvedValue(undefined);
  fetchNote.mockReset();
  fetchTodos.mockReset();
  fetchTodos.mockResolvedValue([]);
  saveNote.mockReset();
  saveNote.mockResolvedValue(undefined);
  searchNotes.mockReset();
  searchNotes.mockResolvedValue([]);
});

const NOTE = ["# Kasten", "", "- [ ] call the dentist 📅 2026-08-14 🆔 kt-3f9a2c", ""].join("\n");

const HIT = {
  path: "projects/kasten.md",
  line: 3,
  text: "- [ ] call the dentist 📅 2026-08-14 🆔 kt-3f9a2c",
};

describe("editTodoInVault", () => {
  it("puts the edited line back, and leaves every other line alone", async () => {
    fetchNote.mockResolvedValue(NOTE);

    await editTodoInVault(HIT, "  - [/] call the dentist 📅 2026-08-15 🆔 kt-3f9a2c");

    expect(saveNote).toHaveBeenCalledExactlyOnceWith(
      "projects/kasten.md",
      ["# Kasten", "", "  - [/] call the dentist 📅 2026-08-15 🆔 kt-3f9a2c", ""].join("\n"),
      false,
      noteBase(NOTE),
    );
  });

  it("writes nothing where the note moved under the row", async () => {
    // An edit replaces the line rather than rewriting what it finds, so a stale
    // row would put the dentist over whatever now sits at line 3.
    fetchNote.mockResolvedValue(NOTE.replace("- [ ] call the dentist", "- [ ] buy milk"));

    await editTodoInVault(HIT, "- [ ] call the dentist 📅 2026-08-15");

    expect(saveNote).not.toHaveBeenCalled();
  });
});

describe("editTodoInVault, on a blocked line", () => {
  it("opens the line where the edit deleted its last blocker", async () => {
    const hit = { path: "a.md", line: 1, text: "- [b] write the docs ⛔ kt-c0ffee" };
    fetchNote.mockResolvedValue(hit.text);

    await editTodoInVault(hit, "- [b] write the docs");

    expect(saveNote).toHaveBeenCalledExactlyOnceWith(
      "a.md",
      "- [ ] write the docs",
      false,
      noteBase(hit.text),
    );
  });
});

describe("blockTodoInVault", () => {
  const DOCS = { path: "docs.md", line: 2, text: "- [ ] write the docs" };
  const SHIP = { path: "release.md", line: 1, text: "- [/] ship the release" };
  const NOTES: Record<string, string> = {
    "docs.md": ["# Docs", "- [ ] write the docs"].join("\n"),
    "release.md": "- [/] ship the release",
  };

  beforeEach(() => {
    fetchNote.mockImplementation(async (path: string) => NOTES[path]);
  });

  it("stamps an id on the blocker, then names it on the dependent and blocks that", async () => {
    await blockTodoInVault(DOCS, SHIP);

    expect(saveNote).toHaveBeenCalledTimes(2);
    // The blocker first: a failure between the two leaves an id nothing
    // names rather than a `⛔` naming nothing.
    const [path, text] = saveNote.mock.calls[0] as [string, string];
    expect(path).toBe("release.md");
    const id = /^- \[\/\] ship the release 🆔 (kt-[0-9a-f]{6})$/.exec(text)?.[1];
    expect(id).toBeDefined();
    expect(saveNote).toHaveBeenLastCalledWith(
      "docs.md",
      ["# Docs", `- [b] write the docs ⛔ ${id}`].join("\n"),
      false,
      expect.any(String),
    );
  });

  it("keeps the blocker's line byte for byte but for the id it stamps", async () => {
    const lines = ["# Release", "- [ ] parent", "\t- [ ] blocker zork 🜲 words 📅 2026-10-20 ^blk1"];
    const blocker = { path: "release.md", line: 3, text: lines[2] as string };
    fetchNote.mockImplementation(async (path: string) =>
      path === "release.md" ? lines.join("\n") : NOTES[path],
    );

    await blockTodoInVault(DOCS, blocker);

    const [path, text] = saveNote.mock.calls[0] as [string, string];
    expect(path).toBe("release.md");
    const id = /🆔 (kt-[0-9a-f]{6})/.exec(text)?.[1];
    expect(id).toBeDefined();
    expect(text).toBe(
      [
        "# Release",
        "- [ ] parent",
        `\t- [ ] blocker zork 🜲 words 📅 2026-10-20 🆔 ${id} ^blk1`,
      ].join("\n"),
    );
  });

  it("leaves a blocker that carries an id alone", async () => {
    const ship = { ...SHIP, text: "- [/] ship the release 🆔 kt-c0ffee" };
    fetchNote.mockImplementation(async (path: string) =>
      path === "release.md" ? ship.text : NOTES[path],
    );

    await blockTodoInVault(DOCS, ship);

    expect(saveNote).toHaveBeenCalledExactlyOnceWith(
      "docs.md",
      ["# Docs", "- [b] write the docs ⛔ kt-c0ffee"].join("\n"),
      false,
      expect.any(String),
    );
  });

  it("writes one note once where it holds both", async () => {
    const note = ["- [ ] ship the release 🆔 kt-c0ffee", "- [/] write the docs"].join("\n");
    fetchNote.mockResolvedValue(note);

    await blockTodoInVault(
      { path: "a.md", line: 2, text: "- [/] write the docs" },
      { path: "a.md", line: 1, text: "- [ ] ship the release 🆔 kt-c0ffee" },
    );

    // Doing stays doing: kasten moves a `⛔` line between open and blocked only.
    expect(saveNote).toHaveBeenCalledExactlyOnceWith(
      "a.md",
      ["- [ ] ship the release 🆔 kt-c0ffee", "- [/] write the docs ⛔ kt-c0ffee"].join("\n"),
      false,
      noteBase(note),
    );
  });

  it("names the text it read of each note as that write's base", async () => {
    await blockTodoInVault(DOCS, SHIP);

    expect(saveNote.mock.calls.map((call) => call.slice(2))).toEqual([
      [false, noteBase(NOTES["release.md"] ?? "")],
      [false, noteBase(NOTES["docs.md"] ?? "")],
    ]);
  });

  it("writes nothing, not even the id, where either note moved under its row", async () => {
    await blockTodoInVault({ ...DOCS, line: 1 }, SHIP);
    await blockTodoInVault(DOCS, { ...SHIP, text: "- [ ] ship the release" });

    expect(saveNote).not.toHaveBeenCalled();
  });
});

describe("addSubtaskInVault", () => {
  it("writes the shorthand into the note the parent lives in", async () => {
    fetchNote.mockResolvedValue(NOTE);

    await addSubtaskInVault(HIT, "ring the practice due:08-12 !high", "2026-08-10");

    expect(saveNote).toHaveBeenCalledExactlyOnceWith(
      "projects/kasten.md",
      [
        "# Kasten",
        "",
        "- [ ] call the dentist 📅 2026-08-14 🆔 kt-3f9a2c",
        "  - [ ] ring the practice 📅 2026-08-12 ⏫ ➕ 2026-08-10",
        "",
      ].join("\n"),
      false,
      noteBase(NOTE),
    );
  });

  it("writes nothing where the note moved under the row", async () => {
    // The part is placed off the parent's line, so a stale row would hang it
    // under whatever now sits at line 3.
    fetchNote.mockResolvedValue(NOTE.replace("- [ ] call the dentist", "- [ ] buy milk"));

    await addSubtaskInVault(HIT, "ring the practice", "2026-08-10");

    expect(saveNote).not.toHaveBeenCalled();
  });
});

describe("cycleTodoInVault", () => {
  it("writes no second log line ticking a review todo whose day already logged it", async () => {
    // An agent moved the todo back from done to review, and the line its first
    // tick wrote is still under today's `## Done`.
    const daily = periodicNote("daily", new Date()).path;
    const line = "- [r] a 🆔 kt-aaaaaa";
    const log = "## Done\n- ✅ 2026-08-10 a [[projects/kasten]] kt-aaaaaa\n";
    const notes: Record<string, string> = { "projects/kasten.md": `${line}\n`, [daily]: log };
    fetchNote.mockImplementation(async (path: string) => notes[path]);
    searchNotes.mockResolvedValue([
      { path: "projects/kasten.md", line: 1, text: line },
      { path: daily, line: 2, text: "- ✅ 2026-08-10 a [[projects/kasten]] kt-aaaaaa" },
    ]);

    await cycleTodoInVault({ path: "projects/kasten.md", line: 1, text: line }, "2026-08-10", [
      "projects/kasten.md",
      daily,
    ]);

    expect(saveNote).toHaveBeenCalledExactlyOnceWith(
      "projects/kasten.md",
      "- [x] a ✅ 2026-08-10 🆔 kt-aaaaaa\n",
      false,
      noteBase(`${line}\n`),
    );
  });

  it.each([
    ["blocked", "b"],
    ["waiting", "w"],
    ["open", " "],
    ["rejected", "-"],
  ])(
    "writes no second log line setting a %s todo done whose day already logged it",
    async (_, mark) => {
      // It was done once, then moved back by hand or by an agent, and the line its
      // first tick wrote is still under today's `## Done`.
      const daily = periodicNote("daily", new Date()).path;
      const line = `- [${mark}] a 🆔 kt-aaaaaa`;
      const log = "## Done\n- ✅ 2026-08-10 a [[projects/kasten]] kt-aaaaaa\n";
      const notes: Record<string, string> = { "projects/kasten.md": `${line}\n`, [daily]: log };
      fetchNote.mockImplementation(async (path: string) => notes[path]);
      searchNotes.mockResolvedValue([
        { path: "projects/kasten.md", line: 1, text: line },
        { path: daily, line: 2, text: "- ✅ 2026-08-10 a [[projects/kasten]] kt-aaaaaa" },
      ]);

      await cycleTodoInVault(
        { path: "projects/kasten.md", line: 1, text: line },
        "2026-08-10",
        ["projects/kasten.md", daily],
        "done",
      );

      expect(saveNote).toHaveBeenCalledExactlyOnceWith(
        "projects/kasten.md",
        "- [x] a ✅ 2026-08-10 🆔 kt-aaaaaa\n",
        false,
        noteBase(`${line}\n`),
      );
    },
  );

  it("writes one log line setting a blocked todo done that no day has logged", async () => {
    const daily = periodicNote("daily", new Date()).path;
    const line = "- [b] a 🆔 kt-aaaaaa";
    const notes: Record<string, string> = {
      "projects/kasten.md": `${line}\n`,
      [daily]: "## Done\n",
    };
    fetchNote.mockImplementation(async (path: string) => notes[path]);
    searchNotes.mockResolvedValue([{ path: "projects/kasten.md", line: 1, text: line }]);

    await cycleTodoInVault(
      { path: "projects/kasten.md", line: 1, text: line },
      "2026-08-10",
      ["projects/kasten.md", daily],
      "done",
    );

    expect(saveNote).toHaveBeenCalledWith(
      daily,
      "## Done\n- ✅ 2026-08-10 a [[projects/kasten]] kt-aaaaaa\n",
      false,
      noteBase("## Done\n"),
    );
  });

  it("drops the log line blocking a done todo", async () => {
    const daily = periodicNote("daily", new Date()).path;
    const line = "- [x] a ✅ 2026-08-10 🆔 kt-aaaaaa";
    const log = "## Done\n- ✅ 2026-08-10 a [[projects/kasten]] kt-aaaaaa\n";
    const notes: Record<string, string> = { "projects/kasten.md": `${line}\n`, [daily]: log };
    fetchNote.mockImplementation(async (path: string) => notes[path]);
    searchNotes.mockResolvedValue([
      { path: "projects/kasten.md", line: 1, text: line },
      { path: daily, line: 2, text: "- ✅ 2026-08-10 a [[projects/kasten]] kt-aaaaaa" },
    ]);

    await cycleTodoInVault(
      { path: "projects/kasten.md", line: 1, text: line },
      "2026-08-10",
      ["projects/kasten.md", daily],
      "blocked",
    );

    expect(saveNote).toHaveBeenCalledWith(daily, "## Done\n", false, noteBase(log));
  });

  it("searches nothing blocking an open todo", async () => {
    // Neither side of the press is done, so no log line can be at stake.
    const line = "- [ ] a 🆔 kt-aaaaaa";
    fetchNote.mockResolvedValue(`${line}\n`);

    await cycleTodoInVault(
      { path: "projects/kasten.md", line: 1, text: line },
      "2026-08-10",
      ["projects/kasten.md"],
      "blocked",
    );

    expect(searchNotes).not.toHaveBeenCalled();
  });

  it("searches nothing and writes nothing setting a done todo done", async () => {
    // The press leaves the line as it was, so there is no log line to write or
    // drop and no dependent to move.
    const line = "- [x] a ✅ 2026-10-18 🆔 kt-aaaaaa";
    fetchNote.mockResolvedValue(`${line}\n`);

    await cycleTodoInVault(
      { path: "projects/kasten.md", line: 1, text: line },
      "2026-10-18",
      ["projects/kasten.md"],
      "done",
    );

    expect(searchNotes).not.toHaveBeenCalled();
    expect(fetchTodos).not.toHaveBeenCalled();
    expect(saveNote).not.toHaveBeenCalled();
    expect(fetchNote).toHaveBeenCalledOnce();
  });

  it("writes nothing setting a done todo with no id done", async () => {
    const line = "- [x] a ✅ 2026-10-18";
    fetchNote.mockResolvedValue(`${line}\n`);

    await cycleTodoInVault(
      { path: "projects/kasten.md", line: 1, text: line },
      "2026-10-18",
      ["projects/kasten.md"],
      "done",
    );

    expect(saveNote).not.toHaveBeenCalled();
  });

  it("writes nothing setting a blocked todo blocked", async () => {
    const line = "- [b] a 🆔 kt-aaaaaa";
    fetchNote.mockResolvedValue(`${line}\n`);

    await cycleTodoInVault(
      { path: "projects/kasten.md", line: 1, text: line },
      "2026-10-18",
      ["projects/kasten.md"],
      "blocked",
    );

    expect(saveNote).not.toHaveBeenCalled();
  });

  it("#397 B2 a state write finds its todo by its words where a line above shifted it", async () => {
    // Listed at line 1, and a line written above it since: a card held through
    // a drag, or a key pressed just after an agent wrote.
    fetchNote.mockResolvedValue("- [ ] written since\n- [ ] a\n");

    await cycleTodoInVault(
      { path: "projects/kasten.md", line: 1, text: "- [ ] a" },
      "2026-10-18",
      ["projects/kasten.md"],
      "blocked",
    );

    expect(saveNote).toHaveBeenCalledExactlyOnceWith(
      "projects/kasten.md",
      "- [ ] written since\n- [b] a\n",
      false,
      noteBase("- [ ] written since\n- [ ] a\n"),
    );
  });

  it("#397 B2 a state write whose line now holds another todo writes nothing", async () => {
    fetchNote.mockResolvedValue("- [ ] another\n");

    await expect(
      cycleTodoInVault(
        { path: "projects/kasten.md", line: 1, text: "- [ ] a" },
        "2026-10-18",
        ["projects/kasten.md"],
        "blocked",
      ),
    ).rejects.toThrow("that line has changed since it was listed");

    expect(saveNote).not.toHaveBeenCalled();
  });

  it("#397 B a second state press before the redraw walks the same todo on", async () => {
    // The first press landed `[/]` and stamped an id; the row still says what
    // the list read before it.
    fetchNote.mockResolvedValue("- [/] a 🆔 kt-aaaaaa\n");

    await cycleTodoInVault(
      { path: "projects/kasten.md", line: 1, text: "- [ ] a" },
      "2026-10-18",
      ["projects/kasten.md"],
      "blocked",
    );

    expect(saveNote).toHaveBeenCalledExactlyOnceWith(
      "projects/kasten.md",
      "- [b] a 🆔 kt-aaaaaa\n",
      false,
      noteBase("- [/] a 🆔 kt-aaaaaa\n"),
    );
  });

  it("#530 A3 a state write on the second of two twins sets the second after a line above shifted both", async () => {
    // Listed at lines 1 and 2, and a line written above both since. The second
    // twin's old number now holds the first twin, word for word.
    const note = "- [ ] written since\n- [ ] a\n- [ ] a\n";
    fetchNote.mockResolvedValue(note);

    await cycleTodoInVault(
      { path: "projects/kasten.md", line: 2, text: "- [ ] a" },
      "2026-10-18",
      ["projects/kasten.md"],
      "blocked",
      [1, 2],
    );

    expect(saveNote).toHaveBeenCalledExactlyOnceWith(
      "projects/kasten.md",
      "- [ ] written since\n- [ ] a\n- [b] a\n",
      false,
      noteBase(note),
    );
  });

  it("#530 A4 a state write on a twin whose twins changed in number writes nothing", async () => {
    // Two were listed and three are there now: which one the row meant is
    // anybody's guess.
    fetchNote.mockResolvedValue("- [ ] a\n- [ ] a\n- [ ] a\n");

    await expect(
      cycleTodoInVault(
        { path: "projects/kasten.md", line: 2, text: "- [ ] a" },
        "2026-10-18",
        ["projects/kasten.md"],
        "blocked",
        [1, 2],
      ),
    ).rejects.toThrow("that line has changed since it was listed");

    expect(saveNote).not.toHaveBeenCalled();
  });

  it("#530 I2 a state write on the second of two twins with nothing shifted sets the second", async () => {
    const note = "- [ ] a\n- [ ] a\n";
    fetchNote.mockResolvedValue(note);

    await cycleTodoInVault(
      { path: "projects/kasten.md", line: 2, text: "- [ ] a" },
      "2026-10-18",
      ["projects/kasten.md"],
      "blocked",
      [1, 2],
    );

    expect(saveNote).toHaveBeenCalledExactlyOnceWith(
      "projects/kasten.md",
      "- [ ] a\n- [b] a\n",
      false,
      noteBase(note),
    );
  });

  it("#530 I3 a second state press on a twin before the redraw never sets the other twin", async () => {
    // The first press moved the second twin on, so the first twin is the only
    // line left with the row's words.
    fetchNote.mockResolvedValue("- [ ] a\n- [/] a 🆔 kt-aaaaaa\n");

    await expect(
      cycleTodoInVault(
        { path: "projects/kasten.md", line: 2, text: "- [ ] a" },
        "2026-10-18",
        ["projects/kasten.md"],
        "blocked",
        [1, 2],
      ),
    ).rejects.toThrow("that line has changed since it was listed");

    expect(saveNote).not.toHaveBeenCalled();
  });

  it.each([
    ["x on a doing todo", "- [/] a 🆔 kt-aaaaaa", undefined],
    ["doing on an open todo", "- [ ] a 🆔 kt-aaaaaa", "doing"],
    ["done on an open todo", "- [ ] a 🆔 kt-aaaaaa", "done"],
    ["open on a done todo", "- [x] a ✅ 2026-10-17 🆔 kt-aaaaaa", "open"],
  ] as const)(
    "#534 A3 A5 a state press, %s, whose 🆔 stands on another todo line writes nothing",
    async (_, line, state) => {
      // A copy pasted into another note: both lines would share one log line and
      // one dependent, and the press cannot tell which of them it moves.
      const daily = periodicNote("daily", new Date()).path;
      const log = "## Done\n- ✅ 2026-10-17 a [[projects/kasten]] kt-aaaaaa\n";
      const notes: Record<string, string> = {
        "projects/kasten.md": `${line}\n`,
        "projects/other.md": "# Other\n\n\n\n\n\n- [ ] a 🆔 kt-aaaaaa\n",
        "deps.md": "- [b] c ⛔ kt-aaaaaa\n",
        [daily]: log,
      };
      fetchNote.mockImplementation(async (path: string) => notes[path]);
      fetchTodos.mockResolvedValue([
        { path: "projects/kasten.md", line: 1, text: line, project: null },
        { path: "projects/other.md", line: 7, text: "- [ ] a 🆔 kt-aaaaaa", project: null },
        { path: "deps.md", line: 1, text: "- [b] c ⛔ kt-aaaaaa", project: null },
      ]);
      searchNotes.mockResolvedValue([
        { path: "projects/kasten.md", line: 1, text: line },
        { path: "projects/other.md", line: 7, text: "- [ ] a 🆔 kt-aaaaaa" },
        { path: "deps.md", line: 1, text: "- [b] c ⛔ kt-aaaaaa" },
        { path: daily, line: 2, text: "- ✅ 2026-10-17 a [[projects/kasten]] kt-aaaaaa" },
      ]);

      await expect(
        cycleTodoInVault(
          { path: "projects/kasten.md", line: 1, text: line },
          "2026-10-18",
          ["projects/kasten.md", "projects/other.md", "deps.md", daily],
          state,
        ),
      ).rejects.toThrow("🆔 kt-aaaaaa is on another todo too: projects/other.md line 7");

      expect(saveNote).not.toHaveBeenCalled();
      expect(createNote).not.toHaveBeenCalled();
    },
  );

  it("#534 I4 a state press whose 🆔 stands on several other lines names the first and counts the rest", async () => {
    const line = "- [ ] a 🆔 kt-aaaaaa";
    const note = `${line}\n${line}\n`;
    fetchNote.mockResolvedValue(note);
    fetchTodos.mockResolvedValue([
      { path: "projects/kasten.md", line: 1, text: line, project: null },
      { path: "projects/kasten.md", line: 2, text: line, project: null },
      { path: "a.md", line: 3, text: line, project: null },
      { path: "b.md", line: 4, text: line, project: null },
    ]);

    await expect(
      cycleTodoInVault(
        { path: "projects/kasten.md", line: 1, text: line },
        "2026-10-18",
        ["projects/kasten.md", "a.md", "b.md"],
        "doing",
        [1, 2],
      ),
    ).rejects.toThrow("🆔 kt-aaaaaa is on another todo too: projects/kasten.md line 2, and 2 more");

    expect(saveNote).not.toHaveBeenCalled();
  });

  it("#534 I1 a state press whose 🆔 only a log, a session and a dependent name sets it done", async () => {
    const daily = periodicNote("daily", new Date()).path;
    const line = "- [/] a 🆔 kt-aaaaaa";
    const logLine = "- ✅ 2026-10-17 a [[projects/kasten]] kt-aaaaaa";
    const session = "- 09:12-      a [[projects/kasten]] kt-aaaaaa";
    const notes: Record<string, string> = {
      "projects/kasten.md": `${line}\n`,
      "deps.md": "- [b] c ⛔ kt-aaaaaa\n",
      [daily]: `## Done\n${logLine}\n## Time\n${session}\n`,
    };
    fetchNote.mockImplementation(async (path: string) => notes[path]);
    // `GET /api/todos` answers with running sessions beside the todos.
    fetchTodos.mockResolvedValue([
      { path: "projects/kasten.md", line: 1, text: line, project: null },
      { path: "deps.md", line: 1, text: "- [b] c ⛔ kt-aaaaaa", project: null },
      { path: daily, line: 4, text: session, project: null },
    ]);
    searchNotes.mockResolvedValue([
      { path: "projects/kasten.md", line: 1, text: line },
      { path: "deps.md", line: 1, text: "- [b] c ⛔ kt-aaaaaa" },
      { path: daily, line: 2, text: logLine },
      { path: daily, line: 4, text: session },
    ]);

    await cycleTodoInVault({ path: "projects/kasten.md", line: 1, text: line }, "2026-10-18", [
      "projects/kasten.md",
      "deps.md",
      daily,
    ]);

    expect(saveNote).toHaveBeenCalledWith(
      "projects/kasten.md",
      "- [x] a ✅ 2026-10-18 🆔 kt-aaaaaa\n",
      false,
      noteBase(`${line}\n`),
    );
    expect(saveNote).toHaveBeenCalledWith(
      "deps.md",
      "- [ ] c ⛔ kt-aaaaaa\n",
      false,
      noteBase("- [b] c ⛔ kt-aaaaaa\n"),
    );
  });

  it("#534 I2 a state press on a todo with no id searches nothing and sets it done", async () => {
    fetchNote.mockResolvedValue("- [/] a\n");

    await cycleTodoInVault({ path: "projects/kasten.md", line: 1, text: "- [/] a" }, "2026-10-18", [
      "projects/kasten.md",
    ]);

    expect(searchNotes).not.toHaveBeenCalled();
    expect(saveNote).toHaveBeenCalledWith(
      "projects/kasten.md",
      expect.stringMatching(/^- \[x\] a ✅ 2026-10-18 🆔 kt-\w+\n$/),
      false,
      noteBase("- [/] a\n"),
    );
  });
});

describe("cycleTodoAside", () => {
  it("#534 A4 a <leader>x into done whose 🆔 stands on another todo line logs nothing and unblocks nothing", async () => {
    const daily = periodicNote("daily", new Date()).path;
    const notes: Record<string, string> = {
      "projects/other.md": "- [ ] a 🆔 kt-aaaaaa\n",
      "deps.md": "- [b] c ⛔ kt-aaaaaa\n",
      [daily]: "## Done\n",
    };
    fetchNote.mockImplementation(async (path: string) => notes[path]);
    fetchTodos.mockResolvedValue([
      { path: "projects/kasten.md", line: 3, text: "- [/] a 🆔 kt-aaaaaa", project: null },
      { path: "projects/other.md", line: 1, text: "- [ ] a 🆔 kt-aaaaaa", project: null },
      { path: "deps.md", line: 1, text: "- [b] c ⛔ kt-aaaaaa", project: null },
    ]);
    searchNotes.mockResolvedValue([
      { path: "projects/other.md", line: 1, text: "- [ ] a 🆔 kt-aaaaaa" },
      { path: "deps.md", line: 1, text: "- [b] c ⛔ kt-aaaaaa" },
    ]);

    await expect(
      cycleTodoAside(
        "projects/kasten.md",
        {
          before: "- [/] a 🆔 kt-aaaaaa",
          after: "- [x] a ✅ 2026-10-18 🆔 kt-aaaaaa",
          line: 3,
          doc: "# Kasten\n\n- [/] a 🆔 kt-aaaaaa",
        },
        "2026-10-18",
        ["projects/kasten.md", "projects/other.md", "deps.md", daily],
      ),
    ).rejects.toThrow("🆔 kt-aaaaaa is on another todo too: projects/other.md line 1");

    expect(saveNote).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
  });

  it("#534 B2 a <leader>x whose twin the buffer no longer holds is not refused", async () => {
    // The disk still holds the twin; the buffer changed its id an autosave ago.
    const daily = periodicNote("daily", new Date()).path;
    fetchTodos.mockResolvedValue([
      { path: "projects/kasten.md", line: 1, text: "- [/] a 🆔 kt-aaaaaa", project: null },
      { path: "projects/kasten.md", line: 2, text: "- [/] a 🆔 kt-aaaaaa", project: null },
    ]);

    await cycleTodoAside(
      "projects/kasten.md",
      {
        before: "- [/] a 🆔 kt-aaaaaa",
        after: "- [x] a ✅ 2026-10-18 🆔 kt-aaaaaa",
        line: 1,
        doc: "- [/] a 🆔 kt-aaaaaa\n- [/] a 🆔 kt-bbbbbb",
      },
      "2026-10-18",
      ["projects/kasten.md"],
    );

    expect(createNote).toHaveBeenCalledExactlyOnceWith(
      daily,
      expect.stringContaining("- ✅ 2026-10-18 a [[projects/kasten]] kt-aaaaaa"),
    );
  });

  it("#534 B2 a <leader>x on a copy the disk does not hold yet is refused", async () => {
    // `yy p` an autosave ago: the disk holds one line, the buffer two.
    fetchTodos.mockResolvedValue([
      { path: "projects/kasten.md", line: 1, text: "- [/] a 🆔 kt-aaaaaa", project: null },
    ]);

    await expect(
      cycleTodoAside(
        "projects/kasten.md",
        {
          before: "- [/] a 🆔 kt-aaaaaa",
          after: "- [x] a ✅ 2026-10-18 🆔 kt-aaaaaa",
          line: 2,
          doc: "- [/] a 🆔 kt-aaaaaa\n- [/] a 🆔 kt-aaaaaa",
        },
        "2026-10-18",
        ["projects/kasten.md"],
      ),
    ).rejects.toThrow("🆔 kt-aaaaaa is on another todo too: projects/kasten.md line 1");

    expect(saveNote).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
  });
});

describe("#538 two presses in flight on the ## Done log", () => {
  const daily = periodicNote("daily", new Date()).path;
  const PATH = "projects/kasten.md";
  const DOC = "- [/] a 🆔 kt-aaaaaa\n- [/] b 🆔 kt-bbbbbb";
  const INTO_A = {
    before: "- [/] a 🆔 kt-aaaaaa",
    after: "- [x] a ✅ 2026-10-18 🆔 kt-aaaaaa",
    line: 1,
    doc: DOC,
  };
  const INTO_B = {
    before: "- [/] b 🆔 kt-bbbbbb",
    after: "- [x] b ✅ 2026-10-18 🆔 kt-bbbbbb",
    line: 2,
    doc: "- [x] a ✅ 2026-10-18 🆔 kt-aaaaaa\n- [/] b 🆔 kt-bbbbbb",
  };
  const LOG_A = "- ✅ 2026-10-18 a [[projects/kasten]] kt-aaaaaa";
  const LOG_B = "- ✅ 2026-10-18 b [[projects/kasten]] kt-bbbbbb";

  /** The vault's notes, which the fakes below read and write the way the backend does. */
  let notes: Record<string, string>;

  /** What the index answers for `id` at the moment it is asked. */
  const hits = (id: string) =>
    Object.entries(notes).flatMap(([path, text]) =>
      text
        .split("\n")
        .flatMap((line, index) =>
          line.includes(id) ? [{ path, line: index + 1, text: line }] : [],
        ),
    );

  /** Every log line a note holds, in order. */
  const logLines = (path: string) =>
    (notes[path] ?? "").split("\n").filter((line) => line.startsWith("- ✅"));

  beforeEach(() => {
    notes = { [PATH]: DOC, [daily]: "## Done\n" };
    fetchNote.mockImplementation(async (path: string) => {
      const text = notes[path];
      if (text === undefined) throw new NoteMissing(path);
      return text;
    });
    // The backend's check: a base the disk has moved past is a 409.
    saveNote.mockImplementation(
      async (path: string, text: string, _keepalive: boolean, base?: string) => {
        if (base !== undefined && base !== noteBase(notes[path] ?? "")) throw new ChangedOnDisk();
        notes[path] = text;
      },
    );
    createNote.mockImplementation(async (path: string, text: string) => {
      if (notes[path] !== undefined) throw new NoteExists(path);
      notes[path] = text;
    });
    searchNotes.mockImplementation(async (id: string) => hits(id));
    // The real three tries, since the refusal and the read after it are what
    // is under test here.
    updateNote.mockImplementation(async (path: string, change: (text: string) => string | null) => {
      for (let tries = 1; ; tries++) {
        const text: string = await fetchNote(path);
        const next = change(text);
        if (next === null) return null;
        try {
          return await saveNote(path, next, false, noteBase(text));
        } catch (error) {
          if (!(error instanceof ChangedOnDisk) || tries === 3) throw error;
        }
      }
    });
  });

  it("#538 A1 two <leader>x into done in flight on one note both log, a then b", async () => {
    const pressed = await Promise.allSettled([
      cycleTodoAside(PATH, INTO_A, "2026-10-18", [PATH, daily]),
      cycleTodoAside(PATH, INTO_B, "2026-10-18", [PATH, daily]),
    ]);

    expect(logLines(daily)).toEqual([LOG_A, LOG_B]);
    expect(pressed.map((press) => press.status)).toEqual(["fulfilled", "fulfilled"]);
  });

  it("#538 A2 a log write refused three times still says why", async () => {
    saveNote.mockRejectedValue(new ChangedOnDisk());

    await expect(cycleTodoAside(PATH, INTO_A, "2026-10-18", [PATH, daily])).rejects.toBeInstanceOf(
      ChangedOnDisk,
    );
    expect(saveNote).toHaveBeenCalledTimes(3);
  });

  it("#538 I1 a quick reopen after done drops the line the first press logged", async () => {
    // The index answers the reopen from before the first press landed, as one
    // a write behind does, and the answer arrives after that press is done.
    let first: Promise<void> = Promise.resolve();
    searchNotes.mockImplementationOnce(async (id: string) => hits(id));
    searchNotes.mockImplementationOnce(async (id: string) => {
      const found = hits(id);
      await first;
      return found;
    });

    first = cycleTodoAside(PATH, INTO_A, "2026-10-18", [PATH, daily]);
    const reopen = cycleTodoAside(
      PATH,
      {
        before: "- [x] a ✅ 2026-10-18 🆔 kt-aaaaaa",
        after: "- [ ] a 🆔 kt-aaaaaa",
        line: 1,
        doc: INTO_B.doc,
      },
      "2026-10-18",
      [PATH, daily],
    );
    const pressed = await Promise.allSettled([first, reopen]);

    expect(logLines(daily)).toEqual([]);
    expect(pressed.map((press) => press.status)).toEqual(["fulfilled", "fulfilled"]);
  });

  it("#538 I2 a stray log line in another note is dropped on the newer text", async () => {
    const OLD = "projects/old.md";
    notes[OLD] = [
      "## Done",
      "- ✅ 2026-10-17 a [[projects/kasten]] kt-aaaaaa",
      "- ✅ 2026-10-17 b [[projects/kasten]] kt-bbbbbb",
      "",
    ].join("\n");
    const done = "- [x] a ✅ 2026-10-17 🆔 kt-aaaaaa\n- [x] b ✅ 2026-10-17 🆔 kt-bbbbbb";
    notes[PATH] = done;

    const pressed = await Promise.allSettled([
      cycleTodoAside(
        PATH,
        {
          before: "- [x] a ✅ 2026-10-17 🆔 kt-aaaaaa",
          after: "- [ ] a 🆔 kt-aaaaaa",
          line: 1,
          doc: done,
        },
        "2026-10-18",
        [PATH, daily, OLD],
      ),
      cycleTodoAside(
        PATH,
        {
          before: "- [x] b ✅ 2026-10-17 🆔 kt-bbbbbb",
          after: "- [ ] b 🆔 kt-bbbbbb",
          line: 2,
          doc: "- [ ] a 🆔 kt-aaaaaa\n- [x] b ✅ 2026-10-17 🆔 kt-bbbbbb",
        },
        "2026-10-18",
        [PATH, daily, OLD],
      ),
    ]);

    expect(notes[OLD]).toBe("## Done\n");
    expect(pressed.map((press) => press.status)).toEqual(["fulfilled", "fulfilled"]);
  });

  it("#538 I3 two presses on the first log of the day both log", async () => {
    delete notes[daily];

    const pressed = await Promise.allSettled([
      cycleTodoAside(PATH, INTO_A, "2026-10-18", [PATH]),
      cycleTodoAside(PATH, INTO_B, "2026-10-18", [PATH]),
    ]);

    expect(logLines(daily)).toEqual([LOG_A, LOG_B]);
    expect(pressed.map((press) => press.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(createNote).toHaveBeenCalledTimes(2);
  });

  /** A press taking a back out of done, a moment after it went in. */
  const REOPEN_A = {
    before: "- [x] a ✅ 2026-10-18 🆔 kt-aaaaaa",
    after: "- [ ] a 🆔 kt-aaaaaa",
    line: 1,
    doc: "- [ ] a 🆔 kt-aaaaaa\n- [/] b 🆔 kt-bbbbbb",
  };

  it("#538 I1 a quick reopen whose read comes before the first save still drops the line", async () => {
    const pressed = await Promise.allSettled([
      cycleTodoAside(PATH, INTO_A, "2026-10-18", [PATH, daily]),
      cycleTodoAside(PATH, REOPEN_A, "2026-10-18", [PATH, daily]),
    ]);

    expect(logLines(daily)).toEqual([]);
    expect(pressed.map((press) => press.status)).toEqual(["fulfilled", "fulfilled"]);
  });

  it("#538 A1 two presses into done land a then b when the second's reads answer first", async () => {
    // Press a's search answers last, after every answer press b asks for.
    let answer = () => {};
    const late = new Promise<void>((resolve) => {
      answer = resolve;
    });
    searchNotes.mockImplementationOnce(async (id: string) => {
      await late;
      return hits(id);
    });

    const pressed = Promise.allSettled([
      cycleTodoAside(PATH, INTO_A, "2026-10-18", [PATH, daily]),
      cycleTodoAside(PATH, INTO_B, "2026-10-18", [PATH, daily]),
    ]);
    // A macrotask, so every answer already in hand lands before a's does.
    await new Promise((resolve) => setTimeout(resolve, 0));
    answer();

    expect((await pressed).map((press) => press.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(logLines(daily)).toEqual([LOG_A, LOG_B]);
  });

  it("#538 B1 a reopen before the listing names today's note drops its line", async () => {
    // The press that made today's note is a moment old: neither the listing
    // nor the index has caught up with it, the disk has.
    notes[daily] = `## Done\n${LOG_A}\n`;
    searchNotes.mockResolvedValue([]);

    await cycleTodoAside(PATH, REOPEN_A, "2026-10-18", [PATH]);

    expect(logLines(daily)).toEqual([]);
  });

  it("#538 B2 a press that never answers holds the next one back only so long", async () => {
    vi.useFakeTimers();
    try {
      // Press a's guard asks the vault, which never answers.
      fetchTodos.mockReturnValueOnce(new Promise(() => {}));

      void cycleTodoAside(PATH, INTO_A, "2026-10-18", [PATH, daily]);
      const b = cycleTodoAside(PATH, INTO_B, "2026-10-18", [PATH, daily]);
      // The ten seconds `cycleTodoAside` waits on the press before.
      await vi.advanceTimersByTimeAsync(10_000);

      expect(logLines(daily)).toEqual([LOG_B]);
      await expect(b).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("#538 B1 a reopen with no note today writes nothing and says nothing", async () => {
    delete notes[daily];

    await expect(cycleTodoAside(PATH, REOPEN_A, "2026-10-18", [PATH])).resolves.toBeUndefined();

    expect(saveNote).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
    expect(notes[daily]).toBeUndefined();
  });
});

describe("toggleTimerInVault", () => {
  const daily = periodicNote("daily", new Date()).path;
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
      ["projects/kasten.md", daily],
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
      toggleTimerInVault({ path: "projects/kasten.md", line: 1, text: "- [ ] a" }, clock, [
        "projects/kasten.md",
        daily,
      ]),
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

    await toggleTimerInVault({ path: "projects/kasten.md", line: 1, text: "- [ ] a" }, clock, [
      "projects/kasten.md",
      daily,
    ]);

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
      ["projects/kasten.md", daily],
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
    const paths = ["projects/kasten.md", daily];

    await expect(
      toggleTimerInVault({ path: "projects/kasten.md", line: 2, text: line }, clock, paths, [1, 2]),
    ).rejects.toThrow("🆔 kt-aaaaaa is on another todo too: projects/kasten.md line 1");
    await expect(
      toggleTimerInVault({ path: "projects/kasten.md", line: 1, text: line }, clock, paths, [1, 2]),
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
      toggleTimerInVault({ path: "projects/kasten.md", line: 1, text: line }, clock, [
        "projects/kasten.md",
        "projects/other.md",
        daily,
      ]),
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

    await toggleTimerInVault({ path: "projects/kasten.md", line: 1, text: line }, clock, [
      "projects/kasten.md",
      "deps.md",
      daily,
    ]);

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

    await toggleTimerInVault({ path: "projects/kasten.md", line: 1, text: "- [ ] a" }, clock, [
      "projects/kasten.md",
      daily,
    ]);

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
      toggleTimerInVault({ path: "projects/kasten.md", line: 1, text: line }, clock, [
        "projects/kasten.md",
        daily,
      ]),
    ).rejects.toThrow("GET /api/search failed with 500");

    expect(saveNote).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
  });
});

describe("addTodoInVault", () => {
  it("makes today's note with a block saying it is periodic", async () => {
    // The first todo of a day is the other way a daily note is made, and it
    // has to write the same first line the leader key writes: a fence anywhere
    // but the top is prose, and the note would carry no type at all.
    await addTodoInVault("call the dentist", "2026-08-06", []);

    const [, text] = createNote.mock.calls[0] as [string, string];
    expect(text.split("\n").slice(0, 3)).toEqual(["---", "type: Periodic Note", "---"]);
  });

  it("names the daily note it read as the base of its write", async () => {
    const daily = periodicNote("daily", new Date()).path;
    fetchNote.mockResolvedValue("# Today\n");

    await addTodoInVault("call the dentist", "2026-08-06", [daily]);

    expect(saveNote).toHaveBeenCalledExactlyOnceWith(
      daily,
      expect.stringContaining("call the dentist"),
      false,
      noteBase("# Today\n"),
    );
  });
});

describe("#537 a ⛔ naming a 🆔 two todos carry", () => {
  const daily = periodicNote("daily", new Date()).path;

  /** The vault as `notes`, written back as each save lands. */
  function serve(notes: Record<string, string>) {
    fetchNote.mockImplementation(async (path: string) => notes[path]);
    saveNote.mockImplementation(async (path: string, text: string) => {
      notes[path] = text;
    });
  }

  it("#537 A5 setting d done leaves c blocked in the issue's note", async () => {
    const lines = [
      "- [ ] a 🆔 kt-aaaaaa",
      "- [x] a 🆔 kt-aaaaaa",
      "- [b] c ⛔ kt-aaaaaa",
      "- [ ] d 🆔 kt-dddddd",
      "- [b] e ⛔ kt-dddddd",
    ];
    const notes: Record<string, string> = { "inbox.md": lines.join("\n"), [daily]: "## Done\n" };
    serve(notes);
    fetchTodos.mockResolvedValue(
      lines.map((text, index) => ({ path: "inbox.md", line: index + 1, text, project: null })),
    );

    await cycleTodoInVault(
      { path: "inbox.md", line: 4, text: "- [ ] d 🆔 kt-dddddd" },
      "2026-08-10",
      ["inbox.md", daily],
      "done",
    );

    expect(notes["inbox.md"]).toBe(
      [
        "- [ ] a 🆔 kt-aaaaaa",
        "- [x] a 🆔 kt-aaaaaa",
        "- [b] c ⛔ kt-aaaaaa",
        "- [x] d ✅ 2026-08-10 🆔 kt-dddddd",
        "- [ ] e ⛔ kt-dddddd",
      ].join("\n"),
    );
  });

  it("#537 A5 the write back leaves a dependent in another note on a twinned 🆔", async () => {
    // The pressed todo closes, and the dependent's other blocker is the twinned
    // one, whose done twin is listed last.
    const notes: Record<string, string> = {
      "d.md": "- [/] d 🆔 kt-dddddd",
      "deps.md": "- [b] c ⛔ kt-dddddd ⛔ kt-aaaaaa",
      [daily]: "## Done\n",
    };
    serve(notes);
    fetchTodos.mockResolvedValue([
      { path: "d.md", line: 1, text: "- [/] d 🆔 kt-dddddd", project: null },
      { path: "a.md", line: 1, text: "- [ ] a 🆔 kt-aaaaaa", project: null },
      { path: "b.md", line: 1, text: "- [x] a 🆔 kt-aaaaaa", project: null },
      { path: "deps.md", line: 1, text: "- [b] c ⛔ kt-dddddd ⛔ kt-aaaaaa", project: null },
    ]);

    await cycleTodoInVault(
      { path: "d.md", line: 1, text: "- [/] d 🆔 kt-dddddd" },
      "2026-08-10",
      ["d.md", "deps.md", daily],
      "done",
    );

    expect(notes["d.md"]).toBe("- [x] d ✅ 2026-08-10 🆔 kt-dddddd");
    expect(notes["deps.md"]).toBe("- [b] c ⛔ kt-dddddd ⛔ kt-aaaaaa");
  });

  it("#537 A6 blocking on a todo whose 🆔 stands on another todo writes nothing and names the other", async () => {
    const docs = { path: "docs.md", line: 2, text: "- [ ] write the docs" };
    const blocker = { path: "release.md", line: 1, text: "- [ ] a 🆔 kt-aaaaaa" };
    serve({ "docs.md": "# Docs\n- [ ] write the docs", "release.md": blocker.text });
    fetchTodos.mockResolvedValue([
      { ...docs, project: null },
      { ...blocker, project: null },
      { path: "other.md", line: 3, text: "- [x] a 🆔 kt-aaaaaa", project: null },
    ]);

    await expect(blockTodoInVault(docs, blocker)).rejects.toThrow(
      "🆔 kt-aaaaaa is on another todo too: other.md line 3",
    );

    expect(saveNote).not.toHaveBeenCalled();
  });
});
