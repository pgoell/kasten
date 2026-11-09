import { screen, waitFor } from "@testing-library/react";
import { HITS, renderContent, searchHooks } from "./content-search-fixture";

const { searchNotes, fetchNote, fetchTodos, fetchMentions } = vi.hoisted(() => ({
  searchNotes: vi.fn(),
  fetchNote: vi.fn(),
  fetchTodos: vi.fn(),
  fetchMentions: vi.fn(),
}));
vi.mock("@/lib/core/api", () => ({ searchNotes, fetchNote, fetchTodos, fetchMentions }));

searchHooks();

// Kept beside the journeys: the entrance ends 372 ms after the first answer, too short a
// window for a journey to type a second query and read the class before it ends anyway.
it("gives no entrance to a note that a later answer adds", async () => {
  const later = {
    path: "later/new.md",
    line: 2,
    text: "postgres later",
    date: "2026-10-20",
    tags: [],
  };
  searchNotes.mockImplementation(async (query: string) =>
    query === "postgres" ? HITS : [...HITS, later],
  );
  const search = renderContent();

  search.type("postgres");
  await waitFor(() => expect(search.rows()).toHaveLength(2));
  search.type("postgres later");

  await waitFor(() => expect(search.notes()).toContain("later/new.md"));
  expect(screen.getByRole("group", { name: "later/new.md" }).className).not.toContain("k-enter");
});
