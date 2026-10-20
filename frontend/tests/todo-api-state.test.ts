import { noteBase } from "@/lib/note-base";
import { periodicNote } from "@/lib/periodic";
import { cycleTodoAside, cycleTodoInVault } from "@/lib/todo-api";
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

todoApiHooks();

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
