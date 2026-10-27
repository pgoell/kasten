import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { SearchHit } from "@/lib/api";
import { renderContent, searchHooks } from "./content-search-fixture";

const { searchNotes, fetchNote, fetchTodos, fetchMentions } = vi.hoisted(() => ({
  searchNotes: vi.fn(),
  fetchNote: vi.fn(),
  fetchTodos: vi.fn(),
  fetchMentions: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ searchNotes, fetchNote, fetchTodos, fetchMentions }));

searchHooks();

/** Two file hits in the Tuesday of week 43, beside one note line in the same folder as one of them. */
const FILES: SearchHit[] = [
  {
    path: "docs/Plan.pdf",
    line: 3,
    text: "postgres budget for March",
    place: { kind: "pdf", label: "page 3", page: 3 },
    date: "2026-10-20",
    tags: ["#db"],
  },
  {
    path: "reading/Book.epub",
    line: 912,
    text: "postgres in the second chapter",
    place: { kind: "epub", label: "Chapter 2, 41%" },
    date: "2026-09-16",
    tags: ["#reading"],
  },
];

it("narrows the file hits to the folder chosen", async () => {
  searchNotes.mockResolvedValue(FILES);
  const search = renderContent();

  search.type("postgres");
  await waitFor(() => expect(search.rows()).toHaveLength(2));
  fireEvent.click(screen.getByRole("button", { name: /^docs/ }));

  expect(search.rows()).toHaveLength(1);
  expect(search.rows()[0]).toContain("postgres budget for March");
});

it("narrows the file hits to the tag chosen", async () => {
  searchNotes.mockResolvedValue(FILES);
  const search = renderContent();

  search.type("postgres");
  await waitFor(() => expect(search.rows()).toHaveLength(2));
  fireEvent.click(screen.getByRole("button", { name: /^#reading/ }));

  expect(search.rows()).toHaveLength(1);
  expect(search.rows()[0]).toContain("postgres in the second chapter");
});

it("counts a file hit in the week its date is in", async () => {
  searchNotes.mockResolvedValue([FILES[0]]);
  const search = renderContent();

  search.type("postgres");
  await waitFor(() => expect(search.bar(43).getAttribute("aria-label")).toBe("Week 43, 1 line"));
  expect(search.bar(30).getAttribute("aria-label")).toBe("Week 30, 0 lines");
});
