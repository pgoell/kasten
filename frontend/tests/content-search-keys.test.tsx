import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderContent, searchHooks } from "./content-search-fixture";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";

const { searchNotes, fetchNote, fetchTodos, fetchMentions } = vi.hoisted(() => ({
  searchNotes: vi.fn(),
  fetchNote: vi.fn(),
  fetchTodos: vi.fn(),
  fetchMentions: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ searchNotes, fetchNote, fetchTodos, fetchMentions }));

searchHooks();

afterEach(() => {
  vi.unstubAllGlobals();
});

it("sets the query in the serif face at the display size", () => {
  const search = renderContent();

  expect(search.input.className).toContain("font-serif");
  expect(search.input.className).toContain("text-k-36");
  expect(search.input.placeholder).toBe("Search the vault");
});

it("keeps the arrow keys and Enter working after a bar is clicked", async () => {
  const search = renderContent();

  search.type("postgres");
  await waitFor(() => expect(search.rows()).toHaveLength(2));
  fireEvent.click(search.bar(38));
  search.press("ArrowDown");
  search.press("Enter");

  expect(search.onOpen).toHaveBeenCalledWith("reference/deploy.md", 88);
});

it("does not take the focus from the input on a press of a bar", () => {
  const search = renderContent();

  // A prevented mousedown is what keeps the focus on the input.
  expect(fireEvent.mouseDown(search.bar(38))).toBe(false);
});

it("makes a bar, a filter and a line 44 pixels tall under a finger", async () => {
  const search = renderContent();

  search.type("postgres");
  await waitFor(() => expect(search.rows()).toHaveLength(2));

  expect(search.bar(38).className).toContain("pointer-coarse:min-h-11");
  expect(screen.getByRole("button", { name: /^projects/ }).className).toContain(
    "pointer-coarse:min-h-11",
  );
  expect(search.row(0).className).toContain("pointer-coarse:min-h-11");
});

it("folds the filter column into a Filters button on a phone, opened by a press", () => {
  stubMatchMedia({ [NARROW]: true, [COARSE]: true });
  renderContent();

  expect(screen.queryByRole("complementary", { name: "Filters" })).toBeNull();
  expect(screen.queryByRole("group", { name: "Folders" })).toBeNull();

  const filters = screen.getByRole("button", { name: "Filters" });
  fireEvent.click(filters);

  expect(filters.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("group", { name: "Folders" })).toBeTruthy();
});
