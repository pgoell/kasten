// @vitest-environment node
import { periodicNote } from "@/lib/notes/text/periodic";
import { cycleTodoAside } from "@/lib/todo/todo-api";
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

describe("cycleTodoAside", () => {
  it("#534 A4 a <leader>x into done whose 🆔 stands on another todo line logs nothing and unblocks nothing", async () => {
    const daily = periodicNote("daily", NOW).path;
    const notes: Record<string, string> = {
      "projects/other.md": "- [ ] a 🆔 kt-aaaaaa\n",
      "deps.md": "- [b] c ⛔ kt-aaaaaa\n",
      [daily]: "## Done\n",
    };
    fetchNote.mockImplementation(async (path: string) => notes[path]);
    fetchTodos.mockResolvedValue([
      {
        path: "projects/kasten.md",
        line: 3,
        text: "- [/] a 🆔 kt-aaaaaa",
        project: null,
        shared: false,
      },
      {
        path: "projects/other.md",
        line: 1,
        text: "- [ ] a 🆔 kt-aaaaaa",
        project: null,
        shared: false,
      },
      { path: "deps.md", line: 1, text: "- [b] c ⛔ kt-aaaaaa", project: null, shared: false },
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
    const daily = periodicNote("daily", NOW).path;
    fetchTodos.mockResolvedValue([
      {
        path: "projects/kasten.md",
        line: 1,
        text: "- [/] a 🆔 kt-aaaaaa",
        project: null,
        shared: false,
      },
      {
        path: "projects/kasten.md",
        line: 2,
        text: "- [/] a 🆔 kt-aaaaaa",
        project: null,
        shared: false,
      },
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
      {
        path: "projects/kasten.md",
        line: 1,
        text: "- [/] a 🆔 kt-aaaaaa",
        project: null,
        shared: false,
      },
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
