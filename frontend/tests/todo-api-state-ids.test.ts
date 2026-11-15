// @vitest-environment node
import { noteBase } from "@/lib/notes/note-base";
import { periodicNote } from "@/lib/notes/text/periodic";
import { cycleTodoInVault } from "@/lib/todo/todo-api";
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

describe("cycleTodoInVault", () => {
  it("#397 B2 a state write finds its todo by its words where a line above shifted it", async () => {
    // Listed at line 1, and a line written above it since: a card held through
    // a drag, or a key pressed just after an agent wrote.
    fetchNote.mockResolvedValue("- [ ] written since\n- [ ] a\n");

    await cycleTodoInVault(
      { path: "projects/kasten.md", line: 1, text: "- [ ] a" },
      "2026-10-18",
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
        { path: "projects/kasten.md", line: 1, text: line, project: null, shared: false },
        {
          path: "projects/other.md",
          line: 7,
          text: "- [ ] a 🆔 kt-aaaaaa",
          project: null,
          shared: false,
        },
        { path: "deps.md", line: 1, text: "- [b] c ⛔ kt-aaaaaa", project: null, shared: false },
      ]);
      searchNotes.mockResolvedValue([
        { path: "projects/kasten.md", line: 1, text: line },
        { path: "projects/other.md", line: 7, text: "- [ ] a 🆔 kt-aaaaaa" },
        { path: "deps.md", line: 1, text: "- [b] c ⛔ kt-aaaaaa" },
        { path: daily, line: 2, text: "- ✅ 2026-10-17 a [[projects/kasten]] kt-aaaaaa" },
      ]);

      await expect(
        cycleTodoInVault({ path: "projects/kasten.md", line: 1, text: line }, "2026-10-18", state),
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
      { path: "projects/kasten.md", line: 1, text: line, project: null, shared: false },
      { path: "projects/kasten.md", line: 2, text: line, project: null, shared: false },
      { path: "a.md", line: 3, text: line, project: null, shared: false },
      { path: "b.md", line: 4, text: line, project: null, shared: false },
    ]);

    await expect(
      cycleTodoInVault(
        { path: "projects/kasten.md", line: 1, text: line },
        "2026-10-18",
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
      { path: "projects/kasten.md", line: 1, text: line, project: null, shared: false },
      { path: "deps.md", line: 1, text: "- [b] c ⛔ kt-aaaaaa", project: null, shared: false },
      { path: daily, line: 4, text: session, project: null, shared: false },
    ]);
    searchNotes.mockResolvedValue([
      { path: "projects/kasten.md", line: 1, text: line },
      { path: "deps.md", line: 1, text: "- [b] c ⛔ kt-aaaaaa" },
      { path: daily, line: 2, text: logLine },
      { path: daily, line: 4, text: session },
    ]);

    await cycleTodoInVault({ path: "projects/kasten.md", line: 1, text: line }, "2026-10-18");

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

    await cycleTodoInVault({ path: "projects/kasten.md", line: 1, text: "- [/] a" }, "2026-10-18");

    expect(searchNotes).not.toHaveBeenCalled();
    expect(saveNote).toHaveBeenCalledWith(
      "projects/kasten.md",
      expect.stringMatching(/^- \[x\] a ✅ 2026-10-18 🆔 kt-\w+\n$/),
      false,
      noteBase("- [/] a\n"),
    );
  });
});

describe("#2080 a second press read before the first landed", () => {
  const STAMP = "---\nid: g\n---\n";
  /** A vault whose first save of a note answers with a frontmatter block stamped on top. */
  function vault(notes: Record<string, string>) {
    const disk = new Map(
      Object.entries({ [periodicNote("daily", new Date()).path]: "# day\n", ...notes }),
    );
    fetchNote.mockImplementation(async (path: string) => disk.get(path) ?? "");
    saveNote.mockImplementation(async (path: string, text: string) => {
      const content = text.startsWith("---\n") ? text : `${STAMP}${text}`;
      disk.set(path, content);
      return { path, content };
    });
    return disk;
  }
  const press = (path: string, line: number, text: string, twins?: number[]) =>
    cycleTodoInVault({ path, line, text }, "2026-10-18", undefined, twins);

  it("walks the todo on where the first save's stamp moved it", async () => {
    const disk = vault({ "g1.md": "# G\n- [ ] a\n" });
    await press("g1.md", 2, "- [ ] a");
    await press("g1.md", 2, "- [ ] a");
    expect(disk.get("g1.md")).toMatch(
      /^---\nid: g\n---\n# G\n- \[x\] a ✅ 2026-10-18 🆔 kt-\w+\n$/,
    );
  });

  it("walks it on from the row as drawn too", async () => {
    const disk = vault({ "g2.md": "# G\n- [ ] a\n" });
    await press("g2.md", 2, "- [ ] a");
    await press("g2.md", 2, "- [/] a");
    expect(disk.get("g2.md")).toMatch(/^---\nid: g\n---\n# G\n- \[x\] a ✅/);
  });

  it("writes nothing over a line changed since the first press landed", async () => {
    const disk = vault({ "g3.md": "# G\n- [ ] a\n" });
    await press("g3.md", 2, "- [ ] a");
    disk.set("g3.md", `${STAMP}# G\n- [b] a\n`);
    await expect(press("g3.md", 2, "- [ ] a")).rejects.toThrow("changed since it was listed");
    expect(disk.get("g3.md")).toBe(`${STAMP}# G\n- [b] a\n`);
  });

  it("walks the second of two twins twice and leaves the first", async () => {
    const disk = vault({ "g4.md": "# G\n- [ ] a\n- [ ] a\n" });
    await press("g4.md", 3, "- [ ] a", [2, 3]);
    await press("g4.md", 3, "- [ ] a", [2, 3]);
    expect(disk.get("g4.md")).toMatch(/^---\nid: g\n---\n# G\n- \[ \] a\n- \[x\] a ✅/);
  });

  it("presses a row listed after the landing on its own line", async () => {
    const disk = vault({ "g5.md": `${STAMP}# G\n- [ ] a\n` });
    await press("g5.md", 4, "- [ ] a");
    disk.set("g5.md", `${STAMP}# G\n- [ ] a\n- [/] a\n`);
    await press("g5.md", 4, "- [ ] a");
    expect(disk.get("g5.md")).toBe(`${STAMP}# G\n- [/] a\n- [/] a\n`);
  });

  it("sends the next press to the done line, not the recurring copy put above it", async () => {
    const todo = "- [/] water 🔁 every week 📅 2026-10-18";
    const disk = vault({ "g6.md": `# G\n${todo}\n` });
    await press("g6.md", 2, todo);
    await press("g6.md", 2, todo);
    const lines = disk.get("g6.md")?.split("\n") ?? [];
    expect(lines[4]).toBe("- [ ] water 📅 2026-10-25 🔁 every week");
    expect(lines[5]).not.toMatch(/^- \[x\]/);
  });
});
