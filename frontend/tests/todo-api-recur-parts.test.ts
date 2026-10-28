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
