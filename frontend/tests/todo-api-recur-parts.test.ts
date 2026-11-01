import { noteBase } from "@/lib/note-base";
import { cycleTodoInVault } from "@/lib/todo/todo-api";
import { todoApiHooks } from "./todo-api-fixture";

// Standing in for the module, the way `todo-api-state.test.ts` does.
const { createNote, fetchNote, fetchTodos, saveNote, searchNotes, updateNote } = vi.hoisted(() => ({
  createNote: vi.fn(),
  fetchNote: vi.fn(),
  fetchTodos: vi.fn(),
  saveNote: vi.fn(),
  searchNotes: vi.fn(),
  updateNote: vi.fn(),
}));
vi.mock("@/lib/api", async (importOriginal) => {
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

describe("#802 the pane's tick", () => {
  it("#802 I1 a tick from the pane or board writes the copy's parts", async () => {
    const note = "- [ ] routine 📅 2026-08-10 🔁 every week\n  - [ ] part ⏳ 2026-08-09\n";
    fetchNote.mockImplementation(async (path: string) => (path === "routine.md" ? note : ""));

    await cycleTodoInVault(
      { path: "routine.md", line: 1, text: "- [ ] routine 📅 2026-08-10 🔁 every week" },
      "2026-08-10",
      ["routine.md"],
      "done",
    );

    const [path, text, , base] = saveNote.mock.calls[0] ?? [];
    expect(path).toBe("routine.md");
    expect(base).toBe(noteBase(note));
    expect((text as string).split("\n").slice(0, 2)).toEqual([
      "- [ ] routine 📅 2026-08-17 🔁 every week",
      "  - [ ] part ⏳ 2026-08-16",
    ]);
    expect((text as string).split("\n")[3]).toBe("  - [x] part ⏳ 2026-08-09 ✅ 2026-08-10");
  });
});

describe("#1305 the pane's tick on a waiting recurring todo", () => {
  async function tick(line: string): Promise<string> {
    fetchNote.mockImplementation(async (path: string) => (path === "a.md" ? `${line}\n` : ""));
    await cycleTodoInVault({ path: "a.md", line: 1, text: line }, "2026-08-10", ["a.md"], "done");
    return ((saveNote.mock.calls[0]?.[1] as string) ?? "").split("\n")[0] ?? "";
  }

  it("#1305 A2 writes the copy with no dated 👤", async () => {
    expect(await tick("- [w] a 📅 2026-08-10 🔁 every week 👤 2026-08-03 [[Ada]]")).toBe(
      "- [ ] a 📅 2026-08-17 🔁 every week",
    );
  });

  it("#1305 I1 keeps an undated 👤 name on the copy and drops the wait beside it", async () => {
    expect(await tick("- [w] a 📅 2026-08-10 🔁 every week 👤 [[Ada]] 👤 2026-08-03")).toBe(
      "- [ ] a 👤 [[Ada]] 📅 2026-08-17 🔁 every week",
    );
  });
});
