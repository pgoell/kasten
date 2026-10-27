import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { SearchHit } from "@/lib/api";
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

const PDF: SearchHit = {
  path: "docs/Plan.pdf",
  line: 3,
  text: "postgres budget for March",
  place: { kind: "pdf", label: "page 3", page: 3 },
  date: "2026-10-20",
  tags: ["#db"],
};
const EPUB: SearchHit = {
  path: "reading/Book.epub",
  line: 912,
  text: "postgres in the second chapter",
  place: { kind: "epub", label: "Chapter 2, 41%" },
  date: "2026-10-20",
  tags: [],
};
const HTML: SearchHit = {
  path: "reference/Guide.html",
  line: 20,
  text: "postgres needs a role",
  place: { kind: "html", label: "Roles", anchor: "roles" },
  date: "2026-10-20",
  tags: [],
};

it("labels a pdf hit's row with its page, where a note hit shows its line", async () => {
  searchNotes.mockResolvedValue([PDF]);
  const search = renderContent();

  search.type("postgres");

  await waitFor(() => expect(search.rows()).toHaveLength(1));
  expect(search.rows()[0]).toContain("page 3");
  expect(search.rows()[0]).toContain("postgres budget for March");
});

it("labels an epub hit's row with its chapter and position", async () => {
  searchNotes.mockResolvedValue([EPUB]);
  const search = renderContent();

  search.type("postgres");

  await waitFor(() => expect(search.rows()).toHaveLength(1));
  expect(search.rows()[0]).toContain("Chapter 2, 41%");
});

it("labels an html hit's row with its nearest heading", async () => {
  searchNotes.mockResolvedValue([HTML]);
  const search = renderContent();

  search.type("postgres");

  await waitFor(() => expect(search.rows()).toHaveLength(1));
  expect(search.rows()[0]).toContain("Roles");
});

it("groups a file hit under its file name with the kind in capitals", async () => {
  searchNotes.mockResolvedValue([PDF]);
  const search = renderContent();

  search.type("postgres");

  await waitFor(() => expect(search.rows()).toHaveLength(1));
  const group = screen.getByRole("group", { name: "docs/Plan.pdf" });
  expect(group.textContent).toContain("Plan.pdf");
  expect(group.textContent).toContain("PDF");
});

it("does not ask the vault for a file's note when it groups the file", async () => {
  searchNotes.mockResolvedValue([PDF, EPUB, HTML]);
  const search = renderContent();

  search.type("postgres");

  await waitFor(() => expect(search.rows()).toHaveLength(3));
  expect(fetchNote).not.toHaveBeenCalled();
});

it("opens a file hit with the hit itself on a 414 px phone, by tap", async () => {
  stubMatchMedia({ [NARROW]: true, [COARSE]: true });
  searchNotes.mockResolvedValue([PDF]);
  const search = renderContent();

  search.type("postgres");

  await waitFor(() => expect(search.rows()).toHaveLength(1));
  fireEvent.click(search.row(0));

  expect(search.onOpen).toHaveBeenCalledWith("docs/Plan.pdf", 3, expect.objectContaining(PDF));
});
