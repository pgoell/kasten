import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { NoteSearch } from "@/components/note/note-search";
import { fetchMentions, fetchNote, fetchTodos, searchNotes } from "@/lib/core/api";

// The test files beside this one mock the api module at this level:
// Standing in for the module rather than for `fetch`, the way the finder's
// tests do: what this component owns is what it asks the vault for and how
// often, not the HTTP underneath.
const HITS = [
  { path: "projects/kasten.md", line: 12, text: "Postgres holds a derived index." },
  { path: "reference/deploy.md", line: 88, text: "postgres runs in its own container" },
];

/** A note long enough that a window around a hit has to leave some of it out. */
const NOTE = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join("\n");

/** Resets the vault fakes before each test, the way every file of the search panel needs. */
export function searchHooks() {
  beforeEach(() => {
    vi.mocked(searchNotes).mockReset();
    vi.mocked(fetchNote).mockReset();
    vi.mocked(fetchTodos).mockReset();
    vi.mocked(fetchMentions).mockReset();
    vi.mocked(searchNotes).mockResolvedValue(HITS);
    vi.mocked(fetchNote).mockResolvedValue(NOTE);
    vi.mocked(fetchTodos).mockResolvedValue([]);
    vi.mocked(fetchMentions).mockResolvedValue([]);
  });
}

export const PATHS = ["archive/notes.md", "index.md", "kafka.md", "reading/borges.md"];

export function renderBacklinks(paths: string[] = PATHS) {
  const onOpen = vi.fn();
  const onClose = vi.fn();

  render(
    <QueryClientProvider client={new QueryClient()}>
      <NoteSearch backlinksOf="reading/borges.md" paths={paths} onOpen={onOpen} onClose={onClose} />
    </QueryClientProvider>,
  );

  const input = screen.getByLabelText("backlinks") as HTMLInputElement;

  return {
    input,
    onOpen,
    onClose,
    type: (value: string) => fireEvent.change(input, { target: { value } }),
    press: (key: string, init?: KeyboardEventInit) => fireEvent.keyDown(input, { key, ...init }),
    rows: () => screen.queryAllByRole("option").map((row) => row.textContent),
    hint: () => screen.getByRole("status").textContent,
    /** The named groups in the order they are drawn, with the rows under each. */
    groups: () =>
      screen.queryAllByRole("group").map((group) => ({
        name: group.getAttribute("aria-label"),
        rows: [...group.querySelectorAll('[role="option"]')].map((row) => row.textContent),
      })),
    /** Which drawn row carries the highlight. */
    selected: () => screen.queryAllByRole("option").findIndex((row) => row.ariaSelected === "true"),
  };
}
