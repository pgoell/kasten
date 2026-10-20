import { waitFor } from "@testing-library/react";
import { HITS, renderSearch, searchHooks } from "./note-search-fixture";

const { searchNotes, fetchNote, fetchTodos, fetchMentions } = vi.hoisted(() => ({
  searchNotes: vi.fn(),
  fetchNote: vi.fn(),
  fetchTodos: vi.fn(),
  fetchMentions: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ searchNotes, fetchNote, fetchTodos, fetchMentions }));

searchHooks();

it("asks the vault for what was typed", async () => {
  const search = renderSearch();

  search.type("postgres");

  await waitFor(() => expect(searchNotes).toHaveBeenCalledWith("postgres", false));
});

it("asks nothing of the vault until the typing settles", async () => {
  const search = renderSearch();

  search.type("p");
  search.type("po");
  search.type("pos");

  // One query for the word, not one per letter. Every keystroke firing its own
  // scan is the thing the delay exists to stop.
  await waitFor(() => expect(searchNotes).toHaveBeenCalledWith("pos", false));
  expect(searchNotes).toHaveBeenCalledTimes(1);
});

it("ranks the lines it was handed rather than showing them in the order they came", async () => {
  // rg answers in path order, so `kasten.md` arrives first. Against `runs`
  // only the second line reads well, and the ranking is what has to say so.
  const search = renderSearch();

  search.type("postgres");
  await waitFor(() => expect(search.rows()).toHaveLength(2));

  searchNotes.mockResolvedValue(HITS);
  search.type("runs");

  await waitFor(() => expect(search.rows()[0]).toContain("reference/deploy.md"));
});

it("narrows what it already has while the next answer is on its way", async () => {
  // The whole point of ranking on this side. The vault answered for `postgres`
  // and the letters that follow filter that answer in the browser, so typing
  // keeps narrowing rather than freezing until the next scan lands.
  const search = renderSearch();

  search.type("postgres");
  await waitFor(() => expect(search.rows()).toHaveLength(2));

  searchNotes.mockReturnValue(new Promise(() => {}));
  search.type("postgres container");

  await waitFor(() => expect(search.rows()).toHaveLength(1));
  expect(search.rows()[0]).toContain("reference/deploy.md");
});
