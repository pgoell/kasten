import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderSearch, searchHooks } from "./note-search-fixture";

const { searchNotes, fetchNote, fetchTodos, fetchMentions } = vi.hoisted(() => ({
  searchNotes: vi.fn(),
  fetchNote: vi.fn(),
  fetchTodos: vi.fn(),
  fetchMentions: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ searchNotes, fetchNote, fetchTodos, fetchMentions }));

searchHooks();

it("shows the note, the line number and the line", async () => {
  const search = renderSearch();

  search.type("postgres");

  await waitFor(() => expect(search.rows()).toHaveLength(2));
  // The page groups by note, so the path is the heading over the row, not in it.
  expect(screen.getByRole("group", { name: "projects/kasten.md" })).toBeTruthy();
  expect(search.rows()[0]).toContain("12");
  expect(search.rows()[0]).toContain("Postgres holds a derived index.");
});

it("opens the hit that is tapped", async () => {
  const search = renderSearch();

  search.type("postgres");
  await waitFor(() => expect(search.rows()).toHaveLength(2));
  const row = screen.getAllByRole("option")[1] as HTMLElement;
  fireEvent.click(row);

  expect(search.onOpen).toHaveBeenCalledWith("reference/deploy.md", 88);
  // jsdom applies no media query, so the height is read off the class.
  expect(row).toHaveClass("pointer-coarse:min-h-11");
});

it("opens the note on the line the match is on", async () => {
  const search = renderSearch();

  search.type("postgres");
  await waitFor(() => expect(search.rows()).toHaveLength(2));
  search.press("Enter");

  expect(search.onOpen).toHaveBeenCalledWith("projects/kasten.md", 12);
});

it("says so when the vault holds nothing that matches", async () => {
  searchNotes.mockResolvedValue([]);
  const search = renderSearch();

  search.type("wikilink");

  await waitFor(() => expect(search.hint()).toBe("no notes match"));
});

it("closes on escape without opening anything", () => {
  const search = renderSearch();

  search.press("Escape");

  expect(search.onClose).toHaveBeenCalled();
  expect(search.onOpen).not.toHaveBeenCalled();
});
