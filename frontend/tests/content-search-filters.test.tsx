import { fireEvent, screen, waitFor } from "@testing-library/react";
import { ARCHIVED, HITS, lines, renderContent, searchHooks } from "./content-search-fixture";

const { searchNotes, fetchNote, fetchTodos, fetchMentions } = vi.hoisted(() => ({
  searchNotes: vi.fn(),
  fetchNote: vi.fn(),
  fetchTodos: vi.fn(),
  fetchMentions: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ searchNotes, fetchNote, fetchTodos, fetchMentions }));

searchHooks();

/** The answer with a third folder's three lines in week 41, beside `HITS`. */
const WITH_THIRD = [...HITS, ...lines("reference/more.md", 3, "2026-10-07")];

it("keeps the filter column at 220 pixels wide", () => {
  renderContent();

  const column = screen.getByRole("complementary", { name: "Filters" });
  expect(column.className).toContain("w-[220px]");
  expect(column.className).toContain("shrink-0");
});

it("counts the lines in each folder, each tag and the archive", async () => {
  const search = renderContent();

  search.type("postgres");

  await waitFor(() =>
    expect(screen.getByRole("button", { name: /^Include the archive/ }).textContent).toBe(
      "Include the archive1",
    ),
  );
  expect(screen.getByRole("button", { name: /^projects/ }).textContent).toBe("projects1");
  expect(screen.getByRole("button", { name: /^#db/ }).textContent).toBe("#db1");
});

it("shows a note at the vault's root under a slash", async () => {
  searchNotes.mockResolvedValue([
    { path: "index.md", line: 2, text: "postgres at the root", date: "2026-10-20", tags: [] },
  ]);
  const search = renderContent();

  search.type("postgres");

  await waitFor(() => expect(screen.getByRole("button", { name: /^\/\s*1$/ })).toBeTruthy());
  expect(search.rows()).toHaveLength(1);
});

it("narrows the results and the histogram to the folder chosen", async () => {
  searchNotes.mockResolvedValue(WITH_THIRD);
  const search = renderContent();

  search.type("postgres");
  await waitFor(() => expect(search.rows()).toHaveLength(5));
  fireEvent.click(screen.getByRole("button", { name: /^reference/ }));

  expect(search.rows()).toHaveLength(4);
  expect(search.bar(41).getAttribute("aria-label")).toBe("Week 41, 3 lines");
  expect(search.bar(43).getAttribute("aria-label")).toBe("Week 43, 0 lines");
});

it("clears the folder on a second press on it", async () => {
  searchNotes.mockResolvedValue(WITH_THIRD);
  const search = renderContent();

  search.type("postgres");
  await waitFor(() => expect(search.rows()).toHaveLength(5));
  fireEvent.click(screen.getByRole("button", { name: /^reference/ }));
  fireEvent.click(screen.getByRole("button", { name: /^reference/ }));

  expect(search.rows()).toHaveLength(5);
  expect(screen.getByRole("button", { name: /^reference/ }).getAttribute("aria-pressed")).toBe(
    "false",
  );
});

it("keeps the folder counts those of the whole answer while a folder is chosen", async () => {
  searchNotes.mockResolvedValue(WITH_THIRD);
  const search = renderContent();

  search.type("postgres");
  await waitFor(() => expect(search.rows()).toHaveLength(5));
  fireEvent.click(screen.getByRole("button", { name: /^reference/ }));

  expect(screen.getByRole("button", { name: /^projects/ }).textContent).toBe("projects1");
  expect(screen.getByRole("button", { name: /^reference/ }).textContent).toBe("reference4");
});

it("narrows the results and the histogram to the tag chosen", async () => {
  const search = renderContent();

  search.type("postgres");
  await waitFor(() => expect(search.rows()).toHaveLength(2));
  fireEvent.click(screen.getByRole("button", { name: /^#reading/ }));

  expect(search.rows()).toHaveLength(1);
  expect(search.bar(43).getAttribute("aria-label")).toBe("Week 43, 0 lines");
  expect(search.bar(38).getAttribute("aria-label")).toBe("Week 38, 1 line");
});

it("asks the vault a second time with the archive in, for the archive's count", async () => {
  const search = renderContent();

  search.type("postgres");

  await waitFor(() => expect(searchNotes).toHaveBeenCalledWith("postgres", true));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /^Include the archive/ }).textContent).toBe(
      "Include the archive1",
    ),
  );
});

it("flips the archive in on a press and lists its lines", async () => {
  const search = renderContent();

  search.type("postgres");
  await waitFor(() => expect(search.rows()).toHaveLength(2));
  fireEvent.click(screen.getByRole("button", { name: /^Include the archive/ }));

  expect(search.onToggleArchive).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(search.rows()).toHaveLength(2 + ARCHIVED.length));
  expect(
    screen.getByRole("button", { name: /^Include the archive/ }).getAttribute("aria-pressed"),
  ).toBe("true");
});
