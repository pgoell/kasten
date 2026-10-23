import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { HITS, lines, renderContent, searchHooks } from "./content-search-fixture";

const { searchNotes, fetchNote, fetchTodos, fetchMentions } = vi.hoisted(() => ({
  searchNotes: vi.fn(),
  fetchNote: vi.fn(),
  fetchTodos: vi.fn(),
  fetchMentions: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ searchNotes, fetchNote, fetchTodos, fetchMentions }));

searchHooks();

it("moves down across notes and opens the line it lands on", async () => {
  const search = renderContent();

  search.type("postgres");
  await waitFor(() => expect(search.rows()).toHaveLength(2));
  search.press("ArrowDown");
  search.press("ArrowDown");
  search.press("Enter");

  expect(search.onOpen).toHaveBeenCalledWith("reference/deploy.md", 88);
});

it("gives each note's group the entrance and its place in the stagger", async () => {
  const search = renderContent();

  search.type("postgres");
  await waitFor(() => expect(search.rows()).toHaveLength(2));
  const first = screen.getByRole("group", { name: "projects/kasten.md" });
  const second = screen.getByRole("group", { name: "reference/deploy.md" });

  expect(first.className).toContain("k-enter");
  expect(first.getAttribute("style")).toContain("--i: 0");
  expect(second.className).toContain("k-enter");
  expect(second.getAttribute("style")).toContain("--i: 1");
});

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

it("draws each note's title in serif and its path in mono under it", async () => {
  const search = renderContent();

  search.type("postgres");
  await waitFor(() => expect(search.rows()).toHaveLength(2));

  expect(screen.getByText("kasten").className).toContain("font-serif");
  expect(screen.getByText("projects/kasten.md").className).toContain("font-mono");
});

it("draws each line's number in muted mono", async () => {
  const search = renderContent();

  search.type("postgres");
  await waitFor(() => expect(search.rows()).toHaveLength(2));
  const number = within(search.row(0)).getByText("12");

  expect(number.className).toContain("font-mono");
  expect(number.className).toContain("text-k-muted");
});

it("marks every occurrence of the typed term in the accent", async () => {
  searchNotes.mockResolvedValue([
    { path: "a/b.md", line: 4, text: "Postgres and postgres again", date: "2026-10-20", tags: [] },
  ]);
  const search = renderContent();

  search.type("postgres");

  await waitFor(() => expect(search.rows()).toHaveLength(1));
  const marked = [...search.row(0).querySelectorAll(".text-k-accent")].map(
    (run) => run.textContent,
  );
  expect(marked).toEqual(["Postgres", "postgres"]);
});

it("opens the exact line when its row is clicked", async () => {
  const search = renderContent();

  search.type("postgres");
  await waitFor(() => expect(search.rows()).toHaveLength(2));
  fireEvent.click(search.row(1));

  expect(search.onOpen).toHaveBeenCalledWith("reference/deploy.md", 88);
});

it("says the counts are of the first 2,000 lines when the answer is cut there", async () => {
  searchNotes.mockResolvedValue(lines("big/notes.md", 2000, "2026-10-20"));
  const search = renderContent();

  search.type("postgres");

  await waitFor(() => expect(search.hint()).toBe("Counts are of the first 2,000 lines."));
});

it("keeps the highlighted row in view when the highlight moves past the end and back", async () => {
  const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
  const search = renderContent();

  search.type("postgres");
  await waitFor(() => expect(search.rows()).toHaveLength(2));
  scrollIntoView.mockClear();
  search.press("ArrowDown");
  search.press("ArrowDown");
  search.press("ArrowDown");
  search.press("ArrowUp");

  expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });
  expect(scrollIntoView.mock.contexts.at(-1)).toBe(search.row(0));
  scrollIntoView.mockRestore();
});
