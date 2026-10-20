import { createNote, fetchNote, fetchTodos, saveNote, searchNotes, updateNote } from "@/lib/api";
import { noteBase } from "@/lib/note-base";

export function todoApiHooks() {
  beforeEach(() => {
    // One try over the fakes above. The retries on a 409 are `update-note.test.ts`'s.
    vi.mocked(updateNote).mockImplementation(
      async (path: string, change: (text: string) => string | null) => {
        const text = await fetchNote(path);
        const next = change(text);
        return next === null ? null : saveNote(path, next, false, noteBase(text));
      },
    );
    vi.mocked(createNote).mockReset();
    vi.mocked(createNote).mockResolvedValue(undefined as never);
    vi.mocked(fetchNote).mockReset();
    vi.mocked(fetchTodos).mockReset();
    vi.mocked(fetchTodos).mockResolvedValue([]);
    vi.mocked(saveNote).mockReset();
    vi.mocked(saveNote).mockResolvedValue(undefined as never);
    vi.mocked(searchNotes).mockReset();
    vi.mocked(searchNotes).mockResolvedValue([]);
  });
}
